/* ============================================================================
 * afk-mobname.js — 顯示怪物名稱開關(整合進「⚙ 設定」彈窗,afk-quickpanel.js)
 *
 * 原版行為:戰鬥畫面的怪物名字平常隱藏(opacity:0),滑鼠移到「怪物圖片」上才浮出。
 * 本外掛加一個開關:
 *   - 開:場上所有怪物的名字一直顯示
 *   - 關:原版行為(滑鼠移到怪物圖片上才顯示)
 *
 * 2026-07-13 使用者要求簡化:原本是「全部常駐/鎖定中常駐/原版」三選一(獨立彈窗),
 * 現在「⚙ 設定」裡其他項目都是簡單開關樣式,這項也簡化成開關,拿掉中間的「鎖定中常駐」
 * 選項。本檔只留資料存取與 CSS 套用,開關 UI 交給 afk-quickpanel.js 呼叫 window.AFK_MOBNAME。
 *
 * 實作:純 CSS + body 上一個 data 屬性驅動,不碰原作者的渲染邏輯。
 *   戰鬥畫面每 tick 會整列重繪 #mob-list,但屬性掛在 body、規則走後代選擇器,
 *   新生成的怪卡自動套用,無需在每次重繪後補 JS(零 per-tick 成本)。
 *   只「加上 opacity:1」,原版的 hover 顯示規則照常運作(開關關閉時 hover 仍會顯示)。
 *
 * 設定存自己的 localStorage 鍵(afk_mobname_mode),不碰原作者存檔。
 * 優雅降級:抓不到 window 也照樣套用已存的顯示模式,只是少了設定入口。
 * 掛接:在 index.html 的 </body> 前加一行 <script src="afk-mobname.js"></script>
 * ========================================================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'afk_mobname_mode';   // 沿用舊 key;值只剩 'all'(開)/'vanilla'(關)

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  // 舊版存過 'locked'(已移除的中間選項)一併視為關閉,不特別遷移。
  function readOn() { try { return localStorage.getItem(STORAGE_KEY) === 'all'; } catch (e) { return false; } }
  function saveOn(on) { try { localStorage.setItem(STORAGE_KEY, on ? 'all' : 'vanilla'); } catch (e) {} }
  function applyMode(on) { if (document.body) document.body.setAttribute('data-afk-mobname', on ? 'all' : 'vanilla'); }

  function injectCSS() {
    if (document.getElementById('afk-mobname-style')) return;
    var s = document.createElement('style');
    s.id = 'afk-mobname-style';
    // 只加 opacity:1(原版 hover 規則不動)。選擇器特異性高於原版 `#battle-view .mob-name`,再加 !important 保險。
    s.textContent = [
      'body[data-afk-mobname="all"] #battle-view .mob-name{opacity:1 !important;}',
      /* 手機:開啟時讓怪名「完整顯示」——覆蓋原版/手機版的截斷(area-fit 五格的 nowrap+省略號、
         非 area-fit 的 -webkit-line-clamp:2)。使用者指定:不換行、直接超出卡片、左右置中(靠 .mob-name 的
         flex justify-center,超寬的單行 span 會置中並往左右對稱溢出;battle-view overflow:hidden 在框邊收邊)。
         那些遊戲規則都沒帶 !important,故此處 !important 即蓋過。 */
      'body.m-mobile[data-afk-mobname="all"] #battle-view .mob-name{white-space:nowrap !important;overflow:visible !important;}',
      'body.m-mobile[data-afk-mobname="all"] #battle-view .mob-name>span{white-space:nowrap !important;overflow:visible !important;text-overflow:clip !important;max-width:none !important;-webkit-line-clamp:unset !important;}'
    ].join('');
    document.head.appendChild(s);
  }

  function init() {
    injectCSS();
    applyMode(readOn());   // 先套用已存的顯示模式(即使沒有設定入口也生效)
    window.AFK_MOBNAME = {
      isOn: readOn,
      setOn: function (on) { saveOn(on); applyMode(on); }
    };
    console.log('[AFK-mobname] hooks OK — 顯示怪物名稱已整合進「⚙ 設定」開關。');
  }

  ready(init);
})();
