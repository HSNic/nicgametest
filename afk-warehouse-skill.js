/* ============================================================================
 * afk-warehouse-skill.js — 共用倉庫視覺註記(可學標籤 + 不可使用外框,背包／倉庫兩側都標)
 *                            + 狀態篩選(可用/不可用) + 席琳套裝(遺骸)快速篩選
 *
 * 範圍:
 *   - 只包裝 renderWarehouseNPC(),在原版倉庫視窗畫完後補上視覺標籤/篩選,不改倉庫/背包
 *     資料,不自動取出、學習或裝備任何東西。
 *   - 「倉庫」side(#wh-store-list,data-tip-src="wh")與「背包」side
 *     (#wh-inv-list,data-tip-src="inv")都標,判定邏輯共用。
 *     2026-07-07 使用者實測發現原本只標了倉庫側,背包側漏標,故補上。
 *
 * 判定 1:可學技能書(綠字「(可學)」)
 *   - 物品是技能書(skillbk)、角色尚未學過、職業可學、目前等級足夠、妖精屬性條件符合。
 *
 * 判定 2(2026-07-07 追加):角色不可使用(亮紅色外框)
 *   - 裝備(武器/防具/飾品):跟 js/10-ui-tabs.js 道具分頁同一套判定,呼叫原作者
 *     checkCanEquip(item) 為 false(職業不符)。
 *   - 技能書:跟道具分頁「[無法學習]」同一套判定——角色尚未學過,且職業可學範圍
 *     判定(skillReqLv 回傳 undefined)不通過。已學過的技能書不算「不可使用」。
 *
 * 判定 3(2026-07-08 待辦#5 追加):妖精屬性水晶「屬性不符」紅字
 *   - 背景:妖精專屬技能水晶部分帶 `reqEle`(需特定屬性,如火/水/風/地)或 `reqEleAny`
 *     (任一屬性皆可,但角色需先選定屬性)。`skillReqLv()`(js/01-drops-config.js)只判斷
 *     「職業對不對」(reqE 是否 undefined),不會判斷屬性——所以水晶屬性跟角色不符時,
 *     `cannotUse()` 判定 2 也不會命中(職業對、只是屬性不符),畫面上這種水晶會「沒有可學
 *     綠字、也沒有不可用紅框」,玩家搞不清楚為什麼點了沒反應。
 *   - 解法:新增 `eleMismatch(item)`,專門偵測「職業/等級都符合,唯獨屬性不符」這種情況,
 *     命中時額外標紅字「(屬性不符)」(不套用判定 2 的紅框,紅框留給真正的職業不符/裝備不可用)。
 *
 * 判定 4(2026-07-14 待辦「裝備欄UI與共用倉庫七項問題分析」#5 追加):已學過技能書灰標
 *   - 已學過的技能書(skillbk)整行文字降低透明度,跟未學/可學的區分開來,一眼看出哪些
 *     學過了不用再理會。同時把判定 2 的紅框改成不透明實色 2px(#ef4444),原本 0.65 透明度
 *     的淡紅太不明顯。
 *
 * 判定 5(2026-07-14 待辦#6 追加):「狀態」篩選(全部/可用/不可用)
 *   - 「可裝備」「可學習」「可使用」本質是同一件事——角色現在能不能用這件物品,直接重用
 *     判定 2 的 cannotUse()(可用 = !cannotUse),不重寫一套新邏輯。用一個獨立下拉選單
 *     (跟本體「物品分類」「細分類」平行,不動本體 whSetFilter/whSetSubFilter/_whFilter/
 *     _whSubFilter,純粹渲染完後在外掛層對已經產生的按鈕額外做一次顯示/隱藏),適用武器/
 *     防具/道具三個主分類共用同一顆下拉。
 *
 * 判定 6(2026-07-14 待辦#7 追加):席琳套裝(遺骸)快速篩選
 *   - 席琳遺骸道具(js/00-data.js 的 rem_claw/rem_eye/…八種,共通標記 `remains:true`,
 *     type 皆為 'acc')在本體的主分類其實會被 whCategory() 歸進「防具」而非「道具」
 *     (whCategory:type==='acc'→'armor'),且它們的 slot(rem_claw 等)不在
 *     EQUIP_CATEGORIES/equipCatKey() 認得的圖鑑類型清單裡,所以在防具細分類選單裡選任何
 *     一個具體分類(頭盔/盔甲/…)都篩不到遺骸、只有「全部」才會混在一堆防具裡看到,不好找。
 *   - 解法:不去動本體 whItemSubCat/whSubCatOptions/whMatchFilter/_whFilter/_whSubFilter
 *     (改這些要精確讀寫本體的 let 模組變數,风险較高、且遺骸實際main分類是防具而非道具,
 *     跟原待辦文件假設的「道具子分類」不同),改成外掛層獨立的一顆「只看席琳套裝」勾選框,
 *     渲染完後對已經產生的按鈕額外篩選(在防具主分類下才有意義,其他主分類勾選只會全部
 *     隱藏,不算錯誤,只是沒有遺骸可看)。經典模式(player.classicMode)沒有席琳系統,
 *     此勾選框整個隱藏。
 *
 * 判定 7(2026-07-19 使用者要求追加):「只看遺物」快速篩選
 *   - 跟判定6同一個理由跟同一套做法(不動本體 whSubCatOptions/whMatchFilter/_whFilter/
 *     _whSubFilter,獨立一顆勾選框、渲染完後對已產生的按鈕額外篩選),判斷依據沿用既有的
 *     `DB.items[id].relic` 欄位。只在武器/防具主分類下顯示(遺物只會是武器/防具),不受
 *     經典模式影響(遺物跟席琳系統無關,經典模式一樣打得到遺物)。
 * ========================================================================== */
(function () {
  'use strict';

  var STYLE_ID = 'afk-warehouse-skill-style';
  var NOTE_CLASS = 'afk-wh-skill-note';
  var CANNOT_USE_CLASS = 'afk-wh-cannot-use';
  var LEARNED_CLASS = 'afk-wh-learned';
  var USABLE_SELECT_ID = 'afk-wh-usable-filter';
  var USABLE_ROW_ID = 'afk-wh-usable-row';
  var SHERINE_CHK_ID = 'afk-wh-sherine-filter';
  var RELIC_CHK_ID = 'afk-wh-relic-filter';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.afk-wh-skill-note{display:inline-block;margin-left:6px;color:#22c55e;font-size:12px;font-weight:800;white-space:nowrap;}',
      '.afk-wh-skill-note::before{content:"(";color:#86efac;}',
      '.afk-wh-skill-note::after{content:")";color:#86efac;}',
      '.afk-wh-cannot-use{border:2px solid #ef4444!important;}',   // 2026-07-14 使用者要求:改亮色實框,原本 0.65 透明淡紅太不明顯
      '.afk-wh-skill-note.afk-wh-ele-mismatch{color:#f87171;}',
      '.afk-wh-skill-note.afk-wh-ele-mismatch::before,.afk-wh-skill-note.afk-wh-ele-mismatch::after{color:#fca5a5;}',
      '.afk-wh-learned{opacity:.5;}',   // 2026-07-14 已學過技能書:整行降低透明度
      '.afk-wh-extra-filter{display:flex;align-items:center;gap:6px;font-size:13px;color:#cbd5e1;}',
      '.afk-wh-extra-filter select{background:#0f172a;border:1px solid #475569;color:#fff;border-radius:6px;padding:3px 6px;font-size:13px;}',
      '.afk-wh-extra-filter input[type="checkbox"]{width:15px;height:15px;}'
    ].join('');
    document.head.appendChild(s);
  }

  function getWarehouseItems() {
    if (typeof loadWarehouse !== 'function') return [];
    try {
      var w = loadWarehouse();
      return w && Array.isArray(w.items) ? w.items : [];
    } catch (e) {
      return [];
    }
  }

  function getInvItems() {
    if (typeof player === 'undefined' || !player || !Array.isArray(player.inv)) return [];
    return player.inv;
  }

  function canLearnNow(item) {
    if (!item || !item.id || typeof DB === 'undefined' || !DB.items || !DB.skills) return false;
    if (typeof player === 'undefined' || !player) return false;
    if (typeof skillReqLv !== 'function') return false;

    var d = DB.items[item.id];
    if (!d || d.type !== 'skillbk' || !d.sk) return false;
    var sk = DB.skills[d.sk];
    if (!sk) return false;
    if (Array.isArray(player.skills) && player.skills.includes(d.sk)) return false;

    var reqLv = skillReqLv(sk, d.sk);
    if (reqLv === undefined) return false;
    if ((player.lv || 0) < reqLv) return false;
    if (sk.reqEle && player.elfEle !== sk.reqEle) return false;
    if (sk.reqEleAny && !player.elfEle) return false;
    return true;
  }

  // 職業/等級都符合,唯獨妖精屬性(reqEle/reqEleAny)不符——這種水晶 canLearnNow/cannotUse
  // 都不會命中(職業對,只是屬性不對),另外標紅字「屬性不符」讓玩家知道為什麼學不了。
  function eleMismatch(item) {
    if (!item || !item.id || typeof DB === 'undefined' || !DB.items || !DB.skills) return false;
    if (typeof player === 'undefined' || !player || player.cls !== 'elf') return false;
    if (typeof skillReqLv !== 'function') return false;

    var d = DB.items[item.id];
    if (!d || d.type !== 'skillbk' || !d.sk) return false;
    var sk = DB.skills[d.sk];
    if (!sk || (!sk.reqEle && !sk.reqEleAny)) return false;
    if (Array.isArray(player.skills) && player.skills.includes(d.sk)) return false;

    var reqLv = skillReqLv(sk, d.sk);
    if (reqLv === undefined) return false;              // 職業本身就學不到,交給 cannotUse 的紅框判定
    if ((player.lv || 0) < reqLv) return false;          // 等級不夠是另一回事,不算屬性不符
    if (sk.reqEle && player.elfEle !== sk.reqEle) return true;
    if (sk.reqEleAny && !player.elfEle) return true;
    return false;
  }

  // 已學過的技能書(灰標用):跟 cannotUse() 是互斥的兩種狀態,已學過的一律不算「不可使用」。
  function learnedAlready(item) {
    if (!item || !item.id || typeof DB === 'undefined' || !DB.items) return false;
    if (typeof player === 'undefined' || !player) return false;
    var d = DB.items[item.id];
    if (!d || d.type !== 'skillbk' || !d.sk) return false;
    return Array.isArray(player.skills) && player.skills.includes(d.sk);
  }

  // 角色不可使用:裝備職業不符(checkCanEquip),或技能書不在該職業可學範圍(且尚未學過)。
  // 已學過的技能書、道具/卷軸等一律不算「不可使用」——跟 js/10-ui-tabs.js 道具分頁紅字判定同一套標準。
  function cannotUse(item) {
    if (!item || !item.id || typeof DB === 'undefined' || !DB.items) return false;
    if (typeof player === 'undefined' || !player) return false;
    var d = DB.items[item.id];
    if (!d) return false;

    if (d.type === 'skillbk' && d.sk) {
      if (typeof skillReqLv !== 'function' || !DB.skills) return false;
      if (Array.isArray(player.skills) && player.skills.includes(d.sk)) return false;
      var sk = DB.skills[d.sk];
      if (!sk) return false;
      var reqLv = skillReqLv(sk, d.sk);
      if (reqLv === undefined) return true;                    // 職業本身學不到
      if ((player.lv || 0) < reqLv) return true;                // 🔧 2026-07-14 修正:職業符合但等級不夠,也算「不可用」(原本漏判,導致跟綠字「可學」提示矛盾)
      return false;
    }
    if (d.type === 'wpn' || d.type === 'arm' || d.type === 'acc') {
      if (typeof checkCanEquip !== 'function') return false;
      return !checkCanEquip(item);
    }
    return false;
  }

  // 判定 5:「可用」= 不是 cannotUse(裝備職業不符 / 技能書不可學),直接重用判定 2,
  // 涵蓋「可裝備」「可學習」「可使用」三種原本要分開問的狀態。
  function isUsable(item) { return !cannotUse(item); }

  // renderWarehouseNPC 每次都整段 innerHTML 重建(存入/取出/切分頁都會觸發),外掛插入的
  // 下拉/勾選框跟著被砍掉重生——用這兩個模組層變數保存使用者選擇,重建後照原值還原,
  // 不會每次操作後篩選狀態就跳回「全部」。
  var _usableFilterState = '';
  var _sherineOnlyState = false;
  var _relicOnlyState = false;

  function markItemList(listId, srcAttr, items) {
    var list = document.getElementById(listId);
    if (!list) return;

    var byUid = {};
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].uid) byUid[items[i].uid] = items[i];
    }

    var usableFilter = _usableFilterState;
    var sherineOnly = _sherineOnlyState;
    var relicOnly = _relicOnlyState;

    var buttons = list.querySelectorAll('button[data-tip-src="' + srcAttr + '"][data-tip-uid]');
    for (var b = 0; b < buttons.length; b++) {
      var btn = buttons[b];
      var old = btn.querySelector('.' + NOTE_CLASS);
      if (old) old.remove();
      btn.classList.remove(CANNOT_USE_CLASS, LEARNED_CLASS);
      btn.style.display = '';

      var item = byUid[btn.getAttribute('data-tip-uid')];
      var d = (item && typeof DB !== 'undefined' && DB.items) ? DB.items[item.id] : null;

      if (canLearnNow(item)) {
        var note = document.createElement('span');
        note.className = NOTE_CLASS;
        note.textContent = '可學';
        btn.appendChild(note);
      } else if (eleMismatch(item)) {
        var note2 = document.createElement('span');
        note2.className = NOTE_CLASS + ' afk-wh-ele-mismatch';
        note2.textContent = '屬性不符,無法學習';
        btn.appendChild(note2);
      }
      if (cannotUse(item)) btn.classList.add(CANNOT_USE_CLASS);
      if (learnedAlready(item)) btn.classList.add(LEARNED_CLASS);

      // 判定 5:狀態篩選(全部/可用/不可用)——不適用的子分類(卡片/卷軸/任務/材料)一律當「全部」處理,
      // 不套用篩選(避免下拉被隱藏後,舊的篩選值仍讓整排消失、玩家卻看不到是為什麼)。
      if (usableFilterApplicable()) {
        if (usableFilter === 'usable' && !isUsable(item)) btn.style.display = 'none';
        else if (usableFilter === 'unusable' && isUsable(item)) btn.style.display = 'none';
      }

      // 判定 6:只看席琳套裝(遺骸)
      if (sherineOnly && !(d && d.remains)) btn.style.display = 'none';

      // 判定 7:只看遺物
      if (relicOnly && !(d && d.relic)) btn.style.display = 'none';
    }
  }

  // 在「物品分類／細分類」那一排下拉旁邊,補插「狀態」下拉 + 「只看席琳套裝」勾選框。
  // 兩者都是外掛層獨立狀態(不寫入 _whFilter/_whSubFilter),渲染完後只對已產生的按鈕
  // 做額外的顯示/隱藏,不影響本體的分類邏輯與存取功能本身。
  function ensureExtraFilters() {
    // renderWarehouseNPC 整段 innerHTML 重建時,這個節點會被砍掉重生,要重新插入;但
    // markWarehouseSkillBooks() 也會被「狀態/席琳套裝」下拉自己的 change 監聽器直接呼叫
    // (不經過 renderWarehouseNPC、不動 div.innerHTML)——這種情況下舊的下拉還在 DOM 裡,
    // 若不判斷就直接插入第二份,會疊出兩顆一樣的下拉(踩過:2026-07-14 實測發現重複)。
    // 判準:先看 USABLE_SELECT_ID 是否還在 DOM 上,還在→只同步顯示狀態不重插;
    // 不在(真的被整段重建砍掉了)→才新增。
    var existing = document.getElementById(USABLE_SELECT_ID);
    if (existing) {
      existing.value = _usableFilterState;
      var existingChk = document.getElementById(SHERINE_CHK_ID);
      if (existingChk) existingChk.checked = _sherineOnlyState;
      var existingRelicChk = document.getElementById(RELIC_CHK_ID);
      if (existingRelicChk) existingRelicChk.checked = _relicOnlyState;
      updateSherineVisibility();
      updateRelicVisibility();
      var stateRow = document.getElementById(USABLE_ROW_ID);
      if (stateRow) stateRow.style.display = usableFilterApplicable() ? '' : 'none';
      return;
    }
    // 用「細分類」下拉(呼叫 whSetSubFilter 的那顆)當錨點,插在它後面同一排。
    var subSelect = document.querySelector('select[onchange^="whSetSubFilter"]');
    var row = subSelect ? subSelect.parentElement : null;
    if (!row) return;

    var wrap = document.createElement('span');
    wrap.className = 'afk-wh-extra-filter';
    wrap.innerHTML =
      '<span id="' + USABLE_ROW_ID + '" style="display:flex;align-items:center;gap:4px;">' +
        '<span>狀態：</span>' +
        '<select id="' + USABLE_SELECT_ID + '">' +
          '<option value="">全部</option>' +
          '<option value="usable">可用</option>' +
          '<option value="unusable">不可用</option>' +
        '</select>' +
      '</span>' +
      '<label id="afk-wh-sherine-wrap" style="display:flex;align-items:center;gap:4px;margin-left:8px;">' +
        '<input type="checkbox" id="' + SHERINE_CHK_ID + '"><span>只看席琳套裝</span>' +
      '</label>' +
      '<label id="afk-wh-relic-wrap" style="display:flex;align-items:center;gap:4px;margin-left:8px;">' +
        '<input type="checkbox" id="' + RELIC_CHK_ID + '"><span>只看遺物</span>' +
      '</label>';
    subSelect.insertAdjacentElement('afterend', wrap);

    var usableSel = wrap.querySelector('#' + USABLE_SELECT_ID);
    var sherineChk = wrap.querySelector('#' + SHERINE_CHK_ID);
    var relicChk = wrap.querySelector('#' + RELIC_CHK_ID);
    usableSel.value = _usableFilterState;
    sherineChk.checked = _sherineOnlyState;
    relicChk.checked = _relicOnlyState;
    usableSel.addEventListener('change', function () { _usableFilterState = usableSel.value; markWarehouseSkillBooks(); });
    sherineChk.addEventListener('change', function () { _sherineOnlyState = sherineChk.checked; markWarehouseSkillBooks(); });
    relicChk.addEventListener('change', function () { _relicOnlyState = relicChk.checked; markWarehouseSkillBooks(); });
    updateSherineVisibility();
    updateRelicVisibility();
    var newStateRow = wrap.querySelector('#' + USABLE_ROW_ID);
    if (newStateRow) newStateRow.style.display = usableFilterApplicable() ? 'flex' : 'none';
  }

  // 🔧 2026-07-14 修正:「狀態(可用/不可用)」篩選只對武器/防具/技能書有意義——卡片/卷軸/
  // 任務道具/製作材料本來就不分職業(cannotUse 對這些一律回傳 false,永遠「可用」),選「不可用」
  // 會把整排清空、選「可用」則顯示一堆與篩選無關的雜訊,對玩家來說像壞掉。故這幾個子分類直接
  // 把「狀態」下拉整個藏起來(呼叫 whItemSubCat/_whFilter 讀本體目前選的主/細分類,不改本體邏輯)。
  function usableFilterApplicable() {
    if (typeof _whFilter === 'undefined') return true;
    if (_whFilter === 'weapon' || _whFilter === 'armor') return true;
    if (_whFilter === 'item') return _whSubFilter === 'skill';
    return true;
  }

  // 經典模式沒有席琳系統,「只看席琳套裝」整個隱藏(勾選狀態順便清掉,避免藏起來時殘留勾選)。
  function updateSherineVisibility() {
    var elWrap = document.getElementById('afk-wh-sherine-wrap');
    if (!elWrap) return;
    var classic = !!(typeof player !== 'undefined' && player && player.classicMode);
    elWrap.style.display = classic ? 'none' : '';
    if (classic && _sherineOnlyState) {
      _sherineOnlyState = false;
      var chk = document.getElementById(SHERINE_CHK_ID);
      if (chk) chk.checked = false;
    }
  }

  // 遺物只會是武器/防具,道具主分類下顯示這顆勾選框沒有意義(永遠篩不到東西),直接隱藏。
  // 不受經典模式影響(遺物跟席琳系統無關)。
  function updateRelicVisibility() {
    var elWrap = document.getElementById('afk-wh-relic-wrap');
    if (!elWrap) return;
    var applicable = (typeof _whFilter === 'undefined') || _whFilter === 'weapon' || _whFilter === 'armor';
    elWrap.style.display = applicable ? '' : 'none';
    if (!applicable && _relicOnlyState) {
      _relicOnlyState = false;
      var chk = document.getElementById(RELIC_CHK_ID);
      if (chk) chk.checked = false;
    }
  }

  function markWarehouseSkillBooks() {
    injectStyle();
    ensureExtraFilters();
    markItemList('wh-store-list', 'wh', getWarehouseItems());
    markItemList('wh-inv-list', 'inv', getInvItems());
  }

  // 🔗 2026-07-18 對外曝光「這個uid目前是否被狀態/席琳套裝篩選隱藏」的判斷,供 afk-itemsearch.js
  // 的搜尋過濾在重繪收尾時取交集用——否則搜尋框為空時,afk-itemsearch.js 會把這裡設定的
  // display:none 整個清空,造成「領物品後篩選看起來被重置」的假象(篩選值其實沒變,只是顯示效果
  // 被另一支外掛的重繪收尾蓋掉)。
  window.AFK_WH_SKILL_API = {
    isFilteredOut: function (uid, src) {
      if (!uid) return false;
      var items = src === 'wh' ? getWarehouseItems() : getInvItems();
      var item = null;
      for (var i = 0; i < items.length; i++) { if (items[i] && items[i].uid === uid) { item = items[i]; break; } }
      if (!item) return false;
      var d = (typeof DB !== 'undefined' && DB.items) ? DB.items[item.id] : null;
      if (usableFilterApplicable()) {
        if (_usableFilterState === 'usable' && !isUsable(item)) return true;
        if (_usableFilterState === 'unusable' && isUsable(item)) return true;
      }
      if (_sherineOnlyState && !(d && d.remains)) return true;
      if (_relicOnlyState && !(d && d.relic)) return true;
      return false;
    }
  };

  function install() {
    if (typeof window.renderWarehouseNPC !== 'function') return false;
    if (window.renderWarehouseNPC.__afkWarehouseSkillWrapped) return true;

    var original = window.renderWarehouseNPC;
    window.renderWarehouseNPC = function () {
      var ret = original.apply(this, arguments);
      try { markWarehouseSkillBooks(); } catch (e) {}
      return ret;
    };
    window.renderWarehouseNPC.__afkWarehouseSkillWrapped = true;
    return true;
  }

  if (!install()) {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
})();
