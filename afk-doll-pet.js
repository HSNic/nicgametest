/* ============================================================================
 * afk-doll-pet.js — 魔法娃娃「飄浮寵物」(方案B:冒險地圖左下角飄浮,出發狩獵才出現)
 *
 * 待辦規格:Lineage/待辦-ClaudeCode/2026-07-08_魔法娃娃飄浮寵物(方案B固定角落飄浮).md
 * 使用者確認(2026-07-08):①取代原本滑鼠游標特效(不共存,滑鼠恢復預設游標) ②固定左下角(偏右)
 *   ③圖片 64px ④2026-07-08 再次確認:改錨定「冒險地圖」戰鬥框(`#battle-view`)左下角(偏右),
 *   不是整個瀏覽器視窗角落;且只在「出發狩獵中」(`#battle-view` 未帶 `.hidden`)才顯示,
 *   回村莊/安全區(`#battle-view` 帶 `.hidden`)時隱藏。
 * 使用者實機測試回饋(2026-07-08 晚):⑤位置太靠右會擋到怪物站位,改更貼近左邊 ⑥飄浮晃動幅度
 *   加大、更明顯 ⑦娃娃外層加一圈顏色光暈(比照原本滑鼠游標熱點光點的配色邏輯,依娃娃名稱顏色)。
 * 使用者實機測試回饋(2026-07-08 更晚,真機 iOS):⑧手機版圖片稍微縮小一點 ⑨飄浮動畫在真機上
 *   完全不會動(CSS `@keyframes` 疑似跟 `#battle-view img{filter:contrast(1.06) saturate(1.05)}`
 *   的動態 filter 疊加在 WebKit 上有相容性問題,桌機模擬測試看得到動、真機看不到)——改成用
 *   `requestAnimationFrame` 手動算 transform 逐幀套用,不依賴 CSS animation,比照本專案戰鬥特效
 *   (`js/09-vfx-render.js`)本來就是這種 rAF 手動算位置的做法,更可靠。
 *
 * 做法:
 *   1. 完全接管 window.applyDollCursor(不呼叫原函式)——裝備 player.eq.doll 時不再換游標圖/
 *      建光點熱點,改成準備飄浮寵物的圖片來源;是否「顯示」還要另外看是否在狩獵中。
 *   2. 寵物 DOM 掛在 `#battle-view` 底下(絕對定位),跟隨戰鬥框本身的版面(桌機/手機共用同一個
 *      錨點,不需要另外判斷裝置;錨點選擇理由見下方 ⚠️ 說明)。
 *   3. 「是否在狩獵中」沒有現成的全域旗標可讀,原作者是在好幾處(js/05-kill-progression.js、
 *      js/11-world-map.js)直接切換 `#battle-view` 的 `hidden` class 達成村莊↔戰鬥切換,不便逐一
 *      monkey-patch。改用 MutationObserver 觀察 `#battle-view` 的 class 變化(比照專案 CLAUDE.md
 *      「量測手機 UI 用 MutationObserver、不用 rAF 輪詢」同一精神),class 一變就重新判斷是否顯示。
 *   `pointer-events:none` 避免擋到畫面按鈕/怪物點擊。
 *
 * ⚠️ 錨點是 `#battle-view` 本身(戰鬥怪物圖那一框),不是 `#map-view-panel` 整張卡:手機版
 *   afk-mobile.js 會在 `#battle-view` 正下方插「手動喝水列」,若錨在 `#map-view-panel`(涵蓋
 *   喝水列在內)的底部,寵物會蓋到喝水列文字上(2026-07-08 手機實測踩過)。`#battle-view` 原生
 *   CSS 已有 `position:relative`(給 `#status-icon-bar` 錨定用,見 css/style.css),故寵物只要
 *   跟著掛在它底下用絕對定位即可,桌機/手機共用同一個錨點、不用另外判斷裝置。
 * ========================================================================== */
(function () {
  'use strict';

  var petEl = null;
  var equippedDoll = null; // { src } 或 null;由 applyDollCursor 更新,由 refreshVisibility 決定要不要顯示

  function ensurePetEl() {
    if (petEl || typeof document === 'undefined') return petEl;
    var bv = document.getElementById('battle-view');
    if (!bv) return null;
    petEl = document.createElement('img');
    petEl.id = 'doll-pet-float';
    petEl.alt = '';
    bv.appendChild(petEl);
    return petEl;
  }

  function ensureStyle() {
    if (document.getElementById('doll-pet-float-style')) return;
    var css = [
      // #battle-view 原生已是 position:relative(見 css/style.css #status-icon-bar 錨定註解),
      // 這裡補一份是防禦性寫法(原作者若改動該規則,寵物定位不會被連帶破壞),無害的重複宣告。
      '#battle-view{position:relative;}',
      // 🪆 貼近左邊(2026-07-08 實機回饋:原本 left:56px 偏太右會擋到怪物站位),用 CSS 變數
      // --doll-pet-glow 套顏色光暈(JS 依娃娃名稱顏色設定,預設透明色不出現)。飄浮位移改由
      // JS(rAF)逐幀寫入 inline transform,這裡的 transform:translate(0,0) 只是初始值。
      // ⚠️ filter 要用 `!important`:css/style.css 有 `#battle-view img{filter:contrast(1.06) saturate(1.05)}`
      // (specificity 1 個 id+1 個元素,比我們單純 `#doll-pet-float`高),不加 important 會被整個蓋掉、
      // 光暈完全不出現(2026-07-08 實機測試踩過)。
      '#doll-pet-float{position:absolute;left:8px;bottom:12px;width:64px;height:auto;pointer-events:none;z-index:5;opacity:0;transform:translate(0,0);transition:opacity .25s ease;--doll-pet-glow:rgba(255,255,255,0);filter:drop-shadow(0 0 10px var(--doll-pet-glow)) drop-shadow(0 0 4px var(--doll-pet-glow)) drop-shadow(0 4px 6px rgba(0,0,0,.4)) !important;}',
      '#doll-pet-float.active{opacity:1;}',
      // 手機版圖片稍微縮小(2026-07-08 實機回饋:64px 在手機小螢幕感覺偏大)。
      'body.m-mobile #doll-pet-float{width:48px;}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'doll-pet-float-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // 🎞️ 飄浮動畫改用 requestAnimationFrame 手動算 transform,不依賴 CSS animation
  //   (2026-07-08 實機回饋:CSS @keyframes 在真機 iOS 上完全不會動,疑似跟同一元素上
  //   動態 filter 疊加有 WebKit 相容性問題;桌機模擬測試看得到動、無法重現真機情形)。
  //   比照 js/09-vfx-render.js 既有戰鬥特效的做法,手動逐幀寫 inline transform 更可靠。
  var bobRafId = null;
  function startBob() {
    if (bobRafId || !petEl) return;
    var start = performance.now();
    var step = function (now) {
      if (!petEl || !petEl.classList.contains('active')) { bobRafId = null; return; }
      // 省電模式:固定顯示在原本擺動中心點,不晃動;但仍排程下一輪,關閉省電模式後能立即接續動畫(2026-07-21)
      if (window.AFK_POWERSAVE && window.AFK_POWERSAVE.isOn()) {
        petEl.style.transform = 'translate(0,-17px)';
        bobRafId = requestAnimationFrame(step);
        return;
      }
      var t = (now - start) / 1000;
      var x = Math.sin(t * 1.7) * 12;
      var y = -17 - Math.sin(t * 2.3 + 1) * 17; // 約在 0 ~ -34px 之間飄動
      petEl.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      bobRafId = requestAnimationFrame(step);
    };
    bobRafId = requestAnimationFrame(step);
  }
  function stopBob() {
    if (bobRafId) { cancelAnimationFrame(bobRafId); bobRafId = null; }
    if (petEl) petEl.style.transform = 'translate(0,0)';
  }

  function inBattleNow() {
    var bv = document.getElementById('battle-view');
    return !!(bv && !bv.classList.contains('hidden'));
  }

  // 🪆 依「目前裝備的娃娃」更新要顯示的圖片來源+光暈顏色(卸下則清空);不在此處決定要不要顯示,
  //   顯示與否交給 refreshVisibility()(還要看是否在狩獵中)。
  function updateEquippedDoll() {
    // 🔧 DB/player 在原作者程式碼裡是 top-level const/let(非 window 屬性,見專案 CLAUDE.md),
    //   跟其他外掛(如 applyDollCursor 原函式)一樣直接用裸識別字取用,不能寫成 window.DB/window.player。
    var e = (typeof player !== 'undefined') && player.eq && player.eq.doll;
    var ed = e ? DB.items[e.id] : null;
    if (ed) {
      var img = ed.dollImg || ed.n;
      // 🎨 光暈顏色重用原作滑鼠游標熱點光點(_dollGlow)同一套配色邏輯——`_dollNameColor` 是
      //   js/02-stats-recompute.js 裡的全域函式(function 宣告,掛在 window 上),把娃娃名稱的
      //   Tailwind 文字色 class(ed.c)換算成實際 rgb,不重造一套顏色對照表。
      var color = (typeof window._dollNameColor === 'function') ? window._dollNameColor(ed.c) : 'rgb(226,232,240)';
      equippedDoll = { src: 'assets/doll/' + img + '.png', glow: color };
    } else {
      equippedDoll = null;
    }
    refreshVisibility();
  }

  function refreshVisibility() {
    if (typeof document === 'undefined') return;
    ensureStyle();
    var pet = ensurePetEl();
    if (!pet) return;
    if (equippedDoll && inBattleNow()) {
      if (pet.dataset.src !== equippedDoll.src) { pet.src = equippedDoll.src; pet.dataset.src = equippedDoll.src; }
      pet.style.setProperty('--doll-pet-glow', equippedDoll.glow);
      pet.classList.add('active');
      startBob();
    } else {
      pet.classList.remove('active');
      stopBob();
    }
  }

  function ensureBattleViewObserver() {
    var bv = document.getElementById('battle-view');
    if (!bv || bv.__afkDollPetObserved) return;
    bv.__afkDollPetObserved = true;
    new MutationObserver(refreshVisibility).observe(bv, { attributes: true, attributeFilter: ['class'] });
  }

  if (typeof window.applyDollCursor !== 'function') {
    console.warn('[AFK-doll-pet] 找不到全域 applyDollCursor,魔法娃娃飄浮寵物未套用。');
    return;
  }
  if (window.applyDollCursor.__afkDollPetWrapped) return;
  var wrapped = function () {
    // 取代原本的滑鼠游標換圖/光點熱點邏輯,故不呼叫原函式;滑鼠維持系統預設游標。
    ensureBattleViewObserver();
    updateEquippedDoll();
  };
  wrapped.__afkDollPetWrapped = true;
  window.applyDollCursor = wrapped;

  /* --------------------------------------------------------------------------
   * 「顯示寵物 / 顯示招喚獸」開關(2026-07-13 待辦#5,供 afk-quickpanel.js 省電模式串接;
   * 2026-07-14 待辦「裝備欄UI與共用倉庫七項問題分析#2」修正方向)
   *
   * 只控制「戰場地圖上會實際走動的寵物/召喚獸圖像」(js/22-pets.js #pet-layer,寵物與
   * 召喚物v2共用同一個圖層渲染)——**不隱藏隊伍面板的寵物/召喚物卡片**(使用者 2026-07-14
   * 明訂:卡片不可隱藏,只隱藏戰場走動圖像)。2026-07-13 原本的版本把隊伍卡片
   * (renderPetTeamHTML/renderSummonTeamHTML)也包了 wrapper class 一起藏,方向錯了,
   * 已拿掉那段,只留下面 wrapPetSpriteEl() 這條專門管戰場 sprite 的。
   * ⚠️ 只隱藏視覺(display:none),寵物/召喚物本身仍正常參戰、正常計算傷害/回血/加成
   * (petsOutList()/summonRenderList() 完全不動,戰鬥數值不受影響);_petWanderStep 等
   * 位置計算 JS 運算仍會照跑,這裡沒有做到「省運算」的效能優化,只解決「方向錯誤」本身。
   * 找不到對應原作函式(改版/改名)就整組略過,不影響其餘功能。
   * ------------------------------------------------------------------------ */
  (function () {
    var PET_KEY = 'afk_pet_visible', SUMMON_KEY = 'afk_summon_visible';

    function readPref(key) { try { return localStorage.getItem(key) !== '0'; } catch (e) { return true; } }
    function writePref(key, on) { try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) {} }

    function applyBodyClass() {
      document.body.classList.toggle('afk-hide-pet', !readPref(PET_KEY));
      document.body.classList.toggle('afk-hide-summon', !readPref(SUMMON_KEY));
      refreshVisibility();   // 飄浮娃娃寵物也要跟著「顯示寵物」開關走
    }

    function injectVisCss() {
      if (document.getElementById('afk-pet-summon-vis-style')) return;
      var s = document.createElement('style');
      s.id = 'afk-pet-summon-vis-style';
      // 只隱藏戰場 sprite(靠 wrapPetSpriteEl() 補上的 data-kind 分辨寵物/召喚獸),
      // 隊伍面板卡片不受這裡影響(2026-07-14 使用者明訂卡片不可隱藏)。
      s.textContent =
          'body.afk-hide-pet #pet-layer [data-pet][data-kind="pet"]{display:none !important;}'
        + 'body.afk-hide-summon #pet-layer [data-pet][data-kind="summon"]{display:none !important;}';
      document.head.appendChild(s);
    }

    // 幫戰場 sprite 元素補上 data-kind,讓上面的 CSS 能分別隱藏寵物/召喚獸(不動 petsOutList()/
    // summonRenderList() 本身,兩者仍被戰鬥邏輯共用,只在「畫面上要不要生成/更新這個 sprite 的
    // DOM 元素」這一層動手,不影響傷害/回血/加成計算)。
    function wrapPetSpriteEl() {
      var orig = window._petSpriteEl;
      if (typeof orig !== 'function' || orig.__afkVisWrapped) return false;
      var wrapped = function (layer, p) {
        var el = orig.apply(this, arguments);
        if (el && p) {
          var kind = (typeof PET_BOOK !== 'undefined' && PET_BOOK && PET_BOOK[p.form]) ? 'pet' : 'summon';
          if (el.getAttribute('data-kind') !== kind) el.setAttribute('data-kind', kind);
        }
        return el;
      };
      wrapped.__afkVisWrapped = true;
      window._petSpriteEl = wrapped;
      return true;
    }

    function install() {
      injectVisCss();
      wrapPetSpriteEl();
      applyBodyClass();
    }
    try {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
      else install();
    } catch (e) { console.warn('[AFK-doll-pet] 顯示寵物/召喚獸開關安裝失敗,已略過:', e); }

    window.isPetVisible = function () { return readPref(PET_KEY); };
    window.showPet = function () { writePref(PET_KEY, true); applyBodyClass(); };
    window.hidePet = function () { writePref(PET_KEY, false); applyBodyClass(); };
    window.isSummonVisible = function () { return readPref(SUMMON_KEY); };
    window.showSummon = function () { writePref(SUMMON_KEY, true); applyBodyClass(); };
    window.hideSummon = function () { writePref(SUMMON_KEY, false); applyBodyClass(); };
  })();

  console.log('[AFK-doll-pet] hooks OK');
})();
