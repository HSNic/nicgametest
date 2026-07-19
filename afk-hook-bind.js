/* ============================================================================
 * afk-hook-bind.js — 階段2:用 AFK_HOOK.wrap 包裝既有入口,發出統一事件
 *
 * 不修改任何本體檔案,全部風險集中在外掛層。
 * 依賴 afk-hook.js(必須先載入)。
 * 載入順序:必須排在 afk-offline.js、afk-training.js 之後——這兩支外掛已經各自
 *   monkey-patch 了 window.killMob,排在它們之後才能包到「最外層」,事件觸發時機
 *   才會固定在包裝鏈的最外側,不會因為 PLUGINS 登錄順序意外改變。
 * 事件清單:
 *   - skill:cast:after   { skId, result }
 *   - mob:killed         { idx, mob }            mob 為擊殺前存下的快照(含座標)
 *   - tick:after          { ticks }               只在 state.ticks 真的推進時才發
 *   - render:mobs:requested  (renderMobs 被呼叫,不保證已畫完)
 *   - render:mobs:flushed    (flushTickRender 跑完,tick flush 週期的重繪已完成)
 *   - item:gained         { itemInfo, args }      gainItem 的共用入口(掉落/購買/製作/任務都會經過)
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof window.AFK_HOOK === 'undefined') {
    console.warn('[AFK-hook-bind] 找不到 AFK_HOOK,略過(afk-hook.js 沒有先載入?)');
    return;
  }
  const NS = 'afkHookBind';

  AFK_HOOK.wrap(window, 'castSkill', (orig, args) => {
    const r = orig(...args);
    AFK_HOOK.emit('skill:cast:after', { skId: args[0], result: r });
    return r;
  }, NS);

  AFK_HOOK.wrap(window, 'killMob', (orig, args) => {
    // 先存一份快照(含座標),避免 orig 執行完後怪物 DOM/資料已被清算,定位失準
    const idx = args[0];
    let mobSnapshot = null;
    try {
      if (typeof mapState !== 'undefined' && mapState?.mobs?.[idx]) {
        mobSnapshot = Object.assign({}, mapState.mobs[idx]);
      }
    } catch (e) { /* 讀不到就算了,payload 帶 null */ }
    const r = orig(...args);
    AFK_HOOK.emit('mob:killed', { idx, mob: mobSnapshot });
    return r;
  }, NS);

  AFK_HOOK.wrap(window, 'gameLoop', (orig, args) => {
    const before = (typeof state !== 'undefined') ? state.ticks : undefined;
    const r = orig(...args);
    const after = (typeof state !== 'undefined') ? state.ticks : undefined;
    if (before !== after) AFK_HOOK.emit('tick:after', { ticks: after });
    return r;
  }, NS);

  AFK_HOOK.wrap(window, 'renderMobs', (orig, args) => {
    const r = orig(...args);
    AFK_HOOK.emit('render:mobs:requested', {});
    return r;
  }, NS);

  AFK_HOOK.wrap(window, 'flushTickRender', (orig, args) => {
    const r = orig(...args);
    AFK_HOOK.emit('render:mobs:flushed', {});
    return r;
  }, NS);

  AFK_HOOK.wrap(window, 'gainItem', (orig, args) => {
    const r = orig(...args);
    if (r !== null && r !== undefined) AFK_HOOK.emit('item:gained', { itemInfo: r, args });
    return r;
  }, NS);

  console.log('[AFK-hook-bind] hooks OK');
})();
