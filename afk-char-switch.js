/* ============================================================================
 * afk-char-switch.js — 「協力傭兵隊伍」面板加「存檔並切換至此角色」
 *
 * 為什麼:傭兵系統(js/06-status-allies.js)是「唯讀深拷貝快照+AI自動戰鬥」,操控權
 *   從未離開目前存檔位。玩家想直接玩已上場的某個傭兵角色,原本只能退回主選單重新
 *   選存檔位讀取。本外掛在左側常駐的「協力傭兵隊伍」面板(js/10-ui-tabs.js
 *   renderSquadPanel,#squad-tab-team 內每張傭兵卡)多加一顆按鈕,重用既有
 *   「選存檔位讀取」路徑(currentSlot=n; loadGame();)——跟標題畫面「載入遊戲進度」
 *   選存檔位是同一條路徑,不是另開一套機制。
 *
 * 只處理「上場中、未倒地」的傭兵卡(有 #squad-status-<slot> 這個掛點)；倒地卡片
 *   結構不同(橫向兩顆復活按鈕),先不處理——先求有的粗略版,之後有需要再補。
 *
 * 風險與防呆:
 *   1. 切換前用 saveGame() 存目前角色,但比照存檔鐵則先確認 player.cls 有效才存,
 *      避免空白角色蓋掉存檔(見 CLAUDE.md「外掛絕不可盲呼叫會寫入存檔的原作者函式」)。
 *   2. 多分頁風險無法在前端偵測,改在確認彈窗文案提醒玩家自行避免。
 *   3. loadGame() 本身會處理畫面切換與 changeMap(true) 重繪村莊互動面板,
 *      本外掛不需要額外處理畫面收尾。
 *
 * 優雅降級:找不到 renderSquadPanel/slotSummary/loadGame/saveGame/player/currentSlot
 *   任一全域就 console.warn 並不覆寫(原面板照舊運作)。
 * 掛接:index.html </body> 前需加一行 <script src="afk-char-switch.js?v=..."></script>
 *   (monkey-patch renderSquadPanel,DOM 掛點為 #squad-tab-team 內的傭兵卡)
 * ========================================================================== */
(function () {
  'use strict';

  function init() {
    if (typeof renderSquadPanel !== 'function' || typeof slotSummary !== 'function' ||
        typeof loadGame !== 'function' || typeof saveGame !== 'function' ||
        typeof player === 'undefined' || typeof currentSlot === 'undefined') {
      console.warn('[AFK-char-switch] 缺少必要全域,隊友切換角色功能停用。');
      return;
    }

    var origRenderSquadPanel = renderSquadPanel;
    window.renderSquadPanel = function () {
      var r = origRenderSquadPanel.apply(this, arguments);
      try { injectSwitchButtons(); } catch (e) { console.warn('[AFK-char-switch] 注入切換鈕失敗', e); }
      return r;
    };

    function injectSwitchButtons() {
      var container = document.getElementById('squad-tab-team');
      if (!container) return;
      var allies = (player && player.allies) ? player.allies.filter(Boolean) : [];
      allies.forEach(function (a) {
        if (a._downed) return;   // 倒地卡結構不同,先不處理
        var s = a._slot;
        if (s === undefined || s === null) return;
        var statusEl = document.getElementById('squad-status-' + s);
        if (!statusEl) return;
        var card = statusEl.parentElement;
        if (!card || card.querySelector('.afk-switch-btn')) return;   // 每幀都會呼叫,避免重複注入

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'afk-switch-btn btn py-1 px-2 text-xs font-bold bg-indigo-900 border-indigo-700 text-indigo-200 w-full';
        btn.style.minHeight = '36px';   // 觸控目標:text-xs 本身偏矮,手動補高
        btn.textContent = '💾 切換至此角色';
        btn.addEventListener('click', function () { confirmSwitch(s); });
        card.appendChild(btn);
      });
    }

    function confirmSwitch(slotN) {
      var sum = slotSummary(slotN);
      var label = sum ? (sum.cls + ' Lv.' + sum.lv + (sum.name ? '　' + sum.name : '')) : ('存檔 ' + slotN);
      var doSwitch = function () {
        if (player && player.cls) {   // 🛡️ 空白角色(未載入)禁止 saveGame,避免蓋掉真實存檔
          try { saveGame(); } catch (e) { console.warn('[AFK-char-switch] 切換前存檔失敗', e); }
        }
        currentSlot = parseInt(slotN, 10);
        try { loadGame(); } catch (e) { console.warn('[AFK-char-switch] loadGame 失敗', e); }
      };
      var msg = '確定要存檔目前角色，並切換至「' + label + '」嗎？\n\n' +
        '⚠️ 若「存檔 ' + slotN + '」同時開著其他分頁在遊玩，請先關閉該分頁再切換，避免存檔互相覆蓋。';
      if (window.AFK_UI && typeof window.AFK_UI.confirm === 'function') {
        window.AFK_UI.confirm({ title: '切換角色', message: msg, okText: '確定切換', cancelText: '取消', onOk: doSwitch });
      } else if (window.confirm(msg)) {
        doSwitch();
      }
    }

    console.log('[AFK-char-switch] hooks OK');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
