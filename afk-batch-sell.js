/* ============================================================================
 * afk-batch-sell.js — 物品欄「批次販賣」(2026-07-08 待辦#9;2026-07-08 使用者回饋#2 調整)
 *
 * 需求:道具/武器/防具分頁點單一物品彈窗裡才能「販賣/全部賣出」,勾很多件很麻煩。
 *   三個分頁的快速強化/快速廢品按鈕列都加一顆「批次販賣」入口,開一個獨立清單(核取
 *   方塊,桌機/手機都好按,同 afk-autosell-ui.js 新增例外的多選 UI 風格),勾選多項一次賣出。
 *
 * 設計(重用既有邏輯,不改本體):
 *   - 賣出邏輯重用原作 `getSellPrice(item)` 算單價(不重寫算價公式,作者改公式自動跟上)。
 *   - **不逐項呼叫原作 `sellItem()`**——那樣勾 100 項會整表 `renderTabs()` 重繪 100 次
 *     (畫面閃爍卡頓)、跳 100 則「賣出了...」訊息(洗版)、且賣到歸零會觸發
 *     `openModal`/`closeModal`(批次情境不需要跳窗)。改成自己算完全部再一次性套用:
 *     迴圈只改 `player.gold`/`item.cnt`(歸零的從 `player.inv` 過濾掉),跑完才呼叫一次
 *     `renderTabs(true)`+`updateUI()`,並彙總成一則「共賣出 N 件、獲得 M 金幣」通知。
 *   - 分武器/防具/道具三種範圍(對齊 `renderTabs` 本身「物品分流」的判斷式:d.type==='wpn'
 *     歸武器、'arm'/'acc' 歸防具、其餘歸道具),且沿用 `sellItem()` 本來就有的排除規則:
 *     上鎖(`item.lock`)、不可販售(`DB.items[id].noSell`)一律不會被列進清單。裝備中的
 *     武器/防具(`player.eq`)本來就不在 `player.inv` 裡,不會被誤賣。
 *   - 固定整批賣掉「勾選項目的全部數量」(不做部分數量選擇),跟原作「全部賣出」同粒度,
 *     介面更單純、風險更低。
 *
 * 進入點(2026-07-08 使用者回饋:原本獨立一顆全寬按鈕太佔位置,改成塞進「快速強化/
 *   快速廢品」那排按鈕裡,三個分頁都要有):monkey-patch `renderTabs`——真正渲染完後,
 *   在武器/防具/道具三個分頁各自的表頭(`buildQuickHeader` 產生)裡找「目前是未啟用快速
 *   強化/快速廢品的那排按鈕」(class 精確比對 `flex gap-1`、且不含 `items-center`——啟用
 *   中的兩種狀態列都帶 `items-center`,藉此分辨,只在「兩者都未啟用」時才插入,啟用中
 *   收起自己、不佔位置),補插一顆「🧺 批次販賣」進那排。原作若改版拿掉分頁結構或改了
 *   表頭 class,插入會安靜失敗(找不到就不插),不影響遊戲本身。
 * ========================================================================== */
(function () {
  'use strict';

  var STYLE_ID = 'afk-batch-sell-style';
  var MODAL_ID = 'afk-bsell-modal';
  var ENTRY_CLASS = 'm-batchsell-entry';
  var selected = {};   // uid -> true
  var currentType = 'item';   // 目前開啟中的批次販賣範圍:'wpn' / 'arm' / 'item'

  var TABS = [
    { panelId: 'tab-weapons', type: 'wpn', label: '武器' },
    { panelId: 'tab-armors', type: 'arm', label: '防具' },
    { panelId: 'tab-items', type: 'item', label: '道具' }
  ];

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:12px;}',
      '#' + MODAL_ID + '.hidden{display:none;}',
      '#' + MODAL_ID + ' .afk-bsell-box{background:#0f172a;border:1px solid #334155;border-radius:10px;width:100%;max-width:440px;max-height:86vh;display:flex;flex-direction:column;padding:12px;box-shadow:0 8px 30px rgba(0,0,0,.6);}',
      '#' + MODAL_ID + ' .afk-bsell-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}',
      '#' + MODAL_ID + ' .afk-bsell-title{font-weight:800;color:#fdba74;font-size:16px;}',
      '#' + MODAL_ID + ' .afk-bsell-close{background:#334155;border:1px solid #475569;color:#e2e8f0;border-radius:6px;width:32px;height:32px;font-weight:bold;cursor:pointer;}',
      '#' + MODAL_ID + ' input[type=search]{width:100%;box-sizing:border-box;padding:8px 10px;margin-bottom:8px;border-radius:6px;border:1px solid #475569;background:#020617;color:#e2e8f0;font-size:14px;}',
      '#' + MODAL_ID + ' .afk-bsell-allrow{display:flex;align-items:center;gap:8px;padding:6px 2px;color:#cbd5e1;font-size:13px;font-weight:bold;}',
      '#' + MODAL_ID + ' .afk-bsell-allrow input{width:20px;height:20px;}',
      '#' + MODAL_ID + ' .afk-bsell-list{flex:1;overflow-y:auto;border:1px solid #334155;border-radius:6px;background:#020617;margin-bottom:8px;min-height:120px;}',
      '#' + MODAL_ID + ' .afk-bsell-row{display:flex;align-items:center;gap:8px;padding:9px 10px;min-height:40px;box-sizing:border-box;border-bottom:1px solid #1e293b;cursor:pointer;}',
      '#' + MODAL_ID + ' .afk-bsell-row:last-child{border-bottom:none;}',
      '#' + MODAL_ID + ' .afk-bsell-row:hover,#' + MODAL_ID + ' .afk-bsell-row:active{background:#0f172a;}',
      '#' + MODAL_ID + ' .afk-bsell-row.afk-bsell-hide{display:none;}',
      '#' + MODAL_ID + ' .afk-bsell-row input[type=checkbox]{width:20px;height:20px;flex:0 0 auto;}',
      '#' + MODAL_ID + ' .afk-bsell-icon{width:22px;height:22px;object-fit:contain;flex:0 0 auto;}',
      '#' + MODAL_ID + ' .afk-bsell-name{flex:1;min-width:0;font-size:13px;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#' + MODAL_ID + ' .afk-bsell-meta{flex:0 0 auto;font-size:11px;color:#94a3b8;text-align:right;white-space:nowrap;}',
      '#' + MODAL_ID + ' .afk-bsell-summary{font-size:13px;color:#fde68a;font-weight:bold;margin-bottom:8px;min-height:18px;}',
      '#' + MODAL_ID + ' .afk-bsell-actions{display:flex;gap:8px;}',
      '#' + MODAL_ID + ' .afk-bsell-actions button{flex:1;padding:10px;border-radius:6px;font-weight:bold;font-size:14px;border:1px solid;cursor:pointer;}',
      '#' + MODAL_ID + ' .afk-bsell-cancel{background:#334155;border-color:#475569;color:#e2e8f0;}',
      '#' + MODAL_ID + ' .afk-bsell-confirm{background:#c2410c;border-color:#ea580c;color:#fed7aa;}',
      '#' + MODAL_ID + ' .afk-bsell-confirm:disabled{opacity:.5;cursor:not-allowed;}',
      '.' + ENTRY_CLASS + '{white-space:nowrap;}'
    ].join('');
    document.head.appendChild(s);
  }

  function typeLabel(type) { var t = TABS.filter(function (x) { return x.type === type; })[0]; return t ? t.label : ''; }

  function typeMatches(d, type) {
    if (type === 'wpn') return d.type === 'wpn';
    if (type === 'arm') return d.type === 'arm' || d.type === 'acc';
    return d.type !== 'wpn' && d.type !== 'arm' && d.type !== 'acc';
  }

  function isEligible(item, type) {
    if (!item || (item.cnt || 0) <= 0 || item.lock) return false;
    var d = DB.items[item.id];
    if (!d || d.noSell) return false;
    if (!typeMatches(d, type)) return false;
    if (typeof trialDropBlocked === 'function' && trialDropBlocked(item.id)) return false;   // 本職試煉道具保護,同 sellItem
    return true;
  }

  function getEligibleItems(type) {
    if (typeof player === 'undefined' || !player || !Array.isArray(player.inv)) return [];
    return player.inv.filter(function (item) { return isEligible(item, type); });
  }

  function ensureModal() {
    if (document.getElementById(MODAL_ID)) return;
    injectStyle();
    var modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'hidden';
    modal.innerHTML =
      '<div class="afk-bsell-box">' +
        '<div class="afk-bsell-head"><span class="afk-bsell-title" id="afk-bsell-title">🧺 批次販賣</span><button type="button" class="afk-bsell-close" id="afk-bsell-close">✕</button></div>' +
        '<input type="search" id="afk-bsell-search" placeholder="搜尋物品名稱…">' +
        '<label class="afk-bsell-allrow"><input type="checkbox" id="afk-bsell-selectall"> 全選(<span id="afk-bsell-selcount">0</span>/<span id="afk-bsell-total">0</span>)</label>' +
        '<div class="afk-bsell-list" id="afk-bsell-list"></div>' +
        '<div class="afk-bsell-summary" id="afk-bsell-summary"></div>' +
        '<div class="afk-bsell-actions">' +
          '<button type="button" class="afk-bsell-cancel" id="afk-bsell-cancel">取消</button>' +
          '<button type="button" class="afk-bsell-confirm" id="afk-bsell-confirm">賣出勾選項目</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) { if (e.target === modal) closeModalUI(); });
    document.getElementById('afk-bsell-close').onclick = closeModalUI;
    document.getElementById('afk-bsell-cancel').onclick = closeModalUI;
    document.getElementById('afk-bsell-confirm').onclick = confirmSell;
    document.getElementById('afk-bsell-search').addEventListener('input', function () { filterList(this.value); });
    document.getElementById('afk-bsell-selectall').addEventListener('change', function () {
      var checked = this.checked;
      var rows = document.querySelectorAll('#afk-bsell-list .afk-bsell-row:not(.afk-bsell-hide)');
      for (var i = 0; i < rows.length; i++) {
        var cb = rows[i].querySelector('input[type=checkbox]');
        if (cb.checked !== checked) { cb.checked = checked; toggleSel(rows[i].getAttribute('data-uid'), checked); }
      }
      updateSummary();
    });
  }

  function closeModalUI() {
    var modal = document.getElementById(MODAL_ID);
    if (modal) modal.classList.add('hidden');
    selected = {};
  }

  function filterList(query) {
    var q = (query || '').trim().toLowerCase();
    var rows = document.querySelectorAll('#afk-bsell-list .afk-bsell-row');
    for (var i = 0; i < rows.length; i++) {
      var name = (rows[i].getAttribute('data-name') || '').toLowerCase();
      rows[i].classList.toggle('afk-bsell-hide', q !== '' && name.indexOf(q) === -1);
    }
  }

  function toggleSel(uid, on) { if (on) selected[uid] = true; else delete selected[uid]; }

  function updateSummary() {
    var uids = Object.keys(selected);
    var totalGold = 0;
    uids.forEach(function (uid) {
      var row = document.querySelector('#afk-bsell-list .afk-bsell-row[data-uid="' + uid + '"]');
      if (row) totalGold += Number(row.getAttribute('data-est')) || 0;
    });
    var countEl = document.getElementById('afk-bsell-selcount');
    if (countEl) countEl.textContent = String(uids.length);
    var summaryEl = document.getElementById('afk-bsell-summary');
    if (summaryEl) summaryEl.textContent = uids.length ? ('已勾選 ' + uids.length + ' 項,預估獲得 ' + totalGold.toLocaleString() + ' 金幣。') : '尚未勾選任何物品。';
    var confirmBtn = document.getElementById('afk-bsell-confirm');
    if (confirmBtn) confirmBtn.disabled = uids.length === 0;
    var allBox = document.getElementById('afk-bsell-selectall');
    if (allBox) {
      var visibleRows = document.querySelectorAll('#afk-bsell-list .afk-bsell-row:not(.afk-bsell-hide)');
      var visibleChecked = 0;
      for (var i = 0; i < visibleRows.length; i++) { if (visibleRows[i].querySelector('input[type=checkbox]').checked) visibleChecked++; }
      allBox.checked = visibleRows.length > 0 && visibleChecked === visibleRows.length;
      allBox.indeterminate = visibleChecked > 0 && visibleChecked < visibleRows.length;
    }
  }

  function renderList() {
    selected = {};
    var items = getEligibleItems(currentType);
    var list = document.getElementById('afk-bsell-list');
    list.innerHTML = '';
    document.getElementById('afk-bsell-total').textContent = String(items.length);
    // 2026-07-08(使用者實機回報:武器分頁裝備多時,點「批次販賣」要等好幾秒視窗才跳出來):
    //   原本一次迴圈同步建完全部列,每列都要呼叫 getSellPrice/getItemFullName/getItemColor
    //   (裝備類這些函式比道具貴,要算強化/詞綴/席琳套裝等),物品一多整段同步跑完才讓視窗
    //   顯示,手機上感覺像卡住。改成分批(每批 40 筆)用 requestAnimationFrame 排程建立,第一批
    //   同步跑完就讓視窗立刻可見,其餘批次不擋住主執行緒、逐步補進清單。
    var CHUNK = 40;
    var idx = 0;
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    function buildRow(item) {
      var d = DB.items[item.id];
      var price = getSellPrice(item);
      var est = price * (item.cnt || 0);
      var row = document.createElement('label');
      row.className = 'afk-bsell-row';
      row.setAttribute('data-uid', item.uid);
      row.setAttribute('data-name', d.n || item.id);
      row.setAttribute('data-est', String(est));
      var imgUrl = (typeof getIconUrl === 'function') ? getIconUrl(d) : '';
      var nameHtml = (typeof getItemFullName === 'function') ? getItemFullName(item) : (d.n || item.id);
      var colorClass = (typeof getItemColor === 'function') ? getItemColor(item) : '';
      row.innerHTML =
        '<input type="checkbox">' +
        (imgUrl ? '<img class="afk-bsell-icon" src="' + imgUrl + '" onerror="this.style.visibility=\'hidden\';">' : '') +
        '<span class="afk-bsell-name ' + colorClass + '">' + nameHtml + '</span>' +
        '<span class="afk-bsell-meta">x' + (item.cnt || 0) + '・共 ' + est.toLocaleString() + ' 金</span>';
      row.querySelector('input[type=checkbox]').addEventListener('change', function (e) {
        toggleSel(item.uid, e.target.checked);
        updateSummary();
      });
      return row;
    }
    function renderChunk() {
      var frag = document.createDocumentFragment();
      var end = Math.min(idx + CHUNK, items.length);
      for (; idx < end; idx++) frag.appendChild(buildRow(items[idx]));
      list.appendChild(frag);
      if (idx < items.length) raf(renderChunk);
      else updateSummary();
    }
    if (items.length) renderChunk(); else updateSummary();
  }

  function openModalUI(type) {
    currentType = type || 'item';
    ensureModal();
    document.getElementById('afk-bsell-title').textContent = '🧺 批次販賣（' + typeLabel(currentType) + '）';
    renderList();
    document.getElementById('afk-bsell-search').value = '';
    filterList('');
    document.getElementById(MODAL_ID).classList.remove('hidden');
  }

  function confirmSell() {
    var uids = Object.keys(selected);
    if (!uids.length) return;
    var totalItems = 0, totalGold = 0;
    uids.forEach(function (uid) {
      var item = player.inv.find(function (i) { return i.uid === uid; });
      if (!isEligible(item, currentType)) return;   // 防禦:選取後狀態萬一變了(理論上 modal 開著時不會),跳過不賣
      var price = getSellPrice(item);
      var cnt = item.cnt || 0;
      totalGold += price * cnt;
      totalItems += cnt;
      item.cnt = 0;
    });
    player.inv = player.inv.filter(function (i) { return (i.cnt || 0) > 0; });
    player.gold = (player.gold || 0) + totalGold;
    closeModalUI();
    renderTabs(true);
    updateUI();
    if (totalItems > 0) logSys('批次販賣：共賣出 <span class="font-bold">' + totalItems + '</span> 件物品，獲得 <span class="text-yellow-300 font-bold">' + totalGold.toLocaleString() + '</span> 金幣。');
  }

  // 快速強化/快速廢品「兩者都未啟用」的那排按鈕(buildQuickHeader 的 idle 狀態)特徵是
  // class="flex gap-1"、不含 items-center;啟用中的兩種狀態列都帶 items-center,藉此分辨。
  function findIdleRow(header) {
    var row = header.querySelector(':scope > div.flex.gap-1');
    if (row && !row.classList.contains('items-center')) return row;
    return null;
  }

  function ensureEntryButtonForTab(panelId, type) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    var header = panel.firstElementChild;
    if (!header) return;
    var row = findIdleRow(header);
    if (!row) return;   // 快速強化/快速廢品進行中:不佔位置,自己收起
    // 2026-07-13 使用者要求:「快速強化」「快速廢品」(原作按鈕,不可改原始碼)跟我們自己插入的
    // 「批次販賣」同一排太擠,縮短成「強化」「廢品」增加空間。renderTabs 每次都整段重建這排 DOM
    // (innerHTML=''重來),所以每次呼叫都要重新改一次文字,不能只改一次。
    Array.prototype.forEach.call(row.querySelectorAll('button'), function (b) {
      if (b.textContent === '⚡ 快速強化') b.textContent = '⚡ 強化';
      else if (b.textContent === '🗑️ 快速廢品') b.textContent = '🗑️ 廢品';
    });
    if (row.querySelector('.' + ENTRY_CLASS)) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flex-1 btn border-orange-700 bg-orange-900/70 hover:bg-orange-800 py-1.5 text-sm font-bold text-orange-200 rounded shadow ' + ENTRY_CLASS;
    btn.textContent = '🧺 販賣';   // 2026-07-13 使用者要求:快速強化/快速廢品/批次販賣三顆按鈕都縮短名稱、增加同排空間利用率
    btn.onclick = function () { openModalUI(type); };
    row.appendChild(btn);
  }

  // renderTabs 每次都整表重建三個分頁(wDiv/aDiv/iDiv.innerHTML=''),注入的按鈕會被清掉,渲染完後補插回去。
  function ensureEntryButtons() {
    TABS.forEach(function (t) { ensureEntryButtonForTab(t.panelId, t.type); });
  }

  function install() {
    var orig = window.renderTabs;
    if (typeof orig !== 'function') return false;
    if (orig.__batchSellWrapped) return true;
    var wrapped = function () {
      var ret = orig.apply(this, arguments);
      // 2026-07-08(效能稽核):原生 renderTabs 對 state.ff(快轉/離線補跑)已經早退零成本,
      // 但這層 wrapper 之前沒有比照跳過,離線補跑期間(如玩家掛寵物、每 tick 觸發肉量刷新)
      // 每次呼叫仍會做 3 分頁的 DOM 查詢,補上快速通道跟其他外掛(afk-toast/afk-autobuy)一致。
      try { if (!(typeof state !== 'undefined' && state && state.ff)) ensureEntryButtons(); } catch (e) {}
      return ret;
    };
    wrapped.__batchSellWrapped = true;
    window.renderTabs = wrapped;
    try { ensureEntryButtons(); } catch (e) {}
    console.log('[AFK-batch-sell] hooks OK — 武器/防具/道具批次販賣已啟用。');
    return true;
  }

  try {
    if (!install()) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
      else setTimeout(install, 0);
    }
  } catch (e) { console.warn('[AFK-batch-sell] 安裝失敗,已略過:', e); }
})();
