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
    AFK_SETTINGS.add({ label: '⏱️ 批次結算所有存檔位', onClick: confirmStart });

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
          if (last.items) parts.push(last.items + ' 種物品');
          if (last.died) parts.push('<span class="m-bs-died">中途死亡</span>');
          body = '<span class="m-bs-done">' + (parts.length ? parts.join('、') : '完成(無明顯收益)') + '　(耗時 ' + fmtDur(state.elapsed || 0) + ')</span>';
          break;
      }
      return '<div class="m-bs-row"><span class="m-bs-head">' + head + '</span><span class="m-bs-body">' + body + '</span></div>';
    }

    function buildRows() {
      var wrap = document.getElementById('m-bs-rows');
      var html = '';
      for (var n = 1; n <= SLOT_COUNT; n++) html += '<div id="m-bs-row-' + n + '"></div>';
      wrap.innerHTML = html;
      for (n = 1; n <= SLOT_COUNT; n++) setRow(n, slotSummary(n), { kind: 'pending' });
    }
    function setRow(n, sum, state) {
      var el = document.getElementById('m-bs-row-' + n);
      if (el) el.innerHTML = rowHTML(n, sum, state);
    }

    var _layer = null, _running = false;
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
    function hideModal() { var m = document.getElementById('m-bs-modal'); if (m) m.classList.remove('open'); _layer = null; }
    function closeModal() { if (!_running) { if (_layer && window.AFK_UI) AFK_UI.closeLayer(_layer); else hideModal(); } }

    async function start() {
      if (_running) return;
      _running = true;
      var originLive = !!(player && player.cls);
      var originSlot = currentSlot;
      buildRows();
      openOverlay();

      var totals = { gold: 0, exp: 0, lv: 0, slots: 0 };
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
        setRow(n, sum, { kind: 'done', last: last, elapsed: Date.now() - t0 });
      }

      document.getElementById('m-bs-foot').innerHTML =
        '<div class="m-bs-summary">✅ 全部結算完成，共 ' + totals.slots + ' 個角色有補算收益' +
        (totals.gold ? '，合計金幣 +' + totals.gold.toLocaleString() : '') +
        (totals.lv ? '，合計升 ' + totals.lv + ' 級' : '') + '。</div>' +
        '<div class="m-bs-toast">⚠️ 別忘了到「雲端同步」面板按一次「立即上傳」，否則其他裝置可能還會看到舊的結果。</div>';

      _running = false;
      allowClose();
      // 收尾:有活著的原角色→換回去;否則(從首頁觸發)重新整理回乾淨首頁,不留在批次跑完的最後一個角色畫面
      if (originLive) { currentSlot = originSlot; try { loadGame(); } catch (e) {} }
      else {
        var closeBtn = document.getElementById('m-bs-close');
        closeBtn.addEventListener('click', function onceReload() { location.reload(); }, { once: true });
      }
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
