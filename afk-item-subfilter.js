/*
 * afk-item-subfilter.js — 道具/武器/防具三個分頁加子分類篩選(按鈕組,仿共用倉庫;2026-07-08 曾短暫改成下拉選單,使用者反映不好用,改回按鈕組)
 *
 * 背景:js/10-ui-tabs.js(原作者本體,不可修改)的 renderTabs(force) 只把物品分流到
 *   tab-weapons/tab-armors/tab-items 三個分頁容器,沒有子分類篩選 UI;子分類的分類邏輯
 *   (whItemSubCat 判定道具用途、EQUIP_CATEGORIES 判定裝備圖鑑類型)則已經在
 *   js/12-npc-quests.js 的共用倉庫功能裡齊備,這裡直接重用同一套純函式判斷。
 *
 *   ⚠️ 只重用 whItemSubCat(純函式,不依賴倉庫狀態)。倉庫本身的 whSetFilter/
 *   whMatchFilter 讀寫的是模組變數 _whFilter/_whSubFilter(倉庫視窗自己的篩選狀態),
 *   這裡另外用自己的 _subFilterState 存三個分頁各自的篩選,不共用、不互相影響。
 *
 * 做法:monkey-patch window.renderTabs——原函式有內容簽章快取,大多數呼叫其實不會
 *   重建 DOM(見該函式 `_sig === renderTabs._sig` 提早 return);真的重建時會把
 *   tab-weapons/tab-armors/tab-items 整個 innerHTML 清空重畫,我們附加的篩選列也
 *   會被清掉。所以每次 renderTabs 呼叫完後都檢查篩選列還在不在——還在代表這次沒有
 *   重建、篩選狀態不受影響,直接跳過;不在才重新插入篩選列並重新套用篩選,避免
 *   高頻重繪(戰鬥中掉寶等)白白重算。
 *
 *   DOM 對應物品 id:原函式渲染的 .list-item 沒有帶 data-id,只能用「渲染順序」
 *   跟 player.inv 依相同規則(type 分流)過濾後的順序一一對應(原函式就是這樣把
 *   player.inv 依序 appendChild 進三個分頁的),故不能重新排序 player.inv 或用其他
 *   方式打亂順序,否則對應會錯位。
 *
 * 篩選只是 CSS display:none/'' 顯示或隱藏,不改任何背包資料,也不影響雙擊裝備/
 *   使用、排序選單、快速強化/快速廢品等既有功能(那些都是掛在 .list-item 本身)。
 */
(function () {
  var TAB_CONFIG = [
    { tabId: 'tab-items', cat: 'item', label: '道具' },
    { tabId: 'tab-weapons', cat: 'weapon', label: '武器' },
    { tabId: 'tab-armors', cat: 'armor', label: '防具' },
  ];
  var _subFilterState = { item: '', weapon: '', armor: '' };
  var STYLE_ID = 'afk-item-subfilter-style';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.afk-subfilter-bar{display:flex;flex-wrap:wrap;gap:4px;padding:4px 2px;}' +
      '.afk-subfilter-btn{padding:2px 9px;font-size:12px;border-radius:999px;border:1px solid #475569;background:#1e293b;color:#cbd5e1;cursor:pointer;white-space:nowrap;}' +
      '.afk-subfilter-btn:hover{border-color:#94a3b8;}' +
      '.afk-subfilter-btn.active{background:#92400e;border-color:#f59e0b;color:#fde68a;font-weight:bold;}';
    document.head.appendChild(s);
  }

  // 子分類選項:比照 js/12-npc-quests.js 的 whSubCatOptions(),但不讀 _whFilter,改用參數。
  function subCatOptions(mainCat) {
    if (mainCat === 'item') return [
      { key: 'card', name: '卡片' }, { key: 'skill', name: '技能' }, { key: 'craft', name: '製作' },
      { key: 'quest', name: '任務' }, { key: 'scroll', name: '卷軸' }, { key: 'other', name: '其他' }
    ];
    var grp = (mainCat === 'weapon') ? ['武器'] : ['防具', '飾品'];
    var options = (typeof EQUIP_CATEGORIES !== 'undefined' ? EQUIP_CATEGORIES : [])
      .filter(function (c) { return grp.indexOf(c.group) >= 0; })
      .map(function (c) { return { key: c.key, name: c.name }; });
    if (mainCat === 'armor' && !options.some(function (c) { return c.key === 'tshirt'; })) {
      options.splice(2, 0, { key: 'tshirt', name: '內衣' });
    }
    return options;
  }

  // 子分類比對:比照 js/12-npc-quests.js 的 whMatchFilter() 子分類判斷段落。
  function matchesSub(mainCat, id, subKey) {
    if (!subKey) return true;
    if (mainCat === 'item') return (typeof whItemSubCat === 'function') && whItemSubCat(id) === subKey;
    if (mainCat === 'armor' && subKey === 'tshirt') {
      var d = DB.items[id];
      return !!(d && d.type === 'arm' && d.slot === 'tshirt');
    }
    return (typeof equipCatKey === 'function') ? (equipCatKey(id, DB.items[id]) === subKey) : true;
  }

  // 依 player.inv 目前順序,重現原函式 renderTabs() 分流到武器/防具/道具三分頁的規則。
  function categorizedInv() {
    var buckets = { weapon: [], armor: [], item: [] };
    (player.inv || []).forEach(function (i) {
      var d = DB.items[i.id];
      if (!d) return;
      if (d.type === 'wpn') buckets.weapon.push(i);
      else if (d.type === 'arm' || d.type === 'acc') buckets.armor.push(i);
      else buckets.item.push(i);
    });
    return buckets;
  }

  function buildBar(tabId, cat) {
    var tabDiv = document.getElementById(tabId);
    if (!tabDiv) return;
    injectStyle();
    var options = subCatOptions(cat);
    var bar = document.createElement('div');
    bar.className = 'afk-subfilter-bar';
    var html = '<button type="button" data-sub="" class="afk-subfilter-btn' + (!_subFilterState[cat] ? ' active' : '') + '">全部</button>';
    html += options.map(function (o) {
      return '<button type="button" data-sub="' + o.key + '" class="afk-subfilter-btn' + (_subFilterState[cat] === o.key ? ' active' : '') + '">' + o.name + '</button>';
    }).join('');
    bar.innerHTML = html;
    bar.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-sub]');
      if (!btn) return;
      _subFilterState[cat] = btn.getAttribute('data-sub') || '';
      var buckets = categorizedInv();
      bar.querySelectorAll('.afk-subfilter-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
      applyOne(tabId, cat, buckets[cat]);
    });
    var shell = tabDiv.querySelector('.classic-inventory-shell');
    if (shell) tabDiv.insertBefore(bar, shell); else tabDiv.appendChild(bar);
  }

  function applyOne(tabId, cat, invItems) {
    var tabDiv = document.getElementById(tabId);
    if (!tabDiv) return;
    var viewport = tabDiv.querySelector('.classic-inventory-viewport') || tabDiv;
    var rows = viewport.querySelectorAll(':scope > .list-item');
    var sub = _subFilterState[cat];
    for (var idx = 0; idx < rows.length; idx++) {
      var invItem = invItems[idx];
      var visible = !sub || (invItem && matchesSub(cat, invItem.id, sub));
      // afk-classic-list.js 對 .list-item 下了 display:flex!important,一般的
      // style.display='none'(無 !important)蓋不過去,物品不會真的被隱藏。
      // 用 setProperty 帶 'important' 才贏得過去;顯示時用 removeProperty 交回原本的
      // !important 規則決定顯示方式(不要蓋成沒有 !important 的空字串,一樣蓋不贏)。
      if (visible) rows[idx].style.removeProperty('display');
      else rows[idx].style.setProperty('display', 'none', 'important');
    }
  }

  function applyAll() {
    var buckets = null;
    TAB_CONFIG.forEach(function (cfg) {
      var tabDiv = document.getElementById(cfg.tabId);
      if (!tabDiv) return;
      if (tabDiv.querySelector('.afk-subfilter-bar')) return;   // 篩選列還在→這次沒有重建,篩選狀態不受影響,跳過
      if (!buckets) buckets = categorizedInv();
      buildBar(cfg.tabId, cfg.cat);
      applyOne(cfg.tabId, cfg.cat, buckets[cfg.cat]);
    });
  }

  function install() {
    if (typeof window.renderTabs !== 'function') return false;
    if (window.renderTabs.__afkItemSubfilterWrapped) return true;
    var original = window.renderTabs;
    var wrapped = function () {
      var ret = original.apply(this, arguments);
      // 2026-07-08(效能稽核):原生 renderTabs 對 state.ff(快轉/離線補跑)已經早退零成本,
      // 這層 wrapper 之前沒有比照跳過,離線補跑期間每次呼叫仍會做 3 分頁的 DOM 查詢,
      // 補上快速通道跟其他外掛(afk-toast/afk-autobuy)一致。
      try { if (!(typeof state !== 'undefined' && state && state.ff)) applyAll(); } catch (e) {}
      return ret;
    };
    wrapped.__afkItemSubfilterWrapped = true;
    window.renderTabs = wrapped;
    return true;
  }

  if (install()) {
    console.log('[AFK-item-subfilter] hooks OK — 道具/武器/防具分頁已加上子分類篩選。');
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (install()) console.log('[AFK-item-subfilter] hooks OK — 道具/武器/防具分頁已加上子分類篩選。');
      else console.warn('[AFK-item-subfilter] 找不到 renderTabs,子分類篩選停用。');
    }, { once: true });
  }
})();
