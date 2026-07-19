/* ============================================================================
 * afk-batch-settle.js — 首頁設定選單「⏱️ 批次結算所有存檔位」:依序把每個存檔位的
 * 離線收益都結算一次,各自的收益歸各自角色(不是拿A角色戰力幫B角色打怪)。
 *
 * 為什麼:afk-offline.js 是 per-slot 設計,只結算「目前這個分頁開著」的那個存檔位。
 *   玩家有多個角色時,要讓每個角色都吃到離線結算,得逐一開分頁登入。本外掛把
 *   「開N次分頁」自動化成「開1次、跑N輪」:依序 currentSlot=n; loadGame();,
 *   重用 afk-offline.js 現有的 per-slot 離線補跑機制(它本來就會在 loadGame 時
 *   自動判斷離線多久、要不要結算),不重寫任何補算邏輯。
 *
 * 關鍵技術問題與解法:runCatchup(離線補跑本體)是 async 且用 requestAnimationFrame
 *   分片執行,loadGame() 呼叫後不會等它跑完就回傳——若不知道「這個存檔位到底跑完
 *   了沒」就接著換下一個存檔位,兩個存檔位的補跑會在同一個全域 player/state 上
 *   互相踩到。afk-offline.js 已補上 window.__afk.busy(補跑中旗標)與
 *   window.__afk.last(最近一次補跑結果摘要)兩個對外欄位(見該檔 runCatchup 開頭/
 *   結尾與頂部 window.__afk 宣告的註解),本外掛靠輪詢 busy 知道何時可以換下一格,
 *   靠 last 讀出這一格的結算結果。
 *
 * 安全限制:
 *   - 只搬用既有的 loadGame() 路徑,不直接碰 localStorage 存檔內容,不重寫任何存檔規則。
 *   - 跨分頁風險無法前端偵測(若某存檔位同時開著別的分頁在玩,可能互相覆蓋),
 *     只在開始前的確認彈窗提醒玩家自行避開。
 *   - 結算完成後,若一開始就有角色在玩(originLive),結束時自動換回原本的存檔位;
 *     若是從首頁(尚未登入)觸發,結束後整頁重新整理回到乾淨的首頁,不留在批次跑完
 *     的最後一個角色畫面(避免玩家誤以為「自動登入了某個角色」)。
 *   - 過程中蓋一層不可關閉的遮罩,避免玩家中途誤觸其他操作打斷正在進行的補跑。
 *   - 每格設等待逾時(MAX_WAIT_MS),避免極端情況(補跑卡死)讓整個批次永遠卡住。
 *   - 完成後提示「記得手動上傳雲端同步」,理由同 afk-asset-manager.js。
 *
 * 存檔位數量目前 8 格,寫成常數 SLOT_COUNT 方便未來若擴充上限調整。
 *
 * 優雅降級:找不到 player/currentSlot/loadGame/slotSummary/window.__afk(代表
 *   afk-offline.js 沒載入或載入順序有問題)任一全域就 console.warn 並不掛設定選單項。
 * 掛接:index.html </body> 前需加一行 <script src="afk-batch-settle.js?v=..."></script>,
 *   且必須排在 afk-offline.js 之後(依賴它曝光的 window.__afk.busy/last)。
 * ========================================================================== */
(function () {
  'use strict';

  var SLOT_COUNT = 8;        // 目前存檔位上限;未來擴充上限時改這裡即可
  var POLL_MS = 250;         // 輪詢 window.__afk.busy 的間隔
  var MAX_WAIT_MS = 8 * 60 * 1000;   // 單一存檔位補跑等待上限(8分鐘;實測極端重角色24h補跑約需數分鐘,留餘裕)

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmtDur(ms) {
    var s = Math.round(ms / 1000);
    return s < 60 ? (s + '秒') : (Math.floor(s / 60) + '分' + (s % 60 ? (s % 60) + '秒' : ''));
  }
  // 依 afk-offline.js summarize() 附帶的 itemCats({weapon,armor,item} 種類數)組成「(武器x/裝備y/道具z)」這種簡短附註
  function itemCatsSuffix(cats) {
    if (!cats) return '';
    var order = [['weapon', '武器'], ['armor', '裝備'], ['item', '道具']];
    var parts = order.filter(function (o) { return cats[o[0]] > 0; }).map(function (o) { return o[1] + cats[o[0]]; });
    return parts.length ? '（' + parts.join('/') + '）' : '';
  }
  // 讀某存檔位「最新一筆」離線紀錄(afk-offline.js summarize() 寫入的 afk_hist_<slot>,含完整物品/擊殺清單;
  //   跟 afk-history.js 讀同一份資料,回傳整個陣列(最多 5 筆,新→舊)供「查看明細」展開時列出
  //   包含這次剛結算的與之前的歷史紀錄,不只顯示最新一筆。)
  function readHistList(n) {
    try {
      var arr = JSON.parse(localStorage.getItem('afk_hist_' + n) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function oneRecordHTML(r) {
    var html = '<div class="m-bs-detail-row">📍 ' + esc(r.map || '?') + '</div>';
    if (r.items && r.items.length) {
      html += '<div class="m-bs-detail-row"><b>物品：</b>' + r.items.map(function (it) {
        return '<span class="' + esc(it.c || '') + '">' + esc(it.n) + '×' + it.cnt + '</span>';
      }).join('、') + '</div>';
    }
    if (r.kills && r.kills.length) {
      var ks = r.kills.slice().sort(function (a, b) { return b.cnt - a.cnt; });
      html += '<div class="m-bs-detail-row"><b>擊殺：</b>' + ks.map(function (k) { return esc(k.n) + '×' + k.cnt; }).join('、') + '</div>';
    }
    return html;
  }
  function detailHTML(list) {
    if (!list.length) return '';
    return '<div class="m-bs-detail">' + list.map(function (r, idx) {
      return '<div class="m-bs-detail-entry">' +
        '<div class="m-bs-detail-tag">' + (idx === 0 ? '本次結算' : '第 ' + (idx + 1) + ' 筆（較舊）') + '</div>' +
        oneRecordHTML(r) + '</div>';
    }).join('') + '</div>';
  }

  function init() {
    if (typeof player === 'undefined' || typeof currentSlot === 'undefined' ||
        typeof loadGame !== 'function' || typeof slotSummary !== 'function' || !window.__afk) {
      console.warn('[AFK-batch-settle] 缺少必要全域(需 afk-offline.js 先載入),批次結算功能停用。');
      return;
    }
    if (!document.getElementById('main-menu')) {
      console.warn('[AFK-batch-settle] 找不到 #main-menu,批次結算功能停用。');
      return;
    }

    injectCss();
    buildModal();

    window.AFK_SETTINGS = window.AFK_SETTINGS || { _items: [], add: function (it) { this._items.push(it); } };
    // 🎨 2026-07-11 首頁 V17 改版:功能名稱從「批次結算所有存檔位」縮短成「批次結算」,
    // 且從「⚙其他功能」下拉選單移出來,改在外掛工具方格區當獨立方格顯示(見 afk-skin.js ensureFrame)。
    AFK_SETTINGS.add({ label: '⏱️ 批次結算', onClick: confirmStart });

    // 使用者實測回饋:批次結算時的結果只有這個彈窗看得到,那個角色若不是「目前正在玩的」,
    //   之後真正登入時完全看不到這筆結算——因為 logSys 訊息是即時 DOM,不會存進存檔。
    //   解法:批次結算完一格就把「這一格剛結算完的 afk_hist 最新一筆」整份存進
    //   afk_batchpending_<slot>(不是存布林旗標);再包一層 loadGame(此時已是
    //   afk-offline.js 包過的版本),任何「真正的下一次登入」(不管是不是透過本外掛)都會
    //   把這份存起來的結果重新印一次到系統日誌,才清除旗標。
    //   ⚠ 為什麼要整份存起來、不能只存布林旗標再到時候重讀 afk_hist_<slot>[0]:
    //   如果「下次真正登入」時這個存檔位同時也有一段新的離線缺口,會觸發另一次真正的
    //   runCatchup,它的 summarize() 也會把新結果推進 afk_hist_<slot> 陣列頭——若補記
    //   邏輯等到那時才去讀 [0],讀到的會是這次新缺口的結果,不是原本要補記的那一筆。
    function setPending(n) {
      try {
        var rec = readHistList(n)[0];   // 這一格剛結算完(afk-offline.js summarize() 剛寫入)的最新一筆
        if (rec) localStorage.setItem('afk_batchpending_' + n, JSON.stringify(rec));
      } catch (e) {}
    }
    function tryDeliverPending() {
      try {
        var key = 'afk_batchpending_' + currentSlot;
        var raw = localStorage.getItem(key);
        if (!raw) { console.info('[AFK-batch-settle] 存檔 ' + currentSlot + ' 沒有待補記的批次結算通知。'); return; }
        localStorage.removeItem(key);
        var r;
        try { r = JSON.parse(raw); } catch (e) { console.warn('[AFK-batch-settle] 待補記資料毀損,略過補記。', e); return; }
        if (!r || typeof logSys !== 'function') { console.warn('[AFK-batch-settle] 找不到 logSys 或資料為空,無法補記。'); return; }
        console.info('[AFK-batch-settle] 存檔 ' + currentSlot + ' 補記批次結算通知:', r);
        var parts = [];
        if (r.gold > 0) parts.push('金幣 +' + r.gold.toLocaleString());
        if (r.lv > 0) parts.push('升 ' + r.lv + ' 級');
        if (r.exp > 0) parts.push('經驗 +' + r.exp.toLocaleString());
        if (r.items && r.items.length) parts.push(r.items.map(function (it) { return it.n + '×' + it.cnt; }).join('、'));
        var line = '<span class="text-cyan-300 font-bold">📦 批次結算補記：</span>之前用「批次結算」幫這個角色補算過離線收益' +
          (parts.length ? '，獲得 ' + parts.join('、') : '') +
          (r.died ? '<span class="text-red-400 font-bold">（中途死亡）</span>' : '') + '。';
        logSys(line);
      } catch (e) { console.warn('[AFK-batch-settle] 補記日誌失敗', e); }
    }
    // ⚠️ 踩過的坑:logSys 在 state.ff(補跑/快轉中)為 true 時是 no-op(js/01-drops-config.js
    //   logSys 開頭 `if(state.ff) return;`,補跑期間刻意不洗版)。若這次登入「同時也有真正的
    //   新離線缺口」,loadGame() 呼叫後 runCatchup 還在跑(async,state.ff 仍是 true),此時立刻
    //   呼叫 logSys 補記會被靜音吞掉、console 卻顯示有呼叫過(看似正常,實際訊息消失)。
    //   解法:呼叫前先等 window.__afk.busy 變成 false(比照批次結算本體等待補跑完成的做法),
    //   確保這次登入的補跑(如果有)已經跑完、state.ff 已還原,才真的補記。
    var DELIVER_POLL_MS = 100, DELIVER_MAX_TRIES = MAX_WAIT_MS / DELIVER_POLL_MS;   // 逾時上限跟批次結算本體的 MAX_WAIT_MS 一致(8分鐘),涵蓋重度角色補跑耗時
    function waitBusyThenDeliver(triesLeft) {
      if (window.__afk.busy) {
        if (triesLeft <= 0) { console.warn('[AFK-batch-settle] 等待補跑結束逾時,放棄這次補記(下次登入再試)。'); return; }
        setTimeout(function () { waitBusyThenDeliver(triesLeft - 1); }, DELIVER_POLL_MS);
        return;
      }
      tryDeliverPending();
    }
    var _origLoadGameForDeliver = loadGame;
    window.loadGame = function () {
      var r = _origLoadGameForDeliver.apply(this, arguments);
      try { waitBusyThenDeliver(DELIVER_MAX_TRIES); } catch (e) {}
      return r;
    };

    // （2026-07-19 隨原作v3.6同步移除舊版文字清單選角畫面 #slot-select-panel，本檔同步拿掉依附在它上面的
    //   「選存檔位畫面捷徑按鈕」——那個捷徑本來就要靠 openSlotSelect 被呼叫才會出現，而現行流程一律走
    //   openLoadSelect/renderLoadSelect，openSlotSelect 早已是死碼，捷徑從未真的出現過。主要入口（首頁設定選單）不受影響。）

    function confirmStart() {
      var msg = '將依序把存檔 1~' + SLOT_COUNT + ' 的離線收益都結算一次，各自的收益歸各自角色（不是拿其中一個角色的戰力幫其他角色打怪）。\n\n' +
        '過程中畫面會快速切換不同角色，依各角色離線時間長短可能需要一些時間，請耐心等候、不要關閉頁面。\n\n' +
        '⚠️ 若某個存檔位同時開著其他分頁在玩，請先關閉該分頁再開始，避免互相覆蓋存檔。';
      if (window.AFK_UI && typeof window.AFK_UI.confirm === 'function') {
        window.AFK_UI.confirm({ title: '批次結算離線收益', message: msg, okText: '開始結算', cancelText: '取消', onOk: start });
      } else if (window.confirm(msg)) {
        start();
      }
    }

    var _detailExpand = {}, _rowCache = {};   // _detailExpand[n]=是否展開明細;_rowCache[n]=最近一次 setRow 的(sum,state),供 toggle 明細時重繪

    function rowHTML(n, sum, state) {
      // state: 'pending' | 'running' | 'skip-empty' | 'skip-none' | 'done' | 'timeout' | 'error'
      var label = sum ? (esc(sum.cls) + ' Lv.' + esc(sum.lv) + (sum.name ? '　' + esc(sum.name) : '')) : '（空）';
      var head = '存檔 ' + n + '：' + label;
      var body = '';
      switch (state.kind) {
        case 'pending': body = '<span class="m-bs-wait">等待中…</span>'; break;
        case 'running': body = '<span class="m-bs-run">結算中… (' + fmtDur(state.elapsed || 0) + ')</span>'; break;
        case 'skip-empty': body = '<span class="m-bs-skip">此存檔位沒有角色，略過。</span>'; break;
        case 'skip-none': body = '<span class="m-bs-skip">無需結算（在村莊/沒有離線缺口）。</span>'; break;
        case 'timeout': body = '<span class="m-bs-err">結算逾時（已跳過，可稍後單獨登入該角色補算）。</span>'; break;
        case 'error': body = '<span class="m-bs-err">結算失敗：' + esc(state.msg || '未知錯誤') + '</span>'; break;
        case 'done':
          var last = state.last || {};
          var parts = [];
          if (last.mins) parts.push('離線 ' + last.mins + ' 分鐘');
          if (last.gold) parts.push('金幣 +' + last.gold.toLocaleString());
          if (last.lv) parts.push('升 ' + last.lv + ' 級');
          if (last.exp) parts.push('經驗 +' + last.exp.toLocaleString());
          if (last.items) parts.push(last.items + ' 種物品' + itemCatsSuffix(last.itemCats));
          if (last.died) parts.push('<span class="m-bs-died">中途死亡</span>');
          body = '<span class="m-bs-done">' + (parts.length ? parts.join('、') : '完成(無明顯收益)') + '　(耗時 ' + fmtDur(state.elapsed || 0) + ')</span>';
          var hist = readHistList(n).slice(0, 2);   // 使用者要求:明細只需要「本次＋上一筆」,不用列全部歷史(afk_hist 最多存5筆)
          if (hist.length) {
            body += ' <button type="button" class="m-bs-detail-btn" data-act="detail" data-n="' + n + '">' + (_detailExpand[n] ? '收起明細 ▲' : '🔍 查看明細 ▼') + '</button>';
            if (_detailExpand[n]) body += detailHTML(hist);
          }
          break;
      }
      return '<div class="m-bs-row"><span class="m-bs-head">' + head + '</span><span class="m-bs-body">' + body + '</span></div>';
    }

    function buildRows() {
      var wrap = document.getElementById('m-bs-rows');
      var html = '';
      _detailExpand = {};
      for (var n = 1; n <= SLOT_COUNT; n++) html += '<div id="m-bs-row-' + n + '"></div>';
      wrap.innerHTML = html;
      for (n = 1; n <= SLOT_COUNT; n++) setRow(n, slotSummary(n), { kind: 'pending' });
    }
    function setRow(n, sum, state) {
      _rowCache[n] = { sum: sum, state: state };
      var el = document.getElementById('m-bs-row-' + n);
      if (el) el.innerHTML = rowHTML(n, sum, state);
    }

    // 批次結算期間暫時套用「省電設定」(關音樂/音效、開省電模式連動關特效/傷害數字),
    // 結束後(不論成功/中途出例外)還原成使用者原本的值。全部呼叫既有全域函式,不直接寫 localStorage。
    function readCurrentPrefs() {
      return {
        bgm: (typeof window._bgmCfg === 'object' && window._bgmCfg) ? !!window._bgmCfg.on : null,
        sfx: (typeof window._sfxCfg === 'object' && window._sfxCfg) ? !!window._sfxCfg.on : null,
        vfx: !window.__vfxOff,
        vfxNum: !window.__vfxNumOff,
        powersave: (window.AFK_POWERSAVE && typeof window.AFK_POWERSAVE.isOn === 'function') ? window.AFK_POWERSAVE.isOn() : null
      };
    }
    function applyBatchPerfPrefs() {
      try { if (typeof setBgmOn === 'function') setBgmOn(false); } catch (e) {}
      try { if (typeof setSfxOn === 'function') setSfxOn(false); } catch (e) {}
      try { if (window.AFK_POWERSAVE && typeof window.AFK_POWERSAVE.setOn === 'function') window.AFK_POWERSAVE.setOn(true); } catch (e) {}
      // 保險:省電模式若不存在或沒連動關閉,各自再確認一次(讀「目前狀態 vs 目標」才切換,避免切成相反)
      try { if (!window.__vfxOff && typeof toggleVfxPref === 'function') toggleVfxPref(); } catch (e) {}
      try { if (!window.__vfxNumOff && typeof toggleVfxNumPref === 'function') toggleVfxNumPref(); } catch (e) {}
    }
    function restorePrefs(orig) {
      try { if (orig.bgm !== null && typeof setBgmOn === 'function') setBgmOn(orig.bgm); } catch (e) {}
      try { if (orig.sfx !== null && typeof setSfxOn === 'function') setSfxOn(orig.sfx); } catch (e) {}
      try { if (orig.powersave !== null && window.AFK_POWERSAVE && typeof window.AFK_POWERSAVE.setOn === 'function') window.AFK_POWERSAVE.setOn(orig.powersave); } catch (e) {}
      // 省電模式關閉不會自動恢復戰鬥特效/傷害數字,要各自比對「目前狀態 vs 原始值」還原
      try { if (orig.vfx !== !window.__vfxOff && typeof toggleVfxPref === 'function') toggleVfxPref(); } catch (e) {}
      try { if (orig.vfxNum !== !window.__vfxNumOff && typeof toggleVfxNumPref === 'function') toggleVfxNumPref(); } catch (e) {}
    }

    var _layer = null, _running = false, _originLive = false;
    function openOverlay() {
      var m = document.getElementById('m-bs-modal'); if (!m) return;
      document.getElementById('m-bs-foot').innerHTML = '';
      document.getElementById('m-bs-close').style.display = 'none';   // 結算中禁止關閉
      m.classList.add('open');
      _layer = null;   // 進行中不接受返回鍵/ESC/背景點擊關閉,避免中途打斷
    }
    function allowClose() {
      document.getElementById('m-bs-close').style.display = '';
      _layer = window.AFK_UI ? AFK_UI.openLayer(hideModal) : null;
    }
    function hideModal() {
      var m = document.getElementById('m-bs-modal'); if (m) m.classList.remove('open'); _layer = null;
      // 手機實體返回鍵/手勢(popstate 直接呼叫 layer.close,不會走 closeModal→closeLayer 那條有 history.back()
      // 競速風險的路徑,見 closeModal 註解)在這裡補一份同樣的 reload,涵蓋「不是按 X 關閉」的收尾路徑。
      if (!_originLive) { try { location.reload(); } catch (e) {} }
    }
    function closeModal() {
      if (_running) return;
      // 🔧 批次結算若是從首頁/選存檔位觸發(_originLive=false):迴圈逐格 loadGame() 跑到最後一格時,
      //   畫面會停在「最後一個存檔位」的遊戲主畫面(#game-screen 顯示、#creation-screen 仍 .hidden),
      //   而 #main-menu 本身從沒被加回 .hidden,導致首頁公告橫幅的顯示判斷誤判成「在首頁」而冒出來
      //   (踩過 2026-07-17)。比照既有「登出回首頁」的做法整頁重新整理回乾淨首頁,不用 DOM patch
      //   (只切 class 沒清掉 tick/計時器等狀態,不夠乾淨)。
      //   ⚠️ 一定要在呼叫 AFK_UI.closeLayer()「之前」就 reload,不能放進 hideModal() 裡讓 closeLayer 接手觸發
      //   ——closeLayer 關閉後會呼叫 history.back() 退掉開啟時押的那格歷史,若這時 reload() 才剛排入、
      //   還沒真的換頁,history.back() 會搶先生效(手機 Safari 上甚至可能直接從 bfcache 復原成「跑到一半的
      //   同一份頁面」),導致 reload 形同沒發生、畫面照樣卡在批次跑到最後一格的遊戲畫面(踩過,實機回報)。
      //   直接在這裡先 reload、完全不呼叫 closeLayer/history.back,新頁面本來就會蓋掉整個歷史堆疊,不需要退。
      if (!_originLive) { try { location.reload(); } catch (e) {} return; }
      if (_layer && window.AFK_UI) AFK_UI.closeLayer(_layer); else hideModal();
    }

    async function start() {
      if (_running) return;
      _running = true;
      var originLive = !!(player && player.cls);
      _originLive = originLive;
      var originSlot = currentSlot;
      buildRows();
      openOverlay();

      var origPrefs = readCurrentPrefs();
      applyBatchPerfPrefs();

      // ⏱️ 批次結算會依序觸發8次離線補跑,若不分組,profiler只留得住最後一格的資料——
      //   前面幾格全被覆蓋消失,沒辦法診斷「哪一格特別慢」。有 AFKOfflineProfiler 才呼叫,純觀測不影響結算。
      try { if (window.AFKOfflineProfiler && typeof window.AFKOfflineProfiler.beginBatch === 'function') window.AFKOfflineProfiler.beginBatch(); } catch (e) {}

      var totals = { gold: 0, exp: 0, lv: 0, slots: 0 };
      try {
        for (var n = 1; n <= SLOT_COUNT; n++) {
          var sum = slotSummary(n);
          if (!sum) { setRow(n, sum, { kind: 'skip-empty' }); continue; }
          var t0 = Date.now();
          setRow(n, sum, { kind: 'running', elapsed: 0 });
          currentSlot = n;
          try { loadGame(); } catch (e) { setRow(n, sum, { kind: 'error', msg: String(e && e.message || e) }); continue; }
          if (!window.__afk.busy) { setRow(n, sum, { kind: 'skip-none' }); continue; }
          var timedOut = false;
          while (window.__afk.busy) {
            await sleep(POLL_MS);
            if (Date.now() - t0 > MAX_WAIT_MS) { timedOut = true; break; }
            setRow(n, sum, { kind: 'running', elapsed: Date.now() - t0 });
          }
          if (timedOut) { setRow(n, sum, { kind: 'timeout' }); continue; }
          var last = window.__afk.last || {};
          totals.gold += last.gold || 0;
          totals.exp += last.exp || 0;
          totals.lv += last.lv || 0;
          totals.slots++;
          setPending(n);   // 標記「待補記」:這個角色下次真正登入時,把這筆結算結果重新顯示在系統日誌裡(現在只有批次視窗看得到)
          setRow(n, sum, { kind: 'done', last: last, elapsed: Date.now() - t0 });
        }
      } finally {
        restorePrefs(origPrefs);   // 不論成功/中途出例外,都要把音樂/音效/特效/傷害數字/省電模式還原成使用者原本的值
        try { if (window.AFKOfflineProfiler && typeof window.AFKOfflineProfiler.endBatch === 'function') window.AFKOfflineProfiler.endBatch(); } catch (e) {}
      }

      document.getElementById('m-bs-foot').innerHTML =
        '<div class="m-bs-summary">✅ 全部結算完成，共 ' + totals.slots + ' 個角色有補算收益' +
        (totals.gold ? '，合計金幣 +' + totals.gold.toLocaleString() : '') +
        (totals.lv ? '，合計升 ' + totals.lv + ' 級' : '') + '。</div>' +
        '<div class="m-bs-toast">⚠️ 別忘了到「雲端同步」面板按一次「立即上傳」，否則其他裝置可能還會看到舊的結果。</div>';

      _running = false;
      // 收尾:有活著的原角色→換回去;不論哪種情況都停在原畫面、開放使用者自己按 ✕ 關閉,不自動跳轉/整頁重整
      if (originLive) {
        currentSlot = originSlot; try { loadGame(); } catch (e) {}
      } else {
        // 從首頁/選存檔位觸發(批次前沒有登入任何角色):把 currentSlot 還原成觸發前的值,避免殘留在最後一次迴圈的存檔位
        currentSlot = originSlot;
      }
      allowClose();
    }

    function buildModal() {
      if (document.getElementById('m-bs-modal')) return;
      var modal = document.createElement('div');
      modal.id = 'm-bs-modal';
      modal.innerHTML =
        '<div id="m-bs-card">' +
          '<div id="m-bs-head-bar">' +
            '<span id="m-bs-title-bar">⏱️ 批次結算所有存檔位</span>' +
            '<button id="m-bs-close" type="button" title="關閉">✕</button>' +
          '</div>' +
          '<div id="m-bs-rows"></div>' +
          '<div id="m-bs-foot"></div>' +
        '</div>';
      document.body.appendChild(modal);
      document.getElementById('m-bs-close').addEventListener('click', closeModal);
      document.getElementById('m-bs-rows').addEventListener('click', function (e) {
        var b = e.target.closest('[data-act="detail"]');
        if (!b) return;
        var n = parseInt(b.getAttribute('data-n'), 10);
        _detailExpand[n] = !_detailExpand[n];
        var c = _rowCache[n];
        if (c) setRow(n, c.sum, c.state);
      });
    }

    function injectCss() {
      if (document.getElementById('m-bs-style')) return;
      var s = document.createElement('style');
      s.id = 'm-bs-style';
      s.textContent = [
        '#m-bs-modal{display:none;position:fixed;inset:0;z-index:1002;background:rgba(2,6,23,0.92);align-items:flex-start;justify-content:center;padding:24px 12px;font-family:system-ui,"Segoe UI",sans-serif;}',
        '#m-bs-modal.open{display:flex;}',
        '#m-bs-card{width:min(600px,96vw);max-height:calc(100dvh - 48px);display:flex;flex-direction:column;background:#0f172a;border:1px solid #334155;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;}',
        '#m-bs-head-bar{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #1e293b;flex:0 0 auto;}',
        '#m-bs-title-bar{font-size:16px;font-weight:bold;color:#fff;}',
        '#m-bs-close{width:40px;height:40px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;border-radius:8px;font-size:15px;cursor:pointer;line-height:1;}',
        '#m-bs-close:active{background:#334155;}',
        '#m-bs-rows{flex:1 1 auto;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:6px;}',
        '.m-bs-row{display:flex;flex-direction:column;gap:2px;background:#111c30;border:1px solid #1e293b;border-radius:8px;padding:8px 10px;font-size:13px;}',
        '.m-bs-head{color:#fcd34d;font-weight:bold;}',
        '.m-bs-body{color:#cbd5e1;}',
        '.m-bs-wait{color:#64748b;}',
        '.m-bs-run{color:#38bdf8;}',
        '.m-bs-skip{color:#64748b;}',
        '.m-bs-err{color:#f87171;}',
        '.m-bs-done{color:#86efac;}',
        '.m-bs-died{color:#fca5a5;font-weight:bold;}',
        '.m-bs-detail-btn{margin-left:6px;min-height:32px;padding:2px 10px;border-radius:7px;font-size:11.5px;font-weight:bold;cursor:pointer;font-family:inherit;border:1px solid #475569;background:#1e293b;color:#93c5fd;}',
        '.m-bs-detail-btn:active{background:#334155;}',
        '.m-bs-detail{margin-top:6px;display:flex;flex-direction:column;gap:6px;}',
        '.m-bs-detail-entry{padding:8px 10px;background:#0b1424;border:1px solid #1e293b;border-radius:7px;display:flex;flex-direction:column;gap:5px;font-size:12.5px;}',
        '.m-bs-detail-tag{color:#7dd3fc;font-size:11px;font-weight:bold;}',
        '.m-bs-detail-row{color:#cbd5e1;word-break:break-word;}',
        '.m-bs-detail-row b{color:#94a3b8;font-weight:bold;}',
        '#m-bs-foot{flex:0 0 auto;padding:10px 14px;border-top:1px solid #1e293b;display:flex;flex-direction:column;gap:8px;}',
        '.m-bs-summary{color:#e2e8f0;font-size:13.5px;font-weight:bold;}',
        '.m-bs-toast{background:#164e63;border:1px solid #0891b2;color:#a5f3fc;font-size:12.5px;line-height:1.6;padding:8px 10px;border-radius:8px;}'
      ].join('');
      document.head.appendChild(s);
    }

    console.log('[AFK-batch-settle] hooks OK — 批次結算所有存檔位已加入首頁設定選單。');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
