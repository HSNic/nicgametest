# 離線結算效能日誌(AFKOfflineProfiler)測試紀錄

> 對應任務:`Lineage/待辦-ClaudeCode/交接待辦/2026-07-14_離線結算效能日誌代辦建議書(Profiler規格).md`

## 實際修改檔案

- 新增 `afk-offline-profiler.js`:`window.AFKOfflineProfiler` 統計器本體。
- 修改 `afk-offline.js`:在 `runCatchup()` 加入各階段掛點呼叫(見下方掛點位置),以及三個既有 monkey-patch(`killMob`/`gainItem`/`settleDeadMobs`)的擴充,並新增 `castSkill` 的 monkey-patch。
- 修改 `index.html`:新增 `<script src="afk-offline-profiler.js?v=...">`,排在 `afk-offline.js` 之前。
- 修改 `scripts/sync-upstream.mjs`:`PLUGINS` 陣列補上新外掛(同步時自動補回引用)。
- 修改 `scripts/smoke-hooks.mjs`:`need` 清單加入 `[AFK-offline-profiler]`。

未修改 `js/*.js` 本體任何一行。

## 掛點位置(對照 `afk-offline.js` 內的 `runCatchup()`)

| 階段 | 掛法 |
|---|---|
| 離線開始 | `runCatchup()` 最前面呼叫 `AFKOfflineProfiler.begin({offlineSeconds})` |
| Fast Mode | 每次呼叫 `fastKillOnce()` 前後包 `startSection('fastMode')`/`endSection` |
| Boss | 「BOSS 對打中,逐拍真模擬」那段迴圈,只包住 `tick()` 呼叫 |
| 全模擬(規格書未定義,額外補充欄位) | 一般全模擬迴圈,只包住 `tick()` 呼叫;與 Boss 分開統計,才能單獨看「非BOSS全模擬」花多少時間(法師慢的關鍵疑點) |
| Loot | monkey-patch 全域 `settleDeadMobs()`,只在 `catchingUp===true` 期間計時,涵蓋 Fast Mode/Boss/全模擬/收尾呼叫的所有掉落結算 |
| Batch | 保留欄位,永遠回報 0(見下方「已知限制」) |
| UI | 補跑結束後 `updateUI()`/`renderTabs(true)` 前後包 `startSection('ui')`/`endSection` |
| 離線結束 | UI 階段結束後呼叫 `AFKOfflineProfiler.finish({hitsPerKill, dps})` |

## 各欄位定義

- **monsterKills / bossKills**:擴充既有 `killMob` monkey-patch,依 `m.boss` 分流計數。
- **dropCount**:擴充既有 `gainItem` monkey-patch;`fastRefill()`(快速結算自動補貨,治癒水/增益藥水/卷軸)呼叫的 `gainItem` 用 `_profBuying` 旗標排除,不算掉落,只計真正的怪物掉落/獎勵。
- **skillCount**:monkey-patch 全域 `castSkill()`,只在補跑期間(`catchingUp===true`)每次呼叫累加 1。
- **buffCount**:同一個 `castSkill` 包裝內,若該技能定義(`DB.skills[skId]`)有 `dur`(持續時間)欄位,視為 buff 類施放/刷新,額外累加。
- **rewards.exp / rewards.gold**:重用既有的 `expTotal(after)-expTotal(before)` / `after.gold-before.gold`(攀登另外用 `climbSegs` 加總),與離線歷史紀錄同一套算法,不重新發明。
- **averages.hitsPerKill**:`done / 本次總擊殺數`(`killTally` 加總),全模擬與快速結算通用,不受限於快速結算取樣窗。
- **averages.dps**:重用原作既有的 `_dps` 全域統計(玩家+召喚+夥伴+全部傭兵傷害總和)÷「真正呼叫過 `tick()` 的拍數」(`_profRealSimTicks*TICK_MS/1000`)。**限制**:攀登/遺忘之島途中會換圖,原作 `_dpsReset()` 會被觸發、中途歸零,此時 `dps` 不可信 → 一律不計算,`dpsAvailable` 維持 false。
  - **⚠️ 踩過兩個坑,實測時發現、已修正**:①分母原本用 `done`(整段補跑的總拍數,含快速結算「公式估算」的拍數),但 `_dps` 只有真正跑 `tick()` 才會累加——快速結算的殺完全不計入,用 `done` 當分母會把 DPS 稀釋到幾乎是 0;改成只用「真的呼叫過 `tick()` 的拍數」當分母才對。②讀 `_dps` 的時機抓錯:原本放在「結算後落點」(`gotoMap()`/`enterPrideFloor()` 等)**之後**才讀,但這些函式會呼叫原作 `changeMap()→auditReset()→_dpsReset()`,把 `_dps` 歸零——不管本次補跑打了多少傷害,讀到的永遠是 0。改成在戰鬥迴圈**剛結束、還沒呼叫任何落點函式之前**就先把 `_dps` 讀走存起來(`_profDmgSnap`)。兩個坑都是實測(用超高血量的合成角色跑 `forceCatchup`)才抓到,單看程式碼容易誤判「邏輯看起來合理」。

## 已知限制

1. **Batch 花費永遠是 0**:規格書認定的「afk-batch-settle.js 批次寫入」實際上是「一次結算多個存檔位」的獨立功能,內部仍是逐一呼叫同一個 `runCatchup()`,不是單一結算內的子階段。所以在目前架構下,「單一登入結算」這個最常見情境本來就不會經過 Batch 階段,回報 0 是正確行為,不是漏做。若之後要看「批次結算多個存檔位」本身的額外開銷,需要另外在 `afk-batch-settle.js` 加掛點(這次沒做,範圍之外)。
2. **平均 DPS 在攀登/遺忘之島為 N/A**:見上方「dps」定義的限制說明。
3. **dropCount 是「事件次數×數量」的加總,不是掉落事件次數**:符合規格書「建議 Console 顯示實際物品總數量」,但沒有另外保留 `dropEventCount`(目前判斷用不到,先不做)。
4. **skillCount/buffCount 只涵蓋透過 `castSkill()` 進入的技能**:幻術士的 `cubeTick()`/`illuSummonTick()` 等不經過 `castSkill()` 的機制不會被計入(這兩個本來就與本次法師慢的推論無關,先不處理)。

## 測試方式與結果

用 Playwright 無頭瀏覽器,建立一個 Lv1 法師角色、進入 `zone_01`,分別呼叫:

- `window.AFK_OFFLINE_DEBUG = true` 開啟偵錯輸出
- `window.__afk.forceCatchup(20, false)`(20 分鐘,允許快速結算)
- `window.__afk.forceCatchup(20, true)`(20 分鐘,強制全模擬)

**結果**:兩次呼叫都正確印出 `[AFK-OFFLINE] 離線結算完成` 摘要,所有欄位皆存在且為數字(無 `undefined`);測試角色調高血量後確認能實際擊殺,`monsterKills`/`rewards.exp`/`rewards.gold`/`averages.hitsPerKill` 都正確反映真實結算結果;`timings.fullSimMs`/`lootMs`/`uiMs` 皆有非零的合理毫秒數;`timings.batchMs` 恆為 0(符合預期,見上方限制1);關閉 `AFK_OFFLINE_DEBUG` 後(預設值)不會印出完整摘要。

`node scripts/smoke-hooks.mjs` 全部外掛(含新增的 `[AFK-offline-profiler]`)hooks OK,掉落查詢地圖名翻譯覆蓋率照常通過。

## 尚未涵蓋(需要人工/實機測試補足)

- 真實法師存檔(高等級、實際召喚獸/寵物數量)離線結算的完整比對數據——這是這份 profiler 存在的目的,建議下一步請使用者提供 1-2 個法師存檔,實際載入後開 `AFK_OFFLINE_DEBUG` 觀察一次真實登入結算,拿到的數字才能回頭驗證「法師結算慢是不是召喚獸拖慢全模擬」的推論。
- BOSS 分支(`bossMs`/`bossKills`)只在合成測試中跑過程式路徑檢查,未用真實 BOSS 遇敵驗證數字合理性。
- 手機瀏覽器(非 Playwright headless)上的實測,理論上與桌機無差異(profiler 純 JS 邏輯、無 DOM 依賴),但尚未實機確認。
