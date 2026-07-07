/*
 * afk-autosell-fix.js — 修「自動販賣規則」個別例外區塊的兩個 UI bug(桌機/手機共用)
 *
 * 背景:js/10-ui-tabs.js(原作者本體,不可修改)的 openAutoSellRules() 每次都是
 *   「整個 modal 節點移除→重新建立全新節點」(見該函式第2/末行:
 *   document.getElementById('autosell-rule-modal').remove() → document.body.appendChild(el))。
 *   點擊「永遠保留」(setAutoSellOverride)/「永遠販賣」(deleteAutoSellOverride)都會
 *   重呼叫 openAutoSellRules(),於是:
 *     bug1:新節點的 .as-box(捲動容器)scrollTop 天生是 0,畫面跳回最上面。
 *     bug2:搜尋框(#as-item-search)、分類/物品範圍下拉(#as-item-type / #as-item-scope)
 *          的模板字串都是初始值,沒有回填上次輸入/選擇,篩選條件被清空。
 *
 * 修法:monkey-patch setAutoSellOverride / deleteAutoSellOverride 這兩個函式——
 *   呼叫原函式「前」先讀出目前的搜尋字/分類/範圍/捲動位置暫存,呼叫原函式(它內部會
 *   整段重建 modal)後,用 setTimeout(0) 等新 DOM 插入完成,再把暫存值寫回新節點並重觸發
 *   refreshAutoSellItemOptions() 重建 #as-item 選單。不改資料、不改原函式邏輯,只補回填。
 */
(function () {
  function captureState() {
    var box = document.querySelector('#autosell-rule-modal .as-box');
    var searchEl = document.getElementById('as-item-search');
    var typeEl = document.getElementById('as-item-type');
    var scopeEl = document.getElementById('as-item-scope');
    var itemEl = document.getElementById('as-item');
    return {
      search: searchEl ? searchEl.value : '',
      type: typeEl ? typeEl.value : 'all',
      scope: scopeEl ? scopeEl.value : 'all',
      selectedItem: itemEl ? itemEl.value : '',
      scrollTop: box ? box.scrollTop : 0,
    };
  }

  function restoreState(state) {
    if (!state) return;
    var searchEl = document.getElementById('as-item-search');
    var typeEl = document.getElementById('as-item-type');
    var scopeEl = document.getElementById('as-item-scope');
    if (searchEl) searchEl.value = state.search;
    if (typeEl) typeEl.value = state.type;
    if (scopeEl) scopeEl.value = state.scope;
    if (typeof refreshAutoSellItemOptions === 'function') refreshAutoSellItemOptions();   // 依回填的搜尋/分類/範圍重建 #as-item 選單
    var itemEl = document.getElementById('as-item');
    if (itemEl && state.selectedItem && itemEl.querySelector('option[value="' + state.selectedItem.replace(/"/g, '\\"') + '"]')) {
      itemEl.value = state.selectedItem;   // 原本選的物品重建後還在清單裡,就選回原本那個
    }
    var box = document.querySelector('#autosell-rule-modal .as-box');
    if (box) box.scrollTop = state.scrollTop;
  }

  function wrap(name) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__afkAutosellFixWrapped) return false;
    var wrapped = function () {
      var state = captureState();
      var ret = orig.apply(this, arguments);
      setTimeout(function () { restoreState(state); }, 0);
      return ret;
    };
    wrapped.__afkAutosellFixWrapped = true;
    window[name] = wrapped;
    return true;
  }

  function install() {
    if (typeof window.setAutoSellOverride !== 'function' || typeof window.deleteAutoSellOverride !== 'function') return false;
    wrap('setAutoSellOverride');
    wrap('deleteAutoSellOverride');
    return true;
  }

  if (install()) {
    console.log('[AFK-autosell-fix] hooks OK — 自動販賣個別例外:永遠保留/永遠販賣後,搜尋字/分類/捲動位置不再被重置。');
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (install()) console.log('[AFK-autosell-fix] hooks OK — 自動販賣個別例外:永遠保留/永遠販賣後,搜尋字/分類/捲動位置不再被重置。');
      else console.warn('[AFK-autosell-fix] 找不到 setAutoSellOverride/deleteAutoSellOverride,自動販賣 UI 修復停用。');
    }, { once: true });
  }
})();
