/* ============================================================================
 * afk-status-always-text.js — 能力分頁「狀態」文字列,不管在哪個畫面都顯示
 *
 * 背景(2026-07-17 使用者明訂):原作者的 renderStatusEffects()(js/08-items-equip.js)
 * 在冒險地圖戰鬥中(#battle-view 可見時)會把大部分 buff 文字跳過,理由是改用「狀態圖示」
 * 顯示——但那排圖示(#status-icon-bar)其實是插在冒險地圖的怪物列表上方,不是能力分頁本身,
 * 使用者切到「能力」分頁時完全看不到,體感就是「戰鬥中狀態列變成空的/只顯示正常」。
 *
 * 使用者要求:能力分頁的文字狀態列,不管目前在哪個畫面都要完整顯示。
 *
 * 做法(純疊加,不改動核心檔案):monkey-patch 包住 renderStatusEffects()。
 * renderStatusEffects() 內部是用「即時讀 #battle-view 的 class 是否含 hidden」來判斷要不要跳過
 * 文字(變數 _skipIconized),沒有對外暴露任何參數可以控制。我們在呼叫原函式的當下,同步地把
 * #battle-view 暫時加上 .hidden(讓原函式誤判成「不在戰鬥畫面」→ 全部用文字顯示),原函式執行
 * 完(仍是同一個 JS 事件迴圈、無非同步操作)立刻把 .hidden 拿掉還原——中間不會有任何畫面重繪,
 * 純文字生成過程對玩家來說瞬間完成,不影響冒險地圖本身的顯示/版面。
 *
 * ⚠️ 給下一次同步原作者本體的人:這支外掛依賴 renderStatusEffects() 這個全域函式名稱本身存在,
 * 以及它內部靠「#battle-view 有沒有 .hidden」判斷要不要跳過文字這個實作細節。
 * 如果原作者改了函式名稱、或改用別的方式判斷戰鬥狀態(不再讀 #battle-view 的 class),
 * 這支外掛會悄悄失效(退回原作者的預設行為:戰鬥中能力分頁狀態列變空)。
 * 判準:同步後若玩家又反映「戰鬥中能力分頁狀態列是空的」,先確認這支外掛的 hooks OK 有沒有印出來,
 * 再檢查 renderStatusEffects 有沒有改名或改邏輯。
 * ========================================================================== */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    if (typeof window.renderStatusEffects !== 'function') {
      console.warn('[AFK-status-always-text] 找不到 renderStatusEffects(),外掛停用。');
      return;
    }
    var _origRenderStatusEffects = window.renderStatusEffects;
    window.renderStatusEffects = function () {
      var bv = document.getElementById('battle-view');
      var wasHidden = !bv || bv.classList.contains('hidden');
      if (bv && !wasHidden) bv.classList.add('hidden');   // 騙過原函式的 _skipIconized 判斷,讓它照「不在戰鬥」的分支跑,全部用文字顯示
      try {
        _origRenderStatusEffects.apply(this, arguments);
      } finally {
        if (bv && !wasHidden) bv.classList.remove('hidden');   // 同一輪事件迴圈內立刻還原,不影響冒險地圖本身的顯示
      }
    };
    console.log('[AFK-status-always-text] hooks OK — 能力分頁狀態文字列已改為不管在哪個畫面都顯示。');
  });
})();
