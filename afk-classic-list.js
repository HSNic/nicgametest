/*
 * afk-classic-list.js — 道具/武器/防具/裝備清單「恢復舊版橫列式外觀」外掛(純 CSS 覆寫,不動 DOM/邏輯)
 *
 * 背景:新版 js/10-ui-tabs.js(原作者本體,不可修改)新增了 decorateClassicInventoryTab(div)，
 *   把 tab-items/tab-weapons/tab-armors/tab-equip 的清單內容搬進「八格背包底圖」的方格 viewport，
 *   並用 CSS `.classic-inventory-viewport > .list-item .classic-name-box { display:none; }`
 *   把物品名稱藏起來，只剩大圖示。
 *
 * 關鍵發現(2026-07-07 核對程式碼後確認):
 *   每一列的名稱、狀態文字([已學習]/[無法裝備])、鎖頭、廢品標記，其實 DOM 都已經生成好了，
 *   只是被上面那條 CSS 規則用 display:none 蓋住。因此「恢復舊版橫列式外觀」不需要動 DOM
 *   結構(不用 MutationObserver 拆殼、搬 .list-item 回原容器)，只要用一批 CSS 規則覆寫
 *   .classic-inventory-* 的版面(方格 → 橫列)，並把 .classic-name-box 蓋回 display:flex 即可。
 *   風險更低:完全不碰任何函式、不掛任何事件，原有的雙擊裝備/使用、排序選單、快速強化/
 *   快速廢品勾選、技能書視窗等功能都是靠 .list-item 本身的事件與 DOM 結構運作，不受純 CSS
 *   版面覆寫影響。
 *
 * 開關:改下面 ENABLED 為 false 即可整份停用(等同不載入這支外掛)，不影響其他外掛。
 *
 * 2026-07-07 使用者實測後追加:
 *   - 分頁背景改透明，跟「能力」分頁共用 .panel 底色，不再是純黑。
 *   - 角色不能裝備/不能學習的物品列(紅字 [無法裝備]/[無法學習])整列疊淡紅色提示。
 *   - 每列底色調淡(#12141a → #262b36)，原本太深看不清楚。
 */
(function () {
  var ENABLED = true;
  if (!ENABLED) { console.log('[AFK-classic-list] 已停用(ENABLED=false)'); return; }

  var STYLE_ID = 'afk-classic-list-style';
  var CSS = ''
    // 外層分頁容器:恢復成原本 Tailwind 的「本身捲動、p-3、flex-col、gap-2」清單樣式，
    // 讓 sticky 工具列(負重/快速強化/快速廢品)在捲動時照舊吸頂。背景改透明，讓外層
    // #tab-content-panel 的 .panel 底色透出來，跟「能力」分頁(#tab-stats)同一塊底色，不再是純黑。
    + '.classic-inventory-tab:not(.hidden){display:flex!important;flex-direction:column!important;gap:.5rem!important;padding:.75rem!important;overflow-y:auto!important;overflow-x:hidden!important;background:transparent!important;}'
    // 外殼:拿掉八格背包底圖與固定長寬比，改成內容自然高度的一般區塊。
    + '.classic-inventory-shell{position:relative!important;width:100%!important;max-width:100%!important;aspect-ratio:auto!important;background:none!important;overflow:visible!important;flex:0 0 auto!important;}'
    // viewport:拿掉方格 grid／絕對定位，改成直向清單，捲動交回外層分頁容器負責。
    + '.classic-inventory-viewport{position:static!important;left:auto!important;top:auto!important;width:100%!important;height:auto!important;display:flex!important;flex-direction:column!important;grid-template-columns:none!important;gap:4px!important;overflow:visible!important;background:none!important;padding-top:28px!important;box-sizing:border-box!important;}'
    // 每一列:方格 → 橫列(圖示在左、內容靠左延伸)。
    + '.classic-inventory-viewport>.list-item{display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:flex-start!important;width:100%!important;height:auto!important;min-height:36px!important;margin:0!important;padding:4px 8px!important;border:1px solid #3a3f4b!important;border-radius:4px!important;background:#262b36!important;box-shadow:none!important;gap:8px!important;}'
    // 8 格皮膚用來補滿方格的空白格，橫列式不需要。
    + '.classic-inventory-viewport>.classic-grid-empty{display:none!important;}'
    // 圖示縮小成固定小方塊，不再撐滿整格。
    + '.classic-inventory-viewport .classic-icon-box{flex:0 0 auto!important;width:28px!important;height:28px!important;margin:0!important;}'
    // 內容列改靠左排列。
    + '.classic-item-main{justify-content:flex-start!important;gap:8px!important;width:100%!important;height:auto!important;}'
    // 關鍵:把新版藏起來的物品名稱／欄位名稱蓋回來顯示。
    + '.classic-inventory-viewport>.list-item .classic-name-box{display:flex!important;flex:1 1 auto!important;min-width:0!important;}'
    // 鎖頭／廢品標記:方格右上角疊字 → 橫列式改成名稱後方的小標籤，避免遮到圖示或文字。
    + '.classic-inventory-viewport .classic-item-lock-badge{position:static!important;width:auto!important;height:auto!important;max-width:none!important;max-height:none!important;margin-left:4px!important;font-size:13px!important;flex:0 0 auto!important;}'
    + '.classic-inventory-viewport .classic-item-junk-label{position:static!important;left:auto!important;right:auto!important;bottom:auto!important;display:inline-block!important;margin-left:4px!important;padding:0 4px!important;border-radius:3px!important;font-size:10px!important;flex:0 0 auto!important;white-space:nowrap!important;}'
    // 角色不能裝備/不能學習的物品列:原版判定文字固定用 text-red-500(見 js/10-ui-tabs.js 的
    // [無法裝備]/[無法學習] statusTag)，用 :has() 抓含這個紅字 flag 的列，整列疊一層淡紅色底色。
    + '.classic-inventory-viewport>.list-item:has(.classic-item-flags .text-red-500){background:rgba(248,113,113,.22)!important;border-color:rgba(248,113,113,.55)!important;}'
    // 快速強化/快速廢品模式的勾選框:方格右上角 → 橫列式改成垂直置中在最右側。
    + '.classic-inventory-viewport input[type="checkbox"]{top:50%!important;right:6px!important;transform:translateY(-50%)!important;}'
    // 方格模式的「上/下捲動」浮鈕是給固定長寬比底圖用的，橫列式改回外層分頁容器原生捲動，這兩顆用不到。
    + '.classic-inventory-scroll{display:none!important;}'
    // 整理背包(↕)按鈕:改成固定在清單右上角的小按鈕，不再依附八格底圖的座標百分比。
    + '.classic-sort-wrap{position:absolute!important;left:auto!important;right:0!important;top:0!important;width:26px!important;height:22px!important;z-index:30!important;}'
    + '.classic-sort-menu{left:auto!important;right:0!important;top:100%!important;}';

  function inject() {
    if (document.getElementById(STYLE_ID)) return true;
    if (!document.head) return false;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
    return true;
  }

  if (inject()) {
    console.log('[AFK-classic-list] hooks OK — 道具/武器/防具/裝備清單已恢復舊版橫列式外觀(純 CSS 覆寫)。');
  } else {
    console.warn('[AFK-classic-list] 找不到 document.head，橫列式清單樣式停用。');
  }
})();
