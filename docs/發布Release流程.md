# 發布 GitHub Release(獨立版本)流程

這份文件記錄「怎麼把目前的進度標記成一個獨立版本(Release)」,方便日後對照歷史版本、
或需要回溯到某一版程式碼時使用。跟一般的 `git push` 是分開的兩件事:

- **`git push`**:把 commit 送上 GitHub,GitHub Pages 會自動重新部署(每次都會做,不用特別記)。
- **發布 Release**:額外幫某個時間點的狀態貼一個版本標籤(tag)+ 說明,方便回顧。**不是每次
  `git push` 都要做**,通常是一批功能/修改完成、測試沒問題後才建一個。

## 前置狀態

- 專案已推上 GitHub:`git@github.com:HSNic/nicgametest.git`
- GitHub Pages 設定為「Deploy from a branch」,`main` 分支,已經是自動部署,不需要額外處理。

## 步驟

### 1. 確認要標記的版本號

版本號採用 `version.json` 裡的 `build` 值(格式 `MMDD-HHMM`,例如 `0707-2046`),
Claude Code 會在完成一批修改、跑完測試後主動確認目前的 build 值。

### 2. 建立 git tag(Claude Code 執行)

```bash
git tag -a v<build> -m "<這個版本的重點說明>"
```

例如:

```bash
git tag -a v0707-2046 -m "加掛版 build 0707-2046 — 道具子分類篩選、共用倉庫搜尋、自動販賣bug修復"
```

### 3. 把 tag 推上 GitHub(使用者自己在終端機執行)

一般 commit 用 `git push` 就會推,但 **tag 要另外推**,不會自動跟著一般 push 上去:

```bash
git push origin v<build>
```

會需要輸入 SSH 私鑰密碼(跟平常 push 一樣)。

### 4. 在 GitHub 網頁上發布 Release(使用者自己操作)

1. 到 repo 頁面(`https://github.com/HSNic/nicgametest`)。
2. 找到 **Releases** → **Draft a new release**(或直接開網址
   `https://github.com/HSNic/nicgametest/releases/new`)。
3. **Tag**:選剛剛推上去的 `v<build>`(如果下拉選單裡沒看到,代表 tag 還沒 push 成功,回步驟 3)。
4. **Release title**:填 `加掛版 build <build>`。
5. **Release notes** 內文:貼上這次改動的重點,可以直接從
   `docs/版本異動紀錄_玩家版.md` 最新那一筆的白話重點複製過來。
6. **Release label** 維持 **None**(正式版才選 None,測試性質的才勾 Pre-release)。
7. 按 **Publish release**。

### 5. 驗證(Claude Code 執行)

```bash
curl -s "https://api.github.com/repos/HSNic/nicgametest/releases/latest"
```

確認回傳的 `tag_name`/`name` 跟剛剛發布的一致,即完成。

## 誰做哪一步

| 步驟 | 誰做 | 為什麼 |
|---|---|---|
| 1. 確認版本號 | Claude Code | 讀 `version.json` 即可,不涉及密碼 |
| 2. 建立 tag | Claude Code | 純本機 git 操作,不需要密碼 |
| 3. push tag | 使用者 | 需要輸入 SSH 私鑰密碼,密碼不應經手 Claude Code |
| 4. 發布 Release | 使用者 | 需要登入 GitHub 網頁操作,Claude Code 沒有瀏覽器登入權限 |
| 5. 驗證 | Claude Code | 讀公開 API,不需要密碼 |
