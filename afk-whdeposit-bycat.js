/* ============================================================================
 * afk-whdeposit-bycat.js — 一鍵存入只存入「目前分類篩選」命中的物品
 *
 * 為什麼:原作者 whOneClickDeposit() 一次性掃過整個背包,不管倉庫視窗目前選的是
 *   哪個主分類(武器/裝備/道具)、哪個子分類(如道具底下的「卡片」),一律全部混著跑。
 *   使用者需求:當我停在「道具→卡片」這個篩選畫面時,按一鍵存入應該只存卡片,
 *   不要把武器防具道具全部一次存掉。
 *
 * 做法:不改 js/12-npc-quests.js,直接整支覆寫全域 whOneClickDeposit(仍是同一個
 *   函式名,倉庫視窗現有的「一鍵存入」按鈕 onclick="whOneClickDeposit()" 不用動)。
 *   核心比對規則(簽章相同才存/鎖定保護/倉庫滿了就停)完全照抄原函式,只多一個
 *   whMatchFilter(it.id) 條件——這正是倉庫視窗「主分類+子分類」下拉選單自己用來
 *   判斷「這個物品算不算目前篩選命中」的同一個函式,不用另外定義規則。
 *
 * 優雅降級:找不到 loadWarehouse/saveWarehouse/whMatchFilter/whSig/_whStackFind/
 *   WH_NO_STORE/WH_MAX/player 任一全域就 console.warn 並不覆寫(原函式照舊運作)。
 * 掛接:index.html </body> 前需加一行 <script src="afk-whdeposit-bycat.js?v=..."></script>
 *   (純接管全域函式,無 DOM 掛點需求;有掛點檢查:覆寫成功才印 hooks OK)
 * ========================================================================== */
(function () {
  'use strict';

  var MAIN_CN = { weapon: '武器', armor: '裝備', item: '道具' };

  function init() {
    if (typeof whOneClickDeposit !== 'function' || typeof loadWarehouse !== 'function' ||
        typeof saveWarehouse !== 'function' || typeof whMatchFilter !== 'function' ||
        typeof whSig !== 'function' || typeof _whStackFind !== 'function' ||
        typeof WH_NO_STORE === 'undefined' || typeof WH_MAX === 'undefined' ||
        typeof player === 'undefined') {
      console.warn('[AFK-whdeposit-bycat] 缺少必要全域,一鍵存入維持原作者版本(不分類別)。');
      return;
    }

    // 目前篩選的中文標籤(給結果訊息用):主分類 +（若有子分類）子分類名稱
    function filterLabel() {
      var main = MAIN_CN[_whFilter] || _whFilter;
      if (!_whSubFilter) return main;
      var opts = (typeof whSubCatOptions === 'function') ? whSubCatOptions() : [];
      var opt = opts.find(function (o) { return o.key === _whSubFilter; });
      return main + (opt ? ('－' + opt.name) : '');
    }

    window.whOneClickDeposit = function () {
      var w = loadWarehouse();
      var whSigs = new Set(w.items.map(whSig));
      var deposited = 0, full = false;
      var snapshot = player.inv.slice();
      for (var i = 0; i < snapshot.length; i++) {
        var it = snapshot[i];
        if (!whMatchFilter(it.id)) continue;              // 只處理目前主分類+子分類篩選命中的物品
        if (WH_NO_STORE.indexOf(it.id) >= 0) continue;    // 不可存入
        if (it.lock) continue;                             // 鎖定物品保護
        if (!whSigs.has(whSig(it))) continue;               // 倉庫沒有完全相同的 → 跳過
        var idx = player.inv.findIndex(function (x) { return x.uid === it.uid; });
        if (idx < 0) continue;
        var cur = player.inv[idx];
        var stack = _whStackFind(w.items, cur);
        if (!stack && w.items.length >= WH_MAX) { full = true; break; }
        player.inv.splice(idx, 1);
        if (stack) { stack.cnt += cur.cnt; } else { w.items.push(cur); whSigs.add(whSig(cur)); }
        deposited++;
      }
      saveWarehouse(w);

      if (typeof saveGame === 'function') saveGame();
      if (typeof renderTabs === 'function') renderTabs(true);
      if (typeof updateUI === 'function') updateUI();
      var el = document.getElementById('interaction-content');
      if (el && typeof renderWarehouseNPC === 'function') renderWarehouseNPC(el);

      if (typeof logSys !== 'function') return;
      var label = filterLabel();
      if (deposited > 0) {
        logSys('<span class="text-cyan-300 font-bold">一鍵存入（' + label + '）：已存入 ' + deposited +
          ' 項與倉庫現有物品相同的物品' + (full ? '（倉庫已滿，部分未存入）' : '') + '。</span>');
      } else {
        logSys(full ? '<span class="text-red-400">倉庫已滿，無法存入。</span>'
          : '背包中沒有符合「' + label + '」篩選、且與倉庫現有物品完全相同的可存入物品。');
      }
    };

    console.log('[AFK-whdeposit-bycat] hooks OK');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
