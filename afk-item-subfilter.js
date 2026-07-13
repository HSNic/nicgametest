/*
 * afk-item-subfilter.js — 道具/武器/防具三個分頁加子分類篩選(下拉選單,插在搜尋框右邊)
 *
 * 2026-07-08 曾短暫改成下拉選單,使用者反映不好用,改回按鈕組;2026-07-13 使用者再次
 *   明確要求改回下拉選單——這次不是單純換皮,而是把原本「獨立一整排、換行佔位」的按鈕組
 *   合併進 afk-itemsearch.js 的搜尋框同一排(放搜尋框右邊),讓出來的那排空間可以多顯示
 *   幾格物品,方向跟上次單純按鈕→下拉不同,故不算重工同一個決定。
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
  var CAT_TO_ISEARCH_KEY = { item: 'item', weapon: 'wpn', armor: 'arm' };   // 對應 afk-itemsearch.js 的 key 命名

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      /* 2026-07-13:改成下拉選單、併進搜尋框同一排(afk-itemsearch.js 的 .afk-isearch),
         不再是獨立一整排,吸頂/寬度都交給 .afk-isearch 既有規則,這裡只放選單本身樣式。 */
      '.afk-subfilter-select{flex:0 0 auto;max-width:104px;padding:5px 4px;font-size:12px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#cbd5e1;font-family:inherit;outline:none;}' +
      '.afk-subfilter-select:focus{border-color:#b89243;}';
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
    // 🆕 2026-07-12 使用者需求:武器/防具分頁加「遺跡」「席琳套裝」——遺物/遺骸/席琳套裝詞綴
    // 橫跨武器與防具(含飾品),兩個分頁都加同樣兩個分類,判斷邏輯見 matchesSub。
    options.push({ key: 'relic', name: '遺跡' });
    options.push({ key: 'sherine_set', name: '席琳套裝' });
    return options;
  }

  // 子分類比對:比照 js/12-npc-quests.js 的 whMatchFilter() 子分類判斷段落。
  // item 改傳完整 inv 物品(而非只有 id):「席琳套裝」要看 item.seteff(裝備實例上的詞綴,
  // 不是 DB.items 定義本身的欄位),只傳 id 判斷不到。
  function matchesSub(mainCat, item, subKey) {
    if (!subKey) return true;
    var id = item.id;
    var d = DB.items[id];
    if (mainCat === 'item') return (typeof whItemSubCat === 'function') && whItemSubCat(id) === subKey;
    if (subKey === 'relic') return !!(d && typeof isRelic === 'function' && isRelic(d));
    // 席琳套裝:遺骸拆分道具本身(d.remains,如「之爪」)+已附帶席琳套裝詞綴的裝備(item.seteff),兩者都算(使用者確認)
    if (subKey === 'sherine_set') return !!(d && d.remains) || !!item.seteff;
    if (mainCat === 'armor' && subKey === 'tshirt') {
      return !!(d && d.type === 'arm' && d.slot === 'tshirt');
    }
    return (typeof equipCatKey === 'function') ? (equipCatKey(id, d) === subKey) : true;
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

  // 下拉選單插進 afk-itemsearch.js 建立的搜尋框那一排(.afk-isearch,id 為 afk-isearch-<key>
  // 的 input 之父層),排在輸入框右邊、整理排序鈕(↕)左邊(使用者要求「放搜尋欄位右邊」)。
  // 找不到搜尋框(afk-itemsearch.js 沒裝上/尚未建立)時 fallback 成插在物品清單容器前面,
  // 不強求一定要合併,優雅降級。
  function buildBar(tabId, cat) {
    var tabDiv = document.getElementById(tabId);
    if (!tabDiv) return;
    injectStyle();
    var options = subCatOptions(cat);
    var sel = document.createElement('select');
    sel.className = 'afk-subfilter-select';
    var optHtml = '<option value="">全部</option>';
    optHtml += options.map(function (o) {
      return '<option value="' + o.key + '">' + o.name + '</option>';
    }).join('');
    sel.innerHTML = optHtml;
    sel.value = _subFilterState[cat] || '';
    sel.addEventListener('change', function () {
      _subFilterState[cat] = sel.value || '';
      applyOne(tabId, cat, categorizedInv()[cat]);
    });

    var isearchInput = document.getElementById('afk-isearch-' + CAT_TO_ISEARCH_KEY[cat]);
    var searchBox = isearchInput ? isearchInput.parentElement : null;
    if (searchBox) {
      // 排在輸入框後面、排序鈕(.classic-sort-wrap,若存在)前面
      var sortWrap = searchBox.querySelector('.classic-sort-wrap');
      searchBox.insertBefore(sel, sortWrap || null);
    } else {
      var shell = tabDiv.querySelector('.classic-inventory-shell');
      if (shell) tabDiv.insertBefore(sel, shell); else tabDiv.appendChild(sel);
    }
  }

  // 2026-07-13(修正搜尋/子分類篩選互相覆寫閃爍):同時檢查 afk-itemsearch.js 的搜尋關鍵字,
  // 兩者取交集——不管哪支外掛的重繪收尾最後執行,算出來的顯示/隱藏都已經是最終正確結果,
  // 不會有一方蓋掉另一方、下一輪又被修回來的兩階段跳動。
  function applyOne(tabId, cat, invItems) {
    var tabDiv = document.getElementById(tabId);
    if (!tabDiv) return;
    var viewport = tabDiv.querySelector('.classic-inventory-viewport') || tabDiv;
    var rows = viewport.querySelectorAll(':scope > .list-item');
    var sub = _subFilterState[cat];
    var isearchKey = CAT_TO_ISEARCH_KEY[cat];
    for (var idx = 0; idx < rows.length; idx++) {
      var invItem = invItems[idx];
      var visible = !sub || (invItem && matchesSub(cat, invItem, sub));
      if (visible && window.AFK_ISEARCH && typeof window.AFK_ISEARCH.match === 'function') {
        visible = window.AFK_ISEARCH.match(isearchKey, rows[idx]);
      }
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
      if (tabDiv.querySelector('.afk-subfilter-select')) return;   // 篩選選單還在→這次沒有重建,篩選狀態不受影響,跳過
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

  // 讓 afk-itemsearch.js 反向查詢目前的子分類篩選狀態,兩者取交集(見 filterChildren/applyOne 註解)。
  window.AFK_SUBFILTER = {
    getState: function (cat) { return _subFilterState[cat] || ''; },
    getBucket: categorizedInv,
    matches: matchesSub
  };

  if (install()) {
    console.log('[AFK-item-subfilter] hooks OK — 道具/武器/防具分頁已加上子分類篩選。');
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (install()) console.log('[AFK-item-subfilter] hooks OK — 道具/武器/防具分頁已加上子分類篩選。');
      else console.warn('[AFK-item-subfilter] 找不到 renderTabs,子分類篩選停用。');
    }, { once: true });
  }
})();
