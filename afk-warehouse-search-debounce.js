/*
 * afk-warehouse-search-debounce.js — 共用倉庫搜尋加防抖動(2026-07-20 新增)
 *
 * 背景:共用倉庫上限高達 5000 格(js/12-npc-quests.js 的 WH_MAX),搜尋框每打一個字就呼叫
 *   whSetSearch() 整段重繪(renderWarehouseNPC 是整份 innerHTML 重建,逐件呼叫 getItemFullName()
 *   做模糊比對),物品多時每個字元輸入都卡一下。這裡不改本體邏輯,只monkeypatch
 *   window.whSetSearch,讓「打字打很快」時只在停頓約 200ms 後才真的觸發一次重繪,
 *   大幅減少重繪次數;不影響原本的比對/顯示邏輯本身。
 *
 * 例外(不套用防抖動,直接立即執行):
 *   - 清空搜尋(whClearSearch 呼叫 whSetSearch('',0)):使用者主動點清除鈕是明確動作,
 *     應該立刻有反應,不應該還要等 200ms 才清空。
 *   - IME 組字期間或剛結束組字的呼叫:whSetSearch 本體自己會判斷 _whComposing/ev.isComposing
 *     並直接 return(不重繪),延遲呼叫它不影響組字保護邏輯本身,故不特別排除,只是為了清楚說明
 *     這裡不會跟原本的 IME 保護機制衝突。
 *
 * 優雅降級:找不到 window.whSetSearch 就安靜停用。
 */
(function () {
  'use strict';

  var DEBOUNCE_MS = 200;

  function init() {
    if (typeof window.whSetSearch !== 'function') { console.warn('[AFK-wh-search-debounce] 找不到 whSetSearch,外掛停用'); return; }
    if (window.whSetSearch.__afkDebounced) return;
    var orig = window.whSetSearch;
    var timer = null;
    var wrapped = function (v, pos, ev) {
      if (timer) { clearTimeout(timer); timer = null; }
      if (!v) { return orig(v, pos, ev); }   // 清空搜尋:立即執行,不delay
      timer = setTimeout(function () { timer = null; orig(v, pos, ev); }, DEBOUNCE_MS);
    };
    wrapped.__afkDebounced = true;
    window.whSetSearch = wrapped;
    console.log('[AFK-wh-search-debounce] hooks OK');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
