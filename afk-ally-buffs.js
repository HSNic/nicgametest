/* ============================================================================
 * afk-ally-buffs.js — 協力傭兵隊伍面板顯示 buff 圖示(需求三)
 *
 * 背景:傭兵卡片(js/10-ui-tabs.js renderSquadPanel)目前只有 #squad-status-<slot>
 *   顯示異常狀態文字(中毒/暈眩等),沒有任何 buff 圖示(喝藥水/精靈餅乾/捲軸效果)。
 *   查證結果:傭兵物件(js/06-status-allies.js buildAlly)身上本來就有 ally.buffs,
 *   結構跟 player.buffs 完全一樣(key=效果id,值=剩餘秒數);玩家原本顯示 buff 圖示的
 *   renderStatusIconBar()(js/08-items-equip.js)所用的圖示對照表 STATUS_ICON_SKILLS
 *   與圖檔(assets/state-icons/*.jpg)都是通用資源,不綁定玩家專屬狀態。
 *   → 全部資料/資源都已存在,純 overlay 讀取顯示即可,不需要新增任何核心欄位。
 *
 * 做法:monkey-patch window.renderSquadPanel(核心函式),原函式跑完後,對每個非倒地
 *   傭兵,在其卡片的 #squad-status-<slot>(異常狀態文字列)正下方、HP 血條正上方,
 *   插入一排 buff 圖示(邏輯照抄 renderStatusIconBar 的判斷順序,只是讀 ally.buffs
 *   而非 player.buffs)。用簽章比對只在種類/順序改變時才重建 DOM,避免每 tick 都重繪
 *   造成圖示閃爍(比照核心自己的作法)。
 *
 * 掛接:在 index.html 的 </body> 前加一行 <script src="afk-ally-buffs.js"></script>
 *   須排在 afk-fixes.js 之後(無特別依賴,純保險與其他 UI 外掛同順序)。
 * ========================================================================== */
(function () {
  'use strict';

  if (typeof window.renderSquadPanel !== 'function' || typeof STATUS_ICON_SKILLS === 'undefined') {
    console.warn('[AFK-ally-buffs] 缺少核心掛點(renderSquadPanel/STATUS_ICON_SKILLS),傭兵buff圖示停用。');
    return;
  }

  var STYLE_ID = 'afk-ally-buffs-style';
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.afk-ally-buffrow{display:flex;flex-wrap:wrap;gap:2px;min-height:16px;}' +
      '.afk-ally-buffrow img{width:15px;height:15px;border-radius:3px;border:1px solid #475569;object-fit:cover;}';
    document.head.appendChild(s);
  }

  // 依 ally.buffs 算出目前生效的 buff 清單:判斷順序/涵蓋項目照抄核心 renderStatusIconBar
  // (js/08-items-equip.js),只是讀傭兵自己的 buffs、不讀 player.buffs。
  function allyBuffRows(ally) {
    var b = ally.buffs || {};
    var rows = [], seen = {};
    function add(name, seconds, label) {
      if (!name || seen[name]) return;
      seen[name] = true;
      rows.push({ name: name, label: label || name, sec: Math.max(0, Math.ceil(Number(seconds) || 0)) });
    }
    if ((b.sk_greater_haste || 0) > 0) add('加速術', b.sk_greater_haste, '強力加速術');
    if (b.haste > 0 || ally._equipHaste) add('加速術', b.haste || 0, '加速');
    if (b.brave > 0) add('勇敢藥水', b.brave, '勇敢藥水');
    if (b.blue > 0) add('藍色藥水', b.blue, '藍色藥水');
    if (b.cautious > 0) add('慎重藥水', b.cautious, '慎重藥水');
    if (b.elfcookie > 0) add('精靈餅乾', b.elfcookie, '精靈餅乾');
    Object.keys(STATUS_ICON_SKILLS).forEach(function (id) {
      if ((b[id] || 0) > 0) add(STATUS_ICON_SKILLS[id], b[id], (typeof DB !== 'undefined' && DB.skills[id]) ? DB.skills[id].n : STATUS_ICON_SKILLS[id]);
    });
    return rows;
  }

  function renderAllyBuffRow(ally) {
    var s = ally._slot;
    var statusEl = document.getElementById('squad-status-' + s);
    if (!statusEl) return;   // 找不到錨點(卡片結構跟預期不同)→安靜跳過,不弄壞面板
    var rowEl = document.getElementById('squad-buffs-' + s);
    if (!rowEl) {
      rowEl = document.createElement('div');
      rowEl.id = 'squad-buffs-' + s;
      rowEl.className = 'afk-ally-buffrow';
      statusEl.insertAdjacentElement('afterend', rowEl);   // 錨定在「異常狀態文字列」之後、HP 血條之前
    }
    var rows = allyBuffRows(ally);
    var sig = rows.map(function (x) { return x.name + '|' + x.label; }).join('||');
    if (rowEl.dataset.sig !== sig) {
      rowEl.dataset.sig = sig;
      rowEl.innerHTML = rows.map(function (x) {
        var title = x.label + (x.sec > 0 ? '｜剩餘 ' + x.sec + ' 秒' : '');
        return '<img src="assets/state-icons/' + encodeURIComponent(x.name) + '.jpg" alt="' + x.label + '" title="' + title + '" onerror="this.style.display=\'none\'">';
      }).join('');
    } else {
      rows.forEach(function (x, i) {
        var img = rowEl.children[i];
        if (img) img.title = x.label + (x.sec > 0 ? '｜剩餘 ' + x.sec + ' 秒' : '');
      });
    }
  }

  function refreshAll() {
    try {
      var allies = (typeof player !== 'undefined' && player && player.allies) ? player.allies.filter(Boolean) : [];
      allies.forEach(function (a) { if (!a._downed) renderAllyBuffRow(a); });
    } catch (e) {}
  }

  var _orig = window.renderSquadPanel;
  var wrapped = function () {
    var ret = _orig.apply(this, arguments);
    try { refreshAll(); } catch (e) {}
    return ret;
  };
  window.renderSquadPanel = wrapped;

  injectStyle();
  console.log('[AFK-ally-buffs] hooks OK — 傭兵隊伍面板已加上 buff 圖示。');
})();
