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
      date: '2026-07-21', title: '新增決鬥競技場PVP + 阿卡塔裝備贖回 + NPC善惡值顯示更穩定',
      items: [
        { text: '新增「決鬥競技場」PVP系統:到新村莊「古魯丁」找NPC巴魯特,就能跟其他玩家一對一決鬥。' },
        { text: '聖使阿卡塔新增「裝備贖回」服務:邪惡狀態死亡遺失的裝備,可以用龍之鑽石贖回。' },
        { text: '世界頻道與潘朵拉黑市的NPC,善惡值顏色第一次互動後會固定,不會再變來變去。' }
      ]
    },
    {
      date: '2026-07-21', title: '小百科新增屬性練功 + 遺物篩選bug修正 + 省電模式加兩項特效',
      wiki: { tab: 'eleTraining' },
      items: [
        { text: '小百科新增「屬性練功」分頁,依火/水/地/風武器屬性幫你排出最適合練功的地圖,可再依建議等級篩選。' },
        { text: '統計分頁「本圖掉落物品」的怪物等級旁,現在會顯示牠的屬性。' },
        { text: '修正共用倉庫「只看遺物」勾選會連動影響主畫面背包分頁顯示的bug。' },
        { text: '省電模式現在也會關閉怪物死亡金光與魔法娃娃晃動動畫。' },
        { text: '修正小百科分頁「有新內容」紅點看過還是不會消失的bug。' }
      ]
    },
    {
      date: '2026-07-21', title: '修正離線魔物追蹤自動續約',
      items: [
        { text: '修正離線掛機期間魔物追蹤的計算方式:依「有沒有開自動續約」+金幣夠不夠正確判斷,不會再無條件白吃追蹤加成。' }
      ]
    },
    {
      date: '2026-07-21', title: '修正批次結算變慢',
      items: [
        { text: '修正上次更新後批次結算全部角色變慢的問題,不影響經驗/金幣/掉落收益。' }
      ]
    },
    {
      date: '2026-07-21', title: '同步原作新版:新遺物、世界頻道、血盟大改版',
      items: [
        { text: '新增約20件遺物、蜥蜴寵物新型態等原作新內容。' },
        { text: '新增「世界頻道」面板,可以打字發問,線上玩家NPC會隨機回覆(也可以嘲諷/感謝)。' },
        { text: '血盟系統大改版:新增NPC自己組的20個血盟,會互相宣戰、攻城、集體混戰。' },
        { text: '戰鬥日誌與系統日誌改成同一塊面板用分頁切換,手機版底部導覽新增「世界」分頁。' },
        { text: '手機版收購玩家小圖示改成可以收合貼邊,點一下展開。' }
      ]
    },
    {
      date: '2026-07-20', title: '雲端同步補寵物保管',
      items: [
        { text: '雲端同步之前漏掉寵物保管，換裝置下載後寵物會不見；現在已補上，逐隻寵物比對合併，不會互相覆蓋。' }
      ]
    },
    {
      date: '2026-07-20', title: '收購NPC顯示修正、線上效能面板移進遊戲內',
      items: [
        { text: '收購玩家(流浪商人)按鈕修正只在遊戲內顯示,不會出現在首頁。' },
        { text: '線上遊玩效能數據移進遊戲內「統計」分頁,新增追蹤開關(預設關閉)。' },
        { text: '修正收購NPC上線廣播訊息被誤判成系統分類的問題。' }
      ]
    },
    {
      date: '2026-07-20', title: '效能優化:批次結算、召喚法離線結算',
      items: [
        { text: '批次結算改成每個角色處理完短暫休息,減少手機發熱/卡頓。' },
        { text: '修正召喚法角色離線結算特別慢的問題。' },
        { text: '效能診斷面板新增線上遊玩效能數據。' }
      ]
    },
    {
      date: '2026-07-20', title: '魔物追蹤自動續約、日誌加分類開關、手機版介面修正',
      items: [
        { text: '魔物追蹤視窗新增「自動續約」勾選框，到期自動花10萬金幣續約。' },
        { text: '系統與物品日誌新增系統/掉落/收購三個訊息分類開關。' },
        { text: '離線掛機收益的物品名稱補回品質顏色。' },
        { text: '手機版寵物管理分組預設收合，操作不再跳動閃爍；桌面版角色資產管理點按鈕不再跳回頂端。' },
        { text: '共用倉庫搜尋物品多時不再卡頓。' },
        { text: '手機版收購NPC改成右下角按鈕+選單顯示，修正縮放後消失、多位互相蓋掉、置頂訊息背景透明的問題。' }
      ]
    },
    {
      date: '2026-07-20', title: '合併原作v3.6.36:白目玩家升級、城主稱號改王冠圖示',
      items: [
        { text: '白目玩家(野外假玩家NPC)新增更強的隱藏版本，會使用反擊反傷、讓治療減半等新招式。', wiki: { tab: 'pvp' } },
        { text: '打死正義向假玩家扣的正義值加重(原3000/500點→現6000/3000點)，攻城戰場內打死不扣分。' },
        { text: '血盟佔領城堡的稱號改成動態小王冠圖示，僅王族職業會顯示。', wiki: { tab: 'pledge' } },
        { text: '袋鼠系寵物新增攻擊穿甲效果，傲慢之塔「支配符」新增不進塔也能設定魔物追蹤的用途。' },
        { text: '修正效能診斷報告缺少離線結算耗時資料的問題。' }
      ]
    },
    {
      date: '2026-07-20', title: '效能修正+雲端同步補血盟資料',
      items: [
        { text: '修正離線掛機補跑速度變慢的問題(特效外掛在補跑期間會暫停動作)。' },
        { text: '倉庫/背包搜尋欄輸入改成延遲篩選,大量物品時不再卡頓。' },
        { text: '效能診斷面板新增離線結算耗時明細,可一鍵複製回報問題。' },
        { text: '雲端同步(配對碼)補上血盟資料(等級/貢獻度/城堡),換裝置下載不再遺失。' }
      ]
    },
    {
      date: '2026-07-19', title: '合併原作v3.6.03:全新血盟系統、雙手武器攻速分離',
      items: [
        { text: '新增「血盟」系統:同帳號共用,捐獻金幣/龍之鑽石可升級、開啟加成,並能攻城佔領肯特/風木/海音城堡。', wiki: { tab: 'pledge' } },
        { text: '雙手武器副手攻速改為獨立計時,不再依附主手攻速。' },
        { text: '攻城戰取消24小時冷卻,不論勝負可立即再次宣戰。' },
        { text: '移除已無入口的舊版選角畫面,不影響現有存檔與操作。' }
      ]
    },
    {
      date: '2026-07-19', title: '戰鬥新增小特效,幕後架構優化',
      items: [
        { text: '擊殺怪物瞬間新增金色火花特效,施放技能成功時戰鬥框邊緣會有淡青色光波脈衝。' }
      ]
    },
    {
      date: '2026-07-19', title: '新增魔物追蹤/寵物管理快捷鈕、遺物固定掉率、倉庫優化',
      items: [
        { text: '冒險地圖新增「魔物追蹤」快捷鈕(黑市旁),直接開啟追蹤設定,按鈕會顯示倒數時間。' },
        { text: '冒險地圖新增「寵物管理」快捷鈕,直接開啟寵物保管介面;手機版介面同步優化(圖片放大、同名寵物自動分組)。' },
        { text: '經典模式下「遺物」品質道具掉落機率固定為0.0001%。' },
        { text: '修正共用倉庫「狀態」篩選在取出/存入物品後被重置的問題;新增「只看遺物」勾選框、「全部存入」按鈕。' },
        { text: '修正戰鬥中buff/debuff太多時被畫面邊緣切掉看不到的問題。' },
        { text: '手機版冒險地圖頂部按鈕列改成三個一排。' }
      ]
    },
    {
      date: '2026-07-19', title: '合併原作v3.5.76:白目玩家彩蛋、全新PVP系統、速度調整',
      items: [
        { text: '新增「白目玩家」彩蛋:惹毛遊蕩收購NPC可能被記仇,野外可能遇到他回來尋仇,打贏有機會掉裝備。' },
        { text: '新增「PVP性向值」系統與全新分頁(可自由選擇是否開啟)。', wiki: { tab: 'pvp' } },
        { text: '加速類效果(加速術/勇敢藥水/精靈餅乾等)實際加成略為調降;吉爾塔斯武器加成改依邪惡值而定。' },
        { text: '究極光裂術現在需要正義值夠高才能施放;神聖疾走/風之疾走互斥。' },
        { text: '萬能藥六色掉落機率統一,潘朵拉黑市新開放收購萬能藥;選角畫面新增「匯出進度」按鈕。' }
      ]
    },
    {
      date: '2026-07-18', title: '手機收購NPC標示、叫賣橫幅、新增效能診斷功能',
      items: [
        { text: '手機版城鎮裡出現「收購玩家」時,現在會固定排在NPC清單最前面、金色外框標示,不會漏看。' },
        { text: '收購玩家叫賣時,畫面最上方會出現提示橫幅,點下去可以直接移動過去(或選擇不理他)。' },
        { text: '首頁「📋 紀錄」新增「效能診斷」:覺得玩起來發燙、變慢、卡頓,可以產生一份診斷報告下載,傳給開發者比對。' }
      ]
    },
    {
      date: '2026-07-18', title: '同步原作v3.5.36:潘朵拉黑市新系統+真夏納+新遺物',
      items: [
        { text: '新增潘朵拉黑市「黑市」快捷鈕,可用龍之鑽石搜尋兌換遺物。', wiki: { tab: 'pandora' } },
        { text: '新增真夏納變身(Lv85,變形控制戒指指定)。' },
        { text: '新增6件遺物裝備,吉爾塔斯魔杖擊殺增益提升。' },
        { text: '修正手機版按鈕排版對齊、修正舊存檔轉換技冷卻bug。' }
      ]
    },
    {
      date: '2026-07-18', title: '小百科新增潘朵拉黑市/遺物收藏冊分頁',
      items: [
        { text: '新增「潘朵拉黑市」分頁,完整說明商品架、收購單、龍之鑽石遺物布告欄怎麼玩。', wiki: { tab: 'pandora' } },
        { text: '新增「收藏-遺物」分頁,可查看遺物收集冊進度與缺件。', wiki: { tab: 'relicbook' } },
        { text: '小百科分頁列現在會標紅點提醒「這頁有新內容」,點開看過後就會消失。' }
      ]
    },
    {
      date: '2026-07-18', title: '修正手機瀏海遮住首頁公告',
      items: [
        { text: '手機版首頁最上方的公告橫幅,之前在部分手機上第一行文字會被瀏海/狀態列擋住看不清楚,已修正為畫面內容從上往下排列,不會再被擋住。' }
      ]
    },
    {
      date: '2026-07-17', title: '能力分頁狀態列調整+強化訊息文字修正',
      items: [
        { text: '能力分頁最下方的「狀態」文字列,現在不管人在城鎮還是戰鬥地圖都會完整顯示,不會再變成空白。' },
        { text: '強化裝備時如果卷軸消耗了但沒有變化(「無事」),訊息文字改成「卷軸的魔力消散了，沒有任何變化」,不會再跟強化成功的訊息長得幾乎一樣容易看錯。' }
      ]
    },
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

  // 🔴 首頁按鈕「有新公告」紅點:比對 CHANGELOG 最新一筆的日期與玩家上次打開公告的日期(localStorage),
  //   點開公告視窗即算已讀、紅點消失(跟小百科分頁的紅點提示同一套邏輯,見 afk-wiki.js TAB_UPDATED)。
  var WN_SEEN_KEY = 'lineage_idle_whatsnew_seen_v1';
  function _latestDate() { return (CHANGELOG[0] && CHANGELOG[0].date) || ''; }
  function _wnSeenDate() { try { return localStorage.getItem(WN_SEEN_KEY) || ''; } catch (e) { return ''; } }
  function hasUnread() { var latest = _latestDate(); return !!latest && latest > _wnSeenDate(); }
  function markSeen() { try { localStorage.setItem(WN_SEEN_KEY, _latestDate()); } catch (e) {} }

  function openModal() {
    buildModal();
    _shown = PAGE_SIZE;   // 每次重新打開都從前 PAGE_SIZE 筆看起,不記上次展開到哪
    renderBody();
    document.getElementById(MODAL_ID).classList.add('open');
    _layer = window.AFK_UI ? AFK_UI.openLayer(closeModal) : null;
    markSeen();
    var dot = document.getElementById('m-wn-newdot'); if (dot) dot.remove();
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
      '#m-wn-more:active{background:#3a2f5c;}',
      '#btn-whatsnew{position:relative;}',
      '#m-wn-newdot{position:absolute;top:6px;right:10px;width:9px;height:9px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 2px rgba(239,68,68,.3);}'
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
    injectStyle();   // 紅點跟按鈕一起出現在首頁,不用等玩家點開過一次公告視窗才有樣式
    if (hasUnread()) {
      var dot = document.createElement('span'); dot.id = 'm-wn-newdot'; dot.title = '有新公告';
      btn.appendChild(dot);
    }
    console.log('[AFK-whatsnew] hooks OK');
  }

  ready(init);
})();
