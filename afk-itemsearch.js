/* ============================================================================
 * afk-itemsearch.js — 背包(武器/防具/道具分頁)與倉庫(各分類頁)的「名稱搜尋」
 *
 * 作法:包住 renderTabs / renderWarehouseNPC,每次重繪後把搜尋框「重新注入」清單頂端,
 *   查詢字串存在外掛自己的狀態(不存 DOM)→ 重繪不會弄丟;比對用列的 textContent
 *   (含名稱/詞綴/強化值,子字串命中即顯示),不動遊戲資料、純顯示層過濾。
 * 重繪時機:背包分頁只有內容簽章變了才重建(renderTabs 分區重建),打字本身不觸發重繪;
 *   狩獵中掉寶重建會換掉輸入框 → 重注入時還原字串與焦點(游標移到最後),打字不中斷。
 * 優雅降級:renderTabs / renderWarehouseNPC 不存在就安靜停用。
 * ========================================================================== */
(function () {
  'use strict';

  var q = { wpn: '', arm: '', item: '', wh: '' };   // 各清單的查詢字串(單一事實來源);wh=倉庫背包側+倉庫側共用一份(2026-07-12 使用者要求合併)
  var TAB_KEYS = [
    { key: 'wpn', tabId: 'tab-weapons' },
    { key: 'arm', tabId: 'tab-armors' },
    { key: 'item', tabId: 'tab-items' }
  ];

  function injectCss() {
    if (document.getElementById('afk-isearch-css')) return;
    var st = document.createElement('style');
    st.id = 'afk-isearch-css';
    st.textContent = [
      '.afk-isearch{position:sticky;top:0;z-index:5;padding:2px 0 4px;background:inherit;display:flex;align-items:center;gap:6px;}',
      '.afk-isearch input{flex:1 1 auto;min-width:0;box-sizing:border-box;background:#0f172a;border:1px solid #475569;border-radius:8px;color:#e2e8f0;padding:6px 10px;font-size:13px;font-family:inherit;outline:none;}',
      '.afk-isearch input:focus{border-color:#b89243;}',
      '.afk-isearch input::placeholder{color:#64748b;}',
      // 道具/武器/防具分頁的「整理背包(↕)」鈕(原本 afk-classic-list.js 定位成獨立一排的絕對定位小鈕)
      // 被搬進這裡跟搜尋框同排(見 ensureTabSearch);改回一般排版排一起,下拉選單仍靠 position:relative 錨定。
      '.afk-isearch .classic-sort-wrap{position:relative!important;flex:0 0 auto!important;width:auto!important;height:auto!important;}',
      '.afk-isearch .classic-sort-button{width:26px;height:26px;box-sizing:border-box;}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function norm(s) { return (s || '').toLowerCase(); }

  // 🈶 注音/拼音組字防護(2026-07-11):組字中若剛好撞上遊戲重繪(掛機掉寶等),整個搜尋框 <input>
  // 會被原作 renderTabs/renderWarehouseNPC 整段 innerHTML 換掉 → 瀏覽器的組字緩衝區被強制中斷,
  // 打到一半的注音就跳掉。無法從外部保留「正在被替換的那個 DOM 節點」,唯一辦法是組字期間乾脆
  // 跳過這次重繪(反正這兩支原作函式都有各自的機制,略過一次不會丟資料:renderTabs 靠內容簽章比對、
  // renderWarehouseNPC 是使用者操作觸發、非 tick 驅動),等 compositionend 才補做一次,讓輸入框
  // DOM 節點在整段組字期間全程不被更動。
  var _tabsPendingRebuild = false;
  var _whPendingRebuild = false;
  function anyComposing() {
    var els = document.querySelectorAll('input[id^="afk-isearch-"]');
    for (var i = 0; i < els.length; i++) { if (els[i].dataset.composing === '1') return true; }
    return false;
  }
  function flushPendingRebuilds() {
    if (anyComposing()) return;   // 保險:仍有其他框在組字中就先不補(理論上同時只有一個框在打字)
    if (_tabsPendingRebuild) { _tabsPendingRebuild = false; if (typeof window.renderTabs === 'function') window.renderTabs(); }
    if (_whPendingRebuild) { _whPendingRebuild = false; if (typeof window.renderWarehouseNPC === 'function') { var d = document.getElementById('interaction-content'); if (d) window.renderWarehouseNPC(d); } }
  }

  // 過濾清單列:textContent 含關鍵字才顯示。skipEl=搜尋框自己(不過濾)。
  // 背包三分頁(武器/防具/道具)套用「橫列式外觀」(afk-classic-list.js)後,物品列實際上
  // 包在更深一層的 .classic-inventory-shell > .classic-inventory-viewport 裡,不是 container
  // 的直接子元素——要過濾的話得先找到這層 viewport,改掃它的子元素;倉庫清單(wh-inv-list/
  // wh-store-list)沒有這層包裝,原本「直接子元素」的掃法仍適用,故 viewport 找不到時 fallback
  // 掃 container 自己的直接子元素。
  // 另外 afk-classic-list.js 對 `.classic-inventory-viewport > .list-item` 下了
  // `display:flex!important`,一般的 `style.display='none'`(無 !important)蓋不過去,物品列
  // 不會真的被隱藏,要用 setProperty 帶 'important' 才蓋得過去(比照 afk-item-subfilter.js 的作法)。
  function filterChildren(container, kw, skipEl) {
    if (!container) return;
    kw = norm(kw.trim());
    var scanRoot = container.querySelector(':scope > .classic-inventory-shell > .classic-inventory-viewport') || container;
    for (var i = 0; i < scanRoot.children.length; i++) {
      var el = scanRoot.children[i];
      if (el === skipEl || el.classList.contains('afk-isearch')) continue;
      if (el.dataset.afkKeep === '1') continue;   // 標記不過濾的列(快速操作頭部)
      var visible = !kw || norm(el.textContent).indexOf(kw) >= 0;
      if (visible) el.style.removeProperty('display'); else el.style.setProperty('display', 'none', 'important');
    }
  }

  function makeBox(inputId, key, onChange) {
    var wrap = document.createElement('div');
    wrap.className = 'afk-isearch';
    var inp = document.createElement('input');
    inp.id = inputId; inp.type = 'search'; inp.autocomplete = 'off';
    inp.placeholder = '🔍 搜尋名稱…';
    inp.value = q[key];
    inp.addEventListener('input', function () { q[key] = inp.value; onChange(); });
    inp.addEventListener('compositionstart', function () { inp.dataset.composing = '1'; });
    inp.addEventListener('compositionend', function () { inp.dataset.composing = ''; flushPendingRebuilds(); });
    wrap.appendChild(inp);
    return wrap;
  }

  // 搜尋欄寬度直接抓「物品欄容器」(.classic-inventory-shell)目前的實際寬度對齊,
  // 不憑 CSS 猜測百分比(2026-07-11 使用者確認方向:抓物品欄容器寬度即可)。
  function syncSearchWidth(div, box) {
    var shell = div.querySelector('.classic-inventory-shell');
    if (!shell || !box) return;
    var w = shell.getBoundingClientRect().width;
    if (w > 0) box.style.setProperty('width', w + 'px', 'important');
  }

  // ---- 背包三分頁 -----------------------------------------------------------
  function ensureTabSearch() {
    TAB_KEYS.forEach(function (t) {
      var div = document.getElementById(t.tabId);
      if (!div) return;
      var inputId = 'afk-isearch-' + t.key;
      var box = document.getElementById(inputId) ? document.getElementById(inputId).parentElement : null;
      if (!box) {
        // 重建過了 → 重注入。快速操作頭部(第一個子元素,若存在)標記不過濾,搜尋框插在它後面。
        if (div.firstElementChild && !div.firstElementChild.classList.contains('afk-isearch')) div.firstElementChild.dataset.afkKeep = '1';
        box = makeBox(inputId, t.key, function () { filterChildren(div, q[t.key], box); });
        div.insertBefore(box, div.firstElementChild ? div.firstElementChild.nextSibling : null);
      }
      // 排序切換鈕(↕):原作 decorateClassicInventoryTab 每次重建都在 .classic-inventory-shell 內生一個全新節點,
      // afk-classic-list.js 把它 CSS 定位成獨立一排;搬進搜尋框同一列(box),不佔獨立一排(使用者要求)。
      var sortWrap = div.querySelector('.classic-sort-wrap');
      if (sortWrap && sortWrap.parentElement !== box) {
        box.appendChild(sortWrap);
        var vp = div.querySelector('.classic-inventory-viewport');
        if (vp) vp.style.setProperty('padding-top', '0', 'important');   // 鈕搬走了,原本留給它的頂部空白一併收掉
      }
      syncSearchWidth(div, box);
      filterChildren(div, q[t.key], box);
    });
  }

  // 視窗尺寸改變(旋轉手機/縮放視窗)不會觸發 renderTabs,另外補一個 resize 監聽跟著重新對齊寬度
  var _resizeRaf = null;
  window.addEventListener('resize', function () {
    if (_resizeRaf) return;
    _resizeRaf = requestAnimationFrame(function () {
      _resizeRaf = null;
      try { ensureTabSearch(); } catch (e) {}
    });
  });

  if (typeof window.renderTabs === 'function' && !window.renderTabs.__afkISearch) {
    var _origTabs = window.renderTabs;
    var wrapped = function () {
      // 🈶 組字中整個跳過這次重繪(見 anyComposing/flushPendingRebuilds 註解),避免輸入框 DOM 被換掉打斷注音組字;
      // renderTabs 本身有內容簽章比對,略過的這次不會遺漏——compositionend 觸發 flushPendingRebuilds 補做一次即可跟上。
      if (anyComposing()) { _tabsPendingRebuild = true; return; }
      // 重繪會換掉輸入框:先記住「正在打字的是我們的框嗎」,重注入後還原焦點(游標移到最後)
      var ae = document.activeElement;
      var refocus = (ae && ae.id && ae.id.indexOf('afk-isearch-') === 0) ? ae.id : null;
      var r = _origTabs.apply(this, arguments);
      try {
        ensureTabSearch();
        if (refocus) { var ni = document.getElementById(refocus); if (ni && document.activeElement !== ni) { ni.focus(); try { ni.setSelectionRange(ni.value.length, ni.value.length); } catch (e) {} } }
      } catch (e) {}
      return r;
    };
    wrapped.__afkISearch = true;
    window.renderTabs = wrapped;
  }

  // ---- 倉庫(背包側/倉庫側共用同一個搜尋框,2026-07-12 使用者要求合併,同時過濾兩側) ----
  var WH_INV_ID = 'wh-inv-list', WH_STORE_ID = 'wh-store-list', WH_SEARCH_ID = 'afk-isearch-wh';
  function ensureWhSearch() {
    var invList = document.getElementById(WH_INV_ID);
    var storeList = document.getElementById(WH_STORE_ID);
    if (!invList || !storeList) return;
    var apply = function () { filterChildren(invList, q.wh, null); filterChildren(storeList, q.wh, null); };
    if (!document.getElementById(WH_SEARCH_ID)) {
      // 錨定在「背包側/倉庫側兩欄並排」的格線容器之前(不寫死巢狀層數,用 closest 找格線容器本身)。
      var gridEl = invList.closest('.grid') || (invList.parentElement && invList.parentElement.parentElement);
      if (gridEl && gridEl.parentNode) gridEl.parentNode.insertBefore(makeBox(WH_SEARCH_ID, 'wh', apply), gridEl);
    }
    apply();
  }

  if (typeof window.renderWarehouseNPC === 'function' && !window.renderWarehouseNPC.__afkISearch) {
    var _origWh = window.renderWarehouseNPC;
    var wrappedWh = function () {
      // 🈶 同上,組字中跳過這次重繪;renderWarehouseNPC 一律由使用者操作觸發(非 tick 驅動),
      // 略過的這次在 compositionend 由 flushPendingRebuilds 補做即可,不會遺漏使用者的存/取操作
      // ——因為存/取本身的資料寫入(whDeposit/whWithdraw 等)不受這裡影響,只有畫面重繪被延後。
      if (anyComposing()) { _whPendingRebuild = true; return; }
      var r = _origWh.apply(this, arguments);
      try { ensureWhSearch(); } catch (e) {}
      return r;
    };
    wrappedWh.__afkISearch = true;
    window.renderWarehouseNPC = wrappedWh;
  }

  injectCss();
  if (typeof window.renderTabs === 'function' || typeof window.renderWarehouseNPC === 'function') {
    console.log('[AFK-itemsearch] hooks OK — 背包(武/防/道)與倉庫清單支援名稱搜尋。');
  } else {
    console.warn('[AFK-itemsearch] 找不到 renderTabs / renderWarehouseNPC,名稱搜尋停用。');
  }
})();
