# 页面迁移清单

## 当前页面 -> 新页面

### 1. `public/index.html`

拆分为：

- `/`
  - 全局首页
  - 各 app dashboard 入口
  - 一级业务入口

- `/apps/:appId`
  - 当前 App 的总览页

- `/ingest/article`
  - 文章录入
  - 搜索并录入文章

- `/ingest/video`
  - 视频录入总入口

- `/ingest/video/tiktok`
  - TikTok 录入总入口

- `/ingest/video/youtube`
  - YouTube 录入

- `/agent/current`
  - Agent 状态
  - LaunchAgent
  - 命令与日志

### 2. `public/ad-shots.html`

迁移为：

- `/ingest/video/tiktok/ttcc`

### 3. `public/ad-shot-subscriptions.html`

迁移为：

- `/ingest/video/tiktok/ttcc/subscriptions`

### 4. `public/article-view.html`

保留详情页属性，迁移为：

- `/articles/view.html?id=...`

后续可升级为：

- `/articles/:id`

### 5. `public/report-system.html`

迁移为：

- `/agent/system`

---

## 当前前端代码 -> 新模块

### `public/app.js`

拆分目标：

- `public/js/core/api.js`
- `public/js/core/navigation.js`
- `public/js/apps/dashboard.js`
- `public/js/ingest/article.js`
- `public/js/ingest/video.js`
- `public/js/ingest/tiktok.js`
- `public/js/ingest/youtube.js`
- `public/js/agent/status.js`

当前状态：

- 遗留实现已迁到 `public/legacy/app-legacy.js`
- `public/app.js` 仅保留兼容壳

### `public/styles.css`

拆分目标：

- `public/styles/base.css`
- `public/styles/layout.css`
- `public/styles/components.css`
- `public/styles/pages/home.css`
- `public/styles/pages/ingest.css`
- `public/styles/pages/agent.css`
- `public/styles/pages/ad-shots.css`

当前状态：

- 遗留实现已迁到 `public/legacy/styles-legacy.css`
- `public/styles.css` 仅保留兼容壳
- 新页面主入口已切到 `public/styles/base.css` 与 `public/styles/workspaces.css`

---

## 首批拆分优先级

### P1

- 首页 `/`
- 录入首页 `/ingest`
- Agent 当前状态 `/agent/current`

### P2

- `/ingest/article`
- `/ingest/video`
- `/ingest/video/tiktok`
- `/ingest/video/youtube`

### P3

- `/ingest/video/tiktok/ttcc`
- `/ingest/video/tiktok/ttcc/subscriptions`
- `/production/*`
- `/apps/:appId`

---

## 本轮重构不先动的内容

- `/api/*` 接口协议
- Ad Shot 详情页 `/shots/:shotId`
- 文章详情读取逻辑
- 分析队列与后端任务流

原则是先换页面层级，再换内部实现。
