/*
 * afk-track-shortcut.js — 冒險地圖頂部「黑市」按鈕旁新增「魔物追蹤」快捷鈕(桌機/手機皆顯示)。
 *
 * 功能等同主城內的魔物追蹤 NPC(奧貝勒／赫特／帝倫，三城共用同一份 player.tracking 資料與
 * renderObelNPC 渲染邏輯，見 js/11-world-map.js)，只是不用先跑回城鎮再找 NPC，直接在冒險地圖
 * 頂部按一下就能開啟同一個浮動視窗——寫法完全比照原作者自己寫的黑市快捷鍵 openPandoraShortcut()
 * (js/11-world-map.js)：借用 #town-interaction-container 這個共用浮動視窗 + interactNPC() 全域
 * 函式，不重寫任何魔物追蹤的業務邏輯，只負責「開窗」與「按鈕上顯示倒數」。
 *
 * 按鈕文字：沒有追蹤中 → 顯示「魔物追蹤」；追蹤中 → 每秒更新顯示剩餘時間(H:MM:SS)，時間到
 * 自動變回「魔物追蹤」。倒數資料來源 player.tracking.until，跟 js/11-world-map.js 的
 * renderObelNPC 算法一致(牆鐘時間差，不是 tick 計數)。
 *
 * 優雅降級：找不到 #btn-pandora-shortcut(原作黑市按鈕改版/移除)或 interactNPC 不存在時，
 * console.warn 後安靜不掛按鈕，不影響遊戲其他功能。
 */
(function () {
  function ensureButton() {
    var anchor = document.getElementById('btn-pandora-shortcut');
    if (!anchor || document.getElementById('btn-track-shortcut')) return;
    var btn = document.createElement('button');
    btn.id = 'btn-track-shortcut';
    btn.className = anchor.className;
    btn.title = '開啟魔物追蹤(與主城奧貝勒/赫特/帝倫共用同一套追蹤)';
    btn.textContent = '魔物追蹤';
    btn.addEventListener('click', openTrackShortcut);
    anchor.insertAdjacentElement('afterend', btn);
  }

  function openTrackShortcut() {
    if (typeof interactNPC !== 'function') { console.warn('[AFK-track] interactNPC 不存在，無法開啟魔物追蹤視窗'); return; }
    var panel = document.getElementById('town-interaction-container');
    if (!panel) { console.warn('[AFK-track] 找不到 #town-interaction-container'); return; }
    if (panel.parentElement && panel.parentElement.id === 'town-view') document.body.appendChild(panel);
    interactNPC('npc_obel', 'town_kent_castle');
  }

  function fmtLeft(ms) {
    var totalSec = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function tickCountdown() {
    var btn = document.getElementById('btn-track-shortcut');
    if (!btn) return;
    var tr = (typeof player !== 'undefined' && player) ? player.tracking : null;
    if (tr && tr.until > Date.now()) {
      btn.textContent = fmtLeft(tr.until - Date.now());
    } else {
      btn.textContent = '魔物追蹤';
    }
  }

  function init() {
    if (typeof interactNPC !== 'function') { console.warn('[AFK-track] hooks 缺失(interactNPC)，外掛停用'); return; }
    ensureButton();
    setInterval(ensureButton, 1000);   // 冒險地圖面板可能被重繪，按鈕消失時自動補回
    setInterval(tickCountdown, 1000);
    console.log('[AFK-track] hooks OK');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
