/* ============================================================================
 * afk-crit-fx.js — 爆擊特效仿天堂W(需求六)
 *
 * 背景:核心爆擊視覺目前只有「數字變大變紅」(js/09-vfx-render.js 的 _vfxNumber,
 *   class="vfx-dmg vfx-crit"),沒有天堂W那種更誇張的爆擊回饋(閃光/震動/衝擊感)。
 *
 * 做法:純被動監看,完全不 monkey-patch 任何核心函式、不碰 js/03-combat-core.js
 *   或 js/09-vfx-render.js 本體——只用 MutationObserver 盯著 #vfx-layer(核心飄傷害
 *   數字的容器),偵測到「真正的爆擊」數字節點插入時(用該節點 inline style.color 是
 *   爆擊紅 rgb(255,59,48) 來判斷——同一個 class="vfx-crit" 重擊(heavy)也會套用,顏色
 *   才是唯二能分辨「是不是真的爆擊」的依據,見 _vfxNumber 的著色邏輯),疊加三種額外
 *   回饋:
 *   (a) 該位置疊一個擴散衝擊環(比核心飄字本身更誇張的爆擊視覺)。
 *   (b) 全螢幕短暫紅色閃光遮罩(節流:同時間爆擊很多下也不會連續閃到眼花)。
 *   (c) 戰場畫面(#battle-view)輕微震動(重用核心已有的 .vfx-shake class,跟怪物施法
 *       震動 vfxCastShake 走同一套動畫語言,不是自創)。
 *
 *   尊重玩家現有的「戰鬥特效」開關(window.__vfxOff):開關關掉時,這裡也不會加碼。
 *
 * 掛接:在 index.html 的 </body> 前加一行 <script src="afk-crit-fx.js"></script>
 * ========================================================================== */
(function () {
  'use strict';

  var STYLE_ID = 'afk-critfx-style';
  var CRIT_COLOR = 'rgb(255, 59, 48)';   // js/09-vfx-render.js _vfxNumber:big==='crit' 時 el.style.color='#ff3b30',讀回是這個 rgb 字串
  var FLASH_MIN_GAP_MS = 220;            // 全螢幕閃光/震動節流:連續爆擊時不要每下都閃到眼花(衝擊環仍每下都放,只是不搶眼)

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.afk-critfx-flash{position:fixed;inset:0;z-index:9998;pointer-events:none;background:radial-gradient(ellipse at center, rgba(255,59,48,.26) 0%, rgba(255,59,48,0) 68%);animation:afkCritFlash .32s ease-out forwards;}' +
      '@keyframes afkCritFlash{0%{opacity:0}25%{opacity:1}100%{opacity:0}}' +
      '.afk-critfx-burst{position:absolute;border-radius:50%;pointer-events:none;border:3px solid #ff3b30;box-shadow:0 0 14px #ff3b30,0 0 26px rgba(255,59,48,.6);transform:translate(-50%,-50%) scale(.2);animation:afkCritBurst .5s cubic-bezier(.15,.7,.3,1) forwards;}' +
      '@keyframes afkCritBurst{0%{opacity:.95;transform:translate(-50%,-50%) scale(.2)}100%{opacity:0;transform:translate(-50%,-50%) scale(2.4)}}';
    document.head.appendChild(s);
  }

  function screenFlash() {
    var el = document.createElement('div');
    el.className = 'afk-critfx-flash';
    document.body.appendChild(el);
    el.addEventListener('animationend', function () { el.remove(); }, { once: true });
    setTimeout(function () { if (el.parentNode) el.remove(); }, 600);
  }

  function burstAt(layer, x, y) {
    var ring = document.createElement('div');
    ring.className = 'afk-critfx-burst';
    ring.style.left = x + 'px'; ring.style.top = y + 'px';
    ring.style.width = '70px'; ring.style.height = '70px';
    layer.appendChild(ring);
    ring.addEventListener('animationend', function () { ring.remove(); }, { once: true });
    setTimeout(function () { if (ring.parentNode) ring.remove(); }, 700);
  }

  function screenShake() {
    var bv = document.getElementById('battle-view');
    if (!bv) return;
    bv.classList.remove('vfx-shake');
    void bv.offsetWidth;   // 強制重排,讓移除/加回 class 能重新觸發動畫(比照核心 vfxCastShake 的寫法)
    bv.classList.add('vfx-shake');
    bv.addEventListener('animationend', function () { bv.classList.remove('vfx-shake'); }, { once: true });
  }

  var _lastFlashTs = 0;
  function onCritNumber(layer, el) {
    if (window.__vfxOff) return;   // 玩家關掉「戰鬥特效」開關時,追加特效也一併停用
    try {
      var x = parseFloat(el.style.left) || 0;
      var y = parseFloat(el.style.top) || 0;
      burstAt(layer, x, y);
      var now = Date.now();
      if (now - _lastFlashTs > FLASH_MIN_GAP_MS) {
        _lastFlashTs = now;
        screenFlash();
        screenShake();
      }
    } catch (e) {}
  }

  function watchLayer(layer) {
    var mo = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType === 1 && node.classList && node.classList.contains('vfx-crit') && node.style.color === CRIT_COLOR) {
            onCritNumber(layer, node);
          }
        }
      }
    });
    mo.observe(layer, { childList: true });
  }

  // #vfx-layer 由核心 _vfxLayer() 首次命中特效時才建立(見 js/09-vfx-render.js),不是一開始就存在,
  // 輪詢等它出現一次即可(遊戲全程只建立一次、之後重用同一個節點)。
  function waitForLayer() {
    var layer = document.getElementById('vfx-layer');
    if (layer) { watchLayer(layer); return; }
    setTimeout(waitForLayer, 500);
  }

  injectStyle();
  waitForLayer();
  console.log('[AFK-crit-fx] hooks OK — 爆擊追加衝擊環/閃光/震動特效已啟用。');
})();
