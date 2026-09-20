# Game Name Radar — Agent 操作规则

## 项目架构概述

本项目是一个游戏 SEO 词监控雷达，分为两层：

- **后台层（CI/脚本）**：Node.js 脚本定期扫描数据源、验证关键词、生成数据文件，全部在 GitHub Actions 中自动执行。
- **前端层（浏览器）**：`index.html` + `app.js` + `styles.css` 是纯静态页面，部署在 Vercel/GitHub Pages，读取 `data/` 目录下的 JSON 文件展示结果。

---

## ⚠️ 严禁操作

### 1. 不要在本地执行任何 `scripts/` 下的脚本

`scripts/` 目录下的所有 `.mjs` 脚本（`scan.mjs`、`split-candidates.mjs`、`verify-*.mjs`、`fill-*.mjs` 等）**只能由 GitHub Actions CI 执行**，不要在本地运行它们。

原因：这些脚本会直接读写 `data/` 目录下的 JSON 文件。如果本地执行后再与远端 CI 的提交合并，会产生 data 文件的 merge conflict，需要手动处理。

```
❌ node scripts/split-candidates.mjs
❌ node scripts/scan.mjs
❌ node scripts/verify-serper.mjs
```

### 2. 不要手动修改 `data/` 目录下的任何 JSON 文件

`data/` 目录下的所有文件均为**自动生成文件**，由 CI 脚本维护：

| 文件 | 生成者 |
|---|---|
| `candidates.json` | `scan.mjs` + 各 verify 脚本 |
| `candidates-recent.json` | `split-candidates.mjs` |
| `candidates-YYYY-MM.json` | `split-candidates.mjs` |
| `candidates-index.json` | `split-candidates.mjs` |
| `latest-report.json` | `scan.mjs` |
| `state.json` | `scan.mjs` |
| `*-usage.json` / `*-status.json` | 各验证脚本 |

**Agent 可以修改的文件范围：**

```
✅ app.js           — 前端逻辑
✅ styles.css        — 前端样式
✅ index.html        — 页面结构
✅ scripts/*.mjs     — 脚本代码本身（只改代码，不要执行）
✅ lib/*.mjs         — 公共库代码
✅ config/*.json     — 配置文件（非 data/ 下）
✅ .github/          — CI 工作流配置
```

---

## 数据流向

```
GitHub Actions CI
      ↓ 执行
  scan.mjs + verify-*.mjs + fill-*.mjs
      ↓ 读写
  data/candidates.json（后端主库，21MB 量级）
      ↓ 执行
  split-candidates.mjs
      ↓ 生成
  data/candidates-recent.json   ← 浏览器默认加载（最近 7 天）
  data/candidates-YYYY-MM.json  ← 按需懒加载（历史归档）
  data/candidates-index.json    ← 归档目录索引
      ↓
  Vercel 托管 → 用户浏览器
```

## 数据清理策略

- `split-candidates.mjs` 运行时会自动清理 `candidates.json` 中超过 **60 天**的记录（`PRUNE_DAYS = 60`）
- 月度归档文件一旦写出不会被自动删除（手动管理）

---

## 本地开发建议

修改前端代码后，可以用任何静态文件服务器预览：

```bash
npx serve .
# 或
python3 -m http.server 8080
```

浏览器直接访问 `http://localhost:8080` 即可，读取的是本地 `data/` 目录下的 JSON（内容与远端一致，不会被修改）。
