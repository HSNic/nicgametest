---
name: release
description: 放置天堂加掛版發布 GitHub Release 的固定流程 — 確認 version.json build 值、本機建 tag、給使用者 push tag + 開網頁 Release 的完整指令與內文草稿、curl 驗證、更新交接紀錄。當使用者說「打tag」「發布release」「補打release」或 /release 時使用。
disable-model-invocation: true
---

# /release — 發布 GitHub Release 一鍵準備

對應 `Lineage/加掛版/docs/發布上架/發布Release流程.md`。**只做「不需要密碼」的步驟**(建 tag、curl 驗證),push tag 與網頁上開 Release 一律交給使用者,附清楚的指令與文字草稿讓他複製貼上。

## 步驟

1. **確認狀態**(在工作資料夾內):
   ```bash
   git status --short --branch
   cat version.json
   git tag --list | tail -5
   ```
   - 工作目錄要乾淨、`main` 與 `origin/main` 一致(沒乾淨/沒 push 先停下告知使用者)。
   - 確認 `version.json` 的 `build` 值,且 `v<build>` 這個 tag 還不存在。

2. **本機建 annotated tag**(不需密碼,直接做):
   ```bash
   git tag -a v<build> -m "<這批改動的一句話重點>"
   ```
   - 說明文字優先從 `Lineage/加掛版/docs/版本異動紀錄/版本異動紀錄_玩家版.md` 最新那一筆濃縮成一句話,不要自己重新編。

3. **回報使用者接下來要做的兩步**,附完整指令與草稿,不要只講「請你去打 tag/開 Release」就沒下文:
   ```bash
   git push origin v<build>
   ```
   接著到 `https://github.com/<owner>/<repo>/releases/new`:
   - Tag:選 `v<build>`
   - Release title:`加掛版 build <build>`
   - Release notes:貼上(從玩家版異動紀錄該筆複製,已在上一步準備好文字)
   - Label 維持 **None**,按 **Publish release**

4. **使用者確認做完後,驗證**:
   ```bash
   curl -s "https://api.github.com/repos/<owner>/<repo>/releases/latest"
   ```
   確認 `tag_name`/`name`/`draft:false`/`prerelease:false` 都正確、`body` 內容跟草稿一致。

5. **更新交接紀錄**:回到 `Lineage/加掛版/docs/交接與接手/` 最新那份交接紀錄,把「尚未打 tag/Release」改成「已補打 tag `v<build>` 並發布 Release,curl 驗證過 xxx」。

## 判準/提醒

- 步驟 1-2、4 不涉密碼,我自己做;步驟 3 的 push tag + 網頁操作一律使用者做,不要代勞、也不要問使用者要不要自己做——直接照這個分工進行。
- 若使用者是在「一批功能完成、確認上線沒問題」的收尾語氣下沒有主動要求 release,也要主動提議跑這支流程,不要等使用者問「怎麼沒版本」才想起來。
