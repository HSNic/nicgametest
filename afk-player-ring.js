/* ============================================================================
 * afk-player-ring.js — 玩家角色專屬淡藍光圈特效(純 CSS 疊加,不動任何遊戲邏輯)
 *
 * 需求:玩家自己的角色在戰鬥畫面上套用固定淡藍色光暈,排除傭兵。
 *
 * 依據:
 *   - 玩家角色 DOM:`js/09-vfx-render.js` 的 `_playerMorphApply()` 動態建立
 *     `<div id="player-morph-sprite">`,內含 `.pm-shadow`/`.pm-body`(img)/`.pm-weapon`
 *     三層,此節點建立後只更新屬性、不會整段 innerHTML 重繪,套上的 class/樣式不會被
 *     遊戲邏輯洗掉。
 *   - 傭兵 DOM:`_allySpritesApply()` 建立的是 `<div class="party-sprite">`(內含同名
 *     `.pm-shadow`/`.pm-body`,但外層容器沒有 `#player-morph-sprite` id)——用 id 選擇器
 *     `#player-morph-sprite .pm-body` 天然只命中玩家、排除傭兵,不需要額外判斷式。
 *   - 效果做法比照原作選怪紅光圈(`css/style.css` 的
 *     `#battle-view.has-bg .mob-target.active .mob-img-inner{filter:drop-shadow(...)}`):
 *     用 `filter:drop-shadow` 貼合圖片透明輪廓產生色光暈。
 *
 * 純 CSS id 選擇器,節點動態建立/銷毀(進出戰鬥、切換地圖)時規則自動生效/失效,
 * 不需要 MutationObserver 或任何 JS 邏輯維持效果。
 *
 * 掛接:在 index.html 的 </body> 前加一行 <script src="afk-player-ring.js"></script>
 * ========================================================================== */
(function () {
  'use strict';

  var STYLE_ID = 'afk-player-ring-style';
  var RING_COLOR = '#7dd3fc';   // 淡藍色

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '#player-morph-sprite .pm-body{filter:drop-shadow(0 0 4px ' + RING_COLOR + ') drop-shadow(0 0 7px ' + RING_COLOR + ');}';
    document.head.appendChild(s);
  }

  injectStyle();
  console.log('[AFK-player-ring] hooks OK — 玩家角色套用淡藍光圈(排除傭兵)。');
})();
