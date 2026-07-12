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
 * G. 2026-07-13 使用者回報:背包分頁「⚡快速強化/🗑️快速廢品」文字會換行,只有外掛自己的
 *    「🧺批次販賣」不會換行——查 js/10-ui-tabs.js buildQuickHeader() 只給這兩顆按鈕 flex-1,
 *    沒加 white-space:nowrap(批次販賣按鈕是 afk-batch-sell.js 自己的 class、已自帶
 *    nowrap)。純 CSS 覆寫補上 nowrap,不改 DOM/邏輯。
 * F. 2026-07-13 使用者回報:選角畫面(#load-slot-grid)桌機版 4 個角色卡片,拱門裡面是純黑色
 *    (原作 `load.png` 這張圖,拱門內本來就是黑色留白,只有拱門周圍雕花有場景);手機版
 *    (afk-mobile.js)因為一次只顯示 1 張卡,已經另外把同一張圖放大裁切當背景、看起來像
 *    角色站在城堡場景裡。桌機版比照做,但 4 張卡並排、用使用者選定的方向:**四格共用同一張
 *    裁切後的場景圖**(不分別調每格),讓 4 個角色像站在同一片連續場景前。只在桌機生效
 *    (`body:not(.m-mobile)`),避免跟 afk-mobile.js 自己那組 mobile 專用的 background-image
 *    互相打架(兩者互斥,各自的 body class 選擇器天生不會同時命中)。
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
    '#interaction-content div[style*="repeat(4,minmax(0,1fr))"]{grid-template-columns:repeat(2,minmax(0,1fr))!important;}' +
    /* F:選角畫面桌機版 4 格共用同一張裁切場景圖(見上方檔頭說明);只在非手機生效,避免跟
       afk-mobile.js 的 mobile 專用 background-image 衝突 */
    'body:not(.m-mobile) #load-slot-grid{background-image:url(public/assets/login/load.png);background-repeat:no-repeat;background-size:180% auto;background-position:50% 22%;}' +
    'body:not(.m-mobile) .load-slot-card.empty,body:not(.m-mobile) .load-slot-card.filled{background:rgba(3,3,3,.32);}' +
    /* G:快速強化/快速廢品按鈕文字不換行(見上方檔頭說明) */
    'button[onclick^="toggleQuickEnhance"],button[onclick^="toggleQuickJunk"]{white-space:nowrap!important;}';

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
