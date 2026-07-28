---
name: game-name-radar
description: |
  监控竞争站 Sitemap、itch.io HTML5 游戏列表与 RSS，识别新增游戏名，建立 Google Trends 和 SERP 验证队列。

  触发条件：
  - 用户要求发现新游戏名、监控游戏 Sitemap、寻找 HTML5 游戏 SEO 趋势词
  - 用户要求运行 Game Name Radar 或解释候选评分
---

# Game Name Radar

## 目标

比普通游戏站更早发现开始扩散的新游戏名称，并把它们送入：

1. Google Trends 最近 7 天验证
2. Google Trends 最近 30 天验证
3. Google SERP 竞争检查
4. 域名可注册性检查
5. 纯 HTML 建站队列

## 来源优先级

1. 多个竞争站 Sitemap 同时新增同一游戏
2. itch.io New & Popular
3. itch.io Featured
4. itch.io 最新 HTML5 / New Feed
5. 其他 RSS、Jam 或开发者源

## 操作流程

### 1. 配置来源

编辑 `config/sources.json`。竞争站 Sitemap 应设置：

```json
{
  "kind": "competitor-sitemap",
  "fetchKind": "sitemap",
  "baselineOnly": true
}
```

### 2. 扫描

```bash
npm run scan
```

扫描结果写入：

- `data/state.json`：每个来源的 URL 快照
- `data/candidates.json`：候选游戏名
- `data/latest-report.json`：最近扫描状态

### 3. 候选验证

优先验证分数 >= 12 的名称：

- Trends US / 7 天：是否持续上升，而非单个尖峰
- Trends US / 30 天：是否有基础热度或扩散轨迹
- 精确游戏名 SERP：第一页是否缺少可直接玩的独立页面
- `game name play online`：是否已被大型游戏站覆盖
- 域名：精确名称或可识别变体是否为正常注册价

### 4. 处理结果

- `selected`：准备注册域名并建站
- `done`：站点已上线
- `ignored`：无趋势、竞争过强、名称歧义或无法授权嵌入

## 评分

多来源交叉出现比单一平台信号更重要。评分仅负责排序，不应自动决定购买域名。

## 安全要求

- 不扫描 localhost、私网 IP 或带账号密码的 URL
- 限制 Sitemap 子文件数量和响应大小
- 不抓取登录后内容
- 不绕过 Robots、付费墙或访问控制
- 不未经许可重新托管或嵌入第三方游戏
