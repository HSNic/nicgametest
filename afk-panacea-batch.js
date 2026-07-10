/* ============================================================================
 * afk-panacea-batch.js — 萬能藥「一次選數量批量服用」
 *
 * 為什麼:原作者 useItem() 每次呼叫只 +1 對應屬性,要吃 N 瓶得點 N 次。
 *   本外掛不改 useItem 本體,只在物品詳情視窗(openModal)多加一顆「批量使用」鈕,
 *   選好數量後在外面迴圈呼叫原有的單瓶服用邏輯 useItem(uid, true)(silent,避免洗版
 *   log/重複觸發 closeModal),跑完才自己補一則統一的結算訊息。
 *
 * 上限:數量選擇器的最大值同時夾擠三個既有上限——背包庫存(item.cnt)、
 *   萬能藥總使用上限(60,player.panaceaUsed)、該項屬性上限(naturalStat(st)<60)。
 *   三者取最小值,絕不會讓玩家選到「選了卻部分失敗」的數量。
 *
 * 優雅降級:找不到 openModal/useItem/player/DB/naturalStat 任一全域就 console.warn 停用。
 * 掛接:index.html </body> 前需加一行 <script src="afk-panacea-batch.js?v=..."></script>
 *   (有 DOM 掛點 #item-modal/#modal-actions,已列入 scripts/smoke-hooks.mjs)
 * ========================================================================== */
(function () {
  'use strict';

  var STAT_CN = { str: '力量', dex: '敏捷', con: '體質', int: '智力', wis: '精神', cha: '魅力' };

  function init() {
    // ⚠️ DB/player 是遊戲本體用 const/let 宣告的全域,不會掛在 window 上(只有 var/function 宣告才會),
    //   故一律用 typeof 檢查裸識別字,不能用 window.DB/window.player(會誤判成不存在)。
    if (typeof openModal !== 'function' || typeof useItem !== 'function' ||
        typeof naturalStat !== 'function' || typeof DB === 'undefined' || !DB ||
        typeof player === 'undefined') {
      console.warn('[AFK-panacea] 缺少必要全域(openModal/useItem/naturalStat/DB/player),批量服用停用。');
      return;
    }
    if (!document.getElementById('item-modal')) {
      console.warn('[AFK-panacea] 找不到 #item-modal,批量服用停用。');
      return;
    }

    injectCss();

    var origOpenModal = openModal;
    window.openModal = function (item, isEq, slot) {
      var r = origOpenModal.apply(this, arguments);
      try { maybeInjectBatchBtn(item, isEq); } catch (e) { console.warn('[AFK-panacea] 注入批量鈕失敗', e); }
      return r;
    };

    function maybeInjectBatchBtn(item, isEq) {
      if (isEq || !item) return;
      var d = DB.items[item.id];
      if (!d || d.eff !== 'panacea') return;
      if ((item.cnt || 1) <= 1) return;   // 只有 1 瓶時批量沒有意義,維持原有「使用」鈕即可
      var maxQty = calcMaxQty(item, d);
      if (maxQty < 1) return;   // 上限已到(該屬性已滿/總量已滿 60),批量鈕沒有意義

      var actEl = document.getElementById('modal-actions');
      if (!actEl) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'col-span-2 w-full btn border-cyan-700 bg-cyan-900 hover:bg-cyan-800 text-cyan-100 py-3 text-lg font-bold mt-2';
      btn.textContent = '批量使用（最多 ' + maxQty + ' 瓶）';
      btn.addEventListener('click', function () { openPicker(item.uid, maxQty, d); });
      actEl.insertBefore(btn, actEl.firstChild);
    }

    function calcMaxQty(item, d) {
      var st = d.pstat;
      var byStock = item.cnt || 0;
      var byTotalCap = 60 - (player.panaceaUsed || 0);
      var byStatCap = 60 - naturalStat(st);
      return Math.max(0, Math.min(byStock, byTotalCap, byStatCap));
    }

    // ── 數量選擇彈窗 ──────────────────────────────────────────────
    var modal = null, layer = null, curUid = null, curMax = 1, curD = null, qtyInput = null, hintEl = null;

    function build() {
      modal = document.createElement('div');
      modal.id = 'afk-panacea-modal';
      modal.innerHTML =
        '<div id="afk-panacea-card">' +
          '<div id="afk-panacea-title"></div>' +
          '<div id="afk-panacea-stepper">' +
            '<button type="button" class="afk-pn-step" data-d="-5">-5</button>' +
            '<button type="button" class="afk-pn-step" data-d="-1">-1</button>' +
            '<input id="afk-panacea-qty" type="number" min="1" step="1">' +
            '<button type="button" class="afk-pn-step" data-d="1">+1</button>' +
            '<button type="button" class="afk-pn-step" data-d="5">+5</button>' +
          '</div>' +
          '<div id="afk-panacea-max"></div>' +
          '<div id="afk-panacea-hint"></div>' +
          '<div id="afk-panacea-btns">' +
            '<button id="afk-panacea-cancel" type="button">取消</button>' +
            '<button id="afk-panacea-ok" type="button">確認使用</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);
      qtyInput = modal.querySelector('#afk-panacea-qty');
      hintEl = modal.querySelector('#afk-panacea-hint');
      modal.querySelector('#afk-panacea-max').addEventListener('click', function () {}); // no-op 佔位保留結構
      modal.querySelectorAll('.afk-pn-step').forEach(function (b) {
        b.addEventListener('click', function () {
          setQty(clamp(readQty() + parseInt(b.getAttribute('data-d'), 10)));
        });
      });
      qtyInput.addEventListener('input', function () { setQty(clamp(readQty())); });
      modal.querySelector('#afk-panacea-cancel').addEventListener('click', closePicker);
      modal.querySelector('#afk-panacea-ok').addEventListener('click', confirmUse);
      modal.addEventListener('click', function (e) { if (e.target === modal) closePicker(); });
    }

    function readQty() {
      var n = parseInt(qtyInput.value, 10);
      return isNaN(n) ? 1 : n;
    }
    function clamp(n) { return Math.max(1, Math.min(curMax, n)); }
    function setQty(n) {
      qtyInput.value = n;
      var st = curD.pstat;
      hintEl.textContent = '將使用 ' + n + ' 瓶，' + (STAT_CN[st] || st) + ' 永久 +' + n + '。';
    }

    function openPicker(uid, maxQty, d) {
      if (!modal) build();
      curUid = uid; curMax = maxQty; curD = d;
      modal.querySelector('#afk-panacea-title').textContent = (d.n || '萬能藥') + ' — 選擇服用數量';
      modal.querySelector('#afk-panacea-max').textContent = '目前最多可服用 ' + maxQty + ' 瓶';
      qtyInput.setAttribute('max', String(maxQty));
      setQty(clamp(maxQty));
      modal.classList.add('open');
      layer = window.AFK_UI && window.AFK_UI.openLayer ? window.AFK_UI.openLayer(closePicker) : null;
    }

    function closePicker() {
      if (!modal) return;
      modal.classList.remove('open');
      curUid = null; curD = null; layer = null;
    }

    function confirmUse() {
      var uid = curUid, qty = clamp(readQty()), st = curD ? curD.pstat : null;
      if (!uid || !st) { closePicker(); return; }
      var beforeUsed = player.panaceaUsed || 0;
      for (var i = 0; i < qty; i++) {
        var item = player.inv.find(function (it) { return it.uid === uid; });
        if (!item) break;   // 庫存提前用完(防禦性,理論上 qty 已受 item.cnt 夾擠)
        useItem(uid, true);   // silent:重用既有單瓶服用邏輯,不觸發逐則 log / closeModal
      }
      var applied = (player.panaceaUsed || 0) - beforeUsed;
      if (typeof renderTabs === 'function') renderTabs();
      if (typeof updateUI === 'function') updateUI();
      if (typeof saveGame === 'function') saveGame();
      if (typeof logSys === 'function') {
        if (applied > 0) {
          logSys('批量使用了 ' + applied + ' 瓶「' + (curD.n || '萬能藥') + '」，' + (STAT_CN[st] || st) + ' 永久 +' + applied + '！（萬能藥已使用 ' + (player.panaceaUsed || 0) + '/60）');
        } else {
          logSys('批量使用失敗，未消耗任何萬能藥。');
        }
      }
      closePicker();
      if (typeof closeModal === 'function') closeModal();
    }

    function injectCss() {
      var css = [
        '#afk-panacea-modal{display:none;position:fixed;inset:0;z-index:10002;background:rgba(2,6,23,0.75);align-items:center;justify-content:center;padding:20px;}',
        '#afk-panacea-modal.open{display:flex;}',
        '#afk-panacea-card{width:min(360px,92vw);background:#0f172a;border:1px solid #334155;border-radius:12px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);}',
        '#afk-panacea-title{color:#f8fafc;font-size:16px;font-weight:bold;text-align:center;margin-bottom:14px;}',
        '#afk-panacea-stepper{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:10px;}',
        '.afk-pn-step{min-width:44px;min-height:44px;border-radius:8px;border:1px solid #0e7490;background:#155e75;color:#e0f2fe;font-size:15px;font-weight:bold;cursor:pointer;}',
        '.afk-pn-step:active{background:#0c4a6e;}',
        '#afk-panacea-qty{width:76px;height:44px;text-align:center;font-size:18px;font-weight:bold;color:#f8fafc;background:#1e293b;border:1px solid #334155;border-radius:8px;}',
        '#afk-panacea-max{color:#94a3b8;font-size:12px;text-align:center;margin-bottom:6px;}',
        '#afk-panacea-hint{color:#67e8f9;font-size:14px;text-align:center;margin-bottom:16px;min-height:20px;}',
        '#afk-panacea-btns{display:flex;gap:10px;}',
        '#afk-panacea-btns button{flex:1;min-height:44px;padding:11px;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;font-family:inherit;border:1px solid;}',
        '#afk-panacea-cancel{border-color:#475569;background:#334155;color:#e2e8f0;}',
        '#afk-panacea-cancel:active{background:#1e293b;}',
        '#afk-panacea-ok{border-color:#0e7490;background:#0891b2;color:#fff;}',
        '#afk-panacea-ok:active{background:#0e7490;}'
      ].join('\n');
      var s = document.createElement('style');
      s.id = 'afk-panacea-css';
      s.textContent = css;
      document.head.appendChild(s);
    }

    console.log('[AFK-panacea] hooks OK');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
