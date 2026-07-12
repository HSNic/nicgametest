/* ============================================================================
 * afk-junk-to-rule.js — 廢品標記同步進「自動販賣規則」的各別例外清單(Bug C)
 *
 * 背景:標記物品為「廢品」時,player.junkPrefs 已經會記住這個簽章(含詞綴),之後
 *   同簽章新掉落也會自動標記廢品並延遲販售——但這份記憶不會同步寫進
 *   getAutoSellRules().overrides,玩家在「自動販賣規則」視窗看不到、也無法從那邊
 *   管理或取消,形同兩條互相獨立的規則。
 *
 * 做法:monkey-patch window.toggleJunk(核心函式,js/10-ui-tabs.js),原函式跑完後
 *   依 item.junk 的最終狀態同步 getAutoSellRules().overrides[item.id]:
 *   - 勾選為廢品 → overrides[id] = 'sell'(比照玩家在規則視窗按「永遠販賣」)。
 *   - 取消廢品   → 若該 id 目前的例外正是 'sell' 就一併移除,回到「沒有個別例外」。
 *   原函式有兩種「其實沒有真的切換」的提前 return(item.lock 鎖定 / d.noJunk 收集冊等
 *   不可標廢品的物品),這裡照抄同樣的條件先擋掉,避免誤刪玩家在規則視窗設定的例外。
 *   若規則視窗剛好開著,呼叫 openAutoSellRules() 讓清單即時刷新(與 afk-autosell-ui.js
 *   批次設定例外後的做法一致)。
 *
 * 注意:overrides 是「依物品本體全局套用」(id 層級,不分詞綴),跟 junkPrefs 的
 *   「完整簽章(id+詞綴)」不同粒度——這裡只是讓「這個 id 預設賣」在規則視窗可見/可管理,
 *   不影響 junkPrefs 既有的精細記憶行為。
 *
 * 掛接:在 index.html 的 </body> 前加一行 <script src="afk-junk-to-rule.js"></script>
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof window.toggleJunk !== 'function' || typeof window.getAutoSellRules !== 'function') {
    console.warn('[AFK-junk2rule] 缺少核心掛點(toggleJunk/getAutoSellRules),廢品同步停用。');
    return;
  }

  var _origToggleJunk = window.toggleJunk;
  window.toggleJunk = function (uid) {
    var ret = _origToggleJunk.apply(this, arguments);
    try {
      var item = (player.inv || []).find(function (i) { return i.uid === uid; });
      if (!item || !item.id || item.lock) return ret;   // 找不到物品/鎖定中:原函式提前 return,沒有真的切換,不同步
      var d = (typeof DB !== 'undefined' && DB.items) ? DB.items[item.id] : null;
      if (!d || d.noJunk) return ret;                    // noJunk(如收集冊)無法標為廢品,原函式也提前 return,不同步
      var r = getAutoSellRules();
      if (item.junk) {
        r.overrides[item.id] = 'sell';
      } else if (r.overrides[item.id] === 'sell') {
        delete r.overrides[item.id];
      }
      if (document.getElementById('autosell-rule-modal') && typeof openAutoSellRules === 'function') {
        openAutoSellRules();   // 規則視窗開著就重繪,讓「各別例外」清單即時反映(比照 afk-autosell-ui.js 批次設定例外的做法)
      }
    } catch (e) { console.warn('[AFK-junk2rule] 同步失敗:', e); }
    return ret;
  };

  console.log('[AFK-junk2rule] hooks OK');
})();
