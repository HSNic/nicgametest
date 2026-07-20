/* ============================================================================
 * afk-online-profile.js — 線上遊玩效能量測(2026-07-20 效能優化參考報告核對交接·第三優先項)
 *
 * 為什麼:目前的離線結算 profiler(afk-offline-profiler.js)只量得到「補跑」的耗時,使用者
 *   回報「線上邊玩邊掛機也會發燙」完全沒有數據可看,不知道是 tick(戰鬥運算本體)慢、
 *   render(畫面重繪)慢、還是其他原因。本外掛先把數據量出來,供之後判斷要不要動手優化,
 *   這一步本身不改任何戰鬥/收益/render邏輯,純觀測。
 *
 * 做法:用 AFK_HOOK.wrap()(afk-hook.js 提供,支援多個外掛各自用不同 namespace 包同一個
 *   函式、互不干擾)分別包住 tick()/flushTickRender()/gameLoop() 三個函式,只在呼叫前後
 *   各記一次時間戳、相減記錄耗時,完全不碰這些函式的參數/回傳值/行為。
 *   - tick():戰鬥/狀態運算本體(js/03-combat-core.js) → tickMs
 *   - flushTickRender():畫面重繪合併(js/03-combat-core.js) → renderMs
 *   - gameLoop():每 100ms 跑一次的外層主迴圈(含上面兩者+其他開銷) → frameMs
 *   三組各自維護一個「最近 30 秒」的滾動樣本陣列(比照 afk-diagnostics.js 既有的 FPS
 *   估算陣列同一種寫法),超出時間窗的舊樣本會被丟棄,不會無限增長。
 *
 * 🔘 2026-07-20 使用者要求新增「追蹤開關」(預設關閉,避免造成額外負擔):
 *   - 關閉時,wrapTimed 的包裝函式直接透傳給原函式,連 performance.now() 計時都不做,
 *     開銷趨近於零(只多一層 AFK_HOOK.wrap 既有的函式呼叫,跟開啟前完全一樣)。
 *   - 開關狀態存 localStorage(afk_online_profile_enabled),跨 session 記住使用者選擇。
 *   - 關閉的當下,把「這次開啟期間累積的最後一份數據」凍結成 lastReport(存 localStorage),
 *     之後不管是遊戲內的統計分頁、還是首頁的效能診斷面板,都能看到「已停止,最近一次量測結果」,
 *     不會因為關閉/切回首頁就看不到剛剛量到的東西。重新打開追蹤後,會重新開始累積,不接續舊資料。
 *
 * 對外接口:
 *   - window.AFK_ONLINE_PROFILE.snapshot() → 即時的滾動視窗統計(不管開關狀態,單純讀目前
 *     buckets 累積的東西;開關關閉時樣本不會再增加,所以會停在關閉當下的樣子)。
 *   - window.AFK_ONLINE_PROFILE.isEnabled() / setEnabled(bool) → 讀取/切換追蹤開關。
 *   - window.AFK_ONLINE_PROFILE.getLastReport() → 讀取「最近一次關閉時凍結」的報告(沒有則 null)。
 *   - window.AFK_ONLINE_PROFILE.reportForDisplay() → 給畫面/診斷報告用的「這次該顯示什麼」
 *     統一邏輯:追蹤中回傳即時 snapshot()(標 live:true);已關閉回傳 lastReport(標 live:false),
 *     兩種情境都在同一支函式裡決定,呼叫端(afk-diagnostics.js/遊戲內統計分頁)不用各自判斷。
 *   沒有樣本時仍回傳結構完整的物件(ok:true, tickCount:0, reason:...),不是 undefined/null,
 *   避免呼叫端誤判成「這支外掛壞了」。
 *
 * 優雅降級:找不到 window.AFK_HOOK(代表 afk-hook.js 沒有先載入)或找不到
 *   tick/flushTickRender/gameLoop 任一全域函式,就 console.warn 並安靜停用,不影響遊戲。
 *   AFK_HOOK.wrap() 本身有 try/catch 保護,單一函式包裝失敗會自動退回原函式,不會拖垮遊戲。
 *
 * 掛接:在 index.html </body> 前加一行
 *   <script src="afk-online-profile.js?v=..."></script>
 *   必須排在 afk-hook.js、afk-hook-bind.js 之後(依賴 AFK_HOOK.wrap)。
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof window.AFK_HOOK === 'undefined' || typeof window.AFK_HOOK.wrap !== 'function') {
    console.warn('[AFK-online-profile] 找不到 AFK_HOOK,略過(afk-hook.js 沒有先載入?)');
    return;
  }
  const NS = 'afkOnlineProfile';
  const WINDOW_MS = 30000;   // 只保留最近 30 秒樣本,避免長時間遊玩陣列無限增長
  const ENABLED_KEY = 'afk_online_profile_enabled';
  const LAST_REPORT_KEY = 'afk_online_profile_last_report';

  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

  // 追蹤開關:預設關閉(使用者明訂,避免沒開效能診斷時也持續量測造成額外負擔)。
  var enabled = false;
  try { var _es = localStorage.getItem(ENABLED_KEY); if (_es !== null) enabled = _es === '1'; } catch (e) {}
  var lastReport = null;
  try { var _lr = localStorage.getItem(LAST_REPORT_KEY); if (_lr) lastReport = JSON.parse(_lr); } catch (e) {}

  // 每組樣本各自一個 {t, ms} 陣列;t 用來判斷是否過期,ms 是這次呼叫耗時。
  function makeBucket() {
    var arr = [];
    return {
      push: function (ms) {
        var t = now();
        arr.push({ t: t, ms: ms });
        var cutoff = t - WINDOW_MS;
        while (arr.length && arr[0].t < cutoff) arr.shift();
      },
      stats: function () {
        var n = arr.length;
        if (!n) return null;
        var sum = 0, max = 0;
        for (var i = 0; i < n; i++) { sum += arr[i].ms; if (arr[i].ms > max) max = arr[i].ms; }
        return { count: n, avgMs: Math.round((sum / n) * 100) / 100, maxMs: Math.round(max * 100) / 100 };
      }
    };
  }

  var tickBucket = makeBucket();
  var renderBucket = makeBucket();
  var frameBucket = makeBucket();
  var wrapped = { tick: false, flushTickRender: false, gameLoop: false };

  function wrapTimed(name, bucket) {
    if (typeof window[name] !== 'function') {
      console.warn('[AFK-online-profile] 找不到全域函式 ' + name + ',這項不量測。');
      return;
    }
    AFK_HOOK.wrap(window, name, function (orig, args) {
      if (!enabled) return orig(...args);   // 關閉時連計時都不做,開銷趨近於零
      var t0 = now();
      var r = orig(...args);
      bucket.push(now() - t0);
      return r;
    }, NS);
    wrapped[name] = true;
  }

  wrapTimed('tick', tickBucket);
  wrapTimed('flushTickRender', renderBucket);
  wrapTimed('gameLoop', frameBucket);

  function snapshot() {
    var ts = tickBucket.stats(), rs = renderBucket.stats(), fs = frameBucket.stats();
    if (!ts && !rs && !fs) {
      return { ok: true, sampleWindowMs: WINDOW_MS, tickCount: 0, reason: 'no-samples-yet', wrapped: wrapped };
    }
    return {
      ok: true,
      sampleWindowMs: WINDOW_MS,
      tickCount: ts ? ts.count : 0,
      avgTickMs: ts ? ts.avgMs : null,
      maxTickMs: ts ? ts.maxMs : null,
      renderCount: rs ? rs.count : 0,
      avgRenderMs: rs ? rs.avgMs : null,
      maxRenderMs: rs ? rs.maxMs : null,
      frameCount: fs ? fs.count : 0,
      avgFrameMs: fs ? fs.avgMs : null,
      maxFrameMs: fs ? fs.maxMs : null,
      wrapped: wrapped
    };
  }

  function isEnabled() { return enabled; }

  function setEnabled(v) {
    v = !!v;
    if (v === enabled) return;
    if (!v) {
      // 關閉的當下:把目前累積的樣本凍結成 lastReport,存起來給之後(含回首頁)查看。
      var snap = snapshot();
      snap.live = false;
      snap.stoppedAt = new Date().toISOString();
      lastReport = snap;
      try { localStorage.setItem(LAST_REPORT_KEY, JSON.stringify(lastReport)); } catch (e) {}
    }
    enabled = v;
    try { localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0'); } catch (e) {}
  }

  function getLastReport() { return lastReport; }

  function reportForDisplay() {
    if (enabled) {
      var p = snapshot();
      p.live = true;
      return p;
    }
    if (lastReport) return lastReport;
    return { ok: true, live: false, tickCount: 0, reason: 'disabled-no-report' };
  }

  window.AFK_ONLINE_PROFILE = {
    snapshot: snapshot,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    getLastReport: getLastReport,
    reportForDisplay: reportForDisplay
  };

  /* --------------------------------------------------------------------------
   * 2026-07-20(使用者回報):效能診斷面板只掛在首頁(#main-menu),玩家真正在遊戲裡時完全
   * 打不開,導致這份「線上遊玩效能」數據做了卻用不到(數據只在遊戲中才會累積,但面板卻
   * 只能在沒玩的時候看)。解法:monkey-patch 原作 renderAuditTab()(js/05-kill-progression.js,
   * 遊戲內「統計」分頁,本來就每 2 秒自動刷新一次),渲染完後在下面追加一小塊摘要+追蹤開關。
   * 只讀/寫本檔自己的 API,不改 renderAuditTab 的參數/回傳值/原本內容。
   * 何時可移除:原作者自己在統計分頁加了效能數據,或改成不整段 innerHTML 重建時,
   *   這段可能需要跟著調整(目前用「每次渲染完就重新追加」的方式繞過整段替換)。
   * ------------------------------------------------------------------------ */
  (function () {
    function fmtStats(p) {
      return 'tick ' + p.tickCount + ' 次｜平均/最慢 tick ' + p.avgTickMs + 'ms/' + p.maxTickMs + 'ms' +
        '｜render ' + p.avgRenderMs + 'ms/' + p.maxRenderMs + 'ms' +
        '｜主迴圈 ' + p.avgFrameMs + 'ms/' + p.maxFrameMs + 'ms';
    }
    function summaryHtml() {
      var p = reportForDisplay();
      if (p.tickCount === 0) {
        return p.live === false && p.reason !== 'disabled-no-report'
          ? '已停止(尚未有紀錄)。'
          : (isEnabled() ? '尚未取樣到資料(需在遊戲中持續掛機一陣子)。' : '追蹤已關閉,勾選「追蹤」開始量測。');
      }
      if (p.live === false) {
        var when = p.stoppedAt ? new Date(p.stoppedAt).toLocaleTimeString('zh-TW', { hour12: false }) : '';
        return '已停止(最近一次 ' + when + ')：' + fmtStats(p);
      }
      return fmtStats(p);
    }
    function appendBlock() {
      var el = document.getElementById('tab-audit');
      if (!el || el.classList.contains('hidden')) return;
      // ⚠️ renderAuditTab 有幾個提早 return 的分支(使用者正在輸入追蹤目標時整段不重繪)不會清掉
      //   舊的 innerHTML,若每次都無條件 appendChild 新節點,這幾個分支會讓區塊越疊越多份。
      //   改成「找到既有節點就直接更新內容,找不到才新增」,同一個 tab-audit 底下永遠只有一份。
      // el.innerHTML 整段重建時,舊的 box 節點會被拔離文件(document.getElementById 找不到已拔離的
      //   節點),故這裡的查詢只會在「這次沒有整段重建」時抓到既有節點、其餘情況一律視為新建。
      var box = document.getElementById('m-online-profile-audit');
      if (!box) {
        box = document.createElement('div');
        box.id = 'm-online-profile-audit';
        box.style.cssText = 'margin-top:10px;padding:8px 10px;background:rgba(15,23,42,.6);border:1px solid #1e293b;border-radius:8px;font-size:12px;color:#94a3b8;line-height:1.6;';
        el.appendChild(box);
      }
      box.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
          '<span style="color:#e2e8f0;font-weight:bold;">🎮 線上遊玩效能</span>' +
          '<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#94a3b8;cursor:pointer;">' +
            '<input type="checkbox" ' + (isEnabled() ? 'checked' : '') +
            ' onchange="window.AFK_ONLINE_PROFILE.setEnabled(this.checked)" style="width:14px;height:14px;">追蹤' +
          '</label>' +
        '</div>' +
        '<div style="margin-top:4px;">' + summaryHtml() + '</div>';
    }
    function install() {
      if (typeof window.renderAuditTab !== 'function' || window.renderAuditTab.__onlineProfileAppend) return true;
      var orig = window.renderAuditTab;
      var wrapped2 = function () {
        var r = orig.apply(this, arguments);
        try { appendBlock(); } catch (e) {}
        return r;
      };
      wrapped2.__onlineProfileAppend = true;
      window.renderAuditTab = wrapped2;
      return true;
    }
    try {
      if (!install()) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
        else setTimeout(install, 0);
      }
    } catch (e) { console.warn('[AFK-online-profile] 統計分頁追加區塊安裝失敗,已略過:', e); }
  })();

  console.log('[AFK-online-profile] hooks OK — 線上遊玩效能量測已就緒(預設關閉,遊戲內「統計」分頁可開啟)。');
})();
