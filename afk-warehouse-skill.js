/* ============================================================================
 * afk-warehouse-skill.js — 共用倉庫視覺註記(可學標籤 + 不可使用外框,背包／倉庫兩側都標)
 *
 * 範圍:
 *   - 只包裝 renderWarehouseNPC(),在原版倉庫視窗畫完後補上視覺標籤,不改倉庫/背包
 *     資料,不自動取出、學習或裝備任何東西。
 *   - 「倉庫」side(#wh-store-list,data-tip-src="wh")與「背包」side
 *     (#wh-inv-list,data-tip-src="inv")都標,判定邏輯共用。
 *     2026-07-07 使用者實測發現原本只標了倉庫側,背包側漏標,故補上。
 *
 * 判定 1:可學技能書(綠字「(可學)」)
 *   - 物品是技能書(skillbk)、角色尚未學過、職業可學、目前等級足夠、妖精屬性條件符合。
 *
 * 判定 2(2026-07-07 追加):角色不可使用(淡紅色外框)
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
 * ========================================================================== */
(function () {
  'use strict';

  var STYLE_ID = 'afk-warehouse-skill-style';
  var NOTE_CLASS = 'afk-wh-skill-note';
  var CANNOT_USE_CLASS = 'afk-wh-cannot-use';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.afk-wh-skill-note{display:inline-block;margin-left:6px;color:#22c55e;font-size:12px;font-weight:800;white-space:nowrap;}',
      '.afk-wh-skill-note::before{content:"(";color:#86efac;}',
      '.afk-wh-skill-note::after{content:")";color:#86efac;}',
      '.afk-wh-cannot-use{border:1px solid rgba(248,113,113,.65)!important;}',
      '.afk-wh-skill-note.afk-wh-ele-mismatch{color:#f87171;}',
      '.afk-wh-skill-note.afk-wh-ele-mismatch::before,.afk-wh-skill-note.afk-wh-ele-mismatch::after{color:#fca5a5;}'
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
      return skillReqLv(sk, d.sk) === undefined;
    }
    if (d.type === 'wpn' || d.type === 'arm' || d.type === 'acc') {
      if (typeof checkCanEquip !== 'function') return false;
      return !checkCanEquip(item);
    }
    return false;
  }

  function markItemList(listId, srcAttr, items) {
    var list = document.getElementById(listId);
    if (!list) return;

    var byUid = {};
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].uid) byUid[items[i].uid] = items[i];
    }

    var buttons = list.querySelectorAll('button[data-tip-src="' + srcAttr + '"][data-tip-uid]');
    for (var b = 0; b < buttons.length; b++) {
      var btn = buttons[b];
      var old = btn.querySelector('.' + NOTE_CLASS);
      if (old) old.remove();
      btn.classList.remove(CANNOT_USE_CLASS);

      var item = byUid[btn.getAttribute('data-tip-uid')];

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
    }
  }

  function markWarehouseSkillBooks() {
    injectStyle();
    markItemList('wh-store-list', 'wh', getWarehouseItems());
    markItemList('wh-inv-list', 'inv', getInvItems());
  }

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
