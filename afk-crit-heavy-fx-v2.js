/* ============================================================================
 * afk-crit-heavy-fx-v2.js — 爆擊／重擊全新特效（取代舊版 afk-crit-fx.js）
 *
 * 背景（2026-07-17，見交接文件 Lineage/加掛版/docs/交接待辦/2026-07-17_爆擊重擊特效套用交接.md）：
 *   使用者提供兩份獨立 demo（critical_effect.html＝爆擊、heavy_hit_damage.html＝重擊），
 *   要求視覺「一模一樣」套進遊戲。demo 本身是「固定置中的展示舞台」，遊戲裡每次命中的
 *   座標是動態的（打到怪物的實際位置），所以套用時把 demo 的固定 50%/29%… 改成以
 *   命中座標為錨點動態定位，其餘動畫/漸層/字體/keyframes 全部原封不動照抄。
 *
 * 做法（純被動疊加，完全不改核心）：
 *   MutationObserver 監看 #vfx-layer（核心飄傷害數字的容器），偵測到核心新插入
 *   class 帶 vfx-critical（真爆擊）或 vfx-heavy（重擊）的節點時：
 *     1. 讀該節點的 style.left/top 當作這組新特效的錨點座標。
 *     2. 隱藏核心自己的文字（避免跟新特效的漸層大字/傷害數字重疊顯示兩份）。
 *     3. 在同一個 #vfx-layer 裡動態建立一組 demo 的效果節點
 *        （flash／beam／critical大字／damage漸層數字／ring／42根spark／18道ray），
 *        套用 demo 原始 CSS（字體、漸層、background-clip:text、keyframes 全部沿用，
 *        只把 left/top 從 demo 的固定百分比改成相對錨點的動態位移）。
 *
 *   z-index：沿用 #vfx-layer 既有配置（35——高於戰鬥內容、低於所有開啟式 UI／彈窗），
 *   不採用 demo「蓋過整個畫面」的做法，故不會蓋到血條/技能欄/彈窗（2026-07-17 使用者確認）。
 *
 *   開關：完全尊重玩家既有的兩個開關——
 *     window.__vfxOff（戰鬥特效）關閉時，這裡整段不觸發，畫面只剩核心原本樸素的文字。
 *     window.__vfxNumOff（傷害數字）關閉時，核心根本不會產生 .vfx-dmg 節點，
 *       MutationObserver 自然也觀察不到，新特效跟著一起消失。
 *   （2026-07-17 使用者明訂：戰鬥特效開啟時每次都完整播放全套動畫，不做節流精簡。）
 *
 * 掛接：在 index.html 的 </body> 前加一行 <script src="afk-crit-heavy-fx-v2.js"></script>
 *   （取代原本的 afk-crit-fx.js 那一行；原檔案已刪除，功能由本檔完整取代）。
 *
 * ⚠️ 給下一次同步原作者本體的人：本檔純疊加、不動任何核心檔案，理論上同步不會動到它；
 *   但如果原作者改了 #vfx-layer 的 z-index、或 _vfxNumber() 的 class 命名（vfx-critical/
 *   vfx-heavy）／el.style.left/top 賦值方式，這支外掛會悄悄失效（MutationObserver 抓不到
 *   節點，或抓到了但座標讀不到）——同步後若玩家回報「爆擊特效不見了」，先檢查這三點。
 * ========================================================================== */
(function () {
  'use strict';

  var STYLE_ID = 'afk-critheavyfx-style';
  var FX_CLASS = 'afkchfx-fx';
  var HIDE_CLASS = 'afkchfx-src-hide';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      // 隱藏核心原本的「爆擊/重擊 + 數字」文字，避免跟新特效的漸層大字/傷害數字疊字
      '.' + HIDE_CLASS + '{opacity:0!important;}' +

      '.' + FX_CLASS + '{position:absolute;left:0;top:0;pointer-events:none;}' +
      '.' + FX_CLASS + ' .afkchfx-flash,' +
      '.' + FX_CLASS + ' .afkchfx-beam,' +
      '.' + FX_CLASS + ' .afkchfx-critical,' +
      '.' + FX_CLASS + ' .afkchfx-damage,' +
      '.' + FX_CLASS + ' .afkchfx-ring,' +
      '.' + FX_CLASS + ' .afkchfx-spark,' +
      '.' + FX_CLASS + ' .afkchfx-ray{position:absolute;pointer-events:none;opacity:0;left:0;top:0;}' +

      '.' + FX_CLASS + ' .afkchfx-flash{width:18px;height:18px;border-radius:50%;background:#fff;' +
        'box-shadow:0 0 12px #fff,0 0 28px #fff7bc,0 0 58px #ffb22e,0 0 110px #ff6a00;mix-blend-mode:screen;' +
        'transform:translate(-50%,-50%) scale(.25);animation:afkchfxFlash .34s ease-out forwards;}' +
      '@keyframes afkchfxFlash{' +
        '0%{opacity:0;transform:translate(-50%,-50%) scale(.25)}' +
        '8%{opacity:1;transform:translate(-50%,-50%) scale(2.4)}' +
        '28%{opacity:.95;transform:translate(-50%,-50%) scale(1.25)}' +
        '100%{opacity:0;transform:translate(-50%,-50%) scale(4.7)}' +
      '}' +

      '.' + FX_CLASS + ' .afkchfx-beam{width:min(34vw,260px);height:3px;' +
        'background:linear-gradient(90deg,transparent,#ff7a00 17%,#fff6b5 49%,#fff 50%,#fff6b5 51%,#ff7a00 83%,transparent);' +
        'box-shadow:0 0 8px #fff7c3,0 0 20px #ff9d18,0 0 42px #ff6400;mix-blend-mode:screen;' +
        'transform:translate(-50%,-50%) scaleX(.05);animation:afkchfxBeam .52s ease-out forwards;}' +
      '@keyframes afkchfxBeam{' +
        '0%{opacity:0;transform:translate(-50%,-50%) scaleX(.05)}' +
        '12%{opacity:1;transform:translate(-50%,-50%) scaleX(1)}' +
        '58%{opacity:.75}' +
        '100%{opacity:0;transform:translate(-50%,-50%) scaleX(1.08)}' +
      '}' +

      '.' + FX_CLASS + ' .afkchfx-critical{white-space:nowrap;line-height:1;color:transparent;' +
        'text-shadow:0 -1px 0 #fff,0 2px 0 #9c3100,0 0 18px #ff8a00;mix-blend-mode:screen;' +
        'transform:translate(-50%,-50%) scale(.55);animation:afkchfxCrit .58s cubic-bezier(.18,.75,.2,1) forwards;}' +
      '.' + FX_CLASS + ' .afkchfx-critical.is-crit{font-family:Georgia,"Times New Roman",serif;font-style:italic;font-weight:700;' +
        'font-size:clamp(18px,3.2vw,32px);letter-spacing:-.04em;' +
        'background:linear-gradient(180deg,#fffce8 0%,#fff2a8 19%,#ffd34e 43%,#ff9c20 69%,#e95300 100%);' +
        '-webkit-background-clip:text;background-clip:text;-webkit-text-stroke:1px rgba(255,239,161,.9);' +
        'filter:drop-shadow(0 0 3px #fff7c3) drop-shadow(0 0 10px #ffb11b) drop-shadow(0 0 25px #ff6500) drop-shadow(0 8px 0 rgba(106,35,0,.7));}' +
      '.' + FX_CLASS + ' .afkchfx-critical.is-heavy{font-family:"Noto Serif TC","PingFang TC","Microsoft JhengHei",serif;font-style:normal;font-weight:700;' +
        'font-size:clamp(18px,3.2vw,32px);letter-spacing:.08em;' +
        'background:linear-gradient(180deg,#fffce8 0%,#fff2a8 19%,#ffd34e 43%,#ff9c20 69%,#e95300 100%);' +
        '-webkit-background-clip:text;background-clip:text;-webkit-text-stroke:1px rgba(255,239,161,.9);' +
        'filter:drop-shadow(0 0 3px #fff7c3) drop-shadow(0 0 10px #ffb11b) drop-shadow(0 0 25px #ff6500) drop-shadow(0 8px 0 rgba(106,35,0,.7));}' +
      '@keyframes afkchfxCrit{' +
        '0%{opacity:0;transform:translate(-50%,-50%) scale(.55) translateY(15px);filter:blur(4px)}' +
        '13%{opacity:1;transform:translate(-50%,-50%) scale(1.24) translateY(0);filter:blur(0)}' +
        '30%{opacity:1;transform:translate(-50%,-50%) scale(.98)}' +
        '55%{opacity:1;transform:translate(-50%,-52%) scale(1)}' +
        '100%{opacity:0;transform:translate(-50%,-63%) scale(1.04);filter:blur(1px)}' +
      '}' +

      '.' + FX_CLASS + ' .afkchfx-damage{font-weight:900;font-size:clamp(12px,2.2vw,20px);color:#fff;' +
        'background:linear-gradient(180deg,#ffffff,#ffe9a6 45%,#ffbf34 70%,#ff6a00);' +
        '-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;' +
        '-webkit-text-stroke:1px rgba(255,255,255,.65);' +
        'filter:drop-shadow(0 0 6px #fff) drop-shadow(0 0 14px #ffb000) drop-shadow(0 0 24px #ff5a00);' +
        'mix-blend-mode:screen;transform:translate(-50%,-50%) scale(.4);animation:afkchfxDamage .7s cubic-bezier(.18,.75,.2,1) forwards;}' +
      '@keyframes afkchfxDamage{' +
        '0%{opacity:0;transform:translate(-50%,-20%) scale(.4)}' +
        '15%{opacity:1;transform:translate(-50%,-50%) scale(1.35)}' +
        '35%{transform:translate(-50%,-54%) scale(1)}' +
        '100%{opacity:0;transform:translate(-50%,-95%) scale(.95)}' +
      '}' +

      '.' + FX_CLASS + ' .afkchfx-ring{width:16px;height:16px;border-radius:50%;border:2px solid #ffd97a;' +
        'box-shadow:0 0 10px #fff,0 0 24px #ff9f1f,0 0 44px #ff5c00 inset;mix-blend-mode:screen;' +
        'transform:translate(-50%,-50%) scale(.2);animation:afkchfxRing .5s ease-out forwards;}' +
      '@keyframes afkchfxRing{' +
        '0%{opacity:0;transform:translate(-50%,-50%) scale(.15)}' +
        '12%{opacity:1}' +
        '100%{opacity:0;transform:translate(-50%,-50%) scale(9)}' +
      '}' +

      '.' + FX_CLASS + ' .afkchfx-spark{width:3px;border-radius:999px;transform-origin:50% 100%;' +
        'background:linear-gradient(#fff,#ffe081 40%,#ff7a00 75%,transparent);box-shadow:0 0 8px #ffd15a;' +
        'mix-blend-mode:screen;animation:afkchfxSpark .48s ease-out forwards;}' +
      '@keyframes afkchfxSpark{' +
        '0%{opacity:0;transform:translate(-50%,-100%) rotate(var(--a)) translateY(0) scaleY(.35)}' +
        '10%{opacity:1}' +
        '100%{opacity:0;transform:translate(-50%,-100%) rotate(var(--a)) translateY(calc(var(--d) * -1)) scaleY(.05)}' +
      '}' +

      '.' + FX_CLASS + ' .afkchfx-ray{width:2px;background:linear-gradient(transparent,#ff9f18 55%,#fff4b0);' +
        'filter:blur(.2px);transform-origin:50% 100%;mix-blend-mode:screen;animation:afkchfxRay .4s ease-out forwards;}' +
      '@keyframes afkchfxRay{' +
        '0%{opacity:0;transform:translate(-50%,-100%) rotate(var(--a)) scaleY(.1)}' +
        '15%{opacity:.85}' +
        '100%{opacity:0;transform:translate(-50%,-100%) rotate(var(--a)) scaleY(1.2)}' +
      '}';
    document.head.appendChild(s);
  }

  // 參考「戰鬥畫面」的實際高度換算各元素與命中點的相對位移(demo 原本是相對整個16:9舞台的
  // 百分比座標，這裡改成相對戰鬥框自身高度，同一比例套到手機/桌機都合理縮放)。
  function refHeight() {
    var bv = document.getElementById('battle-view');
    var h = (bv && bv.clientHeight) || (window.innerHeight * 0.5);
    if (h < 200) h = 200;
    if (h > 720) h = 720;
    return h;
  }

  function spawnEffect(layer, x, y, kind, dmgText) {
    try {
      var refH = refHeight();
      var scale = Math.max(.55, Math.min(1.25, refH / 720));
      var wrap = document.createElement('div');
      wrap.className = FX_CLASS;
      wrap.style.left = x + 'px';
      wrap.style.top = y + 'px';

      function mk(cls, extra) {
        var el = document.createElement('div');
        el.className = cls + (extra ? ' ' + extra : '');
        wrap.appendChild(el);
        return el;
      }

      // flash/ring 與命中點同高；beam/critical/damage 依 demo 原比例往上位移(整體位移量已同步縮小，配合縮小後的字體/特效尺寸)
      mk('afkchfx-flash');
      var beam = mk('afkchfx-beam');
      beam.style.top = (-.12 * refH) + 'px';
      var crit = mk('afkchfx-critical', kind === 'crit' ? 'is-crit' : 'is-heavy');
      crit.style.top = (-.13 * refH) + 'px';
      crit.textContent = kind === 'crit' ? 'CRITICAL' : '重擊';
      var dmg = mk('afkchfx-damage');
      dmg.style.top = (-.06 * refH) + 'px';
      dmg.textContent = dmgText;
      mk('afkchfx-ring');

      var i, el, ang, dist;
      for (i = 0; i < 42; i++) {
        el = mk('afkchfx-spark');
        ang = Math.random() * 360;
        dist = (44 + Math.random() * 100) * scale;
        el.style.setProperty('--a', ang + 'deg');
        el.style.setProperty('--d', dist + 'px');
        el.style.height = ((6 + Math.random() * 14) * scale) + 'px';
        el.style.animationDelay = (Math.random() * 70) + 'ms';
      }
      for (i = 0; i < 18; i++) {
        el = mk('afkchfx-ray');
        el.style.setProperty('--a', (i * 20 + Math.random() * 8) + 'deg');
        el.style.height = ((32 + Math.random() * 80) * scale) + 'px';
        el.style.animationDelay = (Math.random() * 35) + 'ms';
      }

      layer.appendChild(wrap);
      wrap._afkchfxTimer = setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 900);
    } catch (e) {}
  }

  function onNumberNode(layer, node) {
    if (window.__vfxOff) return;   // 戰鬥特效關閉：不追加，畫面維持核心原本樸素文字
    var isCrit = node.classList.contains('vfx-critical');
    var isHeavy = !isCrit && node.classList.contains('vfx-heavy');
    if (!isCrit && !isHeavy) return;
    try {
      var x = parseFloat(node.style.left) || 0;
      var y = parseFloat(node.style.top) || 0;
      var valueEl = node.querySelector('.vfx-dmg-value');
      var dmgText = valueEl ? valueEl.textContent : node.textContent;
      node.classList.add(HIDE_CLASS);   // 隱藏核心原本文字，避免跟新特效重疊顯示
      spawnEffect(layer, x, y, isCrit ? 'crit' : 'heavy', dmgText);
    } catch (e) {}
  }

  function watchLayer(layer) {
    var mo = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType === 1 && node.classList && node.classList.contains('vfx-dmg')) {
            onNumberNode(layer, node);
          }
        }
      }
    });
    mo.observe(layer, { childList: true });
  }

  // #vfx-layer 由核心 _vfxLayer() 首次命中特效時才建立，不是一開始就存在，輪詢等它出現。
  function waitForLayer() {
    var layer = document.getElementById('vfx-layer');
    if (layer) { watchLayer(layer); return; }
    setTimeout(waitForLayer, 500);
  }

  injectStyle();
  waitForLayer();
  console.log('[AFK-crit-heavy-fx-v2] hooks OK — 爆擊／重擊全新特效已啟用。');
})();
