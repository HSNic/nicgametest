/*
 * afk-pet-shortcut.js — 冒險地圖頂部快捷鈕列新增「寵物管理」，等同亞丁「包武」NPC(寵物保管)功能。
 *
 * 寫法完全比照 afk-track-shortcut.js：借用 #town-interaction-container 這個共用浮動視窗 +
 * interactNPC() 全域函式直接開啟 renderPetStorageNPC()(js/22-pets.js)產生的介面，不重寫任何
 * 寵物保管/出戰/進化/放生的業務邏輯，只負責「開窗」。
 *
 * 優雅降級：找不到插入錨點或 interactNPC 不存在時，console.warn 後安靜不掛按鈕。
 */
(function () {
  function findAnchor() {
    return document.getElementById('btn-track-shortcut') || document.getElementById('btn-pandora-shortcut');
  }

  function ensureButton() {
    var anchor = findAnchor();
    if (!anchor || document.getElementById('btn-pet-shortcut')) return;
    var btn = document.createElement('button');
    btn.id = 'btn-pet-shortcut';
    btn.className = anchor.className;
    btn.title = '開啟寵物管理(與亞丁包武共用同一套寵物保管)';
    btn.textContent = '寵物管理';
    btn.addEventListener('click', openPetShortcut);
    anchor.insertAdjacentElement('afterend', btn);
  }

  function openPetShortcut() {
    if (typeof interactNPC !== 'function') { console.warn('[AFK-pet] interactNPC 不存在，無法開啟寵物管理視窗'); return; }
    var panel = document.getElementById('town-interaction-container');
    if (!panel) { console.warn('[AFK-pet] 找不到 #town-interaction-container'); return; }
    if (panel.parentElement && panel.parentElement.id === 'town-view') document.body.appendChild(panel);
    interactNPC('npc_baowu', 'town_aden');
  }

  function init() {
    if (typeof interactNPC !== 'function') { console.warn('[AFK-pet] hooks 缺失(interactNPC)，外掛停用'); return; }
    ensureButton();
    setInterval(ensureButton, 1000);   // 冒險地圖面板可能被重繪，按鈕消失時自動補回
    console.log('[AFK-pet] hooks OK');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
