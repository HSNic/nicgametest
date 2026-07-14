# Console 問題修正測試紀錄

> 對應 `analysis/CONSOLE_ERROR_ROOT_CAUSE.md`

## 測試網址/瀏覽器

- 本機 Playwright headless Chromium(`http://127.0.0.1:8124/index.html`,靜態檔案伺服器直接讀專案根目錄)
- 尚未在真實手機/桌機瀏覽器實測(見下方已知限制)

## 測試步驟與結果

1. 載入首頁,等待 Service Worker 註冊完成(`navigator.serviceWorker.ready`)。
2. 直接抓取 `anim-manifest.json`/`assets-manifest.json`,透過 `postMessage` 送出 `reconcile-anim`/`reconcile-images` 給 SW(模擬 `afk-pwa.js` 每次載入都會做的事)。
3. 監聽 SW 回傳的 `reconcile-anim-done`/`reconcile-done` 訊息,並收集頁面 console 的所有 error 等級輸出。

**修正前(邏輯上的推論,依程式碼確認)**:圖桶項目數夠多時,`reconcileAnim()` 的 `cache.keys()` 會拋出 `AbortError: operation too large`,且未捕捉 → Console 出現 `Uncaught (in promise) AbortError`。

**修正後**:
- `reconcile-anim` / `reconcile-images` 都正常收到完成訊息(`{type:'reconcile-anim-done', evicted:0}` / `{type:'reconcile-done', evicted:0}`),首次執行 `evicted:0` 符合預期(全新快取,沒有東西要清)。
- 頁面 console 的 error 只有動畫探測產生的 404(約 10 筆,對應創角畫面動畫,見下方動畫404部分),**沒有任何 AbortError 或 Cache 相關例外**。
- `node scripts/smoke-hooks.mjs` 全外掛(含新增的 `[AFK-offline-profiler]`)hooks OK 依然通過。

## 是否仍有 404

有,但確認是原作者動畫幀數探測機制的正常行為(詳見 `analysis/CONSOLE_ERROR_ROOT_CAUSE.md` 問題B),同一隻怪只探測一次、不會重複請求,404 回應本來就不會被 SW 快取(`cacheFirst()` 只認 `status===200`)。

## 是否仍有 Cache 錯誤

沒有,測試過程未再出現 `AbortError`/`Cache`相關的未捕捉例外。

## PWA 是否正常

`navigator.serviceWorker.ready` 正常 resolve,`reconcile-images`/`reconcile-anim` 訊息往返正常,SW 註冊/啟用流程未受影響。

## 已知限制

- 這次測試用的是「全新快取」情境(圖桶剛建立,沒有大量歷史資料),沒有真的模擬「圖桶累積數萬項目」這個原始錯誤實際發生的規模——但修正後的程式碼結構(拿掉了無條件的全桶 `cache.keys()`)在邏輯上排除了這個錯誤的觸發點,不論快取多大都不會再打到同一個限制。
- 「怪物動畫逐怪清除舊快取」功能(這次順便修正的資料格式問題)還沒有實測「作者真的換掉某隻怪的動畫幀後,舊快取真的被清除、新版本正確載入」這個完整情境——建議之後有機會遇到作者更新某隻怪的動畫時,順便觀察一次驗證。
- 尚未在真實手機/桌機瀏覽器上實測,建議你實際玩一下、開瀏覽器開發者工具的 Console/Network 分頁看看,確認沒有異常紅字報錯(動畫404屬正常,其餘任何紅字都請回報)。
