---
name: sync-diff
description: 套用原作者本體新版前的差異分析與外掛風險評估 SOP — 逐檔diff、三分類寫進 docs/同步/同步差異分析_YYYYMMDD.md、對照外掛依賴評估風險，經使用者同意才套用。當使用者說「同步原作者」「合併原版」「套用新版」「跟上游同步」或 /sync-diff 時使用。
disable-model-invocation: true
---

# /sync-diff — 套用同步前的差異分析(先分析、後套用)

對應 CLAUDE.md「🔒 同步順序」與「合併原版」兩節、`Lineage/加掛版/docs/同步/更新SOP_20260706.md`。**核心鐵則:先分析、寫記錄、評估風險、經使用者同意,才真的覆蓋任何檔案**——不是套用完再回頭看差異。

## 第 0 步:先確認有沒有跑過自動比對

- 檢查有沒有「🔍 原作者已更新,等待人工確認是否套用」的 issue,或 `gh run list --workflow=sync-upstream.yml --limit 1`。
- **沒跑過**(使用者直接把新版資料夾丟進來,或作者剛更新 workflow 還沒排到):**先問使用者**要不要先觸發 `gh workflow run sync-upstream.yml --ref main` 跑一輪機械式比對+冒煙測試,再決定分析深度,不要跳過去直接手動全部分析。
- **有跑過**:把 workflow summary/issue 內容(diff 清單、關鍵字比對、冒煙測試結果)當素材,省掉重新讀一次 diff 的力氣,直接進第 1 步。

## 第 1 步:逐檔 diff,不要只挑新增的看

- 新版來源(使用者放的資料夾,或抓下來的暫存檔)當唯讀資料,逐檔 `diff` 出跟目前 repo 對應檔案(`index.html`/`js/*.js`/`css/*.css`)的差異。
- **既有公式/機制被改的部分跟新增的定義一樣重要**——機制改動不會以「新增」的樣子出現,只挑新增一定漏(小百科同步踩過的雷是同一個道理)。重點讀 `js/02-stats`、`js/03`/`04-combat`、`js/01-drops`、`js/05-kill` 裡被修改的成對 `-`/`+` 行。

## 第 2 步:寫成記錄檔(套用前就要寫好)

- 存進 `Lineage/加掛版/docs/同步/同步差異分析_YYYYMMDD.md`(跟現有檔案同一資料夾,檔名比照慣例)。
- 分三類條列:**新增功能** / **數值機制調整**(改了哪個函式/公式、原值→新值)/ **新增內容代表例子**(裝備/道具/地圖等)。

## 第 3 步:評估外掛風險

- 對照 `index.html` 的 DOM id/class、原作者全域函式名稱,有沒有被改名/移除、是不是 `afk-*.js` 依賴的東西。
- 跑 `node scripts/check-hook-points.mjs` 與 `node scripts/smoke-hooks.mjs` 當輔助佐證(不能取代人工讀 diff 判斷,這兩支只驗「掛點字串還在」,不驗「邏輯上會不會衝突」)。
- 對照 `Lineage/加掛版/docs/風險與外掛/外掛依賴矩陣_20260706.csv`,確認這次改動有沒有碰到高風險外掛(`afk-offline.js`/`afk-mobile.js`/`afk-dex.js`/`afk-wiki.js`/`afk-fixes.js`/`afk-training.js` 等)依賴的資料結構。
- 評估結果寫進同一份記錄檔。

## 第 4 步:回報使用者、等同意

- 用白話文(使用者是程式小白)講清楚「這次原作者加了什麼、會不會影響我們的外掛」,不要假設他都懂術語。
- **等使用者明確同意才進到套用**(執行 `sync-local-upstream.mjs`/覆蓋檔案並 commit)。

## 套用之後(同意之後才做)

- 走原本流程:建分支 → 跑 `scripts/sync-local-upstream.mjs`(或 `sync-upstream.mjs`)→ smoke test → 手動功能驗收(桌機+手機)→ 合併進 main。
- 完成後別忘了接著跑 `/update-changelog` 補紀錄、`/prepush` 做 push 前檢查。

## 判準

- 這支 skill 只覆蓋「差異分析→記錄→風險評估→取得同意」這四步,不包含實際套用(套用步驟仍照 `更新SOP_20260706.md` 走)。
- 「原加掛版作者新版」這個第三方 fork 的本體(`js/00~20`)跟我們的同步管道不相容(已驗證過,見 `交接紀錄_20260709.md`)——遇到這個來源的**本體**部分,先確認架構相容再分析,別預設能直接套 diff;其**外掛層**仍可個案評估引入。
