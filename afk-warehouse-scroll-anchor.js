/* ============================================================================
 * afk-warehouse-scroll-anchor.js — 倉庫存/取物品時畫面不再跳動(捲動錨定)
 *
 *   本體 js/12-npc-quests.js 的 renderWarehouseNPC() 每次存入/取出都會把兩份清單
 *   (#wh-inv-list 背包側、#wh-store-list 倉庫側)整個 innerHTML 重建,本體自己
 *   雖然有「記住 scrollTop 數值、重建後設回去」的還原機制,但存/取後清單會多一列
 *   /少一列、總高度改變,舊的 px 數值套到新高度的清單上,對應到的已經不是同一格
 *   物品,畫面才會跳動。
 *
 *   解法(捲動錨定,不是還原數值,而是還原「畫面上同一個物品格子」):包裝
 *   renderWarehouseNPC,呼叫本體函式前先記下兩份清單目前可視範圍內第一個物品格子
 *   的 data-tip-uid 與它在螢幕上的像素位置;本體重建完後,在新 DOM 裡重新找到同一個
 *   uid 的格子,往上找「目前真正在捲動的容器」(桌機版是清單自己;手機版是外層
 *   #interaction-content/.warehouse-window-content——見下方 2026-07-13 附註),把它
 *   釘回原本畫面上的位置。找不到(該格子整疊被存/取完、已經不存在)就放棄還原,
 *   維持本體原本設定的數值,不會報錯。
 *
 *   ⚠️ 2026-07-13 實測發現:afk-mobile.js 已經針對「手機上這兩份清單巢狀捲動導致
 *   iOS 手勢判斷失效」做過修正(手機上讓兩份清單 max-height:none/overflow:visible,
 *   不自己捲,改交給外層 #interaction-content 單一捲動),所以手機版本來就只有
 *   一層在捲、不是文件原先假設的「三層同時捲動」。這裡的錨定邏輯改成「往上找目前
 *   真正在捲動的祖先容器」而非寫死清單自己,桌機/手機兩種情境都能正確處理,
 *   也不會動到 afk-mobile.js 既有的手機版單層捲動設計。
 *
 *   只包裝既有函式,不動本體 js/12-npc-quests.js;找不到 renderWarehouseNPC 就安靜
 *   停用。不掛 DOM,不列入 scripts/smoke-hooks.mjs 的掛點冒煙檢查。
 *
 * 掛接:在 index.html </body> 前加一行 <script src="afk-warehouse-scroll-anchor.js?v=..."></script>
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof window.renderWarehouseNPC !== 'function') {
    console.warn('[AFK-wh-scroll-anchor] 找不到 window.renderWarehouseNPC,可能原作者改了倉庫渲染邏輯,已安靜停用(不影響倉庫功能,只是畫面跳動問題不會被修正)。');
    return;
  }

  var _origRenderWarehouseNPC = window.renderWarehouseNPC;

  function findByUid(container, uid) {
    var els = container.querySelectorAll('[data-tip-uid]');
    for (var i = 0; i < els.length; i++) {
      if (els[i].getAttribute('data-tip-uid') === uid) return els[i];
    }
    return null;
  }

  // 從物品格子往上找「目前真正在捲動的容器」:桌機是清單自己(overflow-y:auto+max-height),
  // 手機是外層互動面板/倉庫浮窗(afk-mobile.js 已讓清單本身不捲,交給外層單一捲動)。
  function findScrollParent(el) {
    var p = el && el.parentElement;
    while (p && p !== document.body) {
      var cs = getComputedStyle(p);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
      p = p.parentElement;
    }
    return null;
  }

  // 記錄「目前可視範圍內第一個物品格子」的 uid 與它在螢幕上的像素位置(視窗座標,不綁定特定捲動層)
  function captureAnchor(listId) {
    var list = document.getElementById(listId);
    if (!list) return null;
    var items = list.querySelectorAll('[data-tip-uid]');
    for (var i = 0; i < items.length; i++) {
      var r = items[i].getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) {   // 目前螢幕上看得到的第一個格子
        return { listId: listId, uid: items[i].getAttribute('data-tip-uid'), screenY: r.top };
      }
    }
    return null;
  }

  // 重建後,把同一個 uid 的格子釘回原本螢幕上的位置(調整它目前實際的捲動祖先)
  function restoreAnchor(anchor) {
    if (!anchor) return;
    var list = document.getElementById(anchor.listId);
    if (!list) return;
    var target = findByUid(list, anchor.uid);
    if (!target) return;   // 該格子整疊被存/取完、已不存在 → 放棄還原,維持本體原本的數值
    var delta = target.getBoundingClientRect().top - anchor.screenY;
    if (!delta) return;
    var scroller = findScrollParent(target);
    if (scroller) scroller.scrollTop += delta;
  }

  window.renderWarehouseNPC = function (div) {
    var invAnchor = captureAnchor('wh-inv-list');
    var storeAnchor = captureAnchor('wh-store-list');
    _origRenderWarehouseNPC(div);
    // 本體重建當下已經同步設過一次(用舊 px 數值,可能不準);等這一輪畫面 layout 完成後,
    // 用捲動錨定再蓋一次正確位置當最終結果,避免跟瀏覽器原生 scroll anchoring 打架。
    // 兩次 restoreAnchor 依序各自重新量測「當下」位置,即使兩份清單共用同一個捲動祖先
    // (手機單欄堆疊的情況)也會收斂到正確結果,不會互相蓋掉。
    requestAnimationFrame(function () {
      restoreAnchor(invAnchor);
      restoreAnchor(storeAnchor);
    });
  };

  // 避免瀏覽器原生 scroll anchoring 在下一影格自己調整一次、跟我們手動還原的結果打架。
  var style = document.createElement('style');
  style.textContent = '#wh-inv-list,#wh-store-list{overflow-anchor:none;}';
  document.head.appendChild(style);

  console.log('[AFK-wh-scroll-anchor] hooks OK — 倉庫存取物品時的畫面跳動已修正(捲動錨定)。');
})();
