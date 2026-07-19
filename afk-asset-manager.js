/* ============================================================================
 * afk-asset-manager.js — 首頁設定選單「🏦 角色資產管理」:跨存檔位查看/搬運金幣與物品
 *
 * 為什麼:玩家有多個存檔位(角色),要看/搬某角色的金幣或物品得逐一開分頁登入才能操作。
 *   16個存檔位全部存在同一個瀏覽器的 localStorage(只是 key 不同),只要遊戲已載入
 *   (任一分頁),這個分頁的 JS 就能讀到全部存檔的 key,不必切分頁逐一登入。
 *
 * 範圍(刻意縮小,降風險):只做「查看 + 把某角色的金幣/背包物品搬進共用倉庫」,
 *   不做「角色A直接轉給角色B」(不經過倉庫中繼)——共用倉庫本身已有完整性簽章與
 *   多分頁合併保護,經倉庫中繼比雙寫兩份存檔安全,且能解決「不想開16次分頁」的
 *   主要痛點(先把資產集中到倉庫,開任一角色都能取)。
 *
 * 寫入方式:
 *   - 若目標存檔位剛好是「目前這個分頁正在玩的角色」(currentSlot):直接改全域
 *     player.gold / player.inv 記憶體物件,再呼叫 saveGame()——不繞過遊戲自己的
 *     存檔函式,維持記憶體與硬碟一致。
 *   - 若是「別的存檔位」:用 _lzGet + _saveUnwrap 讀出明文 JSON、改完用
 *     _saveWrap + _lzSet 寫回——呼叫的是遊戲本體用來蓋存檔完整性簽章(SIG1)的
 *     同一組函式,寫回後簽章正確,不會被判定竄改。
 *
 * 安全限制:
 *   - 只在遊戲已載入(有 player/currentSlot 等全域)時可用,不能做成獨立於遊戲外的網頁工具。
 *   - 操作「別的存檔位」時,若該存檔位同時開著其他分頁在玩,那個分頁的自動存檔/心跳
 *     可能會把這裡剛寫入的內容蓋掉——本外掛前端無法偵測跨分頁狀態,只在面板文案提醒。
 *   - 簽章驗證失敗(_saveUnwrap 的 signed&&!ok)的存檔拒絕寫入,避免蓋掉可能已被竄改/毀損的資料。
 *   - 只搬背包(player.inv)裡「未鎖定」的物品,已裝備(player.eq)的裝備不動;
 *     WH_NO_STORE 清單(試煉道具等)一律不可搬,沿用共用倉庫既有的禁止清單。
 *   - 操作完成後在面板顯示提示,提醒玩家記得去雲端同步面板按「立即上傳」
 *     (雲端同步是純手動、不會自動感知本機資料被這裡改動)。
 *
 * 存檔位數量目前 8 格,寫成常數 SLOT_COUNT 方便未來若擴充上限調整。
 *
 * 優雅降級:找不到 player/currentSlot/loadWarehouse/saveWarehouse/saveGame/
 *   _lzGet/_lzSet/_saveWrap/_saveUnwrap/slotSummary/whSig/_whStackFind/
 *   WH_NO_STORE/WH_MAX/getItemFullName/DB 任一全域就 console.warn 並不掛設定選單項。
 * 掛接:index.html </body> 前需加一行 <script src="afk-asset-manager.js?v=..."></script>
 *   (透過 window.AFK_SETTINGS 掛首頁設定選單項,DOM 掛點為 #main-menu 間接存在)
 * ========================================================================== */
(function () {
  'use strict';

  var SLOT_COUNT = 8;   // 目前存檔位上限;若未來擴充,改這裡即可(雲端同步等其他外掛的上限需另外同步調整,不在本檔範圍)

  function init() {
    if (typeof player === 'undefined' || typeof currentSlot === 'undefined' ||
        typeof loadWarehouse !== 'function' || typeof saveWarehouse !== 'function' ||
        typeof saveGame !== 'function' || typeof _lzGet !== 'function' || typeof _lzSet !== 'function' ||
        typeof _saveWrap !== 'function' || typeof _saveUnwrap !== 'function' ||
        typeof slotSummary !== 'function' || typeof whSig !== 'function' || typeof _whStackFind !== 'function' ||
        typeof whCategory !== 'function' || typeof whItemSubCat !== 'function' ||
        typeof WH_NO_STORE === 'undefined' || typeof WH_MAX === 'undefined' ||
        typeof getItemFullName !== 'function' || typeof DB === 'undefined') {
      console.warn('[AFK-asset-manager] 缺少必要全域,角色資產管理功能停用。');
      return;
    }
    if (!document.getElementById('main-menu')) {
      console.warn('[AFK-asset-manager] 找不到 #main-menu,角色資產管理功能停用。');
      return;
    }

    injectCss();
    buildModal();

    window.AFK_SETTINGS = window.AFK_SETTINGS || { _items: [], add: function (it) { this._items.push(it); } };
    AFK_SETTINGS.add({ label: '🏦 角色資產管理', onClick: openModal });

    // （2026-07-19 隨原作v3.6同步移除舊版文字清單選角畫面 #slot-select-panel，本檔同步拿掉依附在它上面的
    //   「選存檔位畫面捷徑按鈕」——那個捷徑本來就要靠 openSlotSelect 被呼叫才會出現，而現行流程一律走
    //   openLoadSelect/renderLoadSelect，openSlotSelect 早已是死碼，捷徑從未真的出現過。主要入口（首頁設定選單）不受影響。）

    // ── 讀取某存檔位的「摘要 + 明文資料」；currentSlot 走記憶體(即時)，其餘走 localStorage(讀檔當下快照) ──
    function readSlot(n) {
      var live = (Number(n) === Number(currentSlot)) && player && player.cls;
      if (live) return { live: true, n: n, gold: player.gold || 0, inv: player.inv || [], sum: slotSummary(n) };
      var raw = _lzGet('lineage_idle_save_' + n);
      if (raw == null) return { live: false, n: n, empty: true };
      var u = _saveUnwrap(raw);
      if (u.signed && !u.ok) return { live: false, n: n, corrupt: true };
      var d;
      try { d = JSON.parse(u.payload); } catch (e) { return { live: false, n: n, corrupt: true }; }
      if (!d || !d.p) return { live: false, n: n, empty: true };
      return { live: false, n: n, gold: d.p.gold || 0, inv: d.p.inv || [], sum: slotSummary(n), _raw: u, _d: d };
    }

    // ── 寫回某存檔位(只用於「別的存檔位」；currentSlot 一律走 player+saveGame，不進這支) ──
    function writeSlotOffline(slot, mutateFn) {
      mutateFn(slot._d.p);
      var payload = JSON.stringify(slot._d);
      return _lzSet('lineage_idle_save_' + slot.n, _saveWrap(payload));
    }

    // ── 依 key 讀/寫共用倉庫桶,邏輯完全鏡射 js/12-npc-quests.js 的 loadWarehouse/saveWarehouse
    //   (含「桶存在卻解不開→拒寫」與「多分頁 uid 合併」兩道安全網),只是參數化成任意 key——
    //   因為目標存檔位的一般/經典模式可能跟「目前登入角色」不同,不能直接呼叫吃 whKey() 的原函式。
    function whLoadByKey(key) {
      var raw;
      try { raw = localStorage.getItem(key); } catch (e) { return { ok: false, w: { items: [], gold: 0 }, uids: null }; }
      if (raw == null) return { ok: true, w: { items: [], gold: 0 }, uids: new Set() };
      var s;
      try { s = _lzGet(key); } catch (e) { s = null; }
      if (s == null || s === '') return { ok: false, w: { items: [], gold: 0 }, uids: null };
      try {
        var w = JSON.parse(s);
        var items = w.items || [];
        var uids = new Set(items.map(function (it) { return it && it.uid; }).filter(function (u) { return u != null; }));
        return { ok: true, w: { items: items, gold: w.gold || 0 }, uids: uids };
      } catch (e) { return { ok: false, w: { items: [], gold: 0 }, uids: null }; }
    }
    function whSaveByKey(key, w, loadOk, uids) {
      if (loadOk === false) return false;   // 桶存在卻讀取失敗→拒絕寫入,避免覆蓋還救得回的資料
      var items = (w && w.items) || [];
      try {
        if (uids) {
          var cs = _lzGet(key);
          if (cs != null && cs !== '') {
            var cur = JSON.parse(cs);
            var haveUid = new Set(items.map(function (it) { return it && it.uid; }).filter(function (u) { return u != null; }));
            (cur.items || []).forEach(function (it) { if (it && it.uid != null && !uids.has(it.uid) && !haveUid.has(it.uid)) items.push(it); });
          }
        }
      } catch (e) {}
      return _lzSet(key, JSON.stringify({ items: items, gold: (w && w.gold) || 0 }));
    }

    // ── 把某存檔位「全部金幣」移入共用倉庫(依該角色一般/經典模式對應的桶) ──
    function moveAllGold(n) {
      var slot = readSlot(n);
      if (slot.empty || slot.corrupt) return { ok: false, amt: 0 };
      var amt = slot.gold || 0;
      if (amt <= 0) return { ok: false, amt: 0 };
      var wKey = 'lineage_idle_warehouse' + (slot.sum && slot.sum.classic ? '_classic' : '');
      var wl = whLoadByKey(wKey);
      if (!wl.ok) return { ok: false, amt: 0, reason: '倉庫讀取失敗' };
      wl.w.gold = (wl.w.gold || 0) + amt;
      if (!whSaveByKey(wKey, wl.w, wl.ok, wl.uids)) return { ok: false, amt: 0 };
      if (slot.live) { player.gold -= amt; saveGame(); }
      else { writeSlotOffline(slot, function (p) { p.gold = (p.gold || 0) - amt; }); }
      return { ok: true, amt: amt };
    }

    // ── 把某存檔位背包裡「單一物品(整疊)」移入共用倉庫 ──
    function moveItemToWarehouse(n, uidv) {
      var slot = readSlot(n);
      if (slot.empty || slot.corrupt) return { ok: false, reason: '讀取失敗' };
      var it = (slot.inv || []).find(function (x) { return x.uid === uidv; });
      if (!it) return { ok: false, reason: '物品不存在' };
      if (it.lock) return { ok: false, reason: '已鎖定' };
      if (WH_NO_STORE.indexOf(it.id) >= 0) return { ok: false, reason: '此物品無法存入倉庫' };
      var wKey = 'lineage_idle_warehouse' + (slot.sum && slot.sum.classic ? '_classic' : '');
      var wl = whLoadByKey(wKey);
      if (!wl.ok) return { ok: false, reason: '倉庫讀取失敗' };
      var stack = _whStackFind(wl.w.items, it);
      if (!stack && wl.w.items.length >= WH_MAX) return { ok: false, reason: '倉庫已滿' };
      if (stack) stack.cnt += it.cnt; else wl.w.items.push(it);
      if (!whSaveByKey(wKey, wl.w, wl.ok, wl.uids)) return { ok: false, reason: '寫入倉庫失敗' };
      if (slot.live) {
        player.inv = player.inv.filter(function (x) { return x.uid !== uidv; });
        saveGame();
      } else {
        writeSlotOffline(slot, function (p) { p.inv = (p.inv || []).filter(function (x) { return x.uid !== uidv; }); });
      }
      return { ok: true, name: getItemFullName(it), cnt: it.cnt };
    }

    var MAIN_CATS = [{ key: '', name: '全部' }, { key: 'weapon', name: '武器' }, { key: 'armor', name: '裝備' }, { key: 'item', name: '道具' }];
    // 子分類選單:邏輯完全鏡射 js/12-npc-quests.js 的 whSubCatOptions,只是參數化 main(原函式讀全域 _whFilter,
    //   這裡若直接呼叫會連動改到「真正倉庫視窗」目前顯示的分類,故照抄邏輯、不呼叫原函式)。
    function subCatOptions(main) {
      if (main === 'item') return [
        { key: 'card', name: '卡片' }, { key: 'skill', name: '技能' }, { key: 'craft', name: '製作' },
        { key: 'quest', name: '任務' }, { key: 'scroll', name: '卷軸' }, { key: 'other', name: '其他' }
      ];
      if (!main) return [];
      var grp = (main === 'weapon') ? ['武器'] : ['防具', '飾品'];
      var options = (typeof EQUIP_CATEGORIES !== 'undefined' ? EQUIP_CATEGORIES : []).filter(function (c) { return grp.indexOf(c.group) >= 0; }).map(function (c) { return { key: c.key, name: c.name }; });
      if (main === 'armor' && !options.some(function (c) { return c.key === 'tshirt'; })) options.splice(2, 0, { key: 'tshirt', name: '內衣' });
      return options;
    }
    // 單品是否符合「主分類+子分類」篩選:邏輯鏡射 whMatchFilter,同樣理由不直接呼叫原函式(它讀全域 _whFilter/_whSubFilter)。
    function matchFilter(id, main, sub) {
      if (main && whCategory(id) !== main) return false;
      if (!sub) return true;
      if (main === 'item') return whItemSubCat(id) === sub;
      if (main === 'armor' && sub === 'tshirt') { var d = DB.items[id]; return !!(d && d.type === 'arm' && d.slot === 'tshirt'); }
      return (typeof equipCatKey === 'function') ? (equipCatKey(id, DB.items[id]) === sub) : true;
    }

    // ── 把某存檔位背包裡「符合目前篩選、未鎖定、可存入」的物品一次全部移入共用倉庫 ──
    function bulkDepositFiltered(n, main, sub) {
      var slot = readSlot(n);
      if (slot.empty || slot.corrupt) return { ok: false, moved: 0 };
      var candidates = (slot.inv || []).filter(function (it) {
        return !it.lock && WH_NO_STORE.indexOf(it.id) < 0 && matchFilter(it.id, main, sub);
      });
      if (!candidates.length) return { ok: false, moved: 0 };
      var wKey = 'lineage_idle_warehouse' + (slot.sum && slot.sum.classic ? '_classic' : '');
      var wl = whLoadByKey(wKey);
      if (!wl.ok) return { ok: false, moved: 0, reason: '倉庫讀取失敗' };
      var movedUids = {}, moved = 0, full = false;
      for (var i = 0; i < candidates.length; i++) {
        var it = candidates[i];
        var stack = _whStackFind(wl.w.items, it);
        if (!stack && wl.w.items.length >= WH_MAX) { full = true; break; }
        if (stack) stack.cnt += it.cnt; else wl.w.items.push(it);
        movedUids[it.uid] = 1; moved++;
      }
      if (!moved) return { ok: false, moved: 0 };
      if (!whSaveByKey(wKey, wl.w, wl.ok, wl.uids)) return { ok: false, moved: 0, reason: '寫入倉庫失敗' };
      if (slot.live) {
        player.inv = player.inv.filter(function (x) { return !movedUids[x.uid]; });
        saveGame();
      } else {
        writeSlotOffline(slot, function (p) { p.inv = (p.inv || []).filter(function (x) { return !movedUids[x.uid]; }); });
      }
      return { ok: true, moved: moved, full: full };
    }

    // ── UI ──
    var _layer = null, _expanded = {}, _filter = {};   // _expanded[n]=展開背包;_filter[n]={main,sub} 該存檔位目前的分類篩選

    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function slotCardHTML(n) {
      var slot = readSlot(n);
      if (slot.empty) {
        return '<div class="m-asset-card m-asset-empty">存檔 ' + n + '：（空）</div>';
      }
      if (slot.corrupt) {
        return '<div class="m-asset-card m-asset-empty">存檔 ' + n + '：⚠️ 讀取失敗(可能毀損),已跳過。</div>';
      }
      var sum = slot.sum || {};
      var head = '<div class="m-asset-head">' +
        '<span class="m-asset-title">存檔 ' + n + (slot.live ? ' <span class="m-asset-live">(目前角色)</span>' : '') + '：' +
        esc(sum.cls || '') + ' Lv.' + esc(sum.lv || 1) + (sum.name ? '　' + esc(sum.name) : '') + '</span>' +
        '<span class="m-asset-gold">💰 ' + (slot.gold || 0).toLocaleString() + '</span>' +
        '</div>';
      var actions = '<div class="m-asset-actions">' +
        '<button type="button" class="m-asset-btn" data-act="gold" data-n="' + n + '"' + (slot.gold > 0 ? '' : ' disabled') + '>金幣全部移入倉庫</button>' +
        '<button type="button" class="m-asset-btn" data-act="toggle" data-n="' + n + '">' + (_expanded[n] ? '收起背包' : '查看背包（' + (slot.inv || []).length + '）') + '</button>' +
        '</div>';
      var itemsHtml = '';
      if (_expanded[n]) {
        var f = _filter[n] || { main: '', sub: '' };
        var subOpts = subCatOptions(f.main);
        if (!subOpts.some(function (o) { return o.key === f.sub; })) f.sub = '';   // 切主分類後子分類清單變了,舊選擇失效就重置
        _filter[n] = f;

        var filterHtml = '<div class="m-asset-filter">' +
          '<select class="m-asset-select" data-role="main" data-n="' + n + '">' +
          MAIN_CATS.map(function (c) { return '<option value="' + c.key + '"' + (c.key === f.main ? ' selected' : '') + '>' + c.name + '</option>'; }).join('') +
          '</select>' +
          (subOpts.length ? ('<select class="m-asset-select" data-role="sub" data-n="' + n + '">' +
            '<option value="">全部</option>' +
            subOpts.map(function (o) { return '<option value="' + o.key + '"' + (o.key === f.sub ? ' selected' : '') + '>' + o.name + '</option>'; }).join('') +
            '</select>') : '') +
          '<button type="button" class="m-asset-btn m-asset-btn-sm" data-act="bulk" data-n="' + n + '">🧺 一鍵存入（此篩選）</button>' +
          '</div>';

        var invList = (slot.inv || []).filter(function (it) { return !it.lock && matchFilter(it.id, f.main, f.sub); });
        var listHtml;
        if (!invList.length) {
          listHtml = '<div class="m-asset-empty-inv">此篩選下沒有可搬運的物品(已鎖定物品不顯示)。</div>';
        } else {
          listHtml = '<div class="m-asset-items">' + invList.map(function (it) {
            var blocked = WH_NO_STORE.indexOf(it.id) >= 0;
            var cnt = it.cnt > 1 ? ' ×' + it.cnt : '';
            return '<div class="m-asset-item">' +
              '<span class="m-asset-item-name">' + getItemFullName(it) + cnt + '</span>' +
              (blocked ? '<span class="m-asset-item-blocked">不可存入</span>' :
                '<button type="button" class="m-asset-btn m-asset-btn-sm" data-act="item" data-n="' + n + '" data-uid="' + it.uid + '">搬進倉庫</button>') +
              '</div>';
          }).join('') + '</div>';
        }
        itemsHtml = filterHtml + listHtml;
      }
      return '<div class="m-asset-card">' + head + actions + itemsHtml + '</div>';
    }

    var _toastMsg = '';
    function renderBody() {
      var html = '';
      if (_toastMsg) html += '<div class="m-asset-toast">' + esc(_toastMsg) + ' ⚠️ 別忘了到「雲端同步」面板按一次「立即上傳」,否則其他裝置可能還會看到舊的分配結果。</div>';
      for (var n = 1; n <= SLOT_COUNT; n++) html += slotCardHTML(n);
      return html;
    }

    function refresh() {
      document.getElementById('m-asset-body').innerHTML = renderBody();
    }

    function onBodyClick(e) {
      var b = e.target.closest('.m-asset-btn');
      if (!b || b.disabled) return;
      var act = b.getAttribute('data-act'), n = parseInt(b.getAttribute('data-n'), 10);
      if (act === 'toggle') { _expanded[n] = !_expanded[n]; refresh(); return; }
      if (act === 'gold') {
        var r = moveAllGold(n);
        _toastMsg = r.ok ? ('存檔 ' + n + ' 的 ' + r.amt.toLocaleString() + ' 金幣已移入共用倉庫。') : '移動失敗(該存檔位金幣為 0 或讀取失敗)。';
        refresh();
        return;
      }
      if (act === 'item') {
        var uidv = b.getAttribute('data-uid');
        var r2 = moveItemToWarehouse(n, uidv);
        _toastMsg = r2.ok ? ('存檔 ' + n + ' 的「' + stripTags(r2.name) + '」×' + r2.cnt + ' 已移入共用倉庫。') : ('移動失敗：' + (r2.reason || '未知錯誤') + '。');
        refresh();
        return;
      }
      if (act === 'bulk') {
        var f = _filter[n] || { main: '', sub: '' };
        var r3 = bulkDepositFiltered(n, f.main, f.sub);
        var label = (MAIN_CATS.find(function (c) { return c.key === f.main; }) || {}).name || '全部';
        if (f.sub) { var so = subCatOptions(f.main).find(function (o) { return o.key === f.sub; }); if (so) label += '－' + so.name; }
        _toastMsg = r3.ok ? ('存檔 ' + n + ' 的「' + label + '」共 ' + r3.moved + ' 件物品已移入共用倉庫' + (r3.full ? '(倉庫已滿,部分未存入)' : '') + '。')
          : ('沒有符合「' + label + '」篩選、且未鎖定可搬運的物品' + (r3.reason ? '(' + r3.reason + ')' : '') + '。');
        refresh();
      }
    }
    function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, ''); }
    function onBodyChange(e) {
      var sel = e.target.closest('.m-asset-select');
      if (!sel) return;
      var n = parseInt(sel.getAttribute('data-n'), 10), role = sel.getAttribute('data-role');
      var f = _filter[n] || { main: '', sub: '' };
      if (role === 'main') { f.main = sel.value; f.sub = ''; } else { f.sub = sel.value; }
      _filter[n] = f;
      refresh();
    }

    function openModal() {
      var m = document.getElementById('m-asset-modal'); if (!m) return;
      _toastMsg = ''; _expanded = {}; _filter = {};
      refresh();
      m.classList.add('open');
      _layer = window.AFK_UI ? AFK_UI.openLayer(hideModal) : null;
    }
    function hideModal() { var m = document.getElementById('m-asset-modal'); if (m) m.classList.remove('open'); _layer = null; }
    function closeModal() { if (_layer && window.AFK_UI) AFK_UI.closeLayer(_layer); else hideModal(); }

    function buildModal() {
      if (document.getElementById('m-asset-modal')) return;
      var modal = document.createElement('div');
      modal.id = 'm-asset-modal';
      modal.innerHTML =
        '<div id="m-asset-card">' +
          '<div id="m-asset-head-bar">' +
            '<span id="m-asset-title-bar">🏦 角色資產管理</span>' +
            '<button id="m-asset-close" type="button" title="關閉">✕</button>' +
          '</div>' +
          '<div id="m-asset-intro">查看各存檔位的金幣/背包,可搬進共用倉庫(四個存檔角色共用的中繼站，需與該角色一般/經典模式相同)。' +
            '只搬未鎖定的背包物品，已裝備的裝備不動。<b>若某個存檔位同時開著其他分頁在玩，請避免同時在這裡操作它，以免互相覆蓋。</b></div>' +
          '<div id="m-asset-body"></div>' +
        '</div>';
      document.body.appendChild(modal);
      document.getElementById('m-asset-close').addEventListener('click', closeModal);
      modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
      document.getElementById('m-asset-body').addEventListener('click', onBodyClick);
      document.getElementById('m-asset-body').addEventListener('change', onBodyChange);
    }

    function injectCss() {
      if (document.getElementById('m-asset-style')) return;
      var s = document.createElement('style');
      s.id = 'm-asset-style';
      s.textContent = [
        '#m-asset-modal{display:none;position:fixed;inset:0;z-index:1000;background:rgba(2,6,23,0.82);align-items:flex-start;justify-content:center;padding:24px 12px;font-family:system-ui,"Segoe UI",sans-serif;}',
        '#m-asset-modal.open{display:flex;}',
        '#m-asset-card{width:min(640px,96vw);max-height:calc(100dvh - 48px);display:flex;flex-direction:column;background:#0f172a;border:1px solid #334155;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;}',
        '#m-asset-head-bar{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #1e293b;flex:0 0 auto;}',
        '#m-asset-title-bar{font-size:16px;font-weight:bold;color:#fff;}',
        '#m-asset-close{width:40px;height:40px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;border-radius:8px;font-size:15px;cursor:pointer;line-height:1;}',
        '#m-asset-close:active{background:#334155;}',
        '#m-asset-intro{color:#94a3b8;font-size:12.5px;line-height:1.6;padding:10px 14px;border-bottom:1px solid #1e293b;flex:0 0 auto;}',
        '#m-asset-intro b{color:#fca5a5;}',
        '#m-asset-body{flex:1 1 auto;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;}',
        '.m-asset-toast{background:#164e63;border:1px solid #0891b2;color:#a5f3fc;font-size:13px;line-height:1.6;padding:8px 12px;border-radius:8px;}',
        '.m-asset-card{background:#111c30;border:1px solid #1e293b;border-radius:10px;padding:10px 12px;}',
        '.m-asset-empty{color:#64748b;font-size:13px;}',
        '.m-asset-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;}',
        '.m-asset-title{color:#fcd34d;font-size:14px;font-weight:bold;}',
        '.m-asset-live{color:#67e8f9;font-weight:normal;font-size:12px;}',
        '.m-asset-gold{color:#facc15;font-size:13px;font-weight:bold;white-space:nowrap;}',
        '.m-asset-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;}',
        '.m-asset-btn{min-height:40px;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;font-family:inherit;border:1px solid #4338ca;background:#312e81;color:#c7d2fe;}',
        '.m-asset-btn:active{background:#3730a3;}',
        '.m-asset-btn:disabled{opacity:.4;cursor:not-allowed;}',
        '.m-asset-btn-sm{min-height:36px;padding:4px 10px;font-size:12px;}',
        '.m-asset-filter{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;}',
        '.m-asset-select{height:36px;box-sizing:border-box;padding:4px 8px;border-radius:8px;font-size:12.5px;font-family:inherit;border:1px solid #334155;background:#1e293b;color:#e2e8f0;}',
        '.m-asset-items{margin-top:8px;display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;}',
        '.m-asset-item{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#0b1424;border:1px solid #1e293b;border-radius:7px;padding:6px 8px;font-size:13px;}',
        '.m-asset-item-name{color:#e2e8f0;word-break:break-word;}',
        '.m-asset-item-blocked{color:#f87171;font-size:11px;white-space:nowrap;}',
        '.m-asset-empty-inv{color:#64748b;font-size:12.5px;margin-top:8px;}'
      ].join('');
      document.head.appendChild(s);
    }

    console.log('[AFK-asset-manager] hooks OK — 角色資產管理已加入首頁設定選單。');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
