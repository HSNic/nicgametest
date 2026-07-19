/* ============================================================================
 * afk-diagnostics.js — 效能診斷(首頁「📋 紀錄」小選單裡的「⚙️ 效能診斷」,桌機/手機都適用)
 *
 * 為什麼:玩家反映手機玩久了會發燙,但開發者看不到玩家手機當下的實際狀況(FPS掉了多少、
 *   記憶體用多少、是不是背景一直在跑…)。這支外掛在背景持續蒐集這些訊號,玩家覺得不對勁時
 *   按一顆「產生並下載診斷報告」,把 .json 檔傳給開發者比對。
 *
 * 蒐集內容(四大類,對應使用者要求):
 *   1. 效能數據:畫面更新間隔(用 requestAnimationFrame 估算 FPS/掉幀)、記憶體用量
 *      (performance.memory,僅 Chrome 系支援)、背包/日誌節點數量。
 *   2. 裝置/環境:UA、螢幕解析度、是否為已安裝 PWA(standalone)、電池電量(navigator.getBattery,
 *      iOS Safari 不支援時老實標「不支援」)。
 *   3. 遊戲內狀態快照:目前地圖、外掛版本清單(讀 index.html 各 <script src> 的 ?v=)、
 *      Service Worker 快取版本、最近幾則 console 錯誤/警告。
 *   4. 長時間背景執行偵測:記錄 visibilitychange 次數與時間點,推斷是否曾被瀏覽器凍結又喚醒。
 *
 * 擴充性:往後要加其他 bug 診斷項目,呼叫 window.AFK_DIAG.addCollector(key, fn) 註冊一個
 *   蒐集器即可(fn 可回傳同步值或 Promise),不用改這支檔案裡產生報告/下載的流程。
 *
 * 純唯讀:只讀取瀏覽器/遊戲狀態,不寫入、不修改任何存檔或設定。
 * 優雅降級:抓不到 #main-menu 就安靜停用;個別 API(電池/記憶體)不支援就標記「不支援」,
 *   不影響其餘欄位蒐集。
 * 掛接:在 index.html 的 </body> 前加一行 <script src="afk-diagnostics.js"></script>
 * ========================================================================== */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // ---- 1. 效能數據:背景持續用 rAF 量測畫面更新間隔 -------------------------
  var FRAME_WINDOW_MS = 30000;   // 只保留最近 30 秒的取樣,避免陣列無限長
  var _frames = [];              // 每筆 {t, dt}(dt = 與上一幀的間隔 ms)
  var _lastFrameT = null;
  function frameLoop(t) {
    // 分頁切到背景時 rAF 會被瀏覽器降頻甚至暫停,恢復可視的第一幀跟上一次記錄的時間差
    // 會是「背景那段時間」而不是真正的畫面卡頓,混進平均值會嚴重失真(這段落差已經由
    // 下面的 visibilitychange 偵測另外記錄了),所以背景中/剛恢復可視的樣本一律不採計。
    if (document.hidden) {
      _lastFrameT = null;
    } else if (_lastFrameT != null) {
      var dt = t - _lastFrameT;
      _frames.push({ t: t, dt: dt });
      var cutoff = t - FRAME_WINDOW_MS;
      while (_frames.length && _frames[0].t < cutoff) _frames.shift();
    }
    _lastFrameT = t;
    requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);

  function perfSnapshot() {
    var n = _frames.length;
    var out = { sampleCount: n, windowMs: FRAME_WINDOW_MS };
    if (n) {
      var sum = 0, max = 0;
      for (var i = 0; i < n; i++) { sum += _frames[i].dt; if (_frames[i].dt > max) max = _frames[i].dt; }
      var avg = sum / n;
      out.avgFrameMs = Math.round(avg * 100) / 100;
      out.maxFrameMs = Math.round(max * 100) / 100;
      out.estFps = Math.round((1000 / avg) * 10) / 10;
    } else {
      out.note = '取樣不足(頁面才剛載入或分頁在背景)。';
    }
    if (performance.memory) {
      out.memoryMB = {
        used: Math.round(performance.memory.usedJSHeapSize / 1048576),
        total: Math.round(performance.memory.totalJSHeapSize / 1048576),
        limit: Math.round(performance.memory.jsHeapSizeLimit / 1048576)
      };
    } else {
      out.memoryMB = '不支援(僅 Chrome 系瀏覽器提供 performance.memory)';
    }
    try {
      var bagCount = document.querySelectorAll('#inventory-list [id], #inventory-list li, #inventory-list .item-slot').length;
      out.domCounts = {
        bodyNodes: document.body.getElementsByTagName('*').length,
        combatLogLines: (document.getElementById('combat-log-panel') || {}).childElementCount || 0,
        sysLogLines: (document.getElementById('sys-log') || {}).childElementCount || 0
      };
    } catch (e) { out.domCounts = '量測失敗:' + e.message; }
    return out;
  }

  // ---- 2. 裝置/環境資訊 -----------------------------------------------------
  function envSnapshotSync() {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform || '',
      screen: { width: screen.width, height: screen.height, dpr: window.devicePixelRatio || 1 },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      standalonePWA: !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || !!window.navigator.standalone,
      language: navigator.language,
      onLine: navigator.onLine,
      hardwareConcurrency: navigator.hardwareConcurrency || '不支援'
    };
  }
  function batterySnapshot() {
    if (typeof navigator.getBattery !== 'function') return Promise.resolve('不支援(此瀏覽器沒有 Battery API,常見於 iOS Safari)');
    return navigator.getBattery().then(function (b) {
      return { level: Math.round(b.level * 100) + '%', charging: b.charging };
    }).catch(function (e) { return '讀取失敗:' + e.message; });
  }

  // ---- 3. 遊戲內狀態快照 -----------------------------------------------------
  function pluginVersionList() {
    var out = [];
    document.querySelectorAll('script[src^="afk-"]').forEach(function (s) {
      out.push(s.getAttribute('src'));
    });
    return out;
  }
  function swSnapshot() {
    var out = { controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller) };
    if (!navigator.serviceWorker) { out.note = '此瀏覽器不支援 Service Worker'; return Promise.resolve(out); }
    return caches.keys().then(function (keys) {
      out.cacheNames = keys;
      return fetch('version.json?cb=' + Date.now()).then(function (r) { return r.json(); }).then(function (v) {
        out.versionJson = v;
        return out;
      }).catch(function () { out.versionJson = '讀取 version.json 失敗'; return out; });
    }).catch(function (e) { out.note = '讀取快取清單失敗:' + e.message; return out; });
  }
  function gameStateSnapshot() {
    var out = {};
    try {
      out.currentMap = (typeof mapState !== 'undefined' && mapState) ? mapState.current : '未進入遊戲';
      out.playerLv = (typeof player !== 'undefined' && player) ? player.lv : null;
      out.playerCls = (typeof player !== 'undefined' && player) ? player.cls : null;
      out.mobileMode = document.body.classList.contains('m-mobile');
      out.fastForward = !!(typeof state !== 'undefined' && state && state.ff);
    } catch (e) { out.error = e.message; }
    out.pluginVersions = pluginVersionList();
    return out;
  }

  // ---- console 錯誤/警告 攔截(只從這支外掛載入之後開始收,舊的抓不到) -------
  var MAX_LOG_KEEP = 20;
  var _consoleErrors = [];
  function pushConsoleEntry(kind, args) {
    if (_consoleErrors.length >= MAX_LOG_KEEP) _consoleErrors.shift();
    try {
      _consoleErrors.push({ t: new Date().toISOString(), kind: kind, msg: Array.prototype.map.call(args, String).join(' ').slice(0, 500) });
    } catch (e) {}
  }
  (function hookConsole() {
    ['error', 'warn'].forEach(function (kind) {
      var orig = console[kind];
      console[kind] = function () {
        pushConsoleEntry(kind, arguments);
        return orig.apply(console, arguments);
      };
    });
    window.addEventListener('error', function (e) {
      pushConsoleEntry('uncaught', [e.message + ' @ ' + e.filename + ':' + e.lineno]);
    });
    window.addEventListener('unhandledrejection', function (e) {
      pushConsoleEntry('promise-rejection', [String(e.reason)]);
    });
  })();

  // ---- 4. 長時間背景執行偵測 -------------------------------------------------
  var MAX_VIS_KEEP = 50;
  var _visEvents = [];
  var _hiddenSince = null;
  document.addEventListener('visibilitychange', function () {
    var hidden = document.hidden;
    var now = Date.now();
    if (_visEvents.length >= MAX_VIS_KEEP) _visEvents.shift();
    var entry = { t: new Date(now).toISOString(), toHidden: hidden };
    if (!hidden && _hiddenSince != null) {
      entry.hiddenDurationSec = Math.round((now - _hiddenSince) / 1000);
    }
    if (hidden) _hiddenSince = now; else _hiddenSince = null;
    _visEvents.push(entry);
  });

  // ---- 蒐集器登錄檔(可插拔,供未來擴充其他 bug 診斷項目) ---------------------
  var _extraCollectors = [];   // [{key, fn}]
  window.AFK_DIAG = window.AFK_DIAG || {
    addCollector: function (key, fn) { _extraCollectors.push({ key: key, fn: fn }); }
  };

  function buildReport() {
    var report = {
      generatedAt: new Date().toISOString(),
      note: '此檔案只包含瀏覽器/遊戲的效能與環境資訊,不含帳號密碼等機敏資料。',
      perf: perfSnapshot(),
      env: envSnapshotSync(),
      gameState: gameStateSnapshot(),
      backgroundEvents: _visEvents.slice(),
      recentConsole: _consoleErrors.slice(),
      offlineProfile: offlineProfileJson()
    };
    if (!report.offlineProfile) report.offlineProfileReason = 'no-last-report';
    var tasks = [
      batterySnapshot().then(function (b) { report.env.battery = b; }),
      swSnapshot().then(function (s) { report.serviceWorker = s; })
    ];
    _extraCollectors.forEach(function (c) {
      tasks.push(Promise.resolve().then(function () { return c.fn(); }).then(function (v) {
        report.extra = report.extra || {};
        report.extra[c.key] = v;
      }).catch(function (e) {
        report.extra = report.extra || {};
        report.extra[c.key] = '蒐集失敗:' + e.message;
      }));
    });
    return Promise.all(tasks).then(function () { return report; });
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function downloadReport() {
    var btn = document.getElementById('m-diag-gen-btn');
    if (btn) { btn.disabled = true; btn.textContent = '產生中…'; }
    buildReport().then(function (report) {
      var d = new Date();
      var fname = 'lineage-diag_' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.json';
      var blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      if (btn) { btn.disabled = false; btn.textContent = '✅ 已下載,再產生一次'; }
    }).catch(function (e) {
      if (btn) { btn.disabled = false; btn.textContent = '產生失敗,再試一次'; }
      console.warn('[AFK-diagnostics] 產生診斷報告失敗:', e);
    });
  }

  // ---- 離線結算效能(讀 afk-offline-profiler.js 蒐集到的最近一次補跑報告) -----
  // 只讀 window.AFKOfflineProfiler.getLastReport(),不碰 afk-offline.js 本體;
  // 目前報告裡還沒有 ticks/tickMs/settleDeadMobsMs/gainItemMs/saveGameMs 這幾項
  // (需要改本體才能量測,屬於下一階段的工作),複製出來的 JSON 先誠實只含現有欄位。
  function offlineProfileSection() {
    var api = window.AFKOfflineProfiler;
    var report = api && typeof api.getLastReport === 'function' ? api.getLastReport() : null;
    if (!report) {
      return (
        '<div class="m-diag-offline">' +
          '<div class="m-diag-offline-title">🕒 離線結算效能</div>' +
          '<div class="m-diag-desc">目前還沒有離線補跑紀錄(登入時如果經過離線掛機,結算完成後這裡會顯示最近一次的耗時明細)。</div>' +
        '</div>'
      );
    }
    var t = report.timings, c = report.counts;
    var rows = [
      ['離線秒數', report.offlineSeconds],
      ['總耗時', t.totalMs + ' ms'],
      ['Fast Mode', t.fastModeMs + ' ms'],
      ['Boss', t.bossMs + ' ms'],
      ['Loot', t.lootMs + ' ms'],
      ['Batch', t.batchMs + ' ms'],
      ['UI', t.uiMs + ' ms'],
      ['全模擬', t.fullSimMs + ' ms'],
      ['擊殺數', c.monsterKills],
      ['Boss數', c.bossKills]
    ];
    var rowsHtml = rows.map(function (r) {
      return '<div class="m-diag-row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>';
    }).join('');
    return (
      '<div class="m-diag-offline">' +
        '<div class="m-diag-offline-title">🕒 離線結算效能(最近一次)</div>' +
        '<div class="m-diag-live">' + rowsHtml + '</div>' +
        '<button id="m-diag-offline-copy-btn" type="button">📋 複製離線結算JSON</button>' +
      '</div>'
    );
  }

  function offlineProfileJson() {
    var api = window.AFKOfflineProfiler;
    var report = api && typeof api.getLastReport === 'function' ? api.getLastReport() : null;
    if (!report) return null;
    var out = {
      generatedAt: new Date().toISOString(),
      mode: null, map: null, cls: null, level: null,   // 目前只能在外掛層讀取「複製當下」的狀態,不代表補跑當時
      offlineSeconds: report.offlineSeconds,
      timings: report.timings,
      counts: report.counts,
      rewards: report.rewards,
      averages: report.averages,
      flags: report.flags,
      errors: report.errors,
      note: 'ticks/tickMs/settleDeadMobsMs/gainItemMs/saveGameMs 尚未實作(需改afk-offline.js本體,見交接待辦第二階段)。'
    };
    try {
      out.map = (typeof mapState !== 'undefined' && mapState) ? mapState.current : null;
      out.cls = (typeof player !== 'undefined' && player) ? player.cls : null;
      out.level = (typeof player !== 'undefined' && player) ? player.lv : null;
    } catch (e) {}
    return out;
  }

  function copyOfflineProfileJson() {
    var btn = document.getElementById('m-diag-offline-copy-btn');
    var data = offlineProfileJson();
    if (!data) return;
    var text = JSON.stringify(data, null, 2);
    var done = function (ok) { if (btn) btn.textContent = ok ? '✅ 已複製' : '複製失敗,請手動截圖'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }).catch(function () { done(false); });
    } else {
      done(false);
    }
  }

  // ---- 彈窗 UI(比照 afk-storage.js 的既有 modal 風格) -----------------------
  function renderLiveBody() {
    var p = perfSnapshot();
    var mem = (p.memoryMB && p.memoryMB.used != null) ? (p.memoryMB.used + ' / ' + p.memoryMB.limit + ' MB') : String(p.memoryMB);
    return (
      '<div class="m-diag-live">' +
        '<div class="m-diag-row"><span>目前 FPS 估計</span><b>' + (p.estFps != null ? p.estFps : '取樣中…') + '</b></div>' +
        '<div class="m-diag-row"><span>平均 / 最慢一幀</span><b>' + (p.avgFrameMs != null ? (p.avgFrameMs + 'ms / ' + p.maxFrameMs + 'ms') : '取樣中…') + '</b></div>' +
        '<div class="m-diag-row"><span>記憶體用量</span><b>' + mem + '</b></div>' +
      '</div>' +
      offlineProfileSection() +
      '<div class="m-diag-desc">如果覺得玩起來發燙、變慢、卡頓,按下面的按鈕產生一份診斷報告(.json 檔),' +
      '傳給開發者比對就可以了。報告只包含效能/裝置/遊戲狀態等技術資訊,不含帳號密碼。</div>' +
      '<button id="m-diag-gen-btn" type="button">📥 產生並下載診斷報告</button>' +
      '<div class="m-diag-foot">純唯讀,不會更動任何存檔或設定。</div>'
    );
  }

  var _layer = null;
  function refreshLive() {
    var body = document.getElementById('m-diag-body');
    if (body && document.getElementById('m-diag-modal').classList.contains('open')) {
      body.innerHTML = renderLiveBody();
      var b = document.getElementById('m-diag-gen-btn');
      if (b) b.addEventListener('click', downloadReport);
      var ob = document.getElementById('m-diag-offline-copy-btn');
      if (ob) ob.addEventListener('click', copyOfflineProfileJson);
    }
  }
  var _liveTimer = null;
  function openModal() {
    var m = document.getElementById('m-diag-modal'); if (!m) return;
    refreshLive();
    if (_liveTimer) clearInterval(_liveTimer);
    _liveTimer = setInterval(refreshLive, 2000);
    m.classList.add('open');
    _layer = window.AFK_UI ? AFK_UI.openLayer(hideModal) : null;
  }
  function hideModal() {
    var m = document.getElementById('m-diag-modal'); if (m) m.classList.remove('open');
    if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
    _layer = null;
  }
  function closeModal() { if (_layer && window.AFK_UI) AFK_UI.closeLayer(_layer); else hideModal(); }

  function buildModal() {
    if (document.getElementById('m-diag-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'm-diag-modal';
    modal.innerHTML =
      '<div id="m-diag-card">' +
        '<div id="m-diag-head">' +
          '<span id="m-diag-title">⚙️ 效能診斷</span>' +
          '<button id="m-diag-close" title="關閉">✕</button>' +
        '</div>' +
        '<div id="m-diag-body"></div>' +
      '</div>';
    document.body.appendChild(modal);
    document.getElementById('m-diag-close').addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
  }

  function injectCSS() {
    if (document.getElementById('m-diag-style')) return;
    var s = document.createElement('style');
    s.id = 'm-diag-style';
    s.textContent = [
      '#m-diag-modal{display:none;position:fixed;inset:0;z-index:1000;background:rgba(2,6,23,0.82);align-items:flex-start;justify-content:center;padding:24px 12px;font-family:system-ui,"Segoe UI",sans-serif;}',
      '#m-diag-modal.open{display:flex;}',
      '#m-diag-card{width:min(480px,96vw);max-height:calc(100dvh - 48px);display:flex;flex-direction:column;background:#0f172a;border:1px solid #334155;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;}',
      '#m-diag-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #1e293b;flex:0 0 auto;}',
      '#m-diag-title{font-size:16px;font-weight:bold;color:#fff;}',
      '#m-diag-close{width:34px;height:34px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;border-radius:8px;font-size:15px;cursor:pointer;line-height:1;}',
      '#m-diag-close:active{background:#334155;}',
      '#m-diag-body{flex:1 1 auto;overflow-y:auto;padding:14px;}',
      '.m-diag-live{display:flex;flex-direction:column;gap:8px;margin-bottom:14px;}',
      '.m-diag-row{display:flex;align-items:baseline;justify-content:space-between;background:#111c30;border:1px solid #1e293b;border-radius:8px;padding:8px 11px;font-size:13px;color:#cbd5e1;}',
      '.m-diag-row b{color:#fcd34d;font-size:14px;}',
      '.m-diag-offline{margin-bottom:14px;padding:10px;background:#0c1424;border:1px solid #1e293b;border-radius:9px;}',
      '.m-diag-offline-title{color:#e2e8f0;font-size:13.5px;font-weight:bold;margin-bottom:8px;}',
      '#m-diag-offline-copy-btn{width:100%;margin-top:6px;padding:8px;border-radius:8px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font-size:13px;cursor:pointer;}',
      '#m-diag-offline-copy-btn:active{background:#334155;}',
      '.m-diag-desc{color:#94a3b8;font-size:12.5px;line-height:1.6;margin-bottom:12px;}',
      '#m-diag-gen-btn{width:100%;padding:11px;border-radius:9px;border:1px solid #d97706;background:#b45309;color:#fef3c7;font-size:14px;font-weight:bold;cursor:pointer;}',
      '#m-diag-gen-btn:active{background:#92400e;}',
      '#m-diag-gen-btn:disabled{opacity:.6;cursor:default;}',
      '.m-diag-foot{color:#64748b;font-size:11.5px;text-align:center;margin-top:10px;}'
    ].join('');
    document.head.appendChild(s);
  }

  function init() {
    var menu = document.getElementById('main-menu');
    if (!menu) { console.warn('[AFK-diagnostics] 找不到 #main-menu,診斷功能停用。'); return; }
    injectCSS();
    buildModal();
    window.AFK_SETTINGS = window.AFK_SETTINGS || { _items: [], add: function (it) { this._items.push(it); } };
    AFK_SETTINGS.add({ label: '⚙️ 效能診斷', onClick: openModal });

    console.log('[AFK-diagnostics] hooks OK — 效能診斷已註冊進「📋 紀錄」小選單。');
  }

  ready(init);
})();
