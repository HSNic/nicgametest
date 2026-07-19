/* ============================================================================
 * afk-hook.js — 外掛事件匯流排(階段1,純工具物件,不掛接任何本體函式)
 *
 * 用途:提供 window.AFK_HOOK 給其他外掛訂閱/觸發事件、或用 namespace 防重的方式
 *   monkey-patch 既有函式,取代目前各外掛各自手寫包裝的做法。
 *   本檔只放工具本身,實際包裝既有函式的邏輯在 afk-hook-bind.js。
 * 依賴:無(必須排在其他 afk-*.js 之前,因為其他外掛會用到 AFK_HOOK)。
 * ========================================================================== */
(function () {
  'use strict';

  window.AFK_HOOK = window.AFK_HOOK || {
    _handlers: {},

    on(name, fn) {
      (this._handlers[name] = this._handlers[name] || []).push(fn);
    },

    emit(name, payload) {
      (this._handlers[name] || []).forEach((fn) => {
        try { fn(payload); } catch (e) { console.error('[AFK_HOOK]', name, e); }
      });
    },

    // 依 namespace 防重包裝 obj[methodName]。同一個 ns 對同一個函式只會包一次,
    // 不同 ns(不同外掛)各自包各自的一層,允許多層 wrapper 鏈共存。
    wrap(obj, methodName, wrapper, ns = 'afkHook') {
      if (typeof obj?.[methodName] !== 'function') {
        console.warn('[AFK_HOOK] wrap 略過,找不到函式:', methodName);
        return;
      }
      const orig = obj[methodName];
      orig.__afkHookWraps = orig.__afkHookWraps || {};
      if (orig.__afkHookWraps[ns]) {
        console.warn('[AFK_HOOK] wrap 略過,namespace 已包裝過:', methodName, ns);
        return;
      }
      const wrapped = function (...args) {
        try {
          return wrapper(orig.bind(this), args, this);
        } catch (e) {
          // 外掛包裝失敗時退回原始函式,避免拖垮遊戲主流程
          console.error('[AFK_HOOK] wrap 執行失敗,退回原函式:', methodName, e);
          return orig.apply(this, args);
        }
      };
      wrapped.__afkHookWraps = Object.assign({}, orig.__afkHookWraps, { [ns]: true });
      obj[methodName] = wrapped;
    },
  };

  console.log('[AFK-hook] hooks OK');
})();
