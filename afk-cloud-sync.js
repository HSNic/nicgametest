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
  var DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  // 測試白名單 email（小寫比對）：家人各自帳號直接加進這個陣列即可，例如 ['a@gmail.com','b@gmail.com']。
  //   ⚠ 這是「我們自己的」第二層白名單，跟 Google Cloud Console 的 OAuth 同意畫面「測試使用者」名單是
  //   兩件事，兩邊都要加同一批 email 才能登入成功（Console 那邊沒加會直接被 Google 擋在同意畫面前）。
  var WHITELIST = ['dioyang59@gmail.com'];
  var HEARTBEAT_FRESH_MS = 2 * 60 * 1000;      // 「可能正在遊玩中」門檻：心跳在幾毫秒內算新鮮（使用者已確認 2 分鐘）
  var MIN_UPLOAD_INTERVAL_MS = 4 * 60 * 1000;  // 節流：距上次真正打雲端 API 至少要隔這麼久（Gemini 建議採納）
  var IDLE_UPLOAD_AFTER_MS = 5 * 60 * 1000;    // 幾分鐘沒有新的 saveGame() 呼叫才觸發一次補傳
  var MANUAL_SYNC_COOLDOWN_MS = 8 * 1000;      // 手動同步按鈕 cooldown（防連點）

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
  auth.isWhitelisted = function (email) {
    if (!email) return false;
    return WHITELIST.indexOf(String(email).toLowerCase()) !== -1;
  };
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
  function requestToken(promptMode) {
    return ensureTokenClient().then(function (tc) {
      return new Promise(function (resolve, reject) {
        tc.callback = function (resp) {
          if (!resp || resp.error) { reject(new Error((resp && resp.error) || '登入被取消或失敗')); return; }
          _accessToken = resp.access_token;
          _tokenExpiresAt = Date.now() + ((resp.expires_in ? +resp.expires_in : 3500) * 1000);
          resolve(_accessToken);
        };
        try { tc.requestAccessToken({ prompt: promptMode }); }
        catch (e) { reject(e); }
      });
    });
  }

  // 供 drive 模組取用；快取未過期直接回傳，否則先嘗試不彈窗的靜默續期（背景呼叫用 'none'，
  // 呼叫端若是使用者主動點擊(立即同步/登入)已經是 user gesture，過期時退回互動式('')重新登入）。
  auth.getAccessToken = function (interactive) {
    if (_accessToken && Date.now() < _tokenExpiresAt - 60000) return Promise.resolve(_accessToken);
    return requestToken(interactive ? '' : 'none');
  };

  function fetchUserInfo(token) {
    return fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) { if (!r.ok) throw new Error('讀取帳號資訊失敗'); return r.json(); });
  }

  auth.signIn = function () {
    if (!auth.isConfigured()) { AFK_CLOUD.ui.toast('雲端同步尚未開放（尚未設定 Google Client ID）'); return; }
    requestToken('').then(function (token) {
      return fetchUserInfo(token).then(function (info) {
        var email = info.email || '';
        if (!auth.isWhitelisted(email)) {
          _signedIn = false; _userEmail = '';
          AFK_CLOUD.ui.toast('此測試版僅開放特定帳號，你的帳號（' + email + '）尚未加入白名單。');
          try { google.accounts.oauth2.revoke(token, function () {}); } catch (e) {}
          auth._invalidateToken();
          return;
        }
        _signedIn = true; _userEmail = email;
        AFK_CLOUD.ui.refreshPanel();
        AFK_CLOUD.ui.toast('已登入：' + email);
        try { AFK_CLOUD.scheduler.onLoadGame(); } catch (e) {}
      });
    }).catch(function (err) {
      AFK_CLOUD.ui.toast('登入失敗：' + (err && err.message ? err.message : String(err)));
    });
  };

  auth.signOut = function () {
    if (_accessToken) { try { google.accounts.oauth2.revoke(_accessToken, function () {}); } catch (e) {} }
    auth._invalidateToken();
    _signedIn = false; _userEmail = '';
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

  function makeErr(kind, msg) { var e = new Error(msg); e.kind = kind; return e; }

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
      if (!res.ok) throw makeErr('unknown', 'Drive 讀取檔案資訊失敗（' + res.status + '）');
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

  function findExisting(slot) {
    var fid = getFileId(slot);
    if (fid) return Promise.resolve({ id: fid });
    return drive.findFile(slot);
  }

  function doUpload(slot, obj, fileId) {
    return drive.uploadFile({ fileId: fileId, name: drive.fileNameFor(slot), content: JSON.stringify(obj) }).then(function (res) {
      setFileId(slot, res.id);
      setLastRev(slot, res.headRevisionId || '');
      console.log('[AFK-cloud-sync] 上傳成功（slot ' + slot + '）。');
    });
  }

  function handleSyncError(err, reason) {
    if (err && err.kind === 'network') { _pendingUpload = true; AFK_CLOUD.ui.toast('離線中，恢復連線後自動補傳存檔'); }
    else if (err && err.kind === 'auth') { AFK_CLOUD.ui.toast('登入已過期，請重新點擊「立即同步」重新登入'); }
    else console.warn('[AFK-cloud-sync] 同步失敗（' + reason + '）:', err);
  }

  function uploadWithGuard(slot, obj, reason) {
    return findExisting(slot).then(function (existing) {
      if (!existing) return doUpload(slot, obj, null);
      setFileId(slot, existing.id);
      return drive.getFileMeta(existing.id).then(function (meta) {
        var lastKnown = getLastRev(slot);
        if (lastKnown && meta.headRevisionId && meta.headRevisionId !== lastKnown) {
          // 別台裝置搶先寫入：不覆蓋，跳警告讓玩家決定
          return AFK_CLOUD.ui.showConflictModal({
            left: { title: '📱 本機（觸發原因：' + reason + '）', summary: payload.summarize(obj) },
            right: { title: '☁️ 雲端目前內容（已被別台裝置更新過）', summary: null },
            leftLabel: '仍要覆蓋（危險）',
            rightLabel: '先下載雲端最新版',
            cancelLabel: '先不同步'
          }).then(function (choice) {
            if (choice === 'left') return doUpload(slot, obj, existing.id);
            if (choice === 'right') return flow.syncDownloadAndApply(slot).then(function () { AFK_CLOUD.ui.toast('已下載雲端最新版並套用到本機。'); });
            return null;
          });
        }
        return doUpload(slot, obj, existing.id);
      });
    }).catch(function (err) { handleSyncError(err, reason); });
  }

  flow.syncUpload = function (reason) {
    if (!drive.isReady()) return Promise.resolve();
    var slot = currentSlot;
    var obj = payload.buildPayload(slot);
    if (!obj) { console.log('[AFK-cloud-sync] 存檔位 ' + slot + ' 無資料，略過同步。'); return Promise.resolve(); }
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
        right: { title: '☁️ 雲端存檔', summary: remoteSummary },
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

  // ===========================================================================
  // scheduler：同步觸發時機 + 節流（不持續 debounce，只在有意義的時間點才可能打 API）
  // ===========================================================================
  var scheduler = AFK_CLOUD.scheduler = {};
  var idleTimer = null;

  function requestUpload(reason, force) {
    if (!auth.isSignedIn()) return;
    var now = Date.now();
    if (!force && (now - lastRealUploadAt) < MIN_UPLOAD_INTERVAL_MS) {
      console.log('[AFK-cloud-sync] 節流：距上次同步未滿 ' + Math.round(MIN_UPLOAD_INTERVAL_MS / 1000) + ' 秒，暫不上傳（觸發原因=' + reason + '）。');
      return;
    }
    lastRealUploadAt = now;
    flow.syncUpload(reason);
  }

  scheduler.onSaveGame = function () {
    if (!auth.isSignedIn()) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { requestUpload('idle', false); }, IDLE_UPLOAD_AFTER_MS);
  };
  scheduler.onLoadGame = function () {
    try { flow.backgroundDownloadPeek(); } catch (e) {}
  };
  // 手動同步鈕：一律視為「一次性、必須做」，略過節流，但按鈕本身要有 cooldown 防連點
  scheduler.manualSync = function (btn) {
    if (btn) {
      if (btn.disabled) return;
      btn.disabled = true;
      setTimeout(function () { btn.disabled = false; }, MANUAL_SYNC_COOLDOWN_MS);
    }
    requestUpload('manual', true);
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
      '#afk-cloud-panel-card{width:min(380px,94vw);background:#0f172a;border:1px solid #334155;border-radius:12px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);}',
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
  function panelBodyHTML() {
    if (!auth.isSignedIn()) {
      return '<button type="button" class="afk-cloud-btn" id="afk-cloud-signin-btn">🔑 使用 Google 帳號登入雲端同步</button>' +
        '<div class="afk-cloud-hint">登入後，家用電腦／手機／筆電用同一個 Google 帳號登入即可自動同步進度。</div>';
    }
    return '<div class="afk-cloud-info">你好，' + esc(auth.getEmail()) + '</div>' +
      '<button type="button" class="afk-cloud-btn" id="afk-cloud-sync-btn">☁️ 立即同步</button>' +
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
    var syncBtn = document.getElementById('afk-cloud-sync-btn');
    if (syncBtn) syncBtn.addEventListener('click', function () { scheduler.manualSync(syncBtn); ui.toast('已觸發同步'); });
    var signoutBtn = document.getElementById('afk-cloud-signout-btn');
    if (signoutBtn) signoutBtn.addEventListener('click', function () { auth.signOut(); });
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

  console.log('[AFK-cloud-sync] hooks OK — ' + (auth.isConfigured() ? '已設定 Client ID' : '尚未設定 Client ID，僅 exportSave/importSave 補強生效') + '。');
})();
