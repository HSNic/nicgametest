/* ============================================================================
 * afk-syncinfo.js — 外掛工具面板文字精簡(2026-07-08 起不再顯示內容)
 *
 * 原本這裡顯示「原作者+正版連結」與「巴哈討論串/LINE/Discord」連結,使用者要求
 * 精簡外掛工具面板文字(A1),把這兩塊整段移除;加掛版版本號改由 afk-skin.js 顯示在
 * 標題下方(A3),不再放這裡。
 *   - 檔名沿用歷史名稱(原本顯示「原版最後同步時間」),避免改名折騰快取與引用。
 *   - 保留檔案與 hooks OK log(smoke test 仍會檢查),只是不再對 DOM 做任何輸出。
 *
 * 掛接:在 index.html 的 </body> 前加一行 <script src="afk-syncinfo.js"></script>
 * ========================================================================== */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function init() {
    var menu = document.getElementById('main-menu');
    if (!menu) { console.warn('[AFK-syncinfo] 找不到 #main-menu。'); return; }
    console.log('[AFK-syncinfo] hooks OK — 面板文字已精簡(不再顯示原作者/社群連結)。');
  }

  ready(init);
})();
