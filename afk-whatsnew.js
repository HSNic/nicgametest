/* ============================================================================
 * afk-whatsnew.js — 首頁「📢 最新公告」按鈕
 *
 * 在首頁「開始遊戲」旁邊加一顆按鈕,點開彈窗顯示最近幾次更新的白話摘要(手動維護,
 * 對應 Lineage/加掛版/docs/版本異動紀錄/版本異動紀錄_玩家版.md 最上面幾筆),
 * 每筆重點可附一顆「查看小百科」連結,呼叫 AFK_WIKI_API.goto 直接跳去對應分頁看詳細數據。
 *
 * 內容是手動維護的陣列(CHANGELOG),不會自動讀 docs/ 底下的 md(那份不隨遊戲部署、瀏覽器讀不到)。
 * 之後每次補寫玩家版變更紀錄時,順手把最新一筆的白話摘要複製一份精簡版加進這裡最上面,
 * 並視情況拿掉陣列尾端太舊的紀錄(只保留最近幾筆,太多會變成沒人想看的長清單)。
 *
 * 優雅降級:抓不到 #main-menu 就安靜停用,不影響遊戲。
 * ========================================================================== */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // 🔧 手動維護:更新的白話摘要,新的寫最上面。彈窗一次只顯示前 PAGE_SIZE 筆,
  //   其餘靠「載入更多」按鈕每次多顯示 PAGE_SIZE 筆,陣列本身不用管顯示幾筆——
  //   之後補寫玩家版變更紀錄時,把最新一筆的白話摘要複製一份精簡版加進這裡最上面即可,
  //   累積太多再視情況拿掉陣列尾端太舊的紀錄。
  //   wiki: {tab, cls} 可選——有填的話該條目會多一顆「查看小百科」連結。
  var PAGE_SIZE = 3;
  var CHANGELOG = [
    {
      date: '2026-07-17', title: '同步原作者本體最新版v3.5.4,新增「日出之國」怪物區',
      items: [
        { text: '跟進原作者本體更新:全新「日出之國」日式妖怪主題怪物區(嗚釜、鎌鼬、河童、天狗等13隻小怪+5隻頭目),可從「時空裂痕」第三區進入。' },
        { text: '頭目「白面金毛九尾狐」是三段變身王:玉藻打到一半血量會直接變身成九尾、再變身成殺生石,真正的擊敗獎勵只在最終階觸發,小百科「戰鬥機制」分頁已補充說明。' },
        { text: '威頓村「宙斯之熔岩高崙」新增滅魔裝備製作線,拿舊的抗魔法鏈甲+材料+金幣可以換取更高魔防的新防具。' }
      ]
    },
    {
      date: '2026-07-17', title: '爆擊/重擊全新特效',
      items: [
        { text: '爆擊時畫面會播放金橙色漸層大字「CRITICAL」，重擊則顯示「重擊」，並配上光束、光環、火花與光芒特效，比原本的樸素飄字更有打擊感。' },
        { text: '這個新特效完全跟著「⚙ 設定」裡的「戰鬥特效」與「傷害數字」開關走：關掉戰鬥特效會恢復成原本樸素的爆擊/重擊文字，關掉傷害數字則兩者都不會顯示。' }
      ]
    },
    {
      date: '2026-07-17', title: '修正批次結算後角色跑回村莊+創角畫面修正',
      items: [
        { text: '修正批次結算所有存檔位之後,角色沒有回到原本掛機地圖續打、全部跑回村莊的問題(離線掛機讀取地圖的邏輯有誤,已修正)。' },
        { text: '修正創角畫面部分版面跑掉的問題:手機版性別選擇/能力配點/經典模式開關/開始遊戲按鈕顯示不全或跑位,現在都正常顯示。' },
        { text: '修正手機直向瀏覽時,首頁公告文字被最上方的時間/訊號列擋住第一行的問題。' }
      ]
    },
    {
      date: '2026-07-17', title: '最新公告改分頁載入+首頁公告文字與版本標示更新',
      items: [
        { text: '「最新公告」彈窗改成一次顯示最新3筆,下面有「載入更多」按鈕可以繼續往前看。' },
        { text: '首頁公告文字更新,清楚標明原作者與加掛版維護者,並附上前往原作者最新版的連結。' },
        { text: '首頁「(加掛版)」與版本號字體放大、分開上色,更容易辨識。' }
      ]
    },
    {
      date: '2026-07-17', title: '小百科補完寵物系統與新機制說明',
      items: [
        { text: '小百科「帶寵物」分頁內容全部更新為最新版寵物系統(誘捕道具、出戰4隻、包武進化、寵物保管)。', wiki: { tab: 'pets' } },
        { text: '法師系傷害技能、體力回復術/生命的祝福/生命之泉三個治療技能說明更新成現行效果(施放即立即治癒全隊/補滿血)。', wiki: { tab: 'magic' } },
        { text: '新增兩個技能說明:治癒能量風暴(加速HP自然恢復)、污濁之水(讓頭目回血變慢)。' },
        { text: '變形分頁修好烈焰的死亡騎士攻速顯示錯誤,並新增兩把冥皇執行劍裝備即變身的說明。', wiki: { tab: 'poly' } },
        { text: '新增「死亡經驗買回」說明(經典模式專屬,聖使阿卡塔可花錢買回一半死亡損失經驗)。', wiki: { tab: 'mode' } }
      ]
    },
    {
      date: '2026-07-17', title: '批次結算不再自動跳頁+首頁公告擋字修正',
      items: [
        { text: '批次結算所有存檔位跑完後不會再自動跳走畫面,會停在結算結果讓你自己看完再按X關閉。' },
        { text: '修正手機直向瀏覽時,首頁公告文字換行會蓋住「放置天堂」標題的問題。' }
      ]
    },
    {
      date: '2026-07-17', title: '黑暗妖精聖地小百科補寫+小百科分頁改版+跨頁配色',
      items: [
        { text: '小百科新增「黑暗妖精聖地」分頁:吉爾塔斯、真．冥皇丹特斯怎麼打、入場道具、機制應對一次講清楚。', wiki: { tab: 'darkelf_sanct' } },
        { text: '小百科分頁改成「先選大類、再選子分頁」,桌機手機都不用再左右滑動找分頁。' },
        { text: '小百科內文重要名詞(NPC/道具/頭目/技能/裝備/地點/異常狀態)加上顏色標示,閱讀更清楚。' },
        { text: '爆擊特效改成更絢麗的金白閃爍光暈。' }
      ]
    },
    {
      date: '2026-07-16', title: '同步原作者本體最新版v3.4.86,含大量系統與數值調整',
      items: [
        { text: '跟進原作者本體 62 個版本更新:法師系一到十階魔法傷害全面拉高、寵物系統修正、傭兵新增可攻擊的召喚物、經典模式高等級經驗需求重新計算、新武器「冥皇執行劍」與大量新遺物。' },
        { text: '幾個技能的團隊/個人效果範圍互換了:鋼鐵防護從「全隊減傷」改成「只有自己防禦提升」(削弱),灼熱武器、閃亮之盾則從「只有自己」變成「全隊都吃得到」。' },
        { text: '頁面頂端新增一條提示橫幅,告知這是加掛外掛版本並提供官方連結。' }
      ]
    },
    {
      date: '2026-07-16', title: '小百科/掉落查詢搜尋效能優化+畫面小整理',
      items: [
        { text: '掉落查詢/小百科搜尋現在打字後會立刻顯示「搜尋中…」,不會感覺沒反應。' },
        { text: '掉落查詢以前「符合太多只顯示前面幾十筆」的問題已修正,往下捲動會自動接著載入,所有符合結果都能看到。' }
      ]
    },
    {
      date: '2026-07-16', title: '同步原作者新遺物/技能+遺物顯示優化+新NPC',
      items: [
        { text: '跟進原作者新版:新增24件遺物、2把新武器(倫得雙刀、冥皇執行劍解咒版)、2本新技能書,連同對應的怪物掉落資料。' },
        { text: '掉落查詢跟小百科裡的「遺物」現在都會加上「[遺物]」標籤,一眼就能看出哪些是遺物。', wiki: { tab: 'relic' } },
        { text: '新增NPC「聖使阿卡塔」(亞丁城鎮,經典模式限定):可以花金幣買回死亡時損失的部分經驗值。', wiki: { tab: 'mode' } }
      ]
    },
    {
      date: '2026-07-15', title: '批次結算修正+雲端同步略過修正+設定調整',
      items: [
        { text: '修正批次結算偶爾出現「無收益」、之後單獨登入該角色離線時間還在、甚至跑回村莊的問題。' },
        { text: '雲端同步跳出的選單,按「略過」或「全部略過」現在是真的略過,不會再照樣把資料送上雲端或蓋掉本機內容。' }
      ]
    }
  ];

  var MODAL_ID = 'm-wn-modal';
  var _layer = null;
  var _shown = PAGE_SIZE;   // 目前顯示到第幾筆(每次「載入更多」+PAGE_SIZE)

  function renderGroup(grp) {
    var items = grp.items.map(function (it) {
      var link = it.wiki
        ? ' <span role="button" tabindex="0" class="m-wn-link" data-tab="' + esc(it.wiki.tab) + '" data-cls="' + esc(it.wiki.cls || '') + '">📖 查看小百科</span>'
        : '';
      return '<li>' + esc(it.text) + link + '</li>';
    }).join('');
    return '<div class="m-wn-grp">'
      + '<div class="m-wn-grp-title"><span class="m-wn-date">' + esc(grp.date) + '</span> ' + esc(grp.title) + '</div>'
      + '<ul class="m-wn-list">' + items + '</ul>'
      + '</div>';
  }

  // 只重繪清單本體+載入更多鈕(不重建整個 modal),讓「載入更多」點擊後捲動位置不會跳掉
  function renderBody() {
    var bodyEl = document.getElementById('m-wn-body'); if (!bodyEl) return;
    var visible = CHANGELOG.slice(0, _shown);
    var html = visible.map(renderGroup).join('');
    if (_shown < CHANGELOG.length) {
      html += '<button id="m-wn-more" type="button">載入更多(還有 ' + (CHANGELOG.length - _shown) + ' 筆)</button>';
    }
    bodyEl.innerHTML = html;
    var moreBtn = document.getElementById('m-wn-more');
    if (moreBtn) moreBtn.addEventListener('click', function () { _shown += PAGE_SIZE; renderBody(); });
  }

  function buildModal() {
    if (document.getElementById(MODAL_ID)) return;
    var m = document.createElement('div');
    m.id = MODAL_ID;
    m.innerHTML =
      '<div id="m-wn-card">' +
        '<div id="m-wn-head"><span>📢 最新公告</span><button id="m-wn-close" type="button" title="關閉">✕</button></div>' +
        '<div id="m-wn-body"></div>' +
      '</div>';
    document.body.appendChild(m);
    document.getElementById('m-wn-close').addEventListener('click', closeModal);
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    m.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('.m-wn-link');
      if (!a || !window.AFK_WIKI_API) return;
      // 🔗 模態連模態跨頁:只把自己這層彈窗的 DOM 關掉(不呼叫 AFK_UI.closeLayer/history.back),
      //   歷史層交給小百科的 goto/openModal 接手——比照 afk-dex/afk-wiki 互跳彼此的 closeForNav 慣例,
      //   避免「自己 closeLayer 觸發的 history.back()」跟「goto 開新模態 push 的歷史」互相打架、開了又被關掉。
      m.classList.remove('open');
      _layer = null;
      AFK_WIKI_API.goto({ tab: a.getAttribute('data-tab'), cls: a.getAttribute('data-cls') || undefined });
    });
    injectStyle();
  }

  function openModal() {
    buildModal();
    _shown = PAGE_SIZE;   // 每次重新打開都從前 PAGE_SIZE 筆看起,不記上次展開到哪
    renderBody();
    document.getElementById(MODAL_ID).classList.add('open');
    _layer = window.AFK_UI ? AFK_UI.openLayer(closeModal) : null;
  }
  function closeModal() {
    var m = document.getElementById(MODAL_ID); if (m) m.classList.remove('open');
    if (_layer && window.AFK_UI) { AFK_UI.closeLayer(_layer); _layer = null; }
  }

  function injectStyle() {
    if (document.getElementById('m-wn-style')) return;
    var css = [
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);}',
      '#' + MODAL_ID + '.open{display:flex;}',
      '#m-wn-card{width:min(560px,92vw);max-height:82vh;display:flex;flex-direction:column;background:#1b1622;border:1px solid #4a3f66;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.6);}',
      '#m-wn-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;font-size:18px;font-weight:bold;color:#f5d46c;border-bottom:1px solid #3a3050;}',
      '#m-wn-close{width:34px;height:34px;border:1px solid #4a3f66;background:#241f38;color:#e2e8f0;border-radius:8px;font-size:14px;cursor:pointer;}',
      '#m-wn-close:active{background:#3a2f5c;}',
      '#m-wn-body{overflow-y:auto;padding:14px 18px;}',
      '.m-wn-grp{margin-bottom:16px;}',
      '.m-wn-grp-title{color:#7fd9c4;font-weight:bold;margin-bottom:6px;font-size:15px;}',
      '.m-wn-date{color:#9a8fc0;font-weight:normal;margin-right:6px;}',
      '.m-wn-list{margin:0;padding:0;color:#eee9f7;font-size:14px;line-height:1.7;}',
      '.m-wn-list li{display:list-item;list-style:none;margin-bottom:6px;padding-left:16px;position:relative;}',
      '.m-wn-list li:before{content:"\\2022";position:absolute;left:2px;color:#7fd9c4;}',
      '.m-wn-link{color:#7fd9c4;text-decoration:underline;margin-left:4px;white-space:nowrap;}',
      '#m-wn-more{display:block;width:100%;margin-top:4px;padding:10px;border:1px solid #4a3f66;border-radius:8px;background:#241f38;color:#7fd9c4;font-size:14px;font-weight:bold;cursor:pointer;}',
      '#m-wn-more:active{background:#3a2f5c;}'
    ].join('\n');
    var s = document.createElement('style'); s.id = 'm-wn-style'; s.textContent = css;
    document.head.appendChild(s);
  }

  function init() {
    var mainMenu = document.getElementById('main-menu');
    var startBtn = document.getElementById('btn-start-menu');
    if (!mainMenu || !startBtn) { console.warn('[AFK-whatsnew] 找不到首頁掛點,略過。'); return; }
    var btn = document.createElement('button');
    btn.id = 'btn-whatsnew';
    btn.type = 'button';
    btn.className = 'btn text-base w-72 py-2.5 bg-slate-700 hover:bg-slate-600 border-slate-500';
    btn.textContent = '📢 最新公告';
    btn.addEventListener('click', openModal);
    startBtn.insertAdjacentElement('afterend', btn);
    console.log('[AFK-whatsnew] hooks OK');
  }

  ready(init);
})();
