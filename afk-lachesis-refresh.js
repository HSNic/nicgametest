/* ============================================================================
 * afk-lachesis-refresh.js — 席琳神殿「菈克希絲遺骸拆分」面板換裝即時刷新(Bug D)
 *
 * 背景:renderLachesisSplit(js/12-npc-quests.js)只有按下「拆分」鈕之後才會重繪
 *   面板;若玩家在這個 NPC 面板開著時跑去裝備分頁換裝,面板沒有任何機制去 hook 到
 *   換裝事件,畫面不會更新,要退出面板再點入才抓得到最新的穿著裝備。
 *
 * 做法:monkey-patch window.equipItem/window.unequipItem(核心函式,js/08-items-
 *   equip.js,換裝的唯一入口),原函式跑完後,只要目前 #interaction-content 顯示的
 *   正是菈克希絲拆分面板(用面板固定的招呼詞「命運的絲線纏在你的裝備上」當識別標記,
 *   不判斷 DOM 結構),就重新呼叫 renderLachesisSplit() 就地重繪;面板沒開著或開的是
 *   其他 NPC(這個容器是全部 NPC 互動共用)則什麼都不做,不會洗版到其他面板。
 *
 * 掛接:在 index.html 的 </body> 前加一行 <script src="afk-lachesis-refresh.js"></script>
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof window.equipItem !== 'function' || typeof window.unequipItem !== 'function' || typeof window.renderLachesisSplit !== 'function') {
    console.warn('[AFK-lachesis-refresh] 缺少核心掛點(equipItem/unequipItem/renderLachesisSplit),即時刷新停用。');
    return;
  }

  var MARKER = '命運的絲線纏在你的裝備上';   // 菈克希絲面板固定招呼詞,當作「目前開的是這面板」的識別標記
  function refreshIfOpen() {
    try {
      var el = document.getElementById('interaction-content');
      if (el && el.textContent && el.textContent.indexOf(MARKER) >= 0) renderLachesisSplit(el);
    } catch (e) { console.warn('[AFK-lachesis-refresh] 重繪失敗:', e); }
  }

  var _origEquip = window.equipItem;
  window.equipItem = function () {
    var ret = _origEquip.apply(this, arguments);
    refreshIfOpen();
    return ret;
  };

  var _origUnequip = window.unequipItem;
  window.unequipItem = function () {
    var ret = _origUnequip.apply(this, arguments);
    refreshIfOpen();
    return ret;
  };

  console.log('[AFK-lachesis-refresh] hooks OK');
})();
