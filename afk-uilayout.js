/* ============================================================================
 * afk-uilayout.js — 版面密度微調(純 CSS 覆寫,不改任何遊戲邏輯,桌機/手機共用)
 *
 * B. 分頁按鈕列(.tab-bar,能力/裝備/技能/武器/防具/道具…)縮小高度(padding/font-size)。
 *    快速強化/快速廢品按鈕(buildQuickHeader,js/10-ui-tabs.js)本來就是各分頁容器的
 *    第一個子元素,天生緊貼分頁按鈕列下方,不需要額外處理。
 * D. 冒險地圖面板的日誌區塊(#log-row,戰鬥日誌+系統/物品日誌)縮小固定高度。
 *    ⚠ 只覆寫「非狩獵中」的固定高度(#log-row{flex:0 0 340px});狩獵中(area-fit)
 *    原作者另有 `#col-center:has(#battle-view.area-fit:not(.hidden)) #log-row{flex:1 1 0}`
 *    規則(2 個 id + :has/:not/.area-fit,specificity 遠高於本檔),此時日誌自動吃滿剩餘
 *    高度不受本檔影響——本檔選用 `#col-center #log-row`(2 個 id、無其他子句)只贏過
 *    原作base規則(單一 #log-row),但仍輸給狩獵中的規則,兩者不衝突。
 *    地圖固定尺寸(#battle-view.area-fit 800×242)響應式滿版化本次暫緩,不在此檔處理。
 * E. 潘朵拉黑市列表(2026-07-08 待辦#4):`pandoraRenderMarket`(js/14-craft-pandora.js)
 *    inline 寫死 4 欄(grid-template-columns:repeat(4,minmax(0,1fr))),卡片太擠、字看不清楚,
 *    改覆寫成 2 欄放大。選擇器鎖定「這段 inline style 的確切字串」,專案裡唯一一處這樣寫
 *    (css/style.css 的 `.classic-inventory-viewport` 雖也用同一組數值,但那是外部 class
 *    規則、不是 inline `style=""` 屬性,不會被 `[style*=...]` 選到,不衝突);用 `!important`
 *    蓋過 inline(原作者的 inline 沒加 `!important`,故本規則能贏)。何時可移除:原作者自己
 *    改成 2 欄,或改用 class 取代 inline style 時,選擇器不再命中,自動安全退場。
 *
 * 掛接:在 index.html 的 </body> 前加一行 <script src="afk-uilayout.js"></script>
 * (排在其他 afk-* 之後,純 CSS,無先後依賴)
 * ========================================================================== */
(function () {
  'use strict';

  var STYLE_ID = 'afk-uilayout-style';
  var CSS =
    /* B:分頁按鈕列縮高(原 .btn 基底 padding:0.5rem 1rem + text-base(16px)+font-bold;縮到約 4px/13px) */
    '.tab-bar .btn{padding-top:4px!important;padding-bottom:4px!important;font-size:13px!important;}' +
    /* D:非狩獵中的日誌區塊固定高度縮小(原 340px→260px);狩獵中由原作者的 flex:1 規則接管,不受影響 */
    '#col-center #log-row{flex:0 0 260px;}' +
    /* E:潘朵拉黑市 4 欄→2 欄放大(見上方檔頭說明) */
    '#interaction-content div[style*="repeat(4,minmax(0,1fr))"]{grid-template-columns:repeat(2,minmax(0,1fr))!important;}';

  function inject() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  inject();
  console.log('[AFK-uilayout] hooks OK — 分頁按鈕列/日誌區塊高度已縮小。');
})();
