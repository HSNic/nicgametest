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
 * E6(2026-07-08 使用者追加,同日改版):「新增例外」一次可以選多個物品,批次設定。
 *     **第一版用 `<select multiple>`(Ctrl/⌘/Shift 多選)——使用者反映手機觸控不好用,
 *     原生多選 select 在手機上要長按或跳出笨重選擇器,改成核取方塊(checkbox)清單**,
 *     桌機手機都是直接點擊,不依賴任何鍵盤修飾鍵:
 *     - 原本的 `#as-item`(單選 select)保留但隱藏(`display:none`),當純資料來源——
 *       仍然吃原函式 `refreshAutoSellItemOptions()` 依搜尋/分類/範圍重建的 `<option>`。
 *     - 另建 `#as-item-checklist` 容器,依 `#as-item` 目前的 option 逐筆渲染成
 *       `<label><input type="checkbox">名稱</label>`,勾選狀態存在模組變數
 *       `selectedIds`(Set)——**搜尋字變動只是換一批可見選項,已勾選的 id 不會被清掉**
 *       (讓使用者可以搜一批勾一些、換關鍵字再搜再勾,最後一次送出)。
 *     - 「永遠保留」「永遠販賣」兩顆按鈕改接管成:讀 `selectedIds` 全部 id 一次寫入
 *       `getAutoSellRules().overrides`,不再是原函式 `setAutoSellOverride(v)` 那種一次
 *       只認 `#as-item.value`(單一值)的行為;送出後清空 `selectedIds`。
 *     - 搜尋/分類/範圍篩選狀態自己 capture/restore(邏輯比照 afk-autosell-fix.js,但那支
 *       只包 setAutoSellOverride/deleteAutoSellOverride,本檔繞過那兩個函式直接呼叫
 *       openAutoSellRules,所以要自己做一份,兩邊不會互相干擾)。
 *
 * E7(2026-07-08 使用者回報修正):
 *   - bug:改變「全部分類」「全部物品」下拉會看起來「點了沒反應」——原函式
 *     refreshAutoSellItemOptions() 確實有依新篩選重建 #as-item(隱藏的資料來源)的
 *     <option>,但畫面上看到的是 #as-item-checklist(核取清單),之前只有初次開窗
 *     (enableMultiSelect)會渲染一次,搜尋/分類/範圍改變後沒有同步重繪清單,导致
 *     使用者看到的畫面一直是舊的。修法:抽出 refreshChecklistUI(),
 *     installRefreshWrap 的 wrapper 在 filterAddPicker() 之後也呼叫它,搜尋/分類/
 *     範圍每次改變都會重新渲染 #as-item-checklist。
 *   - 需求:「預覽符合物品/儲存規則」旁邊加一顆「關閉」,不用滾回最上面點右上角
 *     的 Close。
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
      '#as-item-checklist{flex-basis:100%;max-height:200px;overflow-y:auto;border:1px solid #64748b;border-radius:6px;background:#020617;margin-bottom:6px;}' +
      '#as-item-checklist label{display:flex;align-items:center;gap:8px;padding:9px 10px;min-height:36px;box-sizing:border-box;border-bottom:1px solid #1e293b;cursor:pointer;}' +
      '#as-item-checklist label:last-child{border-bottom:none;}' +
      '#as-item-checklist label:active,#as-item-checklist label:hover{background:#0f172a;}' +
      '#as-item-checklist input[type=checkbox]{width:20px;height:20px;flex:0 0 auto;}' +
      '.afk-multi-count{font-size:12px;color:#94a3b8;flex-basis:100%;margin-bottom:4px;}';
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

  // E6:核取方塊清單(桌機/手機都直接點擊,不依賴 Ctrl/⌘/Shift 等鍵盤修飾鍵)
  var selectedIds = {};   // Set 語意用物件模擬(id -> true),避免舊瀏覽器 Set 相容疑慮

  function selectedCount() { return Object.keys(selectedIds).length; }

  function renderChecklist(select, listBox, countEl) {
    listBox.innerHTML = '';
    var opts = Array.prototype.slice.call(select.options).filter(function (o) { return o.value; });
    if (!opts.length) {
      var empty = document.createElement('div');
      empty.className = 'as-muted';
      empty.style.padding = '9px 10px';
      empty.textContent = select.options.length ? select.options[0].textContent : '沒有符合的物品';
      listBox.appendChild(empty);
    } else {
      opts.forEach(function (opt) {
        var label = document.createElement('label');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = opt.value;
        cb.checked = !!selectedIds[opt.value];
        cb.addEventListener('change', function () {
          if (cb.checked) selectedIds[opt.value] = true; else delete selectedIds[opt.value];
          countEl.textContent = '已選 ' + selectedCount() + ' 個';
        });
        var span = document.createElement('span');
        span.textContent = opt.textContent;
        label.appendChild(cb);
        label.appendChild(span);
        listBox.appendChild(label);
      });
    }
    countEl.textContent = '已選 ' + selectedCount() + ' 個';
  }

  // 重新渲染核取清單(供初次建立與搜尋/分類/範圍變動後共用同一份邏輯)
  function refreshChecklistUI() {
    var select = document.getElementById('as-item');
    var listBox = document.getElementById('as-item-checklist');
    var countEl = document.getElementById('as-multi-count');
    if (select && listBox && countEl) renderChecklist(select, listBox, countEl);
  }

  function enableMultiSelect(box) {
    var select = document.getElementById('as-item');
    if (!select) return;
    select.style.display = 'none';   // 保留當資料來源(仍吃 refreshAutoSellItemOptions 的重建),畫面上不顯示

    var countEl = document.getElementById('as-multi-count');
    var listBox = document.getElementById('as-item-checklist');
    if (!listBox) {
      countEl = document.createElement('div');
      countEl.id = 'as-multi-count';
      countEl.className = 'afk-multi-count';
      listBox = document.createElement('div');
      listBox.id = 'as-item-checklist';
      select.parentNode.insertBefore(countEl, select);
      select.parentNode.insertBefore(listBox, select);
    }
    renderChecklist(select, listBox, countEl);

    var keepBtn = box.querySelector('.as-keep-btn');
    var sellBtn = box.querySelector('.as-sell-btn');
    [[keepBtn, 'keep'], [sellBtn, 'sell']].forEach(function (pair) {
      var btn = pair[0], v = pair[1];
      if (!btn || btn.__afkMultiBound) return;
      btn.__afkMultiBound = true;
      btn.removeAttribute('onclick');
      btn.addEventListener('click', function () {
        var ids = Object.keys(selectedIds);
        if (!ids.length) return;
        var state = captureAddPickerState();
        if (typeof _readAutoSellForm === 'function') _readAutoSellForm();
        var rules = getAutoSellRules();
        ids.forEach(function (id) { rules.overrides[id] = v; });
        selectedIds = {};
        if (typeof openAutoSellRules === 'function') openAutoSellRules();
        setTimeout(function () { restoreAddPickerState(state); }, 0);
      });
    });
  }

  // E7(2026-07-08 使用者追加):底部「預覽符合物品/儲存規則」旁邊加一顆「關閉」,
  //   不用再滾回最上面點右上角的 Close。
  function addBottomCloseButton(box) {
    var actions = box.querySelector('.as-actions');
    if (!actions || actions.querySelector('.afk-close-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'afk-close-btn';
    btn.textContent = '關閉';
    btn.addEventListener('click', function () {
      if (typeof closeAutoSellRules === 'function') closeAutoSellRules();
    });
    actions.appendChild(btn);
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
    addBottomCloseButton(box);
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
      try { filterAddPicker(); refreshChecklistUI(); } catch (e) { console.warn('[AFK-autosell-ui] 過濾新增例外選單失敗', e); }
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
