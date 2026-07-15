/* ============================================================================
 * afk-powersave.js — 省電模式(真省電版):monkey-patch 動畫/重繪相關全域函式
 *
 * 沿用既有 localStorage 鍵 afk_powersave_on(afk-quickpanel.js 原本自己管這顆開關,
 * 只做得到「暫停裝飾性 CSS 動畫 + 關戰鬥特效/傷害數字」的節流版省電),本檔把真正
 * 的省電邏輯搬出來獨立管理,quickpanel 的「⚙ 設定」面板改成呼叫這裡暴露的
 * window.AFK_POWERSAVE(比照 afk-mobname.js 的 UI/邏輯分離寫法)。
 *
 * 新增兩個「真的」省電手段(2026-07-15,參考協作者在本體做的省電模式,但我們不改
 * 本體,改成從外面 monkey-patch 全域函式):
 *   ① 戰鬥動畫:包住 window._mobAnimApply(js/09)、window._petAnimApply(js/22)、
 *      window._allySpritesApply、window._playerMorphApply(js/09)——開啟時直接不
 *      執行,角色/怪物/寵物/召喚物的動作畫面停在目前那一幀(改回靜態顯示)。
 *      這 4 個都是本體的頂層 function 宣告,在瀏覽器會變成 window 底下的屬性;
 *      本體的 setInterval 是用不加 window. 前綴的方式呼叫它們,而 JS 對這種
 *      未限定識別字是「呼叫當下」才查找目前的綁定,所以外部把 window.X 重新賦值
 *      成包過的版本後,原本的 ticker 下一次執行就會自動叫到新版本——這正是專案
 *      裡 afk-training.js 包 window.doTeleport、afk-autobuy.js 包 window.tick
 *      一直在用的同一招,非新手法。
 *   ② 畫面流暢更新:包住 window.flushTickRender(js/03-combat-core.js)——原本每個
 *      tick(約 100ms)呼叫一次做重繪,開啟後改成間隔滿 500ms 才放行一次;中間被
 *      跳過的呼叫直接不做事(不呼叫原函式),原函式內部的 _uiDirty/_mobsDirty
 *      旗標因此维持 true,等下一次放行時原函式一次補上,畫面不會漏更新,只是變慢。
 *
 * 已知小侷限:本體 _renderMobsImpl 內部有一段「動畫關閉時不嘗試載入登場動畫首幀圖」
 *   的優化,那段寫死在函式內部深處,不是能單獨攔截的呼叫點,我們做不到;影響是省電
 *   模式開啟時,少數怪物重繪瞬間可能偶爾閃一下(圖片 404 空窗),純視覺瑕疵,不影響
 *   戰鬥或收益,可接受。
 *
 * 優雅降級:找不到對應全域函式就跳過該項 wrap,不影響其餘項目與遊戲運作。
 * 掛接:在 index.html 的 </body> 前加一行 <script src="afk-powersave.js"></script>
 *   (需排在 afk-quickpanel.js 之前,quickpanel 的「省電模式」開關要讀這裡暴露的 API)
 * ========================================================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'afk_powersave_on';   // 沿用 afk-quickpanel.js 原本的鍵,不影響玩家既有偏好
  var UI_SLOW_INTERVAL_MS = 500;          // 「畫面流暢更新」關閉時的重繪間隔(原本每 tick≈100ms 一次)
  var ANIM_FNS = ['_mobAnimApply', '_petAnimApply', '_allySpritesApply', '_playerMorphApply'];

  function readOn() { try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; } }
  function saveOn(on) { try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (e) {} }

  // ---- ① 戰鬥動畫:包住動畫 ticker 函式,開啟時直接不執行(維持最後一幀的靜態顯示) ----
  function wrapAnimFns() {
    ANIM_FNS.forEach(function (name) {
      if (typeof window[name] !== 'function' || window[name].__afkPowersave) return;
      var orig = window[name];
      var wrapped = function () {
        if (readOn()) return;   // 省電開啟 → 不推進動畫幀,畫面停在目前狀態
        return orig.apply(this, arguments);
      };
      wrapped.__afkPowersave = true;
      window[name] = wrapped;
    });
  }

  // ---- ② 畫面流暢更新:包住 flushTickRender,節流重繪頻率 ----
  var _lastFlushMs = 0;
  function wrapFlushTickRender() {
    if (typeof window.flushTickRender !== 'function' || window.flushTickRender.__afkPowersave) return false;
    var orig = window.flushTickRender;
    var wrapped = function () {
      if (!readOn()) return orig.apply(this, arguments);
      var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (now - _lastFlushMs < UI_SLOW_INTERVAL_MS) return;   // 跳過:_uiDirty/_mobsDirty 維持 true,下次放行一次補上
      _lastFlushMs = now;
      return orig.apply(this, arguments);
    };
    wrapped.__afkPowersave = true;
    window.flushTickRender = wrapped;
    return true;
  }

  function injectCss() {
    if (document.getElementById('afk-powersave-css')) return;
    var s = document.createElement('style');
    s.id = 'afk-powersave-css';
    // 暫停(不是關掉/歸零)無限循環的裝飾性 CSS keyframe 動畫(呼吸光暈/跑馬燈等);
    // 不動一次性的顯示/隱藏 transition(避免打斷依賴 transitionend 的邏輯)。
    s.textContent = 'body.afk-powersave *{animation-play-state:paused !important;}';
    (document.head || document.documentElement).appendChild(s);
  }

  function applyOn(on) {
    document.body.classList.toggle('afk-powersave', !!on);
    // 一併關閉戰鬥特效與傷害數字,達到最大節流效果(沿用 quickpanel 原本的連動行為)
    if (on) {
      if (!window.__vfxOff && typeof window.toggleVfxPref === 'function') toggleVfxPref();
      if (!window.__vfxNumOff && typeof window.toggleVfxNumPref === 'function') toggleVfxNumPref();
    }
  }

  function setOn(on) {
    saveOn(on);
    applyOn(on);
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function init() {
    injectCss();
    wrapAnimFns();
    var uiSlowOk = wrapFlushTickRender();
    applyOn(readOn());   // 套用已存的偏好(即使遊戲畫面尚未就緒,body class 先掛上去無害)
    window.AFK_POWERSAVE = { isOn: readOn, setOn: setOn };
    console.log('[AFK-powersave] hooks OK — 省電模式(戰鬥動畫' + (ANIM_FNS.every(function (n) { return typeof window[n] === 'function'; }) ? '' : '·部分找不到') + '/畫面流暢更新' + (uiSlowOk ? '' : '·找不到') + ')已就緒。');
  }

  ready(init);
})();
