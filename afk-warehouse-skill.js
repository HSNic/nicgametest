/* ============================================================================
 * afk-warehouse-skill.js — 倉庫技能書「可學」註記
 *
 * 範圍:
 *   - 只包裝 renderWarehouseNPC(),在原版倉庫清單畫完後補上視覺標籤。
 *   - 不改倉庫資料、不改背包資料、不自動取出或學習技能。
 *
 * 判定:
 *   - 物品是技能書(skillbk)
 *   - 角色尚未學過
 *   - 職業可學、目前等級足夠
 *   - 妖精屬性條件符合
 * ========================================================================== */
(function () {
  'use strict';

  var STYLE_ID = 'afk-warehouse-skill-style';
  var NOTE_CLASS = 'afk-wh-skill-note';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.afk-wh-skill-note{display:inline-block;margin-left:6px;color:#22c55e;font-size:12px;font-weight:800;white-space:nowrap;}',
      '.afk-wh-skill-note::before{content:"(";color:#86efac;}',
      '.afk-wh-skill-note::after{content:")";color:#86efac;}'
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

  function markWarehouseSkillBooks() {
    injectStyle();

    var list = document.getElementById('wh-store-list');
    if (!list) return;

    var items = getWarehouseItems();
    var byUid = {};
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].uid) byUid[items[i].uid] = items[i];
    }

    var buttons = list.querySelectorAll('button[data-tip-src="wh"][data-tip-uid]');
    for (var b = 0; b < buttons.length; b++) {
      var btn = buttons[b];
      var old = btn.querySelector('.' + NOTE_CLASS);
      if (old) old.remove();

      var item = byUid[btn.getAttribute('data-tip-uid')];
      if (!canLearnNow(item)) continue;

      var note = document.createElement('span');
      note.className = NOTE_CLASS;
      note.textContent = '可學';
      btn.appendChild(note);
    }
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
