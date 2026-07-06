# 工程说明文档索引

这个索引用来把项目里散落的工程说明文档集中到一起。后续新增架构、数据源、采集流程或报告模块文档，优先挂到这里。

## 项目入口

- `README.md`：项目启动、依赖、基础使用方式。
- `docs/local-agent.md`：本地 Agent 安装、启动、停止和日志位置。
- `docs/article-ingestion-rules.md`：文章入库和来源处理规则。

## 报告与分析能力

- `docs/app-report-modules.md`：当前确定的 App 分析报告模块、信息源分工和边界。
- `docs/report-ai-workflow.md`：App 报告模块的 source pack 预清洗、prompt 生成和 Agnes 调用流程。
- `docs/vision-analysis-provider.md`：视频抽帧视觉理解的 Agnes / Codex CLI 开关。
- `docs/wechat-article-mindmap-outlines.md`：微信公众号文章结构拆解和脑图产物。

## 站点与页面改造

- `docs/site-restructure-plan.md`：站点重构规划。
- `docs/site-page-migration-map.md`：页面迁移映射。
- `public/legacy/README.md`：旧页面保留说明。

## 子项目与报告材料

- `doubao-voice-playground/README.md`：豆包语音实验子项目说明。
- `reports/ad-shots-prd.md`：Ad Shots 产品需求与分析材料。
- `reports/reading-tt-top-videos.md`：TikTok Top Videos 阅读材料。
- `reports/meeff-report.md`：MEEFF 报告样例。

## 维护规则

- 新增开发文档放在 `docs/`，除非它是某个独立子项目的 README。
- 新增报告样例放在 `reports/`。
- 涉及环境变量、外部 API、CLI 行为的文档，需要写明默认值、切换方式和失败边界。
