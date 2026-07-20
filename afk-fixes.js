/* ============================================================================
 * afk-fixes.js — 通用修正外掛(補原作者上游坑;桌機 / 手機皆適用,與裝置判定無關)
 *
 * 收容「不綁手機 / 不綁離線 / 不綁查詢」的通用修正。每一段都要:
 *   1) 優雅降級——抓不到掛點就安靜停用,不弄壞遊戲;
 *   2) 在段落檔頭寫明「原作者怎麼改就能整段刪」。
 *      (見 CLAUDE.md 外掛原則:只有『過時後仍會主動執行』的補坑碼才標移除條件,本檔即屬此類。)
 *
 * 掛接:在 index.html </body> 前加一行
 *   <script src="afk-fixes.js"></script>
 * ========================================================================== */
(function () {
  'use strict';

  /* --------------------------------------------------------------------------
   * 修正#1:renderTabs select-guard — 戰鬥中操作下拉選單不被刷掉
   *
   * 問題:「快速強化(批次衝裝)」的目標等級是分頁 / 物品彈窗裡的原生 <select>。戰鬥中
   *   掉寶 / 扣箭 / 夥伴耗肉會讓背包內容簽章改變 → renderTabs 整塊重建分頁 DOM → 開著的
   *   下拉連同元素被刪掉,點開瞬間被關(手機尤其明顯,桌機點開亦然,故與裝置無關)。
   * 解法:偵測焦點落在這些容器的 <select> 上時,延後該次 renderTabs;選單關閉(change /
   *   blur)後再 force 補繪一次,追上延後期間的背包變動。
   * 涵蓋:武器 / 防具分頁的「快速強化(批次)」+ 物品彈窗的「一鍵強化到指定值」三處下拉。
   *   彈窗(#item-modal)本來就不被戰鬥重繪、不會被關,一併納入當保險、行為一致。
   * 何時可移除:原作者把 renderTabs 改成不整塊重建分頁 DOM(diff 更新、不刪 <select>)時,
   *   本段即成多餘,可整段刪掉。在那之前留著無害(抓不到掛點自動 no-op,不會弄壞遊戲)。
   * ------------------------------------------------------------------------ */
  (function () {
    var TAB_SEL = '#tab-weapons,#tab-armors,#tab-items,#tab-equip,#tab-skill,#item-modal';

    function selectOpenInTabs() {
      var ae = document.activeElement;
      return !!(ae && ae.tagName === 'SELECT' && ae.closest && ae.closest(TAB_SEL));
    }

    function install() {
      if (typeof window.renderTabs !== 'function' || window.renderTabs.__qeGuard) return true;
      var orig = window.renderTabs;
      var pending = false;

      var guarded = function () {
        // 2026-07-08(效能稽核):state.ff(快轉/離線補跑)期間不可能有下拉選單被使用者打開,
        // 直接透傳給原生 renderTabs(它自己會因 state.ff 早退),省掉每次都讀
        // document.activeElement+closest 的成本,跟其他外掛(afk-toast/afk-autobuy)的快速通道一致。
        if (typeof state !== 'undefined' && state && state.ff) return orig.apply(this, arguments);
        // 包住自己的偵測:萬一原作者哪天改了 DOM 害這裡丟錯,也絕不能波及遊戲的 renderTabs → 出錯就直接走原版
        try { if (selectOpenInTabs()) { pending = true; return; } } catch (e) {}
        return orig.apply(this, arguments);
      };
      guarded.__qeGuard = true;
      // orig 內部以全域名稱 renderTabs 讀寫 _sig 快取,改指到 guarded 後快取仍是同一份,無雙快取問題。
      window.renderTabs = guarded;

      function flush() {
        if (!pending || selectOpenInTabs()) return;   // 沒延後過、或還停在另一個下拉上就先不補
        pending = false;
        orig.call(window, true);                       // 一律 force,確保追上延後期間的背包變動
      }
      // 用 setTimeout 讓 inline onchange(更新 quickEnh.target)先跑完、選單也確實關閉後再補繪
      function onSelectDone(e) {
        var t = e.target;
        if (t && t.tagName === 'SELECT' && t.closest && t.closest(TAB_SEL)) setTimeout(flush, 0);
      }
      document.addEventListener('change', onSelectDone, true);
      document.addEventListener('blur', onSelectDone, true);

      console.log('[AFK-fixes] renderTabs select-guard 已掛上');
      return true;
    }

    try {
      if (!install()) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
        else setTimeout(install, 0);
      }
    } catch (e) {
      // 補坑碼自己掛掉不該拖垮整支外掛(也不該害冒煙測試誤判) → 安靜停用即可
      console.warn('[AFK-fixes] select-guard 安裝失敗,已略過:', e);
    }
  })();

  /* --------------------------------------------------------------------------
   * 修正#2:戰鬥 / 系統日誌「鎖定捲動」防飄移(桌機 / 手機皆然,與裝置無關)
   *
   * 問題:鎖定捲動(向上看舊訊息)時,新訊息進來仍會把超量的舊行從「頂端」裁掉
   *   (logCombat / logSys 內 while removeChild firstChild)。頂端一被移除,整個內容往上
   *   位移 → 即使沒自動捲到底,畫面仍一直飄,鎖定形同無效。
   * 解法:包住 logCombat / logSys,鎖定時錨定「視窗頂端那則訊息」,原函式跑完後依錨點的位移
   *   把 scrollTop 補回去,讓使用者正在看的那段完全不動。未鎖定時走原行為(自動捲到底)。
   * 何時可移除:原作者改成「鎖定時不裁頂端」或自行做了捲動錨定時,本段可整段刪。
   * ------------------------------------------------------------------------ */
  (function () {
    // 「使用者已往上捲離底部」= 遊戲的鎖定條件(同 _combatLogIsAtBottom 的反向)。直接看 DOM,
    //  不依賴 index.html 的內部變數(跨腳本讀 let 不可靠),自成一格、最穩。
    function scrolledUp(el) { return (el.scrollHeight - el.scrollTop - el.clientHeight) >= 24; }
    function patch(fnName, elId) {
      var orig = window[fnName];
      if (typeof orig !== 'function' || orig.__lockAnchor) return false;
      var wrapped = function () {
        // 快轉(離線/背景補跑)時原函式第一行就 return、不會動 DOM,錨定完全多餘——
        // 而 scrolledUp 讀 scrollHeight 會強制排版,補跑每則訊息都白付一次,直接走原函式。
        if (typeof state !== 'undefined' && state && state.ff) return orig.apply(this, arguments);
        var el = document.getElementById(elId);
        if (!el || !scrolledUp(el)) return orig.apply(this, arguments);   // 在底部(未鎖定):原行為(自動捲到底)
        // 已往上看舊訊息:錨定視窗頂端那則訊息。原函式用 innerHTML+= 會「重建全部子節點」,故不能持有
        //   元素參照(會變 stale),改記「索引 + 與視窗頂的像素差」,事後依被裁掉的數量重算索引、補回 scrollTop。
        var st = el.scrollTop, kids = el.children, n = kids.length, anchorIndex = -1, delta = 0;
        for (var i = 0; i < n; i++) {
          if (kids[i].offsetTop + kids[i].offsetHeight > st) { anchorIndex = i; delta = st - kids[i].offsetTop; break; }
        }
        var r = orig.apply(this, arguments);
        try {
          if (anchorIndex >= 0) {
            var after = el.children, trimmed = (n + 1) - after.length;   // logCombat/logSys 每次固定新增 1 則
            var ni = anchorIndex - trimmed;
            if (ni >= 0 && ni < after.length) el.scrollTop = after[ni].offsetTop + delta;
          }
        } catch (e) {}
        return r;
      };
      wrapped.__lockAnchor = true;
      window[fnName] = wrapped;
      return true;
    }
    function install() {
      var a = patch('logCombat', 'combat-log');
      var b = patch('logSys', 'sys-log');
      if (a || b) console.log('[AFK-fixes] 日誌鎖定捲動防飄移 已掛上');
      return typeof window.logCombat === 'function' && window.logCombat.__lockAnchor;
    }
    try {
      if (!install()) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
        else setTimeout(install, 0);
      }
    } catch (e) { console.warn('[AFK-fixes] 日誌鎖定捲動防飄移 安裝失敗,已略過:', e); }
  })();

  /* --------------------------------------------------------------------------
   * 修正#3:關閉 / 切走頁面前自動存一次檔(桌機 / 手機皆然)
   *
   * 問題:原版只每 5 分鐘自動存檔一次 + 少數事件存檔,且沒有任何 beforeunload/pagehide
   *   存檔。直接關分頁時進度只停在上一次自動存檔,最多會丟近 5 分鐘的進度。
   *   (afk-offline 雖在關閉時掛了監聽,但只 stamp 離線錨點、不存角色進度。)
   * 解法:在 pagehide / beforeunload / visibilitychange(切到背景)補呼叫一次 saveGame。
   *   afk-fixes 在 afk-offline 之後載入,此時 window.saveGame 已被 afk-offline 包過 → 這一存
   *   同時也蓋上離線時間戳,一舉兩得。
   *   特別補 visibilitychange→hidden:手機被系統殺背景時 pagehide/beforeunload 常不觸發,切到
   *   背景(切 App / 鎖屏 / 切分頁)的 hidden 才是手機最可靠的存檔時機。代價是每次切背景都會存
   *   一次,但 saveGame 本來就頻繁呼叫(每 5 分鐘 + 多種事件),多這一次無妨。
   * 守門:必須跟 stamp() 一樣只在「真的在遊戲畫面」時存——原版 saveGame 會讀 set-pot 等只存在
   *   於遊戲畫面的 DOM、也吃 player,在開始選單 / 創角時呼叫會直接拋錯或寫壞 slot。
   * 何時可移除:原作者自行加了關閉前存檔(beforeunload/pagehide/visibilitychange 存檔)時,
   *   本段即成多餘,可整段刪掉。在那之前留著無害(抓不到 saveGame / 不在遊戲畫面自動 no-op)。
   * ------------------------------------------------------------------------ */
  (function () {
    function inGame() {
      var gs = document.getElementById('game-screen');
      return !!(gs && !gs.classList.contains('hidden'));
    }
    function saveOnExit() {
      if (window.__afkLoggingOut) return;   // 手機登出流程已自己存過(且排了 stamp);這裡再存會讓手機 toast 跳兩次
      try { if (inGame() && typeof window.saveGame === 'function') window.saveGame(); } catch (e) {}
    }
    window.addEventListener('pagehide', saveOnExit);
    window.addEventListener('beforeunload', saveOnExit);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveOnExit();
    });
    console.log('[AFK-fixes] 關閉前自動存檔 已掛上');
  })();

  // 修正#4(favicon 注入)已移除:原作者 V2.32 起已在 index.html <head> 自宣告 favicon(assets/favicon.png,1.63 天堂圖),本段多餘。

  /* --------------------------------------------------------------------------
   * 修正#5:saveGame 空白角色防呆 — 攔下「未載入角色就存檔」避免覆蓋真實存檔
   *
   * 問題:原作 saveGame 只防 player.dead,沒防「未載入角色」。主選單時 player 是空白預設
   *   (cls:null, lv:1),此時若有任何程式(早年的存檔轉移外掛踩過、或未來新外掛手滑)呼叫
   *   saveGame,會把空白 player 寫進 lineage_idle_save_<currentSlot>(currentSlot 預設 1)→
   *   覆蓋第 1 格真實存檔成 Lv.1 null,且原作此路徑不留備份 → 永久損失。
   * 解法:在最外層包住 saveGame,偵測「player 空白(cls 為 null)」就攔下不存(console.warn 留痕)。
   *   cls 在創角 startGame() 一開始(player.cls = curCreate.cls)就設好、之後才有任何遊戲內存檔,
   *   故此防呆只擋「主選單空白」這唯一壞狀態,不會誤擋任何一次合法存檔。判斷本身若出錯則放行走
   *   原存檔(fail-open,不新增風險)。afk-fixes 在 afk-offline 之後載入 → 此包裝是最外層,
   *   空白時連離線錨點 stamp 都不會跑。
   * 何時可移除:原作者自己在 saveGame 開頭加了「未載入角色(!player.cls)就 return」防呆時,
   *   本段即多餘,可整段刪掉。
   * ------------------------------------------------------------------------ */
  (function () {
    try {
      if (typeof window.saveGame !== 'function' || window.saveGame.__blankGuard) return;
      var orig = window.saveGame;
      var guarded = function () {
        try {
          if (typeof player === 'undefined' || !player || !player.cls) {   // 空白/未載入角色:擋
            console.warn('[AFK-fixes] saveGame 在未載入角色狀態被呼叫,已攔截(避免空白存檔覆蓋真實存檔)。');
            return;
          }
        } catch (e) { /* 判斷本身出錯 → 不擋,走原存檔(維持原行為) */ }
        return orig.apply(this, arguments);
      };
      guarded.__blankGuard = true;
      window.saveGame = guarded;
      console.log('[AFK-fixes] saveGame 空白角色防呆 已掛上');
    } catch (e) { console.warn('[AFK-fixes] saveGame 空白角色防呆 安裝失敗,已略過:', e); }
  })();

  /* --------------------------------------------------------------------------
   * 修正#6:存檔匯出在 Android 行動模式下載 0 byte — 改用 Web Share API
   *
   * 問題:原作 downloadSaveFile 用 blob: + <a download> 觸發下載。Android Chrome 行動模式
   *   的下載管理員是非同步的,blob URL 常在下載管理員讀取前被 revoke,導致下載 0 byte。
   *   切到「桌面版網站」模式就正常:該模式下 window.showSaveFilePicker 可用,exportSave 走
   *   File System API 路徑,根本不進 downloadSaveFile。
   * 解法:只在 Android 行動模式(UA 含 Android)包住 downloadSaveFile,改用 Web Share API
   *   (navigator.share with files)。Share API 不走下載管理員,直接交給 Android 系統的
   *   分享 / 存檔對話框,Android Chrome 75+ 皆支援。
   *   切桌面版時 UA 不含 Android → 自動走原版(且 showSaveFilePicker 也先攔住,不到這裡);
   *   iOS / 桌機走原版不動。
   * 何時可移除:原作者把 downloadSaveFile 改成 Android 可靠的下載方式時,本段即多餘,
   *   可整段刪掉(抓不到 downloadSaveFile 自動 no-op)。
   * ------------------------------------------------------------------------ */
  (function () {
    var isAndroidMobile = /Android/i.test(navigator.userAgent || '');

    function install() {
      if (!isAndroidMobile) return true;
      if (typeof window.downloadSaveFile !== 'function' || window.downloadSaveFile.__androidShareDl) return false;
      var orig = window.downloadSaveFile;
      var patched = function (data, fname) {
        try {
          var file = new File([data], fname, { type: 'application/json' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: fname })
              .then(function () {
                try {
                  if (typeof window.logSys === 'function')
                    window.logSys('<span class="text-indigo-300 font-bold">✔ 存檔已匯出：' + fname + '</span>');
                } catch (e) {}
              })
              .catch(function (err) {
                if (err && err.name === 'AbortError') return;   // 使用者取消分享
                try { orig(data, fname); } catch (e) {}         // share 失敗才退回原版
              });
            return;
          }
        } catch (e) {}
        return orig.apply(this, arguments);   // canShare 不支援(舊版 Android)→ 退回原版
      };
      patched.__androidShareDl = true;
      window.downloadSaveFile = patched;
      console.log('[AFK-fixes] 匯出下載 Android 改用 Web Share API(修手機 0 byte) 已掛上;非 Android 走原版');
      return true;
    }

    try {
      if (!install()) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
        else setTimeout(install, 0);
      }
    } catch (e) { console.warn('[AFK-fixes] Android 匯出 Web Share 安裝失敗,已略過:', e); }
  })();

  /* --------------------------------------------------------------------------
   * 修正#7:適用職業 logo 點擊浮現職業名 tip(桌機 / 手機皆然)
   *
   * 問題:物品顯示的「適用職業」是一排職業 logo 圖示(原作者 buildItemDescHTML 產生,帶 title/alt
   *   ＝職業中文名)。桌機滑鼠 hover 看得到 title,但<b>手機沒有 hover</b> → 點了沒反應,玩家
   *   不知道那個圖是哪個職業。小百科「裝備」分頁重用同一段顯示,同樣問題。
   * 解法:全域(capture)監聽點擊 `img.class-eq-icon`,讀它的 title/alt,浮現一個小 tip 顯示
   *   「可裝備：<職業>」,1.6 秒後淡出。因為遊戲內物品卡與小百科裝備頁用的是<b>同一個
   *   class-eq-icon</b>,一個全域 handler 兩邊一起補,且不動原作者碼。
   * 何時可移除:原作者自己讓職業 logo 點擊/長按顯示職業名時,本段即多餘,可整段刪。
   * ------------------------------------------------------------------------ */
  (function () {
    var tip = null, hideT = null;
    function ensureTip() {
      if (tip) return tip;
      tip = document.createElement('div');
      tip.id = 'afk-eqicon-tip';
      tip.setAttribute('style', 'position:fixed;z-index:100000;pointer-events:none;background:#0f172a;border:1px solid #475569;color:#e2e8f0;font-size:13px;font-weight:bold;padding:4px 10px;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.5);opacity:0;transition:opacity .12s;white-space:nowrap;');
      document.body.appendChild(tip);
      return tip;
    }
    function showTip(icon, name) {
      var t = ensureTip();
      t.textContent = '可裝備：' + name;
      t.style.opacity = '1';   // 先顯示才量得到尺寸
      var r = icon.getBoundingClientRect(), tw = t.offsetWidth, th = t.offsetHeight;
      var left = Math.min(window.innerWidth - tw - 6, Math.max(6, r.left + r.width / 2 - tw / 2));
      var top = r.top - th - 6; if (top < 6) top = r.bottom + 6;
      t.style.left = left + 'px'; t.style.top = top + 'px';
      if (hideT) clearTimeout(hideT);
      hideT = setTimeout(function () { if (tip) tip.style.opacity = '0'; }, 1600);
    }
    document.addEventListener('click', function (e) {
      var ic = (e.target && e.target.closest) ? e.target.closest('img.class-eq-icon') : null;
      if (!ic) return;
      var name = ic.getAttribute('title') || ic.getAttribute('alt');
      if (name) { e.preventDefault(); showTip(ic, name); }
    }, true);
    console.log('[AFK-fixes] 適用職業 logo 點擊 tip 已掛上');
  })();

  // 🐉 修正#: 多隻頭目(boss-zoom)並排時被畫面裁切 + 重疊層次。作者讓頭目圖 scale 1.78× 由「bottom center」放大,
  //   落在最左/最右那格時放大後會脹出戰鬥框(overflow:hidden)被裁掉(任何地圖都會,木人場放滿 5 隻時最明顯)。
  //   通用修正(全域,木人場/一般地圖同套;使用者定案):
  //     ① 不裁:最左那隻改由「bottom left」放大(只往右脹)、最右那隻由「bottom right」放大(只往左脹)→ 不超出畫面被裁;中間維持中心。
  //     ② 重疊層次(z-index,使用者指定「數字小的在最上面」):左到右第 1~5 格 = 層 2,4,1,5,3 → 中間最上、最左次之、最右第三、左二、右二最底;彼此重疊時照此前後蓋。
  //   作者若日後改成不裁(或頭目不再落邊格),這段選擇器不命中即回原樣,留著無害。
  (function () {
    try {
      var st = document.createElement('style');
      st.id = 'afk-fix-bosszoom-edge';
      st.textContent =
        '#battle-view.area-fit .boss-zoom:first-child .mob-img-inner{transform-origin:bottom left !important;}\n' +
        '#battle-view.area-fit .boss-zoom:last-child .mob-img-inner{transform-origin:bottom right !important;}\n' +
        '#battle-view.area-fit .mob-target.boss-zoom{position:relative;}\n' +
        '#battle-view.area-fit .mob-target:nth-child(1).boss-zoom{z-index:40 !important;}\n' +
        '#battle-view.area-fit .mob-target:nth-child(2).boss-zoom{z-index:20 !important;}\n' +
        '#battle-view.area-fit .mob-target:nth-child(3).boss-zoom{z-index:50 !important;}\n' +
        '#battle-view.area-fit .mob-target:nth-child(4).boss-zoom{z-index:10 !important;}\n' +
        '#battle-view.area-fit .mob-target:nth-child(5).boss-zoom{z-index:30 !important;}';
      (document.head || document.documentElement).appendChild(st);
      console.log('[AFK-fixes] 邊緣頭目放大裁切修正 + 重疊層次已套用');
    } catch (e) {}
  })();

  /* --------------------------------------------------------------------------
   * 修正#13(2026-07-19 使用者回報):戰鬥中 buff/debuff 圖示列疊太多時,下面的看不到
   *
   * 問題:`#status-icon-bar`(js/08-items-equip.js 的 renderStatusIconBar())疊圖示會自動
   *   flex-wrap 換行,但它是絕對定位疊在 `#battle-view.area-fit`(16:9 固定比例框、
   *   overflow:hidden)裡的子元素——圖示疊到超出這個框的高度時,直接被父框裁掉,不是被
   *   捲動關掉。手機因為框本身縮得更小,更容易疊沒幾個就裁到。
   * 解法:給圖示列自己一個高度上限(相對於戰鬥框的百分比)+ 允許內部捲動,超出時可以滑
   *   看到被裁的圖示,而不是整個看不到。桌機手機共用同一套(與裝置判定無關)。
   * 何時可移除:原作者如果把這個圖示列改成自己有捲動或不會裁切,這段選擇器不命中即無害。
   * ------------------------------------------------------------------------ */
  (function () {
    try {
      var st = document.createElement('style');
      st.id = 'afk-fix-status-icon-overflow';
      st.textContent =
        '#battle-view.area-fit #status-icon-bar{max-height:55% !important;overflow-y:auto !important;overflow-x:hidden !important;pointer-events:auto !important;}\n' +
        '#battle-view.area-fit #status-icon-bar::-webkit-scrollbar{width:4px;}\n' +
        '#battle-view.area-fit #status-icon-bar::-webkit-scrollbar-thumb{background:rgba(255,255,255,.3);border-radius:2px;}';
      (document.head || document.documentElement).appendChild(st);
      console.log('[AFK-fixes] 戰鬥狀態圖示列溢出裁切修正已套用');
    } catch (e) {}
  })();

  /* --------------------------------------------------------------------------
   * 修正#8:快轉(離線 / 背景補跑)時靜音音效 + 不跳戰鬥特效(省效能、不洗畫面 / 耳朵)
   *
   * 問題:作者 .49 起的音效(js/17-audio.js)與戰鬥特效(js/09-vfx-render.js)從戰鬥 / 擊殺碼
   *   「無條件」呼叫,只看自己的開關,都沒檢查 state.ff(快轉旗標)。快轉(離線結算 24h≈86 萬拍、
   *   背景分頁批次補跑)會逐拍播擊殺 / 受擊 / 升級音、跳金色稀有掉落等特效:洗畫面 / 耳朵又白吃效能。
   * 解法:不列舉個別函式(作者每新增一個音效 / 特效就要補名單),改抓「作者所有相關函式都會先檢查的
   *   總開關」這一層,把它改成「計算屬性」,快轉(state.ff)時自動視為關閉——現有與未來的音效 / 特效
   *   全部一併納管、零維護:
   *     - 音效總開關 _sfxCfg.on:每支發聲函式(playSfx / playMobHurt / playMobKill / playSpellCast)
   *       開頭都 `if (!_sfxCfg.on) return;` → 改成 getter =「玩家原設定 && 非快轉」,ff 時第一行就 return
   *       (連音檔懶載 / 查表都不做、零副作用)。
   *     - 特效總開關 window.__vfxOff:每支 vfx 函式開頭都 `if (window.__vfxOff) return;` → 改成 getter =
   *       「玩家原設定 || 快轉中」。
   *   兩者 setter 都把值存進私有變數,玩家在設定 / 標題畫面的開關照常運作。完全不碰遊戲數值 / 掉落結算
   *   (音效 / 特效與收益無關,一字不差)。
   * 何時可移除:原作者自己在音效 / 特效函式開頭加了 state.ff 判斷時,本段即多餘,可整段刪掉
   *   (抓不到 _sfxCfg / __vfxOff 會自動略過,不弄壞遊戲)。
   * ------------------------------------------------------------------------ */
  (function () {
    function ffOn() { try { return typeof state !== 'undefined' && state && !!state.ff; } catch (e) { return false; } }

    // 音效總開關:_sfxCfg.on 改成 getter =「玩家原設定 && 非快轉」。
    //   ⚠ 必須 enumerable:true——_sfxSaveCfg 用 JSON.stringify(_sfxCfg) 存檔,非列舉屬性會被漏掉而存不回 on。
    //   ⚠ 用私有 _realSfxOn 保存玩家真值;作者的 _sfxLoadCfg / setSfxOn 寫 _sfxCfg.on 會走 setter 自動同步。
    try {
      var sc = window._sfxCfg;
      if (sc) {
        var d1 = Object.getOwnPropertyDescriptor(sc, 'on');
        if (!d1 || !d1.get) {   // 尚未被本段接管(避免重複安裝)
          var _realSfxOn = d1 ? (d1.value !== false) : true;
          Object.defineProperty(sc, 'on', {
            enumerable: true, configurable: true,
            get: function () { return _realSfxOn && !ffOn(); },
            set: function (v) { _realSfxOn = !!v; }
          });
        }
      }
    } catch (e) {}

    // 特效總開關:window.__vfxOff 改成 getter =「玩家原設定 || 快轉中」。玩家標題畫面的開關寫入走 setter。
    try {
      var d2 = Object.getOwnPropertyDescriptor(window, '__vfxOff');
      if (!d2 || !d2.get) {
        var _realVfxOff = !!window.__vfxOff;
        Object.defineProperty(window, '__vfxOff', {
          configurable: true,
          get: function () { return _realVfxOff || ffOn(); },
          set: function (v) { _realVfxOff = !!v; }
        });
      }
    } catch (e) {}

    console.log('[AFK-fixes] 快轉補跑靜音 / 不跳特效 已掛上(音效 / 特效總開關 ff-aware)');
  })();

  /* --------------------------------------------------------------------------
   * 修正#9:潘朵拉黑市購買「持有上限已滿」時扣錢但沒拿到物品(2026-07-08 待辦#2)
   *
   * 問題:`buyPandoraItem(i)`(js/14-craft-pandora.js)流程是「先扣錢 → 呼叫 gainItem 加
   *   物品 → 不論成功與否都顯示『購買成功』」。而 `gainItem`(js/08-items-equip.js)遇到
   *   商品有 `maxHold`(持有上限,如精靈的私語=10)且已達上限時,會直接 `return null`、不會
   *   把物品塞進 `player.inv`。原函式沒判斷這個 null,於是「已達持有上限」時玩家會被扣錢、
   *   卻拿不到東西,畫面還顯示購買成功——這正是玩家回報的症狀。
   * 解法:外掛在 `buyPandoraItem` 真正執行「扣錢」之前,自己先複算一次 `gainItem` 內部同一套
   *   maxHold 判斷式(held >= d.maxHold);若判定這次購買必定會失敗,直接顯示錯誤訊息並 return,
   *   完全不呼叫原函式——原函式的扣錢/gainItem/logSys 都不會被觸發,錢不會被扣。未達上限時原
   *   樣呼叫原函式,行為不變。只讀 `DB.items`/`player.inv`(唯讀複算,不寫入),不改本體檔案。
   * 何時可移除:原作者把 `buyPandoraItem` 改成會判斷 `gainItem` 的 null 回傳值(退錢/改顯示
   *   失敗)時,本段即多餘,可整段刪掉(抓不到 `buyPandoraItem` 會自動略過,不弄壞遊戲)。
   * ------------------------------------------------------------------------ */
  (function () {
    function install() {
      var orig = window.buyPandoraItem;
      if (typeof orig !== 'function' || orig.__maxHoldGuard) return typeof window.buyPandoraItem === 'function' && window.buyPandoraItem.__maxHoldGuard;

      var guarded = function (i) {
        try {
          var m = player && player.pandoraMarket2;
          var s = m && m.slots && m.slots[i];
          var d = s && typeof DB !== 'undefined' && DB.items && DB.items[s.id];
          if (s && !s.sold && d && d.maxHold) {
            var held = (player.inv || []).reduce(function (sum, it) { return sum + (it.id === s.id ? (it.cnt || 0) : 0); }, 0);
            if (held >= d.maxHold) {
              var e = document.getElementById('pandora-msg');
              if (e) e.innerHTML = '<span class="text-red-400">已達「' + (d.n || s.id) + '」持有上限(' + d.maxHold + '),無法購買。</span>';
              return;
            }
          }
        } catch (e) { /* 複算出錯就不攔,交還原函式,不能弄壞購買功能 */ }
        return orig.apply(this, arguments);
      };
      guarded.__maxHoldGuard = true;
      window.buyPandoraItem = guarded;
      console.log('[AFK-fixes] 潘朵拉黑市持有上限購買防呆 已掛上');
      return true;
    }
    try {
      if (!install()) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
        else setTimeout(install, 0);
      }
    } catch (e) { console.warn('[AFK-fixes] 潘朵拉黑市持有上限購買防呆 安裝失敗,已略過:', e); }
  })();

  /* --------------------------------------------------------------------------
   * 修正#10:快速強化 / 快速廢品勾選會跳位(2026-07-08 待辦#6)
   *
   * 問題:`toggleQuickItem`/`toggleQuickJunkItem`(js/10-ui-tabs.js)每勾一格都呼叫
   *   `renderTabs(true)` 整表重繪。`renderTabs` 雖然有記錄/還原捲動位置(`_scroll`),但
   *   勾選格會多套 `ring-2 ring-*-500/70`(邊框+陰影,約 2~4px),重繪時每格高度都可能因
   *   勾選狀態不同而微變——累積勾很多項後,還原的 scrollTop 數值已經對不上新版面的實際位置,
   *   使用者體感就是「越勾畫面跳越多」。
   * 解法:monkey-patch 這兩個函式,**不呼叫 renderTabs**,只更新狀態 + 直接找到該 uid 對應的
   *   那一格 DOM(`[data-tip-uid]`,scope 在對應分頁容器 tab-weapons/tab-armors/tab-items),
   *   切換其 checkbox 的 `checked` 與 `ring-2 ring-*-500/70` class。其餘格子完全不動,自然不會
   *   有捲動跳位問題。找不到對應格子(理論上不會發生,防禦用)才退回呼叫原函式整表重繪。
   * 何時可移除:原作者自己把這兩個函式改成局部更新(不再整表 renderTabs)時,本段即多餘,
   *   可整段刪掉(抓不到函式會自動略過,不弄壞遊戲)。
   * ------------------------------------------------------------------------ */
  (function () {
    var RING_RE = / ring-2 ring-(blue|amber)-500\/70/g;

    function patchCell(uid, panelId, checked, ringClass) {
      var panel = document.getElementById(panelId);
      if (!panel) return false;
      var cell = panel.querySelector('[data-tip-uid="' + uid + '"]');
      if (!cell) return false;
      var cb = cell.querySelector('input[type="checkbox"]');
      if (!cb) return false;
      cb.checked = checked;
      var base = cell.className.replace(RING_RE, '');
      cell.className = checked ? (base + ' ' + ringClass) : base;
      return true;
    }

    function install() {
      var origItem = window.toggleQuickItem, origJunk = window.toggleQuickJunkItem;
      if (typeof origItem !== 'function' || typeof origJunk !== 'function') return false;
      if (origItem.__noJumpGuard && origJunk.__noJumpGuard) return true;

      var PANEL_BY_TYPE = { wpn: 'tab-weapons', arm: 'tab-armors', item: 'tab-items' };

      var guardedItem = function (type, uid) {
        var st = quickEnh[type];
        var nowChecked = !st.sel[uid];
        if (st.sel[uid]) delete st.sel[uid]; else st.sel[uid] = true;
        if (!patchCell(uid, PANEL_BY_TYPE[type], nowChecked, 'ring-2 ring-blue-500/70')) renderTabs(true);
      };
      guardedItem.__noJumpGuard = true;

      var guardedJunk = function (type, uid) {
        var st = quickJunk[type];
        var nowChecked = !st.sel[uid];
        if (st.sel[uid]) delete st.sel[uid]; else st.sel[uid] = true;
        if (!patchCell(uid, PANEL_BY_TYPE[type], nowChecked, 'ring-2 ring-amber-500/70')) renderTabs(true);
      };
      guardedJunk.__noJumpGuard = true;

      window.toggleQuickItem = guardedItem;
      window.toggleQuickJunkItem = guardedJunk;
      console.log('[AFK-fixes] 快速強化/廢品勾選防跳位 已掛上');
      return true;
    }
    try {
      if (!install()) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
        else setTimeout(install, 0);
      }
    } catch (e) { console.warn('[AFK-fixes] 快速強化/廢品勾選防跳位 安裝失敗,已略過:', e); }
  })();

  /* --------------------------------------------------------------------------
   * 修正#11:renderSquadPanel 編輯「HP<n%喝水」輸入框時不被重繪打斷(桌機 / 手機皆然)
   *
   * 問題:寵物 / 傭兵卡片的「HP<n%喝水」輸入框(petSetPotPct / setAllyPotHp)長在
   *   renderSquadPanel()(js/10-ui-tabs.js)重建出來的 DOM 裡。戰鬥中寵物 / 傭兵血魔量
   *   幾乎每個 tick(100ms)都在變 → sigTeam 簽章改變 → 整段 #squad-tab-team innerHTML
   *   被重建,使用者正在編輯的 <input> 節點被整個換成新節點 → 失焦 / 視覺跳動 / 輸入被
   *   打斷還原成舊值(手機尤其明顯:鍵盤還開著,輸入框卻突然消失重生,體感是「一直跳」)。
   * 解法:比照修正#1(renderTabs select-guard)同一手法——偵測焦點落在 #squad-tab-team /
   *   #squad-tab-skill 內的 <input> 上時,延後該次 renderSquadPanel;輸入框失焦(blur /
   *   change)後再補跑一次,追上延後期間的血魔變動。延後期間血 / 魔條數字會暫停更新一兩拍,
   *   使用者編輯完就恢復,無副作用。
   * 何時可移除:原作者把 renderSquadPanel 改成「只局部更新血魔條、不整段 innerHTML 重建」
   *   時,本段即成多餘,可整段刪掉(抓不到 renderSquadPanel 會自動略過,不弄壞遊戲)。
   * ------------------------------------------------------------------------ */
  (function () {
    var PANEL_SEL = '#squad-tab-team,#squad-tab-skill';

    function inputFocusedInSquad() {
      var ae = document.activeElement;
      return !!(ae && ae.tagName === 'INPUT' && ae.closest && ae.closest(PANEL_SEL));
    }

    function install() {
      if (typeof window.renderSquadPanel !== 'function' || window.renderSquadPanel.__squadInputGuard) return true;
      var orig = window.renderSquadPanel;
      var pending = false;

      var guarded = function () {
        if (typeof state !== 'undefined' && state && state.ff) return orig.apply(this, arguments);
        try { if (inputFocusedInSquad()) { pending = true; return; } } catch (e) {}
        return orig.apply(this, arguments);
      };
      guarded.__squadInputGuard = true;
      window.renderSquadPanel = guarded;

      function flush() {
        if (!pending || inputFocusedInSquad()) return;
        pending = false;
        orig.call(window);
      }
      function onInputDone(e) {
        var t = e.target;
        if (t && t.tagName === 'INPUT' && t.closest && t.closest(PANEL_SEL)) setTimeout(flush, 0);
      }
      document.addEventListener('change', onInputDone, true);
      document.addEventListener('blur', onInputDone, true);

      console.log('[AFK-fixes] renderSquadPanel 喝水%輸入框編輯防重繪 已掛上');
      return true;
    }

    try {
      if (!install()) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
        else setTimeout(install, 0);
      }
    } catch (e) { console.warn('[AFK-fixes] renderSquadPanel 輸入框編輯防重繪 安裝失敗,已略過:', e); }
  })();

  /* --------------------------------------------------------------------------
   * 修正#12(2026-07-14 待辦「離線結算變慢與404圖片請求優化」):村莊 NPC 影子圖(.tn-shadow,
   * assets/npc/<id>/idle_s_0.png)重複 404 請求
   *
   * 背景:原作 renderTownNPCMap()(js/11-world-map.js)每次進城鎮/切城鎮都會重建 NPC 站位,
   *   每個 NPC 站位都插一張 <img class="tn-shadow" src="assets/npc/<id>/idle_s_0.png"
   *   onerror="this.remove()">——沒有影子圖的 NPC(職業動畫/舊圖/告示牌)每次重建都會
   *   重新 404 一次,不像怪物動畫(js/09-vfx-render.js 的 _mobAnimCache)/職業戰鬥動畫
   *   (_morphBattleCache)有探測過就不再試的快取。批次結算連續切換 8 個存檔位、每個角色
   *   進自己的城鎮時都會重觸發,主控台跳出大量重複 404。
   * 解法:用一個記憶體 Set 記住「這次分頁已經 404 過的完整圖片網址」(含 querystring,
   *   重新整理頁面就清空、不寫 localStorage);renderTownNPCMap() 執行完後,對剛插入的
   *   .tn-shadow 逐一比對——已知 404 過的直接移除,不讓瀏覽器重新發送請求。
   *   跟怪物動畫快取同一個精神,只是原作沒幫這塊做、外掛層補上,不動 js/11 本體。
   * 找不到 renderTownNPCMap 就安靜略過,不影響其餘功能。
   * ------------------------------------------------------------------------ */
  (function () {
    var badShadowUrls = {};

    document.addEventListener('error', function (e) {
      var t = e.target;
      if (t && t.tagName === 'IMG' && t.classList && t.classList.contains('tn-shadow')) {
        var src = t.getAttribute('src');
        if (src) badShadowUrls[src] = true;
      }
    }, true);

    function install() {
      if (typeof window.renderTownNPCMap !== 'function' || window.renderTownNPCMap.__afkShadowCacheWrapped) return false;
      var orig = window.renderTownNPCMap;
      var wrapped = function () {
        var ret = orig.apply(this, arguments);
        try {
          document.querySelectorAll('.tn-shadow').forEach(function (img) {
            var src = img.getAttribute('src');
            if (src && badShadowUrls[src]) img.remove();   // 已知 404 過的網址,直接移除、不再發請求
          });
        } catch (e) {}
        return ret;
      };
      wrapped.__afkShadowCacheWrapped = true;
      window.renderTownNPCMap = wrapped;
      console.log('[AFK-fixes] 村莊NPC影子圖404快取 已掛上');
      return true;
    }
    try {
      if (!install()) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
        else setTimeout(install, 0);
      }
    } catch (e) { console.warn('[AFK-fixes] 村莊NPC影子圖404快取 安裝失敗,已略過:', e); }
  })();

  /* --------------------------------------------------------------------------
   * 修正#14(2026-07-20 效能優化參考報告核對交接):離線結算補跑期間跳過召喚物隊伍面板重繪,
   * 減少召喚法角色(多隻召喚物)離線結算的卡頓
   *
   * 問題:`renderSummonPanel()`(js/23-summons.js)沒有像 `renderMobs`/`updateUI` 那樣的
   *   state.inTick dirty-flag 防護,召喚物每次攻擊/被打(summonV2AttackOnce/enemyAttackSummon/
   *   applyMobMagicToSummon)都會呼叫它,而它多半會觸發 renderSquadPanel() 重建隊伍面板 DOM。
   *   召喚法角色可同時有多隻召喚物、各自攻速獨立,離線結算把大量時間壓縮模擬時,這個重繪會被
   *   觸發非常多次,是「召喚法角色離線結算特別慢」的主因(比對過:afk-offline.js 的分段/喘息
   *   機制本身沒問題,卡點在單一次 tick 內部這支函式被呼叫太多次)。
   * 解法:比照 afk-vfx.js 的 isOfflineCatchup() 判斷式,離線補跑期間(state.ff 或
   *   window.__afk.busy)直接跳過這次重繪。補跑結束後,原作既有的
   *   `setInterval(renderSummonPanel, 500)` 會在最多 0.5 秒內自動補上最新畫面,玩家不會看到
   *   任何異常。不改任何戰鬥/召喚數值計算,只跳過畫面重繪。
   * 何時可移除:原作者自己替 renderSummonPanel 加上 state.inTick/state.ff 期間跳過重繪的
   *   邏輯時,本段即多餘,可整段刪掉(抓不到 renderSummonPanel 會自動略過,不弄壞遊戲)。
   * ------------------------------------------------------------------------ */
  (function () {
    function isOfflineCatchup() {
      try {
        return (typeof state !== 'undefined' && state && state.ff) || (window.__afk && window.__afk.busy);
      } catch (e) { return false; }
    }
    function install() {
      if (typeof window.renderSummonPanel !== 'function' || window.renderSummonPanel.__catchupSkip) return true;
      var orig = window.renderSummonPanel;
      var guarded = function () {
        if (isOfflineCatchup()) return;
        return orig.apply(this, arguments);
      };
      guarded.__catchupSkip = true;
      window.renderSummonPanel = guarded;
      console.log('[AFK-fixes] 離線補跑跳過召喚物面板重繪 已掛上');
      return true;
    }
    try {
      if (!install()) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
        else setTimeout(install, 0);
      }
    } catch (e) { console.warn('[AFK-fixes] 離線補跑跳過召喚物面板重繪 安裝失敗,已略過:', e); }
  })();

  console.log('[AFK-fixes] hooks OK — 通用修正外掛已啟用。');
})();
