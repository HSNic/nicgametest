/* ============================================================================
 * afk-vfx.js — 階段4:純 DOM/CSS overlay 特效層,吃 afk-hook-bind.js 發出的事件
 *
 * 完全不碰核心 js/09-vfx-render.js 既有的 _vfxQueueDmg/_vfxFlush 飄字系統,
 * 新特效節點各自獨立 append 到 body,不共用核心的 #vfx-layer,避免打架。
 * 依賴 afk-hook.js + afk-hook-bind.js(需先載入,讀 window.AFK_HOOK)。
 * 關掉這支檔案(移除 <script>)遊戲行為完全不受影響 —— 純粹疊加,無任何 monkey-patch。
 *
 * 目前只用到 skill:cast:after、mob:killed 兩個事件:
 * player:hit 原規劃要用,但核心目前把玩家扣血邏輯散落在 js/04-combat-attack.js
 * 好幾個不同呼叫點(沒有單一函式可以乾淨 wrap),要包就得改動好幾處或改本體,
 * 風險超出「純外掛層」範圍 —— 這裡先不做,等真的需要再重新評估怎麼包。
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof window.AFK_HOOK === 'undefined') {
    console.warn('[AFK-vfx] 找不到 AFK_HOOK,略過(afk-hook.js / afk-hook-bind.js 沒有先載入?)');
    return;
  }

  const STYLE_ID = 'afk-vfx-style';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes afkVfxCastPulse {
        0%   { box-shadow: 0 0 0 0 rgba(103,232,249,0.55) inset; }
        50%  { box-shadow: 0 0 18px 4px rgba(103,232,249,0.45) inset; }
        100% { box-shadow: 0 0 0 0 rgba(103,232,249,0); }
      }
      .afk-vfx-cast-pulse { animation: afkVfxCastPulse .5s ease-out; }
      @keyframes afkVfxSpark {
        0%   { transform: translate(-50%,-50%) scale(0.4); opacity: 1; }
        100% { transform: translate(-50%,-50%) scale(1.8); opacity: 0; }
      }
      .afk-vfx-spark {
        position: fixed; left: 0; top: 0; width: 46px; height: 46px;
        border-radius: 50%; pointer-events: none; z-index: 30;
        background: radial-gradient(circle, rgba(253,224,71,0.9) 0%, rgba(253,224,71,0.25) 55%, rgba(253,224,71,0) 75%);
        animation: afkVfxSpark .45s ease-out forwards;
      }
    `;
    document.head.appendChild(style);
  }

  // --- 施法特效:battle-view 邊框輕微脈衝(不改內容,只加一次性 class) ---
  AFK_HOOK.on('skill:cast:after', (payload) => {
    if (!payload || !payload.result) return; // 施法失敗(result 為 falsy)不觸發
    const bv = document.getElementById('battle-view');
    if (!bv) return;
    bv.classList.remove('afk-vfx-cast-pulse');
    void bv.offsetWidth; // 強制 reflow,允許同一角色連續施法都能重新觸發動畫
    bv.classList.add('afk-vfx-cast-pulse');
  });

  // --- 擊殺特效:在怪物最後所在的畫面座標放一個火花爆裂,自動清除 ---
  AFK_HOOK.on('mob:killed', (payload) => {
    const uid = payload && payload.mob && payload.mob.uid;
    let rect = null;
    if (uid != null) {
      const el = document.querySelector(`#mob-list [data-uid="${uid}"]`);
      if (el) rect = el.getBoundingClientRect();
    }
    if (!rect) {
      const ml = document.getElementById('mob-list');
      if (!ml) return;
      rect = ml.getBoundingClientRect();
    }
    const spark = document.createElement('div');
    spark.className = 'afk-vfx-spark';
    spark.style.left = (rect.left + rect.width / 2) + 'px';
    spark.style.top = (rect.top + rect.height / 2) + 'px';
    document.body.appendChild(spark);
    spark.addEventListener('animationend', () => spark.remove());
    setTimeout(() => { if (spark.isConnected) spark.remove(); }, 1000); // 保底清除,避免動畫事件漏接導致殘留
  });

  console.log('[AFK-vfx] hooks OK');
})();
