/* ============================================================================
 * afk-batch-sell.js — 物品欄「批次販賣」(2026-07-08 待辦#9)
 *
 * 需求:物品欄(道具分頁 #tab-items)點單一物品彈窗裡才能「販賣/全部賣出」,勾很多件很麻煩。
 *   新增一顆「批次販賣」入口,開一個獨立清單(核取方塊,桌機/手機都好按,同
 *   afk-autosell-ui.js 新增例外的多選 UI 風格),勾選多項一次賣出。
 *
 * 設計(重用既有邏輯,不改本體):
 *   - 賣出邏輯重用原作 `getSellPrice(item)` 算單價(不重寫算價公式,作者改公式自動跟上)。
 *   - **不逐項呼叫原作 `sellItem()`**——那樣勾 100 項會整表 `renderTabs()` 重繪 100 次
 *     (畫面閃爍卡頓)、跳 100 則「賣出了...」訊息(洗版)、且賣到歸零會觸發
 *     `openModal`/`closeModal`(批次情境不需要跳窗)。改成自己算完全部再一次性套用:
 *     迴圈只改 `player.gold`/`item.cnt`(歸零的從 `player.inv` 過濾掉),跑完才呼叫一次
 *     `renderTabs(true)`+`updateUI()`,並彙總成一則「共賣出 N 件、獲得 M 金幣」通知。
 *   - 只賣「道具分頁」的物品(排除武器/防具/飾品,那些另有各自的強化/裝備考量,批次販賣
 *     暫不處理),且沿用 `sellItem()` 本來就有的排除規則:上鎖(`item.lock`)、不可販售
 *     (`DB.items[id].noSell`)一律不會被列進清單。
 *   - 固定整批賣掉「勾選項目的全部數量」(不做部分數量選擇),跟原作「全部賣出」同粒度,
 *     介面更單純、風險更低。
 *
 * 進入點:`#tab-items` 分頁最上方(快速廢品按鈕下方)插入一顆「🧺 批次販賣」按鈕。
 *   monkey-patch `renderTabs`——真正渲染完後,若按鈕被整表重建清掉了(iDiv.innerHTML=''
 *   每次都重來),就補插回去。原作若改版拿掉 #tab-items 或整個分頁結構,插入會安靜失敗
 *   (找不到就不插),不影響遊戲本身。
 * ========================================================================== */
(function () {
  'use strict';

  var STYLE_ID = 'afk-batch-sell-style';
  var MODAL_ID = 'm-bs-modal';
  var selected = {};   // uid -> true

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:12px;}',
      '#' + MODAL_ID + '.hidden{display:none;}',
      '#' + MODAL_ID + ' .m-bs-box{background:#0f172a;border:1px solid #334155;border-radius:10px;width:100%;max-width:440px;max-height:86vh;display:flex;flex-direction:column;padding:12px;box-shadow:0 8px 30px rgba(0,0,0,.6);}',
      '#' + MODAL_ID + ' .m-bs-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}',
      '#' + MODAL_ID + ' .m-bs-title{font-weight:800;color:#fdba74;font-size:16px;}',
      '#' + MODAL_ID + ' .m-bs-close{background:#334155;border:1px solid #475569;color:#e2e8f0;border-radius:6px;width:32px;height:32px;font-weight:bold;cursor:pointer;}',
      '#' + MODAL_ID + ' input[type=search]{width:100%;box-sizing:border-box;padding:8px 10px;margin-bottom:8px;border-radius:6px;border:1px solid #475569;background:#020617;color:#e2e8f0;font-size:14px;}',
      '#' + MODAL_ID + ' .m-bs-allrow{display:flex;align-items:center;gap:8px;padding:6px 2px;color:#cbd5e1;font-size:13px;font-weight:bold;}',
      '#' + MODAL_ID + ' .m-bs-allrow input{width:20px;height:20px;}',
      '#' + MODAL_ID + ' .m-bs-list{flex:1;overflow-y:auto;border:1px solid #334155;border-radius:6px;background:#020617;margin-bottom:8px;min-height:120px;}',
      '#' + MODAL_ID + ' .m-bs-row{display:flex;align-items:center;gap:8px;padding:9px 10px;min-height:40px;box-sizing:border-box;border-bottom:1px solid #1e293b;cursor:pointer;}',
      '#' + MODAL_ID + ' .m-bs-row:last-child{border-bottom:none;}',
      '#' + MODAL_ID + ' .m-bs-row:hover,#' + MODAL_ID + ' .m-bs-row:active{background:#0f172a;}',
      '#' + MODAL_ID + ' .m-bs-row.m-bs-hide{display:none;}',
      '#' + MODAL_ID + ' .m-bs-row input[type=checkbox]{width:20px;height:20px;flex:0 0 auto;}',
      '#' + MODAL_ID + ' .m-bs-icon{width:22px;height:22px;object-fit:contain;flex:0 0 auto;}',
      '#' + MODAL_ID + ' .m-bs-name{flex:1;min-width:0;font-size:13px;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#' + MODAL_ID + ' .m-bs-meta{flex:0 0 auto;font-size:11px;color:#94a3b8;text-align:right;white-space:nowrap;}',
      '#' + MODAL_ID + ' .m-bs-summary{font-size:13px;color:#fde68a;font-weight:bold;margin-bottom:8px;min-height:18px;}',
      '#' + MODAL_ID + ' .m-bs-actions{display:flex;gap:8px;}',
      '#' + MODAL_ID + ' .m-bs-actions button{flex:1;padding:10px;border-radius:6px;font-weight:bold;font-size:14px;border:1px solid;cursor:pointer;}',
      '#' + MODAL_ID + ' .m-bs-cancel{background:#334155;border-color:#475569;color:#e2e8f0;}',
      '#' + MODAL_ID + ' .m-bs-confirm{background:#c2410c;border-color:#ea580c;color:#fed7aa;}',
      '#' + MODAL_ID + ' .m-bs-confirm:disabled{opacity:.5;cursor:not-allowed;}',
      '#m-batchsell-entry{display:block;width:100%;}'
    ].join('');
    document.head.appendChild(s);
  }

  function isEligible(item) {
    if (!item || (item.cnt || 0) <= 0 || item.lock) return false;
    var d = DB.items[item.id];
    if (!d || d.noSell) return false;
    if (d.type === 'wpn' || d.type === 'arm' || d.type === 'acc') return false;   // 只處理道具分頁範圍
    if (typeof trialDropBlocked === 'function' && trialDropBlocked(item.id)) return false;   // 本職試煉道具保護,同 sellItem
    return true;
  }

  function getEligibleItems() {
    if (typeof player === 'undefined' || !player || !Array.isArray(player.inv)) return [];
    return player.inv.filter(isEligible);
  }

  function ensureModal() {
    if (document.getElementById(MODAL_ID)) return;
    injectStyle();
    var modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'hidden';
    modal.innerHTML =
      '<div class="m-bs-box">' +
        '<div class="m-bs-head"><span class="m-bs-title">🧺 批次販賣</span><button type="button" class="m-bs-close" id="m-bs-close">✕</button></div>' +
        '<input type="search" id="m-bs-search" placeholder="搜尋物品名稱…">' +
        '<label class="m-bs-allrow"><input type="checkbox" id="m-bs-selectall"> 全選(<span id="m-bs-selcount">0</span>/<span id="m-bs-total">0</span>)</label>' +
        '<div class="m-bs-list" id="m-bs-list"></div>' +
        '<div class="m-bs-summary" id="m-bs-summary"></div>' +
        '<div class="m-bs-actions">' +
          '<button type="button" class="m-bs-cancel" id="m-bs-cancel">取消</button>' +
          '<button type="button" class="m-bs-confirm" id="m-bs-confirm">賣出勾選項目</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    modal.addEventListener('click', function (e) { if (e.target === modal) closeModalUI(); });
    document.getElementById('m-bs-close').onclick = closeModalUI;
    document.getElementById('m-bs-cancel').onclick = closeModalUI;
    document.getElementById('m-bs-confirm').onclick = confirmSell;
    document.getElementById('m-bs-search').addEventListener('input', function () { filterList(this.value); });
    document.getElementById('m-bs-selectall').addEventListener('change', function () {
      var checked = this.checked;
      var rows = document.querySelectorAll('#m-bs-list .m-bs-row:not(.m-bs-hide)');
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
    var rows = document.querySelectorAll('#m-bs-list .m-bs-row');
    for (var i = 0; i < rows.length; i++) {
      var name = (rows[i].getAttribute('data-name') || '').toLowerCase();
      rows[i].classList.toggle('m-bs-hide', q !== '' && name.indexOf(q) === -1);
    }
  }

  function toggleSel(uid, on) { if (on) selected[uid] = true; else delete selected[uid]; }

  function updateSummary() {
    var uids = Object.keys(selected);
    var totalGold = 0;
    uids.forEach(function (uid) {
      var row = document.querySelector('#m-bs-list .m-bs-row[data-uid="' + uid + '"]');
      if (row) totalGold += Number(row.getAttribute('data-est')) || 0;
    });
    var countEl = document.getElementById('m-bs-selcount');
    if (countEl) countEl.textContent = String(uids.length);
    var summaryEl = document.getElementById('m-bs-summary');
    if (summaryEl) summaryEl.textContent = uids.length ? ('已勾選 ' + uids.length + ' 項,預估獲得 ' + totalGold.toLocaleString() + ' 金幣。') : '尚未勾選任何物品。';
    var confirmBtn = document.getElementById('m-bs-confirm');
    if (confirmBtn) confirmBtn.disabled = uids.length === 0;
    var allBox = document.getElementById('m-bs-selectall');
    if (allBox) {
      var visibleRows = document.querySelectorAll('#m-bs-list .m-bs-row:not(.m-bs-hide)');
      var visibleChecked = 0;
      for (var i = 0; i < visibleRows.length; i++) { if (visibleRows[i].querySelector('input[type=checkbox]').checked) visibleChecked++; }
      allBox.checked = visibleRows.length > 0 && visibleChecked === visibleRows.length;
      allBox.indeterminate = visibleChecked > 0 && visibleChecked < visibleRows.length;
    }
  }

  function renderList() {
    selected = {};
    var items = getEligibleItems();
    var list = document.getElementById('m-bs-list');
    list.innerHTML = '';
    document.getElementById('m-bs-total').textContent = String(items.length);
    items.forEach(function (item) {
      var d = DB.items[item.id];
      var price = getSellPrice(item);
      var est = price * (item.cnt || 0);
      var row = document.createElement('label');
      row.className = 'm-bs-row';
      row.setAttribute('data-uid', item.uid);
      row.setAttribute('data-name', d.n || item.id);
      row.setAttribute('data-est', String(est));
      var imgUrl = (typeof getIconUrl === 'function') ? getIconUrl(d) : '';
      var nameHtml = (typeof getItemFullName === 'function') ? getItemFullName(item) : (d.n || item.id);
      var colorClass = (typeof getItemColor === 'function') ? getItemColor(item) : '';
      row.innerHTML =
        '<input type="checkbox">' +
        (imgUrl ? '<img class="m-bs-icon" src="' + imgUrl + '" onerror="this.style.visibility=\'hidden\';">' : '') +
        '<span class="m-bs-name ' + colorClass + '">' + nameHtml + '</span>' +
        '<span class="m-bs-meta">x' + (item.cnt || 0) + '・共 ' + est.toLocaleString() + ' 金</span>';
      row.querySelector('input[type=checkbox]').addEventListener('change', function (e) {
        toggleSel(item.uid, e.target.checked);
        updateSummary();
      });
      list.appendChild(row);
    });
    updateSummary();
  }

  function openModalUI() {
    ensureModal();
    renderList();
    document.getElementById('m-bs-search').value = '';
    filterList('');
    document.getElementById(MODAL_ID).classList.remove('hidden');
  }

  function confirmSell() {
    var uids = Object.keys(selected);
    if (!uids.length) return;
    var totalItems = 0, totalGold = 0;
    uids.forEach(function (uid) {
      var item = player.inv.find(function (i) { return i.uid === uid; });
      if (!isEligible(item)) return;   // 防禦:選取後狀態萬一變了(理論上 modal 開著時不會),跳過不賣
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

  function buildEntryButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'm-batchsell-entry';
    btn.className = 'classic-list-toolbar btn border-orange-700 bg-orange-900/70 hover:bg-orange-800 py-1.5 text-sm font-bold text-orange-200 rounded shadow mb-1';
    btn.textContent = '🧺 批次販賣';
    btn.onclick = openModalUI;
    return btn;
  }

  // renderTabs 每次都整表重建 #tab-items(iDiv.innerHTML=''),注入的按鈕會被清掉,渲染完後補插回去。
  function ensureEntryButton() {
    var panel = document.getElementById('tab-items');
    if (!panel) return;
    if (document.getElementById('m-batchsell-entry')) return;
    var header = panel.firstElementChild;   // buildQuickHeader('item') 一定是第一個子節點
    var btn = buildEntryButton();
    if (header) panel.insertBefore(btn, header.nextSibling);
    else panel.insertBefore(btn, panel.firstChild);
  }

  function install() {
    var orig = window.renderTabs;
    if (typeof orig !== 'function') return false;
    if (orig.__batchSellWrapped) return true;
    var wrapped = function () {
      var ret = orig.apply(this, arguments);
      try { ensureEntryButton(); } catch (e) {}
      return ret;
    };
    wrapped.__batchSellWrapped = true;
    window.renderTabs = wrapped;
    try { ensureEntryButton(); } catch (e) {}
    console.log('[AFK-batch-sell] hooks OK — 物品欄批次販賣已啟用。');
    return true;
  }

  try {
    if (!install()) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
      else setTimeout(install, 0);
    }
  } catch (e) { console.warn('[AFK-batch-sell] 安裝失敗,已略過:', e); }
})();
