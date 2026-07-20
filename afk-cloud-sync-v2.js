/* ============================================================================
 * afk-cloud-sync-v2.js — 跨裝置雲端存檔同步（配對碼 + 後端代管，取代舊版 Google 登入方案）
 *
 * 設計依據：Lineage/待辦-ClaudeCode/2026-07-09_配對碼雲端存檔同步規格(取代0708版Google登入方案).md
 * 舊版（Google 帳號登入 + 前端直打 Drive API）已停用於 afk-cloud-sync.js.disabled，
 * 兩份文件/兩支外掛設計思路不同，不要混用；本檔沿用舊版已驗證過的部分邏輯
 *（payload 打包/還原、finish-before-closeLayer 順序鐵則）。
 *
 * 2026-07-09 使用者明訂兩條規則：
 *   1. **純手動**——正常存檔/讀檔/關閉分頁/登出完全不碰雲端，只有玩家主動按「產生配對碼」
 *      「使用配對碼」「立即上傳」「立即下載」這幾顆按鈕時才會真的連網。不攔截
 *      saveGame/loadGame/chooseSlot，不掛 visibilitychange/beforeunload/pagehide 自動上傳。
 *   2. **一個配對碼＝這個玩家帳號的所有存檔位(1~8)**，不綁定單一存檔位——雲端存一份
 *      「整包文件」（key 是存檔位號碼），上傳/下載都會處理本機所有有資料的存檔位；
 *      雲端上「本機沒有、別台裝置才有」的存檔位不會被上傳動作誤刪，下載時才會拉下來。
 *
 * 玩家不需要登入 Google 帳號，身分綁定＝瀏覽器 localStorage 記住的一組配對碼；換瀏覽器/
 * 清除資料要手動輸入回配對碼，畫面上會提示這個風險。
 *
 * 掛接：在 index.html 的 </body> 前加一行 <script src="afk-cloud-sync-v2.js"></script>，
 *   必須排在 afk-fixes.js、afk-ui.js（共用 Modal 管理器）、afk-storage.js（⚙ 其他功能選單）之後。
 * ========================================================================== */
(function () {
  'use strict';

  // ----- 可調參數 -------------------------------------------------------------
  // 部署好 Cloud Run 服務後，把網址填進來（例如 'https://afk-cloud-sync-xxxx-uc.a.run.app'）。
  // 留空時整支外掛對遊戲行為零介入：不掛選單、不攔截任何流程，安靜停用。
  var API_BASE = 'https://cloud-sync-backend-452592311770.asia-east1.run.app';
  var CODE_KEY = 'afk_cloud2_code';          // 玩家的配對碼
  var VER_KEY = 'afk_cloud2_version';        // 最後一次讀取/寫入成功時的雲端整包文件 version（樂觀鎖用）
  var HASH_KEY = 'afk_cloud2_hash';          // 對應 VER_KEY 的雲端內容雜湊
  var SYNCED_AT_KEY = 'afk_cloud2_synced_at';
  var FETCH_TIMEOUT_MS = 22000;   // 🔧 Bug E:12 秒常在 Cloud Run 冷啟動時不夠(OAuth2 換 token + 多次 Drive API 往返疊加),拉長到 22 秒降低第一次上傳就逾時失敗的機率

  // ----- 自我檢查：核心掛點都在才啟用，否則安靜退出（遊戲照常運作） ----------
  if (typeof window.slotSummary !== 'function' ||
      typeof window.whKey !== 'function' ||
      typeof window._lzGet !== 'function' ||
      typeof window._lzSet !== 'function' ||
      typeof window._saveWrap !== 'function' ||
      typeof window._saveUnwrap !== 'function') {
    console.warn('[AFK-cloud-sync-v2] 缺少核心掛點（slotSummary/whKey/_lzGet/...），雲端同步功能停用。');
    return;
  }

  var AFK_CLOUD2 = (window.AFK_CLOUD = window.AFK_CLOUD || {});   // 沿用同一個全域掛點名，方便 afk-mobile.js 既有的死碼掛勾重新生效
  AFK_CLOUD2.v2 = true;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmtTsShort(ts) {
    if (!ts) return '尚未同步過';
    try { var d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
    catch (e) { return '未知'; }
  }
  function getStr(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function setStr(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  function getNum(k) { try { return +localStorage.getItem(k) || 0; } catch (e) { return 0; } }

  var cfg = AFK_CLOUD2.cfg = {};
  cfg.isConfigured = function () { return !!API_BASE; };
  cfg.getCode = function () { return getStr(CODE_KEY); };
  cfg.hasPairing = function () { return !!cfg.getCode(); };
  cfg.getVersion = function () { return getNum(VER_KEY); };
  cfg.getSyncedAt = function () { return getNum(SYNCED_AT_KEY); };
  cfg.rememberSync = function (version, hash) {
    setStr(VER_KEY, String(version || 0));
    setStr(HASH_KEY, hash || '');
    setStr(SYNCED_AT_KEY, String(Date.now()));
  };
  cfg.clearPairing = function () {
    setStr(CODE_KEY, ''); setStr(VER_KEY, ''); setStr(HASH_KEY, ''); setStr(SYNCED_AT_KEY, '');
  };
  cfg.setPairing = function (code) {
    setStr(CODE_KEY, code); setStr(VER_KEY, ''); setStr(HASH_KEY, ''); setStr(SYNCED_AT_KEY, '');
  };

  // ===========================================================================
  // payload：打包/還原「單一存檔位 + 倉庫 + 4 把裝置綁定輔助鍵」，以及整包多存檔位文件
  // ===========================================================================
  var payload = AFK_CLOUD2.payload = {};
  var CLASS_NAME = { knight: '騎士', mage: '法師', elf: '妖精', dark: '黑暗妖精', illusion: '幻術士', dragon: '龍騎士', warrior: '戰士', royal: '王族' };

  function afkKeyNames(slot) { return { ts: 'afk_ts_' + slot, map: 'afk_map_' + slot, pride: 'afk_pride_' + slot, obl: 'afk_obl_' + slot }; }

  payload.readAfkKeys = function (slot) {
    var k = afkKeyNames(slot);
    var out = { ts: 0, map: '', pride: null, obl: null };
    try { out.ts = +localStorage.getItem(k.ts) || 0; } catch (e) {}
    try { out.map = localStorage.getItem(k.map) || ''; } catch (e) {}
    try { var p = localStorage.getItem(k.pride); out.pride = p ? JSON.parse(p) : null; } catch (e) {}
    try { var o = localStorage.getItem(k.obl); out.obl = o ? JSON.parse(o) : null; } catch (e) {}
    return out;
  };
  payload.writeAfkKeys = function (slot, afk) {
    var k = afkKeyNames(slot);
    try {
      if (afk && afk.ts) localStorage.setItem(k.ts, String(afk.ts)); else localStorage.removeItem(k.ts);
      if (afk && afk.map) localStorage.setItem(k.map, afk.map); else localStorage.removeItem(k.map);
      if (afk && afk.pride) localStorage.setItem(k.pride, JSON.stringify(afk.pride)); else localStorage.removeItem(k.pride);
      if (afk && afk.obl) localStorage.setItem(k.obl, JSON.stringify(afk.obl)); else localStorage.removeItem(k.obl);
    } catch (e) { console.warn('[AFK-cloud-sync-v2] writeAfkKeys 失敗:', e); }
  };

  payload.buildPayload = function (slot) {
    var raw = _lzGet('lineage_idle_save_' + slot);
    if (!raw) return null;
    var u = _saveUnwrap(raw);
    if (!u.ok) { console.warn('[AFK-cloud-sync-v2] 存檔簽章不符，略過打包（slot ' + slot + '）。'); return null; }
    var d;
    try { d = JSON.parse(u.payload); } catch (e) { return null; }
    if (!d || !d.p) return null;
    var wh = null;
    try { var whRaw = _lzGet(whKey(d.p)); wh = whRaw ? JSON.parse(whRaw) : null; } catch (e) {}
    return { slot: slot, save: d, wh: wh, afk: payload.readAfkKeys(slot), packedAt: Date.now() };
  };

  payload.applyPayload = function (obj, slot) {
    if (!obj || !obj.save) return false;
    try {
      _lzSet('lineage_idle_save_' + slot, _saveWrap(JSON.stringify(obj.save)));
      if (obj.wh) _lzSet(whKey(obj.save.p), JSON.stringify(obj.wh));
      payload.writeAfkKeys(slot, obj.afk);
      return true;
    } catch (e) { console.warn('[AFK-cloud-sync-v2] applyPayload 失敗:', e); return false; }
  };

  // 套用「整包多存檔位文件」裡的其中一個存檔位（存檔+afk輔助鍵+對應倉庫，倉庫從 doc.warehouses
  // 依 whKey(save.p) 查表取得，因為文件裡倉庫是去重過的，不是每個存檔位各存一份）
  payload.applySlotFromDoc = function (slot, doc) {
    var entry = doc && doc.slots && doc.slots[String(slot)];
    if (!entry || !entry.save) return false;
    try {
      _lzSet('lineage_idle_save_' + slot, _saveWrap(JSON.stringify(entry.save)));
      payload.writeAfkKeys(slot, entry.afk);
      var key = whKey(entry.save.p);
      var wh = doc.warehouses && doc.warehouses[key];
      if (wh) _lzSet(key, JSON.stringify(wh));
      return true;
    } catch (e) { console.warn('[AFK-cloud-sync-v2] applySlotFromDoc 失敗:', e); return false; }
  };

  payload.summarize = function (obj) {
    if (!obj || !obj.save || !obj.save.p) return null;
    var p = obj.save.p;
    return { cls: CLASS_NAME[p.cls] || p.cls || '?', lv: p.lv || 1, name: p.name || '', ts: (obj.afk && obj.afk.ts) || 0, map: (obj.afk && obj.afk.map) || '' };
  };
  payload.summarizeFromSlot = function (slot) { return payload.summarize(payload.buildPayload(slot)); };

  // 本機所有「有資料」的存檔位號碼（1~8）
  payload.localSlotNumbers = function () {
    var arr = [];
    for (var n = 1; n <= 8; n++) { if (slotSummary(n)) arr.push(n); }
    return arr;
  };

  // 打包本機所有有資料的存檔位成一份整包文件：{ slots: { "1": {slot,save,afk,packedAt}, ... },
  //   warehouses: { "<whKey>": whObj, ... } }。
  // 倉庫依模式共用（同模式的存檔位共用同一份倉庫），去重存一份、slot 內不重複內嵌，
  // 避免多個存檔位共用同一份倉庫時被原封不動複製 N 份，把上傳內容撐爆 413（踩過 2026-07-09）。
  payload.buildAllSlotsDoc = function () {
    var slots = {};
    var warehouses = {};
    payload.localSlotNumbers().forEach(function (n) {
      var obj = payload.buildPayload(n);
      if (!obj) return;
      var key = whKey(obj.save.p);
      if (obj.wh) warehouses[key] = obj.wh;
      slots[String(n)] = { slot: obj.slot, save: obj.save, afk: obj.afk, packedAt: obj.packedAt };
    });
    return { slots: slots, warehouses: warehouses, clan: payload.readClan(), pets: payload.readPets() };
  };

  // 血盟資料（js/25-clan-system.js，2026-07-19 隨 v3.6.03 新增）是「帳號共用桶」，不屬於任何
  // 單一存檔位，跟著整包文件走一份即可，不用逐 slot 重複打包。舊版外掛(還沒有血盟系統)/讀取失敗
  // 一律安全回傳 null，上傳/合併時視為「沒有血盟資料」，不影響其餘同步流程。
  payload.readClan = function () {
    if (typeof _clanReadStateResult !== 'function') return null;
    try { var r = _clanReadStateResult(); return r.ok ? r.state : null; } catch (e) { return null; }
  };
  payload.writeClan = function (state) {
    if (!state || typeof _clanWriteState !== 'function') return;
    try { _clanWriteState(state); } catch (e) { console.warn('[AFK-cloud-sync-v2] writeClan 失敗:', e); }
  };

  // 血盟資料合併(不是覆蓋)：members{} 是「同帳號多個角色」各自的貢獻紀錄，換裝置/上傳衝突時
  // 單純比大小的時間戳覆蓋會讓其中一台裝置已經存到的進度憑空消失，改成逐欄位取「不會讓進度倒退」
  // 的合併結果(2026-07-20 依 codex 複核意見定案):
  //   - xp / 每位成員 contribution：取兩邊較大值(不可能靠合併精準還原「這段時間各自貢獻了多少」，
  //     取較大值是「絕不倒退」的保守解，代價是極端情況下重複計入的貢獻不會被扣掉，可接受)。
  //   - 只有其中一邊有的成員：整筆保留，不因為另一邊沒有就被視為要刪除。
  //   - buffOn/buffAt：整筆採用 buffAt 較新的那一側(能表達「buff 已被較新的裝置關閉/到期」這種狀態，
  //     不是 buffOn/buffAt 分開各自取值)。
  //   - modes.normal/modes.classic：兩邊都有各自的創立紀錄且不是同一個血盟(名稱或創始人不同)時，
  //     保留本機這份(不無聲蓋掉，只是先不強制二選一)，但印出警告(含模式/本機名稱/雲端名稱)方便事後追查。
  function clanMergeStates(local, remote) {
    if (!remote) return null;     // 雲端沒有血盟資料(舊文件/從沒上傳過)，沒東西可合併
    if (!local) return remote;    // 本機沒有(血盟系統剛裝上/讀取失敗)，直接採用雲端
    var out = {
      v: 1,
      xp: Math.max(local.xp || 0, remote.xp || 0),
      modes: { normal: null, classic: null },
      members: {},
      updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0)
    };
    ['normal', 'classic'].forEach(function (mk) {
      var lm = local.modes && local.modes[mk];
      var rm = remote.modes && remote.modes[mk];
      if (lm && rm) {
        if (lm.name !== rm.name || lm.leaderId !== rm.leaderId) {
          console.warn('[AFK-cloud-sync-v2] 血盟合併衝突(模式=' + mk + ')：本機=「' + lm.name + '」、雲端=「' + rm.name + '」，已保留本機這份，未自動二選一。');
          out.modes[mk] = lm;
        } else {
          // 同一個血盟(名稱+創始人相同)：castle(佔領城堡)沒有各自獨立的時間戳可比較，
          // 用整份血盟資料的 updatedAt(哪邊比較晚寫入)當判斷依據——攻城/棄守都會讓 updatedAt 更新，
          // 這樣才不會漏掉「另一台裝置後來才打下/丟掉城堡」這件事(2026-07-20 依使用者要求補齊)。
          out.modes[mk] = (remote.updatedAt || 0) > (local.updatedAt || 0) ? rm : lm;
        }
      } else {
        out.modes[mk] = lm || rm || null;
      }
    });
    var ids = {};
    Object.keys(local.members || {}).forEach(function (k) { ids[k] = 1; });
    Object.keys(remote.members || {}).forEach(function (k) { ids[k] = 1; });
    Object.keys(ids).forEach(function (id) {
      var lm = (local.members || {})[id];
      var rm = (remote.members || {})[id];
      if (lm && !rm) { out.members[id] = lm; return; }
      if (rm && !lm) { out.members[id] = rm; return; }
      var newer = (rm.buffAt || 0) > (lm.buffAt || 0) ? rm : lm;
      out.members[id] = {
        mode: newer.mode,
        contribution: Math.max(lm.contribution || 0, rm.contribution || 0),
        buffOn: newer.buffOn,
        buffAt: newer.buffAt
      };
    });
    return out;
  }

  // 寵物保管（js/22-pets.js）也是「帳號共用桶」——不屬於任何單一存檔位，分「一般模式/經典模式」
  // 兩個桶（key 分別是 fb5_pet_roster、fb5_pet_roster_classic）。2026-07-20 發現整包同步一直漏掉
  // 這塊，換裝置下載後寵物保管會整個是空的（本機從沒有這兩把 key，跟血盟資料先前漏掉是同一類問題）。
  // 直接重用 js/22-pets.js 已有的桶讀寫函式（純 key 參數、不依賴目前是否已登入角色），不用自己重寫存讀邏輯；
  // 讀取失敗/舊版外掛(還沒有寵物系統)一律安全回傳 null，視為「沒有寵物資料」，不影響其餘同步流程。
  var PET_MODE_SUFFIXES = ['', '_classic'];
  payload.readPets = function () {
    if (typeof _petRosterRead !== 'function') return null;
    var buckets = {}; var any = false;
    PET_MODE_SUFFIXES.forEach(function (sfx) {
      var key = 'fb5_pet_roster' + sfx;
      var arr = _petRosterRead(key);
      if (arr === null) return;   // 桶毀損/不存在：這個模式沒有資料可帶
      var tombs = (typeof _petTombsRead === 'function') ? _petTombsRead(key) : {};
      buckets[sfx] = { roster: arr, tombs: tombs };
      any = true;
    });
    return any ? { buckets: buckets } : null;
  };
  payload.writePets = function (state) {
    if (!state || !state.buckets) return;
    Object.keys(state.buckets).forEach(function (sfx) {
      var key = 'fb5_pet_roster' + sfx;
      var b = state.buckets[sfx];
      try {
        _lzSet(key, _saveWrap(JSON.stringify(b.roster || [])));
        if (typeof _petTombsWrite === 'function') _petTombsWrite(key, b.tombs || {});
      } catch (e) { console.warn('[AFK-cloud-sync-v2] writePets 失敗:', e); }
    });
    // 🔧 2026-07-20 修正：寵物系統把讀出來的名冊快取在記憶體(_petRoster/_petRosterKey)，
    // 只有「桶 key 字串變了」(切換一般/經典模式)才會強制重讀，直接改硬碟內容它感覺不到。
    // 若這台裝置這次瀏覽器分頁曾經載入過角色(即使已回到主選單，記憶體不會自動清掉)，
    // 剛寫進硬碟的合併結果會被晾在一邊，玩家看到的還是下載前的舊名單、出戰狀態也對不上——
    // 呼叫遊戲既有的「重新同步」函式強制丟掉快取、下次讀取保證從硬碟重讀最新資料。
    try { if (typeof _petRosterResync === 'function') _petRosterResync(); } catch (e) {}
  };

  // 寵物合併(不是覆蓋)：每隻寵物用自己的 uid 比對，不是整桶比時間戳二選一——否則輸的那台裝置
  // 這段時間新捕到的寵物會憑空消失。邏輯簡化自 js/22-pets.js 的 _petMergeFromBucket(那支是即時
  // 修改記憶體中的 _petRoster，這裡兩份都只是純資料快照，改寫成不依賴目前是否已登入角色的版本)：
  //   - 只有一邊有的 uid：整隻保留(外來新捕獲的寵物，不因為對方沒有就當作要刪除)。
  //   - 兩邊都有：先比「進化階級→等級→經驗」哪邊比較領先當作基準(絕不讓進度倒退；進化過的
  //     一律採用進化後的形態，避免進化前的舊副本因等級數字比較大反而被誤判領先)，
  //     裝備(eq)/出戰狀態(outOwner/outSlot)則各自獨立比對版本戳(eqV/outV)，採較新的一側。
  //   - 放生墓碑(tombs)兩邊取聯集：任一裝置放生過的 uid，合併結果一律不留(不會讓已放生的寵物復活)。
  function _petFormTier(form) { try { return (typeof PET_BOOK !== 'undefined' && PET_BOOK[form] && PET_BOOK[form].tier) || 0; } catch (e) { return 0; } }
  function _petRankGt(a, b) {
    var at = _petFormTier(a.form), bt = _petFormTier(b.form);
    if (at !== bt) return at > bt;
    var al = a.lv || 1, bl = b.lv || 1;
    if (al !== bl) return al > bl;
    return (a.exp || 0) > (b.exp || 0);
  }
  function _petMergeOne(l, r) {
    var base = _petRankGt(r, l) ? r : l;
    var out = JSON.parse(JSON.stringify(base));
    var lEqV = Number(l.eqV) || 0, rEqV = Number(r.eqV) || 0;
    var eqSrc = rEqV > lEqV ? r : l;
    out.eqV = Math.max(lEqV, rEqV);
    if (eqSrc.eq && (eqSrc.eq.wpn || eqSrc.eq.arm)) out.eq = JSON.parse(JSON.stringify(eqSrc.eq)); else delete out.eq;
    var lOutV = Number(l.outV) || 0, rOutV = Number(r.outV) || 0;
    var outSrc = rOutV > lOutV ? r : l;
    out.outV = Math.max(lOutV, rOutV);
    out.outOwner = outSrc.outOwner ? String(outSrc.outOwner) : null;
    out.outSlot = outSrc.outSlot == null ? null : String(outSrc.outSlot);
    return out;
  }
  function petsMergeStates(local, remote) {
    if (!remote) return null;    // 雲端沒有寵物資料(舊文件/從沒上傳過)，沒東西可合併
    if (!local) return remote;   // 本機沒有(剛裝上寵物系統/讀取失敗)，直接採用雲端
    var out = { buckets: {} };
    var sfxs = {};
    Object.keys(local.buckets || {}).forEach(function (k) { sfxs[k] = 1; });
    Object.keys(remote.buckets || {}).forEach(function (k) { sfxs[k] = 1; });
    Object.keys(sfxs).forEach(function (sfx) {
      var lb = (local.buckets || {})[sfx] || { roster: [], tombs: {} };
      var rb = (remote.buckets || {})[sfx] || { roster: [], tombs: {} };
      var tombs = {};
      Object.keys(lb.tombs || {}).forEach(function (u) { tombs[u] = 1; });
      Object.keys(rb.tombs || {}).forEach(function (u) { tombs[u] = 1; });
      var byUid = {};
      (lb.roster || []).forEach(function (p) { if (p && p.uid) { byUid[p.uid] = byUid[p.uid] || {}; byUid[p.uid].l = p; } });
      (rb.roster || []).forEach(function (p) { if (p && p.uid) { byUid[p.uid] = byUid[p.uid] || {}; byUid[p.uid].r = p; } });
      var merged = [];
      Object.keys(byUid).forEach(function (uid) {
        if (tombs[uid]) return;
        var e = byUid[uid];
        if (e.l && !e.r) { merged.push(e.l); return; }
        if (e.r && !e.l) { merged.push(e.r); return; }
        merged.push(_petMergeOne(e.l, e.r));
      });
      out.buckets[sfx] = { roster: merged, tombs: tombs };
    });
    return out;
  }

  // ===========================================================================
  // api：呼叫後端(配對碼) — 全部用 fetch，帶逾時保護；不做背景重試/排隊，失敗直接回錯給呼叫端
  // ===========================================================================
  var api = AFK_CLOUD2.api = {};
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('連線逾時')); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function apiFetch(path, opts) {
    if (!API_BASE) return Promise.reject(new Error('雲端同步服務尚未設定'));
    return withTimeout(fetch(API_BASE + path, opts), FETCH_TIMEOUT_MS).catch(function (e) {
      var err = new Error('網路連線失敗：' + (e && e.message ? e.message : String(e)));
      err.kind = 'network';
      throw err;
    });
  }

  api.newCode = function () {
    return apiFetch('/api/pair/new', { method: 'POST' }).then(function (res) {
      if (!res.ok) throw new Error('產生配對碼失敗（HTTP ' + res.status + '）');
      return res.json();
    }).then(function (data) { return data.code; });
  };

  // 回傳 { exists, save, version, updatedAt, hash }；save 是整包文件 { "<slot>": payloadObj, ... }
  api.getSave = function (code) {
    return apiFetch('/api/save/' + encodeURIComponent(code), { method: 'GET' }).then(function (res) {
      if (res.status === 404) { var e = new Error('配對碼不存在'); e.kind = 'not-found'; throw e; }
      if (!res.ok) throw new Error('讀取雲端存檔失敗（HTTP ' + res.status + '）');
      return res.json();
    });
  };

  // 樂觀鎖寫入整包文件。成功回 {ok:true,version,hash,updatedAt}；version 衝突回 {ok:false,conflict:true,remote:{save,version,hash,updatedAt}}
  api.putSave = function (code, doc, version) {
    return apiFetch('/api/save/' + encodeURIComponent(code), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ save: doc, version: version })
    }).then(function (res) {
      if (res.status === 409) return res.json().then(function (remote) { return { ok: false, conflict: true, remote: remote }; });
      if (res.status === 404) { var e = new Error('配對碼不存在'); e.kind = 'not-found'; throw e; }
      if (res.status === 413) throw new Error('存檔內容過大，無法上傳');
      if (!res.ok) throw new Error('上傳雲端存檔失敗（HTTP ' + res.status + '）');
      return res.json().then(function (r) { r.ok = true; return r; });
    });
  };

  // ===========================================================================
  // flow：串起 api/payload/衝突視窗的高階流程。全部以「整包文件」為單位操作。
  // ===========================================================================
  var flow = AFK_CLOUD2.flow = {};

  function handleErr(err, reason) {
    if (err && err.kind === 'network') AFK_CLOUD2.ui.toast('離線中或連線失敗，這次沒能同步（' + reason + '）', 'error');
    else if (err && err.kind === 'not-found') { AFK_CLOUD2.ui.toast('配對碼已失效，請重新設定', 'error'); cfg.clearPairing(); AFK_CLOUD2.ui.refreshPanel(); }
    else AFK_CLOUD2.ui.toast('同步失敗：' + ((err && err.message) || '未知錯誤'), 'error');
    return { ok: false, err: err };
  }

  function emptyDoc() { return { slots: {}, warehouses: {}, clan: null, pets: null }; }

  // 上傳本機所有有資料的存檔位。雲端既有、本機沒有的存檔位（別台裝置的進度）保留不動，不會被誤刪。
  // 遇到「同一個存檔位在本機與雲端都有、但內容不同」才視為衝突，跳批次視窗讓玩家逐格選；
  // 倉庫（依模式共用）跟著它所屬的存檔位決定一起用哪一邊，不需要另外問。
  flow.uploadAll = function (reason, onProgress, _isRetry) {
    if (!cfg.hasPairing()) return Promise.resolve({ ok: false, reason: 'no-pairing' });
    if (typeof onProgress === 'function') onProgress(8, '打包本機存檔中…');
    var localDoc = payload.buildAllSlotsDoc();
    if (!Object.keys(localDoc.slots).length) return Promise.resolve({ ok: false, reason: 'no-data' });
    if (typeof onProgress === 'function') onProgress(28, '連線到雲端服務…');
    return api.putSave(cfg.getCode(), localDoc, cfg.getVersion()).then(function (r) {
      if (r.ok) { if (typeof onProgress === 'function') onProgress(96, '雲端寫入完成…'); cfg.rememberSync(r.version, r.hash); return { ok: true }; }
      if (typeof onProgress === 'function') onProgress(48, '偵測到雲端版本不同，等待選擇…');
      var remoteDoc = (r.remote && r.remote.save) || emptyDoc();
      var remoteSlots = remoteDoc.slots || {};
      var remoteWh = remoteDoc.warehouses || {};
      var localSlots = localDoc.slots;
      var localWh = localDoc.warehouses;
      var conflicts = [];
      var merged = emptyDoc();
      Object.keys(remoteSlots).forEach(function (k) { merged.slots[k] = remoteSlots[k]; });     // 雲端全部先帶入，別台裝置的存檔位不會憑空消失
      Object.keys(remoteWh).forEach(function (k) { merged.warehouses[k] = remoteWh[k]; });
      Object.keys(localSlots).forEach(function (k) {
        var key = whKey(localSlots[k].save.p);
        if (!remoteSlots[k]) { merged.slots[k] = localSlots[k]; if (localWh[key]) merged.warehouses[key] = localWh[key]; return; }   // 只有本機有這格，不是衝突
        var lsum = payload.summarize(localSlots[k]);
        var rsum = payload.summarize(remoteSlots[k]);
        if (!rsum || !lsum || lsum.ts === rsum.ts) { merged.slots[k] = localSlots[k]; if (localWh[key]) merged.warehouses[key] = localWh[key]; return; }   // 內容一致（或無法比較），直接用本機
        conflicts.push({ slot: k, whKeyStr: key, localObj: localSlots[k], remoteObj: remoteSlots[k] });
      });
      // 血盟資料獨立於各存檔位衝突之外：不管本次有沒有 slot 衝突，都合併(取不倒退)一次；
      // 合併結果一併寫回本機，避免只有雲端拿到合併結果、本機這台裝置反而沒同步到。
      var mergedClan = clanMergeStates(localDoc.clan, remoteDoc.clan);
      if (mergedClan) { merged.clan = mergedClan; payload.writeClan(mergedClan); }
      else if (localDoc.clan) { merged.clan = localDoc.clan; }
      // 寵物保管同血盟資料：獨立於各存檔位衝突之外，逐隻合併(取不倒退)一次，結果一併寫回本機。
      var mergedPets = petsMergeStates(localDoc.pets, remoteDoc.pets);
      if (mergedPets) { merged.pets = mergedPets; payload.writePets(mergedPets); }
      else if (localDoc.pets) { merged.pets = localDoc.pets; }
      function finalize() {
        if (typeof onProgress === 'function') onProgress(78, '套用衝突選擇並重新上傳…');
        return api.putSave(cfg.getCode(), merged, r.remote.version).then(function (r2) {
          if (r2.ok) { if (typeof onProgress === 'function') onProgress(96, '雲端寫入完成…'); cfg.rememberSync(r2.version, r2.hash); return { ok: true }; }
          return { ok: false, reason: 'race', err: new Error('同步時偵測到其他裝置又搶先寫入了一次，請再按一次立即上傳') };
        });
      }
      if (!conflicts.length) return finalize();
      return AFK_CLOUD2.ui.showBatchConflictModal(conflicts).then(function (decisions) {
        // 使用者對「全部略過」的直覺理解是「這次同步先不要動」——不是只有這幾格內容不被覆蓋、
        // 整包還是照樣寫回雲端。所以每一格都選了略過(或直接關掉視窗、decisions 是空物件)時，
        // 直接中止本次同步，不呼叫 finalize()、不寫入雲端。
        var anyApplied = conflicts.some(function (c) {
          var choice = decisions[c.slot];
          return choice === 'cloud' || choice === 'local';
        });
        if (!anyApplied) {
          if (typeof onProgress === 'function') onProgress(100, '已略過本次同步（未上傳）');
          return { ok: false, reason: 'skipped-by-user' };
        }
        conflicts.forEach(function (c) {
          var choice = decisions[c.slot];
          if (choice === 'cloud') {
            merged.slots[c.slot] = c.remoteObj;
            if (remoteWh[c.whKeyStr]) merged.warehouses[c.whKeyStr] = remoteWh[c.whKeyStr];
            payload.applySlotFromDoc(+c.slot, remoteDoc);
          } else if (choice === 'local') {
            merged.slots[c.slot] = c.localObj;
            if (localWh[c.whKeyStr]) merged.warehouses[c.whKeyStr] = localWh[c.whKeyStr];
          }
          // 略過：merged.slots/warehouses 維持一開始從遠端帶入的值，不動本機這格
        });
        return finalize();
      });
    }).catch(function (err) {
      // 🔧 Bug E:第一次上傳常遇 Cloud Run 冷啟動,逾時/network 錯誤先靜默重試一次,使用者不會馬上看到「按一次失敗」
      if (err && err.kind === 'network' && !_isRetry) {
        if (typeof onProgress === 'function') onProgress(20, '連線逾時,重試中…');
        return flow.uploadAll(reason, onProgress, true);
      }
      return handleErr(err, reason);
    });
  };

  // 下載雲端整包文件。本機沒有的存檔位直接套用（純獲得，不會有損失）；本機已有且內容不同才是衝突，
  // 跳批次視窗讓玩家逐格選「用本機(維持不變)/用雲端(套用覆蓋)/略過」。
  flow.downloadAll = function (onProgress) {
    if (!cfg.hasPairing()) return Promise.resolve({ ok: false, reason: 'no-pairing' });
    if (typeof onProgress === 'function') onProgress(12, '讀取雲端資料中…');
    return api.getSave(cfg.getCode()).then(function (r) {
      if (!r.exists) return { ok: false, reason: 'no-remote' };
      if (typeof onProgress === 'function') onProgress(42, '比對本機與雲端存檔…');
      cfg.rememberSync(r.version, r.hash);
      var remoteDoc = r.save || emptyDoc();
      var remoteSlots = remoteDoc.slots || {};
      // 血盟資料獨立於各存檔位的下載選擇之外：不管等下有沒有 slot 衝突要問玩家，血盟合併都
      // 直接安全套用(取不倒退的合併結果),不需要跳視窗問——覆蓋掉不會有「選錯導致進度消失」的風險。
      var mergedClan = clanMergeStates(payload.readClan(), remoteDoc.clan);
      if (mergedClan) payload.writeClan(mergedClan);
      var mergedPets = petsMergeStates(payload.readPets(), remoteDoc.pets);
      if (mergedPets) payload.writePets(mergedPets);
      var conflicts = [];
      var applied = 0;
      Object.keys(remoteSlots).forEach(function (k) {
        var slot = +k;
        var localSummary = payload.summarizeFromSlot(slot);
        var remoteSummary = payload.summarize(remoteSlots[k]);
        if (!localSummary) { payload.applySlotFromDoc(slot, remoteDoc); applied++; return; }
        if (!remoteSummary || localSummary.ts === remoteSummary.ts) return;   // 一致，不用動
        conflicts.push({ slot: k, localObj: payload.buildPayload(slot), remoteObj: remoteSlots[k] });
      });
      if (!conflicts.length) { if (typeof onProgress === 'function') onProgress(96, '下載套用完成…'); return { ok: true, applied: applied }; }
      if (typeof onProgress === 'function') onProgress(62, '偵測到版本不同，等待選擇…');
      return AFK_CLOUD2.ui.showBatchConflictModal(conflicts).then(function (decisions) {
        // 同 uploadAll：全部略過(或直接關視窗)時直接中止，不套用任何本機沒有的雲端存檔位以外的東西、
        // 也不動已存在的本機存檔位。
        var anyApplied = conflicts.some(function (c) { return decisions[c.slot] === 'cloud'; });
        if (!anyApplied) {
          if (typeof onProgress === 'function') onProgress(100, '已略過本次同步（未套用）');
          return { ok: false, reason: 'skipped-by-user', applied: applied };
        }
        if (typeof onProgress === 'function') onProgress(82, '套用選擇結果…');
        conflicts.forEach(function (c) {
          if (decisions[c.slot] === 'cloud') { payload.applySlotFromDoc(+c.slot, remoteDoc); applied++; }
        });
        if (typeof onProgress === 'function') onProgress(96, '下載套用完成…');
        return { ok: true, applied: applied };
      });
    }).catch(function (err) { return handleErr(err, 'download'); });
  };

  // 2026-07-09 使用者明訂：正常遊戲(存檔/讀檔/關閉分頁/登出)一律只碰本機，雲端同步只在玩家
  // 主動按「產生配對碼」「使用配對碼」「立即上傳」「立即下載」這幾顆按鈕時才會發生。
  // 因此這裡刻意不掛 visibilitychange/beforeunload/pagehide 自動上傳、不攔截 chooseSlot/loadGame、
  // 不提供 flow.forceSyncBeforeLeave（afk-mobile.js 檢查 AFK_CLOUD.flow.forceSyncBeforeLeave 是否
  // 存在才呼叫，這裡不定義它，該掛勾會繼續維持沒接上的狀態，等同無操作)。

  // ===========================================================================
  // ui：管理面板（產生/輸入配對碼、立即同步、風險提示）+ 批次衝突視窗 + toast
  // ===========================================================================
  var ui = AFK_CLOUD2.ui = {};

  function injectCss() {
    if (document.getElementById('afk-cloud2-css')) return;
    var css = [
      '#afk-cloud2-panel-modal{display:none;position:fixed;inset:0;z-index:1000;background:rgba(2,6,23,.78);align-items:center;justify-content:center;padding:20px;}',
      '#afk-cloud2-panel-modal.open{display:flex;}',
      '#afk-cloud2-panel-card{width:min(440px,94vw);background:#0f172a;border:1px solid #334155;border-radius:12px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);}',
      '#afk-cloud2-panel-title{color:#fff;font-size:16px;font-weight:800;margin-bottom:12px;text-align:center;}',
      '#afk-cloud2-panel-body{display:flex;flex-direction:column;gap:10px;align-items:stretch;}',
      '.afk-cloud2-info{color:#cbd5e1;font-size:14px;text-align:center;word-break:break-all;}',
      '.afk-cloud2-code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:20px;font-weight:800;letter-spacing:2px;color:#fcd34d;text-align:center;padding:10px;background:#111c30;border:1px solid #334155;border-radius:8px;}',
      '.afk-cloud2-hint{color:#94a3b8;font-size:13px;text-align:center;line-height:1.6;}',
      '.afk-cloud2-warn{color:#f87171;font-size:12.5px;text-align:center;line-height:1.7;font-weight:600;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.35);border-radius:8px;padding:10px;}',
      '.afk-cloud2-btn{min-height:44px;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:bold;font-family:inherit;cursor:pointer;border:1px solid #d97706;background:#b45309;color:#fff;}',
      '.afk-cloud2-btn:active{background:#92400e;}',
      '.afk-cloud2-btn:disabled{opacity:.5;cursor:not-allowed;}',
      '.afk-cloud2-btn-secondary{border-color:#334155;background:#1e293b;color:#e2e8f0;}',
      '.afk-cloud2-btn-secondary:active{background:#273449;}',
      '.afk-cloud2-input{min-height:44px;padding:8px 12px;border-radius:8px;font-size:16px;font-family:ui-monospace,Menlo,Consolas,monospace;text-align:center;letter-spacing:2px;text-transform:uppercase;background:#111c30;border:1px solid #334155;color:#e2e8f0;}',
      '#afk-cloud2-panel-close{display:block;width:100%;margin-top:14px;}',
      '.afk-cloud2-status{font-size:12.5px;color:#94a3b8;text-align:center;}',
      '.afk-cloud2-status.is-err{color:#f87171;}',
      '#afk-cloud2-panel-modal.is-busy{cursor:wait;}',
      '#afk-cloud2-panel-modal.is-busy #afk-cloud2-panel-card{box-shadow:0 0 0 2px rgba(251,191,36,.55),0 20px 60px rgba(0,0,0,.75);}',
      '.afk-cloud2-progress{display:none;background:#111c30;border:1px solid #334155;border-radius:10px;padding:10px;gap:8px;}',
      '.afk-cloud2-progress.is-active{display:flex;flex-direction:column;}',
      '.afk-cloud2-progress-label{font-size:13px;color:#fde68a;text-align:center;font-weight:700;}',
      '.afk-cloud2-progress-track{height:10px;border-radius:999px;background:#1e293b;overflow:hidden;border:1px solid #475569;}',
      '.afk-cloud2-progress-bar{height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#f59e0b,#22c55e);transition:width .22s ease;}',
      '.afk-cloud2-lock-note{font-size:12px;color:#fca5a5;text-align:center;line-height:1.5;}',
      '.afk-cloud2-modal-overlay{position:fixed;inset:0;z-index:1002;background:rgba(2,6,23,.8);display:flex;align-items:center;justify-content:center;padding:16px;}',
      '.afk-cloud2-modal-card{width:min(560px,96vw);max-height:90vh;overflow-y:auto;background:#0f172a;border:1px solid #334155;border-radius:14px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.6);}',
      '.afk-cloud2-card-title{color:#f8e7bb;font-weight:800;font-size:14px;margin-bottom:8px;}',
      '.afk-cloud2-card-line{color:#e2e8f0;font-size:13.5px;line-height:1.7;}',
      '.afk-cloud2-modal-actions{display:flex;flex-wrap:wrap;gap:8px;}',
      '.afk-cloud2-spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:afk-cloud2-spin .7s linear infinite;vertical-align:-2px;}',
      '@keyframes afk-cloud2-spin{to{transform:rotate(360deg);}}',
      // 批次衝突總覽：每列一格存檔位 + 三顆選擇鈕(本機/雲端/略過，不用下拉選單)
      '.afk-cloud2-batch-row{background:#111c30;border:1px solid #1e293b;border-radius:10px;padding:10px;margin-bottom:10px;}',
      '.afk-cloud2-batch-choice-group{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}',
      '.afk-cloud2-batch-btn{flex:1 1 28%;min-height:38px;padding:6px 8px;font-size:12.5px;opacity:.55;}',
      '.afk-cloud2-batch-btn.is-active{opacity:1;box-shadow:0 0 0 2px #fff;}',
      // 三顆選擇鈕改用各自直覺色系(本機=藍／雲端=青／略過=中性灰),避免跟原本共用的深灰次要色分不出來
      '.afk-cloud2-batch-btn[data-choice="local"]{background:#1e40af;border-color:#3b82f6;}',
      '.afk-cloud2-batch-btn[data-choice="cloud"]{background:#0e7490;border-color:#22d3ee;}',
      '.afk-cloud2-batch-btn[data-choice="skip"]{background:#334155;border-color:#64748b;}',
      '.afk-cloud2-new-badge{display:inline-block;background:#16a34a;color:#fff;font-size:11px;font-weight:800;padding:1px 6px;border-radius:999px;vertical-align:1px;}',
      '#afk-cloud2-toast-wrap{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99998;display:flex;flex-direction:column;gap:10px;width:min(92vw,460px);pointer-events:none;}',
      '#afk-cloud2-toast-wrap .afk-cloud2-toast{pointer-events:auto;background:rgba(15,23,42,.98);border:1px solid #475569;border-left:5px solid #38bdf8;border-radius:10px;padding:14px 18px;box-shadow:0 10px 34px rgba(0,0,0,.65);color:#f1f5f9;font-size:15px;font-weight:600;line-height:1.55;word-break:break-word;opacity:0;transform:translateY(10px);transition:opacity .22s ease,transform .22s ease;}',
      '#afk-cloud2-toast-wrap .afk-cloud2-toast.in{opacity:1;transform:translateY(0);}',
      '#afk-cloud2-toast-wrap .afk-cloud2-toast-success{border-left-color:#22c55e;}',
      '#afk-cloud2-toast-wrap .afk-cloud2-toast-error{border-left-color:#ef4444;}'
    ].join('');
    var s = document.createElement('style');
    s.id = 'afk-cloud2-css';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  ui.toast = function (msg, type) {
    injectCss();
    var wrap = document.getElementById('afk-cloud2-toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'afk-cloud2-toast-wrap'; document.body.appendChild(wrap); }
    var card = document.createElement('div');
    card.className = 'afk-cloud2-toast' + (type ? ' afk-cloud2-toast-' + type : '');
    card.textContent = msg;
    wrap.appendChild(card);
    requestAnimationFrame(function () { card.classList.add('in'); });
    var killed = false;
    function kill() { if (killed) return; killed = true; card.classList.remove('in'); setTimeout(function () { if (card.parentNode) card.parentNode.removeChild(card); }, 300); }
    card.addEventListener('click', kill);
    setTimeout(kill, 5000);
  };

  // ----- 批次衝突總覽（每個衝突的存檔位一列，本機/雲端/略過三選一，全部選完一次送出） -----------
  // finish 先 resolve（idempotent）、closeLayer 後觸發，順序鐵則不可寫反（沿用舊版踩過的教訓）。
  ui.showBatchConflictModal = function (conflicts) {
    injectCss();
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'afk-cloud2-modal-overlay';
      var rows = conflicts.map(function (c) {
        var ls = payload.summarize(c.localObj);
        var rs = payload.summarize(c.remoteObj);
        var lsNewer = !!(ls && rs && ls.ts && rs.ts && ls.ts > rs.ts);
        var rsNewer = !!(ls && rs && ls.ts && rs.ts && rs.ts > ls.ts);
        var newBadge = ' <span class="afk-cloud2-new-badge">新</span>';
        return '<div class="afk-cloud2-batch-row" data-batch-slot="' + esc(c.slot) + '" data-selected="skip">' +
          '<div class="afk-cloud2-card-title">存檔 ' + esc(c.slot) + '</div>' +
          '<div class="afk-cloud2-card-line">📱 本機：' + (ls ? esc(ls.cls) + ' Lv.' + esc(String(ls.lv)) + (ls.name ? '　' + esc(ls.name) : '') + '　' + esc(fmtTsShort(ls.ts)) + (lsNewer ? newBadge : '') : '（無資料）') + '</div>' +
          '<div class="afk-cloud2-card-line">☁️ 雲端：' + (rs ? esc(rs.cls) + ' Lv.' + esc(String(rs.lv)) + (rs.name ? '　' + esc(rs.name) : '') + '　' + esc(fmtTsShort(rs.ts)) + (rsNewer ? newBadge : '') : '（無資料）') + '</div>' +
          '<div class="afk-cloud2-batch-choice-group">' +
            '<button type="button" class="afk-cloud2-btn afk-cloud2-batch-btn" data-choice="local">用本機</button>' +
            '<button type="button" class="afk-cloud2-btn afk-cloud2-btn-secondary afk-cloud2-batch-btn" data-choice="cloud">用雲端</button>' +
            '<button type="button" class="afk-cloud2-btn afk-cloud2-btn-secondary afk-cloud2-batch-btn is-active" data-choice="skip">略過</button>' +
          '</div></div>';
      }).join('');
      overlay.innerHTML =
        '<div class="afk-cloud2-modal-card">' +
          '<div class="afk-cloud2-card-title" style="margin-bottom:10px;">以下存檔位偵測到本機與雲端內容不同，逐格選好再一次送出：</div>' +
          rows +
          '<div class="afk-cloud2-modal-actions" style="margin-top:6px;">' +
            '<button type="button" class="afk-cloud2-btn" id="afk-cloud2-batch-submit">確認送出</button>' +
            '<button type="button" class="afk-cloud2-btn afk-cloud2-btn-secondary" id="afk-cloud2-batch-cancel">全部略過</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      var done = false;
      function finish(decisions) { if (done) return; done = true; if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(decisions); }
      var layer = window.AFK_UI ? AFK_UI.openLayer(function () { finish({}); }) : null;
      overlay.addEventListener('click', function (e) {
        var choiceBtn = e.target.closest ? e.target.closest('[data-choice]') : null;
        if (choiceBtn) {
          var row = choiceBtn.closest('.afk-cloud2-batch-row');
          row.setAttribute('data-selected', choiceBtn.getAttribute('data-choice'));
          Array.prototype.forEach.call(row.querySelectorAll('.afk-cloud2-batch-btn'), function (b) { b.classList.toggle('is-active', b === choiceBtn); });
          return;
        }
        if (e.target.id === 'afk-cloud2-batch-submit' || e.target.id === 'afk-cloud2-batch-cancel') {
          var decisions = {};
          if (e.target.id === 'afk-cloud2-batch-submit') {
            Array.prototype.forEach.call(overlay.querySelectorAll('.afk-cloud2-batch-row'), function (row) {
              decisions[row.getAttribute('data-batch-slot')] = row.getAttribute('data-selected');
            });
          }
          finish(decisions);   // 先 resolve，再退歷史一格；layer 的 closeFn 之後才觸發也會被 done 擋掉
          if (layer && window.AFK_UI) AFK_UI.closeLayer(layer);
        }
      });
    });
  };

  // ----- 管理面板 --------------------------------------------------------------
  function panelBodyHTML() {
    if (!cfg.hasPairing()) {
      return '<div class="afk-cloud2-warn">換瀏覽器、清除瀏覽器資料、使用無痕模式，都會讀不到本機記住的配對碼。<br>產生配對碼後請記下來（建議截圖或抄下），換裝置/換瀏覽器需要手動輸入這組碼才能接回進度。</div>' +
        '<button type="button" class="afk-cloud2-btn" id="afk-cloud2-new-btn">🆕 產生新配對碼</button>' +
        '<div class="afk-cloud2-hint">或者，如果你已經有配對碼（例如在其他裝置產生過）：</div>' +
        '<input type="text" class="afk-cloud2-input" id="afk-cloud2-input" placeholder="輸入配對碼" maxlength="12" />' +
        '<button type="button" class="afk-cloud2-btn afk-cloud2-btn-secondary" id="afk-cloud2-use-btn">使用這組配對碼</button>';
    }
    var syncedAt = cfg.getSyncedAt();
    var slots = payload.localSlotNumbers();
    var slotsText = slots.length ? ('本機有資料的存檔位：' + slots.join('、')) : '本機目前沒有任何存檔位有資料';
    return '<div class="afk-cloud2-code">' + esc(cfg.getCode()) + '</div>' +
      '<div class="afk-cloud2-info">' + esc(slotsText) + '</div>' +
      '<div class="afk-cloud2-status" id="afk-cloud2-status">上次同步：' + esc(fmtTsShort(syncedAt)) + '</div>' +
      '<div class="afk-cloud2-progress" id="afk-cloud2-progress" aria-live="polite">' +
        '<div class="afk-cloud2-progress-label" id="afk-cloud2-progress-label">準備同步…</div>' +
        '<div class="afk-cloud2-progress-track"><div class="afk-cloud2-progress-bar" id="afk-cloud2-progress-bar"></div></div>' +
        '<div class="afk-cloud2-lock-note">同步完成前請勿關閉或切換畫面。</div>' +
      '</div>' +
      '<div class="afk-cloud2-hint">同步涵蓋所有存檔位(1~8)，只有按下面按鈕才會連網；別台裝置才有的存檔位不會被上傳動作誤刪。</div>' +
      '<button type="button" class="afk-cloud2-btn" id="afk-cloud2-upload-btn">⬆️ 立即上傳全部存檔位</button>' +
      '<button type="button" class="afk-cloud2-btn afk-cloud2-btn-secondary" id="afk-cloud2-download-btn">⬇️ 立即下載全部存檔位</button>' +
      '<div class="afk-cloud2-warn">請先正常退出遊戲以確保進度已寫入本機存檔，再手動按上傳。</div>' +
      '<button type="button" class="afk-cloud2-btn afk-cloud2-btn-secondary" id="afk-cloud2-forget-btn">忘記這組配對碼（換裝置用）</button>';
  }

  function setStatus(msg, isErr) {
    var el = document.getElementById('afk-cloud2-status');
    if (el) { el.textContent = msg; el.classList.toggle('is-err', !!isErr); }
  }

  var _syncBusy = false;
  var _syncProgress = 0;
  var _progressTimer = 0;
  function blockUnload(e) {
    if (!_syncBusy) return;
    e.preventDefault();
    e.returnValue = '雲端同步尚未完成，請等待同步結束。';
    return e.returnValue;
  }
  function setPanelBusy(on) {
    _syncBusy = !!on;
    var modal = document.getElementById('afk-cloud2-panel-modal');
    if (modal) modal.classList.toggle('is-busy', _syncBusy);
    var closeBtn = document.getElementById('afk-cloud2-panel-close');
    if (closeBtn) closeBtn.disabled = _syncBusy;
    Array.prototype.forEach.call(document.querySelectorAll('#afk-cloud2-panel-body button,#afk-cloud2-panel-body input'), function (el) {
      el.disabled = _syncBusy;
    });
    if (_syncBusy) window.addEventListener('beforeunload', blockUnload);
    else window.removeEventListener('beforeunload', blockUnload);
  }
  function updateProgress(pct, label) {
    _syncProgress = Math.max(_syncProgress, Math.min(100, pct || 0));
    var box = document.getElementById('afk-cloud2-progress');
    var bar = document.getElementById('afk-cloud2-progress-bar');
    var text = document.getElementById('afk-cloud2-progress-label');
    if (box) box.classList.add('is-active');
    if (bar) bar.style.width = _syncProgress + '%';
    if (text && label) text.textContent = label;
  }
  function beginBlockingSync(label) {
    setPanelBusy(true);
    _syncProgress = 0;
    updateProgress(6, label || '同步準備中…');
    clearInterval(_progressTimer);
    _progressTimer = setInterval(function () {
      if (!_syncBusy || _syncProgress >= 88) return;
      updateProgress(_syncProgress + 2, '');
    }, 900);
    return updateProgress;
  }
  function endBlockingSync(label, afterUnlock) {
    clearInterval(_progressTimer);
    _progressTimer = 0;
    updateProgress(100, label || '同步完成');
    setTimeout(function () {
      setPanelBusy(false);
      var box = document.getElementById('afk-cloud2-progress');
      var bar = document.getElementById('afk-cloud2-progress-bar');
      if (box) box.classList.remove('is-active');
      if (bar) bar.style.width = '0%';
      _syncProgress = 0;
      if (typeof afterUnlock === 'function') afterUnlock();
    }, 450);
  }

  ui.refreshPanel = function () {
    var body = document.getElementById('afk-cloud2-panel-body');
    if (!body) return;
    body.innerHTML = panelBodyHTML();

    var newBtn = document.getElementById('afk-cloud2-new-btn');
    if (newBtn) newBtn.addEventListener('click', function () {
      newBtn.disabled = true; newBtn.innerHTML = '<span class="afk-cloud2-spin"></span> 產生中…';
      api.newCode().then(function (code) {
        cfg.setPairing(code);
        ui.toast('已產生配對碼，請記下來！', 'success');
        ui.refreshPanel();
        flow.uploadAll('pairing-created').then(function (r) { if (r && r.ok) ui.toast('已將本機存檔上傳到這組配對碼', 'success'); });
      }).catch(function (err) { newBtn.disabled = false; newBtn.innerHTML = '🆕 產生新配對碼'; ui.toast('產生配對碼失敗：' + err.message, 'error'); });
    });

    var useBtn = document.getElementById('afk-cloud2-use-btn');
    if (useBtn) useBtn.addEventListener('click', function () {
      var input = document.getElementById('afk-cloud2-input');
      var code = (input && input.value || '').trim().toUpperCase();
      if (!code) { ui.toast('請先輸入配對碼'); return; }
      useBtn.disabled = true; useBtn.innerHTML = '<span class="afk-cloud2-spin"></span> 讀取中…';
      cfg.setPairing(code);
      flow.downloadAll().then(function (r) {
        ui.refreshPanel();
        if (r && r.ok) ui.toast('✅ 已從雲端同步 ' + (r.applied || 0) + ' 個存檔位', 'success');
        else if (r && r.reason === 'no-remote') ui.toast('這組配對碼雲端還沒有任何存檔');
        else ui.toast('讀取失敗，請確認配對碼是否正確', 'error');
      });
    });

    var uploadBtn = document.getElementById('afk-cloud2-upload-btn');
    if (uploadBtn) uploadBtn.addEventListener('click', function () {
      if (_syncBusy) return;
      var progress = beginBlockingSync('準備上傳全部存檔位…');
      setStatus('同步中…畫面已鎖定，請等待完成');
      flow.uploadAll('manual', progress).then(function (r) {
        if (r && r.ok) ui.toast('✅ 已上傳全部存檔位到雲端', 'success');
        else if (r && r.reason === 'no-data') setStatus('本機目前沒有任何存檔位有資料，尚無需同步', true);
        else if (r && r.reason === 'race') setStatus(r.err.message, true);
        else if (r && r.reason === 'skipped-by-user') setStatus('已略過本次同步，雲端內容未變動', true);
        else setStatus('同步失敗', true);
        endBlockingSync(r && r.ok ? '上傳完成' : '同步結束', function () { if (r && r.ok) ui.refreshPanel(); });
      });
    });

    var downloadBtn = document.getElementById('afk-cloud2-download-btn');
    if (downloadBtn) downloadBtn.addEventListener('click', function () {
      if (_syncBusy) return;
      var progress = beginBlockingSync('準備下載全部存檔位…');
      setStatus('讀取雲端中…畫面已鎖定，請等待完成');
      flow.downloadAll(progress).then(function (r) {
        if (r && r.ok) ui.toast('✅ 已從雲端同步 ' + (r.applied || 0) + ' 個存檔位', 'success');
        else if (r && r.reason === 'no-remote') setStatus('雲端尚無資料', true);
        else if (r && r.reason === 'skipped-by-user') setStatus('已略過本次同步，本機內容未變動', true);
        else setStatus('下載失敗', true);
        endBlockingSync(r && r.ok ? '下載完成' : '同步結束', function () { if (r && r.ok) ui.refreshPanel(); });
      });
    });

    var forgetBtn = document.getElementById('afk-cloud2-forget-btn');
    if (forgetBtn) forgetBtn.addEventListener('click', function () {
      if (!confirm('確定要忘記這組配對碼嗎？（雲端存檔不會被刪除，只是這台裝置不再記住配對碼；要換裝置時再重新輸入即可）')) return;
      cfg.clearPairing();
      ui.refreshPanel();
    });
  };

  function buildPanel() {
    if (document.getElementById('afk-cloud2-panel-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'afk-cloud2-panel-modal';
    modal.innerHTML =
      '<div id="afk-cloud2-panel-card">' +
        '<div id="afk-cloud2-panel-title">☁️ 配對碼雲端同步</div>' +
        '<div id="afk-cloud2-panel-body"></div>' +
        '<button type="button" id="afk-cloud2-panel-close" class="afk-cloud2-btn afk-cloud2-btn-secondary">關閉</button>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closePanel(); });
    document.getElementById('afk-cloud2-panel-close').addEventListener('click', closePanel);
  }
  var _panelLayer = null;
  function hidePanel() { if (_syncBusy) return; var m = document.getElementById('afk-cloud2-panel-modal'); if (m) m.classList.remove('open'); _panelLayer = null; }
  function closePanel() { if (_syncBusy) { ui.toast('同步尚未完成，請等待進度條結束。'); return; } if (_panelLayer && window.AFK_UI) AFK_UI.closeLayer(_panelLayer); else hidePanel(); }
  ui.openPanel = function () {
    injectCss(); buildPanel(); ui.refreshPanel();
    document.getElementById('afk-cloud2-panel-modal').classList.add('open');
    _panelLayer = window.AFK_UI ? AFK_UI.openLayer(hidePanel) : null;
  };

  // ----- 掛進首頁「⚙ 其他功能」選單（由 afk-storage.js 渲染；未設定 API_BASE 時完全不出現） ---
  window.AFK_SETTINGS = window.AFK_SETTINGS || { _items: [], add: function (it) { this._items.push(it); } };
  AFK_SETTINGS.add({ label: '☁️ 配對碼雲端同步', visible: function () { return cfg.isConfigured(); }, onClick: ui.openPanel });

  console.log('[AFK-cloud-sync-v2] hooks OK — ' + (cfg.isConfigured() ? '已設定服務網址' : '尚未設定服務網址，僅本機配對碼記錄生效，不會呼叫任何雲端 API') + '。');
})();
