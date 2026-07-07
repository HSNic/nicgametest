/* ============================================================================
 * afk-autosell-ui.js — 自動販賣規則視窗 UI 優化(monkey-patch openAutoSellRules,桌機/手機共用)
 *
 * 背景:js/10-ui-tabs.js(原作者本體,不可修改)的 openAutoSellRules() 每次呼叫都是
 *   「整個 modal 節點移除→重新建立全新節點」(存/取消/新增例外都會重呼叫它,見
 *   afk-autosell-fix.js 的說明),所以本檔用 monkey-patch 包住 openAutoSellRules 本身,
 *   原函式跑完、DOM 建好之後,每次都重新套用以下優化:
 *
 * E1. 各別例外清單(#as-overrides)加 max-height + 捲動,並加搜尋框依名稱過濾。
 * E3. 「裝備條件」「材料與一般物品」「各別例外」三個 .as-sec 區塊改成 <details>
 *     可收合結構,預設全部收合;使用者展開/收合的狀態會記住,重繪(存/取消例外)不會
 *     把使用者剛展開的區塊又收回去。
 * E4. 文字修正:「個別例外」→「各別例外」(標題與空清單提示都要改)。
 * E5(2026-07-08 使用者追加):「新增例外」下拉選單(#as-item)排除已經在各別例外
 *     清單中的物品——monkey-patch window.refreshAutoSellItemOptions(原函式依搜尋/
 *     分類/範圍重建這個下拉選單),原函式跑完後把 value 已存在 getAutoSellRules().overrides
 *     的 <option> 移掉;openAutoSellRules() 第一次開窗時 #as-item 是直接內嵌在模板字串裡
 *     (不經過 refreshAutoSellItemOptions),所以 enhance() 也會呼叫同一個過濾函式。
 * E6(2026-07-08 使用者追加):#as-item 改成 multiple(可 Ctrl/⌘/Shift 一次選多個),
 *     「永遠保留」「永遠販賣」兩顆按鈕改接管成:讀取全部勾選的 option 一次寫入
 *     getAutoSellRules().overrides,不再是原函式 setAutoSellOverride(v) 那種一次只認
 *     #as-item.value(單一值)的行為——多選時 .value 只會回傳第一個選取項,原函式無法
 *     批次處理,所以這裡直接接管按鈕的 click(移除原本 inline onclick,改
 *     addEventListener),自己重現「_readAutoSellForm() → 寫入 overrides → openAutoSellRules()」
 *     這段流程,搜尋/分類/範圍篩選狀態也自己 capture/restore(邏輯比照 afk-autosell-fix.js,
 *     但那支只包 setAutoSellOverride/deleteAutoSellOverride,本檔繞過那兩個函式直接呼叫
 *     openAutoSellRules,所以要自己做一份,兩邊不會互相干擾)。
 *
 * (E2 按鈕順序:「立即賣出廢品」在原作本體裡本來就已經排在「依目前方式整理」左邊,
 *  不需要調整,這裡不處理。)
 *
 * 掛接:在 index.html 的 </body> 前加一行 <script src="afk-autosell-ui.js"></script>
 * (要排在 afk-autosell-fix.js 之後或之前都可以,兩者互不干涉——afk-autosell-fix.js
 *  包 setAutoSellOverride/deleteAutoSellOverride 回填搜尋/捲動狀態,本檔包
 *  openAutoSellRules 本身處理版面,分屬不同函式、不同 DOM 範圍)
 * ========================================================================== */
(function () {
  'use strict';

  var STYLE_ID = 'afk-autosell-ui-style';
  var openState = {};      // 記住使用者展開過的區塊(key=標題文字,value=是否展開)
  var overrideQuery = '';  // 記住「各別例外」清單的搜尋字,重繪(存/取消例外)不清空

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '#autosell-rule-modal details.as-sec{padding:0;}' +
      '#autosell-rule-modal details.as-sec>summary{padding:12px;cursor:pointer;list-style:none;}' +
      '#autosell-rule-modal details.as-sec>summary::-webkit-details-marker{display:none;}' +
      '#autosell-rule-modal details.as-sec>summary::before{content:"▸ ";display:inline-block;transition:transform .15s;}' +
      '#autosell-rule-modal details.as-sec[open]>summary::before{transform:rotate(90deg);}' +
      '#autosell-rule-modal details.as-sec>*:not(summary){padding-left:12px;padding-right:12px;}' +
      '#autosell-rule-modal details.as-sec>*:last-child{padding-bottom:12px;}' +
      '#as-overrides{max-height:220px;overflow-y:auto;}' +
      '#as-ov-search{width:100%;box-sizing:border-box;margin-bottom:6px;}' +
      '#as-item[multiple]{height:160px;width:min(100%,390px);flex-basis:100%;}' +
      '#as-item[multiple] option{padding:3px 6px;}' +
      '.afk-multi-hint{font-size:12px;color:#94a3b8;margin:2px 0 6px;flex-basis:100%;}';
    document.head.appendChild(s);
  }

  // E4:文字修正
  function fixWording(box) {
    box.querySelectorAll('.as-title, summary.as-title').forEach(function (el) {
      if (el.textContent.indexOf('個別例外') >= 0) el.textContent = el.textContent.replace('個別例外', '各別例外');
    });
    var muted = box.querySelector('#as-overrides .as-muted');
    if (muted && muted.textContent.indexOf('個別例外') >= 0) muted.textContent = muted.textContent.replace('個別例外', '各別例外');
  }

  // E3:三個 .as-sec(裝備條件/材料與一般物品/各別例外)改 <details>;第一個 .as-sec(啟用開關/延遲秒數)沒有 .as-title,不動、維持展開。
  function collapseSections(box) {
    var secs = box.querySelectorAll(':scope > .as-sec');
    secs.forEach(function (sec) {
      var children = Array.prototype.slice.call(sec.children);
      var titleEl = children.filter(function (c) { return c.classList && c.classList.contains('as-title'); })[0];
      if (!titleEl) return;
      var label = titleEl.textContent;
      var det = document.createElement('details');
      det.className = sec.className;
      det.open = !!openState[label];
      var summary = document.createElement('summary');
      summary.className = 'as-title';
      summary.textContent = label;
      det.appendChild(summary);
      children.forEach(function (c) { if (c !== titleEl) det.appendChild(c); });
      det.addEventListener('toggle', function () { openState[label] = det.open; });
      sec.replaceWith(det);
    });
  }

  // E1:各別例外清單加搜尋框(過濾 #as-overrides 內的 .as-ex 列;#as-overrides 本身的捲動由 injectStyle 的 CSS 處理)
  function addOverrideSearch(box) {
    var overridesBox = box.querySelector('#as-overrides');
    if (!overridesBox || document.getElementById('as-ov-search')) return;
    var wrap = document.createElement('div');
    wrap.className = 'as-ex-tools';
    wrap.innerHTML = '<input id="as-ov-search" type="search" placeholder="搜尋各別例外">';
    overridesBox.parentNode.insertBefore(wrap, overridesBox);
    var input = wrap.querySelector('input');
    input.value = overrideQuery;
    input.addEventListener('input', function () {
      overrideQuery = input.value;
      filterOverrides(overridesBox, overrideQuery);
    });
    filterOverrides(overridesBox, overrideQuery);
  }

  function filterOverrides(overridesBox, query) {
    var q = (query || '').trim().toLowerCase();
    var rows = overridesBox.querySelectorAll(':scope > .as-ex');
    rows.forEach(function (row) {
      var nameEl = row.querySelector('span');
      var name = (nameEl ? nameEl.textContent : '').toLowerCase();
      row.style.display = (!q || name.indexOf(q) >= 0) ? '' : 'none';
    });
  }

  // E5:「新增例外」下拉選單排除已經在各別例外清單中的物品
  function filterAddPicker() {
    var select = document.getElementById('as-item');
    if (!select) return;
    var overrides = (typeof getAutoSellRules === 'function') ? (getAutoSellRules().overrides || {}) : {};
    Array.prototype.slice.call(select.options).forEach(function (opt) {
      if (opt.value && overrides.hasOwnProperty(opt.value)) opt.remove();
    });
    if (!select.options.length) {
      var placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '沒有符合的物品(已在各別例外清單中)';
      select.appendChild(placeholder);
    }
  }

  // E6:新增例外的搜尋/分類/範圍狀態(比照 afk-autosell-fix.js 的 captureState/restoreState,
  //   但這裡繞過 setAutoSellOverride,呼叫端要自己 capture/restore)
  function captureAddPickerState() {
    var searchEl = document.getElementById('as-item-search');
    var typeEl = document.getElementById('as-item-type');
    var scopeEl = document.getElementById('as-item-scope');
    var box = document.querySelector('#autosell-rule-modal .as-box');
    return {
      search: searchEl ? searchEl.value : '',
      type: typeEl ? typeEl.value : 'all',
      scope: scopeEl ? scopeEl.value : 'all',
      scrollTop: box ? box.scrollTop : 0,
    };
  }
  function restoreAddPickerState(state) {
    if (!state) return;
    var searchEl = document.getElementById('as-item-search');
    var typeEl = document.getElementById('as-item-type');
    var scopeEl = document.getElementById('as-item-scope');
    if (searchEl) searchEl.value = state.search;
    if (typeEl) typeEl.value = state.type;
    if (scopeEl) scopeEl.value = state.scope;
    if (typeof refreshAutoSellItemOptions === 'function') refreshAutoSellItemOptions();
    var box = document.querySelector('#autosell-rule-modal .as-box');
    if (box) box.scrollTop = state.scrollTop;
  }

  // E6:#as-item 改 multiple,接管「永遠保留」「永遠販賣」按鈕一次寫入全部勾選的物品
  function enableMultiSelect(box) {
    var select = document.getElementById('as-item');
    if (!select) return;
    select.multiple = true;
    select.removeAttribute('size');
    if (!select.nextElementSibling || !select.nextElementSibling.classList || !select.nextElementSibling.classList.contains('afk-multi-hint')) {
      var hint = document.createElement('div');
      hint.className = 'afk-multi-hint';
      hint.textContent = '可按住 Ctrl(Mac 為 ⌘)或 Shift 一次選取多個物品,再點下方按鈕一次設定。';
      select.parentNode.insertBefore(hint, select.nextSibling);
    }
    var keepBtn = box.querySelector('.as-keep-btn');
    var sellBtn = box.querySelector('.as-sell-btn');
    [[keepBtn, 'keep'], [sellBtn, 'sell']].forEach(function (pair) {
      var btn = pair[0], v = pair[1];
      if (!btn) return;
      btn.removeAttribute('onclick');
      btn.addEventListener('click', function () {
        var ids = Array.prototype.slice.call(select.selectedOptions).map(function (o) { return o.value; }).filter(Boolean);
        if (!ids.length) return;
        var state = captureAddPickerState();
        if (typeof _readAutoSellForm === 'function') _readAutoSellForm();
        var rules = getAutoSellRules();
        ids.forEach(function (id) { rules.overrides[id] = v; });
        if (typeof openAutoSellRules === 'function') openAutoSellRules();
        setTimeout(function () { restoreAddPickerState(state); }, 0);
      });
    });
  }

  function enhance() {
    var box = document.querySelector('#autosell-rule-modal .as-box');
    if (!box) return;
    injectStyle();
    fixWording(box);
    collapseSections(box);
    addOverrideSearch(box);
    filterAddPicker();
    enableMultiSelect(box);
  }

  function install() {
    if (typeof window.openAutoSellRules !== 'function' || window.openAutoSellRules.__afkAutosellUiWrapped) return false;
    var orig = window.openAutoSellRules;
    var wrapped = function () {
      var ret = orig.apply(this, arguments);
      try { enhance(); } catch (e) { console.warn('[AFK-autosell-ui] 套用視窗優化失敗', e); }
      return ret;
    };
    wrapped.__afkAutosellUiWrapped = true;
    window.openAutoSellRules = wrapped;
    return true;
  }

  function installRefreshWrap() {
    if (typeof window.refreshAutoSellItemOptions !== 'function' || window.refreshAutoSellItemOptions.__afkAutosellUiWrapped) return false;
    var orig = window.refreshAutoSellItemOptions;
    var wrapped = function () {
      var ret = orig.apply(this, arguments);
      try { filterAddPicker(); } catch (e) { console.warn('[AFK-autosell-ui] 過濾新增例外選單失敗', e); }
      return ret;
    };
    wrapped.__afkAutosellUiWrapped = true;
    window.refreshAutoSellItemOptions = wrapped;
    return true;
  }

  function installAll() {
    var a = install();
    var b = installRefreshWrap();
    return a && b;
  }

  if (installAll()) {
    console.log('[AFK-autosell-ui] hooks OK — 自動販賣規則視窗:各別例外加捲動+搜尋、三區塊可收合、文字修正、新增例外排除已設定物品。');
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (installAll()) console.log('[AFK-autosell-ui] hooks OK — 自動販賣規則視窗:各別例外加捲動+搜尋、三區塊可收合、文字修正、新增例外排除已設定物品。');
      else console.warn('[AFK-autosell-ui] 找不到 openAutoSellRules/refreshAutoSellItemOptions,自動販賣視窗優化停用。');
    }, { once: true });
  }
})();
