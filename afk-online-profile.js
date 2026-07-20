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
 * 對外接口:window.AFK_ONLINE_PROFILE.snapshot() → 回傳目前彙整的統計數據(給
 *   afk-diagnostics.js 的「線上遊玩效能」區塊 / 診斷報告 JSON 讀取)。沒有樣本時
 *   仍回傳結構完整的物件(ok:true, tickCount:0, reason:'no-samples-yet'),不是
 *   undefined/null,避免呼叫端誤判成「這支外掛壞了」。
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

  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

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

  window.AFK_ONLINE_PROFILE = { snapshot: snapshot };

  console.log('[AFK-online-profile] hooks OK — 線上遊玩效能量測已啟用(純觀測,不影響戰鬥/收益)。');
})();
