# 放置天堂 — 專案規則

## 💬 溝通原則:所有說明一律用「使用者看得懂的繁體中文」(2026-07-11 使用者明訂)

- **使用者是程式小白**,不管是回報做了什麼、解釋為什麼要這樣改、或是過程中的進度更新,一律用白話繁體中文說明,不要堆砌英文技術術語、程式碼片段代替解釋、或省略說明直接動手做。這條適用於**所有**跟使用者的溝通,不只是先前寫在「同步」章節裡的「回報同步結果」那個場景——凡是會被使用者讀到的文字都要套用。
- **不只是最後的總結報告,連「處理過程中」顯示給使用者看的文字(每一步在做什麼、中途的進度更新)也一律要用繁體中文顯示(2026-07-11 使用者再次明訂)。** 不能只在最後給一份中文總結、過程中的說明卻用英文或技術用語帶過。
- 背景:使用者明確反映過「你做的事情要用繁體中文說明,不然我看不懂」,且特別強調「處理的過程都要用中文顯示給我看」,代表先前的回報/說明對他來說不夠白話、或過程中的中間更新沒有跟著用中文,只有最後結果是中文。
- 判準:每次要回報進度或結果之前,自問「一個完全不懂程式的人,看得懂我這段話在說什麼、代表什麼意思嗎?」看不懂就要重寫成白話;**每一步的進度說明(不只是最終總結)都要套用這條**。
- **2026-07-13 使用者再次重申「所有流程都必須中文化」**——包含工具呼叫時附帶的簡短說明文字(例如執行指令前的一句話描述)也要用中文,不要為了省事用英文帶過,即使那句話看起來像是「操作紀錄」而非「跟使用者的正式溝通」。

## 專案性質

- 本體是網頁放置遊戲,**由原作者持續更新**。⚠️ 原作者 2026-06-27 起做了**大重構**:從「單一 `index.html`(約 800KB,程式碼全內嵌)」拆成 **`index.html`(殼,約 49KB)＋ `js/*.js`(遊戲邏輯,15 檔:00-data … 14-craft-pandora)＋ `css/style.css`(樣式)** + `assets/`。遊戲全域(`DB`/`tick`/`saveGame`/`MAP_CATEGORIES`…)現在定義在 `js/*.js`(一般 script,全域仍共用),不再在 index.html 裡。
- 我們**不擁有也不修改** `index.html` / `js/*.js` / `css/*.css` 的原始遊戲程式碼。所有自訂功能一律以「**外掛 JS**」方式實作(外掛 `<script>` 在 `</body>` 前、排在作者 `js/*.js` 之後,故載入時全域已就緒)。
- **同步已支援多檔結構**:`scripts/sync-upstream.mjs` 會順著 index.html 的 `<script src="js/…">`／`<link href="css/…">` 把 js/、css/ 一起抓進來,每檔用「內容 sha1」當 `?v=` 寫回引用(內容一變 URL 就變、破瀏覽器/PWA 快取,玩家絕不讀到舊版);`sw.js` 對 `.js`/`.css` 走 cache-first、`stamp-sw-version.mjs` 把 js/css 納入 `CODE_VERSION`、workflow `git add` 含 `js css`。作者新增/改名/移除這些檔都自動跟上。
  - **⚠ 作者的引用可能自帶 `?v=` query(如 `js/19-equipment-window.js?v=20260702c`),同步的比對/改寫都要容許 query**。踩過 2026-07-02:`SUBRES_RE` 只認「`.js"` 緊跟結尾引號」,作者新增的裝備視窗 js/19、倉庫視窗 js/20、`css/floating-ui.css` 都帶他自己的 `?v=` → 三檔全漏抓,站台 404、玩家看不到新裝備視窗——而 index.html 本體有同步到,站台「版本號看起來是最新的」,極易誤判成快取問題。**判準:同步後 `grep -oE '(src|href)="(js|css)/[^"]*"' index.html` 列出的每個引用,對應本地檔案都要存在**(smoke 驗外掛掛點,驗不到作者子資源 404)。
  - **⚠ 圖不是只放 `assets/`——作者把登入圖放在 `public/`,同步的 `wanted` 過濾要涵蓋 `public/`**。踩過 2026-07-06:作者 v3.0.40 把首頁改成固定 4:3「藝術舞台」(`#login-art-stage` 背景圖 + 273~300 逐幀動畫),圖放在 **`public/assets/login/*.png`**;但 `sync-upstream.mjs` 的 `wanted` 只收 `t.path.startsWith('assets/')` → 整組 29 張登入圖從沒被同步 → 桌機首頁背景全黑(破圖 alt 外露)、手機首頁版型連帶爆掉(絕對定位圖層擠成一團)。已把 `wanted` 改成 `assets/` **或** `public/`(orphan 清理仍只走 `assets/`,故 public/ 圖不會被誤刪)。**判準:同步後 `grep -oE 'src="[^"]*\.png"' index.html`(及 `login-bg-image`/`login-anim-image` 的 src)指到的圖,本地都要存在**;首頁背景是黑的先想「圖漏抓」而非 CSS。
    - **⚠ 更正(踩過 2026-07-06 傍晚):`public/assets/login/*.png` 會被 SW 當圖桶 cache-first 快取,不是「靠網路載入不快取」。** 因為 SW fetch handler 判「pathname 含 `/assets/` → 進圖桶」,而登入圖 URL 是 `public/assets/login/…`(含 `/assets/`)→ 中。但 `assets-manifest.json`(逐張對帳依據)原本只走訪頂層 `assets/`、不含 `public/` → 這 29 張「**被快取卻永不對帳**」,作者換登入圖(重繪動畫幀)玩家會卡舊、且無從修正(與當年 `assets/anim/` 同一類坑)。**已修:`assets-manifest.json` 的產生改成 `assets/`(去 anim)＋`public/assets/` 一起走訪**(量小 ~29 張,直接併進逐張對帳,reconcileImages 自動處理)。**判準:凡是「URL 路徑含 `/assets/`、會被 SW 圖桶快取」的圖,都必須在某份對帳清單裡(assets-manifest 逐張,或 anim-manifest 逐怪),否則就是『快取卻不對帳→換圖卡舊』。新資料夾進來時用 `grep -rlE 'src=\"[^\"]*/assets/' index.html js` 對照 manifest 涵蓋範圍檢查。**
  - **🚨 GitHub 的 `git/trees/main?recursive=1` API 在原作者圖庫成長到夠大後會「悄悄截斷」回傳清單(截斷門檻是回應大小 7MB,不是條目數),`sync-upstream.mjs` 抓「原作者完整檔案樹」正是靠這支 API——一旦被截斷,腳本會誤判「本地缺的圖其實遠端也沒有」,漏抓整批資料夾(踩過 2026-07-13:圖庫成長到 v3.2.77 時單次回應約 18.6MB,API 回傳 71,988 筆卻標記 `truncated:true`,實際遠端有 117,018 筆——`assets/start/`(創角立繪 1,238 張)、`assets/icons/` 部分技能/裝備圖示等整批被漏掉,導致同步後創角立繪全黑、戰鬥畫面技能/裝備 icon 大量消失,玩家一開局就看到滿屏破圖,而 `sync-upstream.mjs` 自己回報的卻是「新增圖檔:0」,完全沒有警訊)。**這個 bug 不是某一次同步才發生的,只要原作者倉庫繼續長大,之後每次同步都可能再犯,除非修好抓清單的方式(改用非遞迴逐層走訪,或改走 `git clone --depth 1` 直接拿完整檔案樹)。** **判準:同步後若懷疑圖片對不上(角色動圖/怪物圖/icon 大量消失),先 `gh api "repos/shines871/idle-lineage-class/git/trees/main?recursive=1" --jq '.truncated'` 檢查是不是 `true`——是的話這次「圖片 0 差異」的比對結果不可信,要改用 `git clone --depth 1` 抓原作者完整副本,再逐檔比對本地缺什麼,不能只信這支 API 的清單。**
- 原作者(巴哈姆特 秋玥)的官方版本網址:**https://shines871.github.io/idle-lineage-class/**(原版遊戲就掛在這,index.html 的最新原始碼以此為準)。

## 📁 所有紀錄檔(md)一律寫進 `Lineage/加掛版/docs/`,不要寫進專案資料夾裡(2026-07-08 使用者明訂)

- **背景(歷史沿革)**:工作資料夾原本(2026-07-06~2026-07-10)是 `idle-lineage-class-YYYYMMDD-HHMM-NNN` 這種每次改完程式碼或同步完新版就改名、流水號累加的命名方式——紀錄檔如果放在專案資料夾底下的 `docs/`,資料夾一改名,之前的連結、路徑就全部斷掉、下一個接手的 session 也很難找歷史。**2026-07-10 起,使用者已決定工作資料夾固定命名為 `idle-lineage-class`(不含日期/流水號),往後不再改名**——因為 Git 本身已經足以追蹤版本歷史,不需要再靠改資料夾名稱當版本標記,而且資料夾改名容易牽動 `.claude/skills/` 等內部設定與外部書籤。**`Lineage/加掛版/docs/` 仍是跟專案資料夾同層的固定位置**,所有「紀錄檔」(交接紀錄、同步紀錄/差異分析、版本異動紀錄、風險清單、發布/上架流程、外掛依賴矩陣…)一律直接寫在這裡,不要寫進專案資料夾內的 `docs/`(專案資料夾內已不再有 `docs/`)。
- **從專案資料夾內下指令時的相對路徑是 `../docs/<分類>/`**(專案資料夾與 `Lineage/加掛版/docs/` 是兄弟目錄)。分類資料夾與用途說明見 `Lineage/加掛版/docs/README.md`(索引),目前分類:`交接與接手/`、`同步/`、`版本異動紀錄/`、`發布上架/`、`風險與外掛/`;新的紀錄類型找不到對應分類就新開一個,並回頭補進 `README.md` 的分類表。
- **這個 `docs/` 不在任何 git repo 版控內**(它是 `Lineage/加掛版/` 底下的純資料夾,`Lineage/加掛版/idle-lineage-class-*` 才是 git repo),寫完不用/不能 `git add`,純粹是檔案系統上的固定文件庫。程式碼本體、`CLAUDE.md`、`scripts/`、`.claude/` 仍留在專案資料夾內、照常進 git。
- **判準**:新建或修改一份「給人看的紀錄/流程/分析文件」時,先想「這份文件半年後還有人找得到嗎?」——會被找的紀錄檔就該進 `../docs/`,只跟這次修改的程式碼本身有關、不需要跨 session 找的說明(例如 commit message)才留在原地或不必落檔。
- **🔒 工作資料夾名稱固定為 `idle-lineage-class`,不要再改名/加日期流水號(2026-07-10 使用者明訂)**:過去每次改動就重新命名資料夾的習慣已經停用。改名這件事本身沒有帶來額外的版本保護(Git commit 歷史就足夠),卻會讓 `.claude/skills/`、使用者的終端機書籤/捷徑、之前對話裡提到的路徑全部要跟著改一次,徒增麻煩與斷連結風險。**之後任何情境都不要主動建議或詢問是否要重新命名這個資料夾**,固定用 `idle-lineage-class` 這個路徑即可。

## 📱 每一個修改都要考慮手機版,不能只顧電腦版(2026-07-08 使用者明訂)

- **背景**:2026-07-08 做「自動販賣新增例外一次選多個」(E6)時,第一版直接把 `<select>` 加 `multiple` 屬性、靠 Ctrl/⌘/Shift 點擊多選——這在滑鼠桌機上沒問題,但**手機瀏覽器的原生 `<select multiple>` 觸控體驗很差**(通常要長按或跳出笨重的選擇器,無法像桌機一樣直覺多選),使用者當場要求改掉,並要求往後每一個修改都要納入手機版考量。
- **鐵則**:**任何 UI 改動(新增/修改互動元件),交付前都要自問「這個在手機觸控操作正常嗎?」**,不能預設「桌機能用就好」。常見地雷:
  - `<select multiple>`(Ctrl/⌘/Shift 多選)→ 手機不好按,改用**核取方塊(checkbox)清單**(逐行 `<input type="checkbox">` + 文字,點哪行就切哪行,桌機手機都直覺,參考 `js/10-ui-tabs.js` 的 `buildQuickHeader` 快速廢品「全選」checkbox 寫法)。
  - `hover` 才顯示的內容/提示 → 手機沒有 hover,要另外提供點擊可達的方式。
  - 太小的點擊/勾選區域(觸控目標建議至少 ~36-40px 高)。
  - 依賴滑鼠右鍵/滾輪/拖曳等手機沒有的操作。
- **判準/流程**:改完 UI 之後,不能只用桌機視窗截圖驗收——比照 `docs/更新SOP_20260706.md` 表格「桌機/手機」兩欄都要測(可用 Playwright 開手機尺寸的 context 或 `devices['iPhone 13']` 模擬,不方便時至少用 CSS 檢查觸控目標大小/沒有純 hover 依賴)。這條與既有「smoke 對『只在手機才 init 的外掛』要用手機模擬驗」是同一個精神的延伸,但範圍更廣:**不只驗外掛掛得上,還要驗手機上好不好用**。

> 只要發現「漏掉了什麼」或「犯了會再犯的錯」(例:作者新掉落沒進掉落查詢、某英文沒翻成中文、同步漏抓某類資料、某數值算錯…),**修完當下就把『根因＋怎麼偵測/避免＋判準』總結成一條,寫進這份 CLAUDE.md 最貼近的章節**,讓下次同類問題靠這份文件就能擋下來。
>
> - **不要只默默修好**——沒寫進來,下次換個東西又會踩同一類雷(聖地遺物漏進掉落查詢就是這樣被使用者抓到的)。
> - 寫法跟著現有條目:標題一句話講結論、內文寫「為什麼會漏/錯 + 怎麼偵測或避免 + 自我檢查判準」、附日期與踩過的案例。
> - 寫完在回覆裡一句話告知補了哪條、補在哪,讓使用者能否決。

## 「合併原版」= 從原作者站台抓最新 `index.html` 更新本專案

> **2026-07-08 恢復自動比對(推翻 2026-07-06 的停用決定;Cloudflare 觸發器暫不恢復)**:`.github/workflows/sync-upstream.yml` 已恢復,每小時(GitHub 內建 `schedule:`,可能延遲 1~2 小時——因為現在不會自動上線,準不準時不急迫,故不重新部署 Cloudflare Worker/`cf-sync-trigger/`)+ 可手動觸發,自動跑「抓取原作者最新版 → 機械式檔案差異比對 → 關鍵字/識別碼比對(`scripts/check-hook-points.mjs`,新增,見下)→ Playwright 冒煙測試」。
>
> **⚠️ 這支 workflow 只做免費、機械性的前置檢查,不會自動 commit/push/tag/Release**——結果一律寫進 workflow summary,並開/更新一個「等待人工確認」的 issue(不管有沒有測出問題都會開,只是內容標「正常」或「有風險」),runner 上跑出來的檔案變更本身不會留下任何痕跡(沒 commit,work 結束即捨棄)。目的純粹是幫人工/AI 省下「重新讀一次 diff」的 token,**不是拿來自動化最終上線決策**——套用與否仍要走下面「🔒 同步順序」規則。
> - `scripts/sync-upstream.mjs`:抓原版、補回外掛 `<script>`(保留各自 `?v=`)、補新圖、重抓被作者換掉內容的既有圖(比對 git blob SHA)。
> - `scripts/check-hook-points.mjs`(2026-07-08 新增):粗略掃描各 `afk-*.js` 依賴的 DOM id / 已知全域函式名,比對這些字串在剛抓進來的原作者新版程式碼裡是否還存在——即使冒煙測試通過,原作者也可能動到外掛依賴的東西但沒有立刻炸開(只是行為/參數變了),這支腳本抓的是「字串消失/改名」這種更早期的訊號。**先求有的粗略版**:自動排除外掛自己建立的 DOM id / 自己定義的同名函式(homeTown/gotoMap 這種外掛內部 helper 踩過,已排除),只留下真正依賴原作者的部分。清單會漏抓的案例之後踩到再補。
> - `scripts/smoke-hooks.mjs`:Playwright 驗全部外掛 `hooks OK` + 掉落查詢地圖名翻譯覆蓋。
>
> **使用者要看到「等待人工確認」的 issue 時,才需要真的做同步/合併**(見下面 SOP)。
>
> **⚠️ 收到「等待人工確認」issue 時先驗證是不是真的有變,別急著當真——`sync-upstream.mjs` 的 `PLUGINS` 陣列裡每支外掛的 `comment` 字串,如果跟 `index.html` 裡實際的註解文字不一致(例如手動改過外掛功能、直接在 index.html 編輯了註解卻沒回頭改腳本裡的 `comment`),腳本每次重新產生 index.html 都會用它自己過期的 comment 覆蓋,跟已 commit 的版本產生一行文字差異,被誤判成「原作者有更新」(`html_changed=true`),即使遊戲版本號、`js/css`、圖片全部 0 異動也一樣。踩過(2026-07-08):`afk-warehouse-skill.js` 的功能後來多了「不可使用外框」,index.html 裡的註解跟著更新了,但 `sync-upstream.mjs` 沒同步改,連續好幾次同步比對都誤報。**判準/解法**:issue 顯示「程式/樣式/圖片全部 0、只有 `index.html 有變`」這種模式時,先懷疑是自己的 comment 沒同步,不是原作者真的改了——用乾淨 `git clone` 到暫存資料夾重跑 `node scripts/sync-upstream.mjs`,`diff` 產生的 `index.html` 跟 `git show HEAD:index.html`,一行行找差異(連全形/半形逗號都要看,踩過);差異只在某支外掛的 `<!-- comment -->` 文字時,回去把 `PLUGINS` 陣列裡對應的 `comment` 改成跟 index.html 現有文字**逐字元一致**。**以後改外掛功能、順手在 index.html 裡改了註解說明時,記得同時回頭改 `sync-upstream.mjs` 的 `PLUGINS[].comment`,兩處要保持同步。**

### 🔒 同步順序:先確認有沒有跑過自動比對,再分析、記錄、評估外掛風險,經使用者同意才套用(2026-07-08 最終定案)

> **第 0 步(2026-07-08 新增,在原規則最前面加的前置檢查)**:開始人工/AI 分析前,先確認**這次原作者更新有沒有經過上面 GitHub Actions 的自動比對＋冒煙測試**(看有沒有開出「🔍 原作者已更新,等待人工確認是否套用」的 issue,或 `gh run list --workflow=sync-upstream.yml` 查最近一次 run 的時間/結果)。
> - **沒跑過**(例如作者剛更新、workflow 還沒排到,或使用者直接把新版資料夾丟進來要求同步)→ **先問使用者**:「要不要先觸發 GitHub Actions 跑一輪自動比對+冒煙測試,再根據結果決定分析深度?還是要直接手動分析?」,等使用者回覆才繼續。避免明明 Actions 能免費先做完機械式比對,卻跳過去重複花 token 從頭手動分析一次。
> - **有跑過**→ 直接把 workflow summary / issue 內容(diff 清單、關鍵字比對結果、冒煙測試結果)當素材,省掉重新讀一次 diff 的力氣,直接進入下面第 1~4 步整理報告。
> - **⚠️ 2026-07-17 補充:Cowork(在 `Lineage/加掛版/` 底下工作、負責純分析的助理)的 sandbox 沒有裝 `gh` CLI、也連不到使用者的 GitHub 帳號權限,沒辦法自己查有沒有開出上述 issue、也查不到 workflow run 狀態**。Cowork 執行這份 SOP 時,第 0 步一律**直接口頭問使用者**「這次有沒有已經跑過 GitHub Actions 自動比對(有沒有看到那個等待確認的 issue)?」,由使用者回答後才決定要不要拿 issue 內容當素材,不要嘗試自己用 `gh` 指令查(會失敗)。只有 Claude Code(在使用者本機、有 `gh` 權限的那一側)才能真的自己執行 `gh run list` 等指令查證。
>
> 不管這次同步走哪條路(GitHub Action 自動比對;手動 curl 抓網站版;或使用者直接把新版整份丟進 `加掛版/` 資料夾、用 `scripts/sync-local-upstream.mjs` 套用——**目前實務上主要是這條**,GitHub Actions 不會自動 commit,所以套用仍是這支手動腳本),都要照下面順序,**不是套用完再回頭看差異**:
>
> 1. **先分析差異,且先別覆蓋任何現有檔案**:新版來源(不管是使用者放的資料夾、抓下來的暫存檔,或上面 workflow 已經整理好的比對結果)當唯讀資料,逐檔比對 `index.html`／`js/*.js`／`css/*.css` 跟目前 repo 內對應檔案的差異(`diff` 兩份檔案內容即可,不必先跑同步腳本)。**不只挑新增的定義看,既有公式/機制被改也要抓出來**——這跟小百科 SOP 那條鐵則是同一個道理(改既有邏輯不會以「新增」的樣子出現,只挑新增一定漏)。
>    - **⚠️ 2026-07-17 補充(大版距跳版技巧)**:如果這次跳版幅度很大(例如一次跳幾十個版號),不要老老實實逐行讀完整份 diff——原作者自己會在程式碼裡用「emoji + 版本號」留 inline 註解當作逐版 changelog(例如 `🌑 v3.4.67 ...`、`🧱 v3.4.50 ...`),先用這個指令**全部抓出來當第一輪素材**,比純讀 diff 快很多也不容易漏掉系統性變更:
>      ```bash
>      grep -ohE '//[^\n]*v3\.[0-9.]+[^\n]*' js/*.js | sort -u
>      ```
>      抓完之後再針對這些標記到的關鍵函式/檔案回頭讀完整 diff 確認細節,兩者搭配使用,不要只看註解就當作分析完成(註解不保證涵蓋所有異動,尤其是純數值微調常常沒留註解)。
>    - **⚠️ 2026-07-18 補充(套用階段的效率技巧,前提是本機真的有完整的兩份原作原始碼資料夾可比對——如 `原作者新版/<舊版號>` 與 `原作者新版/<新版號>`)**:套用前先用 `diff` 逐檔比較「我方 fork 目前的 `js/*.js`」跟「舊版基準資料夾」——**diff 為 0 的檔案代表我方對該檔完全沒有客製,可以直接把新版資料夾的同名檔整檔複製覆蓋**,不必逐 hunk 手動套用;只有 diff 不為 0(有客製)的檔案才需要讀 `patch`/手動比對,避開客製區塊逐段套用。這次(v3.5.4→v3.5.36)18 個改動檔裡只有 3 個(`00-data.js`/`08-items-equip.js`/`13-shop-save.js`)真正需要手動套,其餘全部整檔覆蓋,省下大量逐行比對的時間。`index.html`/`css/style.css` 因為客製多,`patch -p0` 直接套用上游 unified diff 通常也能乾淨套用(context 比對,不是純行號)。套完後 `js/css` 的 `?v=` 用小 node 腳本重算內容 sha1 覆寫(邏輯同 `sync-upstream.mjs` 的 `SUBRES_RE`/`subHash`),不用手動照抄原作自己的版號字串。圖片資源用 `rsync -a`(不加 `--delete`)從新版資料夾覆蓋進 `assets/`,再用跟 `sync-upstream.mjs` 4c/4c-2 步驟同一套邏輯本機重跑 `assets-manifest.json`/`anim-manifest.json`。
> 2. **把分析結果寫成記錄檔,存進 `../docs/同步/`**(即 `Lineage/加掛版/docs/同步/`,跟專案資料夾同層、位置固定不隨資料夾改名;檔名統一用 `同步差異分析_YYYYMMDD.md`——同一天有多份分析時用 `a`/`b`/`c`…英文字母後綴區分,例如 `同步差異分析_20260716b.md`,不要用描述性檔名,避免同一資料夾檔名慣例混用),內容至少包含三類:新增功能、數值/機制調整(改了哪個函式/公式,原值→新值)、新增內容代表性例子(裝備/道具/地圖等)。
> 3. **評估這次改動會不會影響外掛結構**:對照 `index.html` 的 DOM id/class、原作者全域函式名稱,有沒有被改名/移除、是不是我們 `afk-*.js` 掛點依賴的東西;`node scripts/check-hook-points.mjs` 與 `node scripts/smoke-hooks.mjs` 可以當輔助佐證(或直接看 workflow 已經跑好的結果),但不能取代人工讀 diff 判斷(這兩支只驗「現有掛點還在/字串還在」,不會告訴你「這次改版邏輯上會不會跟外掛衝突」)。評估結果一併寫進同一份記錄檔。
> 3.5. **⚠️ 2026-07-17 新增:一併檢查小百科(`afk-wiki.js`)與掉落物查詢(`afk-dex.js`)是否需要跟著更新**——這兩支外掛的「資料」大多直接讀 `DB`(道具/怪物/技能),原作新增內容通常會自動出現、不用手動改;但如果這次新增了**特殊機制**(例如隱藏地城的進場方式、頭目專屬機制、變身鏈邏輯這種「資料看得到、但不知道怎麼應對」的東西),要在記錄檔裡明確列一段「小百科/掉落查詢待補項目」,寫清楚是不是需要新增手寫的說明章節(參考現有的「軍王之室」章節寫法)。找不到需要補的項目就直接寫「本次無新增需要小百科/掉落查詢收錄的機制類內容」,不要略過不提。
> 4. **記錄檔寫完之後才能回報使用者、等他同意,經同意才真的套用同步(執行 `sync-local-upstream.mjs`/覆蓋檔案並 commit)**。使用者是程式小白,回報時用白話文講清楚「這次原作者加了什麼、會不會影響我們的外掛」讓他能做決定,不要假設他都懂、也不要先套用了才問。
>
> 套用之後仍要照原本流程走完(分支 → smoke test → 手動功能驗收 → 使用者實測 → 合併進 main),這條規則只是把「差異分析+風險評估+使用者同意」這三步從「套用之後」搬到「套用之前」,其餘步驟不變。
>
> 5. **⚠️(2026-07-17 使用者明訂,套用同步後、commit 前必做)檢查以下「直接改本體(非外掛疊加)的客製 UI」有沒有被這次同步整份覆蓋沖掉,沒了要照對應 commit 補回來**——這類客製是直接改 `index.html`/`css/style.css`/`js/*.js` 本身(不是掛外掛 `<script>`),同步腳本只保留我們的 `<script>` 引用清單,不會保留這種本體結構改動,**每次同步都可能被原作者的新版整份洗掉**,一定要每次都檢查,不能假設「上次同步後還在」:
>    - **創角畫面 `creation-layout-v2`**(桌機立繪疊背景圖、性別/職業/配點定位,手機捲動版面;立繪用 `assets/start-transparent/` 去背版素材):判準 `grep -c "creation-layout-v2" index.html css/style.css`,兩邊都要 >0。原始樣式來源commit `959e782f5`,2026-07-16 同步 v3.4.86(`c855a9c8f`)沖掉過一次,2026-07-17 已對照 build `0715-1813` 補回(index.html 的 6 個 `creation-zone-*` class + `class-preview-img` 圖源、css/style.css 檔尾的完整 creation-layout-v2 區塊、js/13-shop-save.js 的 `creationFrameSrc()` 函式與 3 個呼叫點+`openLoadSelect()` 的 `scrollTop=0`)。
>    - **能力分頁 `#tab-stats` 舊版表格樣式**(不採用原作新版「能力視窗」美術改版):判準檢查 `index.html` 的 `#tab-stats` 區塊還是表格式舊樣式(不是新版能力視窗那種卡片美術版面)。樣式來源 commit `c2816121a`(當時對應 build `0714-1608`),2026-07-16 同步 v3.4.86 時有隨手復原成功(commit `c855a9c8f` 訊息裡的「能力分頁復原舊版表格樣式」),但**這只是那次剛好有做,不代表以後同步會自動記得**,以後每次同步都要重新檢查一次。**⚠️ 2026-07-19 補充:復原時不能直接把歷史commit的舊版HTML整段複製貼回——原作可能在這之間的版本新增了舊模板沒有的欄位**(例:同步到 v3.6.03 時新增了「近/遠距離爆擊傷害」「魔法爆擊傷害」「擊殺回魔」「無屬性抗性」,c2816121a 當時的舊模板完全沒有這幾格)。**正解:先比對「剛被同步覆蓋的新版本有哪些欄位id」跟「客製commit移除前的舊版有哪些欄位id」,取聯集手動補齊**,不是單純整段還原/覆蓋,否則會讓玩家看不到這次同步新增的數值欄位。
>    - **首頁公告橫幅 `_orig_pbar`**(`js/00-data.js` 的 `_origEnforce()`):原作者本體自己也有一個同名函式(在非官方網域顯示「非官方轉載版本」提示),我們是**直接改寫這個函式本身**(不是外掛疊加),客製內容包含:①文字改成「原作:秋玥;加掛版:Chaos,請支持原作、勿販售」(不是原作的「非官方轉載版本,內容可能不是最新」);②只在首頁(`#main-menu` 未隱藏)顯示,離開首頁要自動移除(不是原作的「一直掛著,只認網域」);③樣式改成 `position:relative` 插進 `#login-art-stage` 內部、跟背景同層置頂(不是原作的 `position:fixed` 蓋住整個瀏覽器視窗、`z-index:2147483647`);④額外的 `setInterval(_origEnforce, 600)` 輪詢(原作只在 `gameLoop` 重掛,抓不到「首頁→選角畫面」這種切換)。**每次同步整份覆蓋 `js/00-data.js` 都會把這個函式打回原作者的原版**(2026-07-17 同步 v3.5.4 時踩過,使用者反映「公告內容/顯示範圍/樣式/邏輯全部跑掉」才發現)。判準:同步後 `grep -n "position:fixed;left:0;right:0;top:0;z-index:2147483647" js/00-data.js` 應該**沒有結果**(有結果代表被打回原版);來源 commit `d167d0692`(文字/樣式/只在首頁顯示邏輯)+ `b9924cbec`(手機安全區域 padding 修正,若有動到 `titleLayer` 相關的手機修正記得一併核對)。
>    - **強化「無事」訊息文字**(`js/08-items-equip.js` 的 `doEnhance()`):原作原文是「${fn} 一瞬間發出銀色的光芒。」,跟上面「成功」的訊息文字幾乎一樣(只差顏色深淺與有沒有 `+N` 前綴),使用者反映容易把「卷軸消耗但沒有變化(無事)」誤看成「成功強化」,已改成「${fn} 卷軸的魔力消散了，沒有任何變化。」。判準:同步後 `grep -n "一瞬間發出銀色的光芒" js/08-items-equip.js` 應該**沒有結果**(有結果代表被打回原版的模糊措辭)。
>    - **離線快算(`state.ff`)跳過NPC血盟團戰/野外PVP遭遇/白目玩家復仇遭遇**(`js/03-combat-core.js` 的 `pvpOnKillMob()` 與 `spawnMob()`,標記 `[FB5-CUSTOM]`):2026-07-21 因批次結算變慢(見 `docs/交接待辦/2026-07-21_批次結算變慢_交接Claude Code.md`)新增,①`pvpOnKillMob()` 呼叫 `npcClanMaybeStartGroupBattle(mob)` 前加 `!state.ff` 判斷(離線快算不觸發新的NPC血盟團戰);②`spawnMob()` 內「野外PVP遭遇判定」+「白目玩家復仇遭遇」這兩段整段包進 `if (!state.ff) { ... }`。這兩處都是**直接改原作函式內部邏輯**,同步整檔覆蓋 `js/03-combat-core.js` 會把這兩處改動打回原版(離線快算又變慢、且可能在離線期間卡進NPC血盟團戰迴圈)。判準:同步後 `grep -c "FB5-CUSTOM" js/03-combat-core.js` 應該 **=2**(少於2代表被沖掉,要重新套用;細節見 `docs/版本異動紀錄/版本異動紀錄_技術版.md` 2026-07-21 對應那筆與程式碼內的 `[FB5-CUSTOM]` 註解本身,注釋已寫清楚改了什麼、為什麼)。
>    - 偵測方法:同步套用完、commit 前,對這五塊各自 `git diff`(或直接 `grep`)確認客製標記還在;不在的話回頭找上面列的來源 commit,把對應區塊的內容重新套到當次同步後的新檔案上(不能整份還原成舊 commit 的檔案——那樣會把原作者這次真正的新內容也一起蓋掉,只能挑「客製相關的那幾塊」手動補回)。
>    - 之後如果又出現新的「直接改本體」客製(不是掛外掛),做完當下就仿照這幾條格式加進這裡,不要只留在 commit message 裡——commit message 不會在下次同步時被翻出來看,寫進 CLAUDE.md 才會被同步 SOP 逼著每次檢查。

### 使用者說「合併原版 / 同步原版 / 更新原版」時 → 先用 GitHub Action,不要急著手動

**第一步永遠是直接觸發那支 workflow**,因為它做的就是完整合併流程、且在 Linux 上更穩(中文檔名直接用 URL,不必走 blob SHA):
```bash
gh workflow run sync-upstream.yml --ref main
# 等幾秒拿到 run id,再盯著跑完
gh run list --workflow=sync-upstream.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch <run_id>   # 或輪詢 gh run view <run_id> --json status,conclusion
```
> **⚠ 同步「卡死」的判準與解法(踩過 2026-07-04)**:症狀=站台一直停在舊版(玩家回報「原版有的功能我們沒有」,如怪物動畫 25→399 隻的改版沒跟上),`gh run list` 看到**一筆 sync run `in_progress` 掛了一兩小時、後面每 15 分的 run 全是 `cancelled`**(concurrency 佇列被堵住,cancelled 的連 job 都沒起)。根因:腳本逐檔序列 `fetch`,單一連線僵住就永遠卡住(當時無逾時)。解法:`gh run cancel <卡住的 run id>` → 佇列中的下一輪自動接手(通常幾十秒就跑完)。腳本已加 `fetchRetry`(60s 逾時×3 次重試)防再犯;若再看到同症狀,先 cancel 卡住的 run,再查 run log 是哪個 URL 一直重試失敗。

跑完後看結果回報使用者(**這支 workflow 不會自動 commit/push,只負責產出比對報告**):
- **changed=false**:原作者沒更新,什麼都不用做。
- **changed=true**:會開/更新一個「🔍 原作者已更新,等待人工確認是否套用」的 issue,附檔案差異統計、關鍵字/識別碼比對結果、冒煙測試結果——**這時才**走上面「🔒 同步順序」規則:讀 issue/summary 內容當素材(省掉重新讀 diff 的力氣)、逐檔看完整 diff、寫記錄檔、評估外掛風險、回報使用者,同意後才用 `sync-local-upstream.mjs` 真的套用(見下面手動流程)。issue 內容若標「⚠️ 有風險」(冒煙沒過/關鍵字比對抓到位置被動到),分析時要特別看那幾處。

> 同步成功後順手檢查一項:`afk-fixes.js` 的「renderTabs select-guard」是補原作者「戰鬥中重刷分頁 DOM 害強化下拉被關」的坑。
> 若原作者已改成 diff 更新(不整塊重建分頁、不刪 `<select>`),這段就成多餘,可整段刪掉(留著無害,只是死碼)。

> 只有在 workflow 不能用(沒有 `gh` 權限、Actions 被停、或要 debug 合併本身)時,才整套手動跑。手動流程如下,
> 原則:原版整份覆蓋 `index.html` + 補回外掛 + 補新圖,我們從不改動原作者的遊戲碼。

### 1. 抓原版 `index.html`(放暫存區,別直接覆蓋)
```bash
curl -s --ssl-no-revoke -o D:/ppRepos/_scratch/scripts/orig_index.html \
  https://shines871.github.io/idle-lineage-class/index.html
```
- `--ssl-no-revoke`:git-bash 的 curl 走 Schannel,對某些站憑證撤銷查不到會硬失敗(exit 35),加這個只跳過撤銷檢查。

### 2. 確認原版乾淨 + 比對差異
- `grep -c -a "afk-" orig_index.html` 應為 **0**(原版不該有我們的外掛);`tail` 看結尾是正常 `</body></html>`、只有一個 `</body>`。
- 跟「目前版本」做 diff,看原作者改了什麼(寫進 commit message 給使用者看):
```bash
git show HEAD:index.html > D:/ppRepos/_scratch/scripts/current_index.html
# diff 時把我們加的外掛 script 行濾掉,避免被當成差異
diff <(grep -v -a "afk-offline.js\|afk-mobile.js\|afk-dex.js\|afk-fixes.js\|可獨立維護" current_index.html) orig_index.html
```

### 3. 算出原版新增、本地缺少的圖檔
用 GitHub API 抓原作者 repo 完整檔案樹,逐筆比對 `assets/`:
```bash
gh api repos/shines871/idle-lineage-class/git/trees/main?recursive=1 \
  --jq '.tree[] | select(.type=="blob") | .path'
```
- 列出「原版有、本地 `idle-lineage-class/` 沒有」的 `assets/*`。
- `desktop.ini` 這種 Windows 垃圾檔**不要**收。

### 4. 用原版覆蓋 + 把外掛 `<script>` 補回 `</body>` 前
**用 python 處理(中文 UTF-8 最穩),不要用 shell 字串拼**。讀原版內容 → 在 `</body>` 前插入五支外掛 script(**記得帶 `?v=` 版本號**,見「每次 push 前的檢查清單」) → 整份寫出。動手前 `assert` 原版只有一個 `</body>`、且尚未含外掛,避免插錯。

### 5. 抓缺的圖 —— 走 blob SHA,別用中文檔名當參數
中文檔名直接丟給 curl / 原生 exe,git-bash(MSYS)會重編碼把檔名弄壞。改走 **blob SHA(純 ASCII)**:
```bash
# 先拿到 path → sha 對照(含中文 path 沒關係,jq 輸出是資料不是 exe 參數)
gh api repos/shines871/idle-lineage-class/git/trees/main?recursive=1 \
  --jq '.tree[] | select(.type=="blob") | [.path, .sha] | @tsv'
```
再對每個缺檔 `gh api repos/shines871/idle-lineage-class/git/blobs/<sha>` 拿 base64 → decode 寫檔;**寫檔路徑用 python 的 unicode 字串**,檔名才正確(終端顯示亂碼是 console 編碼問題,實際檔名是對的,用 `git -c core.quotepath=false status` 驗)。

### 6. 自己驗證(不要丟給使用者測)
本機開 http server + Playwright 無頭載入 `index.html`:
- console 五支外掛都 `[AFK*] hooks OK` → 代表原作者沒改壞掛點(改了 id / DOM 順序才會失效,失效就回報哪個外掛哪個掛點要調)。
- 縮到手機尺寸確認手機版面沒爆。

### 7. commit + push + 清暫存
`git add -A` → commit(描述原作者這次更新了什麼)→ push → 刪掉 `_scratch/scripts/` 這次產生的中繼檔。

## ⭐ 核心原則:所有功能都用「外掛 JS」處理

- 任何新功能(離線掛機、手機版面、存檔匯入匯出…)**一律寫成獨立的 `*.js` 檔**,放在專案根目錄,用 **monkey-patch / 從外面包住全域函式 / 注入 DOM·CSS** 的方式掛上去。
- **嚴禁直接改 `index.html` 裡原作者的程式碼。** 對 `index.html` 唯一允許的改動,是在 `</body>` 前加上引用外掛的 `<script>` 標籤。
- 外掛要能「優雅降級」:自我檢查需要的全域函式/元素是否存在,缺了就 `console.warn` 後安靜停用,**不可把遊戲弄壞**。
- 這樣設計的目的:原作者更新版本(換掉整個 `index.html`)時,只要把那幾行 `<script>` 重新貼回去就能接上,外掛本身幾乎不用動。
- **「補原作者坑」的程式碼要標移除條件——但只標「過時後還會主動執行的」**:判準是『原作者修好後,這段會自己安靜退場,還是仍在跑?』。仍在跑的(執行期包住核心函式、長駐監聽/interval,如 `afk-fixes.js` 的 renderTabs select-guard)→ 放 `afk-fixes.js`(通用補坑檔)、並在該段檔頭寫清楚「原作者怎麼改就能整段刪」。會自動失效的(scope 在特定選擇器的 CSS 覆寫、單純去重/防禦)→ 不必標,選擇器不命中就回原樣、留著無害,留在原檔即可。我們自己的功能(離線掛機、手機版面…)不算「補坑」,不需要這種備忘。

### ⚠️ 外掛之間也會互相打架——DOM id/class 撞名不是只有「跟原作者本體衝突」才算風險(踩過 2026-07-12)

> **案例**:`afk-batch-sell.js`(物品欄批次販賣)跟 `afk-batch-settle.js`(批次結算所有存檔位)兩支獨立外掛,分別各自想到用 `m-bs-` 當彈窗 DOM id/class 前綴(一個取「batch **s**ell」、一個取「batch **s**ettle」,縮寫恰好相同)。兩者都各自 `if (document.getElementById('m-bs-modal')) return;` 防重複建立,結果先建立的那支「贏得」這個 id,另一支的按鈕點擊操作到的其實是**對方的彈窗**;兩支各自的 CSS `#m-bs-modal{display:none/flex}` 又用同一個 id 選擇器互相覆蓋(後載入的贏得 cascade),導致其中一支的彈窗被永久強制隱藏——玩家表現＝「按鈕點了完全沒反應」,console 沒有任何錯誤,非常難從症狀反推根因。
- **判準**:新增外掛時,幫彈窗/浮層/表單元素取 DOM id 或 CSS 前綴,**不能只確認「原作者本體沒有這個 id」,還要確認「我們自己其他 27+ 支外掛也沒人用過」**——尤其是縮寫式命名(取功能名字首字母)特別容易撞名,人多手雜、各自命名時不會去讀過全部其他外掛的原始碼。
- **偵測方法**:新增外掛前,對打算用的 id/class 前綴跑一次 `grep -rn "你的前綴" afk-*.js`,確認沒有別支外掛已經用過。修這類 bug 時,如果懷疑是撞名,直接檢查該 DOM id 的 CSS 規則是不是只有一條(`document.styleSheets` 逐條找 `selectorText` 相符的規則,只該有一條;超過一條或內容跟預期不符,就是撞名)。
- 已修正:`afk-batch-sell.js` 全部 `m-bs-*` 改名為 `afk-bsell-*`,避免再撞名。

### 🚨 外掛絕不可盲呼叫「會寫入/覆蓋玩家存檔」的原作者函式(踩過、害玩家存檔變 Lv.1 null)

> **血淚教訓(存檔轉移外掛)**:匯出功能為了「存最新進度」呼叫了原作者的 `saveGame()`。但匯出鈕在**主選單**上,主選單是「**還沒載入角色**」的狀態——此時全域 `player` 是 `index.html` 的空白預設值(`name:null, lv:1`),而 `saveGame()` **沒有防呆**,直接把 `player` 寫進 `lineage_idle_save_<currentSlot>`,於是**把玩家第 1 格的真實存檔覆蓋成 Lv.1 null,且無備份可救**。

- **外掛要拿存檔資料 → 直接讀 `localStorage`**(`lineage_idle_save_<n>`),**不要為了「拿最新」去呼叫 `saveGame()` 之類會寫檔的函式**。
- **真的非呼叫寫檔函式不可時,務必先確認「真的有載入角色」再呼叫**:`if (player && player.cls) { ... }`(空白 `player` 的 `cls` 是 `null`)。`saveGame()` 寫的是「目前所在存檔位 `currentSlot`」,在選單/未載入狀態呼叫 = 拿空白角色蓋掉那一格。
- 推論:**任何「會改動玩家 localStorage」的外掛操作,都要假設自己可能在「未載入角色 / currentSlot 不是使用者以為的那格」的狀態被觸發**,先驗狀態再動手;能唯讀就唯讀。
- 原作者的存檔系統**只在「匯入」時才留 `*_bak` 備份**,`saveGame()`/一般存檔**不留備份**——所以一旦被外掛誤覆蓋就是永久損失,務必從源頭防止。

### ☁️ `afk-cloud-sync-v2.js` 新增「帳號共用桶」(不屬於單一存檔位的資料)時,要合併不要覆蓋(2026-07-20 補血盟資料同步時定案)

> **背景**:v3.6.03 新增的血盟系統資料存在獨立全域 `localStorage` key(`fb5_clan_state_v1`,不屬於任何 `lineage_idle_save_<slot>`),雲端同步一開始完全沒讀寫它,換裝置下載後血盟等級/貢獻度/城堡全部消失。修的時候發現:這種「同帳號多角色共用、非單一存檔位」的資料,合併邏輯不能套用existing的「slot衝突→跳視窗讓玩家選本機/雲端」那一套(玩家不知道怎麼選、選錯會讓另一台裝置的進度憑空消失)。
> - **判準**:以後任何新的「帳號共用桶」(不是某個角色專屬,而是多個存檔位共同讀寫的東西)要接進雲端同步時,合併邏輯要逐欄位判斷「這個欄位的語意適合怎麼合併」,不要整份覆蓋、也不要套用slot那種二選一的衝突視窗:
>   - 單調遞增型數值(等級經驗、貢獻度)→ 取兩邊**較大值**(不會讓已存在的進度倒退,代價是極端情況下重複計入的量不會被扣掉,可接受)。
>   - 只存在其中一邊的項目(如成員字典裡某個key)→ **整筆保留**,不能因為另一邊沒有就當作要刪除。
>   - 有「開關/狀態」語意的欄位(如buff是否開啟)→ 用「哪一側的時間戳較新」整筆採用該側狀態,不要跟數值型分開各自合併(開關狀態不是單調遞增,不能取「較大值」)。
>   - 沒有專屬時間戳可比較新舊的欄位(如攻城佔領到的城堡),退而求其次用「整份共用桶資料的 `updatedAt`」當代理指標(前提是這個桶的任何一次有意義寫入都會刷新 `updatedAt`)。
> - **測試這類合併邏輯的坑**:如果資料的寫入函式(如 `_clanWriteState()`)本身**一律把 `updatedAt` 蓋成真實 `Date.now()`、不接受手動指定過去值**,那麼直接塞小數字(如 `updatedAt:5000`)當「較舊」的假測試資料會被真實呼叫覆蓋成當下的真實epoch ms(遠大於任何測試小數字),導致「本機永遠判定較新」的假結果。要正確模擬新舊,得用「以真實 `Date.now()` 為基準加減一段時間」構造測試資料,不能直接寫死小數字。
> - 只用 monkey-patch `AFK_CLOUD.api.getSave`/`api.putSave` 回傳假資料、呼叫 `AFK_CLOUD.flow.uploadAll()`/`downloadAll()`,就能在單一瀏覽器分頁裡完整模擬「雙裝置同步」情境,不需要真的開兩個瀏覽器或真實後端。

## ⚠️ 改 `afk-offline.js`(離線掛機)前一定要想清楚:這支牽一髮動全身,別為了修一個場景把另一個場景弄壞

> **背景(2026-07-17 使用者明訂)**:這次修「批次結算後角色全部回村莊」的 bug,根因在 `afk-offline.js` 的地圖後援讀取(`readSavedMapFallback`)——這段邏輯同時服務好幾種情境(單獨登入續掛、批次結算續掛、攀登/遺忘之島/軍王之室等特殊地圖續掛、剛匯入存檔的角色…)。修一個情境的 bug 時,很容易沒注意到同一段程式碼、同一個判斷分支其實也扛著其他情境的正常運作,結果修好 A 卻不小心把 B 弄壞。
> - **判準**:改這支檔案任何一段邏輯前,先自問「這個函式/這段判斷除了我現在要修的這個情境,還有沒有服務其他情境(單獨登入/批次結算/攀登/遺忘之島/軍王之室/木人場/時空裂痕…)?」,改完後**至少要把這份 CLAUDE.md 前面列出的每一種特殊地圖續掛規則都重新掃一遍**,確認沒有被順手改壞。
> - **不能只測「這次要修的那個 bug 場景」就收工**——例如這次測了「一般狩獵圖存活續掛」正常,還要意識到攀登/遺忘之島/軍王之室走的是不同分支,同一個改動可能只顧到一種分支。
> - 有能力的話,盡量用**真實存檔**(不是憑空捏造的測試角色)測過再收尾——這次能抓到問題,就是使用者提供了真實存檔測試,靠捏造的測試角色反而因為戰鬥隨機性,一度誤判成「不確定是不是 bug」。
> - **⚠️ 2026-07-21/22 新增(踩過「批次結算物品/獎勵拿不到」):`afk-batch-settle.js` 快速切換存檔位是先 `currentSlot = n` 再呼叫 `loadGame()`,但原作 `loadGame()` 內部在真正把 `player`/`state` 換成新角色「之前」,會先自己觸發 `saveGame()`/`changeMap()`(替上一個角色收尾)——這些中途呼叫都會觸發 `stamp()`,而此時 `currentSlot` 已經是新的 n、但 `state.oblivion`/`state.prideClimb` 等全域狀態還是上一個角色殘留的,兩者兜起來就把上一個角色的旅程狀態誤寫進新角色的 `afk_obl_n`/`afk_pride_n`,連鎖污染會一路傳下去(角色1在遺忘之島,批次結算後角色2~8全部被誤判)。**已修**:用 `_inOrigLoad` 旗標包住 `loadGame()` 的原始呼叫,執行期間 `stamp()` 一律跳過,等 `maybeCatchup()` 用「這次真正讀到的新角色狀態」才蓋一次準確紀錄。**判準:任何「批次快速切換 currentSlot 再呼叫會連鎖觸發 saveGame/changeMap 的原作函式」的外掛邏輯,都要假設中途有一段『currentSlot 已換、但全域 state 還沒換』的窗口期,凡是靠 currentSlot 當 key 寫 localStorage 的地方都可能在這段窗口被舊角色的殘留狀態污染**——不能只驗證「最終結果的地圖選對了」就收工,還要驗證「決定要不要走特殊地圖流程(isObl/isClimb 這類旗標)的判斷,是不是每個地方都用同一份『已修正過』的依據,不要留一份獨立重算、沒跟著同步的分支」(這次就是 `maybeCatchup()` 修好了地圖選擇,但 `runCatchup()` 內部又獨立重算了一次 `isObl`,兩邊沒同步,結果污染持續自我延續)。**

## 📢 每次新增/調整/修 bug,都要順手更新首頁「最新公告」(`afk-whatsnew.js`)——這是往後的日常慣例,不是一次性任務

> **(2026-07-17 使用者明訂)**:首頁「📢 最新公告」按鈕(`afk-whatsnew.js` 的 `CHANGELOG` 陣列)是玩家最先看到、最直接了解「這次改了什麼」的地方,**跟 `Lineage/加掛版/docs/版本異動紀錄/版本異動紀錄_玩家版.md` 是兩個不同的東西、要分開維護**:後者是給人查歷史用的文件庫(不隨遊戲部署),前者是**真的會顯示在遊戲首頁彈窗裡**給玩家看的內容。
> - **判準:只要這次改動是「玩家看得到/感受得到的變化」(新增功能、調整行為、修復 bug),做完當下就要在 `afk-whatsnew.js` 的 `CHANGELOG` 陣列最上面加一筆**,格式比照陣列裡既有的寫法(`date`+`title`+條列 `items`,白話文,不用技術術語;有對應小百科分頁的項目可以附 `wiki:{tab,cls}` 連結)。
> - 純內部技術調整(不影響玩家實際體驗的重構、註解補充、CLAUDE.md 文件更新本身)不需要加。
> - 這是**日常慣例**,不是等使用者提醒才做一次——比照小百科「內文分類上色」「更新日期注記」那兩條慣例的精神:每次有玩家看得到的改動,都要順手做,不用另外開一輪去回頭補沒做過的舊項目。

## ⚠️ 「⚙設定/📋紀錄」快捷面板系統(離線紀錄/批次結算/資產管理/效能診斷…)長期只掛在首頁,遊戲中打不開——新增「只在遊戲中才有意義」的功能前要先想清楚入口在哪(2026-07-20 踩過)

> **背景**:`afk-quickpanel.js`/`afk-history.js`/`afk-storage.js`/`afk-batch-settle.js`/`afk-asset-manager.js`/`afk-diagnostics.js` 這些外掛全部透過 `window.AFK_SETTINGS.add({label,onClick})` 把自己的功能掛進「⚙設定」或「📋紀錄」選單,而這兩個選單的按鈕**一律只插在 `#main-menu`**(首頁,尚未登入角色/已登出的畫面)。玩家真正登入角色進到 `#game-screen` 後,`#main-menu` 整個隱藏,這些按鈕連同它們開的彈窗**完全沒有入口打得開**——這是從最早期就有的設計,一直沒被當成問題,直到 2026-07-20 新增「線上遊玩效能」(`afk-online-profile.js`)時才第一次真正卡住:這份數據只有「角色在遊戲中掛機」時才會累積,但唯一能看到它的效能診斷彈窗卻只能在「沒在玩」的首頁打開,兩者互相矛盾,使用者親自發現「我在遊戲裡面要怎麼開效能診斷」才揭穿這個長年存在的缺口。
> - **判準:新增任何「資料/狀態只有在遊戲進行中才有意義」的功能(效能量測、即時統計、進行中的狀態顯示…)時,規劃「玩家從哪裡打開/看到這個功能」的當下,要先確認這個入口在玩家實際會用到這個功能的情境下真的碰得到**——不能預設「沿用 `AFK_SETTINGS.add()` 這個既有模式」就一定合理,因為那個模式的入口只在首頁。
> - **已知解法(不是通用方案,只解決了「線上遊玩效能」這一項)**:`afk-online-profile.js` 用 monkey-patch 包住原作 `renderAuditTab()`(遊戲內「統計」分頁,`js/05-kill-progression.js`,本來就有、且每 2 秒自動刷新),在渲染完後追加一小塊摘要區塊,讓資料在遊戲內看得到。**這只解決了這一項功能**,`afk-history`/`afk-batch-settle`/`afk-asset-manager` 等其餘只掛在首頁的功能仍然維持原樣,除非使用者之後也覺得該搬進遊戲內,否則不要主動去動它們。
> - 如果之後要幫某個「只掛在首頁」的功能新增遊戲內入口,參考同一套手法:找一個遊戲內本來就存在、玩家常態看得到的分頁/面板(如 `tab-audit`),monkey-patch 它的渲染函式,用「找固定id的既有節點就更新、找不到才新增」的方式追加內容,避免原函式提早return的分支造成重複疊加(見 `afk-online-profile.js` 的 `appendBlock()` 寫法)。

## 目前的外掛

| 檔案 | 功能 |
|---|---|
| `afk-offline.js` | 離線掛機(關瀏覽器也結算收益;24h 上限、撞死即停、存活回原狩獵圖續掛) |
| `afk-whatsnew.js` | 首頁「📢 最新公告」按鈕:彈窗顯示最近幾次更新的白話摘要(手動維護 `CHANGELOG` 陣列,一次顯示 3 筆、可「載入更多」),可附連結跳小百科對應分頁看詳情;**每次新增/調整/修 bug 都要順手加一筆,見上方日常慣例說明** |
| `afk-mobile.js` | 手機版面(底部導覽列、一行式狀態列、浮動日誌面板、修正彈窗溢出) |
| `afk-extradata.js` | **掉落查詢+小百科共用的手動補充資料**(純資料、無 DOM、在 dex/wiki 之前載入,定義全域 `AFK_EXTRA`):`itemAcquire`(物品取得方式,`short` 給 dex 物品卡＋小百科裝備頁;`chain` 是舊傳說頁專用、現未使用)、`weaponTraitEff`/`weaponTagTrait`(武器特性白話對照,dex 物品卡共用)。**只放「不能從遊戲 DB 動態算」的手動補充**;補一件裝備取得只改這支、dex+wiki 同時生效。dex/wiki 都 call 時即時讀、沒載到優雅降級 |
| `afk-dex.js` | 怪物/掉落查詢(首頁入口;搜尋怪名/地圖/掉落物;讀 DB.mobs/maps/items + **五張掉落表 MOB_DROPS／DARK_WEAPON_DROPS／DARK_CRYSTAL_DROPS／DRAGON_DROPS／WARRIOR_DROPS**(與原作 _auditMobDrops 同一組;漏讀哪張就查不到);龍騎士表的職業限定任務道具標「🐉僅X」(讀 `TRIAL_ITEM_CLASS`);**純兌換/無怪掉的成品**(龍騎士書板·鎖鏈劍·臂甲…)補 `AFK_EXTRA.itemAcquire[id].short`「取得方式」、且這類非裝備非商店物品要靠有 itemAcquire 才會收進搜尋索引;桌機手機共用;**支援獨立頁 `?view=dex`**,見下「獨立頁」;頂部「掉落率模式」下拉=一般/席琳×3/瘋狂席琳×5/經典×1/10 重算怪卡掉落率) |
| `afk-wiki.js` | 小百科(首頁入口;**多分頁 + 關鍵字搜尋**:職業專精/武器特性/戰鬥機制/地圖/能力值/職業魔法/帶寵物/傭兵/任務/套裝/收藏-裝備/收藏-道具/收藏-怪物/魔法娃娃/裝備/強化/製作/負重/席琳/血盟/傲慢之塔/遺忘之島/軍王之室;部分讀遊戲資料、部分本檔手動維護(收藏-怪物讀 CARD_*、收藏-裝備讀 EQUIP_CATEGORIES/EQUIP_CAT_*、收藏-道具讀 MISC_CATEGORIES/MISC_CAT_*,皆 data-driven 自動跟上。**收藏三分頁**另有模式切換鈕:預設不選(防爆雷),點了才依模式共用桶 `lineage_idle_carddex/equipdex/miscdex+modeSuffix` **唯讀**顯示收集進度與缺項);桌機手機共用;**支援獨立頁 `?view=wiki`**;**改前先讀下方「小百科維護準則」**)。**「地圖」分頁**讀 `MAP_CATEGORIES`+`DB.maps/DB.mobs` 動態列出(每張標 📍進入路徑=在哪個分類、等級範圍、進入條件,自動同步;遊戲移動方式=地圖選單選分類再選圖直接傳送,故路徑即分類)。**「裝備」分頁**(`renderEquip`,取代舊「傳說裝備」頁)讀 `DB.items` 依部位分組列出全部裝備+職業篩選(用遊戲 `equipOk` 真實規則);**詳情數值直接呼叫遊戲全域 `buildItemDescHTML({id,en:0,…})`**(永遠與遊戲一致、作者新增裝備/特效自動跟上、零手動維護),取得方式呼叫 `afk-dex.js` 暴露的 `window.AFK_DEX_API.acquireHTML(id)`(製作/商店/怪物掉落/`itemAcquire`)。每件詳情常駐 DOM(`display:none`)→ 完整數值與特效都進統一搜尋;詳情與整頁 HTML 都 memoize(`_equipDetail`/`_equipHtml`)→ 441 件搜尋重渲染不卡。**改裝備顯示時不要自己刻數值格式(會與遊戲分歧、得手動補),一律重用 `buildItemDescHTML`**。**「職業魔法」分頁**:每張魔法卡左側加圖示(`assets/icons/skills/<魔法名>.png`,與遊戲同路徑、缺圖 `onerror` 隱藏);選定單一職業時顯示「選擇角色」下拉(`charSelectHTML`,**唯讀**讀 8 格存檔 `_lzGet`/`_saveUnwrap` 取職業/等級/暱稱,預設不選、該職業無角色不顯示),選了角色後依其學過的魔法(`player.skills` 扣掉裝備臨時授予的 `grantedSkills`)把圖示變亮(`.is-learned`)/未學變暗(`.is-unlearned`);**絕不呼叫會寫存檔的原作函式**(見上方存檔鐵則) |
| `afk-fixes.js` | 通用修正(補原作者上游坑、桌機/手機通用、與裝置判定無關;目前:renderTabs select-guard——戰鬥中操作強化下拉不被重繪關掉) |
| `afk-crit-heavy-fx-v2.js` | 爆擊/重擊全新特效(2026-07-17 取代舊版 `afk-crit-fx.js`,已刪除該檔):`MutationObserver` 監看 `#vfx-layer`,偵測到核心 `_vfxNumber()` 插入的 `.vfx-critical`/`.vfx-heavy` 節點時,以該節點座標為錨點動態播放金橙漸層大字(爆擊「CRITICAL」/重擊「重擊」)+光束+光環+火花+光芒,並隱藏核心原本樸素文字避免疊字;z-index 沿用 `#vfx-layer` 既有的 35(不蓋過UI);完全尊重 `window.__vfxOff`/`window.__vfxNumOff` 兩個既有開關。**純疊加、不改核心檔案,理論上同步不會動到它**;但若原作者改了 `#vfx-layer` 的 z-index、`_vfxNumber()` 的 class 命名、或 `el.style.left/top` 賦值方式,這支外掛會悄悄失效(檔頭已寫明這三個檢查點) |
| `afk-sw.js` | 背景大圖快取 Service Worker 註冊(配 `sw.js`;只在 isSecureContext 註冊、file:// 自動略過;不掛 DOM) |
| `afk-toast.js` | 手機 toast 提示(只手機;包 `logSys`,把「點擊事件同步窗內」呼叫的訊息浮現成 toast;戰鬥/掛機 tick 的訊息不在點擊窗內故不洗頻;無必須 DOM 掛點) |
| `afk-syncinfo.js` | 首頁顯示「原作者:秋玥 · 原版最後同步時間」(顯示在 `#main-menu` 最下方;作者為固定文字、時間讀根目錄 `last-sync.json` 換算台灣時間;時間讀不到只藏時間段、作者照顯示) |
| `afk-pwa.js` | PWA「安裝成免網路遊玩」+ 自動/手動更新 + 背景預抓離線資源(首頁 `#main-menu`:未安裝顯示文字連結「安裝成免網路遊玩」、iOS 點了跳文字引導;**已安裝(standalone)** 顯示 checkbox「自動更新至最新版本」**預設打勾**,沒勾且有新版才顯示「更新至最新版」連結+確認視窗;安裝後背景把 `assets/` 全抓進圖桶顯示進度。`<head>` 的 manifest/圖示/theme-color 用 JS 注入(同步會洗掉寫死的)。SW 註冊沿用 afk-sw.js,本檔只管觀察更新/UI/預抓) |
| `afk-analytics.js` | 注入 Cloudflare Web Analytics beacon 統計人數/開啟次數(評估 GitHub Pages 流量會否撞 100GB/月 軟上限;免費、不用 cookie、無自訂事件,只看 pageview/訪客/來源/路徑)。**只在正式站台注入**——非 https、localhost/127.0.0.1/`*.local` 一律略過,免本機測試污染統計;token 未填(`__` 開頭)時自動略過。不掛 DOM、不列入 smoke) |
| `afk-hook.js` | **外掛式架構Hook・階段1**:純事件匯流排(`window.AFK_HOOK.on(name,fn)`/`emit(name,payload)`),無 DOM、不碰任何原作函式,只提供訂閱/發布機制給下面 `afk-hook-bind.js` 與其他外掛使用 |
| `afk-hook-bind.js` | **外掛式架構Hook・階段2**:包裝原作 `castSkill`/`killMob`/`gameLoop`/`renderMobs`/`flushTickRender`/`gainItem` 這幾個全域函式,呼叫原函式後透過 `AFK_HOOK.emit` 轉發成統一事件(`skill:cast:after`/`mob:killed`/`tick:after`/`mobs:rendered`/`render:flushed`/`item:gained` 等,詳見 `docs/交接待辦/2026-07-19_外掛式架構Hook實作交接.md`);**必須排在 afk-hook.js 之後、其他要訂閱事件的外掛之前** |
| `afk-vfx.js` | **外掛式架構Hook・階段4**:純 DOM/CSS overlay 特效層,訂閱 `afk-hook-bind.js` 轉發的 `skill:cast:after`/`mob:killed` 事件播放擊殺火花/施法脈衝特效,不碰原作程式碼,只讀事件 payload |
| `afk-cache.js` | **外掛式架構Hook・階段3**:從 `afk-pwa.js` 拆出來的素材對帳邏輯(逐張 sha 比對 `assets-manifest.json`),純職責分離,沒有加回背景分層預抓(那個是「方向B」,已評估過暫不做) |

### 🆕 2026-07-19 使用者明訂:以後新增的外掛,只要用到下面這幾類事件,優先訂閱 `AFK_HOOK`,不要自己重新 monkey-patch 原作函式

- **適用範圍**:新外掛若需要在「技能施放後、怪物被擊殺、遊戲 tick 跑完、怪物渲染完、畫面 flush 完、玩家獲得物品」這幾個時機點掛自己的邏輯,一律透過 `window.AFK_HOOK.on('skill:cast:after'|'mob:killed'|'tick:after'|'mobs:rendered'|'render:flushed'|'item:gained', fn)` 訂閱,**不要**自己再手動包一次 `castSkill`/`killMob`/`gameLoop`/`renderMobs`/`flushTickRender`/`gainItem`——`afk-hook-bind.js` 已經包好轉發成統一事件了,重複包裝同一個原作函式容易互相打架(過去 `afk-offline.js`/`afk-training.js`/`afk-crit-heavy-fx-v2.js` 就各自包過 `killMob`/`castSkill`,是這次蓋 Hook 架構的起因)。
- **新外掛引用順序**:要用到 `AFK_HOOK` 事件的外掛,`<script>` 一定要排在 `afk-hook.js`＋`afk-hook-bind.js` 之後(見上面兩支的說明),事件才訂得到。
- **不在這 6 種事件涵蓋範圍內的需求**(例如上面提過的 `player:hit`——玩家扣血邏輯散落多處無單一函式可乾淨包裝),或需要修改原作本體才能做到的,才可以評估後個案手動 hook,而且要先跟使用者確認代價(改本體有風險)。
- **既有舊外掛不強制遷移**:`afk-offline.js`/`afk-training.js` 目前仍用舊式 monkey-patch 包 `killMob`,這次評估過遷移風險(涉及離線結算/木人場高風險邏輯,改寫沒有玩家看得到的好處)刻意不做——**這條只管「以後新增的外掛」,不代表要回頭把舊外掛也改掉**,除非哪支舊外掛剛好因為其他原因要重寫,才順便一起遷移。
- **🚫 純UI類外掛(新增按鈕、改版面/CSS、查資料頁面、監聽DOM點擊/`MutationObserver`…)不需要也不應該套用 Hook 架構**(2026-07-19 使用者明訂,避免誤解成「新外掛一律要套Hook」):Hook 架構只解決「多支外掛搶著包同一個原作函式(技能/怪物/tick那6種事件)」這個問題,跟畫面/按鈕/查詢類外掛完全無關。硬套上去沒有任何好處,反而會有壞處:①**多一層不必要的依賴**——這支外掛會被迫排在 `afk-hook.js`＋`afk-hook-bind.js` 之後才能載入,`afk-hook-bind.js` 包的是原作 `castSkill`/`killMob` 等函式,原作改版導致它失效時,連帶會拖垮這支跟技能/怪物邏輯毫無關係的UI外掛;②**多繞一手卻沒解決問題**——例如單純「點按鈕開視窗」硬要繞去訂閱 `tick:after` 之類事件才觸發,只會讓程式碼更難懂,對此外掛而言 Hook 要解決的「搶同一個原作函式」問題根本沒發生過;③**違反外掛「優雅降級、獨立掛點」的設計原則**(見本檔最上方⭐核心原則)——平白增加一個原本不需要的失效點。**判準:這支新外掛需不需要在原作那6個函式執行的「前後」插入邏輯?不需要就照舊用直接插DOM/CSS/監聽點擊事件的寫法,不要為了「用新架構」而硬套。**

> **小百科 / 掉落查詢的「獨立頁」(`?view=`)**:`index.html?view=wiki`、`index.html?view=dex` 會讓對應外掛把面板鋪滿整頁(藏掉創角/遊戲畫面、改 `document.title`、隱藏關閉鈕、背景點擊不關),並在最上方加一條**頁首導覽**(`#m-standalone-nav`:🏠首頁 / 📚小百科 / 📖掉落查詢,active 標亮)可互切與回首頁。看起來像獨立網頁。首頁兩顆入口旁各有一顆 `↗` 小鈕用 `window.open` 開新分頁到這網址;原本點主鈕開 modal 的行為保留。(頁首 `buildStandaloneNav` 在兩支外掛各有一份相同實作,只有 active 那支會跑、用 id 去重。)**資料仍來自 index.html 的 `DB`/`MOB_DROPS`/… 全域**(無法真的抽成獨立檔——那些 const 夾在原作者主程式裡、且每小時自動同步會整支覆蓋),所以獨立頁就是「重用 index.html 當資料源、只顯示該面板」。全寫在外掛內、不動原作者碼,自動同步不會洗掉。

> **🔗 小百科 ↔ 掉落查詢「跨頁連結」一律走通用 helper(別自己刻 openModal/location.href)**:要打通兩邊、做「點某物 → 跳到對方並定位」的連結時,呼叫對方暴露的 mode-aware `goto`——`AFK_DEX_API.goto({q})`(前往掉落查詢並搜尋)、`AFK_WIKI_API.goto({tab,cls,q})`(前往小百科並切分頁/搜尋)。它會自動判斷:**在任一獨立頁(`?view=`)→ 導去對方 `?view=…&q=/tab=/cls=`(網址連網址,對方初始化 `applyUrlState`/讀 `?q=` 還原);在遊戲內(模態)→ 開對方模態並套用(模態連模態)**。判斷用 `inStandaloneView()`(任一 `?view=` 即獨立頁)。範例:裝備詳情「🔍 查有哪些怪會掉這件」鈕(class `m-dex-pop-search`,全域委派→`gotoDex`)。**新增跨頁連結時:① 重用/擴充對方的 `goto`(需要新參數就加進 `goto` 與對方的 `applyUrlState`/初始化讀取),不要在呼叫端自己判斷模態/網址;② 反向若還沒有對應 `goto` 就比照現有那支鏡像新增。**
> **🔗 「名字 → 跳掉落查詢搜尋」的 inline 連結用 `m-dexlink` + `data-dexq`**:要把某個物品/材料/地圖/怪名做成可點(跳掉落查詢搜尋該名)時,包成 `<span class="m-dexlink" data-dexq="名字">名字</span>` 即可——afk-dex 的全域 click 委派會接 `[data-dexq]` 走 `gotoDex`(模態/網址自動)。小百科側有共用 helper `wDexLink(name)`,dex 側的 `craftInfoHTML` 材料也用這個。**模態切換時兩個面板同 z-index、後載入的(小百科)會蓋住先載入的(掉落查詢)**——所以 `gotoDex`/`gotoWiki` 在開對方前會先呼叫對方 `AFK_*_API.close()` 關掉來源模態(並交出一層歷史、不用 `history.back` 以免誤觸對方 popstate)。**已連結化:製作頁(成品+材料)、地圖頁(地圖名+隱藏區域)、裝備詳情材料(craftInfoHTML)。** 尚未做(可續):套裝件名(縮寫不好精準連)、帶寵物/血盟怪名(在散文裡)、掉落查詢→小百科反向。

> 前五支互相低耦合;手機版的離線摘要會自動打開日誌。afk-dex 純讀資料、桌機手機都掛。
> `afk-sw.js` 註冊 `sw.js`;`sw.js` 自 PWA 改版後是**雙桶分離快取**(cache-first):
> - **程式桶 `CODE_CACHE`**(版本 `CODE_VERSION`):index.html + 全部外掛 js + 遊戲 js/css(含本機 `css/tailwind-built.css`,作者已改預編譯、不再走外部 Tailwind CDN)+ manifest + PWA 圖示 + 外部 CDN(`placehold.co`,怪圖載入失敗的備援圖,離線也要能用)。
>   `CODE_VERSION` 由 `scripts/stamp-sw-version.mjs` 依「index.html＋全部外掛 js 內容 hash」自動覆寫 → **程式一改 hash 就變 → 瀏覽器偵測到新 sw.js → 觸發 PWA 更新流程**。
>   **改任何外掛 / index.html 後,push 前要跑 `node scripts/stamp-sw-version.mjs` 重算**(自動同步流程已自動跑;手動改外掛時別忘)。
> - **圖桶 `IMG_VERSION`**(`img-v3`,**固定桶名、不再 bump、不整桶倒掉**):`assets/` 全部圖,on-demand 快取 + 可由 afk-pwa 背景全預抓。
>   失效改走**逐張對帳**:`assets-manifest.json` 每張圖帶一個 git blob sha,SW(`reconcileImages`)記下自己快取的是哪個 sha;afk-pwa 每次載入(線上逛/已安裝都跑)把最新 manifest 送進 SW:① **reconcile**——只清掉 sha 對不上的舊圖(作者換一張只重抓一張,不重載整包 30MB);② **新增圖的處理**——reconcile 只清不抓,所以「程式更新帶新圖」靠 afk-pwa 比對 **manifest 簽章**(`afk_pwa_manifest_sig`):簽章變了(新增/換圖)→ 已安裝(standalone)就**重跑預抓**把新圖抓進圖桶(SW 預抓會跳過已快取同 sha 的、只抓新/變動的)。**沒這個的話新圖離線會 404(踩過:程式更新但圖沒跟著進離線快取)**。沒記過 sha 的舊快取(本機制上線前的)→ SW 用實際 bytes 算 sha 補對帳,相符補記、不符才清。**所以 sync-upstream 不再動 sw.js 的 IMG_VERSION,只負責產出帶 sha 的 manifest。**
> - 更新接管由頁面(afk-pwa)決定:install 不自動 skipWaiting,首次安裝自動啟用、之後更新停 waiting,等頁面送 `skip-waiting` 訊息(自動更新偏好開→自動送;關→使用者按更新鈕才送)。
> - 背景預抓清單 `assets-manifest.json`(自動同步重產,格式 `[[path, git-blob-sha], ...]`,**workflow 的 `git add` 要含它**);afk-pwa 安裝後才抓那 30MB,純線上逛的人不抓。
> - afk-sw 無 DOM 掛點不列入 smoke;**afk-pwa 有 UI 掛點,已列入 smoke 的 `[AFK-pwa]` 檢查**。
> - **⚠️ SW `cache.put` 絕不能存 206(Range 部分回應)——`res.ok` 對 206 也是 true,會踩雷(踩過 2026-06-30,玩家回報 `sw.js TypeError: Failed to execute 'put'`)**:`<audio>`/`<video>` 串流(作者 .49 起新增的 `assets/bgm/*`、`assets/sfx/*` 音檔)用 `Range:` 抓 → server 回 **206 Partial Content**,而 `cache.put` 對 206 會 **reject**(`Partial response unsupported`)。這些檔在 `/assets/` 下走圖桶 `cacheFirst`,當時用 `res.ok`(206 也算 ok)又沒 `.catch` → 變成未捕捉的 rejection 噴進 console。**判準/解法:存進 Cache 的條件一律用 `res.status === 200`(不是 `res.ok`,後者含 206/204…),且 `cache.put(...).catch(()=>{})` 永遠掛 catch**(配額滿/race 也不該炸頁面)。新增任何「會被 Range 請求的媒體」或改 SW 快取邏輯時都套這條。
> `afk-fixes.js` 收「不綁手機/離線/查詢」的通用補坑碼:會主動執行(包核心函式/長駐監聽)的補坑放這,
> 不是放手機/離線檔裡(放錯檔名實不符);純 CSS 覆寫那種「過時自動失效」的不歸這、留在 `afk-mobile.js`。
> (存檔匯入/匯出原本有 `afk-savedata.js`,原作者已內建匯出入功能後移除。)
> - **⚠️ 手機 CSS 覆寫「版面容器」時,若寫死 `display:… !important`,小心 specificity 蓋過作者用來『隱藏』該容器的 `.hidden{display:none!important}` → 畫面關不掉(踩過 2026-07-06)**:作者用 `#creation-screen.hidden{display:none!important}`(specificity 1,1,0)隱藏登入/創角畫面;外掛的 `body.m-mobile #creation-screen{display:block!important}` 是 (1,1,1) 更高 → 即使加了 `.hidden` 也被外掛的 `display:block` 壓著不隱藏,載入存檔/建角進遊戲後登入畫面仍蓋在遊戲上,玩家表現=「卡在選角畫面進不去」(且 DOM 上 `.hidden` 有加、`classList.contains('hidden')` 為 true,只有 computed `display` 是 block,極易誤判)。**判準/解法:任何「會被作者用 `.hidden`(或其他隱藏 class)切換顯示」的容器,外掛覆寫它的 `display`/`visibility` 一律加 `:not(.hidden)` 條件**(`body.m-mobile #creation-screen:not(.hidden){…}`),有 `.hidden` 時外掛規則不命中、交還作者的隱藏。自我檢查:改到 `#creation-screen`/`#game-screen` 這種「整屏切換」容器的手機 CSS,有沒有無條件 `display:…!important`?有就補 `:not(.hidden)`,並實測「載入存檔→有真的進到遊戲、登入畫面消失」。
> - **⚠️ 外掛「插 DOM」的錨點別依賴作者版面的內部結構,錨不到會安靜消失、smoke 也驗不到(踩過 2026-07-06:首頁跑馬燈)**:afk-skin 的公告跑馬燈原本錨定「h1 的父層必須是 `#creation-screen` 直接子層」,作者 v3.0.40 把標題包進 `#login-art-stage>#login-title-layer` 後條件不成立 → `ensureMarquee` 安靜 return、跑馬燈消失,**頁面照常、console 無警告、smoke 照過**,直到玩家回報才發現。同場加映:作者新登入頁的按鈕皮 `#main-menu > button` 只吃「直接子層」,外掛按鈕包在 row/外框內吃不到 → 掉回舊配色(已在 afk-skin 抄同組宣告套上,作者改 css/style.css 該段要跟著換)。**判準/解法:① 外掛插入點優先錨定「穩定的容器 id」(如 `#main-menu`),不要錨「作者標題/包裝層的父子關係」;② 依賴作者 DOM 形狀的視覺注入,作者改首頁版面後要人工掃一輪首頁(跑馬燈/加掛版徽章/外掛框都在,樣式沒退化)——這些不在 smoke 範圍。**

## 📚 小百科(afk-wiki.js)維護準則

> **✅ 2026-07-16 使用者明訂:解除 2026-07-10 的暫停,恢復由這邊主動維護小百科(`afk-wiki.js`)與掉落查詢(`afk-dex.js`)的內容。**
> - **以後每次跟原作者本體同步(index.html/js/\*.js/css/\*.css),都要順便主動比對、更新小百科與掉落查詢的內容**,不用再等使用者額外指示,也不用再等 pp771007 處理——這條解除了原本「怕跟 pp771007 同時改同一支檔案互相覆蓋」的暫停理由。
> - 實務上跑 `/update-wiki` skill 即可(見下方),同步完本體後接著跑一輪,把新增/修改/刪除的物品、技能、掉落、地圖等資料反映進 `afk-wiki.js`/`afk-dex.js`。
> - **⚠️ 仍要遵守本檔最上方鐵律:任何修改都要先讓使用者知道打算怎麼改(尤其涉及遊戲機制、非純顯示的部分),不能因為「維護暫停解除」就代表不用先講就能動手**——這條只是解除「小百科/掉落查詢維護權歸屬」的暫停,不是解除「改動前要先取得同意」的規則。
> - 舊的暫停歷史脈絡(2026-07-10 起因、原因)保留在版本異動紀錄/交接紀錄中,此處不再贅述。
>
> **🛠️ 此 SOP 已包成 `/update-wiki` skill(`.claude/skills/update-wiki/`)。** 使用者說「更新小百科 / 同步小百科」時**直接跑 `/update-wiki`**——它把「git pull → 讀 checkpoint → 逐檔 diff → 檔→頁對照 → render 實測 → 更新 checkpoint」整套固化好了。本節是同一套 SOP 的詳述背景;**操作層的鐵則(尤其新踩的雷)優先寫進 skill**,本節保留為原理/細則參考。(push 前準備另有 `/prepush` skill,見下「每次 push 前的檢查清單」。)
>
> **🔴 鐵則:更新小百科資料前,第一件事一定要先 `git pull`(`git fetch origin && git pull --rebase origin main`)。**
> 每小時自動同步會在背景把作者新版推上來,本機落後就會拿舊的去比、漏掉剛進來的改版(席琳套裝改版踩過)。沒 pull 不准動手。
>
> **🎨 小百科內文分類上色(2026-07-17 新增,黑暗妖精聖地補寫時定案)**:給大段散文說明(不是表格)加顏色區分 NPC/道具/BOSS/技能/裝備/地點/異常狀態時,**共用函式 `wN/wI/wB/wS/wE/wL/wST` 已抽到 `afk-wiki.js` 檔案最上方(`esc()` 附近)**,新分頁想套用同一套風格直接呼叫即可,不要自己重新定義一套顏色。**新增/修改顏色前一定要讀那幾行定義處的註解**——裡面列了兩層已經被佔用、絕對不能再撞的慣例色:①遊戲本體 `css/style.css` 的裝備品質色(傳說`#d98a04`／遺物`#38bdf8`／稀有`#fb923c`／遠古`#c084fc`／席琳套裝`#4ade80`／祝福`#facc15`／太初`#0ea5e9`／屬性`#22d3ee`／詛咒`#ff2d2d`);②小百科自己的既有慣例(連結跳頁青藍`#7dd3fc`、標題與「實際數據」金黃`#fcd34d`/`#fbbf24`、有利/完成綠`#86efac`/`#22c55e`、不利/失敗紅`#f87171`/`#fca5a5`)。**踩過兩次撞色才定案**(第一版直接撞小百科自己的慣例色、改完第二版又撞遊戲本體的裝備品質色),別重蹈覆轍。
>
> **🔁 這套上色不是一次性補完的專案,是日常慣例(2026-07-17 使用者明訂)**:目前只套用在 5 個地城類分頁(黑暗妖精聖地/軍王之室/傲慢之塔/遺忘之島/時空裂痕),使用者要求**不必一次全部分頁補完,但往後任何一次因為別的原因(補資料/修bug/同步新內容)動到某個分頁時,順手把該分頁的散文說明也套上這套顏色**,長期讓全部分頁自然收斂到統一風格。**判準:touch 到 `afk-wiki.js` 裡某個 `render*` 函式時,自問「這頁的散文有沒有提到 NPC/道具/BOSS/技能/裝備/地點/異常狀態,而還沒套色?」有就順手補,不必為了這件事另開一輪全面改版。**純表格欄位本身不必上色,只有表格外的說明文字才套。

> **📅 小百科/掉落查詢每次更新內容都要注記「最後更新日期」(2026-07-17 使用者明訂,日常慣例,非一次性任務)**:**不用現在大面積回頭幫全部既有段落補注記**,但**往後任何一次補資料/修正/同步新內容進小百科(`afk-wiki.js`)或掉落查詢(`afk-dex.js`)時,順手在改到的那個段落/區塊加一筆「最後更新:YYYY-MM-DD」的小標註**,讓使用者之後自己看小百科能判斷「這段內容是不是最新的」。**判準:這次 touch 到哪個 render 函式/資料區塊,就在那個區塊補上日期,不需要因為這件事另開一輪去改沒動到的舊段落。**格式與確切呈現方式(頁尾一行 vs 每小節各自標)可視改動範圍彈性決定,原則是「讓使用者一眼看到這段資料是何時確認過的」。

小百科已長成「**11 分頁 + 關鍵字搜尋**」:職業專精 / 武器特性 / 職業魔法 / 任務 / 套裝 / 強化 / 負重 / 席琳 / 血盟 / 傲慢之塔 / 遺忘之島。**改它前先讀這節**——以下都是使用者反覆要求過的點,別再犯。

### 「更新小百科內容」SOP(使用者說「更新小百科」就照這跑)

> **🔴 鐵則:絕不可假設「前面幾輪做過了」就跳過 diff——每次都要真的跑 `git diff <reconciledIndexCommit> HEAD -- js/` 把整段逐項勾過(踩過 2026-06-28:我只挑了新檔『裝備收集冊』做、其餘假設 V2.32 已覆蓋就跳過,結果漏掉同期的『瘋狂席琳模式』,被使用者抓到)。** 即使 checkpoint 看起來只差一點、即使覺得自己前面做過,也要把 diff 整段看完、每個改動逐一確認小百科有沒有反映,不可憑印象判斷「應該做過了」。做完才把 checkpoint 推進、並在 note 標「此範圍已逐項對過」。
>
> **🔴 鐵則 2:diff 不只看「新增的資料定義」,更要看「既有公式／機制被改」——機制改動不會以新 `sk_`/`item` 出現,純掃新增一定漏。** 重點讀 `js/02-stats-recompute`、`js/04-combat-attack`、`js/01-drops-config`、`js/05-kill-progression` 裡**被修改的行(diff 的 `-`/`+` 成對)**:傷害公式、加成範圍、掉率倍率、模式行為、存檔/共用桶規則。踩過 2026-06-28:第一輪只 grep 新增定義,把「統一觸發型武器特效公式(法師特效不再吃法術階級加成)」「武器+11最終傷害倍率改吃到特效/技能」「瘋狂席琳(怪傷×3)」「收集冊依模式共用(同倉庫規則)」全漏了——這些都是改既有邏輯、不是新增。**自我檢查:我有沒有把 js/02、js/04 的 diff 一行行讀過,而不只是 grep 新 `sk_`/`set_`/`item`?**

> 這套 SOP 是 **diff 驅動、逐檔逐頁、機械式對照**(2026-06-28 重訂,取代舊的「grep 找新增」式)——核心是「每個有變的檔都讀完整 diff,照固定『檔→頁』對照表歸位」,不靠印象判斷「應該做過了」。

1. **同步遠端 + 取錨點**:先 `git fetch origin && git pull --rebase origin main`(自動同步會在背景推作者新版,不 pull 會拿舊的比、漏改版);讀 `wiki-checkpoint.json` 的 `reconciledIndexCommit` 當 diff 起點(別用 git log 猜)。
2. **列出所有變動的檔(不挑)**:`git diff <reconciledIndexCommit> HEAD --stat -- js/ css/`——**清單上每個有變的檔都要讀**,不可只挑「看起來有新東西」的。
3. **逐檔讀完整 diff,照「檔 → 負責頁」對照表把每個 hunk 歸位**:對每個變動檔跑 `git diff <reconciledIndexCommit> HEAD -- js/<檔>`,**新增的 `+` 行和修改的 `-`/`+` 成對都要讀**(改既有公式/機制不會以新 `sk_`/`item` 出現,只看新增一定漏),逐一確認對應頁有反映、沒有就補:

   | 改到的檔 | 看什麼 | 對應小百科頁 / dex |
   |---|---|---|
   | `00-data` | 新 技能/物品/套裝/武器/地圖 定義 | 職業魔法·裝備(自動) / 套裝 `SETS`(手動) / 掉落查詢 |
   | `01-drops` | 掉率、世界模式(席琳一般/瘋狂)機制、恩賜 | 席琳 / 掉落查詢 / 戰鬥機制 |
   | `02-stats` | 屬性/衍生值公式、buff 套用、封頂 | 能力值 / 技能效果(`statDeltaTxt`) |
   | `03`-`04` combat | 傷害公式、命中、武器特效 proc、強化倍率、異常狀態 | 戰鬥機制 / 武器特性 / 強化 |
   | `05`-kill | 條件式掉落(`if … gainItem`)、經驗/升級 | 掉落查詢 `SPECIAL_BLOCKS` |
   | `06`-status-allies | 新異常狀態 `kind`、傭兵、召喚 | 戰鬥機制(異常狀態) / 傭兵 / 帶寵物 |
   | `07`-`08` | 施法、裝備規則 | 職業魔法 / 裝備 |
   | `11`-world-map | 地圖/領域 | 地圖 |
   | `12`-npc-quests | 任務/試煉/兌換 NPC、倉庫、收集冊 `_dexKey` | 任務 / 掉落查詢來源 / 卡片·裝備圖鑑 |
   | `13`-shop-save | 商店、存檔、**遊戲模式(一般/經典/傳統)行為** | 戰鬥機制(模式對照) / 卡片·裝備圖鑑(共用桶) |
   | `14`-craft-pandora | 製作配方 | 製作 |
   | `15`-`16` | 卡片/裝備收集(掉落、積分、共用、加成) | 卡片 / 裝備圖鑑 |

   補內容分兩類:**讀遊戲資料自動同步的**(職業專精`MASTERY_DATA`、職業魔法`DB.skills`、裝備`DB.items`、掉落查詢`DB`+五張掉落表)通常不用改;**本檔手動維護的**(`WEAPON_TRAITS`/`SETS`/`ENHANCE_SECTIONS`/`LOAD_SECTIONS`/`SHERINE_SECTIONS`/`PLEDGE_SECTIONS`/`TOWER_SECTIONS`/`QUEST_BY_CLASS`/`QUEST_COMMON`/`MAGIC_FACT`)才要手動補(例:新增「惡魔套裝」→ 加進 `SETS`;職業魔法的實際數據金框→ 加進 `afk-wiki.js` 的 `MAGIC_FACT`)。**⚠ 跨系統的玩法要在相關頁互相帶到**——例:遊戲模式(一般/經典/傳統)頁要講「卡片/裝備收集冊依模式各自共用(同倉庫規則)」、席琳一般/瘋狂、傭兵同模式限制等,不要只寫在單一分頁。下面 ⭐ 是補內容時的細則:
   - **⭐ 全域掉落規則 → 補進掉落查詢的「全域特殊掉落規則」面板(`afk-dex.js` 的 `specialPanelHTML`)**:凡是「不綁特定怪、依條件觸發」的掉落(席琳結晶、施法卷軸變祝福/詛咒、賦予祝福卷軸、區域額外掉落、進化果實…這類掃描怪屬性/區域/全域機率的掉落),因為不在任一怪的 `MOB_DROPS` 裡、掉落查詢搜不到,**一律手動加一格到 `SPECIAL_BLOCKS`**(`{id,title,keys,lines}`;關鍵字放 `keys`、搜尋會自動展開)。原版每次改動全域掉落都要同步補這裡,不要只更新小百科。
     **🔎 偵測法(別再漏)**:同步作者新版時,grep 掉落結算 code(`js/05-kill-progression.js` 的 `killMob`、`js/06` 等)裡**所有「條件式 `gainItem(...)`」**——`if(...) gainItem(...)` 那種、不是從某張 `*_DROPS` 表 `forEach` 出來的,逐一對照 `SPECIAL_BLOCKS` 有沒有涵蓋,漏的補上。**踩過(2026-06-27):聖地遺物**(`mat_holy_relic`,持「死亡騎士之印記」在拉斯塔巴德區域殺任何怪 0.1%、V2.32 新增)——它不在任何掉落表、patch note 只當拉斯塔巴德武器的「材料」一筆帶過,做 V2.32 時只顧卡片/製作/地圖頭條、沒掃 killMob 的新條件式掉落,於是漏進 `SPECIAL_BLOCKS`,玩家在掉落查詢搜不到才被發現。**判準:作者更新後,任何 `if(條件) gainItem` 的腳本掉落都要在掉落查詢找得到。**
   - **⭐ 製作不一定都在 `CRAFT_RECIPES`,有「客製製作」另開資料結構,掉落查詢/製作頁要另外補讀**:掉落查詢物品卡與小百科製作頁的製作資訊只讀 `CRAFT_RECIPES`,但**有些裝備走獨立的客製製作系統、不在 `CRAFT_RECIPES`**——目前已知兩組:①惡魔王武器走 `DEMONKING_RECIPES`+`DEMONKING_MATS`(炎魔之影:消耗 +11 以上指定惡魔武器、繼承其強化/詞綴/席琳套裝);②神聖執行團裝備走 `LUMIEL_RECIPES`(琉米埃爾/海音:消耗 +7 以上「戰士團」頭盔/斗篷、繼承其強化/詞綴/席琳套裝)。症狀=「某件裝備查不到在哪製作、且常常一整批」。**遇到「明明可做卻查不到製作」→ 去 `js/*.js` grep `_RECIPES`/`buildXXXCraftHTML`/該裝備 id**,找到那組客製配方後,**同時補進** `afk-dex.js` 的 `buildCraftIndex`(物品卡)**和** `afk-wiki.js` 的 `renderCraft`(製作頁),兩邊都要(dex 若有 `+N 以上`門檻要在 `craftInfoHTML` 加對應 `plusN` 分支)。
     - **⚠ 踩過(2026-07-06):`LUMIEL_RECIPES`/神聖執行團裝備 2026-06-23 隨作者同步進來,但一直沒補進 `buildCraftIndex`/`renderCraft`→神聖執行團頭盔/斗篷在掉落查詢一路顯示「目前沒有固定取得途徑」(其實可製作)。更惡劣的是下一條 ⭐ 的 `hasFixedSource` 說明早在 2026-06-24 就把 `LUMIEL_RECIPES` 寫進「_craftIndex 含…」清單——但 code 從沒讀它,這個「文件宣稱已涵蓋、實際沒接」害後續稽核以為做過就跳過。判準:別把這份 CLAUDE.md 的「含 X 結構」清單當成「已接好」的證明;新客製結構進來時,實測一件走該結構的成品「在掉落查詢/製作頁真的查得到來源」才算數(見 `/update-wiki` step 5 的 render 實測)。**
   - **⭐ 新掉落物可能不在 `MOB_DROPS`、而在「獨立掉落表」或「純兌換」→ 掉落查詢會查不到,更新小百科時務必一起檢查補上**(龍騎士血之渴望那串踩過):掉落查詢(`afk-dex.js` `buildIndexes`)要與**原作 `_auditMobDrops`(遊戲內「統計→掉落物」用的)讀同一組掉落表**,否則他統計查得到、我們查不到(戰士印記 `WARRIOR_DROPS` 漏讀踩過)。**判斷哪幾張的權威來源就是 grep `_auditMobDrops` 看他 push 哪些表**,照抄。目前 5 張:**`MOB_DROPS`／`DARK_WEAPON_DROPS`／`DARK_CRYSTAL_DROPS`／`DRAGON_DROPS`／`WARRIOR_DROPS`**。作者再開**新表**(他會加進 `_auditMobDrops`),就把它也加進 `buildIndexes` 的 `raw` 串接(職業限定的任務道具用 `dragonDropNote`/`TRIAL_ITEM_CLASS` 標「🐉僅X」、全職可掉的不附註)。**純兌換/無怪掉的成品**(龍騎士書板·鎖鏈劍·臂甲走「普洛凱爾」兌換、50級試煉獎勵…)沒有任何怪會掉,要在 `afk-extradata.js` 的 `AFK_EXTRA.itemAcquire[id].short` 補「取得方式」;且這類「**非裝備、非商店**」物品(如 `skillbk` 書板)要被收進物品搜尋索引才搜得到名字。**收錄條件(`buildItemIndex`):裝備／在商店(`SHOP_LISTS`)／有 `itemAcquire`／或 `gachaWeight>0`(在潘朵拉抽獎池)** 任一即收。**症狀=玩家在掉落查詢搜某新物品/材料卻查不到**。判準:作者新增的東西「在 `MOB_DROPS` 裡嗎?」不在 → 去找它在哪張掉落表/哪種兌換,補進掉落查詢,別只更新小百科。
   - **⭐ 「沒有固定來源」已自動偵測(含寶箱與各種試煉/兌換結構)**:掉落查詢 `hasFixedSource(id)` 統一判斷來源,讀:`DROPPED_SET`(怪掉)＋`_craftIndex`(製作,含 `CRAFT_RECIPES`/`DEMONKING_RECIPES`/`LUMIEL_RECIPES`)＋`_shopIndex`(商店)＋`itemAcquire`(手動)＋`boxTiersOf`(歐西里斯寶箱 `OSIRIS_BOX_*`)＋**`trialSourceOf`(各職業試煉/兌換設定結構:`TRIAL_50_CFG`/`DARK_TRIAL_CFG`/`SHENIEN_EX`/`WARRIOR_EX`/`PROCEL_EX`/`YURIA_REWARDS`)**。這些都**讀遊戲全域、作者改設定自動跟上,不必逐物品手動補**(瑪那水晶球等 50 級試煉成品、影子裝、幻術士裝、戰士團裝、臂甲都靠 `trialSourceOf` 現身)。**潘朵拉限定物(`gachaWeight>0` 且查無固定來源)→ 自動收進搜尋 + 詳情卡標中性句「目前沒有固定取得途徑」**(依規則不提潘朵拉)。**作者新增「會發裝備的新結構」時**(grep `rewards:`/`reward:`/`_EX`/`_CFG`),把它加進 `buildTrialBy()` 即可一次涵蓋整批。真正剩的死角只有「`gachaWeight=0`、不在任何結構、又沒怪掉」的廢棄/起始裝(留空合理)。
   - **⭐ 取得方式只標「可控」的,潘朵拉黑市(轉蛋)是隨機池、不列(使用者決定)**:掉落查詢物品卡的「取得方式」列(`itemDetailHTML`)**只顯示可控取得**——靈魂之球喚回(巴列斯/巴風特魔杖,走 `SOULORB_RESTORE`)、龍騎士普洛凱爾兌換成品(走 `itemAcquire`)等;**潘朵拉的黑市抽獎雖然幾乎什麼都抽得到,但太不可控、列了是雜訊,刻意不顯示**(別把『潘朵拉抽獎』當來源文字寫出來;但用 `gachaWeight>0` 判斷「在抽獎池→可搜尋＋詳情卡標中性句『目前沒有固定取得途徑』」是另一回事、是 OK 的,見上節 `hasFixedSource`)。**即使潘朵拉是某物的「唯一」來源也一樣不列**——改寫「目前沒有固定取得途徑」這類中性句,不要寫「只能潘朵拉抽」(使用者明確要求:潘朵拉太難取得、不算取得方式)。小百科「技能書怎麼拿」之類的說明同此原則:只寫試煉/製作/商店/掉落等可控來源,潘朵拉一律不提。製作/掉落另由 `craftInfoHTML` 與搜尋鈕呈現。**(舊「傳說裝備」頁 `renderLegend`/`legendAcquire`/`LEGEND_SOULORB` 已隨「裝備」分頁上線移除;裝備頁的取得方式統一走 `AFK_DEX_API.acquireHTML`,喚回類成品靠 `itemAcquire[id].short` 呈現。`itemAcquire` 的 `chain` 欄是舊傳說頁專用、目前無人讀,新增資料只需填 `short`。)** **遇到新的喚回/兌換機制**(grep `soulorb`/`_restore`/`eff:`)→ 結果裝備補進 `SOULORB_RESTORE`(dex 物品卡)與 `itemAcquire[id].short`(裝備頁/掉落查詢共用)。
4. **每動到一頁就 Playwright 無頭 render 該頁實測**:確認顯示正確(數據對)、無漏翻英文、無 raw key(`sk_`/地圖 id 之類)、無 JS error。改了哪頁測哪頁,別只改不驗。
5. 補完照「每次 push 前檢查清單」bump 對應外掛 `?v=`(動到 `afk-dex.js` 也要 bump 它)、無頭瀏覽器測過再推。**並把 `wiki-checkpoint.json` 更新成現在的 HEAD**:`reconciledIndexCommit`＝`git rev-parse HEAD`、`reconciledIndexBlob`＝`git rev-parse HEAD:index.html`、`reconciledAt`＝台灣時間(UTC+8),note 寫「逐檔對過、動了哪些頁」,跟這次小百科改動一起 commit——錨點前進了,下次才不會重複比同一段。

### 內容鐵則(踩過、別再犯)

- **⭐ 表格優先 + 有數據就用數據(使用者明訂的鐵則)**:任何分頁,**能用表格呈現就用表格**(門檻/數值/對照/分段),別用散文堆。**程式裡查得到的數字,一律用程式的實際數據/公式講清楚**——優先「動態讀 DB 或呼叫遊戲函式即時產生表格」(像「能力值」頁逐級表、「負重」頁的懲罰階表/上限公式試算表/腰帶 weightCap 直接讀 DB),這樣作者改數值會自動跟上、不用手抄也不會過時。範例:`renderLoad` 把懲罰階、上限公式、額外上限來源全做成表,腰帶款式 `for (id in DB.items) slot==='belt' && weightCap` 動態列。**散文只留「機制怎麼運作、怎麼解」這種表格表達不了的**。
- **⭐ 數據化、簡潔,不要廢話**:小百科是「查數據」的工具,不是讀物。能用表格/數字/公式講清楚的就別寫一大段散文。**接任何功能進小百科前,先去 `index.html` 巡過「真正算它的那段 code」(函式/查表/公式/旗標),用實際邏輯寫**,不要照遊戲說明或註解抄(那些常過時/模糊)。範例風格:能力值分頁的「逐級數值表」「封頂對照表」就是直接呼叫遊戲函式產生數字;說明文字壓到一兩句、把細節交給表格。寫完自我檢查:這段有沒有「換句話再講一次」「跨項比較」「meta 旁白」這種對查資料沒用的贅字?有就刪。
- **⭐ 表格已表達的,不要在表格下方再用散文重述一次(使用者明訂・2026-06-27)**:做了對照表/數值表後,**表格本身已經講清楚的東西,不准再在下面用 `m-wiki-desc` 散文「總結/換句話講一次/加感想」**(例:「經典把上面這些全停用,戰鬥更樸素」「倉庫與傭兵各自獨立」——表格已經一格一格列出來了,這種就是廢話,刪)。表格下方**只**保留「表格欄位裝不下的真正補充/例外」(例:「掉寶率 ×1/10 不影響職業試煉道具」這種表格沒涵蓋的例外才留)。自我檢查:這行註解講的東西,表格裡是不是已經有了?有 → 刪。
- **白話、零術語**:不要骰子寫法(`1D4`→「1~4」)、不要「骰19/20」(→寫機率「約 5%/10%」);ER/MR 一律白話「迴避/魔防」。**防禦(AC)比照遊戲內裝備欄用「負值」呈現**——本作 AC 越低越強,遊戲 `buildItemDescHTML` 顯示成「防禦(AC): -d.ac」(正常防具是負的),故小百科/掉落查詢一律寫「防禦(AC) -n」(`AC-3`→「防禦(AC) -3」,`friendly()` 只把「AC」標成「防禦(AC)」、保留原本正負號;不要再反相成正值)。負 ac 的下行向裝(如曼波帽子)顯示「+n」即可。
- **🔤 渲染給玩家的內容絕不露出英文——一律翻成中文**(2026-06-27 使用者明訂):小百科/掉落查詢畫面只要冒出英文＝漏翻,回去補「對應表」(改對應表→以後同類自動跟上,別逐筆硬寫死)。兩種狀況:
  - **顯示用的英文詞**(狀態名如 `confuse`/`panic`、數值名如 `magicDmg`、縮寫 `AC`/`ER`/`MR`)→ **先找原作者有沒有現成中文對應表**(如 `js/06-status-allies.js` 的狀態中文表、`ELE` 元素表),有就比照;**沒有就補進外掛自己的對應表**(`afk-wiki.js` 的 `STATUS_LABEL`/`STAT_LABEL`,或 `AFK_EXTRA`)。例:`confuse`→STATUS_LABEL「混亂」、`magicDmg`→STAT_LABEL「魔法傷害」、`AC`→「防禦(AC)」。⚠ AC 正負要分清楚:**裝備/套裝**的 `d.ac` 已是顯示值(負=好)照原號走 `friendly()`;**技能 buff** 的 `d.ac` 是「要降的量、以 `d.ac -= 值` 套用」(正值=降AC=變強),故 `statDeltaTxt` 顯示「實際 AC 變化＝−v」、別照原號(否則鋼鐵防護/狂暴術正負全反,踩過)。
  - **英文 key**(地圖 id 如 `elder_room`、物品/技能 id)→ **去原作者 code 找它的中文**(新地圖查 `MAP_REGIONS`/`MAP_CATEGORIES` 的 `t`、`DB.towns.n`、`HIDDEN_AREA_NAMES`;一律集中走 `AFK_EXTRA.mapName`,別各自寫)。
  - **判準**:渲染結果出現連續英文字母(HP/MP/BOSS/Lv 這種通用縮寫除外)就是漏翻 → 回去找對應中文、補對應表。
  - **⭐ 地圖名漏翻已有 smoke 自動防護(2026-06-29 加)**:`scripts/smoke-hooks.mjs` 會把 `DB.maps` 全部 key 過一次 `AFK_EXTRA.mapName`,只要有 key 解析後 `name===id`(原樣回傳)或仍含英文字母就 `exit 1`。作者新增「不在 `MAP_CATEGORIES`/`MAP_REGIONS`/`DB.towns`/`HIDDEN_AREA_NAMES` 的地圖結構」(如當年 pride/oblivion/rift)→ 每小時自動同步的 smoke 會擋下、改開 issue 通知,**這時去 `afk-extradata.js` 的 `mapName` 補上該 id→中文(優先讀作者新表,沒有才硬寫)**,玩家就不會在掉落查詢看到英文。這是「掉落查詢地圖漏英文」的根治法,不必逐次靠人眼抓。
- **不要改版說明的語氣**:小百科是寫「現況」給玩家看,不是 changelog。別用「現在/原本是/已改成/不再/不會再…了」這種帶時間感、像更新公告的句子——直接陳述現在的事實(例:寫「屬性/遠古無法靠打怪取得,只能用碧恩的卷軸」,**不要**寫「屬性/遠古『現在』不會隨機掉了」)。
- **要精確數據、不要模糊**:不准「短時間/有機率/提升/依等級」這種沒數字的;去 code 查實際數值/公式補。真的是看等級差/隨智力浮動沒固定值的,**照公式寫**、別硬編一個百分比。
- **🔑 數據一律以「程式碼的實際邏輯」為準,絕不直接抄遊戲內的說明文字或註解**:遊戲裡的物品/技能說明(`d:`/`item.d`/技能 `msg`)與 code 註解,是寫給玩家看的白話、常常**模糊、過時、或與實際公式不符**(作者改了數值卻沒改說明)。寫小百科數據時**一定要追到真正算它的那段 code**(函式/查表/公式/常數),用那裡的實際值,不要照說明或註解填。例:擊殺回 MP 不是看物品說明,而是去查 `getWisMpOnKill(wis)` 的分段表;掉率去查 `MOB_DROPS`/掉落判定式而非道具描述。**自我檢查:我這個數字是「從負責計算的 code」拿的,還是「從一段給玩家看的文字/註解」抄的?** 後者一律不可信,回去找 code。
- **不要塞沒用的 () 補充**:括號只放「對玩家有用的事實/數據」(等級、機率、需求屬性、地點…)。<b>跨職業比較(「與燃燒鬥志同效」)、meta 註解(「作者新增會自動出現」「刻意設計」)、把詞換句話再講一次 這種旁註一律不要</b>——它們不是玩家要的資訊,只是雜訊。能用一句乾淨的話講完就別硬加括號。
- **掉率/機率:依「怪等/類型」分段的要逐段列、且換算倍率別抄錯(席琳結晶踩過)**:code 裡常是 `if 怪等>=21 ... >=31 ... >=41` 或「BOSS/三大龍/夢幻之島各一個值」這種**分段**機率,小百科要**把每一段都列出來**,不要用「約萬分之一級距」這種一句話帶過(既模糊、又往往錯)。換算成百分比時**小心位數**:code 的小數 ×100 才是 %——`0.00001`=**0.001%**(十萬分之一),不是「萬分之一」;抄錯一位就差 10 倍。寫完自己反算一次:`%數 ÷ 100` 要等於 code 裡那個小數。另注意「不吃掉落倍率」這種旁註(席琳結晶機率固定、不受席琳世界 ×3 影響)也要寫進去。
- **時間單位**:技能 `dur`(buff/狀態)是**秒**;HoT 的 `hot.interval` 是 **tick(÷10 才是秒)**;顯示用「X 分 Y 秒 / X 小時 Y 分」(`fmtDur`),**不要跑出「5.3 分鐘」這種小數**。
- **能讀遊戲資料就讀,少硬寫**:會隨作者改的(套裝效果/技能/掉落/地圖名)優先動態讀 DB/遊戲常數,讀不到才用本檔備援(如 `SHERINE_SET_FALLBACK`)。**很多 `gainItem(...false,false)` 旁的舊註解已過時**——動手前去 code 確認,別照舊註解(例:黑市直接購買「即所見、不附詞綴」**不是詞綴來源**;屬性/遠古現在只能靠碧恩賦予祝福卷軸,不會隨機掉)。
- **分類對齊原版、不要同一個東西每職業重複跳**:法師魔法(1~10 階)是共用本職法術→**只列一次**,標「可學:法師x/妖精y/騎士z/黑暗妖精w」;妖精/黑暗妖精/騎士的專屬魔法分開列。判類:有 `reqM`=法師魔法;否則 `reqE`/`reqD`/`reqK` 歸專屬。黑暗妖精固定可學 1/2 階(Lv12/24)、妖精高階法師魔法標「需魔導精通」。
- **⭐ 新增系統若牽涉「好幾個獨立子機制」,不能只補到其中一個、要把每個相關檔案都讀完(踩過 2026-07-18:潘朵拉黑市)**:同步 v3.5.4→v3.5.36 時,作者新增了整支 1100+ 行的新檔 `js/24-pandora-relic-market.js`(遺物布告欄＋玩家收購NPC),小百科當下只補了「遺物布告欄」這半段,漏掉了「金幣黑市新增收購單機制」(玩家自訂出價,寫在**另一支既有檔案** `js/14-craft-pandora.js` 裡、同一次同步一起改的)、商品格數 20→24 件、玩家NPC的閉嘴/傳送互動細節、以及「全遊戲共用(不分模式)」這個容易誤解的範圍。**根因**:當時判斷「潘朵拉黑市」只是製作分頁裡的一個小節,沒有意識到這次是一整套新系統、牽涉不只一支新檔案,於是只照 Cowork 差異分析文件裡點到的關鍵字去補,沒有主動去讀「這個功能相關的所有檔案」有沒有還有沒提到的機制。**判準/怎麼避免**:遇到作者新增的**大型新檔案**(尤其命名像獨立系統的,如 `js/24-*`)或**牽涉多檔案的新玩法**,不能只讀差異分析文件的摘要就當作補完了——要 `grep` 該系統相關的所有檔案(例如同時 grep `js/14` 跟 `js/24` 兩邊有沒有互相呼叫/提到同一組資料),把該檔案完整讀過一輪,列出「這個系統有哪幾個子機制」的清單,再逐一確認每個子機制都寫進小百科,不要只補「差異分析文件點名的那一半」。
- **⭐ 新增內容一定要包在 `.m-wiki-card`/`.m-wiki-kv`/`.m-wiki-spell` 容器裡,否則統一搜尋抓不到(踩過 2026-07-18:潘朵拉黑市搜「潘朵拉」搜不到)**:小百科的統一搜尋(`searchHits`/`renderSearch`)只掃描 `.m-wiki-card,.m-wiki-spell,.m-wiki-kv` 這三種 CSS class 的節點內文,`wDesc()` 產生的 `.m-wiki-desc` 若沒有外層包一個 `wCard()`,內容雖然會顯示在分頁裡、但完全不會被搜尋收錄。當時潘朵拉黑市那段是直接 `html += wDesc(...)` 疊出來、沒有用 `wCard()` 包住,導致玩家在小百科搜「潘朵拉」、「龍之鑽石」都搜不到那一段,即使內容本身是對的。**判準**:寫任何一段新內容前,檢查最外層是不是 `wCard(標題, wDesc(...)+wDesc(...))` 這種結構(或至少是 `.m-wiki-kv`);寫完後**一定要實際打開小百科搜這段內容裡的關鍵字**確認搜得到,不能只用肉眼看分頁內容顯示正常就收工——「看得到」不等於「搜得到」,這兩件事要分開驗證。
- **⭐ 任何「多久才觸發一次/機率多少」的隨機性機制,一定要把判定週期與機率寫進小百科(2026-07-18 使用者明訂)**:小百科寫某個隨機出現的NPC/事件/掉落時,不能只描述「出現後會怎樣」(持續多久、能怎麼互動),還要把「多久才會出現一次」這個判定機制本身講清楚——例如潘朵拉黑市的玩家收購NPC,原本的寫法只講了「出現後3分鐘廣播一次、2小時消失」,完全沒提「每10分鐘判定一次、約5%機率成功」,導致玩家等了5分鐘看不到人以為東西壞了才回報。**判準:寫任何隨機觸發的機制時自問「玩家看不到/等不到的時候,要怎麼知道這是正常還是壞掉?」**——沒有判定週期+機率的資訊,玩家沒辦法判斷,一定要去 code 找到判定的時間間隔(如 `CHECK_MS`)與機率常數(如 `WANDERER_CHANCE`)寫進去,不要只寫「隨機出現」這種無法讓玩家自行判斷的模糊說法。

### 介面/排版鐵則

- **搜尋=「統一結果」**:打字就收起分頁列與職業列,跨「全部分頁+全部職業」一次列出命中區塊、依來源分組、關鍵字黃色高亮;**不要做成「切職業整頁消失」**(踩過)。職業相關分頁(專精/任務)搜尋時逐職業各搜;魔法是分類制故單次搜。
- **分頁列單排可左右捲動**(`flex-nowrap + overflow-x:auto`),不要換行兩排。
- **職業魔法分頁有「職業篩選」**(全部/法師/妖精/騎士/黑暗妖精):「全部」=分類總覽(法師魔法按階+各專屬);選某職業=只看「該職業學得到的魔法」(含可學的法師魔法,標該職業可學等級)。
- **手機**:不要為了標示加會被內容撐高的元素——席琳世界用「狀態列染紅」標示;怪物卡固定高 + 名稱兩行截斷(別隨怪/名稱長短抖動)。

## 🚨 每次 push 前的檢查清單

> **🛠️ 這份清單已包成 `/prepush` skill(`.claude/skills/prepush/`):自動偵測改動的外掛→bump `?v=`→`stamp-sw-version`→smoke→掃衝突標記。準備 push 時跑 `/prepush` 即可。另有 `.claude/` 兩個 hook 兜底:`git push` 前自動擋衝突標記/漏引用/sw 版本過時(prepush-guard)、改 `afk-*.js` 後提醒 bump(bump-reminder)。** 下面是清單本體(skill/hook 即據此):

1. **確認所有外掛 JS 都已在 `index.html` 補上 `<script>` 引用**(在 `</body>` 前)。目前應有:
   ```html
   <script src="afk-offline.js?v=YYYYMMDDx"></script>
   <script src="afk-mobile.js?v=YYYYMMDDx"></script>
   <script src="afk-extradata.js?v=YYYYMMDDx"></script>
   <script src="afk-dex.js?v=YYYYMMDDx"></script>
   <script src="afk-wiki.js?v=YYYYMMDDx"></script>
   <script src="afk-fixes.js?v=YYYYMMDDx"></script>
   <script src="afk-sw.js?v=YYYYMMDDx"></script>
   <script src="afk-toast.js?v=YYYYMMDDx"></script>
   <script src="afk-syncinfo.js?v=YYYYMMDDx"></script>
   <script src="afk-pwa.js?v=YYYYMMDDx"></script>
   ```
   - 新增外掛時,**務必同時**加上對應的 `<script>` 行(並同步加進 `scripts/sync-upstream.mjs` 的 `PLUGINS`;**有 DOM 掛點的**再加進 `scripts/smoke-hooks.mjs` 的 `need`——像 `afk-sw.js` 這種純註冊、無 DOM 掛點的就不必;**並補一行進 `Lineage/加掛版/docs/風險與外掛/外掛依賴矩陣.csv`**,寫清楚這支外掛的功能/依賴/存檔風險/更新風險),否則功能不會生效、或下次自動同步會被原版覆蓋掉。**依賴矩陣這項先前一直沒被列進這份清單,導致每次新增外掛都容易漏補(2026-07-17 補進來)——之後改動任何外掛(不只新增,行為/依賴有實質變化時)都要順手核對這份 csv 是否還準確。**
   - 原作者更新覆蓋 `index.html` 後,**第一件事就是把上面這幾行補回去**。
   - **⚠️ 改「外掛 init 觸發條件」(尤其只在特定裝置/尺寸才執行的)→ 想清楚 smoke 那輪驗不驗得到它。踩過(2026-07-01):`afk-mobile` 改成「桌機零接觸」(commit 4558a7c,只有手機尺寸/裝置才 `init` 並印 `[AFK-mobile] hooks OK`)後,smoke 是用桌機視窗跑的 → afk-mobile 永遠印不出 hooks OK。而 smoke 只在自動同步 workflow 裡跑、手動 commit 不會觸發,所以這個假性失效當下沒被抓到,直到隔天作者出新版、自動同步跑 smoke 才爆成「⚠️ 掛點失效」issue 擋下同步(玩家端表現=「沒更新到作者最新版」)。修法:smoke 對「只在手機才 init 的外掛」改用 `devices['iPhone 13']` 開第二輪 context 專驗(`needMobileOnly=['[AFK-mobile]']`),桌機那輪不列入。判準:任何「掛點只在某條件下才建立」的外掛,smoke 必須在該條件下(手機模擬/特定狀態)驗它,否則就是假性失效在等下次同步爆。**

>  **📌 smoke 只在 sync-upstream workflow 內跑,手動 push 不觸發**——所以「動到外掛掛點/init 條件」的手動 commit,push 前最好本機先 `node scripts/smoke-hooks.mjs` 跑一次(exit 0 才安心),別等自動同步時才發現假性失效擋住作者更新。
2. **改了任何外掛 JS → 一定要 bump `?v=` 版本號**(GitHub Pages / 瀏覽器會死命快取 JS;
   只改 `index.html?v=` 沒用,因為 script src 的檔名沒變、瀏覽器照樣給舊的快取 JS)。版本號規則:日期 + 當天流水字母(如 `20260613a` → `20260613b`)。
   **沒 bump 的話使用者載到的還是舊外掛,debug 會鬼打牆**(踩過一整輪才發現)。
   - **改完外掛 / index.html 後,push 前再跑一次 `node scripts/stamp-sw-version.mjs`**(從 repo 根目錄)——重算 `sw.js` 的 `CODE_VERSION`,PWA 才偵測得到更新。漏跑的話「已安裝的 app」不會跳更新。
3. 確認沒有把 `.scratch/`、`node_modules/` 等暫存物混進 commit(見下)。
4. 載入遊戲後開 console,確認看到各外掛的 `[AFK*] hooks OK`,沒有缺掛點的警告。

## 暫存檔 / 測試

- **✅(2026-07-10 稍晚已解決,原「瀏覽器預覽工具綁定錯資料夾」問題)真正根因是 Cowork 每個 session 各自記錄 `userSelectedFolders`、預設值來自 `spaces.json` 的候選清單,不是單純「App 層級绑死、工具改不了」**:先前(見上一版本這條)誤以為改 repo 內 `launch.json` 無效就代表這是不可碰的 App 級綁定,後來查到 `~/Library/Application Support/Claude/local-agent-mode-sessions/.../<sessionId>.json` 裡有 `userSelectedFolders` 欄位、其候選來源是同層 `spaces.json` 的 Space `folders` 清單——當時清單同時列了舊的 `Desktop/Cowork/Lineage` 與外層(非 repo 本身)的 `codex/Lineage`,才選出過舊/錯誤的資料夾。**解法**:①把 `codex/Lineage/.claude/launch.json` 的 `runtimeArgs` 改回指向現行 repo 路徑;②完全退出 Cowork App 後編輯 `spaces.json`,把 Space 的 `folders` 改成只有一筆、直接指向 `codex/Lineage/加掛版/idle-lineage-class`(repo 本身,不是外層);③重開 App、開新 session,確認「New session」畫面資料夾標籤顯示 `idle-lineage-class`、`pwd`/`git status` 正確。**判準:下次再遇到「新 session/預覽工具連錯資料夾」,先查該 session json 的 `userSelectedFolders` 從哪來、去 `spaces.json` 改 Space 綁定,不要又假設是「App 層級改不了」而放棄。** 瀏覽器預覽工具(`preview_*`)理論上會跟著新 session 的 cwd 走,但本次修復後**尚未實際重跑一次 `preview_start` 驗證**——下次用之前仍建議先 `preview_logs` 確認 serving 路徑正確再信任結果。
- 一次性測試腳本、Playwright、截圖等一律放 `.scratch/`,且已被 `.gitignore` 擋掉,不進 git。
- **⚠️ 建立「排除 `assets`/`public` 圖片省空間」的獨立測試資料夾時,登入畫面的逐幀背景動畫會因為抓不到圖而變成瘋狂空轉的迴圈,佔用 CPU 造成整頁卡頓,容易被誤判成新程式碼的 bug(踩過 2026-07-19:外掛式架構Hook測試資料夾,使用者回報「小百科卡」,一開始以為是新架構的問題)**:首頁背景有一組 273~300 張的逐幀動畫(`public/assets/login/*.png`),抓不到圖時沒有節流、幾乎立刻重試下一幀,變成背景狂發 404 請求的迴圈,連帶讓疊在上面的任何彈窗(小百科等)都跟著卡。**判準/解法**:測試資料夾裡如果使用者回報「操作卡頓」而這次改動明明沒有動到效能相關邏輯,先用 `read_network_requests` 看有沒有同一批圖片路徑被瘋狂重複請求(時間戳幾乎相連、間隔 <1ms),有的話就是「排除圖片造成的測試環境假象」,不是新程式碼的問題;要嘛補回那一小組登入動畫圖(约29張,不大),要嘛直接跟使用者說明這是測試環境限制、同步回有完整圖片的正式資料夾測就不會發生。
- 驗證手段:用 Playwright(`playwright-core` 指向本機快取 Chromium)無頭跑 `index.html`,截圖或讀 DOM 驗證。
- **Playwright 一律 headless(無頭),不可彈出可見瀏覽器視窗干擾使用者螢幕。** 不管用 `playwright-core` 腳本還是 MCP 瀏覽器工具都一樣:腳本用 `chromium.launch({ headless: true })`;MCP 瀏覽器若預設會開可見視窗,就改回腳本式無頭驗證,不要在使用者畫面上彈窗。截圖一律走無頭截圖。
- **🚨 會「動到玩家存檔(寫入/覆蓋 localStorage)」的功能,上線前一定要測「真實角色 → 操作 → 確認存檔沒被改壞」這條路,不能只用合成資料測機制。**(踩過:存檔轉移用「塞假存檔到第 2 格、只驗第 2 格還在」測過就上線,結果漏掉「`saveGame()` 蓋掉的是 currentSlot=第 1 格」,把玩家角色弄成 Lv.1 null。)鐵則:
  - **測試要涵蓋真實觸發狀態**——存檔功能多半從**主選單(未載入角色)**觸發,就要在「未載入角色」狀態測,別只在「已載入」狀態測。
  - **斷言要看得到災情**:操作前後**比對「使用者實際會用的那一格 / 全部相關鍵」的內容有沒有被非預期改寫**,而不是只檢查自己有興趣的那格。
  - 動到存檔前,先想清楚「這個操作會不會在某狀態下覆蓋既有存檔、有沒有備份能救」;沒備份的覆蓋風險 = 上線前必須用真角色實測到放心為止。
- **📱 使用者要在真實手機上測試(尤其手機觸控/版面類改動)時,啟動本機測試站台後要主動告知「區網 IP 網址」,讓使用者手機連過去(2026-07-08 使用者明訂,往後每次都要這樣做,不用等使用者提醒)**:`.scratch/devserver.mjs` 用 `server.listen(PORT, ...)`(沒指定 host),Node 預設就是監聽所有網路介面(`*:8000`),本來就不是只綁 `localhost`——所以不需要改程式,只要**額外查詢這台 Mac 的區網 IP 並附上完整網址**即可:
  ```bash
  ipconfig getifaddr en0   # 或 en1,依實際使用的網卡而定;抓不到就用 ifconfig | grep "inet " | grep -v 127.0.0.1
  ```
  回報格式範例:「手機要跟這台 Mac 連同一個 WiFi,瀏覽器打開 `http://<查到的IP>:8000/` 就能測試。」**每次 `preview_start` 啟動這支 devserver 後都要主動附上這個網址,不要只顧自己用 `localhost` 驗證就結束**——Claude Preview 工具本身用 `localhost` 連線沒問題,但那對使用者的手機沒用,手機必須用區網 IP。若使用者反映連不到,先確認雙方在同一 WiFi、Mac 防火牆有沒有擋掉該連接埠(`System Settings > Network > Firewall`),不要假設一定是程式問題。
- **⚠️ 本機用 Claude Preview / 瀏覽器工具反覆改測「同一支外掛」時,若懷疑「明明改了程式碼、行為卻沒變」,先懷疑 Service Worker 快取,別急著以為改壞了(踩過 2026-07-08)**:`afk-sw.js` 註冊的 SW 對 `.js`/`.css` 走 cache-first(`CODE_CACHE`),同一個 URL(本機測試站台的 `afk-mobile.js` 沒有 `?v=` 版本號、或版本號在同一輪迭代中沒變)第二次載入會直接吃快取,即使磁碟上的檔案內容已經改了、devserver 也確實會回傳新內容,瀏覽器仍可能繼續用舊的快取版本執行,導致本機驗證測出「跟程式碼對不上」的假象(當時是背包長按 swallow 修法測出「明明改了 target 判斷,結果任何點擊都還是被吞掉」,查了老半天才發現是快取)。**判準/解法**:本機反覆迭代同一支外掛時,每次改完要驗證前,先 `(await navigator.serviceWorker.getRegistrations()).forEach(r=>r.unregister())` + `(await caches.keys())` 全部 `caches.delete()` 再 `location.reload()`,拿到保證最新的版本再下結論。**正式環境不受影響**(靠 `?v=` bump 讓請求 URL 變,SW 天然 cache miss 抓新版),這條只在本機同一 URL 反覆測試時才會踩到。

- **⚠️ 用 `window.__afk.forceCatchup()` 手動測離線結算時,兩個常見自我誤導的坑(踩過 2026-07-15,離線結算階段②做法B測試時)**:
  1. **`loadGame()` 之後馬上呼叫 `forceCatchup()`,常常被「自動心跳補跑」搶走 `catchingUp` 鎖,自己的呼叫整個被 `if(catchingUp)return` 靜默吃掉,busy 全程沒變 true、收益卻是 0**——每次 `loadGame()`(甚至頁面重載入)只要離上次心跳(`HEARTBEAT_MS=5000`)有落差,就會自動觸發一段小規模補跑,若手動呼叫剛好卡在這段還沒結束時發生,兩者搶同一個 `catchingUp` 旗標,先到的贏、晚到的整段 no-op。**判準/解法:呼叫自己的 `forceCatchup()` 前,先 poll `window.__afk.busy` 穩定為 `false`(等個幾百毫秒~1秒確認不是自動心跳補跑正在跑),再發起測試呼叫;呼叫後也要確認 `window.__afk.busy` 有變 `true`,沒有變 true 就代表被擋掉,不是真的跑了。**
  2. **在同一頁面(沒有 `navigate` 重新整理)反覆對同一個全域函式(如 `spawnMob`)做 monkey-patch 測試,若每次都寫 `var orig = window.spawnMob; window.spawnMob = function(){ orig(); ... }` 而沒重新整理頁面,會疊加包裝、造成無限遞迴(`RangeError: Maximum call stack size exceeded`)**——因為 `window.spawnMob` 早就是上一輪已經包過的版本,`orig` 抓到的其實是「上一輪的包裝函式」,再包一層呼叫自己等於自我遞迴。這個例外會被 `runCatchup` 自己的 try/catch 吞掉(印 `[AFK] 離線補跑發生例外,已中止`),busy 照樣正常變 false,結果看起來像「跑完了但收益是0」,很容易誤判成程式邏輯錯誤而不是測試腳本本身的問題。**判準/解法:凡是要 monkey-patch 全域函式做測試,每次測試前一定要先 `navigate` 重新整理頁面拿到乾淨的原始函式,不要在同一頁面裡重複執行同一段包裝程式碼;懷疑「明明結果應該很大卻是0」時,先查 console 有沒有 `RangeError: Maximum call stack size exceeded`,不是先懷疑邏輯寫錯。**

### 量測效能時:每跑一輪前「重新整理頁面」,不要用 `loadGame()` 在原地重置(會漏記憶體污染數字)

實測過:在「同一個分頁、不重整」的情況下重複呼叫 `loadGame()`(載入存檔)來重置角色,第二次起記憶體會從 ~17MB 暴漲到 ~97MB、每個 tick 從 ~0.1ms 變 ~0.9ms(慢 9 倍)。原因是 `loadGame()` 連帶啟動的計時器/事件監聽/DOM 每次都「再掛一份」、舊的沒拆掉,連續載入就一直疊。**正解:每次量測前重新導航到網址(整個 JS 環境倒掉重來),不要在原地 `loadGame()` 重置**,否則 A/B 比較的後半段數字全被污染(我原本「四個切片值連續各跑一次」的做法就是被這個害到、數字不準)。
- 對一般玩家正常不影響(開遊戲只載入一次)。**待查疑點**:遊戲內「不重整就切存檔位/匯入存檔/回主選單再進」若底層直接再 `loadGame()` 而沒先清乾淨,連續切幾次可能變鈍——尚未驗證,先當備忘。

## 🗺️ 離線掛機原則:等同「在線上掛機照跑」+ 非選單地圖(攀登/遺忘之島)的續掛寫法

`afk-offline.js` 的核心原則:**離線掛機 = 把「在線上會發生的掛機」照跑一遍**,行為盡量與在線一致(同圖續掛、撞死即停結算到死前、存活回原地)。新增/修改離線行為前先對齊這條,不要自己發明特例。

**特別坑:有些「狩獵地點」不是地圖選單裡的地圖**(攀登 `pride_fN`、遺忘之島 `oblivion_travel`/`oblivion_island`)——它們**不在 `DB.maps`/`MAP_CATEGORIES`**,而且原作**不存檔**這類「旅程/攀登狀態」(`state.prideClimb…`/`state.oblivion`),重載一律回村。對這種地圖做離線續掛,規則:

- **不能用 `gotoMap()`/`changeMap()`(選單路徑)**把人帶回去——選單沒有這個 option,`setMapSelectors`/`sel.value` 設不上 → `mapState.current` 變空字串 → 補跑在空地圖空轉 → **收益歸零**(2026-06-21 遺忘之島就是這樣壞的,修前還會跳「離線掛機 0 分鐘…無收益」的怪訊息)。
- **正解**:外掛**自存一份旅程狀態**(攀登 `afk_pride_<slot>`、遺忘之島 `afk_obl_<slot>`),登入時在「原 loadGame 之前」擷取;補跑時**還原 `state.xxx` 旗標 + 呼叫原作專屬進場函式**(攀登 `enterPrideFloor(n)`、遺忘之島 `enterOblivionMap(mapKey)`)進場,絕不走選單。
- **落點比照在線**:存活→補滿 HP/MP、留在原地續掛(state 旗標維持,saveGame 後由 `stamp()` 續記);撞死→清掉旅程旗標、`gotoMap(homeTown())` 回村(比照原作 `revive()` 的塔中/島中死亡回城)。
- **階段自動推進交給原作**:如遺忘之島「途中擊敗傳送門→進本島」是原作 `settleDeadMobs()` 內 `state._oblivionAdvance` 流程處理的,補跑時照呼叫 `settleDeadMobs()` 即可,不要自己重寫推進邏輯。
- 新增這類地圖時,記得 `mapName()` 也補上它的中文名(這些 id 不在 `MAP_CATEGORIES`,否則摘要會印出原始 id)。

### 例外:「時間排名挑戰」類的特殊 run → 離線一律「不續、不結算」(不是續掛)

非選單地圖不全都要續掛。**排名/計時挑戰**(原作 `state.riftRun` 的「時空裂痕」`rift_battle`、攀登的「排名挑戰」`prideRanked`)的設計是「停留越久排名/獎勵越高、撐到被打死」,**離線自動續＝刷排名/刷獎勵 exploit**;且原作這類 state 不存檔(transient `state` 物件)、重載一律回村(等同「中途離開＝該次作廢」)。所以離線外掛對這類**明確早退、完全不模擬**(`afk-offline.js` `maybeCatchup` 裡:排名攀登看 `prePride.ranked`、時空裂痕看 `savedMap === 'rift_battle'`)。判準:**這張圖的收益/排名是不是「靠線上停留時間累積」?是 → 離線不能幫他跑**(不然就是掛機刷榜)。一般狩獵圖(含底比斯、魔族/暗影神殿等選單地圖)才照「在線掛機照跑」續結算。

## 🐌 離線結算效能:實測結論(別再往「優化掃描」方向想)

有人問過「24h 離線結算很慢、能不能優化」。用真實存檔(Lv63 法師/zone_14)實測過,結論是**沒有可省的掃描,維持現狀**。動手「優化」前先看這節,別重蹈覆轍:

- **不是背包掃描**(本來最直覺的猜測,實測推翻):決定性反事實測試——在跑到很慢時把背包從 258 筆砍到 203 筆,每 tick 耗時幾乎沒變(311→302µs)。背包整段 24h 也只從 184 長到 258 筆(+40%),撐不起好幾倍的速度落差。所以「離線時清廢品來加速」**無效,不要做**。
- **不是記憶體/log 累積**:單場結算過程記憶體穩定在 13~20MB、沒漏;戰鬥日誌在 `state.ff`(快轉)時 `logCombat`/`logSys` 直接 return、不累積。
- **真正成本 = 戰鬥模擬本身,且 RNG 變異極大**:同一隻角色同圖,跑兩次差很多——沒升級那次每 tick ~0.11ms(24h 純運算約 96 秒)、升到 Lv68 打進更硬戰鬥那次飆到 1~2ms(24h 約 471 秒)。慢不是 bug,就是「真的在一場一場模擬戰鬥」,場面越大越吃運算。
- **參考數據**:`TICK_MS=100`,24h = 864,000 個 tick。離線外掛 `afk-offline.js` 的「ms」是時間切片預算(`SLICE_MIN_MS=28` 短離線、`SLICE_MAX_MS=250` 長離線≥1h),只影響「讓畫面喘」的額外開銷、不影響純運算那條底;250ms 以上邊際效益已很小。
- **要真的加速只剩大改方向**(離線時用簡化戰鬥模型估算收益),會動到平衡、且不能改原作者戰鬥碼,CP 值低 → **建議維持現狀,接受它有時要跑幾分鐘**。
- **2026-07-05 追加驗證(使用者又報慢、懷疑作者更新害的)**:對作者 v2.7.92–96/v3.0.x 大更新(7/4 sync `6d767417`)前後做 A/B 基準——本機起兩個 server(HEAD vs 更新前 commit 的 sparse worktree)、Playwright 同一套合成角色(Lv63/zone_14)各跑 3 輪×36k tick、每輪重新載頁,結果每 tick 5–7µs **無差異,作者更新沒有拖慢快轉**(新特效函式全走 `window.__vfxOff` 總開關,修正#8 的 getter 照罩;`logCombat` 也仍有 `state.ff` 早退)。倒是 CDP profile 抓到**我們外掛在快轉迴圈漏電**:`afk-fixes` 的「日誌捲動錨定」wrapper 在 `state.ff` 時仍對每則 logCombat/logSys 先 `getElementById`+讀 `scrollHeight`(強制排版,約佔合成快轉 10%、真實戰鬥訊息越多越傷)——已加 ff 快速通道直呼原函式。**方法備忘:懷疑效能回歸就 A/B+profile,別用猜的**;profile 其餘熱點(autoSellJunk 每 100 拍全背包掃、`_dpsSnap`/`_dpsDealt` DPS 統計每拍快照、afk-autobuy 的 tick wrapper)都是作者設計或必要成本,佔比小、別動。
- **2026-07-05 補測「離線強制賣廢品」策略(使用者問移除對不對、多久賣一次最好)**:合成 2000 格大背包+放大廢品流入,五變體×2輪×36k拍——現行不強制賣 14.2~15.6µs/拍;強制每100拍賣 12.1~12.4(**比現行快~15%**,因背包變小掃描變便宜);每1000/6000拍賣與每100拍**無差**(第一輪把存量賣掉後背包就小了,間隔不重要);自動賣出整個關(autoSellOn=false,tick 直接跳過 autoSellJunk 的每100拍 O(背包) 掃描)7.2~8.4µs=**快近一倍**。但這些差距只在「弱角色(每拍~10µs)+肥背包」情境顯著——**真實重戰鬥角色每拍 0.3~2ms,自動賣出相關全部 <1~2%、體感不出來**;當初移除強制賣出屬中性決定(它其實沒變慢、還略快,使用者的「變慢」體感是 RNG 變異),不必加回。真正有感的手段仍是玩家自己清背包/收倉庫。

## Git / GitHub

- commit / push 時**不要**帶上 Claude 作者資訊或 `Co-Authored-By` 標記(沿用全域規則)。
- **🔒 任何功能性改動(新外掛、行為調整、bug 修復),都要先讓使用者親自實測過、確認沒問題,才可以 `git commit`(2026-07-11 使用者明訂)**:不能自己用 Playwright/瀏覽器工具測完就直接 commit——那只能驗證「程式碼跑起來沒有明顯錯誤」,不能取代使用者在真實存檔/真實使用情境下的體感驗收(這批多次踩過:資產管理/批次結算第一版看似測試都過,實際被使用者一玩就抓到位置放錯、篩選邏輯理解不同等落差)。**流程改成:寫完 → 本機驗證(smoke test+瀏覽器測試,排除明顯錯誤)→ 請使用者實測 → 使用者確認沒問題 → 才 commit + 走 `/prepush` → push。**沒被使用者明確說「測過沒問題/可以了」之類的話,即使功能看起來正常也不要自己先 commit。純文件/註解/紀錄檔調整(不影響遊戲行為)不受此限,可照舊直接處理。
  - **⚠️ 再次強調(2026-07-11 使用者重申):即使目前是「Auto 模式」(不逐一詢問、自動繼續執行下一步),這條「commit 前要先過使用者實測同意」的規則完全不受 Auto 模式影響、永遠適用。** Auto 模式只代表「不用每一步都停下來問可不可以做」,不代表「可以自己判斷測試沒問題就直接 commit」——這兩件事分開判斷,commit 前的使用者同意門檻不會因為開了 Auto 模式而跳過。
  - **🚨 這條鐵律管的不只是「commit 前」,連「動手寫程式碼前」也一樣要先問——「看起來明顯該修的 bug」不是例外(踩過 2026-07-13)**:使用者回報「桌面版寬螢幕視窗下,首頁『其他功能』區塊被裁切看不到」,我判斷這是顯而易見的版面 bug,於是直接寫了 CSS 修正(把 `#login-art-stage` 的 `overflow:hidden` 改成 `overflow-y:auto`)並套用、截圖驗證後才拿給使用者看。使用者不滿意結果(捲動後內容視覺上跑到背景舞台之外,不好看),並指出這已經違反「任何修改都要先詢問、取得同意才可以動手」——這條鐵律**沒有「這是明顯的 bug 所以可以先斬後奏」這種例外**,不管改動看起來多顯而易見、多小,只要會動到程式碼/檔案內容,都要先用文字/提案描述打算怎麼改(必要時列出 2-3 個設計方向),經使用者同意後才真的動手實作。**判準:收到「這裡有問題」的回報時,先做診斷(讀碼、截圖驗證現況、找根因),把診斷結果與「打算怎麼修」分開講——診斷可以主動做,但修正方案要先提案、等同意才落地成程式碼。** 尤其是牽涉**視覺/UI 設計決策**的修改(不只是純邏輯 bug),使用者對「看起來要長怎樣」有自己的堅持,更不能自己判斷就定案(這次後續改用「偵測到內容會超出背景舞台時,整組等比縮小塞回去」的方向,是使用者親自選定後才動手做的,不是我自己決定)。
  - **🚨 「先提案取得同意」不能只給選項讓使用者選,還要明確講出「我理解的最後方案」讓使用者確認我真的懂了(2026-07-13 使用者明訂)**:光是用 AskUserQuestion 列出 2-3 個方向讓使用者選,不代表使用者選完之後我就理解對了——尤其像選角畫面拱門疊圖那次,使用者選了方向之後,我實作的細節理解跟使用者原本想的其實有落差(load1.png 疊圖沒有實際效果、裁切位置漂移等),來回好幾輪才對齊。**判準:使用者選定方向後、真正動手改程式碼之前,要先用白話文把「我接下來打算怎麼做、會改成什麼樣子」完整講一遍給使用者確認**,而不是選完方向就直接開始寫(尤其是牽涉具體數值/座標/視覺細節的實作,語言描述的方向跟實際落地的細節常常對不齊,要先講清楚讓使用者能糾正,再動手比較省來回)。
  - **🔓 例外:「跨裝置雲端同步」這類功能,本機測試工具沒辦法真正模擬「兩台實體裝置」,測試本身就需要先部署上線,commit 前置的「使用者實測確認」天然無法照原本順序執行(2026-07-20 補寵物保管雲端同步時定案)**:遇到這種情況,可以先把改動 commit+push 上線,讓使用者用真實裝置測,測完使用者明確回覆「沒問題了」之後再回頭補寫版本異動紀錄/首頁公告/打tag。**但要主動跟使用者講清楚「現在要先上線才能測」這件事、等使用者說「先push」之類的話明確同意後才這樣做**,不能自己默默假設「反正是雲端功能就可以跳過確認直接上線」。這是上面「commit前必須先實測」這條鐵律唯一的例外情境,其餘一般外掛/UI改動不適用這個例外。
- **🔓 push 前置檢查(`/prepush`)全綠後,Claude 可以直接執行 `git push`,不需每次詢問**(2026-07-10 使用者明訂,推翻同日稍早「push 一律由使用者自己執行」的暫定規則——那條是環境當下沒有 push 權限時的權宜之計,使用者確認後已改成:remote 走 HTTPS 用 `gh auth setup-git` 的憑證、`/prepush` 檢查全綠就可以直接 push)。
  - **push 前一定要先跑完 `/prepush`(bump 改動外掛的 `?v=` → `stamp-sw-version.mjs` → smoke test → 衝突標記/重複 script 檢查),全綠才 push;任一步紅就停下回報,不要硬推。**
  - push 完仍照原本流程走:背景輪詢等 GitHub Pages 重建完成才回報「已上線」,之後主動接續打 tag/開 Release 那套(見下面對應章節)。
  - 這條的前提是這台環境的 remote 已改成 HTTPS 並掛 `gh` 憑證(`git remote -v` 應顯示 `https://github.com/HSNic/nicgametest.git`)——如果哪天又變回 SSH 且連不上(`Permission denied (publickey)`),代表環境設定被改了,先回報使用者確認,不要自己亂試。

### 🔴 push 被擋→`git pull --rebase` 出現衝突時:不可盲目 `git add -A && rebase --continue`(會把衝突標記 commit 進去)

每次 push 都在跟「每小時自動同步」搶——被擋→pull --rebase 很常見。衝突分兩種,處理不同:
- **只有 `sw.js` / `version.json`(產生檔)衝突**:重跑 `node scripts/stamp-sw-version.mjs` 重新產生 → `git add -A` → `git rebase --continue`。這兩個是 stamp 產出的,重跑即正解。**⚠ 但 stamp 只會 regex 換掉 HEAD 那側的 `CODE_VERSION` 值、不會清掉 `<<<<<<< / ======= / >>>>>>>` 衝突標記**——標記若留在 `sw.js` 裡,`sw.js` 就是語法錯誤 → Service Worker 裝不起來 → **PWA 離線快取整組失效,但頁面照常渲染、smoke 照過、肉眼看不出來**(踩過 2026-07-05:一段 `ef801b66` 的衝突標記在 sw.js 裡躺了好幾個 commit 才被抓到)。所以 sw.js 衝突要**先手動刪標記留單一版本、再 stamp**,不能只靠 stamp。
- **`index.html` 也衝突**(我 bump 了某外掛 `?v=`、自動同步也重產了 index.html → 撞在同一段 `<script>`):**stamp 不會碰 index.html**,所以這時盲目 `git add -A` 會把 `<<<<<<< / ======= / >>>>>>>` 標記原封不動 commit 進 index.html → 推上去**整頁壞掉**(踩過 2026-06-28:木人場 script 出現 a/b 兩個版本+衝突標記)。**正解:先 `git diff --name-only --diff-filter=U` 看有哪些衝突檔;index.html 要手動開來解**(保留「我這次 bump 的版本」那行、刪掉另一份與三個標記),再 stamp、`git add -A`、`rebase --continue`。
- **收尾自我檢查(push 前)**:`grep -rnE "^<<<<<<< |^>>>>>>> |^=======$" index.html sw.js afk-*.js` 必須是空的(**sw.js 一定要一起 grep**,理由見上一條);`grep -c afk-<某外掛>.js index.html` 每支應為 1(沒有重複 script)。smoke 可能照過(瀏覽器把標記當文字、script 照載;sw.js 壞了也只是 SW 裝不起來、頁面照跑)→**不能只靠 smoke,一定要 grep 衝突標記**。(注意 `=======$` 要錨定行尾,否則會誤中 sw.js 註解裡的 `======` 裝飾線。)

### ⚠️ `git fetch`/`git push` 報 `fatal: bad object refs/heads/main 2` 這種帶空格的錯誤 → 先查 `.git/refs/heads/` 有沒有雜散檔案,不是遠端或憑證問題

**踩過(2026-07-10)**:準備 push 前 `git fetch` 直接失敗,錯誤訊息 `fatal: bad object refs/heads/main 2` + `did not send all necessary objects`——乍看像遠端/網路問題,但其實是本機 `.git/refs/heads/` 目錄底下多了一個檔名帶空格的雜散檔案(如 `main 2`),git 把它當成一個名字不合法的 ref、解析失敗連帶整個 fetch 失敗。這種「檔名 + 空格 + 數字」的樣式是常見的雲端同步(iCloud Drive/Dropbox 等)衝突副本命名慣例,推測是這個專案資料夾被雲端同步工具監控、`.git` 內部檔案發生同步衝突時產生的殘留。

- **判準/處理方式**:看到 `bad object refs/heads/<分支名> <數字>` 這種訊息,先 `ls -la .git/refs/heads/` 檢查有沒有多出來的雜散檔案(檔名通常是「正常分支名 + 空格 + 數字」)。
- **刪除前先確認安全**:`cat ".git/refs/heads/<雜散檔名>"` 看它指向哪個 commit,再用 `git merge-base --is-ancestor <該commit> HEAD && echo 是祖先` 確認那個 commit 已經包含在目前分支歷史裡(通常是——雜散檔案只是舊某個時間點 `main` 的重複快照)。確認是祖先、不是遺失的獨立工作後,直接刪掉該雜散檔案(`rm ".git/refs/heads/main 2"`)即可,不影響任何 commit 內容(commit 物件本身還在 `.git/objects` 裡,只是拿掉一個多餘的指標)。
- 這類問題跟 remote/憑證設定無關,**不要**去改 `git remote`/`gh auth` 或懷疑網路,先看 `.git/refs/heads/` 目錄。

### push 後要等 GitHub Pages 重建完成才算交付,並主動通知使用者

每次 push 到此 repo 後,**不要 push 完就回報「上線了」**——GitHub Pages 要重建(通常 push 後約 40 秒~1 分鐘)才會真的生效。流程:

1. **🚨 輪詢一律丟「背景任務」跑(`run_in_background`),不要在主回合同步 `sleep` 等**——同步等會讓那 1~2 分鐘完全不能回使用者訊息(使用者明確抱怨過)。push 完就把下面這支輪詢丟背景、自己繼續待命/接話,背景跑完會通知,再回報「上線了」。
2. **判準以「curl 抓線上實際版本號」為權威,不要只信 `gh api pages/builds/latest`**——build API 在連續多次 push 時會回報延遲的 commit(踩過:API 還停在前一個 commit,但 curl 線上版本其實已是最新)。背景輪詢直接比對線上外掛 `?v=`:
   ```bash
   # 背景輪詢:直到線上 version.json 的 code 值 = 這次 stamp-sw-version 產生的值(最簡單直接)
   for i in $(seq 1 14); do
     v=$(curl -s --ssl-no-revoke "https://hsnic.github.io/nicgametest/version.json?cb=$(date +%s)")
     echo "[$i] $v"; echo "$v" | grep -q "<這次 stamp 出來的 code 值>" && { echo BUILT; break; }; sleep 15
   done
   ```
   (`gh api repos/HSNic/nicgametest/pages/builds/latest --jq '{status,commit}'` 可當輔助參考,但不要當唯一判準。)
3. 背景輪詢回報「BUILT」後**才**通知使用者「已上線、可重整看到新版」(訊息從 Telegram 來就用 `reply`)。
- GitHub Pages 站台:`https://hsnic.github.io/nicgametest/`(repo `HSNic/nicgametest`,非原作者 shines871)。**⚠️ 2026-07-10 修正:這裡先前誤寫成 `pp771007.github.io/idle-lineage-class`,那是錯的網域/repo 名稱,曾害背景輪詢打錯網址查了一輪都查不到——`pp771007` 是協助維護小百科/掉落查詢那位協作者的帳號,跟站台網域無關,不要搞混。**

### 🔴 push 上線後,主動接著把 tag + GitHub Release 整套做完,不要等使用者提醒、也不用使用者手動操作(2026-07-10 更新,推翻原本「步驟3-4使用者做」的分工)

**踩過**:合併一批功能(同步+介面優化+光圈特效)push 上線後,只回報「已上線」就結束,沒有主動接著走 `../發布上架/發布Release流程.md` 的打 tag/開 Release 流程,被使用者問「github一樣要有版本,怎麼沒有提示我」才想起來。

- **2026-07-10 使用者再次明訂**:`發布Release流程.md` 原本把步驟 3(push tag)、步驟 4(開網頁 Release)劃給使用者做,理由是「需要密碼/需要瀏覽器登入」——但 remote 早就已經改成 HTTPS + `gh auth setup-git` 憑證(見上面「Git / GitHub」章節),`gh` CLI 本身已登入且有 `repo` 權限,**push tag 不需要密碼、開 Release 也不需要瀏覽器登入,兩者都能直接用命令列做完**,不需要使用者插手。使用者原話:「你不是可以幫我一起,以後都你做就好了」。
- **判準/新流程**:凡是「一批功能/修改完成、確認上線沒問題」的時間點,`git push` 完之後**主動一次做完全部 5 步**,不再分批問使用者:
  1. 確認 `version.json` 的 build 值。
  2. `git tag -a v<build> -m "..."` 建本機 tag。
  3. `git push origin v<build>` 推上去(HTTPS+gh憑證,不需密碼)。
  4. `gh release create v<build> --repo <owner>/<repo> --title "加掛版 build <build>" --notes "<內文>"`(內文可直接從版本異動紀錄玩家版最新一筆整理;`gh release create` 預設非 draft、非 prerelease,不需要額外選項)。
  5. `curl "https://api.github.com/repos/<owner>/<repo>/releases/latest"` 驗證 `tag_name`/`name`/`draft`/`prerelease`/`body` 正確,回報使用者「已發布 Release:<網址>」。
- **`發布Release流程.md` 裡「誰做哪一步」那張表已過期**(還寫著步驟3-4是使用者做),之後有空要回頭一併更新那份文件,說明改用 `gh release create`;沒更新前,**以這裡(CLAUDE.md)最新規則為準**。
- 這條跟上面「push 後等 GitHub Pages 重建」是同一個精神的延伸:**上線不是 push 完就結束,還有 tag+Release 這一步,要主動走完整套流程、不假手使用者、不要漏講。**
