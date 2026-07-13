/* ============================================================================
 * afk-mobile.js — 手機版介面外掛(底部導覽列版面)
 *
 * 設計:CSS 為主 + 少量 JS,完全不改原作者程式碼。
 *   - 不重建 DOM,只「辨識三欄(靠內容裡的穩定 id,比位置順序耐改版)」並加 class。
 *   - 把 #status-panel(HP/MP/金幣)移到最上方常駐;三欄一次只顯示一欄。
 *   - 注入底部導覽列:⚔️戰鬥 / 👥隊伍(v2.6.74 作者把自動化設定移成遊戲分頁後,此視圖只剩傭兵隊伍面板) / 🎒背包 / 📜日誌(日誌=底部浮動面板,可切戰鬥/系統、有✕關閉)。
 *   - 用 matchMedia 偵測手機;切回桌機自動還原,桌面版面 100% 不受影響。
 *   - 所有手機樣式都掛在 body.m-mobile 之下,JS 沒判定是手機就完全不生效。
 *
 * 掛接:在 index.html </body> 前加一行
 *   <script src="afk-mobile.js"></script>
 * ========================================================================== */
(function () {
  'use strict';

  var MQ = '(max-width: 768px)';

  // 🎛️ 網址參數 ?mobscale=X:即時調手機戰鬥怪物圖大小(X=倍率,1=目前預設;上方 mob-img-inner 的 scale 會再乘它)。
  //   設在 :root 的 --afk-mobscale。方便現場調到滿意的值再回報,不必每次改 code 重部署。桌機也讀但無 CSS 用到→無害。
  (function readMobScale() {
    try {
      var v = new URLSearchParams(location.search).get('mobscale');
      if (v == null) return;
      var n = parseFloat(v);
      if (isFinite(n) && n > 0 && n <= 20) document.documentElement.style.setProperty('--afk-mobscale', String(n));
    } catch (e) {}
  })();

  // 🪆 手機關閉魔法娃娃游標特效(2026-07-08 待辦問題1):css/style.css 的
  //   `body.has-doll-cursor *{cursor:inherit!important}` 是萬用選擇器+!important,套用範圍是全部
  //   DOM 節點,裝娃娃是長期狀態、幾乎全程掛在 body 上——手機沒有游標可顯示(觸控裝置看不到游標圖案),
  //   但這條規則的「選擇器成本」不受此影響,DOM 每次變動(戰鬥 tick 頻繁重繪)都要重算,疊加手機補發
  //   合成 mousemove 拖慢點擊回饋。手機模式下直接不掛 has-doll-cursor class、不建光點,對玩家沒有
  //   視覺損失(反正看不到)、換掉最貴的那條規則。桌機完全不受影響(僅在 m-mobile 時短路)。
  //   （原本改在 index.html/js/02-stats-recompute.js 裡的 applyDollCursor 逐一判斷,但那是本體
  //   程式碼、依規則不能改;改用外部 monkey-patch 包住全域函式,原作者怎麼改 css 都自動跟上。）
  (function wrapApplyDollCursorForMobile() {
    if (typeof window.applyDollCursor !== 'function') {
      console.warn('[AFK-mobile] 找不到全域 applyDollCursor,魔法娃娃手機游標優化未套用。');
      return;
    }
    if (window.applyDollCursor.__afkMobileWrapped) return;
    var orig = window.applyDollCursor;
    var wrapped = function () {
      if (document.body && document.body.classList.contains('m-mobile')) {
        document.body.classList.remove('has-doll-cursor');
        document.body.style.cursor = '';
        var glow = document.getElementById('doll-cursor-glow');
        if (glow) glow.classList.remove('active');
        return;
      }
      return orig.apply(this, arguments);
    };
    wrapped.__afkMobileWrapped = true;
    window.applyDollCursor = wrapped;
  })();

  function init() {
    var gs = document.getElementById('game-screen');
    if (!gs) { console.warn('[AFK-mobile] 找不到 #game-screen,手機版停用。'); return; }

    // --- 辨識三欄(用內容裡的穩定 id,而非位置順序)---------------------------
    function findCol(sel) {
      var kids = gs.children;
      for (var i = 0; i < kids.length; i++) {
        try { if (kids[i].querySelector && kids[i].querySelector(sel)) return kids[i]; } catch (e) {}
      }
      return null;
    }
    var colLeft   = findCol('#status-panel');
    var colCenter = findCol('#combat-log-panel') || findCol('#battle-view');
    var colRight  = findCol('#tab-stats') || findCol('.tab-bar');
    if (!colLeft || !colCenter || !colRight) {
      console.warn('[AFK-mobile] 三欄辨識失敗,手機版停用。', { left: !!colLeft, center: !!colCenter, right: !!colRight });
      return;
    }
    colLeft.classList.add('m-col-left');
    colCenter.classList.add('m-col-center');
    colRight.classList.add('m-col-right');

    trackAppHeight();      // 量真實可視高度寫進 --app-h,蓋掉不可靠的 100vh
    injectCSS();
    var strip = buildStatusStrip();
    gs.insertBefore(strip, gs.firstChild);
    var statModal = buildStatModal();
    gs.appendChild(statModal);
    strip.addEventListener('click', openStatModal);   // 點整條狀態列 → 彈出桌面版角色資訊塊(內含改名)
    var nav = buildNav();
    gs.appendChild(nav);
    initTipPeek();   // 手機「長按物品看詳情」(取代桌機 hover tooltip)
    initInputZoomGuard();   // 2026-07-08(待辦#7):輸入框 focus 時防止 iOS 自動放大畫面
    // (手機倉庫數量自製視窗已移除:改用原作者 V2.32 的原生「數量」輸入框 #wh-qty-amt——非 prompt、手機可用、parseInt 無溢位,故自製視窗不再需要。)

    // 手機:點「回村/回城」後自動收起日誌浮層。日誌展開時會蓋住村莊的 NPC/商店/倉庫,否則每次回村都要先手動關一次。
    //   回村兩顆鈕(桌機 #btn-return-town、手機 #mv-action-btn)都指向全域 returnToTown,包它最省。
    //   只在「地圖真的有換」時關(被石化/暈眩擋住而沒回成的情況 mapState 不變 → 不關,也不會吃掉那則提示)。
    if (typeof window.returnToTown === 'function' && !window.returnToTown.__afkWrapped) {
      var _returnToTown = window.returnToTown;
      window.returnToTown = function () {
        var before = (typeof mapState !== 'undefined' && mapState) ? mapState.current : null;
        var r = _returnToTown.apply(this, arguments);
        try {
          var after = (typeof mapState !== 'undefined' && mapState) ? mapState.current : null;
          if (after && after !== before && document.body.classList.contains('m-mobile')) closeLog();
        } catch (e) {}
        return r;
      };
      window.returnToTown.__afkWrapped = true;
    }

    // 手機戰鬥畫面:在怪物(#battle-view)正下方插「手動喝水列」(桌機隱藏)
    //   每列 = [藥水圖示][數量][按鈕];背包有安特的水果時自動多出第二列(食用)。
    var battleView = document.getElementById('battle-view');
    var healBar = null;
    if (battleView && battleView.parentNode) {
      healBar = buildHealBar();
      battleView.parentNode.insertBefore(healBar, battleView.nextSibling);
    }

    // 喝水列下方:鏡射「背包→技能」裡 type:manual 的主動施放技能(傳送/能量感測/迷魅/絕對屏障)成快捷鈕,
    //   點擊直接走遊戲原生 manualCast(skId) → 由它把關等級/冷卻/MP/目標等所有條件(與背包面板的施放鈕同一支)。
    var skillBar = null;
    if (healBar && healBar.parentNode) {
      skillBar = document.createElement('div');
      skillBar.id = 'm-skill-bar';
      healBar.parentNode.insertBefore(skillBar, healBar.nextSibling);
    }

    // 戰鬥畫面技能列下方:即時鏡射「背包→能力→狀態」(#dt-buffs:增益/減益)一份,
    //   讓戰鬥中不用切分頁也看得到當前狀態。內容由 mirror() 每 300ms 從 #dt-buffs 複製 innerHTML。
    var battleBuffs = null;
    var _buffAfter = skillBar || healBar;
    if (_buffAfter && _buffAfter.parentNode) {
      battleBuffs = document.createElement('div');
      battleBuffs.id = 'm-battle-buffs';
      _buffAfter.parentNode.insertBefore(battleBuffs, _buffAfter.nextSibling);
    }
    function setHealRow(row, itemId, cnt, empty) {
      if (!row) return;
      var ic = row.querySelector('.m-heal-ic'), c = row.querySelector('.m-heal-cnt');
      if (ic && typeof getIconUrl === 'function' && typeof DB !== 'undefined' && DB.items[itemId]) {
        var url = getIconUrl(DB.items[itemId]);
        if (ic.getAttribute('src') !== url) ic.setAttribute('src', url);
      }
      if (c) c.textContent = '×' + cnt;
      row.classList.toggle('m-empty', !!empty);
    }
    function updateHealBar() {
      if (!healBar) return;
      var pot = pickHealPot();
      var sel = document.getElementById('set-pot');
      var dispId = pot ? pot.id : ((sel && sel.value) || 'potion_heal');   // 沒貨也顯示設定選的那種圖示(變灰)
      setHealRow(healBar.querySelector('.m-heal-pot'), dispId, pot ? (pot.cnt || 0) : 0, !pot);
      var fruit = (typeof player !== 'undefined' && player && player.inv) ? player.inv.find(function (x) { return x.id === 'new_item_141' && (x.cnt || 0) > 0; }) : null;
      var fruitRow = healBar.querySelector('.m-heal-fruit');
      if (fruitRow) { fruitRow.classList.toggle('m-show', !!fruit); if (fruit) setHealRow(fruitRow, 'new_item_141', fruit.cnt || 0, false); }
      // 左側兩個卷軸勾選:回填設定面板的當前值(從設定面板或讀檔改動時跟著動)
      var cbs = healBar.querySelectorAll('.m-scroll-cb');
      for (var i = 0; i < cbs.length; i++) {
        var t = document.getElementById(cbs[i].getAttribute('data-target'));
        if (t && cbs[i].checked !== t.checked) cbs[i].checked = t.checked;
      }
    }
    // 主動施放技能快捷鈕:只在「已學的 type:manual 技能」集合變動時重建按鈕(避免每 300ms 重畫);
    //   每次都更新「冷卻中／MP 不足」的灰階提示(純視覺,實際限制仍由 manualCast 把關)。
    var _skillSig = '';
    function syncSkillBar() {
      if (!skillBar) return;
      if (typeof player === 'undefined' || !player || !player.skills || typeof DB === 'undefined') { skillBar.classList.remove('m-has'); return; }
      var manual = player.skills.filter(function (id) { return DB.skills[id] && DB.skills[id].type === 'manual'; });
      manual.sort(function (a, b) { return (DB.skills[a].tier || 0) - (DB.skills[b].tier || 0); });   // 與背包-技能面板同序
      var sig = manual.join(',');
      if (sig !== _skillSig) {
        _skillSig = sig;
        skillBar.innerHTML = '';
        manual.forEach(function (id) {
          var sk = DB.skills[id];
          var btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'm-skill-go'; btn.setAttribute('data-sk', id);
          var img = document.createElement('img'); img.className = 'm-skill-ic'; img.alt = '';
          if (typeof getIconUrl === 'function') { var u = getIconUrl(sk, true); if (u) img.setAttribute('src', u); }
          img.onerror = function () { this.style.display = 'none'; };
          var name = document.createElement('span'); name.className = 'm-skill-n'; name.textContent = sk.n;
          btn.appendChild(img); btn.appendChild(name);
          btn.addEventListener('click', function () { if (typeof manualCast === 'function') manualCast(id); });
          skillBar.appendChild(btn);
        });
      }
      skillBar.classList.toggle('m-has', manual.length > 0);
      for (var i = 0; i < skillBar.children.length; i++) {
        var b = skillBar.children[i], sid = b.getAttribute('data-sk'), s = DB.skills[sid];
        if (!s) continue;
        var cd = (player.manualCd && player.manualCd[sid]) || 0;
        var cost = (s.mp && player.d && typeof player.d.getMpCost === 'function') ? player.d.getMpCost(s.mp, s.tier) : (s.mp || 0);
        b.classList.toggle('m-cd', cd > 0 || (player.mp || 0) < cost);
      }
    }

    // 戰鬥日誌 / 系統日誌:手機上做成「底部浮動面板」(從導覽列開,浮在畫面上,不擠壓戰鬥畫面)
    var combatLog = document.getElementById('combat-log-panel');
    var sysPanel = (function () { var s = document.getElementById('sys-log'); return s && s.closest ? s.closest('.panel') : null; })();
    // 🔧 桌機還原日誌時要放回「原本的家」,不能硬塞中欄。作者 2026-06 大改版把兩個日誌包進 #log-row(中欄的子層),
    //   舊碼的 logsToColumn 把它們 append 到 colCenter(中欄本身)→ 變成中欄直接子層、脫離 #log-row → 桌機中欄
    //   排版壞掉(地圖框被擠扁、日誌跑回舊位置=使用者說的「中間那欄還是舊的」)。改成記住各自的原始父層,還原放回去。
    var combatLogHome = combatLog ? combatLog.parentNode : null;   // 新版＝#log-row;舊版＝中欄。記載入當下的家
    var sysPanelHome = sysPanel ? sysPanel.parentNode : null;
    var logSheet = null;
    if (combatLog && sysPanel) {
      sysPanel.classList.add('m-syslog');
      logSheet = buildLogSheet();
      gs.appendChild(logSheet);
      decorateLogHeader(combatLog, 'sys');     // 戰鬥日誌標題列:⇆ 切到系統 / ✕ 關閉
      decorateLogHeader(sysPanel, 'combat');   // 系統日誌標題列:⇆ 切到戰鬥 / ✕ 關閉
    }
    var logBody = logSheet ? logSheet.querySelector('#m-log-body') : null;
    // 手機:把兩個日誌面板移進浮動面板;桌機:移回中欄原位(最後兩個子元素,順序還原)
    function logsIntoSheet() { if (logBody && combatLog && sysPanel) { logBody.appendChild(combatLog); logBody.appendChild(sysPanel); } }
    function logsToColumn() {   // 桌機:把兩個日誌放回原始父層(新版#log-row/舊版中欄),不要硬塞中欄
      if (combatLog && combatLogHome) combatLogHome.appendChild(combatLog);
      if (sysPanel && sysPanelHome) sysPanelHome.appendChild(sysPanel);
    }

    // 手機上拿掉「冒險地圖」標題文字(騰空間 + 控制項靠左不撐開);保留 status-alerts/siege-timer
    (function () {
      var mapSel = document.getElementById('map-select');
      var mapHdr = mapSel && mapSel.closest ? mapSel.closest('.panel-header') : null;
      if (!mapHdr) return;
      mapHdr.classList.add('m-maphdr');
      var sa = document.getElementById('status-alerts');
      var lbl = sa ? sa.parentNode : null;
      if (!lbl) return;
      Array.prototype.slice.call(lbl.childNodes).forEach(function (n) {
        if (n.nodeType === 3 && n.textContent.trim()) {   // 非空白文字節點 = 「冒險地圖」
          var w = document.createElement('span');
          w.className = 'm-maptitle';
          w.textContent = n.textContent;
          lbl.replaceChild(w, n);
        }
      });
    })();

    // 精簡狀態列:每 300ms 把遊戲的 Lv/HP/MP/金幣/EXP 鏡射到 #m-status(只讀 id,低耦合)
    var elName = strip.querySelector('#ms-name'),
        elLv = strip.querySelector('#ms-lv'), elHp = strip.querySelector('#ms-hp'),
        elMp = strip.querySelector('#ms-mp'), elGold = strip.querySelector('#ms-gold'),
        elAc = strip.querySelector('#ms-ac'), elMr = strip.querySelector('#ms-mr'),
        elHpBar = strip.querySelector('#ms-hp-bar'), elMpBar = strip.querySelector('#ms-mp-bar'),
        elExp = strip.querySelector('#ms-exp'), elVictory = strip.querySelector('#ms-victory');
    function txt(id) { var e = document.getElementById(id); return e ? e.textContent.trim() : ''; }
    function barW(id) { var e = document.getElementById(id); return e && e.style.width ? e.style.width : '0%'; }
    // mirror 每 300ms 跑一次,值多半沒變 → 只在「真的變了」才寫 DOM,免無謂觸發樣式重算/重排。
    function setTxt(el, v) { if (el && el.textContent !== v) el.textContent = v; }
    function setW(el, v) { if (el && el.style.width !== v) el.style.width = v; }
    var _lastBuffsHtml = '';   // #m-battle-buffs 上次內容;沒變就不重設 innerHTML(免每 300ms 重新解析整段)
    function mirror() {
      if (!document.body.classList.contains('m-mobile')) return;
      // 暱稱(st-class);沒取名就退回職業(st-classname),都沒有才 '--'
      setTxt(elName, txt('st-class') || txt('st-classname') || '--');
      setTxt(elLv, txt('st-lv') || '--');
      setTxt(elAc, txt('st-ac') || '--');   // 防禦 (AC)
      setTxt(elMr, txt('st-mr') || '--');   // 魔防 (MR)
      setTxt(elHp, txt('txt-hp') || '--');
      setTxt(elMp, txt('txt-mp') || '--');
      setW(elHpBar, barW('bar-hp'));   // 跟原版血條同步寬度(讀遊戲自己算好的 %)
      setW(elMpBar, barW('bar-mp'));
      setTxt(elGold, txt('st-gold') || '--');
      // 攻城獲勝才在金幣右邊亮出皇冠(讀全域 siegeVictoryActive,缺了就安靜不顯示)
      if (elVictory) { var vd = (typeof siegeVictoryActive === 'function' && siegeVictoryActive()) ? '' : 'none'; if (elVictory.style.display !== vd) elVictory.style.display = vd; }
      var be = document.getElementById('bar-exp');
      if (be) setW(elExp, be.style.width || '0%');
      // 村莊判定(控制喝水列在村莊隱藏)
      var townView = document.getElementById('town-view');
      document.body.classList.toggle('m-intown', !!(townView && !townView.classList.contains('hidden')));
      // 喝水列/技能列/狀態鏡射都只在「戰鬥畫面」看得到 → 切到設定/背包分頁時整段跳過,不白做
      if (document.body.classList.contains('mview-battle')) {
        updateHealBar();
        syncSkillBar();
        // 戰鬥畫面狀態鏡射:把 #dt-buffs(背包→能力→狀態)同步到喝水列下方的 #m-battle-buffs
        if (battleBuffs) { var dtb = document.getElementById('dt-buffs'); var h = dtb ? dtb.innerHTML : ''; if (h !== _lastBuffsHtml) { _lastBuffsHtml = h; battleBuffs.innerHTML = h; } }
      }
      // 村莊時遊戲會給 combat-log-panel 加 hidden(沒有戰鬥日誌):強制切系統日誌、隱藏「切到戰鬥」鈕
      var noCombat = !combatLog || combatLog.classList.contains('hidden');
      document.body.classList.toggle('mlog-nocombat', noCombat);
      if (noCombat && document.body.classList.contains('mlog-combat')) setLog('sys');
      ensureLoadSelectSlotPicker();   // 選角畫面(手機)8 顆存檔位按鈕:面板一出現就補插+每次刷新 active/名稱,idempotent
      ensureLoadArchOverlay();   // 選角畫面(手機)拱門疊圖(見下方 2026-07-13 註解),idempotent
      ensureTownNpcList();   // 城鎮 NPC 條列式選單(手機;見下方 2026-07-13 稍晚註解),idempotent(簽章沒變就不重建)
    }
    setInterval(mirror, 300);

    // 2026-07-13:選角畫面(手機)拱門畫框疊圖——見上方 CSS `#m-load-arch-overlay` 註解。
    //   插在 #load-slot-grid 內部(inset:0 貼滿同容器),跟角色卡片共用同一個 background-size/
    //   position 座標,拱門與角色天生對齊;只需建立一次,重複呼叫是 idempotent no-op。
    function ensureLoadArchOverlay() {
      var grid = document.getElementById('load-slot-grid');
      if (!grid) return;
      var ov = document.getElementById('m-load-arch-overlay');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = 'm-load-arch-overlay';
        grid.appendChild(ov);
      }
      // 2026-07-13:用「容器實際寬度」算固定像素裁切(不用百分比),不受容器高度/裝置差異影響。
      // 原圖(640×480)固定裁切窗:x=163~318(實測兩根柱子中心點,寬155px)、y 從 5px 起算,
      // 讓左右兩側對稱各露出半根柱子、上方拱形雕花弧線完整可見(2026-07-13 稍晚使用者回報
      // 舊座標 170~330 兩側不對稱、弧線被切掉,重新量測像素後修正,取得使用者確認預覽圖後套用)。
      // 只套在拱門疊圖(load1.png)上——#load-slot-grid 本身已改純黑填色,不需要裁切背景圖。
      var w = grid.getBoundingClientRect().width;
      if (w > 0) {
        var scale = w / 155;
        var bgSize = Math.round(640 * scale) + 'px ' + Math.round(480 * scale) + 'px';
        var bgPos = (-Math.round(163 * scale)) + 'px ' + (-Math.round(5 * scale)) + 'px';
        ov.style.backgroundSize = bgSize;
        ov.style.backgroundPosition = bgPos;
      }
    }

    // 2026-07-13 稍晚:城鎮 NPC 條列式選單(手機)。原作 v3.2.84 把城鎮 NPC 從「文字卡片清單」
    // 改成「站在地圖上、名字用小標籤浮貼」,他自己的「名牌防重疊」(_resolveTownLabelOverlap)
    // 遇到 NPC 站得密集的城鎮(如銀騎士村 7 位)只會把名牌往上疊成一直行、不會左右錯開,手機窄螢幕
    // 還是會疊在一起、很難點準;加上手機觸控本來就比滑鼠難點中小小的地圖人物。
    // 使用者要求:地圖圖片保留(視覺),但地圖下方要有「一個個往下排」的清單,點哪一列就等同點地圖上的
    // 那個人。原作把舊卡片清單的程式碼整段註解關掉、資料還在(DB.towns[townId].npcs 的 n/title/d/type),
    // 這裡重新用它建立單欄清單,重用原作全域 interactNPC()/openTownFloatWindow() 開對應功能視窗,
    // 完全不改動任何核心檔案。只在手機模式生效,桌機的地圖式 NPC 維持原樣不動。
    var _lastTownNpcSig = '';
    var TOWN_NPC_ICON = { shop: '💰', craft: '⚒️', skill: '📖', exchange: '⚖️', quest: '📜', pledge: '⚔️', ally: '🤝', bless: '✨', pray: '🙏', mastery: '🏅', castleguard: '🛡️', petstore: '🐾', travel: '⛵', synth: '🎴', warehouse: '🏦' };
    function townNpcRow(icon, name, title, desc, onClick) {
      var row = document.createElement('div');
      row.className = 'm-town-npc-row';
      row.innerHTML =
        '<span class="m-tnr-ic">' + icon + '</span>' +
        '<span class="m-tnr-txt">' +
          '<span class="m-tnr-nametitle"><b class="m-tnr-name">' + name + '</b><span class="m-tnr-title">[' + title + ']</span></span>' +
          '<span class="m-tnr-desc">' + (desc || '') + '</span>' +
        '</span>';
      row.addEventListener('click', onClick);
      return row;
    }
    function ensureTownNpcList() {
      // 只在原作已經上線「地圖式 NPC」(#town-npc-map 存在)時才接手;舊版原作自己的卡片清單
      // (#town-npc-container 預設可見、非 hidden)照原樣運作,不受這裡影響,避免還沒同步到新版前
      // 就先改掉目前正式站台既有的清單外觀。
      if (!document.getElementById('town-npc-map')) return;
      var container = document.getElementById('town-npc-container');
      if (!container) return;
      var townView = document.getElementById('town-view');
      var inTown = townView && !townView.classList.contains('hidden');
      if (!inTown || typeof mapState === 'undefined' || !mapState || !mapState.current || typeof DB === 'undefined') {
        if (container.innerHTML) container.innerHTML = '';
        _lastTownNpcSig = '';
        return;
      }
      var townId = mapState.current;
      var td = DB.towns && DB.towns[townId];
      if (!td || !td.npcs) { if (container.innerHTML) container.innerHTML = ''; _lastTownNpcSig = ''; return; }
      var sig = townId + '|' + (player.bloodPledge || '') + '|' + (player.cls || '') + '|' + (!!player.classicMode);
      if (sig === _lastTownNpcSig) return;   // 城鎮/血盟/職業/經典模式都沒變 → 不重建(避免每 300ms 洗掉使用者正在看的清單)
      _lastTownNpcSig = sig;
      container.innerHTML = '';
      td.npcs.filter(function (npc) {
        // 過濾條件對齊原作 renderTownNPCMap:三座攻城城堡只顯示玩家所屬血盟盟主、黑暗妖精限定、經典模式隱藏
        if (typeof SIEGE_CASTLES !== 'undefined' && SIEGE_CASTLES.indexOf(townId) >= 0) {
          if (npc.id === 'npc_esti' && player.bloodPledge !== 'esti') return false;
          if (npc.id === 'npc_tros' && player.bloodPledge !== 'tros') return false;
        }
        if (npc.darkOnly && player.cls !== 'dark') return false;
        if (npc.classicHide && player.classicMode) return false;
        return true;
      }).forEach(function (npc) {
        container.appendChild(townNpcRow(TOWN_NPC_ICON[npc.type] || '👤', npc.n, npc.title, npc.d, function () {
          if (typeof interactNPC === 'function') interactNPC(npc.id, townId);
        }));
      });
      // 傲慢之塔/時空裂痕入口:地圖版是點地圖上的告示 NPC 開浮動視窗,這裡補對應清單列
      if (townId === 'town_pride' && typeof renderPrideEntrance === 'function' && typeof openTownFloatWindow === 'function') {
        container.appendChild(townNpcRow('🗼', '傲慢之塔', '入口', '攀登傲慢之塔,或挑戰排名模式。', function () {
          openTownFloatWindow('傲慢之塔', '排名挑戰', renderPrideEntrance);
        }));
      }
      if (townId === 'town_rift' && typeof renderRiftEntrance === 'function' && typeof openTownFloatWindow === 'function') {
        container.appendChild(townNpcRow('🌀', '時空裂痕', '入口', '進入時空裂痕戰場。', function () {
          openTownFloatWindow('時空裂痕', '進入', renderRiftEntrance);
        }));
      }
      container.classList.remove('hidden');
    }

    // ---- 選角畫面(手機):素質表下方 8 顆存檔位按鈕(4個一排×兩排)---------------
    //   2026-07-12 使用者第三輪回饋:拿掉左右‹›逐格切換箭頭,改成一次列出全部 8 個存檔位、
    //   按鈕顯示角色名稱(空存檔顯示「空」),點哪顆就直接預覽哪一格。
    //   ⚠ 不能呼叫原作 loadSelectSlot(n)——它對「空存檔位」的行為是直接跳進創角流程
    //   (`if(!sum){...showCreation();return;}`,桌機上點空拱門格=開始創角,設計上如此)。
    //   這裡只是想「預覽」,不是要創角,所以改直接照抄 loadSetPage/loadSelectSlot 兩者
    //   「設定 _loadPage/_loadSelectedSlot 再呼叫 renderLoadSelect()」這段共同邏輯,
    //   跳過會觸發 showCreation() 的分支。真的要創角/進入該格,仍是按「創新角色/進入遊戲」鈕
    //   (呼叫 loadCreateSelected()/loadEnterSelected(),行為不受此影響)。
    function ensureLoadSelectSlotPicker() {
      var infoPanel = document.getElementById('load-info-panel');
      var actionPanel = document.getElementById('load-action-panel');
      var stage = document.getElementById('load-art-stage');
      if (!infoPanel || !actionPanel || !stage) return;
      var TOTAL = 8;
      var picker = document.getElementById('m-load-slotpicker');
      if (!picker) {
        picker = document.createElement('div');
        picker.id = 'm-load-slotpicker';
        for (var i = 1; i <= TOTAL; i++) {
          var b = document.createElement('button');
          b.type = 'button'; b.dataset.slot = i;
          b.addEventListener('click', function () { gotoLoadSlot(+this.dataset.slot); });
          picker.appendChild(b);
        }
        stage.insertBefore(picker, actionPanel);   // 固定夾在「素質表」跟「進入遊戲/創新角色…」之間
      }
      // 每次都刷新 8 顆按鈕的名稱/active 狀態(存檔資料、目前選中格都可能變動;8 顆很便宜,不特別做 diff)
      // 存檔位總數(8)沿用原作 loadSetPage 的固定假設;作者若改存檔格數,這裡要跟著調
      if (typeof slotSummary !== 'function' || typeof _loadSelectedSlot === 'undefined') return;
      var kids = picker.children;
      for (var j = 0; j < kids.length; j++) {
        var btn = kids[j], n = +btn.dataset.slot;
        var sum = slotSummary(n);
        btn.textContent = sum ? (sum.name || '未命名') : '空';
        btn.classList.toggle('active', n === _loadSelectedSlot);
      }
    }
    function gotoLoadSlot(n) {
      if (typeof _loadSelectedSlot === 'undefined' || typeof _loadPage === 'undefined' || typeof renderLoadSelect !== 'function') return;
      var PER_PAGE = 4;
      _loadPage = n <= PER_PAGE ? 0 : 1;
      _loadSelectedSlot = n;
      renderLoadSelect();
    }

    var mql = window.matchMedia(MQ);

    // 🔧 偵測手機:作者改版後新增 __mobileScaling,手機時把 viewport 設成固定 1180 等比縮放——這會讓
    //    純寬度的 matchMedia 判定失效(變成對 1180 比、永遠 >768),故優先用它的 isMobileDevice()
    //    (看 pointer:coarse / 螢幕短邊 / UA,不受 viewport 影響),再 OR 上 matchMedia(窄視窗也算)。
    function detectMobile() {
      var sc = window.__mobileScaling;
      var devMobile = (sc && typeof sc.isMobileDevice === 'function') ? sc.isMobileDevice() : false;
      return devMobile || mql.matches;
    }

    // 🚀 大背包戰鬥頓挫修正(手機):renderTabs 會「重建整個背包列」,戰鬥中每殺一隻就被呼叫一次(force=true)。
    //   背包大時每次重建很貴(實測 1000 件約 13ms,手機更久),而戰鬥畫面時背包是 display:none 看不到
    //   → 純白做工(display:none 只省『畫』,省不掉這段 JS 重建,已實測證實)。
    //   ① 背包沒開(非 mview-bag)→ 跳過重建、記 dirty;切到背包/設定頁時由 setView 補建一次。
    //   ② 背包開著(mview-bag)→ 短節流(leading+trailing,250ms):連續掉寶的多次重建併一次,
    //      自己的操作(賣/裝/用,不在連續掉寶窗內)立即重建、近即時。
    //   桌機(detectMobile=false)完全走原版、零改動。原作哪天改成「背包隱藏時不重建」這段即可移除。
    var _flushDeferredTabs = function () {};
    (function () {
      if (typeof window.renderTabs !== 'function' || window.renderTabs.__mBagDefer) return;
      var origRT = window.renderTabs;
      var THROTTLE_MS = 250, SELSEL = '#tab-weapons,#tab-armors,#tab-items,#tab-equip,#tab-skill,#item-modal';
      var dirty = false, dirtyForce = false, lastRun = -1e9, trail = null, flushing = false;   // dirtyForce(2026-07-09併入原加掛版作者新版):延後期間有沒有 force 呼叫——補跑只在真的有 force 被延後時才 force,免得掉寶的非強制重繪被升級成 force、繞過核心 renderTabs 的「快速廢品/強化選擇模式凍結」守衛
      function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
      function bagOpen() { return document.body.classList.contains('mview-bag'); }
      function selOpen() { var ae = document.activeElement; try { return !!(ae && ae.tagName === 'SELECT' && ae.closest && ae.closest(SELSEL)); } catch (e) { return false; } }
      function markDirty(force) { dirty = true; dirtyForce = dirtyForce || !!force; }
      // 2026-07-08(手機背包點擊不順+批次販賣按鈕閃爍回報):補跑一律 force=true 呼叫,原本直接呼叫
      // 閉包裡的 origRT,兩個副作用都要修:
      //   ① force=true 繞過原生 js/10-ui-tabs.js renderTabs() 自己的「使用者正按著面板時延後重建」
      //      保護(那道保護只在 !force 才生效),手指按在格子上時仍可能被整批換掉、點擊落空。
      //   ② 若後面又有別的外掛(如 afk-batch-sell.js)monkey-patch window.renderTabs,直接呼叫
      //      origRT 會整個繞過那層 wrapper,牠補插的按鈕(批次販賣入口)就會在這次補跑後消失,
      //      要等下一次「非節流、走完整鏈」的呼叫才補回來 → 視覺上是按鈕一閃一閃。
      // 改法:① 補跑改用 dirtyForce 追蹤的實際值(見上,2026-07-09 併入原加掛版作者新版的修法,
      //         取代先前「一律不強制」的寫法——延後期間若真的曾有 force 呼叫,補跑要照實傳遞);
      //      ② 補跑改呼叫目前最外層的 window.renderTabs(可能已被其他外掛再包一層),用 flushing
      //         旗標避免遞迴重新套用節流判斷,讓外層 wrapper 的收尾邏輯(如補插按鈕)照樣跑得到。
      function schedTrail(delay) { if (!trail) trail = setTimeout(function () { trail = null; if (dirty) { var f = dirtyForce; run(f ? [true] : []); } }, delay); }
      function run(args) {
        if (selOpen()) { markDirty(args && args[0]); schedTrail(200); return; }   // 下拉開著時不重建(會把它關掉)→ 比照 afk-fixes select-guard,延後
        dirty = false; dirtyForce = false; lastRun = now();
        flushing = true;
        try { return window.renderTabs.apply(window, args || [true]); }
        finally { flushing = false; }
      }
      var wrapped = function () {
        // 2026-07-08(效能稽核):state.ff(快轉/離線補跑)期間直接透傳給原生 renderTabs
        // (它自己會因 state.ff 早退),省掉 detectMobile()/bagOpen() 這些檢查,跟其他外掛
        // (afk-toast/afk-autobuy)的快速通道一致。
        if (typeof state !== 'undefined' && state && state.ff) return origRT.apply(this, arguments);
        if (!detectMobile()) return origRT.apply(this, arguments);
        if (flushing) return origRT.apply(this, arguments);         // run() 為了觸發完整 wrapper 鏈重新呼叫進來,直接做真正的渲染,不要再套一次節流判斷
        if (!bagOpen()) { markDirty(arguments[0]); return; }        // 戰鬥/設定畫面看不到背包 → 跳過,記 dirty(含是否 force)
        var t = now();
        if (t - lastRun >= THROTTLE_MS) return run(arguments);     // 節流窗外 → 立即(自己的操作即時)
        markDirty(arguments[0]); schedTrail(THROTTLE_MS - (t - lastRun));     // 窗內(連續掉寶)→ 併入 trailing
      };
      wrapped.__mBagDefer = true;
      window.renderTabs = wrapped;
      _flushDeferredTabs = function (toBattle) {
        if (toBattle) { if (trail) { clearTimeout(trail); trail = null; } return; }   // 進戰鬥畫面:取消待補(留 dirty,下次開背包再補),不重建看不到的東西
        if (dirty) { if (trail) { clearTimeout(trail); trail = null; } run(dirtyForce ? [true] : []); }  // 切到背包/設定:立刻補最新一份(照實傳遞 force)
      };
    })();

    function setView(v) {
      document.body.classList.remove('mview-battle', 'mview-config', 'mview-bag');
      document.body.classList.add('mview-' + v);
      try { _flushDeferredTabs(v === 'battle'); } catch (e) {}   // 離開戰鬥→補建延後的背包;進戰鬥→取消待補(見上方修正)
      var kids = nav.children;
      for (var i = 0; i < kids.length; i++) {
        kids[i].classList.toggle('m-active', kids[i].getAttribute('data-v') === v);
      }
      closeLog();   // 切換下方選單時一併關閉浮動日誌
    }

    function setLog(v) {
      document.body.classList.remove('mlog-combat', 'mlog-sys');
      document.body.classList.add('mlog-' + v);
    }
    function updateLogNavActive(on) { var b = nav.querySelector('[data-nav="log"]'); if (b) b.classList.toggle('m-active', !!on); }
    function openLog() { document.body.classList.add('mlog-open'); updateLogNavActive(true); }
    function closeLog() { document.body.classList.remove('mlog-open'); updateLogNavActive(false); }
    function toggleLog() { if (document.body.classList.contains('mlog-open')) closeLog(); else openLog(); }

    function apply(on) {
      if (on) {
        var sc = window.__mobileScaling;
        if (sc && typeof sc.apply === 'function') sc.apply(false);   // 🔧 關掉作者「viewport 1180 等比縮放」→ 回 device-width,本外掛自建版面才正確(否則 100vw=1180、版面爆開)
        document.body.classList.add('m-mobile');
        logsIntoSheet();
        if (!/mview-(battle|config|bag)/.test(document.body.className)) setView('battle');
        if (!/mlog-(combat|sys)/.test(document.body.className)) setLog('combat');
        mirror();
      } else {
        document.body.classList.remove('m-mobile');
        document.body.classList.remove('mlog-open');
        logsToColumn();
        // 2026-07-13:切回桌機時把手機版拱門疊圖節點一併清掉,不要留著等下次意外現形
        // (見上方 CSS `body.m-mobile #m-load-arch-overlay` 註解)。
        var arch = document.getElementById('m-load-arch-overlay');
        if (arch) arch.remove();
      }
      // 桌機↔手機切換時立刻重算一次魔法娃娃游標狀態(見上方 wrapApplyDollCursorForMobile),
      // 避免「切手機前已裝娃娃」殘留 has-doll-cursor、或「切回桌機」沒恢復游標特效。
      if (typeof window.applyDollCursor === 'function') { try { window.applyDollCursor(); } catch (e) {} }
    }

    apply(detectMobile());
    function onMobileChange() { apply(detectMobile()); }
    if (mql.addEventListener) mql.addEventListener('change', onMobileChange);
    else if (mql.addListener) mql.addListener(onMobileChange);
    window.addEventListener('orientationchange', onMobileChange);   // 裝置旋轉也重新判定

    window.__afkm = { version: '1.0.0', apply: apply, setView: setView, setLog: setLog, openLog: openLog, closeLog: closeLog, toggleLog: toggleLog, isMobile: detectMobile };

    console.log('[AFK-mobile] hooks OK — 手機版面已啟用(目前:' + (detectMobile() ? '手機' : '桌機') + ')。');

    // --- 精簡一行式狀態列 --------------------------------------------------
    function buildStatusStrip() {
      var d = document.createElement('div');
      d.id = 'm-status';
      d.innerHTML =
        // 第一列:暱稱 / 等級 / 防 / 魔防 / 金幣(王冠與ⓘ移到第二列,避免暱稱+金幣太長把這列擠爆)
        '<div class="ms-row ms-row1">' +
          '<span class="ms-seg ms-name"><b id="ms-name">--</b></span>' +
          '<span class="ms-seg ms-lv">Lv <b id="ms-lv">--</b></span>' +
          '<span class="ms-seg ms-ac">防 <b id="ms-ac">--</b></span>' +
          '<span class="ms-seg ms-mr">魔防 <b id="ms-mr">--</b></span>' +
          '<span class="ms-seg ms-gold">💰 <span id="ms-gold">--</span></span>' +
        '</div>' +
        // 第二列:HP / MP 雙血條 + 攻城獲勝皇冠 + ⓘ提示(血條 flex 自動讓出空間給右邊兩顆)
        '<div class="ms-row ms-row2">' +
          '<div class="ms-bar ms-hp"><i class="ms-bar-fill" id="ms-hp-bar"></i><span class="ms-bar-txt"><b>HP</b> <span id="ms-hp">--</span></span></div>' +
          '<div class="ms-bar ms-mp"><i class="ms-bar-fill" id="ms-mp-bar"></i><span class="ms-bar-txt"><b>MP</b> <span id="ms-mp">--</span></span></div>' +
          '<span class="ms-seg ms-victory" id="ms-victory" title="攻城獲勝期間:全商店8折、開放城堡" style="display:none">👑</span>' +   // 攻城獲勝才顯示(mirror 切換)
          '<span class="ms-seg ms-info">ⓘ</span>' +    // 提示:整條可點 → 開角色資訊彈窗
        '</div>' +
        '<div id="ms-exp"></div>';
      return d;
    }

    // --- 底部導覽列(第 4 顆「日誌」切換浮動面板)----------------------------
    function buildNav() {
      var n = document.createElement('div');
      n.id = 'm-nav';
      [['battle', '⚔️', '戰鬥', 'view'], ['config', '👥', '隊伍', 'view'], ['bag', '🎒', '背包', 'view'], ['log', '📜', '日誌', 'log'], ['logout', '🚪', '登出', 'logout']].forEach(function (it) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('data-nav', it[0]);
        b.innerHTML = '<span style="font-size:20px;line-height:1">' + it[1] + '</span><span style="font-size:11px;line-height:1.2">' + it[2] + '</span>';
        if (it[3] === 'view') { b.setAttribute('data-v', it[0]); b.addEventListener('click', function () { setView(it[0]); }); }
        else if (it[3] === 'logout') { b.addEventListener('click', doLogout); }
        else { b.addEventListener('click', function () { toggleLog(); }); }
        n.appendChild(b);
      });
      return n;
    }

    // --- 底部浮動日誌面板(只有內容容器;切換/關閉做成小鈕注入原本的 panel 標題列)------
    function buildLogSheet() {
      var sheet = document.createElement('div');
      sheet.id = 'm-log-sheet';
      var body = document.createElement('div');
      body.id = 'm-log-body';
      sheet.appendChild(body);
      return sheet;
    }

    // 把「⇆ 切換 / ✕ 關閉」兩顆小鈕注入原本的日誌標題列(整合進原列,不再另開一排)。
    // otherType:點 ⇆ 要切到的另一種日誌(看戰鬥就切系統,反之亦然)。
    function decorateLogHeader(panel, otherType) {
      var hdr = panel.querySelector('.panel-header');
      if (!hdr || hdr.querySelector('.m-log-ctrls')) return;
      hdr.classList.add('m-log-hdr');
      var ctrls = document.createElement('span');
      ctrls.className = 'm-log-ctrls';
      var sw = document.createElement('button');
      sw.type = 'button'; sw.className = 'm-log-sw'; sw.textContent = '⇆'; sw.title = '切換戰鬥/系統日誌';
      // 村莊(mlog-nocombat)時戰鬥日誌不存在 → 不給切
      sw.addEventListener('click', function (e) { e.stopPropagation(); if (document.body.classList.contains('mlog-nocombat')) return; setLog(otherType); });
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'm-log-x'; x.textContent = '✕'; x.title = '關閉';
      x.addEventListener('click', function (e) { e.stopPropagation(); closeLog(); });
      ctrls.appendChild(sw); ctrls.appendChild(x);
      hdr.appendChild(ctrls);
    }
  }

  // --- 角色資訊彈窗:桌面左上的 #status-panel(等級/AC/MR/金幣/HP·MP·EXP + 可點改名的職業列)
  //   在手機被隱藏 → 點暱稱把它「移進」彈窗顯示(移動而非複製,資料才會即時更新);✕/點背景關閉、移回原欄。
  //   名字仍可在彈窗內點 st-class 用遊戲原生 startEditName 修改,不另作取名 UI。
  function buildStatModal() {
    var m = document.createElement('div');
    m.id = 'm-stat-modal';
    var card = document.createElement('div');
    card.id = 'm-stat-card';
    var bar = document.createElement('div');
    bar.id = 'm-stat-bar';
    var x = document.createElement('button');
    x.type = 'button'; x.id = 'm-stat-close'; x.textContent = '✕'; x.title = '關閉';
    x.addEventListener('click', function (e) { e.stopPropagation(); closeStatModal(); });
    bar.appendChild(x);
    var body = document.createElement('div');
    body.id = 'm-stat-body';
    card.appendChild(bar); card.appendChild(body);
    m.appendChild(card);
    m.addEventListener('click', function () { closeStatModal(); });           // 點背景關閉
    card.addEventListener('click', function (e) { e.stopPropagation(); });     // 點卡片內不關
    return m;
  }
  function openStatModal() {
    var sp = document.getElementById('status-panel');
    var body = document.getElementById('m-stat-body');
    if (!sp || !body) return;
    body.appendChild(sp);                          // 把資訊塊移進彈窗
    document.body.classList.add('m-stat-open');
  }
  function closeStatModal() {
    document.body.classList.remove('m-stat-open');
    var sp = document.getElementById('status-panel');
    var col = document.querySelector('.m-col-left');   // 左欄(init 給它加了 m-col-left);此函式在 IIFE 層拿不到 init 的 colLeft
    if (sp && col) col.insertBefore(sp, col.firstChild);   // 移回左欄原位(手機仍隱藏)
  }

  // --- 登出回首頁:跳「自製」確認視窗(不用原生 confirm:iOS Safari 會抑制原生彈窗導致按了沒反應) ---
  //   按確定 → 先存檔(補上原作每 5 分一次自動存檔的空窗,登出無損)、再記離線錨點(時間+當前狩獵地圖,手機 beforeunload 常不觸發,故主動 stamp),最後 reload 回首頁。
  function doLogout() {
    var m = document.getElementById('m-logout-modal') || buildLogoutModal();
    m.classList.add('open');
  }
  function buildLogoutModal() {
    var m = document.createElement('div');
    m.id = 'm-logout-modal';
    m.innerHTML =
      '<div id="m-logout-card">' +
        '<div id="m-logout-msg">回首頁前會<b>自動幫你存檔</b>，進度不會遺失。<br>登出後會開始離線掛機（上限 24 小時）。<br>確定回首頁？</div>' +
        '<div id="m-logout-btns">' +
          '<button id="m-logout-cancel" type="button">取消</button>' +
          '<button id="m-logout-ok" type="button">確定回首頁</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    function close() { m.classList.remove('open'); }
    m.addEventListener('click', function (e) { if (e.target === m) close(); });   // 點背景關閉
    m.querySelector('#m-logout-cancel').addEventListener('click', close);
    m.querySelector('#m-logout-ok').addEventListener('click', function () {
      window.__afkLoggingOut = true;   // 告知 afk-fixes 的關閉前存檔別重存:本流程已存過,reload 觸發的 beforeunload/pagehide 不必再存(否則手機 toast 會跳兩次)
      try { if (typeof window.saveGame === 'function') window.saveGame(); } catch (e) {}   // 先存當前進度,避免漏掉上次自動存檔後的收益
      try { if (window.__afk && window.__afk.stamp) window.__afk.stamp(); } catch (e) {}   // 存完再蓋錨點 → 存檔時間=離線起算時間,離線結算不會漏算/重算
      showLogoutOverlay();   // 立刻蓋全螢幕遮罩:reload 是整頁重開機(手機要幾秒),期間舊頁仍在跑戰鬥,不蓋住會看起來像「還在打怪」
      // 跨裝置雲端同步(afk-cloud-sync.js)若已載入且已登入,在真的 reload 前給它一次強制同步
      // 的機會(有自己的短逾時,不會卡住登出流程太久)——玩家主動離開時上傳，另一台裝置才不會
      // 讀到舊進度(2026-07-09 使用者要求登出/關閉前要有機會先同步)。外掛不存在時直接跳過。
      var cloudSync = (window.AFK_CLOUD && AFK_CLOUD.flow && typeof AFK_CLOUD.flow.forceSyncBeforeLeave === 'function')
        ? AFK_CLOUD.flow.forceSyncBeforeLeave().catch(function () {}) : Promise.resolve();
      // double rAF:確保遮罩先畫出來(rAF 在繪製前觸發,巢狀第二個在首次繪製後),再開始 reload
      cloudSync.then(function () {
        requestAnimationFrame(function () { requestAnimationFrame(function () { try { location.reload(); } catch (e) {} }); });
      });
    });
    return m;
  }
  // 登出遮罩:蓋在最上層(z-index 高過登出視窗/toast),純視覺,讓重開機那幾秒看到「回首頁中」而非殘留的戰鬥畫面。
  function showLogoutOverlay() {
    if (document.getElementById('m-logout-overlay')) return;
    var o = document.createElement('div');
    o.id = 'm-logout-overlay';
    o.innerHTML = '<div id="m-logout-overlay-spin"></div><div id="m-logout-overlay-txt">已自動存檔，正在回首頁…</div>';
    document.body.appendChild(o);
  }

  // --- 匯入存檔:手機版改用「自製」確認視窗取代原生 confirm/alert ---------------
  //   背景(2026-07-13 使用者回報):手機版第一次匯入成功,第二次以後按「匯入進度」選完檔案就
  //   完全沒反應,連確認視窗都不跳。跟登出鈕當年踩的坑同一種(見上方 doLogout 註解):iOS Safari
  //   在某些情況下會悄悄抑制原生 confirm()/alert(),導致「按了沒反應」。core 的 importSave() 內建
  //   4 段 confirm()(未簽章警告/覆蓋確認/還原倉庫/還原寵物),原地全部走一次原生對話框。
  //   做法:比照 doLogout,自己畫一個「取消/確定」卡片當 confirm 的替代品(Promise 化,支援 await
  //   依序詢問);importSave 本身邏輯照抄一份(不能改 js/13-shop-save.js),只把 confirm() 換成這個
  //   自製版、alert() 換成全域已接管的 window.alert(afk-ui.js,同樣走自製彈窗、不受影響)。
  //   只在手機生效,桌機仍用原作 importSave(原生 confirm 桌機沒有這個抑制問題)。
  function mConfirmModal(message) {
    return new Promise(function (resolve) {
      var m = document.createElement('div');
      m.id = 'm-import-confirm';
      var msgHtml = String(message).split('\n').map(function (line) {
        return line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }).join('<br>');
      m.innerHTML =
        '<div id="m-import-confirm-card">' +
          '<div id="m-import-confirm-msg">' + msgHtml + '</div>' +
          '<div id="m-import-confirm-btns">' +
            '<button type="button" id="m-import-confirm-cancel">取消</button>' +
            '<button type="button" id="m-import-confirm-ok">確定</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(m);
      function close(result) { m.remove(); resolve(result); }
      m.addEventListener('click', function (e) { if (e.target === m) close(false); });
      m.querySelector('#m-import-confirm-cancel').addEventListener('click', function () { close(false); });
      m.querySelector('#m-import-confirm-ok').addEventListener('click', function () { close(true); });
    });
  }
  // 照抄 js/13-shop-save.js importSave() 的邏輯(核心不可改),把每個 confirm() 換成上面的自製視窗、
  // 用 async/await 依序詢問。用到的存檔輔助函式(_saveUnwrap/_lsGet/_lzSet/_lzSetStoredRaw/_saveWrap/
  // whKey/PET_ROSTER_KEY/modeSuffix/slotSummary/renderLoadSelect/openSlotSelect/_slotMode)都是原作
  // 已暴露的全域,沿用同一套、不重寫存檔格式。
  // 2026-07-13 使用者實機回報:同一個畫面連續按第二次「匯入進度」,iOS 選檔器只閃一下
  // 「正在準備檔案…」就自動跳掉,完全打不開檔案清單(第一次沒事)。原本(跟核心 importSave 同款
  // 寫法)每次呼叫都 `document.createElement('input')` 生一個全新、從沒接進 DOM 的 <input>,
  // 用完即丟——iOS Safari 對「從沒進過 DOM、用過即丟」的檔案輸入框,連續換新元素觸發原生選檔器
  // 似乎有節流/防濫用機制，第二個全新元素就可能被悄悄擋下來。改成整個外掛只建立一次、
  // 固定接在 <body> 下面(display:none)的同一個 <input>，每次呼叫只是換掉 onchange 內容
  // 並清空 value 再 .click()，跟原生瀏覽器分頁裡「一個固定的匯入按鈕」用起來完全一樣。
  var _mImportInput = null;
  function getMobileImportInput() {
    if (_mImportInput && document.body.contains(_mImportInput)) return _mImportInput;
    var el = document.createElement('input');
    el.type = 'file';
    el.accept = '.json,application/json';
    el.style.display = 'none';
    document.body.appendChild(el);
    _mImportInput = el;
    return el;
  }
  function mobileImportSave(n) {
    var input = getMobileImportInput();
    input.value = '';   // 清空,確保連續選同一個檔案也會觸發 change
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      // 2026-07-13 使用者實機回報:iOS 選檔後卡在系統「正在準備檔案…」就自動跳掉、什麼都沒發生。
      // 追到 core 原本的 reader 就沒掛 onerror(見 js/13-shop-save.js 同一段)——如果讀檔失敗
      // (常見於從 iCloud/雲端來源選檔,系統要先下載,連線不穩或逾時就會讀檔失敗)，原本的寫法會
      // 整個無聲無息地什麼都不做，玩家只會看到「跳掉」。這裡補上失敗提示 + 外層 try/catch，
      // 讓失敗至少會跳自製彈窗說明，不會像原本一樣完全沒反應。
      reader.onerror = function () {
        window.alert('匯入失敗：讀取檔案時發生錯誤（若檔案存放在 iCloud/雲端，請確認網路連線穩定，或先在「檔案」App 內下載到裝置後再選取）。');
      };
      reader.onload = function () {
        (async function () {
          try {
          var _raw = String(reader.result || '');
          var _u = _saveUnwrap(_raw);
          if (_u.signed && !_u.ok) { window.alert('匯入失敗：檔案完整性校驗未通過，可能已被竄改。'); return; }
          if (!_u.signed) {
            var okUnsigned = await mConfirmModal('此存檔檔案沒有完整性簽章（可能來自舊版本，或被外部修改/移除簽章）。\n仍要匯入嗎？');
            if (!okUnsigned) return;
          }
          var text = _u.payload;
          var d;
          try { d = JSON.parse(text); }
          catch (e) { window.alert('匯入失敗：檔案不是有效的存檔（JSON 解析錯誤）。'); return; }
          if (!d || typeof d !== 'object' || !d.p || typeof d.p !== 'object' || !d.p.cls) {
            window.alert('匯入失敗：檔案內容不是有效的放置天堂存檔。'); return;
          }
          var existing = slotSummary(n);
          if (existing) {
            var okOverwrite = await mConfirmModal('存檔 ' + n + ' 已有角色（' + existing.cls + ' Lv.' + existing.lv + ' ' + existing.name + '）。\n確定要用匯入的存檔「取代」它嗎？\n（原存檔會自動備份，可於載入畫面點「復原備份」還原）');
            if (!okOverwrite) return;
          }
          var whData = d.wh;
          var petData = d.pets;
          var saveText = text;
          if (whData !== undefined || petData !== undefined) {
            var _c = {};
            for (var k in d) { if (k !== 'wh' && k !== 'pets') _c[k] = d[k]; }
            saveText = JSON.stringify(_c);
          }
          var cur = _lsGet('lineage_idle_save_' + n);
          if (cur) _lzSetStoredRaw('lineage_idle_save_' + n + '_bak', cur);
          _lzSet('lineage_idle_save_' + n, _saveWrap(saveText));
          var whMsg = '';
          if (whData !== undefined) {
            var _cnt = (whData.items && whData.items.length) || 0;
            var _gold = whData.gold || 0;
            var okWh = await mConfirmModal('此匯入檔包含倉庫資料（物品 ' + _cnt + ' 項、金幣 ' + _gold.toLocaleString() + '）。\n是否一併還原倉庫？\n⚠ 會覆蓋該角色所屬模式（' + ((d.p && d.p.classicMode) ? '經典' : '非經典') + '）的共用倉庫。');
            if (okWh) {
              _lzSet(whKey(d.p), JSON.stringify({ items: whData.items || [], gold: whData.gold || 0 }));
              whMsg = '\n倉庫已一併還原。';
            } else {
              whMsg = '\n（倉庫維持原狀，未還原）';
            }
          }
          var petMsg = '';
          if (petData !== undefined && Array.isArray(petData) && petData.length) {
            var okPet = await mConfirmModal('此匯入檔包含寵物名冊（' + petData.length + ' 隻）。\n是否一併還原寵物？\n⚠ 會覆蓋該角色所屬模式（' + ((d.p && d.p.classicMode) ? '經典' : '非經典') + '）的共用寵物名冊。');
            if (okPet) {
              var _petKey = (typeof PET_ROSTER_KEY !== 'undefined' ? PET_ROSTER_KEY : 'fb5_pet_roster') + (typeof modeSuffix === 'function' ? modeSuffix(!!(d.p && d.p.classicMode), false) : '');
              _lzSet(_petKey, _saveWrap(JSON.stringify(petData)));
              // ⚠ core 記憶體快取 _petRosterKey 是模組內 let 變數,外部摸不到、重置不了;
              // 若匯入的角色跟目前快取剛好同模式,寵物名冊要等下次自然切換模式才會重讀最新內容,
              // 不影響這裡寫入 localStorage 的存檔資料本身正確性。
              petMsg = '\n寵物名冊已一併還原。';
            } else {
              petMsg = '\n（寵物名冊維持原狀，未還原）';
            }
          }
          if (typeof _slotMode !== 'undefined' && _slotMode === 'load-grid') { if (typeof renderLoadSelect === 'function') renderLoadSelect(); }
          else if (typeof openSlotSelect === 'function') openSlotSelect(_slotMode);
          var ns = slotSummary(n);
          window.alert('已匯入到存檔 ' + n + '：' + (ns ? (ns.cls + ' Lv.' + ns.lv + '　' + ns.name) : '完成') + '。' + (cur ? '\n（原存檔已自動備份，可點「復原備份」還原）' : '') + whMsg + petMsg);
          } catch (err) {
            window.alert('匯入失敗：處理存檔時發生未預期的錯誤（' + (err && err.message ? err.message : err) + '）。');
          }
        })();
      };
      reader.readAsText(file);
    };
    input.click();
  }
  (function installMobileImportSave() {
    if (typeof window.importSave !== 'function') return;   // 原作若改版拿掉/改名 importSave,靜靜跳過、桌機手機都退回不存在此鈕(不會壞)
    var coreImportSave = window.importSave;
    window.importSave = function (n) {
      if (document.body.classList.contains('m-mobile')) { mobileImportSave(n); return; }
      return coreImportSave.apply(this, arguments);
    };
  })();

  // --- 手機戰鬥畫面:怪物下方的「手動喝水列」 -------------------------------
  //   每列排版:[藥水圖示][數量][按鈕]。藥水列喝設定裡選的治癒藥水(set-pot:紅/橙/白),
  //   沒貨依紅→橙→白往下找;背包有安特的水果時自動多一列(食用)。
  //   全走遊戲原生 useItem(uid, false) → 由它處理回血/消耗/CD/UI 刷新(手動=寫日誌、吃 1 秒共用冷卻)。
  function buildHealBar() {
    var bar = document.createElement('div');
    bar.id = 'm-heal-bar';
    bar.appendChild(buildScrollToggles());   // 左側:鏡射自動化設定的「魔法卷軸/瞬移卷軸」兩個勾選
    var rows = document.createElement('div');
    rows.className = 'm-heal-rows';
    rows.appendChild(makeHealRow('pot'));
    rows.appendChild(makeHealRow('fruit'));
    bar.appendChild(rows);
    return bar;
  }
  // 手動喝水列左側的兩個 checkbox,直接鏡射自動化設定面板的 set-magicbarrier / set-teleport:
  //   勾選 → 把對應的設定 checkbox 設成同值(遊戲每 tick 直接讀 .checked,故不必另發事件);
  //   反向同步(從設定面板改動)由 updateHealBar 每 300ms 回填。
  function buildScrollToggles() {
    var wrap = document.createElement('div');
    wrap.className = 'm-scroll-toggles';
    wrap.appendChild(makeScrollToggle('set-magicbarrier', '魔法卷軸(魔法屏障)', 'text-cyan-300'));
    wrap.appendChild(makeScrollToggle('set-teleport', '瞬間移動卷軸(遇BOSS)', 'text-sky-300'));
    return wrap;
  }
  function makeScrollToggle(targetId, label, colorClass) {
    var lab = document.createElement('label');
    lab.className = 'm-scroll-tog';
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.className = 'm-scroll-cb'; cb.setAttribute('data-target', targetId);
    cb.addEventListener('change', function () {
      var t = document.getElementById(targetId);
      if (t && t.checked !== cb.checked) t.checked = cb.checked;
    });
    var span = document.createElement('span');
    span.className = 'm-scroll-lab ' + colorClass;
    span.textContent = label;
    lab.appendChild(cb); lab.appendChild(span);
    return lab;
  }
  function makeHealRow(kind) {
    var row = document.createElement('div');
    row.className = 'm-heal-row m-heal-' + kind;
    var img = document.createElement('img');
    img.className = 'm-heal-ic'; img.alt = '';
    var cnt = document.createElement('span');
    cnt.className = 'm-heal-cnt';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'm-heal-go' + (kind === 'fruit' ? ' m-fruit-go' : '');
    btn.textContent = kind === 'fruit' ? '食用' : '喝水';
    bindHoldRepeat(btn, kind === 'fruit' ? eatFruit : manualDrink, kind === 'fruit' ? hasFruit : function () { return !!pickHealPot(); });
    row.appendChild(img); row.appendChild(cnt); row.appendChild(btn);
    return row;
  }
  // 按住連續補血:手機長按「喝水/食用」→ 依藥水冷卻(player.cds.pot,1 秒)節奏反覆喝;放開即停。
  //   沒貨就停(不狂洗「沒有可用」log);按下立即喝一次→快速點一下仍等同單抽。冷卻/補血/消耗仍由原作 useItem 負責。
  function bindHoldRepeat(btn, doHeal, canHeal) {
    var timer = null;
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function tick() {
      if (typeof player === 'undefined' || !player) { stop(); return; }
      if (!canHeal()) { stop(); return; }              // 沒藥水/水果→停,避免每輪洗 log
      if (player.cds && player.cds.pot > 0) return;     // 冷卻中→這輪略過,等冷卻好再喝
      doHeal();
    }
    function start(e) { if (e) e.preventDefault(); stop(); tick(); timer = setInterval(tick, 150); }
    btn.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { btn.addEventListener(ev, stop); });
  }
  function hasFruit() {
    return (typeof player !== 'undefined' && player && player.inv) ? player.inv.some(function (x) { return x.id === 'new_item_141' && (x.cnt || 0) > 0; }) : false;
  }
  // 找出「這次手動喝水實際會喝的那瓶」:優先設定選的,其次紅→橙→白,都沒貨回 null。
  function pickHealPot() {
    if (typeof player === 'undefined' || !player || !player.inv) return null;
    var sel = document.getElementById('set-pot');
    var ids = [];
    if (sel && sel.value) ids.push(sel.value);
    ['potion_heal', 'potion_strong', 'potion_ult'].forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    for (var i = 0; i < ids.length; i++) {
      var it = player.inv.find(function (x) { return x.id === ids[i]; });
      if (it && (it.cnt || 0) > 0) return it;
    }
    return null;
  }
  function manualDrink() {
    if (typeof useItem !== 'function') return;
    var pot = pickHealPot();
    if (!pot) { if (typeof logSys === 'function') logSys('沒有可用的治癒藥水。'); return; }
    useItem(pot.uid, false);   // false=手動:回血+消耗+寫日誌,並受 player.cds.pot(1 秒)限制
  }
  function eatFruit() {
    if (typeof useItem !== 'function') return;
    var f = (typeof player !== 'undefined' && player && player.inv) ? player.inv.find(function (x) { return x.id === 'new_item_141' && (x.cnt || 0) > 0; }) : null;
    if (!f) { if (typeof logSys === 'function') logSys('沒有安特的水果。'); return; }
    useItem(f.uid, false);   // 安特的水果:恢復 44~107 HP,同樣吃 1 秒共用冷卻
  }

  // ⚠️ 2026-07-11 三畫面改版後 tagCreationPanel() 已移除:原作新版 #creation-panel 改成
  // position:absolute + 全部子層用 % / clamp() 定位(4:3 藝術舞台，跟 #load-select-panel 同一套設計),
  // 不再是 flex-row 巢狀結構,不需要也不能再靠「標記第 N 個子層」手動改版面——% 定位本身天生就會
  // 隨容器縮放,舊版那套 m-cre-avatar/m-cre-row/m-cre-classbox 標記 class 與對應 CSS 已一併移除
  // (見下方 CSS 陣列)。若之後作者又把創角面板改回 flex 版面,才需要重新評估要不要恢復這類手動標記。

  // --- 把「實際可視高度」(已扣掉手機瀏覽器上下工具列)寫進 --app-h --------------
  //   100vh 在手機是「工具列收起時」的高度,比當下可視區高 → 底部 nav 被頂到工具列底下看不到。
  //   優先用 visualViewport.height:它是「真正看得到的那塊」高度,會扣掉像 Brave 那種
  //   常駐在內容上的底部工具列,比 innerHeight / 100dvh 都可靠;不支援時退回 innerHeight。
  //   刻意不開 viewport-fit=cover:開了畫面會畫到系統列底下,高度變成全螢幕、nav 反而又被
  //   工具列蓋住,頂部還會多一塊留白。維持預設讓瀏覽器自動避開系統列。
  function trackAppHeight() {
    var vv = window.visualViewport;
    var focused = false;   // 2026-07-08(待辦問題2):輸入框聚焦中(軟鍵盤跳出/收起)凍結量測,見下方 focusin/focusout
    function isTextInput(t) {
      if (!t || !t.tagName) return false;
      if (t.tagName === 'TEXTAREA') return true;
      if (t.tagName !== 'INPUT') return false;
      var type = (t.getAttribute('type') || 'text').toLowerCase();
      return ['text', 'number', 'search', 'tel', 'email', 'password', 'url'].indexOf(type) !== -1;
    }
    function set() {
      if (focused) return;   // 鍵盤彈出/收起也會觸發 visualViewport resize,跟真正旋轉/工具列伸縮一視同仁會導致 fixed 定位的 #game-screen 高度跟著鍵盤跳動,聚焦中一律不套用
      var h = (vv && vv.height) ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
    }
    document.addEventListener('focusin', function (e) { if (isTextInput(e.target)) focused = true; }, true);
    document.addEventListener('focusout', function (e) {
      if (!isTextInput(e.target)) return;
      focused = false;
      setTimeout(set, 60);   // 鍵盤收起後可視高度會變回來,blur 後補量一次同步(60ms 讓鍵盤收起動畫先完成)
    }, true);
    set();
    window.addEventListener('resize', set);
    window.addEventListener('orientationchange', function () { setTimeout(set, 250); });
    if (vv) vv.addEventListener('resize', set);
  }

  // --- 注入手機版 CSS(全部掛在 body.m-mobile 之下)--------------------------
  function injectCSS() {
    if (document.getElementById('m-style')) return;
    var css = [
      '#m-nav{display:none;}',

      /* 原作者後來自己加了一套原生手機支援(index.html 的 @media max-width:820px:置頂 #mobile-vitals
         血條列 + 把幾個面板壓成 flex:none 固定高)。那套和本外掛「單欄輪播 + 底部導覽」版面重疊衝突,
         於 m-mobile 下蓋回。scope 在 body.m-mobile #id,比原作者 #id 規則更specific 即可勝出;
         原作者哪天移除這些規則,選擇器不命中就自動失效(不會弄壞)。 */
      'body.m-mobile #mobile-vitals{display:none !important;}',   /* 原生置頂 HP/MP 細條 → 與本外掛 #m-status 重複(雙血條),隱藏 */
      // 2026-07-13 使用者回報:背包分頁「能力/裝備/技能…」12 顆分頁按鈕列上方留一截空白、且往下
      // 蓋到武器/防具/道具分頁的「快速強化/快速廢品/批次販賣」列。根因:原作 css/style.css 在
      // `#col-right > .tab-bar{position:sticky;top:62px}` 幫這排按鈕做手機吸頂,62px 是原作自己
      // 的原生狀態列(#mobile-vitals)高度——但 #mobile-vitals 被我們隱藏、改用自己的 #m-status,
      // 兩者高度對不上,吸頂的偏移量算出來的位置比實際版面低了一截，才會空一段又蓋到下面。
      // 這裡不需要吸頂效果(#m-status 本來就固定在最上方看得到目前分頁),直接關掉 sticky。
      'body.m-mobile #col-right > .tab-bar{position:static !important;top:auto !important;}',
      'body.m-mobile #tab-content-panel{flex:1 1 auto !important;height:auto !important;min-height:0 !important;}',   /* 背包欄:原生 height:70vh 害底部留空 → 還原撐滿 */
      'body.m-mobile #automation-panel{flex:1 1 auto !important;}',   /* 設定欄:原生 flex:none 害填不滿 → 還原撐滿 */
      'body.m-mobile #automation-panel > div:last-child{max-height:none !important;}',   /* 解除原生 220px 內捲上限,讓內容隨欄高自然捲動 */

      /* 設定頁改「整欄單一捲動」:左欄由上到下是 角色狀態→傭兵隊伍面板→自動化設定。原本左欄 overflow:hidden、
         只靠自動化設定自己內部捲,傭兵面板沒有捲動 → 養到 3 個傭兵時面板變高、第三張卡被擠出可視區又捲不到,
         點不到它的補血/技能設定(踩過 2026-07-01)。改成讓 .m-col-left 自己捲(overflow-y:auto),並把自動化設定
         改回內容高(flex:0 0 auto·overflow:visible)不再搶空間/不自成內捲 → 三塊全在同一條捲動裡,滑下去就到得了。
         單一外層捲動也避開 iOS 巢狀捲動手勢打架(同倉庫的解法)。只 scope 在手機設定頁,戰鬥/背包/桌機不受影響。 */
      'body.m-mobile.mview-config .m-col-left{overflow-y:auto !important;-webkit-overflow-scrolling:touch;padding-bottom:12px;}',
      'body.m-mobile.mview-config #automation-panel{flex:0 0 auto !important;overflow:visible !important;}',
      /* 隊伍/技能設定清單:作者對 #squad-tab-team/skill 設 max-height:46vh(桌機為了保留下方面板可見)。
         手機隊伍視圖裡它是唯一內容 → 46vh 上限造成下半截空白＋清單自己內捲。解除上限、改隨內容高,
         捲動交給上面那條 .m-col-left 單一外層捲動(同樣避開 iOS 巢狀捲動)。 */
      'body.m-mobile.mview-config #squad-tab-team,body.m-mobile.mview-config #squad-tab-skill{max-height:none !important;overflow:visible !important;}',

      'body.m-mobile{padding:0 !important;}',
      /* 🖥️→📱 中和作者 2026-06 新增的「1920×1080 固定設計舞台」#app-stage:它用 fitStage() 對舞台
         下 transform:scale(min(vw/1920,vh/1080)) 等比縮小整個桌機版面——手機上會把我們自建的版面
         一起縮成中央一小塊(0.2~0.8×),且 transform/will-change 會讓我們 fixed 的 #game-screen 改以
         舞台為定位基準(被一起縮放/位移)。手機把舞台還原成「正常文件流、零縮放」,fixed 子層才會貼回視窗。
         CSS !important 壓得過 fitStage 寫的 inline transform/left/top(它們無 !important),resize 時它再寫
         也蓋不掉,故不必攔 fitStage 本身。⏏️ 作者哪天不再用 #app-stage/fitStage 縮放,可整段刪。 */
      'body.m-mobile #app-stage{position:static !important;transform:none !important;will-change:auto !important;left:auto !important;top:auto !important;width:100vw !important;height:auto !important;overflow:visible !important;}',
      /* game-screen 用 fixed 釘在左上角:脫離原作者 body 的 flex 置中流,
         避免它比 body 矮時被垂直置中(→ 上方空白、底部 nav 被工具列遮住)。
         只動 game-screen,不動 body 對齊 → 開始選單/創角畫面照樣置中。
         不下 z-index(fixed 配 z-index:auto 不建立 stacking context,內部 modal 行為不變)。 */
      'body.m-mobile #game-screen{position:fixed !important;top:0 !important;left:0 !important;flex-direction:column !important;gap:0 !important;max-width:none !important;width:100vw !important;height:100vh !important;height:100dvh !important;height:var(--app-h,100dvh) !important;margin:0 !important;padding:0 !important;}',

      /* 精簡一行式狀態列(取代原本佔 1/3 高的大面板;原面板在手機隱藏) */
      /* 🔮 席琳的世界:整條頂部狀態列染紅,當「席琳世界開啟中」的辨識標。
         桌機靠整片底圖換色標示,手機底圖被面板蓋住看不到,故改染這條;紅色與正常的深藍狀態列對比明顯、好辨識。
         不另加元素 → 不會被金幣位數撐高。只在手機+席琳世界開啟時生效。 */
      'body.m-mobile.sherine-world #m-status{background:linear-gradient(#3a0d12,#1f0508) !important;border-bottom-color:#b91c1c !important;}',
      '#m-status{display:none;}',
      'body.m-mobile #status-panel{display:none !important;}',
      'body.m-mobile #m-status{display:flex !important;flex-direction:column;flex:0 0 auto !important;gap:6px;padding:7px 12px 9px;position:relative;background:#0f172a;border-bottom:1px solid #334155;font-size:13px;color:#e2e8f0;line-height:1.2;cursor:pointer;touch-action:manipulation;}',
      'body.m-mobile #m-status:active{background:#16233c;}',
      /* 第一列:暱稱 / 等級 / 金幣 / ⓘ */
      'body.m-mobile #m-status .ms-row{display:flex;align-items:center;}',
      'body.m-mobile #m-status .ms-row1{gap:7px 12px;flex-wrap:wrap;}',
      'body.m-mobile #m-status .ms-seg{white-space:nowrap;}',
      'body.m-mobile #m-status .ms-name #ms-name{display:inline-block;max-width:38vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;color:#fff;font-weight:bold;font-size:14px;}',
      'body.m-mobile #m-status .ms-info{margin-left:auto;color:#94a3b8;font-size:13px;}',
      'body.m-mobile #m-status #ms-lv{color:#fff;font-size:15px;}',
      'body.m-mobile #m-status .ms-ac,body.m-mobile #m-status .ms-mr{color:#94a3b8;}',   /* 防禦(AC)/魔防(MR):標籤灰、數值亮藍 */
      'body.m-mobile #m-status #ms-ac,body.m-mobile #m-status #ms-mr{color:#bfdbfe;font-size:14px;}',
      'body.m-mobile #m-status .ms-gold{color:#fbbf24;font-weight:bold;}',
      'body.m-mobile #m-status .ms-victory{color:#fde68a;text-shadow:0 0 6px rgba(253,230,138,0.85);font-size:14px;}',   /* 攻城獲勝皇冠:淡金黃+光暈,好辨識 */
      /* 第二列:HP / MP 雙血條(底條 + 填色 + 數字疊上,仿原版) */
      'body.m-mobile #m-status .ms-row2{gap:8px;}',
      'body.m-mobile #m-status .ms-bar{position:relative;flex:1 1 0;min-width:0;height:20px;border-radius:5px;overflow:hidden;background:#1e293b;border:1px solid #334155;}',
      'body.m-mobile #m-status .ms-bar-fill{position:absolute;left:0;top:0;bottom:0;width:0%;transition:width .25s;}',
      'body.m-mobile #m-status .ms-hp .ms-bar-fill{background:#dc2626;}',
      'body.m-mobile #m-status .ms-mp .ms-bar-fill{background:#2563eb;}',
      'body.m-mobile #m-status .ms-bar-txt{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:5px;font-size:11px;color:#fff;font-weight:bold;text-shadow:0 1px 2px rgba(0,0,0,.75);}',
      'body.m-mobile #m-status .ms-bar-txt b{font-weight:bold;}',
      'body.m-mobile #m-status .ms-hp .ms-bar-txt b{color:#fecaca;}',
      'body.m-mobile #m-status .ms-mp .ms-bar-txt b{color:#bfdbfe;}',
      'body.m-mobile #m-status #ms-exp{position:absolute;left:0;bottom:0;height:3px;width:0%;background:#eab308;transition:width .25s;}',

      /* 手機戰鬥畫面:怪物下方的手動喝水列(桌機與非戰鬥/村莊一律隱藏)。每列=[圖示][數量][按鈕] */
      '#m-heal-bar{display:none;}',
      'body.m-mobile.mview-battle #m-heal-bar{display:flex;flex-direction:row;align-items:center;gap:10px;flex:0 0 auto;margin:10px 12px 2px;}',
      'body.m-mobile #m-heal-bar .m-heal-rows{display:flex;flex-direction:column;gap:8px;flex:1 1 auto;min-width:0;}',
      'body.m-mobile #m-heal-bar .m-scroll-toggles{display:flex;flex-direction:column;gap:8px;flex:0 0 auto;}',
      'body.m-mobile #m-heal-bar .m-scroll-tog{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;font-weight:bold;white-space:nowrap;}',
      'body.m-mobile #m-heal-bar .m-scroll-cb{width:18px;height:18px;flex:0 0 auto;margin:0;}',
      'body.m-mobile #m-heal-bar .m-scroll-lab.text-cyan-300{color:#67e8f9;}',
      'body.m-mobile #m-heal-bar .m-scroll-lab.text-sky-300{color:#7dd3fc;}',
      'body.m-mobile #m-heal-bar .m-heal-row{display:flex;align-items:center;gap:10px;}',
      'body.m-mobile #m-heal-bar .m-heal-fruit{display:none;}',                /* 沒有安特的水果就不顯示這列 */
      'body.m-mobile #m-heal-bar .m-heal-fruit.m-show{display:flex;}',
      'body.m-mobile #m-heal-bar .m-heal-ic{width:36px;height:36px;flex:0 0 auto;border-radius:7px;background:#1e293b;border:1px solid #334155;object-fit:contain;padding:2px;}',
      'body.m-mobile #m-heal-bar .m-heal-cnt{flex:0 0 auto;min-width:44px;color:#e2e8f0;font-size:15px;font-weight:bold;}',
      'body.m-mobile #m-heal-bar .m-heal-go{flex:1 1 auto;padding:13px;border-radius:10px;color:#fff;font-size:16px;font-weight:bold;font-family:inherit;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4);border:1px solid #ef4444;background:linear-gradient(#dc2626,#b91c1c);user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;touch-action:manipulation;}',   /* 按住連喝:禁長按選字/系統選單,touch-action 避免長按被當手勢 */
      'body.m-mobile #m-heal-bar .m-heal-go:active{filter:brightness(.85);transform:translateY(1px);}',
      'body.m-mobile #m-heal-bar .m-fruit-go{border-color:#22c55e;background:linear-gradient(#16a34a,#15803d);}',   /* 安特的水果列用綠色區分 */
      'body.m-mobile #m-heal-bar .m-heal-row.m-empty .m-heal-ic,body.m-mobile #m-heal-bar .m-heal-row.m-empty .m-heal-cnt,body.m-mobile #m-heal-bar .m-heal-row.m-empty .m-heal-go{filter:grayscale(.65);opacity:.5;}',
      'body.m-mobile.m-intown #m-heal-bar{display:none !important;}',

      /* 喝水列下方:主動施放技能快捷鈕(琥珀色,與背包-技能面板的施放鈕同色系);沒學任何手動技能(無 .m-has)或村莊/桌機一律隱藏。一排兩顆 */
      '#m-skill-bar{display:none;}',
      'body.m-mobile.mview-battle #m-skill-bar.m-has{display:flex;flex-wrap:wrap;gap:8px;flex:0 0 auto;margin:2px 12px;}',
      'body.m-mobile #m-skill-bar .m-skill-go{flex:1 1 30%;min-width:28%;display:flex;align-items:center;justify-content:center;gap:5px;padding:11px 4px;border-radius:10px;font-size:13px;font-weight:bold;font-family:inherit;cursor:pointer;color:#fcd34d;border:1px solid #f59e0b;background:linear-gradient(#92400e,#78350f);box-shadow:0 2px 8px rgba(0,0,0,.4);}',
      'body.m-mobile #m-skill-bar .m-skill-go:active{filter:brightness(.85);transform:translateY(1px);}',
      'body.m-mobile #m-skill-bar .m-skill-ic{width:22px;height:22px;flex:0 0 auto;object-fit:contain;pointer-events:none;}',
      'body.m-mobile #m-skill-bar .m-skill-go.m-cd{filter:grayscale(.6);opacity:.5;}',
      'body.m-mobile.m-intown #m-skill-bar{display:none !important;}',

      /* 怪物名字與圖片之間的徽章列(頭目／異常狀態 tag):原作固定 height:18px + overflow:hidden + flex 不換行。
         手機三隻怪並排、單欄很窄,有 3 個以上 tag 時 flex 會把每個 tag 壓縮到只剩第一個字、其餘被裁掉看不見。
         手機改為:tag 不收縮(flex:0 0 auto)、整列可換行、取消固定高度,讓每個 tag 文字完整顯示。
         以行內 height:18px 屬性選擇器精準命中徽章列(狀態圖示列是 height:16px、血條無此值,皆不誤中);
         scope 在 body.m-mobile 的 #mob-list,桌機維持原本單行固定高;原作改掉 height:18px 寫法即自動失效。 */
      'body.m-mobile #mob-list .mob-target > div[style*="height:18px"]{height:auto !important;min-height:18px !important;flex-wrap:wrap !important;overflow:visible !important;row-gap:2px !important;}',
      'body.m-mobile #mob-list .mob-target > div[style*="height:18px"] > span{flex:0 0 auto !important;}',
      /* 怪物卡原作固定 height:224px + overflow:hidden + 內容置中:手機窄欄怪名常折成兩行,內容超過 224
         被裁掉 → 底部內容看不見。手機改成「固定 252px(容得下兩行名稱)+ 名稱最多兩行截斷」:
         高度永遠一致 → 不會隨怪物換人/名稱長短抖動。此段給「非 area-fit」版面(如三格純BOSS房);
         有 area-fit 條狀背景的一般狩獵圖走下方緊湊版。原作改掉固定高即自動失效。 */
      'body.m-mobile #battle-view:not(.area-fit) #mob-list .mob-target{height:252px !important;overflow:hidden !important;}',
      'body.m-mobile #battle-view:not(.area-fit) #mob-list .mob-target > div:first-child > span{display:-webkit-box !important;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.15;}',
      /* 🏜️ 戰鬥區(2026-07-01 v2·使用者指定「跟桌面版一樣填滿空白」):作者新版狩獵區背景＝16:9 滿版圖,戰鬥框
         由 flex 吃滿地圖面板;桌機面板≈16:9 故背景/怪物比例都對。手機改成跟桌機一致——戰鬥框 flex:1 吃滿中欄
         剩餘高度(背景 cover 滿版·對齊底部讓怪站地面),怪物完全交回原作 area-fit 的 grid＋景深 CSS(等同桌機
         等比縮放)。⚠️ 之前鎖 16:9(217px)時格子只剩 ~93px→原作「名字/徽章/狀態」三條固定列(flex-shrink:0)
         吃光高度、怪物圖被擠到只剩 ~12px(使用者回報「看不到怪物」);吃滿高度後格子夠高、怪物圖就回來了。
         不套舊版「條狀矮帶＋絕對定位疊圖」覆寫(上一代 strip 背景時代的,新版 grid 會打架)。 */
      /* 戰鬥框＝背景圖比例(16:9):高度＝寬×9/16=圖片自然高度→背景 cover 剛好貼齊、不放大裁切(顆粒原尺寸);
         flex:0 0 auto 不再吃滿整欄→多的高度留白在下方(使用者指定「最大高度=圖片高度」)。 */
      /* 高度=max(16:9, 300px):作者動畫怪原生像素不縮放後,常見高怪(古代巨人/法利昂 249px)在 16:9 矮框(手機寬
         ≈219px)必定切頭,使用者指定加高戰鬥畫面。300px≈容納 ~245px 高的怪(扣徽章/血條列);更高的(不死鳥/龍/
         林德拜爾 300px+)桌機 242px 框同樣切頭,不遷就。平板 16:9 已比 300 高→取 max 維持原比例。 */
      'body.m-mobile #battle-view.area-fit{flex:0 0 auto !important;height:max(56.25vw,300px) !important;aspect-ratio:auto !important;min-height:0 !important;overflow:hidden !important;background-size:cover !important;background-position:center bottom !important;}',
      /* 怪名顯示改由「顯示怪物名稱」設定(afk-mobname.js·body[data-afk-mobname])統一控制,手機不再強制隱藏 */
      /* 🔍 矮戰鬥框(=圖片高度)裡格子很小、怪物圖只剩 ~19px→放大 grid 景深倍率讓怪物大顆一點(使用者指定「單獨放大、
         但不要超出背景」)。卡片/圖框 overflow:visible 讓放大的圖露出;整個戰鬥框 overflow:hidden 在圖片高度處收邊。
         🎛️ 倍率再乘一個可調變數 --afk-mobscale(預設 1),由網址參數 ?mobscale=X 設定→方便現場調怪物大小(見下方 readMobScale)。 */
      'body.m-mobile #battle-view.area-fit .mob-target,body.m-mobile #battle-view.area-fit .mob-img-wrap{overflow:visible !important;}',
      /* ⚠️ 放大只能套「靜態圖怪」(:not(.mob-anim)):作者 v2.7.86 起動畫怪=原生像素 1:1、永不縮放(transform:none/translateY
         !important),我們的 3.5/4× 是當年「動畫圖被 max 100% 壓進小格」時代的補償——套在原生大圖上會變成 4× 巨怪、
         糊化、突出戰鬥框(2026-07-05 v3.0.2 動畫怪 25→399 隻時爆出,手機怪物位置全跑掉)。動畫怪交回作者原生尺寸
         ＋前後排 translateY 景深,與桌機一致;靜態圖怪(不在 MOB_ANIM_NAMES 的)仍是小圖、維持放大。 */
      'body.m-mobile #battle-view.area-fit #mob-list:has(.mob-back) .mob-back .mob-img-inner:not(.mob-anim){transform:scale(calc(3.5 * var(--jit-scale,1) * var(--afk-mobscale,1))) !important;}',
      'body.m-mobile #battle-view.area-fit #mob-list:has(.mob-back) .mob-front:not(.boss-zoom) .mob-img-inner:not(.mob-anim){transform:scale(calc(4 * var(--jit-scale,1) * var(--afk-mobscale,1))) !important;}',
      /* 使用者指定(2026-07-05):手機怪物一律站「最前排」同一條地線——作者的後排景深(動畫怪 translateY(-30px)
         !important)在手機矮戰鬥框(56.25vw≈219px)裡會把後排怪頂到框頂切頭。改成與前排同款 translateY(2px);
         作者哪天改掉前排的 2px,這裡要跟著對齊。 */
      'body.m-mobile #battle-view.area-fit #mob-list:has(.mob-back) .mob-back .mob-img-inner.mob-anim{transform:translateY(2px) !important;}',
      /* 🎯 VFX(死亡殘影/法術特效如流星雨)的幾何全以 .mob-img-inner 的 rect 為基準(vfxKill/playSpellFx),
         而作者 .mob-img-inner{height:100%} 讓它撐滿整格——戰鬥框加高到 300px 後容器比怪物本體高一大截,
         殘影被拉成容器高、特效落點以容器中心算 → 全部浮在怪物上方(使用者回報「死亡動畫/流星雨沒固定在前排」)。
         手機改:容器高度貼合圖片(height:auto)→ VFX 基準=怪物實際位置;格子內容改靠底(justify-content:flex-end)
         補回「怪站地線」(原本是靠 height:100% 把內容撐開才貼底的)。頭目格(.boss-slot 絕對定位 wrap)不動。 */
      'body.m-mobile #battle-view.area-fit .mob-target:not(.boss-slot){justify-content:flex-end !important;}',
      'body.m-mobile #battle-view.area-fit .mob-target:not(.boss-slot) .mob-img-inner{height:auto !important;}',
      /* 🐦 過高動畫怪(畫布高於戰鬥框:不死鳥477/林德拜爾497/巴拉卡斯407/龍307…約10隻):作者原生尺寸貼底顯示
         →超出部分被框頂裁掉;不死鳥更慘——鳥本體畫在畫布「頂端」(下方全透明),貼底後整隻在可視窗外(桌機原版
         同樣看不見,上游的坑)。手機把超過可視高的等比縮回框內(max-height,寬自動等比);未超高的怪不受影響、
         維持原生像素。55px≈徽章/血條/狀態列的高度,與戰鬥框高 max(56.25vw,300px) 那條連動。 */
      'body.m-mobile #battle-view.area-fit .mob-img-inner.mob-anim img{max-height:calc(max(56.25vw,300px) - 55px) !important;max-width:96vw !important;}',
      'body.m-mobile #battle-view:not(.area-fit) .mob-img-inner.mob-anim img{max-height:185px !important;max-width:96vw !important;}',
      /* 🧊 特效層 #vfx-layer 是全螢幕 fixed(z-45,螢幕座標):桌機戰鬥框永遠在畫面上沒事;手機切到隊伍/背包分頁後
         戰鬥畫面隱藏,怪物矩形量不到(r.width===0 → 引擎跳過更新),冰凍貼圖/死亡殘影/傷害數字就凍在原座標
         蓋住介面,要等特效時限到才消失(使用者回報)。手機在「非戰鬥分頁」與「村莊」直接藏整層;display:none
         不清元素,計時器照走,切回戰鬥分頁時過期的已自行移除、冰凍層由 _updateFreezeFx 逐幀重新定位,不殘留。 */
      'body.m-mobile:not(.mview-battle) #vfx-layer{display:none !important;}',
      'body.m-mobile.m-intown #vfx-layer{display:none !important;}',

      /* 🧿 角色狀態圖示列(作者 #status-icon-bar,錨在戰鬥框右上):桌機 38px 圖示在手機矮戰鬥框裡太佔畫面,
         整組縮成一半(38→19px、間距 5→3px)。右下角剩餘秒數在 19px 小圖上會蓋掉大半張圖 → 手機不顯示
         (使用者指定,較清爽);桌機不受影響。 */
      'body.m-mobile #status-icon-bar{top:6px !important;right:8px !important;left:8px !important;gap:3px !important;}',
      'body.m-mobile .status-icon{width:19px !important;height:19px !important;flex:0 0 19px !important;border-radius:3px !important;}',
      'body.m-mobile .status-icon-time{display:none !important;}',

      /* 喝水列下方:鏡射「背包→能力→狀態」(#dt-buffs)。只在戰鬥畫面顯示、村莊隱藏(同喝水列) */
      '#m-battle-buffs{display:none;}',
      'body.m-mobile.mview-battle #m-battle-buffs{display:block;flex:0 0 auto;margin:2px 12px 8px;padding:8px 12px;max-height:22vh;overflow-y:auto;background:#0f172a;border:1px solid #334155;border-radius:10px;color:#e2e8f0;font-size:13px;line-height:1.5;}',
      'body.m-mobile.m-intown #m-battle-buffs{display:none !important;}',

      /* 三欄:滿寬,一次只顯示一欄,內部自行捲動 */
      'body.m-mobile .m-col-left,body.m-mobile .m-col-center,body.m-mobile .m-col-right{width:100% !important;max-width:none !important;flex:1 1 auto !important;min-height:0 !important;gap:8px !important;overflow:hidden;}',
      // 2026-07-13 使用者實機回報:城鎮 NPC 清單(見 ensureTownNpcList)只有前幾格看得到、往下滑不動,
      // 點不到清單下半段的 NPC。根因:上面這條 overflow:hidden 是給「地圖/戰鬥框固定比例、內容
      // 絕不超出這一欄」的一般情況寫的；但城鎮地圖+清單合起來的高度可能遠超過這一欄本身的高度,
      // 這條 overflow:hidden 就把清單下半段直接裁掉、連捲動都捲不到(不是清單本身不能捲,而是整欄
      // 從外面就被切斷)。只在原作已上線地圖式 NPC(#town-npc-map 存在)時解除裁切、交給
      // #game-screen 本來就有的 overflow-y:auto 一起捲動；其餘畫面(戰鬥/背包/隊伍)不受影響。
      'body.m-mobile:has(#town-npc-map) .m-col-center{overflow:visible !important;}',
      /* 2026-07-08(待辦#8):背包分頁按鈕列(.tab-bar)跟下方內容(快速強化/快速廢品/物品清單)之間的間隙縮小,
         只調 .m-col-right(背包欄)、不動戰鬥/設定欄的間距(避免波及沒被抱怨的畫面)。 */
      'body.m-mobile .m-col-right{gap:4px !important;}',
      'body.m-mobile .m-col-left,body.m-mobile .m-col-center,body.m-mobile .m-col-right{display:none !important;}',
      'body.m-mobile.mview-battle .m-col-center{display:flex !important;}',
      'body.m-mobile.mview-config .m-col-left{display:flex !important;}',
      'body.m-mobile.mview-bag .m-col-right{display:flex !important;}',

      /* 底部導覽列:遊戲本體 .m-col-left/.m-col-center/.m-col-right 各自帶 order:1~3(它自己響應式版面用),
         而這裡沒指定 order 時瀏覽器預設 0,會比欄位內容更早排(視覺上被擠到 #m-status 正下方、跑到頂部)。
         給一個夠大的 order 值,確保無論核心欄位用到多少 order 都排在它們之後,固定貼在畫面最下方。 */
      'body.m-mobile #m-nav{display:flex !important;flex:0 0 auto !important;order:99 !important;height:56px;background:#0f172a;border-top:1px solid #334155;}',
      'body.m-mobile #m-nav button{flex:1;background:transparent;border:none;color:#94a3b8;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;font-family:inherit;touch-action:manipulation;}',   /* touch-action:manipulation:取消 iOS 雙擊縮放的 300ms 等待 → click 在 touchend 當下就發,不會被 mirror/戰鬥重排插隊取消(iPhone 要按多下才有反應的根因) */
      'body.m-mobile #m-nav button.m-active{color:#fcd34d;background:#1e293b;}',
      'body.m-mobile #m-nav button:active{background:#334155;}',

      /* 戰鬥/系統日誌:底部浮動面板。切換/關閉做成 ⇆/✕ 兩顆小鈕注入原本標題列,不再另開一排。
         原標題列半透明(讓血條透出),日誌內文(.log-bg 自帶深色底)維持不透明保持可讀。 */
      '#m-log-sheet{display:none;}',
      'body.m-mobile #m-log-sheet{display:none;position:fixed;left:0;right:0;bottom:calc(56px + env(safe-area-inset-bottom,0px));height:45dvh;height:45vh;z-index:50;flex-direction:column;background:transparent;border-top:2px solid #475569;box-shadow:0 -12px 34px rgba(0,0,0,.6);}',
      'body.m-mobile.mlog-open #m-log-sheet{display:flex !important;}',
      'body.m-mobile #m-log-body{flex:1 1 auto;min-height:0;display:flex;overflow:hidden;background:transparent;}',
      'body.m-mobile #m-log-body #combat-log-panel,body.m-mobile #m-log-body .m-syslog{flex:1 1 auto !important;width:100%;height:auto !important;min-height:0 !important;margin:0 !important;border-radius:0 !important;background:transparent !important;border:none !important;box-shadow:none !important;}',
      /* 原標題列:半透明 + 模糊(血條透出),右側留位放控制鈕 */
      'body.m-mobile #m-log-body .panel-header.m-log-hdr{position:relative;background:rgba(15,23,42,0.45) !important;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);padding-right:86px !important;}',
      '.m-log-ctrls{display:none;}',
      'body.m-mobile #m-log-body .panel-header.m-log-hdr .m-log-ctrls{display:flex;position:absolute;right:6px;top:50%;transform:translateY(-50%);gap:6px;}',
      'body.m-mobile .m-log-ctrls button{width:34px;height:30px;border:1px solid rgba(51,65,85,0.85);background:rgba(30,41,59,0.7);color:#e2e8f0;border-radius:7px;font-size:15px;line-height:1;cursor:pointer;font-family:inherit;padding:0;touch-action:manipulation;}',
      'body.m-mobile .m-log-ctrls button:active{background:rgba(71,85,105,0.9);}',
      /* 村莊:沒有戰鬥日誌可切 → 藏起「⇆ 切換」鈕(只剩 ✕ 關閉) */
      'body.m-mobile.mlog-nocombat .m-log-sw{display:none !important;}',
      'body.m-mobile.mlog-sys #m-log-body #combat-log-panel{display:none !important;}',
      'body.m-mobile.mlog-combat #m-log-body .m-syslog{display:none !important;}',
      /* 系統日誌標題列右側「黑市拍賣中:商品名」(原作 #syslog-pandora,帶 truncate):
         手機浮動面板寬度窄,扣掉標題與右側 ⇆/✕ 鈕後剩沒幾字 → 商品名被 truncate 切掉顯示不完整。
         有商品時(:not(:empty))讓它換到標題下方整行、正常折行不截斷;沒商品(:empty)維持原樣不佔行高。
         scope 在手機浮動日誌的 .m-log-hdr,桌機與原作改版皆不受影響。 */
      'body.m-mobile #m-log-body .panel-header.m-log-hdr{flex-wrap:wrap !important;row-gap:0 !important;}',
      'body.m-mobile #m-log-body .panel-header.m-log-hdr #syslog-pandora:not(:empty){flex:1 1 100% !important;white-space:normal !important;overflow:visible !important;text-overflow:clip !important;text-align:left !important;line-height:1.2 !important;margin-top:0 !important;}',

      /* 地圖標題列:手機隱藏「冒險地圖」文字,控制項靠左不撐開 */
      'body.m-mobile .m-maptitle{display:none !important;}',
      'body.m-mobile .m-maphdr{justify-content:flex-start !important;gap:6px !important;flex-wrap:wrap !important;}',
      /* 🔧 作者大改版把控制鈕(瞬移/回村/出發/分類·地圖下拉)包進一個 inner flex 容器(index.html:「新增一個 flex 容器」),
         該容器自己 nowrap → 手機窄寬下整排往右溢出、回村鈕被擠出畫面點不到。讓這個 inner 容器也換行、下拉可縮。
         以 :has(> #map-select) 精準命中那個容器(不誤中標題 span)。作者哪天不再包這層 inner div 即自動失效。 */
      'body.m-mobile .m-maphdr div:has(> #map-select){flex-wrap:wrap !important;justify-content:flex-start !important;gap:6px !important;min-width:0 !important;}',
      'body.m-mobile .m-maphdr #map-category,body.m-mobile .m-maphdr #map-select{flex:1 1 40% !important;min-width:0 !important;max-width:100% !important;}',
      /* 🔧 作者大改版新增 #log-row(戰鬥/系統日誌並排,固定 flex:0 0 340px)夾在 #map-view-panel 下方。手機已把兩個
         日誌移進浮動日誌面板(logsIntoSheet),#log-row 變空殼卻仍佔 340px → 戰鬥區下方一大塊空白、且把
         #map-view-panel(flex:1)壓到只剩一小條 → 怪物格被擠到超小/溢出。手機直接收掉空的 #log-row,
         戰鬥區即吃滿整個中欄高度。作者哪天不再用 #log-row 即自動失效。 */
      'body.m-mobile #log-row{display:none !important;}',

      /* 細節:縮一點字與間距讓內容更好塞 */
      'body.m-mobile #game-screen .panel-header{padding-top:6px !important;padding-bottom:6px !important;}',

      /* 物品操作 Modal:手機上比較面板+主面板改「上下堆疊」並限寬,避免並排爆出畫面 */
      'body.m-mobile #item-modal{flex-direction:column !important;align-items:stretch !important;width:94vw !important;max-width:94vw !important;max-height:90dvh !important;max-height:90vh !important;overflow-y:auto !important;gap:8px !important;z-index:70 !important;}',
      'body.m-mobile #item-modal > div{min-width:0 !important;max-width:100% !important;width:100% !important;flex:0 0 auto !important;}',
      'body.m-mobile #item-modal #modal-compare{max-width:100% !important;max-height:42vh !important;}',

      /* 登出確認視窗(自製,取代原生 confirm:iOS 會抑制原生彈窗) */
      '#m-logout-modal{display:none;position:fixed;inset:0;z-index:90;background:rgba(2,6,23,0.7);align-items:center;justify-content:center;padding:24px;}',
      '#m-logout-modal.open{display:flex;}',
      '#m-logout-card{width:min(360px,92vw);background:#0f172a;border:1px solid #334155;border-radius:12px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);}',
      '#m-logout-msg{color:#e2e8f0;font-size:15px;line-height:1.7;text-align:center;margin-bottom:18px;}',
      '#m-logout-btns{display:flex;gap:10px;}',
      '#m-logout-btns button{flex:1;padding:11px;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;font-family:inherit;border:1px solid #334155;touch-action:manipulation;}',
      '#m-logout-cancel{background:#1e293b;color:#cbd5e1;}',
      '#m-logout-cancel:active{background:#334155;}',
      '#m-logout-ok{background:#b45309;color:#fff;border-color:#d97706;}',
      '#m-logout-ok:active{background:#92400e;}',

      /* 匯入存檔確認視窗(自製,同上取代原生 confirm) */
      '#m-import-confirm{position:fixed;inset:0;z-index:95;background:rgba(2,6,23,0.7);display:flex;align-items:center;justify-content:center;padding:24px;}',
      '#m-import-confirm-card{width:min(360px,92vw);background:#0f172a;border:1px solid #334155;border-radius:12px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);}',
      '#m-import-confirm-msg{color:#e2e8f0;font-size:14px;line-height:1.7;text-align:center;margin-bottom:18px;white-space:normal;}',
      '#m-import-confirm-btns{display:flex;gap:10px;}',
      '#m-import-confirm-btns button{flex:1;padding:11px;border-radius:8px;font-size:15px;font-weight:bold;cursor:pointer;font-family:inherit;border:1px solid #334155;touch-action:manipulation;}',
      '#m-import-confirm-cancel{background:#1e293b;color:#cbd5e1;}',
      '#m-import-confirm-cancel:active{background:#334155;}',
      '#m-import-confirm-ok{background:#4338ca;color:#fff;border-color:#6366f1;}',
      '#m-import-confirm-ok:active{background:#3730a3;}',

      /* 登出遮罩:按確定後立刻蓋住,撐過 reload 重開機的幾秒(否則舊頁戰鬥畫面還在跑) */
      '#m-logout-overlay{position:fixed;inset:0;z-index:100000;background:#020617;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;}',
      '#m-logout-overlay-spin{width:38px;height:38px;border:3px solid #334155;border-top-color:#f59e0b;border-radius:50%;animation:m-logout-spin 0.8s linear infinite;}',
      '#m-logout-overlay-txt{color:#e2e8f0;font-size:15px;letter-spacing:0.5px;}',
      '@keyframes m-logout-spin{to{transform:rotate(360deg);}}',

      /* 角色資訊彈窗:點暱稱叫出桌面版 #status-panel(手機平時隱藏);✕/點背景關閉 */
      '#m-stat-modal{display:none;}',
      'body.m-mobile.m-stat-open #m-stat-modal{display:flex;position:fixed;inset:0;z-index:80;align-items:center;justify-content:center;background:rgba(2,6,23,0.72);padding:16px;}',
      'body.m-mobile #m-stat-card{position:relative;width:min(92vw,420px);max-height:84vh;max-height:calc(var(--app-h,84vh) - 32px);overflow-y:auto;}',
      'body.m-mobile #m-stat-bar{display:flex;justify-content:flex-end;margin-bottom:6px;}',
      'body.m-mobile #m-stat-close{width:36px;height:36px;border:1px solid rgba(51,65,85,0.85);background:rgba(30,41,59,0.92);color:#e2e8f0;border-radius:8px;font-size:17px;cursor:pointer;font-family:inherit;touch-action:manipulation;}',
      'body.m-mobile #m-stat-close:active{background:rgba(71,85,105,0.92);}',
      'body.m-mobile #m-stat-body{width:100%;}',
      'body.m-mobile #m-stat-body #status-panel{display:flex !important;width:100% !important;margin:0 !important;}',

      /* NPC 互動列(商店/製作 等共用同款 .list-item):手機窄寬下名稱用了 truncate 但文字容器沒 min-w-0,
         名稱會整行溢出壓到右側的數量框/製作鈕(看不清買/做什麼)。粗粒度修法:讓文字容器可縮、名稱改換行、
         數量框縮窄、間距縮小。scope 在穩定的 #interaction-content .list-item → 商店+製作+同款 NPC 一次涵蓋;
         作者若重排,規則失效即回原樣(不會壞)。 */
      'body.m-mobile #interaction-content .list-item{flex-wrap:wrap !important;gap:8px;}',   /* 控制區太寬(如製作含兩顆鈕)時整塊換到第二行,資訊區就有整行空間 */
      'body.m-mobile #interaction-content .list-item > div:first-child{min-width:45% !important;gap:8px !important;}',   /* 資訊區保底 45%:商店(控制窄)維持一行;製作(控制寬)放不下→控制整塊換行 */
      'body.m-mobile #interaction-content .list-item > div:first-child > div{min-width:0 !important;}',
      'body.m-mobile #interaction-content .list-item > div:first-child span{white-space:normal !important;overflow-wrap:break-word;}',
      'body.m-mobile #interaction-content .list-item input{width:44px !important;}',
      'body.m-mobile #interaction-content .list-item > div:last-child{gap:6px !important;flex-wrap:wrap;justify-content:flex-end;margin-left:auto;}',

      /* 倉庫捲動的根因是「巢狀垂直捲動」:外層 #interaction-content 本身 overflow-y:auto 會捲,
         內層兩個清單(#wh-inv-list/#wh-store-list)又各自 overflow-y:auto + max-height:340px 會捲。
         iOS WebKit 無法乾淨判斷手勢屬於哪一層(原本鏈到外層→背景捲;之前用 -webkit-overflow-scrolling:touch
         反而讓內層變成另一個捲動圖層→要先點一下才捲)。
         解法:手機上讓兩個清單「不要自己捲」(取消 max-height/overflow),整個倉庫面板交給外層單一捲動 →
         沒有巢狀就沒有哪層的爭議,iOS/安卓都正常。桌機維持原本各自捲(滑鼠滾輪無此問題)。 */
      'body.m-mobile #wh-inv-list,body.m-mobile #wh-store-list{max-height:none !important;overflow:visible !important;}',

      /* 潘朵拉黑市卡片:原作用「左圖固定 112px + 右購買鈕固定 84px」的橫向列(行內 height:120px),
         手機窄寬下中間名稱/說明/價格欄被擠到只剩約 20px → 文字一字一行整個糊掉。改成直向堆疊:
         圖示置中、資訊欄取消固定高度與 truncate 正常換行、購買鈕整條寬。scope 在卡片唯一的 .max-w-xl,
         作者若重排此卡規則自動失效(不會壞);桌機(無 m-mobile)完全不受影響。 */
      'body.m-mobile #interaction-content .max-w-xl .items-stretch{flex-direction:column !important;height:auto !important;align-items:center !important;gap:10px !important;}',
      'body.m-mobile #interaction-content .max-w-xl .items-stretch > div{width:100% !important;height:auto !important;}',
      'body.m-mobile #interaction-content .max-w-xl .items-stretch > div:first-child{width:96px !important;height:96px !important;align-self:center !important;}',   /* 圖示框維持方形、置中 */
      'body.m-mobile #interaction-content .max-w-xl .items-stretch > div:nth-child(2){height:auto !important;text-align:center !important;}',
      'body.m-mobile #interaction-content .max-w-xl .items-stretch > div:nth-child(2) .truncate{white-space:normal !important;overflow:visible !important;}',   /* 名稱/價格不再被 truncate 切掉 */
      'body.m-mobile #interaction-content .max-w-xl .items-stretch > div:nth-child(2) .overflow-y-auto{overflow:visible !important;max-height:none !important;}',   /* 說明欄不限高、整段顯示 */
      'body.m-mobile #interaction-content .max-w-xl .items-stretch > div:last-child button{width:100% !important;height:auto !important;flex-direction:row !important;gap:8px !important;padding:11px !important;}',   /* 購買鈕整條寬、圖示+字並排 */

      /* 村莊頁頂部:村名(text-3xl)+「安全區域」提示在手機佔掉一截高度 → 縮字級與上下間距 */
      'body.m-mobile #town-view{padding:10px 12px !important;gap:5px !important;}',
      'body.m-mobile #town-name{font-size:19px !important;}',
      'body.m-mobile #town-view > p{font-size:12px !important;line-height:1.35 !important;}',
      /* 城鎮 NPC 條列式選單(見上方 ensureTownNpcList):原作把這個容器改成 2 欄卡片格線後永遠 hidden
         (NPC 改用地圖式呈現),這裡把它重新啟用、改回單欄直向清單,貼在地圖下方(DOM 順序天生在
         #town-npc-map 之後,原作、地圖圖片保留在上面不動)。 */
      /* :has(#town-npc-map) 只在原作已上線地圖式 NPC 才命中;還沒同步到新版的正式站台
         沒有這個元素,不會動到目前運作中的舊版 2 欄卡片清單。
         原作 #town-view 本身是「固定 16:9、overflow:hidden」的圖框(跟戰鬥框同規格),多塞進去的
         清單會被直接裁掉看不見;這裡讓 #town-view 改成隨內容自然長高(地圖仍維持 16:9,清單接在
         下面),交給 #game-screen 既有的 overflow-y:auto 一起捲動。 */
      'body.m-mobile:has(#town-npc-map) #town-view:not(.hidden){aspect-ratio:none !important;height:auto !important;overflow:visible !important;}',
      'body.m-mobile:has(#town-npc-map) #town-npc-map{aspect-ratio:16/9 !important;height:auto !important;flex:0 0 auto !important;}',
      'body.m-mobile:has(#town-npc-map) #town-npc-container{display:flex !important;flex-direction:column !important;grid-template-columns:none !important;gap:8px !important;margin-top:8px !important;flex:0 0 auto !important;overflow:visible !important;max-height:none !important;}',
      'body.m-mobile .m-town-npc-row{display:flex;flex:0 0 auto;align-items:flex-start;gap:10px;padding:10px 12px;min-height:44px;background:#1e293b;border:1px solid #334155;border-radius:10px;cursor:pointer;touch-action:manipulation;}',
      'body.m-mobile .m-town-npc-row:active{background:#334155;}',
      'body.m-mobile .m-town-npc-row .m-tnr-ic{font-size:22px;line-height:1;flex:0 0 auto;margin-top:1px;}',
      'body.m-mobile .m-town-npc-row .m-tnr-txt{display:flex;flex-direction:column;gap:1px;min-width:0;}',
      // 2026-07-13 使用者要求:名稱+類型同一行顯示(不換行),像「比特[雜貨商人]」
      'body.m-mobile .m-town-npc-row .m-tnr-nametitle{display:flex;align-items:baseline;flex-wrap:nowrap;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;gap:4px;}',
      'body.m-mobile .m-town-npc-row .m-tnr-name{color:#f1f5f9;font-size:15px;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;}',
      'body.m-mobile .m-town-npc-row .m-tnr-title{color:#facc15;font-size:12px;flex:0 0 auto;}',
      'body.m-mobile .m-town-npc-row .m-tnr-desc{color:#94a3b8;font-size:12px;line-height:1.4;margin-top:2px;}',

      /* 倉庫(warehouse NPC):金幣存取列 + 分類/一鍵列在手機窄寬下擠成一團 → 重排成整齊兩行。
         用倉庫專屬 id/onclick(#wh-gold-amt、whOneClickDeposit)定位,只命中倉庫;原作改版即失效不影響別頁。 */
      /* 金幣列:資訊一行、數量輸入一行,[存入][取出]自成一列各佔一半 */
      'body.m-mobile #interaction-content div:has(> #wh-gold-amt){gap:8px !important;}',
      'body.m-mobile #interaction-content div:has(> #wh-gold-amt) > span:first-child{flex:1 1 100% !important;}',
      'body.m-mobile #interaction-content #wh-gold-amt{flex:1 1 100% !important;width:auto !important;margin-left:0 !important;}',
      'body.m-mobile #interaction-content div:has(> #wh-gold-amt) > button{flex:1 1 40% !important;}',
      /* 分類列:[物品分類 + 下拉]一行,[一鍵存入][一鍵排列]整寬第二行;隱藏冗長的共用提示字 */
      'body.m-mobile #interaction-content div:has(> button[onclick^="whOneClickDeposit"]){flex-wrap:wrap !important;gap:8px !important;align-items:center !important;}',
      'body.m-mobile #interaction-content div:has(> button[onclick^="whOneClickDeposit"]) > select{flex:1 1 160px !important;}',
      'body.m-mobile #interaction-content div:has(> button[onclick^="whOneClickDeposit"]) > span.text-slate-500{display:none !important;}',
      'body.m-mobile #interaction-content div:has(> button[onclick^="whOneClickDeposit"]) > button{flex:1 1 40% !important;margin-left:0 !important;}',

      /* 血盟 NPC(依詩蒂/特羅斯):桌機 flex-row + 200px 立繪,手機窄寬下右側對話被擠成一字一行。
         改直向堆疊:立繪縮小置中、對話/按鈕整寬。招募與已加入兩種版面皆適用;原作改版規則自動失效。 */
      'body.m-mobile #interaction-content > .flex-row{flex-direction:column !important;align-items:center !important;gap:14px !important;padding:12px !important;}',
      'body.m-mobile #interaction-content > .flex-row > div:first-child{width:150px !important;height:210px !important;}',
      'body.m-mobile #interaction-content > .flex-row > div:last-child{width:100% !important;}',

      /* 手機長按看詳情:資訊卡彈窗(取代桌機 hover tooltip);短按維持原動作,長按那下不誤觸 */
      '#m-tip-modal{display:none;}',
      'body.m-mobile #m-tip-modal.open{display:flex !important;position:fixed;inset:0;z-index:85;align-items:flex-start;justify-content:center;padding:60px 12px 16px;background:rgba(2,6,23,0.6);}',
      'body.m-mobile #m-tip-card{position:relative;width:min(94vw,420px);max-height:72vh;overflow-y:auto;background:rgba(15,23,42,0.98);border:1px solid #64748b;border-radius:10px;padding:14px 14px 16px;box-shadow:0 12px 40px rgba(0,0,0,.7);color:#e2e8f0;}',
      'body.m-mobile #m-tip-card .m-tip-x{position:absolute;top:6px;right:6px;width:32px;height:32px;border:1px solid rgba(100,116,139,.7);background:rgba(30,41,59,.9);color:#e2e8f0;border-radius:7px;font-size:15px;line-height:1;cursor:pointer;font-family:inherit;padding:0;}',
      'body.m-mobile #m-tip-card .m-tip-x:active{background:rgba(71,85,105,.95);}',
      'body.m-mobile #m-tip-card .m-tip-name{font-weight:bold;font-size:16px;margin:0 36px 6px 0;}',
      'body.m-mobile #m-tip-card .m-tip-body{font-size:13px;line-height:1.6;}',
      'body.m-mobile .tip-host,body.m-mobile #interaction-content [title]{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;}',

      /* ── 新版登入首頁(v3.0.40+)手機化 ────────────────────────────────────
         作者把首頁改成固定 4:3「藝術舞台」#login-art-stage,標題/選單/版號用 % 絕對定位疊在背景圖上。
         直式手機下 4:3 舞台被壓成中央一條矮 letterbox,三個圖層擠成一團互相重疊、按鈕縮小難點(爆版)。
         手機改成:舞台還原成滿版直向流,背景圖鋪底(cover·壓暗),標題→選單→版號由上到下堆疊置中、
         按鈕放大好點;逐幀動畫小圖在直式沒有定位意義故隱藏。載入/創角面板仍是舞台內的絕對置中 modal,
         舞台維持 position:relative 即照常置中。scope 全在 body.m-mobile,作者哪天改回/移除這些 id,
         規則不命中自動失效,桌機不受影響。
         ⚠ #creation-screen 這條務必 :not(.hidden)——本選擇器 specificity(1,1,1) 高過作者的
         `#creation-screen.hidden{display:none!important}`(1,1,0),若無條件 `display:block !important`
         會壓過 .hidden、讓載入/創角後「登入畫面關不掉、蓋在遊戲上」→ 玩家卡在選角畫面(踩過 2026-07-06)。
         加 :not(.hidden) 後有 .hidden 時本規則不命中,交還作者的隱藏。 */
      'body.m-mobile #creation-screen:not(.hidden){position:fixed !important;inset:0 !important;display:block !important;overflow-y:auto !important;padding:0 !important;}',
      'body.m-mobile #login-art-stage{position:relative !important;width:100vw !important;max-width:100vw !important;aspect-ratio:auto !important;min-height:var(--app-h,100dvh) !important;display:flex !important;flex-direction:column !important;justify-content:center !important;overflow:visible !important;padding:32px 22px 40px !important;box-shadow:none !important;}',
      'body.m-mobile #login-bg-image{position:absolute !important;inset:0 !important;width:100% !important;height:100% !important;object-fit:cover !important;opacity:.35 !important;}',
      'body.m-mobile #login-anim-image{display:none !important;}',
      /* 🎨 2026-07-11 首頁 V17 改版新增 #login-copy-panel(左資訊卡包住 title-layer/meta-layer),
         手機版解除桌機的絕對定位卡片框,改回一般直向堆疊(卡片背景/邊框保留,只是不再絕對定位)。 */
      'body.m-mobile #login-copy-panel{position:relative !important;left:auto !important;top:auto !important;width:100% !important;max-width:330px !important;height:auto !important;margin:0 auto !important;}',
      'body.m-mobile #login-title-layer{position:relative !important;left:auto !important;top:auto !important;width:100% !important;text-align:center !important;margin:0 0 6vh !important;z-index:3 !important;}',
      'body.m-mobile #login-title-layer h1{font-size:26px !important;margin:0 0 8px !important;}',
      'body.m-mobile #login-title-layer p{font-size:14px !important;}',
      'body.m-mobile #main-menu{position:relative !important;left:auto !important;top:auto !important;width:100% !important;max-width:330px !important;margin:0 auto !important;gap:12px !important;z-index:4 !important;}',
      'body.m-mobile #main-menu > button{width:100% !important;font-size:16px !important;padding:14px 12px !important;}',
      'body.m-mobile #main-menu > p{width:100% !important;margin:8px 0 0 !important;font-size:13px !important;line-height:1.5 !important;}',
      'body.m-mobile #login-meta-layer{position:relative !important;left:auto !important;top:auto !important;width:100% !important;max-width:330px !important;margin:6vh auto 0 !important;text-align:center !important;z-index:3 !important;}',
      'body.m-mobile #login-version{font-size:15px !important;}',
      'body.m-mobile #login-disclaimer{font-size:11px !important;}',
      /* ⚠️ 2026-07-11 三畫面改版:#creation-panel/#stat-allocation/#class-desc 舊版手機覆寫已移除——
         原作新版這幾個容器全部改用 position:absolute + %/clamp() 定位(4:3 藝術舞台，與 #load-select-panel
         同一套設計),舊版那套「flex-direction:column + width:100%!important」的覆寫拿掉 flex 版面的假設,
         套在新結構上會讓 #stat-allocation 內的 .creation-stat-control(用 % 相對父層定位)computed 出錯誤座標，
         畫面上看起來是配點 -/+ 鈕疊到人物介紹框裡(踩過，見交接紀錄)。新結構本身用相對單位設計、
         已經會隨容器(4:3 舞台寬度=min(100vw,100vh*4/3))自動縮放,不需要额外的手機版覆寫。
         （#creation-panel 手機版本輪暫不處理,先做 #load-select-panel,見下） */

      /* 🎨 2026-07-12 選角畫面(#load-select-panel)手機版:原作 4:3 桌機版面在窄螢幕上只是整塊等比
         縮到畫面中間一小塊(實測 375 寬螢幕只佔 281px 高、上下留大量黑邊),四個存檔拱門格擠在一起、
         文字小到看不清楚——不是排版跑掉,是桌機設計直接塞進小螢幕沒有另外適配。改成「單一角色置中卡片」
         (呼應使用者提供的 V17 參考稿手機版排版):同時間只顯示一格存檔(靠原作既有的 .load-slot-card.selected
         class 切換,不改寫渲染邏輯本身)、外加自建左右箭頭呼叫原作全域 loadSetPage()/loadSelectSlot()
         逐一切換存檔位;屬性資訊/操作按鈕改成一般文件流的卡片,不再是絕對定位疊在 4:3 底圖上。
         ⚠ 拱門背景圖 public/assets/login/load.png 整張是「桌機版 4 格拱門 + 下方文字資訊框」合成圖,
         不能整張當手機背景(下方文字框會露出來、跟自建的資訊卡重疊)——改把它當 #load-slot-grid 的
         CSS background-image,用 background-size/position 只裁到中間「一格拱門(含左右兩側柱子)」的範圍。
         🎨 2026-07-12 使用者第二輪回饋調整:①整個面板改 flex 直向排列,角色/拱門區給 flex:1(能拿多少
         空間就拿多少),屬性資訊+四顆按鈕收在最下面(flex:0 0 auto,不再是 margin-top 堆疊)。
         ②裁切改用「百分比」而非 vw 算位移——vw 是相對『瀏覽器視窗』寬度,不是相對這個容器本身寬度,
         兩者在手機版通常一樣(容器=100%寬=100vw),但拿掉容器實際跟視窗寬度不同的環境(如本機預覽用的
         獨立測試頁面)算出來的位移會整個跑掉;改用 background-position 的百分比語法(相對容器與圖片
         尺寸差算,而非相對視窗),兩種情境下都準。③裁切框改到「中間」的拱門(不是最左那格)——最左格
         左側只有畫面外框、不是真正的柱子,置中拱門才能左右兩側都看到完整柱子(使用者明確要求)。
         裁切座標:直接在圖上量測 4 根柱子中心約在原生 x=10/170/330/490(640 寬原圖),取中間那組
         [170,330](寬160px)當裁切窗:background-size 410%(=640/160*100%,讓這 160px 撐滿容器寬)、
         background-position-x 用「(container-image)*(pct/100)=目標位移」反推 pct≈33%(見同名歷史對話
         推導,数字非憑空handle)。 */
      'body.m-mobile #load-select-panel:not(.hidden){display:flex !important;flex-direction:column !important;height:100dvh !important;min-height:100dvh !important;overflow:hidden !important;padding:0 !important;}',
      'body.m-mobile #load-art-stage{display:flex !important;flex-direction:column !important;flex:1 1 auto !important;min-height:0 !important;position:relative !important;width:100% !important;max-width:none !important;aspect-ratio:auto !important;height:auto !important;box-shadow:none !important;overflow:hidden !important;}',
      'body.m-mobile #load-select-bg,body.m-mobile #load-select-overlay,body.m-mobile #load-page-tabs{display:none !important;}',   /* 底圖整張含4格+下方文字框、疊加外框線、桌機「1/2」頁籤——手機都不適用,改走下面自建的裁切背景與 ‹› 箭頭 */
      /* 🩹 2026-07-13 使用者回報:角色立繪來源圖(assets/start/*.png)沒有透明背景(純色底、無 alpha
         channel),不管背景圖裁哪裡,角色圖自己的矩形範圍一定會蓋出一塊實色方框,跟背後場景圖對比
         太強時會看起來「兩層貼紙疊在一起」。試過改選場景圖裡偏暗的區域裁切矇混過去,使用者不滿意
         (拱門雕花糊成一片看不清楚、且裁切位置受容器高度影響會漂移,見下)。
         ⚠ 2026-07-13 第二輪:改用「JS 算絕對像素」取代 background-position 百分比(避免容器高度
         不同時裁切窗口垂直漂移,詳細量測見 ensureLoadArchOverlay())修好了裁切位置本身,但接著發現
         `load1.png`(桌機 `#load-select-overlay` 原本就在用的「拱門畫框」半透明疊圖,拱門不透明、
         中間鏤空)疊在 `load.png` 之上**毫無視覺差異**——因為兩張圖在柱子/拱門這段的雕花花紋根本
         幾乎一樣(同一組素材的兩個版本,只差中間鏤空與否),疊上去等於重複畫兩次同樣的柱子,
         開關疊圖前後截圖逐像素比對完全相同,證實 load1.png 在這個裁切位置沒有任何作用。
         **正解(使用者釐清)**:桌機版有角色時之所以看起來自然、沒有黑方塊接縫,是因為桌機的
         拱門「鏤空範圍內」本來就是純黑(跟角色立繪自己的黑底完全融合、色塊一樣就看不出接縫),
         拱門雕花本身(不透明的部分)才有質感/顏色——不是靠場景圖也不是靠疊圖遮蓋,是「黑對黑天生
         無縫」+「拱門雕花框在外圍露出」這兩件事各自負責。改成:**鏤空範圍直接用純黑填色**(跟
         角色黑底同色系,不使用 load.png 場景圖裁切),`load1.png` 疊圖負責顯示拱門雕花本體(不透明
         部分自然蓋在黑底外圍)——這樣角色黑底跟周圍黑色完全融合(不會再有方塊接縫),拱門雕花清楚
         可見(不再跟任何場景圖搶對比度),兩個訴求分開處理、互不干擾。 */
      'body.m-mobile #load-slot-grid{flex:1 1 auto !important;min-height:0 !important;position:relative !important;left:auto !important;top:auto !important;width:100% !important;height:auto !important;display:block !important;background:#040302;overflow:hidden;}',
      /* 拱門雕花疊圖:獨立 div,插在 #load-slot-grid 內部、inset:0 貼滿同一個容器,z-index 蓋在
         角色卡片之上——不透明的拱門雕花部分自然疊在角色黑底外圍,鏤空透明部分露出角色與底下純黑。
         裁切座標沿用 ensureLoadArchOverlay() 算好的固定像素(x=170~330/y=30 起,見上方函式)。 */
      /* 2026-07-13 修正:漏了 body.m-mobile 前綴,導致切回桌機後這條規則不受裝置 class 限制,
         殘留的 DOM 節點(見下方 apply() 的清除補丁)沒清乾淨前還是會被畫出來、疊在桌機版自己
         的背景圖上(使用者回報「縮小視窗再放大,多了一層拱門圖,要重整才消失」)。 */
      'body.m-mobile #m-load-arch-overlay{position:absolute;inset:0;z-index:5;pointer-events:none;background-image:url(public/assets/login/load1.png);background-repeat:no-repeat;}',
      'body.m-mobile .load-slot-card{display:none !important;position:absolute !important;inset:0 !important;width:100% !important;height:100% !important;align-items:center !important;justify-content:center !important;}',
      'body.m-mobile .load-slot-card.selected{display:flex !important;}',
      'body.m-mobile .load-slot-card img{max-width:68% !important;max-height:82% !important;}',
      /* 🎨 2026-07-12 使用者第三輪回饋:拿掉左右‹›切換箭頭,改成素質表下方「8 顆存檔位按鈕」
         (4個一排、兩排),按鈕顯示角色名稱(空存檔顯示「空」),點哪顆就預覽哪一格——比「一格一格翻」
         更快能跳到想看的存檔位。見 ensureLoadSelectSlotPicker()。 */
      'body.m-mobile #m-load-slotpicker{flex:0 0 auto !important;display:grid !important;grid-template-columns:repeat(4,1fr) !important;gap:6px !important;padding:8px 12px 0 !important;}',
      'body.m-mobile #m-load-slotpicker button{height:34px;border-radius:8px;border:1px solid rgba(198,156,74,.55);background:rgba(20,16,10,.85);color:#d8bf79;font-size:12px;padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      'body.m-mobile #m-load-slotpicker button.active{border:2px solid #e8c97a;background:linear-gradient(180deg,rgba(139,103,55,.94),rgba(60,38,20,.95));color:#fff1ba;box-shadow:0 0 8px rgba(232,201,122,.5);}',
      'body.m-mobile #load-info-panel{flex:0 0 auto !important;position:relative !important;left:auto !important;top:auto !important;width:100% !important;height:auto !important;margin:0;padding:10px 12px;border:1px solid rgba(198,156,74,.55);border-radius:12px;background:rgba(10,8,5,.85);pointer-events:auto !important;display:grid !important;grid-template-rows:repeat(7,auto) !important;grid-auto-flow:column !important;grid-auto-columns:1fr !important;column-gap:12px !important;}',   /* 桌機是「左欄7項(名稱/血盟/職業...)、右欄7項(等級/力量...)」各自 absolute 定位,DOM 順序天生也是先左欄7個再右欄7個——grid-auto-flow:column 讓手機版沿用同一組左右分欄,不必重排 DOM */
      'body.m-mobile .load-info-row{position:relative !important;left:auto !important;top:auto !important;width:auto !important;height:auto !important;display:flex !important;justify-content:space-between !important;gap:6px;padding:2px 0;font-size:12px !important;border-bottom:1px solid rgba(150,115,70,.25);}',
      'body.m-mobile .load-info-row span{display:inline !important;color:#c8b489;}',   /* 桌機那條規則把 span(欄位名稱)隱藏、只留數值——手機要看得到欄位名稱才知道對應哪個屬性,加回來 */
      'body.m-mobile .load-info-row strong{min-width:0 !important;width:auto !important;padding:0 !important;text-align:right !important;font-size:12px !important;}',
      'body.m-mobile #load-action-panel{flex:0 0 auto !important;position:relative !important;left:auto !important;top:auto !important;width:100% !important;margin:0;padding:10px 12px calc(10px + env(safe-area-inset-bottom));display:grid !important;grid-template-columns:repeat(3,1fr) !important;gap:8px !important;}',
      'body.m-mobile #load-action-panel button{height:40px !important;border-radius:10px !important;font-size:13px !important;}',
      'body.m-mobile #load-btn-enter{grid-column:1/-1 !important;height:46px !important;font-size:16px !important;}',

      /* 載入進度畫面(#slot-list):原作每列是 [載入存檔 flex-1][動作區固定 w-56=224px → 匯入進度(+復原備份)]。
         手機窄寬下 224px 的動作區吃掉約 6 成,左側真正要點的「載入存檔」被擠成細條、存檔名稱被迫折成多行。
         改成左 2/3 給載入存檔、右 1/3 放動作區,匯入/復原在右側上下堆疊。scope 在 #slot-list 直接子層,
         原作改版(換 id / 重排)規則自動失效、桌機不受影響。
         #slot-list 改 grid + grid-auto-rows:1fr → 每列自動拉成跟最高那列等高(有/無備份、名稱折一行或兩行都一致),
         不寫死高度、名稱變長也會自己同步。 */
      'body.m-mobile #slot-list{display:grid !important;grid-template-columns:minmax(0,1fr) !important;grid-auto-rows:1fr !important;max-height:none !important;overflow:visible !important;}',   /* 拆掉內層捲動:原生 max-h-[85vh]+overflow-y-auto 會與外層 #creation-screen 形成雙 scrollbar,手機改讓整頁(外層)單一捲動 */
      'body.m-mobile #slot-list > div{flex-wrap:nowrap !important;align-items:stretch !important;}',
      /* 載入存檔鈕:左 2/3。沿用原作者渲染的內容(大頭貼 + 單行 label,含經典/傳統標籤與配色),手機只調版面:
         解除桌機的 truncate 讓整串 label 換行、置中、大頭貼放大。額外的 📍/⏱ 由 afk-slotinfo.js 附加為 .afk-slot-extra。 */
      'body.m-mobile #slot-list > div > button:first-child{flex:2 1 0 !important;min-width:0 !important;justify-content:center !important;flex-wrap:wrap !important;gap:2px 6px !important;line-height:1.3 !important;padding:.5rem .35rem !important;}',
      'body.m-mobile #slot-list > div > button:first-child > span{white-space:normal !important;overflow:visible !important;text-overflow:clip !important;text-align:center !important;font-size:.92rem !important;}',   /* 解除桌機 truncate,讓「存檔N 職業 Lv 暱稱(模式)」整串換行顯示 */
      'body.m-mobile #slot-list > div > button:first-child > img{width:40px !important;height:40px !important;}',   /* 👤 大頭貼放大(用原作者 img,不再自建 .m-slot-av) */
      'body.m-mobile #slot-list .afk-slot-extra{font-size:.78rem !important;}',   /* 📍 掛機地點 / ⏱ 已掛機多久:afk-slotinfo.js 附加,手機微調字級 */
      'body.m-mobile #slot-list > div > div{width:auto !important;flex:1 1 0 !important;min-width:0 !important;flex-direction:column !important;}',   /* 動作區:右 1/3,蓋掉固定 w-56,匯入/復原改上下堆疊 */
      'body.m-mobile #slot-list > div > div > button{flex:1 1 0 !important;padding:.5rem .25rem !important;font-size:.8rem !important;}',   /* 匯入/復原:各佔右側一半高 */

      /* 🌡️ 手機降溫:把「無限循環的 drop-shadow/filter 呼吸動畫」改成靜態光暈(取原 keyframe 中間亮度)。
         這些 filter 動畫每一幀都要 GPU 重算濾鏡,幾十個元素同時跑(背包發光裝備/怪物恩賜/席琳字樣)是手機
         持續發熱的大宗;改靜態後「有光暈的樣子」保留、只是不再呼吸,GPU 只在元素真的變化時重算一次。
         桌機(無 body.m-mobile)完全不受影響。原 keyframe 改版時這裡只是蓋不到新 class、自動失效無害。 */
      'body.m-mobile .legend-glow{animation:none !important;filter:drop-shadow(0 0 6px rgba(217,138,4,.85));}',
      'body.m-mobile .mana-glow{animation:none !important;filter:drop-shadow(0 0 6px rgba(56,189,248,.85));}',
      'body.m-mobile .grace-glow{animation:none !important;filter:drop-shadow(0 0 6px rgba(239,68,68,.8));}',
      'body.m-mobile .sherine-glow-icon{animation:none !important;filter:drop-shadow(0 0 6px rgba(74,222,128,.75));}',
      'body.m-mobile .c-sherine{animation:none !important;text-shadow:0 0 5px rgba(74,222,128,.7),0 0 12px rgba(74,222,128,.45);}',
      'body.m-mobile .bless-glow{animation:none !important;filter:drop-shadow(0 0 7px rgba(250,204,21,.8));}',
      'body.m-mobile .curse-glow{animation:none !important;filter:drop-shadow(0 0 7px rgba(255,32,32,.8));}',
      'body.m-mobile .ancient-glow{animation:none !important;filter:drop-shadow(0 0 7px rgba(168,85,247,.8));}',
      'body.m-mobile .anc-bless-glow{animation:none !important;filter:drop-shadow(0 0 9px rgba(243,188,72,1)) drop-shadow(0 0 20px rgba(192,132,252,.7)) brightness(1.4) saturate(1.8);}',
      'body.m-mobile .ancient-glow-strong{animation:none !important;filter:drop-shadow(0 0 10px rgba(184,104,250,1)) drop-shadow(0 0 22px rgba(150,60,235,.7)) brightness(1.4) saturate(1.8);}',
      'body.m-mobile .bless-glow-strong{animation:none !important;filter:drop-shadow(0 0 10px rgba(253,224,71,1)) drop-shadow(0 0 22px rgba(234,180,20,.7)) brightness(1.4) saturate(1.8);}',
      'body.m-mobile .tri-glow{animation:none !important;filter:drop-shadow(0 0 10px rgba(245,158,11,1)) drop-shadow(0 0 24px rgba(239,68,68,.6)) brightness(1.5) saturate(1.9);}',

      /* 2026-07-08(待辦問題3):手機上藏掉原作者桌機 hover tooltip(js/14-craft-pandora.js 的 .game-tooltip,
         只綁 mousemove、沒有延遲判斷)。手機單純點一下也會補發相容用的合成 mousemove,會讓它瞬間跳出來,
         跟本外掛長按 1 秒才顯示的 #m-tip-modal 打架(玩家感覺「兩套 tooltip、延遲不受控」)。
         只藏顯示、不移除 DOM——initTipPeek() 的 skillDetailHTML() 仍會借它的 innerHTML/getBoundingClientRect
         取技能說明,隱藏不影響讀取。 */
      'body.m-mobile .game-tooltip{display:none !important;}',

      /* 2026-07-08(使用者回報快速強化/快速廢品/批次販賣按鈕底圖一閃一閃):根因是共用元件 .btn
         (css/style.css)設了 transition:all 0.2s、只有 :hover 底色、沒有 :active 回饋、也沒關閉
         -webkit-tap-highlight-color。手機瀏覽器點一下常會短暫誤套用 :hover 偽類("sticky hover")+
         系統預設灰色 tap-highlight,疊上 0.2s 漸變,視覺上就是「淡入又淡出」的閃爍。全站 .btn 都有
         這個缺口(不只這三顆),故全站套用:關掉 tap-highlight、拿掉 transition(讓瞬間誤觸的 hover
         狀態不被動畫放大),改用 filter:brightness() 給按下回饋(不需知道每顆按鈕各自的底色)。 */
      'body.m-mobile .btn{-webkit-tap-highlight-color:transparent;transition:none !important;}',
      'body.m-mobile .btn:active:not(:disabled){filter:brightness(.82);}'
    ].join('\n');
    var s = document.createElement('style');
    s.id = 'm-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // --- 手機輸入框 focus 自動放大畫面(2026-07-08 待辦#7)--------------------------
  //   問題:iOS Safari 規則——聚焦的 input/textarea「有效字體 < 16px」時,瀏覽器會自動放大畫面
  //   讓文字看得清楚(跟 index.html 開頭的 viewport DESIGN_W=1180 縮放無關;實測手機尺寸下
  //   afk-mobile 啟用時 viewport 其實已是 device-width,純粹是站內大量輸入框吃 Tailwind
  //   text-sm/text-xs(12~14px)小於門檻觸發)。放大後遊戲版面被撐開、玩家要手動縮小很煩。
  //   解法:輸入框 focus 時,把 viewport meta 暫時加上 `maximum-scale=1`(明確告訴瀏覽器
  //   目前不准縮放,自動放大就不會發生);blur 時還原成 focus 前的原始 content,不影響正常
  //   手動縮放/捲動。用 focusin/focusout(會冒泡)委派在 document 上,涵蓋站上所有輸入框
  //   (靜態 HTML + 之後動態產生的搜尋欄/數量輸入框都一併涵蓋),不用逐一綁定。
  function initInputZoomGuard() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    var savedContent = null;
    function isTextInput(t) {
      if (!t || !t.tagName) return false;
      if (t.tagName === 'TEXTAREA') return true;
      if (t.tagName !== 'INPUT') return false;
      var type = (t.getAttribute('type') || 'text').toLowerCase();
      return ['text', 'number', 'search', 'tel', 'email', 'password', 'url'].indexOf(type) !== -1;
    }
    document.addEventListener('focusin', function (e) {
      if (!document.body.classList.contains('m-mobile') || !isTextInput(e.target)) return;
      if (savedContent === null) savedContent = meta.getAttribute('content');
      if (!/maximum-scale/.test(savedContent)) meta.setAttribute('content', savedContent + ',maximum-scale=1');
    }, true);
    document.addEventListener('focusout', function (e) {
      if (!document.body.classList.contains('m-mobile') || !isTextInput(e.target) || savedContent === null) return;
      // 延遲還原:切換到下一個輸入框(Tab/點下一格)時中間會先觸發 focusout 再 focusin,
      //   若在還沒確定下一個焦點落在哪之前就立刻還原,連續切換輸入框時畫面會一直閃爍縮放。
      setTimeout(function () {
        var active = document.activeElement;
        if (isTextInput(active)) return;   // 焦點換到另一個輸入框:維持鎖定,等真的離開輸入框才還原
        meta.setAttribute('content', savedContent);
        savedContent = null;
      }, 50);
    }, true);
  }

  // --- 手機「長按物品看詳情」:取代桌機 hover tooltip(原作只綁 mousemove,手機觸發不到)。
  //   長按任一 .tip-host(倉庫/背包/商店/製作/裝備欄的物品)約 500ms → 彈出資訊卡;短按維持原動作。
  //   內容沿用原作全域函式(getItemFullName/buildItemDescHTML/getItemColor),不重寫資料、不改原作碼。

  function initTipPeek() {
    if (document.getElementById('m-tip-modal')) return;
    var modal = document.createElement('div');
    modal.id = 'm-tip-modal';
    var card = document.createElement('div');
    card.id = 'm-tip-card';
    modal.appendChild(card);
    document.body.appendChild(modal);

    var modalOpen = false, swallow = false, swallowTimer = null, swallowHost = null, ICON2ID = null;

    // 圖示 src → 基底物品 id(商店/製作清單的圖示沒有 data-tip-uid,只能靠圖反查)
    function iconToId(src) {
      if (typeof DB === 'undefined' || !DB.items || typeof getIconUrl !== 'function') return null;
      if (!ICON2ID) { ICON2ID = {}; for (var id in DB.items) { var d = DB.items[id]; if (d) { try { ICON2ID[getIconUrl(d)] = id; } catch (e) {} } } }
      return ICON2ID[src] || null;
    }
    // 解析一個 .tip-host 對應的物品 → {name, body, color};解析不出(非物品)回 null,讓它走一般操作
    function resolve(host) {
      var base = null;
      var uid = host.getAttribute('data-tip-uid');
      if (uid) {
        var src = host.getAttribute('data-tip-src') || 'inv';
        try {
          if (src === 'wh' && typeof loadWarehouse === 'function') { var w = loadWarehouse(); base = (w && w.items) ? w.items.filter(function (x) { return x.uid === uid; })[0] : null; }
          else if (typeof player !== 'undefined' && player && player.inv) { base = player.inv.filter(function (x) { return x.uid === uid; })[0]; }
        } catch (e) {}
        if (!base) return null;
      } else {
        var img = host.querySelector('img');
        var s = img ? img.getAttribute('src') : null;
        var rid = s ? iconToId(s) : null;
        if (!rid) return null;
        base = { id: rid, en: 0 };
      }
      return {
        name: (typeof getItemFullName === 'function') ? getItemFullName(base) : (base.id || ''),
        body: (typeof buildItemDescHTML === 'function') ? buildItemDescHTML(base) : '',
        color: (typeof getItemColor === 'function') ? (getItemColor(base) || '') : ''
      };
    }
    // 解析「靠 title 顯示說明」的元素(如 50 等漢的專精選擇按鈕,完整效果說明放在 title)。
    function resolveTitle(host) {
      var t = (host.getAttribute('title') || '').trim();
      if (!t) return null;
      var nameEl = host.querySelector ? host.querySelector('.font-bold, b, strong') : null;   // 按鈕內粗體=該項名稱(如精通名)
      return { name: nameEl ? nameEl.textContent.trim() : '', body: t.replace(/\n/g, '<br>'), color: '' };
    }
    // 技能詳情 HTML:借遊戲自己的技能 tooltip(它把 buildSkillTipHTML 寫進 .game-tooltip)再取出重用,
    //   不另寫一份格式邏輯(作者改技能呈現會自動跟上)。取不到就回空字串、優雅降級(點了沒事,等同原本)。
    function skillDetailHTML(host) {
      if (!host || !host.getAttribute('data-tip-skill')) return '';
      try {
        var r = host.getBoundingClientRect();
        host.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      } catch (e) { return ''; }
      var gt = document.querySelector('.game-tooltip');
      if (!gt) return '';
      var html = gt.innerHTML || '';
      gt.style.display = 'none';   // 取出後收掉遊戲 hover tooltip,只用手機卡片呈現
      return html;
    }
    function open(c) {
      card.innerHTML = '<button type="button" class="m-tip-x">✕</button>'
        + '<div class="m-tip-name ' + c.color + '">' + c.name + '</div>'
        + '<div class="m-tip-body">' + c.body + '</div>';
      card.querySelector('.m-tip-x').addEventListener('click', function (e) { e.stopPropagation(); close(); });
      modal.classList.add('open'); modalOpen = true;
    }
    // 技能詳情:直接放整段 HTML(技能 tooltip 自帶名稱),不套 name 區塊
    function openRaw(bodyHTML) {
      card.innerHTML = '<button type="button" class="m-tip-x">✕</button><div class="m-tip-body">' + bodyHTML + '</div>';
      card.querySelector('.m-tip-x').addEventListener('click', function (e) { e.stopPropagation(); close(); });
      modal.classList.add('open'); modalOpen = true;
    }
    function close() { modal.classList.remove('open'); modalOpen = false; }
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

    // 長按開卡後,吞掉緊接而來那一下 click(避免長按結束被當成存入/取出/購買);卡片內的點擊不吞。
    // 2026-07-08(手機背包點擊不順回報):原本只判斷「不是點在卡片裡」就整個吞掉,沒比對這次點擊
    // 是不是打在「剛才長按的那個 host」上,導致長按看過任一物品後 800ms 內,點背包裡任何按鈕
    // (含快速強化/廢品/批次販賣)都可能被誤吞、需要點第二下。改成只吞「同一個 host」上的那一下。
    function arm() { swallow = true; swallowHost = host; clearTimeout(swallowTimer); swallowTimer = setTimeout(function () { swallow = false; swallowHost = null; }, 800); }
    document.addEventListener('click', function (e) {
      if (!swallow || modal.contains(e.target)) return;
      if (!swallowHost || (e.target !== swallowHost && !(swallowHost.contains && swallowHost.contains(e.target)))) return;
      swallow = false; swallowHost = null; clearTimeout(swallowTimer); e.preventDefault(); e.stopImmediatePropagation();
    }, true);

    // 🔧 手機:點一下「非手動」技能格(div[data-tip-skill])→ 顯示技能詳情卡。
    //   手動技能是 <button onclick=manualCast>(右下角「施」),不在此攔截 → 維持點擊施放;其詳情走長按。
    document.addEventListener('click', function (e) {
      if (!document.body.classList.contains('m-mobile') || modalOpen) return;
      if (!e.target || !e.target.closest) return;
      var cell = e.target.closest('div[data-tip-skill]');
      if (!cell) return;
      var sh = skillDetailHTML(cell);
      if (!sh) return;
      e.preventDefault(); e.stopPropagation();
      openRaw(sh);
    }, false);

    var timer = null, sx = 0, sy = 0, host = null, hostKind = 'item';
    document.addEventListener('touchstart', function (e) {
      if (!document.body.classList.contains('m-mobile') || modalOpen) return;
      if (!e.target || !e.target.closest) return;
      var h = e.target.closest('.tip-host'), titleEl = null;
      if (!h) {   // 不是物品圖示 → 看是不是 NPC 面板裡「靠 title 顯示說明」的元素(如專精按鈕)
        var ic = document.getElementById('interaction-content');
        var te = e.target.closest('[title]');
        if (te && ic && ic.contains(te) && (te.getAttribute('title') || '').trim()) titleEl = te;
      }
      if (!h && !titleEl) return;
      host = h || titleEl; hostKind = h ? (h.getAttribute('data-tip-skill') ? 'skill' : 'item') : 'title';
      var t = e.touches[0]; sx = t.clientX; sy = t.clientY;
      clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        if (hostKind === 'skill') { var sh = skillDetailHTML(host); if (!sh) return; openRaw(sh); arm(); return; }   // 長按技能(含手動技能):看詳情
        var c = (hostKind === 'item') ? resolve(host) : resolveTitle(host);
        if (!c) return;        // 解析不出內容 → 不開卡,維持一般操作
        open(c); arm();
      }, 1000);   // 2026-07-08(待辦問題3):使用者要求統一拉長到 1 秒(350ms→500ms→1000ms),搭配上方 .game-tooltip 隱藏,手機上只剩這一套 tooltip
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (timer === null) return;
      var t = e.touches[0]; if (!t) return;
      if (Math.abs(t.clientX - sx) > 12 || Math.abs(t.clientY - sy) > 12) { clearTimeout(timer); timer = null; }   // 移動=捲動,取消長按
    }, { passive: true });
    function endPress() { clearTimeout(timer); timer = null; }
    document.addEventListener('touchend', endPress, { passive: true });
    document.addEventListener('touchcancel', endPress, { passive: true });
    // 壓抑 Android/iOS 長按在圖示/說明按鈕上跳出的選單、儲存圖片 callout、選字
    document.addEventListener('contextmenu', function (e) {
      if (!document.body.classList.contains('m-mobile') || !e.target || !e.target.closest) return;
      var ic = document.getElementById('interaction-content');
      if (e.target.closest('.tip-host') || (ic && e.target.closest('[title]') && ic.contains(e.target.closest('[title]')))) e.preventDefault();
    });

    preventDoubleTapZoom();
  }

  // 2026-07-13:手機版取消雙擊縮放,保留雙指縮放。不能用 viewport user-scalable=no / CSS
  // touch-action:manipulation 全域套用(那樣連雙指縮放也會被關掉)——改在 document 層級攔截
  // touchend:兩次「單指」touchend 間隔 <300ms 判定為雙擊才 preventDefault;只要曾經是多指觸控
  // (雙指縮放手勢),就放行不攔截,避免誤傷雙指縮放。
  function preventDoubleTapZoom() {
    var lastTouchEnd = 0;
    var wasMultiTouch = false;
    document.addEventListener('touchstart', function (e) {
      if (e.touches.length > 1) wasMultiTouch = true;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!document.body.classList.contains('m-mobile')) return;
      var now = Date.now();
      if (e.changedTouches.length === 1 && e.touches.length === 0 && !wasMultiTouch) {
        if (now - lastTouchEnd <= 300) e.preventDefault();
        lastTouchEnd = now;
      }
      if (e.touches.length === 0) wasMultiTouch = false;   // 所有手指離開後重置,不影響下一次判斷
    }, { passive: false });
  }

  // 🔒 零接觸桌機:init() 會插入手機元素、搬動戰鬥/系統日誌、改地圖標題列等——這些都動到原作者既有 DOM。
  //   為了讓本外掛「永遠不可能弄壞桌機版」(省去每次作者改版都要用 Playwright 驗桌機),改成只有「真的是手機
  //   尺寸/裝置」時才呼叫 init();桌機(且視窗沒縮窄)整支 init 不執行 → 原作者桌機 DOM 一字不動。
  //   視窗縮窄/旋轉成手機尺寸時再 lazy 跑一次 init();init() 內部自帶 mql/orientationchange 監聽,接手後續手機↔桌機切換。
  var _mql = window.matchMedia(MQ);
  var _mInited = false;
  function _isMobileNow() {
    var sc = window.__mobileScaling;
    var dev = (sc && typeof sc.isMobileDevice === 'function') ? sc.isMobileDevice() : false;
    return dev || _mql.matches;   // 與 init 內 detectMobile 同邏輯:裝置(粗指標/UA)或窄視窗任一即手機
  }
  function _maybeInit() { if (_mInited || !_isMobileNow()) return; _mInited = true; init(); }
  if (_mql.addEventListener) _mql.addEventListener('change', _maybeInit);
  else if (_mql.addListener) _mql.addListener(_maybeInit);
  window.addEventListener('orientationchange', _maybeInit);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _maybeInit);
  else _maybeInit();
})();
