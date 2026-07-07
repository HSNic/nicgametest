/*
 * afk-warehouse-search.js — 共用倉庫加一個搜尋欄位(背包／倉庫兩側一起篩選)
 *
 * 背景:js/12-npc-quests.js(原作者本體,不可修改)的 renderWarehouseNPC() 只有
 *   分類下拉(武器/防具/道具 + 子分類),沒有文字搜尋,物品一多要找特定東西很麻煩。
 *
 * 做法:monkey-patch window.renderWarehouseNPC——原函式每次都用
 *   div.innerHTML = `...` 整段重畫(見該函式),所以我們附加的搜尋框也會跟著被
 *   沖掉;因此不做「只插入一次」的判斷,而是每次原函式畫完後都重新插入一個搜尋框,
 *   並把上次輸入的關鍵字(存在模組變數 `query`)寫回,再套用篩選,達到「重畫後關鍵字
 *   不會被清空」的效果。純 DOM 層顯示/隱藏(display:none),不改任何倉庫/背包資料。
 *
 * 篩選對象:#wh-inv-list(背包側)與 #wh-store-list(倉庫側)裡每一個帶
 *   data-tip-uid 的項目(button 或不可存的 div),用項目文字內容(物品名稱)比對。
 */
(function () {
  var STYLE_ID = 'afk-wh-search-style';
  var INPUT_ID = 'afk-wh-search-input';
  var query = '';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '#' + INPUT_ID + '{width:100%;background:#020617;border:1px solid #64748b;color:#e2e8f0;padding:6px 10px;border-radius:6px;font-size:13px;}' +
      '#' + INPUT_ID + '::placeholder{color:#64748b;}';
    document.head.appendChild(s);
  }

  function applyFilter() {
    var q = query.trim().toLowerCase();
    ['wh-inv-list', 'wh-store-list'].forEach(function (listId) {
      var list = document.getElementById(listId);
      if (!list) return;
      var items = list.querySelectorAll('[data-tip-uid]');
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        var name = (el.textContent || '').toLowerCase();
        el.style.display = (!q || name.indexOf(q) !== -1) ? '' : 'none';
      }
    });
  }

  function ensureSearchBox() {
    var invList = document.getElementById('wh-inv-list');
    if (!invList) return;   // 倉庫視窗沒開,不用處理
    var grid = invList.closest('.grid');
    if (!grid || !grid.parentElement) return;
    injectStyle();
    var wrap = document.createElement('div');
    wrap.id = INPUT_ID + '-wrap';
    wrap.innerHTML = '<input id="' + INPUT_ID + '" type="search" placeholder="輸入物品名稱搜尋(背包／倉庫一起篩選)">';
    grid.parentElement.insertBefore(wrap, grid);
    var input = wrap.querySelector('#' + INPUT_ID);
    input.value = query;
    input.addEventListener('input', function () { query = input.value; applyFilter(); });
  }

  function install() {
    if (typeof window.renderWarehouseNPC !== 'function') return false;
    if (window.renderWarehouseNPC.__afkWhSearchWrapped) return true;
    var original = window.renderWarehouseNPC;
    window.renderWarehouseNPC = function () {
      var ret = original.apply(this, arguments);
      try { ensureSearchBox(); applyFilter(); } catch (e) {}
      return ret;
    };
    window.renderWarehouseNPC.__afkWhSearchWrapped = true;
    return true;
  }

  if (install()) {
    console.log('[AFK-warehouse-search] hooks OK — 共用倉庫已加上搜尋欄位。');
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (install()) console.log('[AFK-warehouse-search] hooks OK — 共用倉庫已加上搜尋欄位。');
      else console.warn('[AFK-warehouse-search] 找不到 renderWarehouseNPC,倉庫搜尋欄停用。');
    }, { once: true });
  }
})();
