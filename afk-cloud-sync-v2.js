/* ============================================================================
 * afk-cloud-sync-v2.js — 跨裝置雲端存檔同步（配對碼 + 後端代管，取代舊版 Google 登入方案）
 *
 * 設計依據：Lineage/待辦-ClaudeCode/2026-07-09_配對碼雲端存檔同步規格(取代0708版Google登入方案).md
 * 舊版（Google 帳號登入 + 前端直打 Drive API）已停用於 afk-cloud-sync.js.disabled，
 * 兩份文件/兩支外掛設計思路不同，不要混用；本檔沿用舊版已驗證過的部分邏輯
 *（payload 打包/還原、衝突視窗、finish-before-closeLayer 順序鐵則），但簡化成
 *「一個配對碼＝一個綁定存檔位」。
 *
 * 2026-07-09 使用者明訂：**純手動**——正常存檔/讀檔/關閉分頁/登出完全不碰雲端，只有玩家主動
 * 按「產生配對碼」「使用配對碼」「立即上傳」「立即下載」這幾顆按鈕時才會真的連網。不攔截
 * saveGame/loadGame/chooseSlot，不掛 visibilitychange/beforeunload/pagehide 自動上傳。
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
  var SLOT_KEY = 'afk_cloud2_slot';          // 這個配對碼綁定的本機存檔位（1~8）
  var VER_KEY = 'afk_cloud2_version';        // 最後一次讀取/寫入成功時的雲端 version（樂觀鎖用）
  var HASH_KEY = 'afk_cloud2_hash';          // 對應 VER_KEY 的雲端內容雜湊
  var SYNCED_AT_KEY = 'afk_cloud2_synced_at';
  var FETCH_TIMEOUT_MS = 12000;

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
  try { void currentSlot; }
  catch (e) { console.warn('[AFK-cloud-sync-v2] 缺少核心全域 currentSlot，雲端同步功能停用。'); return; }

  var AFK_CLOUD2 = (window.AFK_CLOUD = window.AFK_CLOUD || {});   // 沿用同一個全域掛點名，方便 afk-mobile.js 既有的死碼掛勾重新生效
  AFK_CLOUD2.v2 = true;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmtTs(ts) { if (!ts) return '未知時間'; try { return new Date(ts).toLocaleString(); } catch (e) { return '未知時間'; } }
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
  cfg.getBoundSlot = function () { return getNum(SLOT_KEY) || null; };
  cfg.hasPairing = function () { return !!(cfg.getCode() && cfg.getBoundSlot()); };
  cfg.getVersion = function () { return getNum(VER_KEY); };
  cfg.getHash = function () { return getStr(HASH_KEY); };
  cfg.getSyncedAt = function () { return getNum(SYNCED_AT_KEY); };
  cfg.rememberSync = function (version, hash) {
    setStr(VER_KEY, String(version || 0));
    setStr(HASH_KEY, hash || '');
    setStr(SYNCED_AT_KEY, String(Date.now()));
  };
  cfg.clearPairing = function () {
    setStr(CODE_KEY, ''); setStr(SLOT_KEY, ''); setStr(VER_KEY, ''); setStr(HASH_KEY, ''); setStr(SYNCED_AT_KEY, '');
  };
  cfg.setPairing = function (code, slot) {
    setStr(CODE_KEY, code); setStr(SLOT_KEY, String(slot));
    setStr(VER_KEY, ''); setStr(HASH_KEY, ''); setStr(SYNCED_AT_KEY, '');
  };

  // ===========================================================================
  // payload：打包/還原「存檔位 + 倉庫 + 4 把裝置綁定輔助鍵」（邏輯沿用舊版已驗證過的寫法）
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

  payload.summarize = function (obj) {
    if (!obj || !obj.save || !obj.save.p) return null;
    var p = obj.save.p;
    return { cls: CLASS_NAME[p.cls] || p.cls || '?', lv: p.lv || 1, name: p.name || '', ts: (obj.afk && obj.afk.ts) || 0, map: (obj.afk && obj.afk.map) || '' };
  };
  payload.summarizeFromSlot = function (slot) { return payload.summarize(payload.buildPayload(slot)); };

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

  // 回傳 { exists, save, version, updatedAt, hash } 或查無配對碼時 throw（err.kind='not-found'）
  api.getSave = function (code) {
    return apiFetch('/api/save/' + encodeURIComponent(code), { method: 'GET' }).then(function (res) {
      if (res.status === 404) { var e = new Error('配對碼不存在'); e.kind = 'not-found'; throw e; }
      if (!res.ok) throw new Error('讀取雲端存檔失敗（HTTP ' + res.status + '）');
      return res.json();
    });
  };

  // 樂觀鎖寫入。成功回 {ok:true,version,hash,updatedAt}；version 衝突回 {ok:false,conflict:true,remote:{save,version,hash,updatedAt}}
  api.putSave = function (code, save, version) {
    return apiFetch('/api/save/' + encodeURIComponent(code), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ save: save, version: version })
    }).then(function (res) {
      if (res.status === 409) return res.json().then(function (remote) { return { ok: false, conflict: true, remote: remote }; });
      if (res.status === 404) { var e = new Error('配對碼不存在'); e.kind = 'not-found'; throw e; }
      if (res.status === 413) throw new Error('存檔內容過大，無法上傳');
      if (!res.ok) throw new Error('上傳雲端存檔失敗（HTTP ' + res.status + '）');
      return res.json().then(function (r) { r.ok = true; return r; });
    });
  };

  // 強制覆蓋：expectedHash 必須是玩家端真的讀過的雲端內容雜湊，防止只靠配對碼亂蓋別人存檔
  api.forceSave = function (code, save, expectedHash) {
    return apiFetch('/api/save/' + encodeURIComponent(code) + '/force', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ save: save, expectedHash: expectedHash })
    }).then(function (res) {
      if (res.status === 403) throw new Error('雲端內容已被更新，無法強制覆蓋（請重新讀取後再試）');
      if (!res.ok) throw new Error('強制覆蓋失敗（HTTP ' + res.status + '）');
      return res.json().then(function (r) { r.ok = true; return r; });
    });
  };

  // ===========================================================================
  // flow：串起 api/payload/conflict 視窗的高階流程
  // ===========================================================================
  var flow = AFK_CLOUD2.flow = {};

  // 上傳目前綁定存檔位；衝突時跳視窗讓玩家選：本機覆蓋(強制)/雲端覆蓋本機/取消
  flow.upload = function (reason) {
    if (!cfg.hasPairing()) return Promise.resolve({ ok: false, reason: 'no-pairing' });
    var slot = cfg.getBoundSlot();
    var obj = payload.buildPayload(slot);
    if (!obj) return Promise.resolve({ ok: false, reason: 'no-data' });
    return api.putSave(cfg.getCode(), obj, cfg.getVersion()).then(function (r) {
      if (r.ok) { cfg.rememberSync(r.version, r.hash); return { ok: true }; }
      // 衝突：雲端已被別台裝置更新過，跳視窗讓玩家決定（仿 Steam 雲端存檔衝突畫面）
      var remote = r.remote;
      return AFK_CLOUD2.ui.showConflictModal({
        left: { title: '📱 本機存檔（觸發原因：' + reason + '）', summary: payload.summarize(obj) },
        right: { title: '☁️ 雲端存檔（已被別台裝置更新過）', summary: remote && remote.save ? payload.summarize(remote.save) : null },
        leftLabel: '仍要用本機覆蓋（危險）',
        rightLabel: '使用雲端版本（套用到本機）',
        cancelLabel: '先不同步'
      }).then(function (choice) {
        if (choice === 'left') {
          return api.forceSave(cfg.getCode(), obj, remote.hash).then(function (fr) {
            cfg.rememberSync(fr.version, fr.hash);
            return { ok: true, forced: true };
          });
        }
        if (choice === 'right') {
          if (remote && remote.save) { payload.applyPayload(remote.save, slot); cfg.rememberSync(remote.version, remote.hash); }
          return { ok: true, downloaded: true };
        }
        return { ok: false, cancelled: true };
      });
    }).catch(function (err) { return handleErr(err, reason); });
  };

  function handleErr(err, reason) {
    if (err && err.kind === 'network') AFK_CLOUD2.ui.toast('離線中或連線失敗，這次沒能同步（' + reason + '）', 'error');
    else if (err && err.kind === 'not-found') { AFK_CLOUD2.ui.toast('配對碼已失效，請重新設定', 'error'); cfg.clearPairing(); AFK_CLOUD2.ui.refreshPanel(); }
    else AFK_CLOUD2.ui.toast('同步失敗：' + ((err && err.message) || '未知錯誤'), 'error');
    return { ok: false, err: err };
  }

  // 讀取雲端內容並套用到綁定存檔位；needConfirm=true 時，本機該存檔位已有資料才跳視窗二次確認
  flow.download = function (needConfirm) {
    if (!cfg.hasPairing()) return Promise.resolve({ ok: false, reason: 'no-pairing' });
    var slot = cfg.getBoundSlot();
    return api.getSave(cfg.getCode()).then(function (r) {
      if (!r.exists) return { ok: false, reason: 'no-remote' };
      var localSummary = payload.summarizeFromSlot(slot);
      if (!needConfirm || !localSummary) {
        payload.applyPayload(r.save, slot);
        cfg.rememberSync(r.version, r.hash);
        return { ok: true };
      }
      return AFK_CLOUD2.ui.showConflictModal({
        left: { title: '📼 目前存檔位 ' + slot, summary: localSummary },
        right: { title: '☁️ 雲端存檔', summary: r.save ? payload.summarize(r.save) : null },
        leftLabel: '保留本機（取消還原）',
        rightLabel: '用雲端覆蓋本機',
        cancelLabel: '取消'
      }).then(function (choice) {
        if (choice !== 'right') return { ok: false, cancelled: true };
        payload.applyPayload(r.save, slot);
        cfg.rememberSync(r.version, r.hash);
        return { ok: true };
      });
    }).catch(function (err) { return handleErr(err, 'download'); });
  };

  // 遊戲啟動時：本機該存檔位若已有資料就悄悄比對時間戳，不同才跳視窗；本機沒資料就直接套用
  // (規格「讀取時機：遊戲啟動時」)
  flow.startupCheck = function () {
    if (!cfg.hasPairing()) return;
    var slot = cfg.getBoundSlot();
    api.getSave(cfg.getCode()).then(function (r) {
      if (!r.exists) return;
      var localSummary = payload.summarizeFromSlot(slot);
      if (!localSummary) { payload.applyPayload(r.save, slot); cfg.rememberSync(r.version, r.hash); AFK_CLOUD2.ui.toast('已從雲端還原存檔位 ' + slot); return; }
      var remoteSummary = r.save ? payload.summarize(r.save) : null;
      if (!remoteSummary || localSummary.ts === remoteSummary.ts) { cfg.rememberSync(r.version, r.hash); return; }
      AFK_CLOUD2.ui.showConflictModal({
        left: { title: '📱 本機存檔 ' + slot, summary: localSummary },
        right: { title: '☁️ 雲端存檔 ' + slot, summary: remoteSummary },
        leftLabel: '使用本機存檔',
        rightLabel: '使用雲端存檔',
        cancelLabel: '先不處理'
      }).then(function (choice) {
        if (choice === 'right') { payload.applyPayload(r.save, slot); cfg.rememberSync(r.version, r.hash); AFK_CLOUD2.ui.toast('已套用雲端存檔'); }
        else if (choice === 'left') cfg.rememberSync(r.version, r.hash);
      });
    }).catch(function (err) { console.warn('[AFK-cloud-sync-v2] startupCheck 失敗:', err); });
  };

  // 2026-07-09 使用者明訂：正常遊戲(存檔/讀檔/關閉分頁/登出)一律只碰本機，雲端同步只在玩家
  // 主動按「產生配對碼」「使用配對碼」「立即上傳」「立即下載」這幾顆按鈕時才會發生。
  // 因此這裡刻意不掛 visibilitychange/beforeunload/pagehide 自動上傳、不提供
  // flow.forceSyncBeforeLeave（afk-mobile.js 檢查 AFK_CLOUD.flow.forceSyncBeforeLeave 是否存在
  // 才呼叫，這裡不定義它，該掛勾會繼續維持沒接上的狀態，等同無操作)。

  // ===========================================================================
  // ui：管理面板（產生/輸入配對碼、立即同步、風險提示）+ 衝突視窗 + toast
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
      '.afk-cloud2-modal-overlay{position:fixed;inset:0;z-index:1002;background:rgba(2,6,23,.8);display:flex;align-items:center;justify-content:center;padding:16px;}',
      '.afk-cloud2-modal-card{width:min(560px,96vw);max-height:90vh;overflow-y:auto;background:#0f172a;border:1px solid #334155;border-radius:14px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.6);}',
      '.afk-cloud2-modal-cards{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;}',
      '.afk-cloud2-card{flex:1 1 220px;background:#111c30;border:1px solid #1e293b;border-radius:10px;padding:12px;}',
      '.afk-cloud2-card-title{color:#f8e7bb;font-weight:800;font-size:14px;margin-bottom:8px;}',
      '.afk-cloud2-card-line{color:#e2e8f0;font-size:13.5px;line-height:1.7;}',
      '.afk-cloud2-card-warn{margin-top:8px;color:#f87171;font-size:12.5px;font-weight:bold;line-height:1.6;}',
      '.afk-cloud2-modal-actions{display:flex;flex-wrap:wrap;gap:8px;}',
      '.afk-cloud2-choice-btn{flex:1 1 160px;}',
      '.afk-cloud2-spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:afk-cloud2-spin .7s linear infinite;vertical-align:-2px;}',
      '@keyframes afk-cloud2-spin{to{transform:rotate(360deg);}}',
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

  // ----- 衝突視窗（本機/雲端二選一）：finish 先 resolve、closeLayer 後觸發，順序鐵則不可寫反 ---
  function cardHTML(side, warn) {
    var s = side.summary;
    var body = s
      ? '<div class="afk-cloud2-card-line">' + esc(s.cls) + ' Lv.' + esc(String(s.lv)) + (s.name ? '　' + esc(s.name) : '') + '</div>' +
        '<div class="afk-cloud2-card-line">更新於：' + esc(fmtTs(s.ts)) + '</div>' +
        '<div class="afk-cloud2-card-line">地點：' + esc(s.map || '未知') + '</div>'
      : '<div class="afk-cloud2-card-line">（無資料）</div>';
    return '<div class="afk-cloud2-card">' + '<div class="afk-cloud2-card-title">' + esc(side.title) + '</div>' + body +
      (warn ? '<div class="afk-cloud2-card-warn">⚠ 另一台裝置可能正在遊玩中，選它會蓋掉本機</div>' : '') + '</div>';
  }

  ui.showConflictModal = function (opts) {
    injectCss();
    return new Promise(function (resolve) {
      var done = false;
      var overlay = document.createElement('div');
      overlay.className = 'afk-cloud2-modal-overlay';
      overlay.innerHTML =
        '<div class="afk-cloud2-modal-card">' +
          '<div class="afk-cloud2-modal-cards">' + cardHTML(opts.left, false) + cardHTML(opts.right, !!opts.warnRight) + '</div>' +
          '<div class="afk-cloud2-modal-actions">' +
            '<button type="button" class="afk-cloud2-btn afk-cloud2-choice-btn" data-choice="left">' + esc(opts.leftLabel || '使用左側') + '</button>' +
            '<button type="button" class="afk-cloud2-btn afk-cloud2-choice-btn" data-choice="right">' + esc(opts.rightLabel || '使用右側') + '</button>' +
            '<button type="button" class="afk-cloud2-btn afk-cloud2-btn-secondary afk-cloud2-choice-btn" data-choice="cancel">' + esc(opts.cancelLabel || '取消') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      function finish(choice) { if (done) return; done = true; if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(choice); }
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

  // ----- 管理面板 --------------------------------------------------------------
  function panelBodyHTML() {
    if (!cfg.hasPairing()) {
      return '<div class="afk-cloud2-warn">換瀏覽器、清除瀏覽器資料、使用無痕模式，都會讀不到本機記住的配對碼。<br>產生配對碼後請記下來（建議截圖或抄下），換裝置/換瀏覽器需要手動輸入這組碼才能接回進度。</div>' +
        '<button type="button" class="afk-cloud2-btn" id="afk-cloud2-new-btn">🆕 產生新配對碼（綁定目前存檔位 ' + currentSlot + '）</button>' +
        '<div class="afk-cloud2-hint">或者，如果你已經有配對碼（例如在其他裝置產生過）：</div>' +
        '<input type="text" class="afk-cloud2-input" id="afk-cloud2-input" placeholder="輸入配對碼" maxlength="12" />' +
        '<button type="button" class="afk-cloud2-btn afk-cloud2-btn-secondary" id="afk-cloud2-use-btn">使用這組配對碼（綁定目前存檔位 ' + currentSlot + '）</button>';
    }
    var syncedAt = cfg.getSyncedAt();
    return '<div class="afk-cloud2-code">' + esc(cfg.getCode()) + '</div>' +
      '<div class="afk-cloud2-info">已綁定存檔位 ' + cfg.getBoundSlot() + '</div>' +
      '<div class="afk-cloud2-status" id="afk-cloud2-status">上次同步：' + esc(fmtTsShort(syncedAt)) + '</div>' +
      '<div class="afk-cloud2-hint">正常關閉遊戲或按下方「登出」時會自動同步；也可以隨時手動立即同步。</div>' +
      '<button type="button" class="afk-cloud2-btn" id="afk-cloud2-upload-btn">⬆️ 立即上傳到雲端</button>' +
      '<button type="button" class="afk-cloud2-btn afk-cloud2-btn-secondary" id="afk-cloud2-download-btn">⬇️ 從雲端下載到本機</button>' +
      '<div class="afk-cloud2-warn">請先正常退出遊戲以同步最新進度，再到其他裝置登入。</div>' +
      '<button type="button" class="afk-cloud2-btn afk-cloud2-btn-secondary" id="afk-cloud2-forget-btn">忘記這組配對碼（換裝置用）</button>';
  }

  function setStatus(msg, isErr) {
    var el = document.getElementById('afk-cloud2-status');
    if (el) { el.textContent = msg; el.classList.toggle('is-err', !!isErr); }
  }

  ui.refreshPanel = function () {
    var body = document.getElementById('afk-cloud2-panel-body');
    if (!body) return;
    body.innerHTML = panelBodyHTML();

    var newBtn = document.getElementById('afk-cloud2-new-btn');
    if (newBtn) newBtn.addEventListener('click', function () {
      newBtn.disabled = true; newBtn.innerHTML = '<span class="afk-cloud2-spin"></span> 產生中…';
      api.newCode().then(function (code) {
        cfg.setPairing(code, currentSlot);
        ui.toast('已產生配對碼，請記下來！', 'success');
        ui.refreshPanel();
        flow.upload('pairing-created');
      }).catch(function (err) { newBtn.disabled = false; newBtn.innerHTML = '🆕 產生新配對碼（綁定目前存檔位 ' + currentSlot + '）'; ui.toast('產生配對碼失敗：' + err.message, 'error'); });
    });

    var useBtn = document.getElementById('afk-cloud2-use-btn');
    if (useBtn) useBtn.addEventListener('click', function () {
      var input = document.getElementById('afk-cloud2-input');
      var code = (input && input.value || '').trim().toUpperCase();
      if (!code) { ui.toast('請先輸入配對碼'); return; }
      useBtn.disabled = true; useBtn.innerHTML = '<span class="afk-cloud2-spin"></span> 讀取中…';
      cfg.setPairing(code, currentSlot);
      flow.startupCheck();
      // startupCheck 是背景 fire-and-forget（沿用遊戲啟動時的邏輯，這裡是「輸入配對碼」這個等價時機），
      // 面板本身先切換到已綁定狀態，讓玩家看到目前狀態，實際比對結果由 toast/衝突視窗呈現。
      ui.refreshPanel();
    });

    var uploadBtn = document.getElementById('afk-cloud2-upload-btn');
    if (uploadBtn) uploadBtn.addEventListener('click', function () {
      uploadBtn.disabled = true; setStatus('同步中…');
      flow.upload('manual').then(function (r) {
        uploadBtn.disabled = false;
        if (r && r.ok) { ui.toast('✅ 已上傳到雲端', 'success'); ui.refreshPanel(); }
        else if (r && r.reason === 'no-data') setStatus('綁定的存檔位 ' + cfg.getBoundSlot() + ' 目前沒有角色資料，尚無需同步', true);
        else if (r && r.cancelled) setStatus('已取消');
        else setStatus('同步失敗', true);
      });
    });

    var downloadBtn = document.getElementById('afk-cloud2-download-btn');
    if (downloadBtn) downloadBtn.addEventListener('click', function () {
      downloadBtn.disabled = true; setStatus('讀取雲端中…');
      flow.download(true).then(function (r) {
        downloadBtn.disabled = false;
        if (r && r.ok) { ui.toast('✅ 已從雲端下載到本機', 'success'); ui.refreshPanel(); }
        else if (r && r.reason === 'no-remote') setStatus('雲端尚無資料', true);
        else if (r && r.cancelled) setStatus('已取消');
        else setStatus('下載失敗', true);
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
  function hidePanel() { var m = document.getElementById('afk-cloud2-panel-modal'); if (m) m.classList.remove('open'); _panelLayer = null; }
  function closePanel() { if (_panelLayer && window.AFK_UI) AFK_UI.closeLayer(_panelLayer); else hidePanel(); }
  ui.openPanel = function () {
    injectCss(); buildPanel(); ui.refreshPanel();
    document.getElementById('afk-cloud2-panel-modal').classList.add('open');
    _panelLayer = window.AFK_UI ? AFK_UI.openLayer(hidePanel) : null;
  };

  // ----- 掛進首頁「⚙ 其他功能」選單（由 afk-storage.js 渲染；未設定 API_BASE 時完全不出現） ---
  window.AFK_SETTINGS = window.AFK_SETTINGS || { _items: [], add: function (it) { this._items.push(it); } };
  AFK_SETTINGS.add({ label: '☁️ 配對碼雲端同步', visible: function () { return cfg.isConfigured(); }, onClick: ui.openPanel });

  // 2026-07-09 使用者明訂：不攔截 chooseSlot/loadGame，正常存檔/讀檔完全不碰雲端；
  // 也不在遊戲啟動時自動跑 flow.startupCheck()——雲端同步只在玩家主動按面板按鈕時才發生
  // (見上面「上傳時機」註解)。flow.startupCheck 仍保留給「使用配對碼」按鈕主動呼叫。

  console.log('[AFK-cloud-sync-v2] hooks OK — ' + (cfg.isConfigured() ? '已設定服務網址' : '尚未設定服務網址，僅本機配對碼記錄生效，不會呼叫任何雲端 API') + '。');
})();
