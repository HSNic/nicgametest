/* ============================================================================
 * afk-cloud-sync.js — 跨裝置雲端存檔同步（Google Drive drive.appdata）
 *
 * 目標：家用電腦、外出手機、外地筆電玩同一份進度，不用再靠 exportSave/importSave
 *   手動搬檔案。後端用 Google Drive 的 App 專屬資料夾（drive.appdata），純前端 JS
 *   呼叫、不需自架伺服器；身分綁定＝登入哪個 Google 帳號本身，不另外設計同步碼。
 *
 * 設計原則（詳見 Lineage/待辦-ClaudeCode/2026-07-08_跨裝置雲端存檔同步設計評估.md）：
 *   - 衝突時仿 Steam Cloud：跳視窗讓玩家自己選本機/雲端，絕不自動覆蓋。
 *   - 同步範圍不是只有存檔 JSON，還要整包帶上「跟裝置綁定」的 4 把輔助鍵
 *     （afk_ts_<slot>／afk_map_<slot>／afk_pride_<slot>／afk_obl_<slot>，見 afk-offline.js）
 *     ＋共用倉庫，缺一把都可能讓離線結算算錯。
 *   - 上傳前用 Drive 的 headRevisionId 當樂觀鎖，偵測「別台裝置搶先寫入」。
 *   - 上傳時機不做持續 debounce，改成「有意義的時間點」（切分頁/離開/手動/閒置補傳）
 *     才觸發，且加一層節流（距上次真的打 API 未滿間隔就只更新本機、不打 API），
 *     避免短時間內在 Google Drive 堆出大量 revision（Gemini 建議採納；但不做「自建
 *     新檔搬遷修剪」——Drive 原生 keepRevisionForever=false 已足夠自動清理）。
 *   - 手動同步按鈕加 cooldown，防連點打爆 API。
 *   - 同步補強 exportSave()/importSave()：現有版本完全沒處理上述 4 把輔助鍵，等於
 *     雲端同步做得再嚴謹，玩家走「手動匯出/匯入」這條舊路一樣會重複結算/算錯離線
 *     收益（防護後門），這次一起補。
 *
 * 目前狀態（階段 A，2026-07-08）：只有架構＋UI＋exportSave/importSave 補強是完整的；
 *   auth/drive 兩個模組是骨架（CLIENT_ID 未設定），尚未真的串 Google 登入與 Drive
 *   REST API——這部分要等使用者去 Google Cloud Console 申請到 Client ID 才能接
 *   （階段 B）。CLIENT_ID 空字串時，整支外掛對遊戲行為零介入：
 *     - saveGame/loadGame/chooseSlot 的 monkey-patch 都先判斷 auth.isSignedIn()，
 *       未設定 Client ID 時一律直接短路呼叫原函式，不影響任何既有行為。
 *     - 首頁「⚙ 其他功能」選單只在 auth.isConfigured() 時才會多一項，沒設定就完全
 *       不出現在畫面上。
 *   exportSave/importSave 的 _afk 欄位補強不依賴 Google，現在就會生效。
 *
 * 掛接：在 index.html 的 </body> 前加一行 <script src="afk-cloud-sync.js"></script>，
 *   必須排在 afk-offline.js（4 把輔助鍵/saveGame·loadGame 第一層包裝）、
 *   afk-fixes.js、afk-ui.js（共用 Modal 管理器）之後。
 * ========================================================================== */
(function () {
  'use strict';

  // ----- 可調參數 -----------------------------------------------------------
  var CLIENT_ID = '452592311770-io65beqsrnb9vt25bpk360pnv9o2agef.apps.googleusercontent.com';
  // drive.appdata:讀寫 App 專屬資料夾;userinfo.email:登入後顯示帳號 email 用
  //   （2026-07-09 踩過:只申請 drive.appdata 的話, token 沒有權限打 userinfo API,
  //   會被 Google 拒絕(403),表現成「登入失敗:讀取帳號資訊失敗」，要兩個 scope 一起要）。
  var DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email';
  // 2026-07-09 使用者確認:不用在這裡另外維護一層白名單，Google Cloud Console 的 OAuth
  //   同意畫面「測試使用者」名單本身就是唯一的登入門檻(不在名單上的帳號會直接被 Google 擋在
  //   同意畫面前，連 token 都拿不到)，這裡重複比對只是多一層維護負擔。
  var HEARTBEAT_FRESH_MS = 2 * 60 * 1000;      // 「可能正在遊玩中」門檻：心跳在幾毫秒內算新鮮（使用者已確認 2 分鐘）
  var MIN_UPLOAD_INTERVAL_MS = 4 * 60 * 1000;  // 節流：距上次真正打雲端 API 至少要隔這麼久（Gemini 建議採納）
  var IDLE_UPLOAD_AFTER_MS = 5 * 60 * 1000;    // 幾分鐘沒有新的 saveGame() 呼叫才觸發一次補傳
  var MANUAL_SYNC_COOLDOWN_MS = 8 * 1000;      // 手動同步按鈕 cooldown（防連點）
  var SESSION_EMAIL_KEY = 'afk_cloud_session_email';   // 記住「上次登入過」，供重整頁面後靜默恢復登入用

  // ----- 自我檢查：核心掛點都在才啟用，否則安靜退出（遊戲照常運作） ----------
  if (typeof window.saveGame !== 'function' ||
      typeof window.loadGame !== 'function' ||
      typeof window.chooseSlot !== 'function' ||
      typeof window.openSlotSelect !== 'function' ||
      typeof window.exportSave !== 'function' ||
      typeof window.importSave !== 'function' ||
      typeof window.slotSummary !== 'function' ||
      typeof window.whKey !== 'function' ||
      typeof window._lzGet !== 'function' ||
      typeof window._lzSet !== 'function' ||
      typeof window._lsGet !== 'function' ||
      typeof window._lsSet !== 'function' ||
      typeof window._saveWrap !== 'function' ||
      typeof window._saveUnwrap !== 'function') {
    console.warn('[AFK-cloud-sync] 缺少核心掛點（saveGame/loadGame/chooseSlot/exportSave/...），雲端同步功能停用。');
    return;
  }
  try { void currentSlot; }
  catch (e) {
    console.warn('[AFK-cloud-sync] 缺少核心全域 currentSlot，雲端同步功能停用。');
    return;
  }

  var AFK_CLOUD = (window.AFK_CLOUD = window.AFK_CLOUD || {});

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmtTs(ts) {
    if (!ts) return '未知時間（舊版匯出檔）';
    try { return new Date(ts).toLocaleString(); } catch (e) { return '未知時間'; }
  }
  // 表格欄位空間有限，同步狀態列表用短格式（完整時間仍在衝突視窗用 fmtTs 顯示）
  function fmtTsShort(ts) {
    if (!ts) return '尚未同步過';
    try {
      var d = new Date(ts);
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return '未知'; }
  }

  // ===========================================================================
  // payload：打包/還原「存檔位 + 倉庫 + 4 把裝置綁定輔助鍵」
  // ===========================================================================
  var payload = AFK_CLOUD.payload = {};
  var CLASS_NAME = { knight: '騎士', mage: '法師', elf: '妖精', dark: '黑暗妖精', illusion: '幻術士', dragon: '龍騎士', warrior: '戰士', royal: '王族' };

  function afkKeyNames(slot) {
    return { ts: 'afk_ts_' + slot, map: 'afk_map_' + slot, pride: 'afk_pride_' + slot, obl: 'afk_obl_' + slot };
  }

  // 讀出某存檔位目前的 4 把輔助鍵（不動 localStorage）
  payload.readAfkKeys = function (slot) {
    var k = afkKeyNames(slot);
    var out = { ts: 0, map: '', pride: null, obl: null };
    try { out.ts = +localStorage.getItem(k.ts) || 0; } catch (e) {}
    try { out.map = localStorage.getItem(k.map) || ''; } catch (e) {}
    try { var p = localStorage.getItem(k.pride); out.pride = p ? JSON.parse(p) : null; } catch (e) {}
    try { var o = localStorage.getItem(k.obl); out.obl = o ? JSON.parse(o) : null; } catch (e) {}
    return out;
  };

  // 整包覆寫某存檔位的 4 把輔助鍵（不可挑著寫；afk 為 null/缺值時清掉對應鍵）
  payload.writeAfkKeys = function (slot, afk) {
    var k = afkKeyNames(slot);
    try {
      if (afk && afk.ts) localStorage.setItem(k.ts, String(afk.ts)); else localStorage.removeItem(k.ts);
      if (afk && afk.map) localStorage.setItem(k.map, afk.map); else localStorage.removeItem(k.map);
      if (afk && afk.pride) localStorage.setItem(k.pride, JSON.stringify(afk.pride)); else localStorage.removeItem(k.pride);
      if (afk && afk.obl) localStorage.setItem(k.obl, JSON.stringify(afk.obl)); else localStorage.removeItem(k.obl);
    } catch (e) { console.warn('[AFK-cloud-sync] writeAfkKeys 失敗:', e); }
  };

  // 讀出某存檔位的完整同步物件：{ slot, save:{v,p,ms,ticks}, wh:{items,gold}|null, afk:{...}, packedAt }
  payload.buildPayload = function (slot) {
    var raw = _lzGet('lineage_idle_save_' + slot);
    if (!raw) return null;
    var u = _saveUnwrap(raw);
    if (!u.ok) { console.warn('[AFK-cloud-sync] 存檔簽章不符，略過打包（slot ' + slot + '）。'); return null; }
    var d;
    try { d = JSON.parse(u.payload); } catch (e) { return null; }
    if (!d || !d.p) return null;
    var wh = null;
    try { var whRaw = _lzGet(whKey(d.p)); wh = whRaw ? JSON.parse(whRaw) : null; } catch (e) {}
    return { slot: slot, save: d, wh: wh, afk: payload.readAfkKeys(slot), packedAt: Date.now() };
  };

  // 整包覆寫回本機：存檔位 + 倉庫 + 4 把輔助鍵一次寫齊，不可挑著寫
  payload.applyPayload = function (obj, slot) {
    if (!obj || !obj.save) return false;
    try {
      _lzSet('lineage_idle_save_' + slot, _saveWrap(JSON.stringify(obj.save)));
      if (obj.wh) _lzSet(whKey(obj.save.p), JSON.stringify(obj.wh));
      payload.writeAfkKeys(slot, obj.afk);
      setLastSyncedAt(slot, Date.now());   // 套用雲端內容＝本機現在跟雲端一致，記一筆同步時間供面板顯示
      return true;
    } catch (e) { console.warn('[AFK-cloud-sync] applyPayload 失敗:', e); return false; }
  };

  // 給衝突視窗/UI 用的精簡摘要
  payload.summarize = function (obj) {
    if (!obj || !obj.save || !obj.save.p) return null;
    var p = obj.save.p;
    return {
      cls: CLASS_NAME[p.cls] || p.cls || '?',
      lv: p.lv || 1,
      name: p.name || '',
      ts: (obj.afk && obj.afk.ts) || 0,
      map: (obj.afk && obj.afk.map) || ''
    };
  };
  payload.summarizeFromSlot = function (slot) { return payload.summarize(payload.buildPayload(slot)); };

  // ===========================================================================
  // conflict：純函式，判斷是否需要跳衝突視窗 / 是否可能正在遊玩中
  // ===========================================================================
  var conflict = AFK_CLOUD.conflict = {};
  conflict.compareForConflict = function (localSummary, remoteSummary) {
    if (!localSummary || !remoteSummary) return { needPrompt: false, reason: 'none' };
    // 仿 Steam Cloud：只要時間戳不同就交給玩家選，不比大小、不自動判斷「誰比較新」。
    if (localSummary.ts !== remoteSummary.ts) return { needPrompt: true, reason: 'ts-diff' };
    return { needPrompt: false, reason: 'none' };
  };
  conflict.isRemoteMaybePlaying = function (remoteSummary, nowMs) {
    if (!remoteSummary || !remoteSummary.ts) return false;
    return (nowMs - remoteSummary.ts) < HEARTBEAT_FRESH_MS;
  };

  // ===========================================================================
  // timesync：時鐘校正骨架（防作弊；階段 B 才有真的 API 回應可校正，目前 drift 恆為 0）
  // ===========================================================================
  var timesync = AFK_CLOUD.timesync = {};
  timesync.recordServerDate = function (headerDateStr) {
    var t = headerDateStr ? Date.parse(headerDateStr) : NaN;
    if (isNaN(t)) return;
    try { localStorage.setItem('afk_cloud_clock_drift', String(t - Date.now())); } catch (e) {}
  };
  timesync.now = function () {
    var drift = 0;
    try { drift = +localStorage.getItem('afk_cloud_clock_drift') || 0; } catch (e) {}
    return Date.now() + drift;
  };

  // ===========================================================================
  // auth：Google Identity Services（GIS token client）登入
  // ===========================================================================
  var auth = AFK_CLOUD.auth = {};
  var _signedIn = false;
  var _userEmail = '';
  var _accessToken = null;
  var _tokenExpiresAt = 0;
  var _tokenClient = null;
  var _gisLoadPromise = null;

  auth.isConfigured = function () { return !!CLIENT_ID; };
  auth.isSignedIn = function () { return auth.isConfigured() && _signedIn; };
  auth.getEmail = function () { return _userEmail; };
  // driveFetch 收到 401 時呼叫，強制下次重新取得 token
  auth._invalidateToken = function () { _accessToken = null; _tokenExpiresAt = 0; };

  function loadGisScript() {
    if (_gisLoadPromise) return _gisLoadPromise;
    _gisLoadPromise = new Promise(function (resolve, reject) {
      if (!window.isSecureContext) { reject(new Error('雲端同步需要 https（或已安裝的 PWA）才能使用 Google 登入，目前不是安全連線環境。')); return; }
      if (window.google && google.accounts && google.accounts.oauth2) { resolve(); return; }
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Google 登入元件載入失敗（可能離線或被封鎖）。')); };
      document.head.appendChild(s);
    });
    return _gisLoadPromise;
  }

  function ensureTokenClient() {
    return loadGisScript().then(function () {
      if (_tokenClient) return _tokenClient;
      _tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: DRIVE_SCOPE, callback: function () {} });
      return _tokenClient;
    });
  }

  // promptMode：'' 讓 Google 自行判斷(登入按鈕用)；'none' 完全不彈窗(背景自動同步用，失敗就算了，不強迫互動)
  var TOKEN_REQUEST_TIMEOUT_MS = 20 * 1000;        // 互動式登入：授權彈窗被瀏覽器擋掉/使用者晾著不理時，別讓呼叫端永遠卡住
  var SILENT_TOKEN_TIMEOUT_MS = 6 * 1000;          // 靜默恢復：沒有人在等，失敗就趕快放棄，別讓那個一閃即逝的視窗卡 20 秒

  // opts: { timeoutMs, hint }。hint(上次登入的 email) 給靜默恢復用，讓 Google 不必再選帳號，
  // 提高「重整頁面後不用重新登入」的成功率(2026-07-09 使用者回報重整常常還是被登出)。
  function requestToken(promptMode, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs || TOKEN_REQUEST_TIMEOUT_MS;
    return ensureTokenClient().then(function (tc) {
      return new Promise(function (resolve, reject) {
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          reject(new Error('登入逾時（授權視窗可能被瀏覽器封鎖，或忘記在彈出視窗完成登入）'));
        }, timeoutMs);
        tc.callback = function (resp) {
          if (settled) return;   // 逾時已經 reject 過，之後才姍姍來遲的 callback 不再處理
          settled = true;
          clearTimeout(timer);
          if (!resp || resp.error) { reject(new Error((resp && resp.error) || '登入被取消或失敗')); return; }
          _accessToken = resp.access_token;
          _tokenExpiresAt = Date.now() + ((resp.expires_in ? +resp.expires_in : 3500) * 1000);
          resolve(_accessToken);
        };
        var req = { prompt: promptMode };
        if (opts.hint) req.hint = opts.hint;
        try { tc.requestAccessToken(req); }
        catch (e) { if (!settled) { settled = true; clearTimeout(timer); reject(e); } }
      });
    });
  }

  // 供 drive 模組取用；快取未過期直接回傳，否則先嘗試不彈窗的靜默續期（背景呼叫用 'none'，
  // 呼叫端若是使用者主動點擊(立即同步/登入)已經是 user gesture，過期時退回互動式('')重新登入）。
  auth.getAccessToken = function (interactive) {
    if (_accessToken && Date.now() < _tokenExpiresAt - 60000) return Promise.resolve(_accessToken);
    return requestToken(interactive ? '' : 'none', interactive ? null : { timeoutMs: SILENT_TOKEN_TIMEOUT_MS, hint: _userEmail });
  };

  function fetchUserInfo(token) {
    return fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { if (!r.ok) throw new Error('讀取帳號資訊失敗（HTTP ' + r.status + '）'); return r.json(); });
  }

  auth.signIn = function () {
    if (!auth.isConfigured()) { AFK_CLOUD.ui.toast('雲端同步尚未開放（尚未設定 Google Client ID）'); return; }
    requestToken('').then(function (token) {
      return fetchUserInfo(token).then(function (info) {
        var email = info.email || '';
        _signedIn = true; _userEmail = email;
        try { localStorage.setItem(SESSION_EMAIL_KEY, email); } catch (e) {}
        AFK_CLOUD.ui.refreshPanel();
        AFK_CLOUD.ui.toast('已登入：' + email);
        try { AFK_CLOUD.scheduler.onLoadGame(); } catch (e) {}
      });
    }).catch(function (err) {
      AFK_CLOUD.ui.toast('登入失敗：' + (err && err.message ? err.message : String(err)));
    });
  };

  // 頁面重整/重新開啟時，只要「上次登入過」(SESSION_EMAIL_KEY 有記錄)就嘗試靜默恢復登入
  //（prompt:'none'，不彈窗；玩家的 Google 那邊還記得同意才會成功）——玩家體感是「登入一次，
  //   除非自己按登出，否則會一直保持登入狀態」（2026-07-09 使用者明訂的期待行為）。
  //   靜默恢復失敗（例如 Google 那邊 session 過期）就悄悄放著,玩家自己按登入鈕重新來一次即可。
  auth.tryRestoreSession = function () {
    if (!auth.isConfigured()) return;
    var savedEmail;
    try { savedEmail = localStorage.getItem(SESSION_EMAIL_KEY); } catch (e) { savedEmail = null; }
    if (!savedEmail) return;
    requestToken('none', { timeoutMs: SILENT_TOKEN_TIMEOUT_MS, hint: savedEmail }).then(function (token) {
      return fetchUserInfo(token).then(function (info) {
        _signedIn = true; _userEmail = info.email || savedEmail;
        AFK_CLOUD.ui.refreshPanel();
        try { AFK_CLOUD.scheduler.onLoadGame(); } catch (e) {}
      });
    }).catch(function (err) {
      console.log('[AFK-cloud-sync] 靜默恢復登入失敗（需要重新按登入）:', err && err.message);
    });
  };

  auth.signOut = function () {
    if (_accessToken) { try { google.accounts.oauth2.revoke(_accessToken, function () {}); } catch (e) {} }
    auth._invalidateToken();
    _signedIn = false; _userEmail = '';
    try { localStorage.removeItem(SESSION_EMAIL_KEY); } catch (e) {}
    AFK_CLOUD.ui.refreshPanel();
  };

  // ===========================================================================
  // drive：Google Drive REST API 封裝（fetch 直打，不引入 gapi client library）
  // ===========================================================================
  var drive = AFK_CLOUD.drive = {};
  var API_BASE = 'https://www.googleapis.com/drive/v3';
  var UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
  drive.isReady = function () { return auth.isSignedIn(); };
  drive.fileNameFor = function (slot) { return 'lineage_save_sync_slot' + slot + '.json'; };

  function makeErr(kind, msg, status) { var e = new Error(msg); e.kind = kind; if (status) e.status = status; return e; }

  function driveFetch(url, opts, interactive) {
    return auth.getAccessToken(interactive).then(function (token) {
      var o = {};
      for (var k in opts) o[k] = opts[k];
      o.headers = {};
      for (var hk in (opts && opts.headers)) o.headers[hk] = opts.headers[hk];
      o.headers.Authorization = 'Bearer ' + token;
      return fetch(url, o).then(function (res) {
        timesync.recordServerDate(res.headers.get('Date'));
        if (res.status === 401) { auth._invalidateToken(); throw makeErr('auth', '登入已過期，請重新登入。'); }
        return res;
      });
    }).catch(function (err) {
      if (err && err.kind) throw err;
      throw makeErr('network', (err && err.message) || '網路連線失敗');
    });
  }

  drive.findFile = function (slot) {
    var name = drive.fileNameFor(slot);
    var q = "name='" + name + "' and 'appDataFolder' in parents and trashed=false";
    var url = API_BASE + '/files?spaces=appDataFolder&q=' + encodeURIComponent(q) + '&fields=' + encodeURIComponent('files(id,headRevisionId,modifiedTime)');
    return driveFetch(url, {}).then(function (res) {
      if (!res.ok) throw makeErr('unknown', 'Drive 查詢失敗（' + res.status + '）');
      return res.json();
    }).then(function (data) { return (data.files && data.files[0]) || null; });
  };

  drive.getFileMeta = function (fileId) {
    var url = API_BASE + '/files/' + fileId + '?fields=' + encodeURIComponent('headRevisionId,modifiedTime');
    return driveFetch(url, {}).then(function (res) {
      if (!res.ok) throw makeErr('unknown', 'Drive 讀取檔案資訊失敗（' + res.status + '）', res.status);
      return res.json();
    });
  };

  drive.downloadFile = function (fileId) {
    var url = API_BASE + '/files/' + fileId + '?alt=media';
    return driveFetch(url, {}).then(function (res) {
      if (!res.ok) throw makeErr('unknown', 'Drive 下載失敗（' + res.status + '）');
      return res.text();
    });
  };

  // 不帶 keepRevisionForever（維持預設 false）：只保留最新一份，信任 Drive 原生規則自動清舊版本
  drive.uploadFile = function (opts) {
    var boundary = 'afkcloud' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    var metadata = { name: opts.name };
    if (!opts.fileId) metadata.parents = ['appDataFolder'];
    var body =
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      opts.content + '\r\n' +
      '--' + boundary + '--';
    var url = UPLOAD_BASE + '/files' + (opts.fileId ? '/' + opts.fileId : '') + '?uploadType=multipart&fields=' + encodeURIComponent('id,headRevisionId,modifiedTime');
    return driveFetch(url, { method: opts.fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: body }, true).then(function (res) {
      if (!res.ok) throw makeErr('unknown', 'Drive 上傳失敗（' + res.status + '）');
      return res.json();
    });
  };

  // ===========================================================================
  // flow：串起 auth/drive/payload/conflict/ui 的高階流程
  // ===========================================================================
  var flow = AFK_CLOUD.flow = {};
  var _pendingUpload = false;

  function lastRevKey(slot) { return 'afk_cloud_last_rev_' + slot; }
  function getLastRev(slot) { try { return localStorage.getItem(lastRevKey(slot)) || ''; } catch (e) { return ''; } }
  function setLastRev(slot, rev) { try { localStorage.setItem(lastRevKey(slot), rev || ''); } catch (e) {} }
  function fileIdKey(slot) { return 'afk_cloud_file_id_' + slot; }
  function getFileId(slot) { try { return localStorage.getItem(fileIdKey(slot)) || ''; } catch (e) { return ''; } }
  function setFileId(slot, id) { try { localStorage.setItem(fileIdKey(slot), id || ''); } catch (e) {} }
  // 「上次同步時間」：面板要顯示各存檔位的同步狀態，不能只讓玩家憑感覺猜（2026-07-09 使用者回報）。
  //   function 宣告會被提升到整個 IIFE 頂端，payload.applyPayload 雖然寫在更前面也能呼叫到。
  function lastSyncedAtKey(slot) { return 'afk_cloud_synced_at_' + slot; }
  function getLastSyncedAt(slot) { try { return +localStorage.getItem(lastSyncedAtKey(slot)) || 0; } catch (e) { return 0; } }
  function setLastSyncedAt(slot, ts) { try { localStorage.setItem(lastSyncedAtKey(slot), String(ts)); } catch (e) {} }

  // 本機快取的 fileId 可能已經失效(例如雲端那份檔案被清掉、或帳號狀態變了)，
  // 這時直接信任快取會讓後續 getFileMeta/downloadFile 打 404 導致整次同步失敗
  // (2026-07-09 使用者實測回報「同步失敗：Drive 讀取檔案資訊失敗（404）」)。
  // 先驗證快取的 id 還存在，404 就清快取、改用檔名重新查詢一次。
  function findExisting(slot) {
    var fid = getFileId(slot);
    if (!fid) return drive.findFile(slot);
    return drive.getFileMeta(fid).then(function (meta) {
      return { id: fid, headRevisionId: meta.headRevisionId, modifiedTime: meta.modifiedTime };
    }).catch(function (err) {
      if (err && err.status === 404) { setFileId(slot, null); return drive.findFile(slot); }
      throw err;
    });
  }

  // 以下 doUpload/uploadWithGuard/flow.syncUpload 都回傳一個結果物件(而非單純 resolve/reject),
  // 讓呼叫端(尤其手動按「立即同步」)能明確知道「到底有沒有真的同步成功」,不是只能看 console。
  function doUpload(slot, obj, fileId) {
    return drive.uploadFile({ fileId: fileId, name: drive.fileNameFor(slot), content: JSON.stringify(obj) }).then(function (res) {
      setFileId(slot, res.id);
      setLastRev(slot, res.headRevisionId || '');
      setLastSyncedAt(slot, Date.now());
      console.log('[AFK-cloud-sync] 上傳成功（slot ' + slot + '）。');
      return { ok: true };
    });
  }

  function handleSyncError(err, reason) {
    if (err && err.kind === 'network') { _pendingUpload = true; AFK_CLOUD.ui.toast('離線中，恢復連線後自動補傳存檔'); }
    else if (err && err.kind === 'auth') { AFK_CLOUD.ui.toast('登入已過期，請重新點擊「立即同步」重新登入'); }
    else { console.warn('[AFK-cloud-sync] 同步失敗（' + reason + '）:', err); AFK_CLOUD.ui.toast('同步失敗：' + ((err && err.message) || '未知錯誤')); }
    return { ok: false, err: err };
  }

  function uploadWithGuard(slot, obj, reason) {
    return findExisting(slot).then(function (existing) {
      if (!existing) return doUpload(slot, obj, null);
      setFileId(slot, existing.id);
      return drive.getFileMeta(existing.id).then(function (meta) {
        var lastKnown = getLastRev(slot);
        if (lastKnown && meta.headRevisionId && meta.headRevisionId !== lastKnown) {
          // 別台裝置搶先寫入：不覆蓋，跳警告讓玩家決定。先把雲端目前內容真的抓下來顯示摘要，
          // 不能讓玩家看著「（無資料）」盲選（2026-07-09 使用者回報看不出是哪個存檔位在衝突）。
          return downloadRemote(slot).then(function (remoteObj) {
            return AFK_CLOUD.ui.showConflictModal({
              left: { title: '📱 本機存檔 ' + slot + '（觸發原因：' + reason + '）', summary: payload.summarize(obj) },
              right: { title: '☁️ 雲端存檔 ' + slot + '（已被別台裝置更新過）', summary: remoteObj ? payload.summarize(remoteObj) : null },
              leftLabel: '仍要用本機覆蓋（危險）',
              rightLabel: '使用雲端版本（套用到本機）',
              cancelLabel: '先不同步'
            }).then(function (choice) {
              if (choice === 'left') return doUpload(slot, obj, existing.id);
              if (choice === 'right') {
                if (remoteObj) payload.applyPayload(remoteObj, slot);
                AFK_CLOUD.ui.toast('已套用雲端版本到本機（存檔 ' + slot + '）。');
                return { ok: true, downloaded: true };
              }
              return { ok: false, cancelled: true };
            });
          });
        }
        return doUpload(slot, obj, existing.id);
      });
    }).catch(function (err) { return handleSyncError(err, reason); });
  }

  flow.syncUpload = function (reason) {
    if (!drive.isReady()) return Promise.resolve({ ok: false, reason: 'not-ready' });
    var slot = currentSlot;
    var obj = payload.buildPayload(slot);
    if (!obj) { console.log('[AFK-cloud-sync] 存檔位 ' + slot + ' 無資料，略過同步。'); return Promise.resolve({ ok: false, reason: 'no-data' }); }
    return uploadWithGuard(slot, obj, reason);
  };

  function downloadRemote(slot) {
    return findExisting(slot).then(function (existing) {
      if (!existing) return null;
      setFileId(slot, existing.id);
      return Promise.all([drive.downloadFile(existing.id), drive.getFileMeta(existing.id)]).then(function (r) {
        setLastRev(slot, r[1].headRevisionId || '');
        try { return JSON.parse(r[0]); } catch (e) { return null; }
      });
    });
  }

  flow.syncDownloadAndApply = function (slot) {
    return downloadRemote(slot).then(function (remoteObj) {
      if (remoteObj) payload.applyPayload(remoteObj, slot);
      return remoteObj;
    });
  };

  // 全新裝置的第一次還原：本機任何存檔位都沒有資料時，原作 openSlotSelect 在「載入進度」
  // 畫面會把空存檔位的按鈕直接 disabled（見 js/13-shop-save.js:294），玩家根本點不下去，
  // 導致 chooseSlot 攔截點永遠沒有機會觸發——所以另外開一條路：從雲端同步面板直接選存檔位
  // 還原，繞過原作的 disabled 限制。本機該存檔位若已有資料，一樣走共用衝突視窗二次確認。
  flow.restoreToSlot = function (slot) {
    if (!drive.isReady()) return Promise.resolve({ ok: false, reason: 'not-ready' });
    var localSummary = payload.summarizeFromSlot(slot);
    return downloadRemote(slot).then(function (remoteObj) {
      if (!remoteObj) { AFK_CLOUD.ui.toast('雲端沒有存檔位 ' + slot + ' 的資料'); return { ok: false, reason: 'no-remote' }; }
      if (!localSummary) {
        payload.applyPayload(remoteObj, slot);
        return { ok: true };
      }
      return AFK_CLOUD.ui.showConflictModal({
        left: { title: '📼 目前存檔位 ' + slot, summary: localSummary },
        right: { title: '☁️ 雲端存檔 ' + slot, summary: payload.summarize(remoteObj) },
        leftLabel: '保留本機（取消還原）',
        rightLabel: '用雲端覆蓋本機',
        cancelLabel: '取消'
      }).then(function (choice) {
        if (choice !== 'right') return { ok: false, cancelled: true };
        payload.applyPayload(remoteObj, slot);
        return { ok: true };
      });
    }).catch(function (err) { return handleSyncError(err, 'restore'); });
  };

  // 登入/載入完成後背景下載一次，純粹更新 lastKnownRev 快取，不套用、不跳視窗
  flow.backgroundDownloadPeek = function () {
    if (!drive.isReady()) return;
    downloadRemote(currentSlot).catch(function (err) { console.warn('[AFK-cloud-sync] 背景下載失敗:', err); });
  };

  flow.flushPendingUpload = function () {
    if (!_pendingUpload || !drive.isReady()) return;
    _pendingUpload = false;
    flow.syncUpload('flush-pending');
  };

  // chooseSlot 攔截點：載入存檔位前先跑雲端比對，回傳 { decision:'continue'|'use-remote'|'cancel', remote? }
  flow.preLoadCheck = function (slot) {
    if (!drive.isReady()) return Promise.resolve({ decision: 'continue' });
    return downloadRemote(slot).then(function (remoteObj) {
      if (!remoteObj) return { decision: 'continue' };
      var localSummary = payload.summarizeFromSlot(slot);
      var remoteSummary = payload.summarize(remoteObj);
      var cmp = conflict.compareForConflict(localSummary, remoteSummary);
      if (!cmp.needPrompt) return { decision: 'continue' };
      var maybePlaying = conflict.isRemoteMaybePlaying(remoteSummary, timesync.now());
      return AFK_CLOUD.ui.showConflictModal({
        left: { title: '📱 本機存檔 ' + slot, summary: localSummary },
        right: { title: '☁️ 雲端存檔 ' + slot, summary: remoteSummary },
        leftLabel: '使用本機存檔',
        rightLabel: '使用雲端存檔',
        cancelLabel: '取消，先不進入',
        warnRight: maybePlaying
      }).then(function (choice) {
        if (choice === 'right') return { decision: 'use-remote', remote: remoteObj };
        if (choice === 'left') return { decision: 'continue' };
        return { decision: 'cancel' };
      });
    }).catch(function (err) {
      console.warn('[AFK-cloud-sync] preLoadCheck 下載失敗，改用本機繼續:', err);
      return { decision: 'continue' };
    });
  };

  // 上傳單一存檔位：直接走 uploadWithGuard，沒有真的衝突(headRevisionId 不一致)就悄悄
  // 完成，只有偵測到別台裝置搶先寫入才跳視窗讓玩家選——不主動每次都跳視窗預覽
  // (2026-07-09 使用者實測後要求改回「有衝突才顯示版本選擇」，跳太多次視窗反而不方便)。
  flow.uploadSlot = function (slot) {
    if (!drive.isReady()) return Promise.resolve({ ok: false, reason: 'not-ready' });
    var obj = payload.buildPayload(slot);
    if (!obj) { AFK_CLOUD.ui.toast('存檔位 ' + slot + ' 沒有資料可以上傳'); return Promise.resolve({ ok: false, reason: 'no-data' }); }
    return uploadWithGuard(slot, obj, 'manual-slot-' + slot);
  };

  // 全部同步(上傳)：逐格呼叫 uploadSlot，同樣沒衝突就悄悄完成；真的遇到衝突那一格才
  // 跳視窗，不會像之前那樣每一格都跳一次(2026-07-09 使用者回報「一個畫面一個畫面跳出來
  // 很不方便」)。
  flow.syncAllSlots = function () {
    if (!drive.isReady()) return Promise.resolve({ ok: false, reason: 'not-ready' });
    var slots = [];
    for (var n = 1; n <= 8; n++) { if (payload.summarizeFromSlot(n)) slots.push(n); }
    if (!slots.length) { AFK_CLOUD.ui.toast('本機沒有任何存檔位有資料'); return Promise.resolve({ ok: false, reason: 'no-data' }); }
    var results = [];
    function next(i) {
      if (i >= slots.length) return Promise.resolve(results);
      return flow.uploadSlot(slots[i]).then(function (r) { results.push({ slot: slots[i], result: r }); return next(i + 1); });
    }
    return next(0).then(function () {
      var done = results.filter(function (r) { return r.result && r.result.ok; }).length;
      AFK_CLOUD.ui.toast('全部同步完成：' + done + ' / ' + slots.length + ' 個存檔位已處理');
      return { ok: true, results: results };
    });
  };

  // ===========================================================================
  // scheduler：同步觸發時機 + 節流（不持續 debounce，只在有意義的時間點才可能打 API）
  // ===========================================================================
  var scheduler = AFK_CLOUD.scheduler = {};
  var idleTimer = null;
  var lastRealUploadAt = 0;

  function requestUpload(reason, force) {
    if (!auth.isSignedIn()) return Promise.resolve({ ok: false, reason: 'not-signed-in' });
    var now = Date.now();
    if (!force && (now - lastRealUploadAt) < MIN_UPLOAD_INTERVAL_MS) {
      console.log('[AFK-cloud-sync] 節流：距上次同步未滿 ' + Math.round(MIN_UPLOAD_INTERVAL_MS / 1000) + ' 秒，暫不上傳（觸發原因=' + reason + '）。');
      return Promise.resolve({ ok: false, reason: 'throttled' });
    }
    lastRealUploadAt = now;
    return flow.syncUpload(reason);
  }

  scheduler.onSaveGame = function () {
    if (!auth.isSignedIn()) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { requestUpload('idle', false); }, IDLE_UPLOAD_AFTER_MS);
  };
  scheduler.onLoadGame = function () {
    try { flow.backgroundDownloadPeek(); } catch (e) {}
  };

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') requestUpload('visibilitychange-hidden', true);
  });
  window.addEventListener('beforeunload', function () { requestUpload('beforeunload', true); });
  window.addEventListener('pagehide', function () { requestUpload('pagehide', true); });
  window.addEventListener('online', function () { try { flow.flushPendingUpload(); } catch (e) {} });

  // ===========================================================================
  // ui：首頁設定選單入口 + 衝突視窗（左右卡片，供雲端同步/手動匯入共用）+ toast
  // ===========================================================================
  var ui = AFK_CLOUD.ui = {};

  function injectCss() {
    if (document.getElementById('afk-cloud-css')) return;
    var css = [
      /* 管理面板（登入/同步/登出） */
      '#afk-cloud-panel-modal{display:none;position:fixed;inset:0;z-index:1000;background:rgba(2,6,23,.78);align-items:center;justify-content:center;padding:20px;}',
      '#afk-cloud-panel-modal.open{display:flex;}',
      '#afk-cloud-panel-card{width:min(420px,94vw);background:#0f172a;border:1px solid #334155;border-radius:12px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);}',
      '#afk-cloud-panel-title{color:#fff;font-size:16px;font-weight:800;margin-bottom:12px;text-align:center;}',
      '#afk-cloud-panel-body{display:flex;flex-direction:column;gap:10px;align-items:stretch;}',
      '.afk-cloud-info{color:#cbd5e1;font-size:14px;text-align:center;word-break:break-all;}',
      '.afk-cloud-hint{color:#94a3b8;font-size:13px;text-align:center;line-height:1.6;}',
      /* 按鈕組：一律按鈕，不用 select；觸控目標 >=44px */
      '.afk-cloud-btn{min-height:44px;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:bold;font-family:inherit;cursor:pointer;border:1px solid #d97706;background:#b45309;color:#fff;}',
      '.afk-cloud-btn:active{background:#92400e;}',
      '.afk-cloud-btn:disabled{opacity:.5;cursor:not-allowed;}',
      '.afk-cloud-btn-secondary{border-color:#334155;background:#1e293b;color:#e2e8f0;}',
      '.afk-cloud-btn-secondary:active{background:#273449;}',
      '#afk-cloud-panel-close{display:block;width:100%;margin-top:14px;}',
      /* 同步狀態改條列式表格：手機寬度也要能塞下 4 欄，橫向捲動當保險(內容本來就窄不太需要捲) */
      '.afk-cloud-slot-table-wrap{overflow-x:auto;width:100%;}',
      '.afk-cloud-slot-table{width:100%;border-collapse:collapse;font-size:12.5px;}',
      '.afk-cloud-slot-table th{color:#94a3b8;font-weight:700;font-size:11px;text-align:left;padding:4px 5px;border-bottom:1px solid #334155;white-space:nowrap;}',
      '.afk-cloud-slot-table td{color:#e2e8f0;padding:6px 5px;border-bottom:1px solid #1e293b;vertical-align:middle;}',
      '.afk-cloud-slot-sub{color:#94a3b8;font-size:11px;}',
      /* 上傳/下載用不同顏色區分方向，觸控目標維持 >=36px */
      '.afk-cloud-slot-btn{min-width:36px;min-height:36px;padding:6px 8px;font-size:15px;}',
      '.afk-cloud-btn-upload{border-color:#d97706;background:#b45309;}',
      '.afk-cloud-btn-upload:active{background:#92400e;}',
      '.afk-cloud-btn-download{border-color:#0369a1;background:#0369a1;color:#fff;}',
      '.afk-cloud-btn-download:active{background:#075985;}',
      /* 衝突視窗（雲端同步下載衝突 / 手動匯入覆蓋共用） */
      '.afk-cloud-modal-overlay{position:fixed;inset:0;z-index:1002;background:rgba(2,6,23,.8);display:flex;align-items:center;justify-content:center;padding:16px;}',
      '.afk-cloud-modal-card{width:min(560px,96vw);max-height:90vh;overflow-y:auto;background:#0f172a;border:1px solid #334155;border-radius:14px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.6);}',
      '.afk-cloud-modal-cards{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;}',
      '.afk-cloud-card{flex:1 1 220px;background:#111c30;border:1px solid #1e293b;border-radius:10px;padding:12px;}',
      '.afk-cloud-card-title{color:#f8e7bb;font-weight:800;font-size:14px;margin-bottom:8px;}',
      '.afk-cloud-card-line{color:#e2e8f0;font-size:13.5px;line-height:1.7;}',
      '.afk-cloud-card-warn{margin-top:8px;color:#f87171;font-size:12.5px;font-weight:bold;line-height:1.6;}',
      '.afk-cloud-modal-actions{display:flex;flex-wrap:wrap;gap:8px;}',
      '.afk-cloud-choice-btn{flex:1 1 160px;}',
      /* toast（非阻斷，桌機手機共用，跟 afk-toast.js 的手機專用 toast 分開一個容器避免互相干擾） */
      '#afk-cloud-toast-wrap{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:99998;display:flex;flex-direction:column;gap:8px;width:min(92vw,420px);pointer-events:none;}',
      '#afk-cloud-toast-wrap .afk-cloud-toast{pointer-events:auto;background:rgba(15,23,42,.96);border:1px solid #334155;border-left:3px solid #38bdf8;border-radius:10px;padding:10px 14px;box-shadow:0 6px 20px rgba(0,0,0,.5);color:#e2e8f0;font-size:13.5px;line-height:1.5;word-break:break-word;opacity:0;transform:translateY(10px);transition:opacity .22s ease,transform .22s ease;}',
      '#afk-cloud-toast-wrap .afk-cloud-toast.in{opacity:1;transform:translateY(0);}'
    ].join('');
    var s = document.createElement('style');
    s.id = 'afk-cloud-css';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  // ----- toast（非阻斷提示，例如離線佇列訊息） -------------------------------
  ui.toast = function (msg) {
    injectCss();
    var wrap = document.getElementById('afk-cloud-toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'afk-cloud-toast-wrap'; document.body.appendChild(wrap); }
    var card = document.createElement('div');
    card.className = 'afk-cloud-toast';
    card.textContent = msg;
    wrap.appendChild(card);
    requestAnimationFrame(function () { card.classList.add('in'); });
    var killed = false;
    function kill() {
      if (killed) return;
      killed = true;
      card.classList.remove('in');
      setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, 300);
    }
    card.addEventListener('click', kill);
    setTimeout(kill, 4000);
  };

  // ----- 管理面板（登入/同步/登出）：掛進 afk-storage.js 的「⚙ 其他功能」選單 ----
  // 各存檔位的同步狀態改用條列式表格呈現(2026-07-09 使用者要求，卡片式排版太佔空間)；
  // 上傳/下載用不同顏色區分方向(橙=上傳／藍=下載)，一眼看得出兩顆鈕不是同一件事。
  // 只列本機有資料的存檔位，空存檔位不顯示、避免洗版。
  // 上傳/下載都直接執行，只有真的偵測到衝突(雲端被別台裝置搶先寫入／本機該存檔位已有
  // 資料要被下載覆蓋)才會跳視窗讓玩家選——不會平白每次都彈視窗(2026-07-09 使用者實測
  // 後要求改回「有衝突才顯示版本選擇」，逐格跳視窗太打斷操作)。
  function syncStatusListHTML() {
    var rows = '';
    for (var n = 1; n <= 8; n++) {
      var sum = slotSummary(n);
      if (!sum) continue;
      var ts = getLastSyncedAt(n);
      var isCurrent = (n === currentSlot);
      rows += '<tr>' +
        '<td>' + (isCurrent ? '👉' : '　') + '存檔' + n + '<br><span class="afk-cloud-slot-sub">' + esc(sum.cls) + ' Lv.' + esc(String(sum.lv)) +
          (sum.name ? '　' + esc(sum.name) : '') + '</span></td>' +
        '<td class="afk-cloud-slot-sub">' + esc(fmtTsShort(ts)) + '</td>' +
        '<td><button type="button" class="afk-cloud-btn afk-cloud-btn-upload afk-cloud-slot-btn" data-slot-up="' + n + '" title="上傳到雲端">⬆️</button></td>' +
        '<td><button type="button" class="afk-cloud-btn afk-cloud-btn-download afk-cloud-slot-btn" data-slot-down="' + n + '" title="從雲端下載">⬇️</button></td>' +
      '</tr>';
    }
    if (!rows) return '<div class="afk-cloud-hint">目前本機沒有任何存檔位有資料。</div>';
    return '<div class="afk-cloud-slot-table-wrap">' +
      '<table class="afk-cloud-slot-table"><thead><tr><th>存檔位</th><th>上次同步</th><th>⬆️上傳</th><th>⬇️下載</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function panelBodyHTML() {
    if (!auth.isSignedIn()) {
      return '<button type="button" class="afk-cloud-btn" id="afk-cloud-signin-btn">🔑 使用 Google 帳號登入雲端同步</button>' +
        '<div class="afk-cloud-hint">登入後，家用電腦／手機／筆電用同一個 Google 帳號登入即可自動同步進度。</div>';
    }
    return '<div class="afk-cloud-info">你好，' + esc(auth.getEmail()) + '</div>' +
      syncStatusListHTML() +
      '<div class="afk-cloud-hint">「⬆️」「⬇️」按下會直接同步；只有真的偵測到衝突(雲端被別台裝置更新過)才會跳視窗讓你選，不會平白打斷。</div>' +
      '<button type="button" class="afk-cloud-btn" id="afk-cloud-syncall-btn">🔁 全部同步（上傳全部存檔位）</button>' +
      '<button type="button" class="afk-cloud-btn afk-cloud-btn-secondary" id="afk-cloud-restore-btn">📥 從雲端還原到指定存檔位</button>' +
      '<div class="afk-cloud-hint">全新裝置第一次使用時，用這顆把雲端進度拉下來（原本「載入進度」畫面的空存檔位鈕會反灰點不了，所以另外開這條路）。</div>' +
      '<button type="button" class="afk-cloud-btn afk-cloud-btn-secondary" id="afk-cloud-signout-btn">登出</button>';
  }

  function buildPanel() {
    if (document.getElementById('afk-cloud-panel-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'afk-cloud-panel-modal';
    modal.innerHTML =
      '<div id="afk-cloud-panel-card">' +
        '<div id="afk-cloud-panel-title">☁️ 跨裝置雲端存檔同步</div>' +
        '<div id="afk-cloud-panel-body"></div>' +
        '<button type="button" id="afk-cloud-panel-close" class="afk-cloud-btn afk-cloud-btn-secondary">關閉</button>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closePanel(); });
    document.getElementById('afk-cloud-panel-close').addEventListener('click', closePanel);
  }

  var _panelLayer = null;
  function hidePanel() {
    var m = document.getElementById('afk-cloud-panel-modal');
    if (m) m.classList.remove('open');
    _panelLayer = null;
  }
  function closePanel() { if (_panelLayer && window.AFK_UI) AFK_UI.closeLayer(_panelLayer); else hidePanel(); }

  ui.refreshPanel = function () {
    var body = document.getElementById('afk-cloud-panel-body');
    if (!body) return;
    body.innerHTML = panelBodyHTML();
    var signinBtn = document.getElementById('afk-cloud-signin-btn');
    if (signinBtn) signinBtn.addEventListener('click', function () { auth.signIn(); });

    // ⬆️上傳：直接呼叫 flow.uploadSlot，沒衝突就悄悄完成；真的衝突才跳視窗(見該函式註解)。
    Array.prototype.forEach.call(body.querySelectorAll('[data-slot-up]'), function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var slot = +btn.getAttribute('data-slot-up');
        btn.disabled = true;
        setTimeout(function () { btn.disabled = false; }, MANUAL_SYNC_COOLDOWN_MS);
        ui.toast('上傳中…');
        flow.uploadSlot(slot).then(function (result) {
          if (result && result.ok) { ui.toast('✅ 存檔位 ' + slot + ' 已上傳'); ui.refreshPanel(); }
          else if (result && result.cancelled) ui.toast('已取消，未上傳');
          // 其餘失敗(離線/認證過期/一般錯誤)已由 handleSyncError 各自跳過 toast，這裡不重複
        });
      });
    });

    // ⬇️下載：直接呼叫 flow.restoreToSlot，本機該存檔位已有資料才會跳視窗二次確認
    // (下載方向本質是覆蓋本機、沒有備份可救，這一步不能省)，空存檔位則直接套用。
    Array.prototype.forEach.call(body.querySelectorAll('[data-slot-down]'), function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var slot = +btn.getAttribute('data-slot-down');
        btn.disabled = true;
        setTimeout(function () { btn.disabled = false; }, MANUAL_SYNC_COOLDOWN_MS);
        ui.toast('讀取雲端中…');
        flow.restoreToSlot(slot).then(function (result) {
          if (!result) return;
          if (result.ok) { ui.toast('✅ 已從雲端下載到存檔位 ' + slot); ui.refreshPanel(); }
          else if (result.reason === 'no-remote') { /* flow.restoreToSlot 已經自己 toast 過 */ }
          else if (result.cancelled) ui.toast('已取消，未下載');
        });
      });
    });

    var syncAllBtn = document.getElementById('afk-cloud-syncall-btn');
    if (syncAllBtn) syncAllBtn.addEventListener('click', function () {
      if (syncAllBtn.disabled) return;
      syncAllBtn.disabled = true;
      flow.syncAllSlots().then(function () {
        syncAllBtn.disabled = false;
        ui.refreshPanel();
      });
    });

    var restoreBtn = document.getElementById('afk-cloud-restore-btn');
    if (restoreBtn) restoreBtn.addEventListener('click', function () {
      ui.openSlotPicker().then(function (slot) {
        if (!slot) return;
        ui.toast('讀取雲端中…');
        flow.restoreToSlot(slot).then(function (result) {
          if (!result) return;
          if (result.ok) { ui.toast('✅ 已還原到存檔位 ' + slot + '，回主選單「載入進度」即可看到'); ui.refreshPanel(); }
          else if (result.reason === 'no-remote') { /* flow.restoreToSlot 已經自己 toast 過 */ }
          else if (result.cancelled) ui.toast('已取消，未還原');
        });
      });
    });
    var signoutBtn = document.getElementById('afk-cloud-signout-btn');
    if (signoutBtn) signoutBtn.addEventListener('click', function () { auth.signOut(); });
  };

  // 存檔位選擇器（1~8，按鈕組）：resolve 選中的存檔位號碼，取消則 resolve(null)
  ui.openSlotPicker = function () {
    injectCss();
    return new Promise(function (resolve) {
      var done = false;
      var overlay = document.createElement('div');
      overlay.className = 'afk-cloud-modal-overlay';
      var btnsHtml = '';
      for (var i = 1; i <= 8; i++) btnsHtml += '<button type="button" class="afk-cloud-btn afk-cloud-choice-btn" data-slot="' + i + '">存檔位 ' + i + '</button>';
      overlay.innerHTML =
        '<div class="afk-cloud-modal-card">' +
          '<div class="afk-cloud-card-title" style="text-align:center;margin-bottom:12px;">選擇要還原到哪個存檔位</div>' +
          '<div class="afk-cloud-modal-actions">' + btnsHtml +
            '<button type="button" class="afk-cloud-btn afk-cloud-btn-secondary afk-cloud-choice-btn" data-slot="0">取消</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      function finish(slot) {
        if (done) return;
        done = true;
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(slot || null);
      }
      var layer = window.AFK_UI ? AFK_UI.openLayer(function () { finish(null); }) : null;
      overlay.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('[data-slot]') : null;
        var slot = btn ? (+btn.getAttribute('data-slot') || null) : (e.target === overlay ? null : undefined);
        if (slot === undefined) return;
        finish(slot);
        if (layer && window.AFK_UI) AFK_UI.closeLayer(layer);
      });
    });
  };

  ui.openPanel = function () {
    injectCss();
    buildPanel();
    ui.refreshPanel();
    document.getElementById('afk-cloud-panel-modal').classList.add('open');
    _panelLayer = window.AFK_UI ? AFK_UI.openLayer(hidePanel) : null;
  };

  // ----- 衝突視窗（雲端同步下載衝突 / 手動匯入覆蓋共用；參數化 left/right，不寫死本機/雲端） ---
  function cardHTML(side, warn) {
    var s = side.summary;
    var body = s
      ? '<div class="afk-cloud-card-line">' + esc(s.cls) + ' Lv.' + esc(String(s.lv)) + (s.name ? '　' + esc(s.name) : '') + '</div>' +
        '<div class="afk-cloud-card-line">更新於：' + esc(fmtTs(s.ts)) + '</div>' +
        '<div class="afk-cloud-card-line">地點：' + esc(s.map || '未知') + '</div>'
      : '<div class="afk-cloud-card-line">（無資料）</div>';
    return '<div class="afk-cloud-card">' +
      '<div class="afk-cloud-card-title">' + esc(side.title) + '</div>' + body +
      (warn ? '<div class="afk-cloud-card-warn">⚠ 另一台裝置可能正在遊玩中，選它會蓋掉本機</div>' : '') +
      '</div>';
  }

  // opts: { left:{title,summary}, right:{title,summary}, leftLabel, rightLabel, cancelLabel, warnRight }
  // resolve 值："left" | "right" | "cancel"
  ui.showConflictModal = function (opts) {
    injectCss();
    return new Promise(function (resolve) {
      var done = false;
      var overlay = document.createElement('div');
      overlay.className = 'afk-cloud-modal-overlay';
      overlay.innerHTML =
        '<div class="afk-cloud-modal-card">' +
          '<div class="afk-cloud-modal-cards">' + cardHTML(opts.left, false) + cardHTML(opts.right, !!opts.warnRight) + '</div>' +
          '<div class="afk-cloud-modal-actions">' +
            '<button type="button" class="afk-cloud-btn afk-cloud-choice-btn" data-choice="left">' + esc(opts.leftLabel || '使用左側') + '</button>' +
            '<button type="button" class="afk-cloud-btn afk-cloud-choice-btn" data-choice="right">' + esc(opts.rightLabel || '使用右側') + '</button>' +
            '<button type="button" class="afk-cloud-btn afk-cloud-btn-secondary afk-cloud-choice-btn" data-choice="cancel">' + esc(opts.cancelLabel || '取消，先不同步') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      function finish(choice) {
        if (done) return;
        done = true;
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(choice);
      }
      var layer = window.AFK_UI ? AFK_UI.openLayer(function () { finish('cancel'); }) : null;
      overlay.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('[data-choice]') : null;
        var choice = btn ? btn.getAttribute('data-choice') : (e.target === overlay ? 'cancel' : null);
        if (!choice) return;
        finish(choice);   // 先 resolve（idempotent），再退歷史一格；layer 的 closeFn 之後才觸發也會被 done 擋掉
        if (layer && window.AFK_UI) AFK_UI.closeLayer(layer);
      });
    });
  };

  // ----- 掛進首頁「⚙ 其他功能」選單（由 afk-storage.js 渲染；CLIENT_ID 未設定時完全不出現） ---
  window.AFK_SETTINGS = window.AFK_SETTINGS || { _items: [], add: function (it) { this._items.push(it); } };
  AFK_SETTINGS.add({
    label: '☁️ 跨裝置雲端同步',
    visible: function () { return auth.isConfigured(); },
    onClick: ui.openPanel
  });

  // ===========================================================================
  // exportSave / importSave 補強：_afk 欄位（跟裝置綁定的 4 把輔助鍵）
  // ===========================================================================

  // exportSave() 內部在 _saveWrap() 簽章前才組完 JSON；用 _exportInFlight 旗標限定範圍，
  // 避免誤傷 saveGame()/06-status-allies.js 等其他共用 _saveWrap 的路徑。
  var _exportInFlight = false;
  var _saveWrapOrig = window._saveWrap;
  window._saveWrap = function (jsonStr) {
    if (_exportInFlight) {
      try {
        var o = JSON.parse(jsonStr);
        o._afk = payload.readAfkKeys(currentSlot);
        jsonStr = JSON.stringify(o);
      } catch (e) { console.warn('[AFK-cloud-sync] 匯出檔夾帶 _afk 欄位失敗:', e); }
    }
    return _saveWrapOrig.call(this, jsonStr);
  };
  var _exportSaveOrig = window.exportSave;
  window.exportSave = async function () {
    _exportInFlight = true;
    try { return await _exportSaveOrig.apply(this, arguments); }
    finally { _exportInFlight = false; }
  };

  // importSave() 邏輯發生在 FileReader.onload 回呼內部，前後置 hook 插不進去，整段覆蓋
  // （邏輯照抄 js/13-shop-save.js:369，只加：① 覆蓋現有存檔位時改走共用衝突視窗 ② 還原/
  // 相容處理 _afk 欄位）。原作者更新這兩支函式時要重新核對，見 CLAUDE.md 同步 SOP 補一條。
  window.importSave = function (n) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = async function () {
        var _raw = String(reader.result || '');
        var _u = _saveUnwrap(_raw);
        if (_u.signed && !_u.ok) { alert('匯入失敗：檔案完整性校驗未通過，可能已被竄改。'); return; }
        if (!_u.signed && !confirm('此存檔檔案沒有完整性簽章（可能來自舊版本，或被外部修改/移除簽章）。\n仍要匯入嗎？')) return;
        var text = _u.payload;
        var d;
        try { d = JSON.parse(text); }
        catch (e) { alert('匯入失敗：檔案不是有效的存檔（JSON 解析錯誤）。'); return; }
        if (!d || typeof d !== 'object' || !d.p || typeof d.p !== 'object' || !d.p.cls) {
          alert('匯入失敗：檔案內容不是有效的放置天堂存檔。'); return;
        }
        var existing = slotSummary(n);
        if (existing) {
          var localSummary = payload.summarizeFromSlot(n);
          var importSummary = payload.summarize({ save: d, wh: d.wh, afk: d._afk || null });
          var choice = await ui.showConflictModal({
            left: { title: '📼 目前存檔位 ' + n, summary: localSummary },
            right: { title: '📥 匯入檔案', summary: importSummary },
            leftLabel: '保留目前存檔（取消匯入）',
            rightLabel: '用匯入檔覆蓋',
            cancelLabel: '取消'
          });
          if (choice !== 'right') return;
        }
        // 抽出倉庫 + _afk，寫入存檔位時都不保留這兩個附加欄位
        var whData = d.wh;
        var saveText = text;
        if (whData !== undefined || d._afk !== undefined) {
          var _c = {};
          for (var k in d) { if (k !== 'wh' && k !== '_afk') _c[k] = d[k]; }
          saveText = JSON.stringify(_c);
        }
        var cur = _lsGet('lineage_idle_save_' + n);
        if (cur) _lsSet('lineage_idle_save_' + n + '_bak', cur);
        _lzSet('lineage_idle_save_' + n, _saveWrap(saveText));
        var whMsg = '';
        if (whData !== undefined) {
          var _cnt = (whData.items && whData.items.length) || 0;
          var _gold = whData.gold || 0;
          if (confirm('此匯入檔包含倉庫資料（物品 ' + _cnt + ' 項、金幣 ' + _gold.toLocaleString() + '）。\n是否一併還原倉庫？\n⚠ 會覆蓋該角色所屬模式（' + ((d.p && d.p.classicMode) ? '經典' : '非經典') + '）的共用倉庫。')) {
            _lzSet(whKey(d.p), JSON.stringify({ items: whData.items || [], gold: whData.gold || 0 }));
            whMsg = '\n倉庫已一併還原。';
          } else {
            whMsg = '\n（倉庫維持原狀，未還原）';
          }
        }
        // _afk 還原（新版匯出檔）或相容處理（舊版匯出檔沒有這個欄位）
        var afkMsg = '';
        if (d._afk) {
          payload.writeAfkKeys(n, d._afk);
        } else {
          payload.writeAfkKeys(n, { ts: Date.now(), map: '', pride: null, obl: null });
          afkMsg = '\n⚠ 這份匯出檔較舊（不含掛機同步資訊），這次匯入後不會結算離線收益。';
        }
        openSlotSelect(_slotMode);   // 重新整理存檔位清單（更新名稱/等級與可載入狀態）
        var ns = slotSummary(n);
        alert('已匯入到存檔 ' + n + '：' + (ns ? (ns.cls + ' Lv.' + ns.lv + '　' + ns.name) : '完成') + '。' + (cur ? '\n（原存檔已自動備份，可點「復原備份」還原）' : '') + whMsg + afkMsg);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // ===========================================================================
  // 疊加 monkey-patch：saveGame / loadGame / chooseSlot
  //   （必須排在 afk-offline.js 之後載入，接在它已包好的版本外面再包一層，只做觀察
  //    不做決策覆蓋；chooseSlot 判斷是否要攔截載入流程走雲端衝突比對）
  // ===========================================================================
  var _saveGameOrig = window.saveGame;
  window.saveGame = function () {
    var r = _saveGameOrig.apply(this, arguments);
    try { scheduler.onSaveGame(); } catch (e) {}
    return r;
  };
  var _loadGameOrig = window.loadGame;
  window.loadGame = function () {
    var r = _loadGameOrig.apply(this, arguments);
    try { scheduler.onLoadGame(); } catch (e) {}
    return r;
  };
  // _slotMode 是 js/13-shop-save.js 的 top-level let，不是 window 屬性，但同頁其他
  // classic script 可用「裸識別字」直接讀（跟 afk-offline.js 讀 state/player/currentSlot
  // 同一招），不可寫成 window._slotMode（永遠 undefined，是本專案踩過的已知陷阱）。
  var _chooseSlotOrig = window.chooseSlot;
  window.chooseSlot = function (n) {
    if (_slotMode !== 'load' || !auth.isSignedIn()) {
      return _chooseSlotOrig.apply(this, arguments);
    }
    flow.preLoadCheck(n).then(function (result) {
      if (result.decision === 'use-remote' && result.remote) payload.applyPayload(result.remote, n);
      if (result.decision !== 'cancel') _chooseSlotOrig.call(window, n);
    });
  };

  try { auth.tryRestoreSession(); } catch (e) {}   // 玩家上次登入過就靜默恢復，不用每次重整都重新登入

  console.log('[AFK-cloud-sync] hooks OK — ' + (auth.isConfigured() ? '已設定 Client ID' : '尚未設定 Client ID，僅 exportSave/importSave 補強生效') + '。');
})();
