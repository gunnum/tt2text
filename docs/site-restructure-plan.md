# 网站页面层级重构计划

## 1. 目标

按新的业务脑图，把当前站点从“单页多 tab 混合工作台”重构为“按业务域分层的多页面结构”，同时保留现有接口与核心流程可用。

这次重构先解决 4 个问题：

1. 首页承担过多功能，页面角色不清
2. 录入、分析、生产、Agent 运维混在一起
3. 页面入口和 URL 缺少层级
4. `public/index.html` + `public/app.js` 已经形成巨石页面，不利于继续加功能

---

## 2. 新页面层级

### 一级结构

- `/` 首页
- `/apps/*` 各 app dashboard
- `/ingest/*` 录入数据
- `/production/*` 生产
- `/agent/*` 本地 agent 状态

### 二级与三级结构

#### 2.1 首页

- `/`
  - 各 app dashboard 入口
  - 全局业务入口

#### 2.2 App Dashboard

- `/apps/:appId`
  - 单个 app 的工作台
  - 最近视频
  - 最近文章
  - 最近数据录入
  - 最近生产内容

#### 2.3 录入数据

- `/ingest`
  - SensorTower 录入
  - 视频录入
  - 文章录入

- `/ingest/sensortower`
  - SensorTower CSV / 页面录入
  - 历史导入记录

- `/ingest/video`
  - 视频录入入口页
  - 自动识别链接类型
  - TikTok 录入
  - YouTube 录入

- `/ingest/video/tiktok`
  - TikTok 录入总入口
  - 普通视频
  - TTCC 广告中心视频

- `/ingest/video/tiktok/normal`
  - 普通 TikTok 视频录入

- `/ingest/video/tiktok/ttcc`
  - TTCC 广告中心视频录入
  - Ad Shots 列表
  - 订阅入口

- `/ingest/video/youtube`
  - YouTube 视频录入

- `/ingest/article`
  - 文章录入
  - 搜索并录入

#### 2.4 生产

- `/production`
  - 分析报告
  - 社媒视频

- `/production/reports`
  - 报告列表
  - 报告生成

- `/production/social-video`
  - 社媒视频总入口

- `/production/social-video/script`
  - 脚本

- `/production/social-video/storyboard`
  - 静态分镜

- `/production/social-video/video`
  - 视频

#### 2.5 Agent

- `/agent`
  - 本地 agent 状态首页
  - 当前 agent tab 页
  - 底层系统

- `/agent/current`
  - 当前 agent 状态
  - 命令
  - 日志

- `/agent/system`
  - 底层系统页
  - 当前系统说明

---

## 3. 现有页面到新结构的迁移映射

### 3.1 现有页面

- `public/index.html`
- `public/ad-shots.html`
- `public/ad-shot-subscriptions.html`
- `public/article-view.html`
- `public/report-system.html`

### 3.2 映射建议

#### `public/index.html`

当前内容混合了：

- App 录入
- App 选择
- 视频录入
- 文章录入
- TikTok 搜索录入
- 结果库
- App 数据
- Agent 状态

迁移后拆成：

- 首页 `/`
- `/ingest/article`
- `/ingest/video`
- `/ingest/video/tiktok`
- `/ingest/video/youtube`
- `/apps/:appId`
- `/agent/current`

#### `public/ad-shots.html`

迁移到：

- `/ingest/video/tiktok/ttcc`

如果后续决定把它定义为素材库而不是录入页，可再补：

- `/library/ad-shots`

#### `public/ad-shot-subscriptions.html`

迁移到：

- `/ingest/video/tiktok/ttcc/subscriptions`

#### `public/article-view.html`

保留详情页性质，建议迁移到：

- `/articles/view.html?id=...`

或后续改成：

- `/articles/:id`

#### `public/report-system.html`

迁移到：

- `/agent/system`

---

## 4. 当前代码层面的主要问题

### 4.1 前端巨石文件

- `public/app.js`：2107 行
- `public/styles.css`：2239 行
- `public/index.html`：472 行
- `public/ad-shots.html`：1672 行

这说明页面、状态、交互、展示已经混在一起，继续加新层级会越来越难维护。

### 4.2 路由方式过平

当前静态路由逻辑：

- `/` -> `/index.html`
- 其他路径直接映射 `public/*`

说明现在是“文件名即页面”，缺少业务分层目录。

### 4.3 Agent 被塞进首页 tab

`Agent` 现在只是首页中的一个 tab，不是独立域。这和它的实际职责不匹配。

### 4.4 App 视角和工具视角没有分离

现在既有“录入流程”，也有“App 档案库”，但没有真正的 `App Dashboard` 页面。

---

## 5. 重构分期

### Phase 1：信息架构和页面外壳

目标：

- 建立新目录和 URL
- 建立统一 layout
- 不动现有 API

产出：

- 新增页面目录
- 新增统一导航
- 新增面包屑和页面头部

### Phase 2：首页和 App Dashboard

目标：

- 首页只保留导航和 app dashboard 入口
- 把“当前首页里的工作流”逐步搬走

产出：

- `/`
- `/apps/:appId` 的首版结构

### Phase 3：录入数据域拆分

目标：

- 把录入入口从首页剥离

产出：

- `/ingest`
- `/ingest/sensortower`
- `/ingest/video`
- `/ingest/video/tiktok`
- `/ingest/video/tiktok/normal`
- `/ingest/video/tiktok/ttcc`
- `/ingest/video/youtube`
- `/ingest/article`

### Phase 4：生产域拆分

目标：

- 把报告、脚本、分镜、视频生产独立出来

产出：

- `/production`
- `/production/reports`
- `/production/social-video`
- `/production/social-video/script`
- `/production/social-video/storyboard`
- `/production/social-video/video`

### Phase 5：Agent 域拆分

目标：

- Agent 从首页 tab 中完全移出

产出：

- `/agent`
- `/agent/current`
- `/agent/system`

### Phase 6：旧入口兼容和清理

目标：

- 保留旧链接可跳转
- 收掉首页 tab 结构
- 拆分巨石 JS / CSS

产出：

- 旧 URL 跳转策略
- 首页精简版
- 前端模块化拆分

---

## 6. 前端代码重组建议

### 6.1 页面文件目录

建议新增：

```text
public/
  index.html
  apps/
    dashboard.html
  ingest/
    index.html
    sensortower.html
    article.html
    video/
      index.html
      tiktok.html
      tiktok-normal.html
      tiktok-ttcc.html
      tiktok-ttcc-subscriptions.html
      youtube.html
  production/
    index.html
    reports.html
    social-video/
      index.html
      script.html
      storyboard.html
      video.html
  agent/
    index.html
    current.html
    system.html
```

### 6.2 JS 模块

建议把 `public/app.js` 拆成：

```text
public/js/
  core/
    api.js
    dom.js
    layout.js
    navigation.js
  apps/
    dashboard.js
    app-picker.js
  ingest/
    article.js
    video.js
    sensortower.js
    tiktok-batch.js
  production/
    reports.js
    social-video.js
  agent/
    status.js
  legacy/
    home-bridge.js
```

### 6.3 CSS

建议把 `public/styles.css` 拆成：

```text
public/styles/
  base.css
  layout.css
  components.css
  pages/
    home.css
    ingest.css
    app-dashboard.css
    production.css
    agent.css
    ad-shots.css
```

---

## 7. 路由策略建议

第一阶段不改 API，只改页面结构。

### 页面路由

继续沿用静态文件映射，但补业务目录：

- `/ingest` -> `/ingest/index.html`
- `/ingest/video` -> `/ingest/video/index.html`
- `/agent/system` -> `/agent/system.html`

这一步需要增强 `server/routes/static-routes.mjs`，让目录路径能自动补 `index.html`。

### API 路由

保持现状：

- `/api/apps`
- `/api/articles`
- `/api/results`
- `/api/ad-shots`
- `/api/agent/status`

先不一起改，避免把页面重构和后端协议改造绑死。

---

## 8. 第一批实际开工清单

第一批建议只做 3 件事：

1. 建立新的页面目录和静态路由能力
2. 新做统一站点 layout
3. 先拆出这 3 个页面
   - `/`
   - `/ingest`
   - `/agent/current`

这样做的好处是：

- 风险最低
- 最快能看到新结构成型
- 不会一上来就碰 Ad Shots 细节和复杂业务页

---

## 9. 第二批开工清单

第二批建议拆：

1. `/ingest/article`
2. `/ingest/video`
3. `/ingest/video/tiktok`
4. `/ingest/video/youtube`
5. `/ingest/video/tiktok/ttcc`

这一步完成后，首页基本就能从“工作台”退回“导航页”。

---

## 10. 决策建议

有一个点需要尽快定：

### Ad Shots 的业务归属

现在有两种定义方式：

1. 归到“录入数据 > 视频录入 > TikTok > TTCC”
2. 单独作为“素材库 / 广告库”

我的建议是：

- 第一阶段先归到录入域
- 等 App Dashboard 和 Production 域稳定后，再决定要不要独立出 `/library`

这样最省改动，也最贴近你现在的使用路径。
