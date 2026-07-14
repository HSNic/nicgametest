# AGENTS.md

> AI Agent 共用工作規範（適用於 Codex、Claude Code 與其他支援 AGENTS.md 的工具）

## 目的

本文件提供 AI Agent 最基本的工作規範。
詳細開發規範、同步流程與專案規則請閱讀：

- `CLAUDE.md`
- `docs/ARCHITECTURE.md`

---

## 工作原則

1. 先分析，再修改。
2. 一次只處理一個問題。
3. 保持最小修改範圍（Minimal Changes）。
4. 優先維持與原作者同步能力。
5. 完成後提供修改摘要、Git diff、測試方式與風險說明。
6. 若資訊不足，不得猜測，應明確標示未確認事項。

---

## 修改規則

- 優先修改外掛層（例如 `afk-*.js`）。
- 修改 `js/*` 前，必須說明原因。
- 不得任意改變：
  - 經驗值
  - 金幣
  - 掉寶率
  - 技能效果
  - Boss 行為
  - 離線收益結果
- 不得降低遊戲正確性來換取效能。

---

## Git 規範

未經使用者明確要求，不得：

- Commit
- Push
- Merge
- 建立 Pull Request
- 建立 Release
- 修改 GitHub Actions

---

## 測試要求

修改完成後應說明：

- 修改檔案
- 修改原因
- Git diff
- 測試方式
- 已知風險
- 是否影響原作者同步

---

## 文件使用順序

1. AGENTS.md（本文件）
2. CLAUDE.md（完整規範）
3. docs/ARCHITECTURE.md（專案架構）
4. docs/analysis/（既有分析）
5. docs/design/（系統設計）
6. docs/testing/（測試規範）

---

## 專案原則

- 保持外掛式架構。
- 保持可回歸測試。
- 保持文件同步更新。
- 重大修改前先分析，重大修改後更新文件。

---

## 發現問題時

若發現：

- 架構衝突
- 效能瓶頸
- 潛在 Bug
- 可維護性問題

請先提出分析與建議，不要直接大幅重構。

---

**本文件為 AI Agent 入口文件；完整規範請以 `CLAUDE.md` 為準。**
