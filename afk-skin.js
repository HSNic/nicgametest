/* ============================================================================
 * afk-skin.js — 首頁「加掛版」品牌標記 + 外掛入口收納（純視覺、不動遊戲邏輯）
 *
 * 只動首頁 #creation-screen / #main-menu 的外觀,不碰存檔/遊戲函式:
 *   1. 標題下方放一個會上下微微飄動的「加掛版」雲朵副標。
 *   2. 外掛入口(掉落查詢/小百科/其他功能)的收納:桌機/手機都用同一套「半透明外框
 *      直接展開」(afk-plugin-frame),不分裝置(2026-07-09 使用者明訂:桌機也要跟
 *      手機一樣全部展開在頁面上,不用點開才看得到;就算項目變多、頁面變長也接受)。
 *      ⚠ 舊版桌機曾經用「一顆按鈕收合成 Modal」(理由:作者 v3.0.40 起首頁改成固定
 *      4:3 藝術舞台,#main-menu 高度固定、不捲動,擔心入口全展開會擠爆),已依需求
 *      移除;如果之後真的因為外掛項目變多、桌機出現擠爆/裁切,要恢復 Modal 收合前
 *      先跟使用者確認,不要自己默默加回去。
 *      🩹 2026-07-13:寬螢幕但視窗不夠高時,#main-menu 疊了「外掛/其他功能」方格後
 *      總高度真的會超出 4:3 舞台(舞台 overflow:hidden,超出部分會被整段裁掉、玩家
 *      完全看不到、也摸不到)。踩過一次「改成可捲動」的修法,使用者不滿意(捲出去後
 *      視覺上跑到背景圖之外,且事前沒問過使用者就直接動手,違反「任何修改先問過
 *      同意」的鐵律)。改採使用者選定的方向:偵測到會超出舞台時,把整個 #main-menu
 *      等比縮小(transform:scale,顯示上還是「塞在」背景舞台範圍內),塞得下時完全
 *      不縮放、外觀不變(見 fitMainMenu())。
 *   3. 外掛入口按鈕套用原版首頁按鈕的皮(深藍漸層+金邊,抄 css/style.css 的
 *      #main-menu > button),讓外掛鈕與作者的按鈕風格一致。
 *
 * 作法:外掛元素是別支外掛(afk-dex/afk-wiki/afk-storage)append 到 #main-menu 的,
 *   本檔載入順序排最後、並用 MutationObserver + 重試,等它們到齊再把它們收進外框(idempotent)。
 * 掛接:在 </body> 前 <script src="afk-skin.js?v=..."></script>(排在其他 afk-* 之後)。
 * ========================================================================== */
(function () {
  'use strict';

  // 外掛入口的「顯示順序」(都是 #main-menu 的子孫;依此序排入外框)。
  //   2026-07-08 起 afk-syncinfo.js 不再輸出 DOM(A1 面板文字精簡),原本置頂的
  //   #afk-syncinfo / 排在後段的 #afk-syncinfo-links 已從順序移除,只剩查詢/小百科/設定。
  //   🎨 2026-07-11 首頁 V17 改版:#afk-stg-wrap(⚙其他功能 齒輪+下拉選單)移出這個框,
  //   改成獨立放在框的下方(見 ensureFrame 尾端)。
  //   🎨 2026-07-11 使用者回饋再調整:「外掛」框只留掉落查詢/小百科兩個大方格(呼應 V17
  //   原設計的 3 格大工具列);備份管理/批次結算改移到獨立的「其他功能」小方格區
  //   (見 ensureOtherFrame),用較小的按鈕呈現、但顏色仍與外掛方格一致(同一組藍色漸層)。
  //   🎨 2026-07-13 使用者再次調整:雲端同步/批次結算/角色背包(新增)三顆小方格,改成
  //   緊貼在掉落查詢/小百科方格列「正下方、同一個外框內」,不再另開一個有獨立標題的
  //   「其他功能」框(見下方 ensureFrame,tiles 直接 append 進 #afk-plugin-frame)。
  var FRAME_ORDER = ['.m-dex-entry-row', '.m-wiki-entry-row'];
  // 從 AFK_SETTINGS._items 找這些項目、升格成獨立方格(不再顯示於 ⚙其他功能 下拉選單,
  // 已在 afk-storage.js 的 PROMOTED_TO_TILE 排除)。label 要跟各自的 AFK_SETTINGS.add() 完全一致。
  // 「角色背包」只是顯示名稱改了,底層仍是 afk-asset-manager.js 的角色資產管理功能。
  var PROMOTED_TILES = [
    { key: 'cloud-sync', srcLabel: '☁️ 配對碼雲端同步', icon: '☁️', label: '備份管理' },
    { key: 'batch-settle', srcLabel: '⏱️ 批次結算', icon: '⏱️', label: '批次結算' },
    { key: 'asset-manager', srcLabel: '🏦 角色資產管理', icon: '🎒', label: '角色背包' }
  ];

  // ---- CSS ----------------------------------------------------------------
  var CSS = [
    /* 標題下方兩行副標:「(加掛版)」+ 加掛版版本號(A2 移除舊的雲朵 icon、A3 改成純文字兩行,同字體同色) */
    /* 浮在標題區下方、置中、絕對定位(不佔版面、不把按鈕往下推) */
    '#afk-brand-badge{position:absolute;left:50%;bottom:-34px;transform:translateX(-50%);z-index:6;pointer-events:none;text-align:center;}',
    '#afk-brand-badge .afk-brand-line{font-size:14px;font-weight:800;letter-spacing:1.5px;color:#fde68a;text-shadow:0 1px 2px rgba(0,0,0,.75),0 0 6px rgba(0,0,0,.4);white-space:nowrap;line-height:1.5;}',
    /* 桌機:作者藝術舞台的標題層(#login-title-layer,text-center)是獨立圖層,原本 absolute
       bottom:-34px 會讓副標懸空、脫離標題看起來很怪 → 改成正常流、置中排在標題下方,像標題的一部分。
       (手機維持 absolute;現況良好、勿動) */
    'body:not(.m-mobile) #afk-brand-badge{position:static;left:auto;bottom:auto;transform:none;display:block;margin:6px auto 0;text-align:center;}',
    /* 手機(body.m-mobile;此版用 viewport=1180 縮放,純寬度 media query 失效,故靠 m-mobile class)：字略縮一點 */
    'body.m-mobile #afk-brand-badge .afk-brand-line{font-size:12px;letter-spacing:1px;}',

    /* 外掛區外框:2026-07-11 依使用者提供的 V17 參考稿改成「金色 fieldset + 2x2 方格」風格,
       呼應首頁登入畫面的黑金改版——桌機/手機共用同一套,不分裝置 */
    '#afk-plugin-frame{position:relative;width:100%;max-width:22rem;margin:8px auto 0;padding:20px 14px 16px;',
      'border:1px solid rgba(190,145,75,.72);border-radius:16px;background:rgba(6,5,4,.48);',
      'box-shadow:inset 0 0 18px rgba(0,0,0,.5),0 4px 18px rgba(0,0,0,.20);',
      'display:grid;grid-template-columns:repeat(2,1fr);gap:10px;}',
    /* 框上的「外掛」標籤,坐在上緣(像 fieldset 標題) */
    '#afk-plugin-frame .afk-frame-label{position:absolute;top:-12px;left:50%;transform:translateX(-50%);',
      'padding:2px 14px;font-size:12.5px;font-weight:700;letter-spacing:2px;color:#ead09a;',
      'background:linear-gradient(180deg,#1d1710,#090704);',
      'border:1px solid rgba(190,145,75,.78);border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.4);white-space:nowrap;}',
    /* 方格容器(m-dex-entry-row/m-wiki-entry-row):本身就是一個 grid 儲存格。
       2026-07-12 使用者要求:↗新分頁鈕改放方格「下方」(不再浮在角落),故容器改直向排列
       (主方格在上、↗鈕在下),兩者寬度一致。 */
    '#afk-plugin-frame .m-dex-entry-row,#afk-plugin-frame .m-wiki-entry-row{position:relative;display:flex;flex-direction:row;gap:6px;}',


    /* 工具方格按鈕(掉落查詢/小百科)+ 其他功能小按鈕(備份管理/批次結算):圖示在上、文字在下,
       呼應 V17 的 3x1 工具格。⚠ 2026-07-11 使用者依實際 V17 渲染截圖糾正:工具方格是「藍色」
       (跟戰鬥特效/傷害數字開關同一組藍色,非黑金棕色)——套 V17 的 --blue1/--blue2 漸層,不是黑金漸層
       (黑金只用在主要功能鈕本身)。2026-07-11 再次確認:「其他功能」小按鈕(.afk-tile-btn-sm)
       也要維持同一組藍色漸層,不要另外分色。 */
    '#main-menu .m-dex-entry-row > button,#main-menu .m-wiki-entry-row > button,#main-menu .afk-tile-btn,#main-menu .afk-tile-btn-sm{',
      'border-color:#80623d;background:linear-gradient(180deg,#16385f,#08192e);',
      'color:#efe2c8;text-shadow:0 1px 2px #000;box-shadow:inset 0 1px 0 rgba(255,255,255,.22),inset 0 -3px 0 rgba(0,0,0,.32),0 5px 12px rgba(0,0,0,.55);}',
    '#main-menu .m-dex-entry-row > button:hover,#main-menu .m-wiki-entry-row > button:hover,#main-menu .afk-tile-btn:hover,#main-menu .afk-tile-btn-sm:hover{filter:brightness(1.12);transform:translateY(-1px);}',
    /* 「其他功能」小按鈕:橫向排列(圖示+文字同一行),比主要工具方格矮(呼應 V17「other」按鈕的 40px 高度) */
    '#main-menu .afk-tile-btn-sm{width:100%;min-height:40px;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:6px;',
      'padding:8px 6px;font-size:clamp(9px,0.95vw,12px);line-height:1.15;}',
    'body.m-mobile #main-menu .afk-tile-btn-sm{font-size:11.5px;min-height:42px;}',
    /* ⚙其他功能齒輪鈕維持黑金(它不是 V17 的工具方格,是我們自己的下拉選單開關,獨立於方格外) */
    '#main-menu #afk-stg-gear{',
      'border-color:#b68a39;background:linear-gradient(180deg,rgba(139,103,55,.94) 0%,rgba(60,38,20,.95) 47%,rgba(20,13,7,.96) 100%);',
      'color:#f8e7bb;text-shadow:0 1px 2px #000;box-shadow:inset 0 1px 0 rgba(255,240,203,.28),inset 0 -2px 4px rgba(0,0,0,.5),0 3px 8px rgba(0,0,0,.45);}',
    '#main-menu #afk-stg-gear:hover{filter:brightness(1.15);transform:translateY(-1px);}',
    /* 主入口鈕(含升格方格)改直向堆疊:圖示一行、文字一行,對齊 V17「icon<br>label」的方格外觀 */
    '#main-menu .m-dex-entry-main,#main-menu .m-wiki-entry-main,#main-menu .afk-tile-btn{',
      'width:100%;min-height:72px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;',
      'padding:10px 6px;font-size:clamp(9px,1.03vw,13px);line-height:1.15;}',
    '#main-menu .m-dex-entry-icon{font-size:1.6em;line-height:1;}',
    '#main-menu .m-dex-entry-label{white-space:normal;}',
    /* 手機:afk-mobile 把原版按鈕釘死字級(vw 字級在縮放 viewport 下失準),方格鈕跟進 */
    'body.m-mobile #main-menu .m-dex-entry-main,body.m-mobile #main-menu .m-wiki-entry-main,body.m-mobile #main-menu .afk-tile-btn{',
      'font-size:13px;min-height:76px;}',
    /* ↗「在新分頁開啟」小鈕:2026-07-11 使用者回饋原本疊在方格內角落「很醜」——改成浮在方格
       右上角「外側」的小圓形徽章。2026-07-12 使用者要求:改放方格「下方」,寬度跟主方格一致。
       2026-07-13 使用者再次要求:改回方格「右側」並排,高度跟主方格一樣、寬度窄。
       ⚠ afk-dex.js/afk-wiki.js 各自的 `.m-dex-entry-row > button{width:auto !important}` 規則
       選擇器比這裡更具體(多一層 > button 的 tag 選擇器)且帶 !important,故這裡的 width 也要
       加 !important 才蓋得過去。高度靠 row 的 align-items:stretch(afk-dex.js/afk-wiki.js 已設)
       自動撐到跟主方格一樣高,這裡不需另外指定 min-height。 */
    '#main-menu .m-dex-entry-newtab,#main-menu .m-wiki-entry-newtab{position:static;width:26px !important;flex:0 0 26px;',
      'padding:2px 0;display:flex;align-items:center;justify-content:center;gap:0;',
      'font-size:13px;line-height:1;border-radius:7px;',
      'border-color:#80623d;background:linear-gradient(180deg,#16385f,#08192e);color:#efe2c8;',
      'box-shadow:inset 0 1px 0 rgba(255,255,255,.18),inset 0 -2px 0 rgba(0,0,0,.3),0 3px 8px rgba(0,0,0,.45);}',
    'body.m-mobile #main-menu .m-dex-entry-newtab,body.m-mobile #main-menu .m-wiki-entry-newtab{width:24px !important;flex:0 0 24px;}',
    '#main-menu .m-dex-entry-newtab:hover,#main-menu .m-wiki-entry-newtab:hover{filter:brightness(1.15);transform:translateY(-1px);}',

    /* 🔘 2026-07-12 使用者要求:選角畫面右側「進入遊戲/創新角色/匯入進度/返回」四顆按鈕跑圓角
       (原作 css/style.css 沒設 border-radius,預設直角)。桌機/手機都套用,手機版另有自己的
       尺寸/排列覆寫(見 afk-mobile.js),圓角這條兩邊共用不重複定義。 */
    '#load-action-panel button{border-radius:8px;}',

    /* 📢 公告跑馬燈:放在 #main-menu 第一個子層(首頁按鈕上方);紅底捲動,游標移上去暫停。
       (v3.0.40 作者登入頁改成藝術舞台後,標題不再是 #creation-screen 直接子層,改錨定 #main-menu。) */
    /* flex:0 0 auto + min-height:#main-menu 是 flex column 且自身 overflow:hidden
       →min-height:auto 退化成 0→會被 flex-shrink 壓扁、把文字上下裁掉(使用者回報「高度被裁」)。鎖死不縮、給足高度。 */
    '#afk-marquee{position:relative;flex:0 0 auto;width:100%;max-width:34rem;min-height:30px;margin:0 auto;overflow:hidden;border-radius:8px;border:1px solid rgba(230,110,110,.5);background:linear-gradient(180deg,rgba(96,16,16,.82),rgba(58,8,8,.82));padding:6px 0;box-shadow:inset 0 0 14px rgba(0,0,0,.35);}',
    /* 框窄(對齊按鈕欄寬)、文字長 → 捲動文字在兩端被硬切在字中間,看起來像「被切掉」。
       對整個框(靜止的可視窗)加水平淡出遮罩:文字/紅底/邊框在兩端柔化淡出,不再是突兀的硬切直角。
       (遮罩要放在靜止的 #afk-marquee;放在會位移的 track 上淡出會跟著文字跑,固定不住框兩端。) */
    '#afk-marquee{-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 26px,#000 calc(100% - 26px),transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 26px,#000 calc(100% - 26px),transparent 100%);}',
    /* 無縫捲動:track 放兩份相同文字,translateX 只移 -50%(=一份寬)→ 看起來連續、且第一份一開始就在可視區
       (動畫沒跑/還沒開始也看得到字,不會像「padding-left:100%」那樣有一段空白期 → 修「字沒出現」)。 */
    '#afk-marquee .afk-mq-track{display:flex;width:max-content;animation:afkMq 26s linear infinite;}',
    '#afk-marquee .afk-mq-seg{flex:0 0 auto;white-space:nowrap;padding:0 1.8rem;font-size:13px;font-weight:700;letter-spacing:1px;color:#fff2f2;text-shadow:0 1px 2px #000,0 0 4px rgba(0,0,0,.8);}',
    '#afk-marquee:hover .afk-mq-track{animation-play-state:paused;}',
    '@keyframes afkMq{from{transform:translateX(0)}to{transform:translateX(-50%)}}',
    'body.m-mobile #afk-marquee{max-width:94%;}',
    'body.m-mobile #afk-marquee .afk-mq-seg{font-size:12px;letter-spacing:.5px;padding:0 1.3rem;}',
    ''
  ].join('');

  // 📢 公告跑馬燈文字:改顯示目前的加掛版版本號(讀根目錄 version.json 的 build 欄位,
  //   由 scripts/stamp-sw-version.mjs 每次改動後自動覆寫)。讀不到就退回通用文字,不影響遊戲。
  //   2026-07-07 使用者要求:拿掉原本「伺服器永久開放，但不再跟進原作者版本」的固定文字
  //   (本專案持續同步原作者版本,這句話不適用),改成動態版本號。
  var MARQUEE_TEXT = '加掛版';   // 版本號讀取前/讀取失敗的預設文字

  // 2026-07-08(A3):版本號改到標題下方顯示,這裡暫時停用(不再呼叫);若之後要恢復跑馬燈顯示版本號,
  // 把 ensureMarquee() 裡的呼叫加回來即可。
  function updateMarqueeVersion() {
    if (!/^https?:$/.test(location.protocol)) return;   // file:// 無法 fetch(CORS),維持預設文字
    fetch('version.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.build) return;
        var segs = document.querySelectorAll('#afk-marquee .afk-mq-seg');
        for (var i = 0; i < segs.length; i++) segs[i].textContent = '加掛版 build ' + j.build;
      })
      .catch(function () { /* 讀不到就維持預設文字 */ });
  }

  function injectCss() {
    if (document.getElementById('afk-skin-css')) return;
    var s = document.createElement('style'); s.id = 'afk-skin-css'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // ---- 標題下方兩行副標(A2 移除雲朵 icon、A3 改「(加掛版)」+ 加掛版版本號)--------
  function ensureBadge() {
    var cs = document.getElementById('creation-screen'); if (!cs) return;
    if (document.getElementById('afk-brand-badge')) return;
    // 錨定在「標題區(h1+副標 的容器)」下方(桌機/手機一致)。
    var h1 = cs.querySelector('h1');
    var header = h1 ? h1.parentElement : cs;
    // 🔧 2026-07-11 踩過:無條件設 position:relative 會蓋掉 #login-title-layer 自己在 css/style.css
    // 定義的 position:absolute(inline style 優先度高於外部樣式表,不受 !important 以外的規則影響)——
    // 一旦被改成 relative,原本用來定位標題的 top/left 百分比全部改成相對「直接父層」高度計算,結果整段跑位。
    // 這塊本身如果已經是 absolute/fixed/sticky,就已經是合法的定位基準,不需要再強制改成 relative。
    var curPos = getComputedStyle(header).position;
    if (curPos === 'static') header.style.position = 'relative';   // 只有真的還沒定位時才補上,不要覆蓋既有定位模式
    var b = document.createElement('div'); b.id = 'afk-brand-badge';
    b.innerHTML = '<div class="afk-brand-line">(加掛版)</div><div class="afk-brand-line afk-brand-ver"></div>';
    header.appendChild(b);
    updateBrandVersion();
  }

  // 純版本號(取自 version.json 的 build 欄位,不加「加掛版」字樣——上一行已經是「(加掛版)」)。
  function updateBrandVersion() {
    var verEl = document.querySelector('#afk-brand-badge .afk-brand-ver');
    if (!verEl) return;
    if (!/^https?:$/.test(location.protocol)) return;   // file:// 無法 fetch(CORS),維持空白
    fetch('version.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.build) verEl.textContent = j.build; })
      .catch(function () { /* 讀不到就維持空白 */ });
  }

  // ---- 公告跑馬燈(首頁按鈕上方) ------------------------------------------
  //   v3.0.40 作者登入頁改成藝術舞台(標題被包進 #login-art-stage>#login-title-layer),
  //   舊錨點「h1 父層是 #creation-screen 直接子層」不再成立、跑馬燈整個不插入(玩家回報消失)。
  //   改插在 #main-menu 第一個子層:視覺位置同樣在標題之下、按鈕之上,且不依賴作者標題結構。
  function ensureMarquee() {
    // 2026-07-08(待辦#1):使用者要求隱藏跑馬燈紅色橫條,不再建立/插入 DOM。
    // 相關 CSS(#afk-marquee 等)保留不刪,選擇器不命中則無害,方便日後想恢復時復原容易。
    return;
    // eslint-disable-next-line no-unreachable
    if (document.getElementById('afk-marquee')) return;
    var menu = document.getElementById('main-menu'); if (!menu) return;
    var mq = document.createElement('div'); mq.id = 'afk-marquee';
    var track = document.createElement('div'); track.className = 'afk-mq-track';
    for (var i = 0; i < 2; i++) {   // 兩份文字→無縫捲動;第一份開場即在可視區
      var seg = document.createElement('span'); seg.className = 'afk-mq-seg';
      if (i === 1) seg.setAttribute('aria-hidden', 'true');
      seg.textContent = MARQUEE_TEXT;
      track.appendChild(seg);
    }
    mq.appendChild(track);
    menu.insertBefore(mq, menu.firstChild);
    // A3(2026-07-08):版本號改顯示在標題下方(見 ensureBadge/updateBrandVersion),
    // 跑馬燈暫時不再顯示版本號,維持預設文字「加掛版」——不呼叫 updateMarqueeVersion()。
  }

  // ---- 外掛外框(桌機/手機共用,inline 直接展開,不收合成 Modal)----------------
  var _busy = false;
  // 找某 selector 的元素(可能已在外框內、或還在 #main-menu 直接子層)
  function findEl(menu, sel) {
    return document.querySelector('#afk-plugin-frame > ' + sel) || menu.querySelector(':scope > ' + sel);
  }
  // 找/建「升格方格」按鈕(備份管理/批次結算):來源功能是 AFK_SETTINGS._items 裡的項目,
  // 每次呼叫都重新查 visible()(例如雲端同步要「已設定配對碼」才顯示,狀態會變動)。
  // 🎨 2026-07-11:改放進獨立的「其他功能」小方格區(見 ensureOtherFrame),不再進外掛框,
  // 樣式改用 .afk-tile-btn-sm(橫向排列、較矮),故 innerHTML/className 跟著改。
  function ensurePromotedTile(def) {
    var ext = (window.AFK_SETTINGS && AFK_SETTINGS._items) || [];
    var src = null;
    for (var i = 0; i < ext.length; i++) { if (ext[i].label === def.srcLabel) { src = ext[i]; break; } }
    var existing = document.getElementById('afk-tile-' + def.key);
    if (!src || (src.visible && !src.visible())) { if (existing) existing.remove(); return null; }
    if (existing) return existing;
    var b = document.createElement('button');
    b.id = 'afk-tile-' + def.key;
    b.type = 'button';
    b.className = 'btn bg-amber-700 hover:bg-amber-600 border-amber-500 afk-tile-btn-sm';
    b.textContent = def.icon + ' ' + def.label;
    b.addEventListener('click', src.onClick);
    return b;
  }
  function ensureFrame() {
    var menu = document.getElementById('main-menu'); if (!menu) return;
    var els = [];
    FRAME_ORDER.forEach(function (s) { var el = findEl(menu, s); if (el) els.push(el); });
    if (!els.length) return;   // 外掛元素都還沒 append 進來
    var frame = document.getElementById('afk-plugin-frame');
    if (!frame) {
      frame = document.createElement('div'); frame.id = 'afk-plugin-frame';
      var label = document.createElement('div'); label.className = 'afk-frame-label'; label.textContent = '🔌 外掛';
      frame.appendChild(label);
      // 外框插在「#main-menu 內最早出現的那個外掛元素」位置(=作者按鈕/說明之後)
      var firstInMenu = null;
      FRAME_ORDER.forEach(function (s) { if (!firstInMenu) { var el = menu.querySelector(':scope > ' + s); if (el) firstInMenu = el; } });
      menu.insertBefore(frame, firstInMenu);
    }
    // 依 FRAME_ORDER 重新 append → 框內順序固定(把散在 #main-menu 的也一起收進來;idempotent)
    els.forEach(function (el) { frame.appendChild(el); });

    // 🎨 2026-07-13 使用者調整:雲端同步/批次結算/角色背包三顆小方格,直接 append 進同一個
    // #afk-plugin-frame(緊貼在掉落查詢/小百科方格「正下方、同一個外框內」),不再另外開一個
    // 有獨立標題的「其他功能」框——避免視覺上被當成不同區塊。沒有任何升格方格可顯示時
    // 什麼都不 append(維持只有 dex/wiki 兩格)。
    PROMOTED_TILES.forEach(function (def) {
      var tile = ensurePromotedTile(def);
      if (tile) frame.appendChild(tile);
    });

    // ⚙ 其他功能(齒輪+下拉選單)固定在外掛框的正下方
    var stgWrap = menu.querySelector(':scope > #afk-stg-wrap');
    if (stgWrap && stgWrap.previousElementSibling !== frame) menu.insertBefore(stgWrap, frame.nextSibling);
  }

  // 🩹 2026-07-13 寬螢幕矮視窗防裁切:量測 #main-menu(含外掛/其他功能方格)的「自然高度」
  //   是否超出 4:3 舞台底部,超出就整組等比縮小(transform:scale)塞回舞台內;塞得下(scale
  //   會 ≥1)就完全不縮放、不影響任何現有外觀。MIN_SCALE 是下限,避免極端情況縮到無法閱讀
  //   ——低於下限仍會被舞台 overflow:hidden 裁掉一點,但這種極端窄高比視窗本來就是邊緣情境。
  var MIN_SCALE = 0.62;
  function fitMainMenu() {
    var menu = document.getElementById('main-menu');
    var stage = document.getElementById('login-art-stage');
    if (!menu || !stage) return;
    menu.style.transform = 'none';   // 先歸零才能量到真正的「未縮放」高度,避免拿上一輪縮放後的高度誤算
    var stageRect = stage.getBoundingClientRect();
    var menuRect = menu.getBoundingClientRect();
    var margin = stageRect.height * 0.02;   // 底部留一點呼吸空間,避免貼死邊緣
    var available = stageRect.bottom - menuRect.top - margin;
    var needed = menuRect.height;
    if (available <= 0 || needed <= 0) return;
    var scale = needed > available ? Math.max(MIN_SCALE, available / needed) : 1;
    if (scale >= 0.995) { menu.style.transform = ''; menu.style.transformOrigin = ''; }
    else { menu.style.transformOrigin = 'top center'; menu.style.transform = 'scale(' + scale.toFixed(4) + ')'; }
  }

  function apply() {
    if (_busy) return; _busy = true;
    try {
      injectCss(); ensureBadge(); ensureMarquee();
      ensureFrame();
      fitMainMenu();
    } catch (e) { /* 視覺外掛,出錯不影響遊戲 */ }
    _busy = false;
  }

  // ---- 啟動:套用 + 觀察(其他外掛 append 是非同步的)----------------------
  function start() {
    apply();
    var menu = document.getElementById('main-menu');
    if (menu && window.MutationObserver) {
      var obs = new MutationObserver(function () { apply(); });
      obs.observe(menu, { childList: true });
    }
    // 視窗尺寸變化(含手機轉向)重新量測是否需要縮放;debounce 避免拖曳視窗時狂算
    var _fitTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(_fitTimer);
      _fitTimer = setTimeout(fitMainMenu, 120);
    });
    // 後援:外掛可能延遲 append,前幾秒多試幾次
    var n = 0, iv = setInterval(function () { apply(); if (++n > 20) clearInterval(iv); }, 300);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  console.log('[AFK-skin] hooks OK');
})();
