# TT2Text

TT2Text 是一个本地 App 调研工作台，用来把 TikTok 视频、TikTok 评论、Sensor Tower 数据、App Store 信息和外部文章整理成可写报告的素材库。报告默认面向目标 App 所属类别的从业者，并兼顾相邻类别中关心产品机制、增长打法和商业化机会的人。

这个项目不是一个需要构建发布的前端工程。它的核心是：

- 本地 Node 服务：提供 WebUI、API、数据读写和任务队列。
- Chrome 扩展：在已登录的 Chrome 里采集 Sensor Tower、TikTok 搜索页和 TikTok 评论。
- Python 视频处理脚本：下载 TikTok 视频，转写音频，抽帧，调用 Codex 做翻译和视觉理解。
- 本地 JSON/文件目录：保存 App、视频、文章、评论、Sensor Tower CSV 和报告产物。

## 快速接手

```bash
cd tt2text
npm run agent:status
```

如果返回 `Local app: running at http://localhost:3000/`，说明本地服务已经在跑。当前机器上已经验证过：

- Node 可用。
- Python 3 可用。
- `ffmpeg` 可用。
- `yt-dlp` 可用。
- `codex` CLI 可用。
- macOS LaunchAgent `com.tt2text.agent` 已加载。

打开本地工作台：

```bash
npm run agent:open
```

或直接访问：

```text
http://localhost:3000/
```

## 安装与运行

`package.json` 当前没有第三方 npm 依赖，Node 代码只使用内置模块，所以没有 `npm install` 必需步骤。

常用命令：

```bash
npm run start
npm run agent:install
npm run agent:start
npm run agent:stop
npm run agent:restart
npm run agent:status
npm run agent:open
npm run agent:uninstall
```

Finder 友好的脚本也在项目根目录：

```text
install-agent.command
start-agent.command
stop-agent.command
uninstall-agent.command
```

这些 `.command` 文件会从自身位置解析项目目录，因此移动项目目录后仍然能工作。安装脚本会写入：

```text
~/Library/LaunchAgents/com.tt2text.agent.plist
```

日志位置：

```text
~/Library/Logs/tt2text/agent.out.log
~/Library/Logs/tt2text/agent.err.log
```

## 本地存储与代码分离

代码仓库不保存个人采集数据、生成报告、下载视频或缓存文件。默认本地存储目录是：

```text
~/Library/Application Support/TT2Text
```

服务会把这些运行时目录放到本地存储目录下：

```text
data/
reports/
sensor/
output/
```

如果要自定义位置：

```bash
TT2TEXT_STORAGE_DIR=~/TT2TextStorage npm run start
```

从旧项目目录迁移本地数据：

```bash
npm run storage:migrate
```

默认是复制模式。确认应用能正常读取后，可以用移动模式清理项目目录里的本地数据：

```bash
npm run storage:migrate:move
```

## 外部依赖

视频和图集处理依赖这些命令行工具：

- `python3`
- `ffmpeg`
- `yt-dlp`
- `codex`

Python 依赖不放在 `requirements.txt`。第一次转写视频时，`scripts/transcribe_translate.py` 会自动创建：

```text
.tools/venv/
.tools/whisper-cache/
```

并安装 `faster-whisper`。默认 Whisper 模型是 `small`，可用环境变量调整：

```bash
TT2TEXT_WHISPER_MODEL=medium npm run start
```

常用环境变量：

```text
TT2TEXT_STORAGE_DIR
TT2TEXT_WHISPER_MODEL
TT2TEXT_CODEX_BIN
TT2TEXT_CODEX_TIMEOUT
TT2TEXT_VIDEO_CONVERSION_TIMEOUT_MS
TT2TEXT_VISUAL_FRAME_INTERVAL
TT2TEXT_MAX_VISUAL_FRAMES
TT2TEXT_CODEX_RELEVANCE_TIMEOUT_MS
```

## 功能结构

### 本地服务

入口文件：

```text
server.mjs
```

主要职责：

- 提供 `public/` 下的 WebUI。
- 管理 App 列表、视频结果、文章、Sensor Tower 数据、TikTok 评论。
- 接收 Chrome 扩展导入的数据。
- 管理视频和图集处理队列。
- 调用 Python 脚本和 Codex CLI。

主要 API：

```text
GET  /api/apps
POST /api/apps
POST /api/apps/delete
GET  /api/results
POST /api/convert
POST /api/convert/batch
POST /api/results/delete
POST /api/results/visual-refresh
GET  /api/video-jobs
POST /api/video-jobs/retry
POST /api/video-jobs/retry-failed
POST /api/video-jobs/ignore-failed
GET  /api/articles
POST /api/articles
POST /api/articles/delete
GET  /api/app-metrics
POST /api/app-metrics/import
POST /api/app-metrics/delete
POST /api/sensortower-csv/import-path
POST /api/sensortower-csv/import-content
POST /api/tiktok-comments/import
GET  /api/agent/status
```

### WebUI

前端文件：

```text
public/index.html
public/app.js
public/styles.css
public/article-view.html
public/article-view.js
public/article-view.css
```

WebUI 支持：

- 添加 App Store App。
- 单条或批量导入 TikTok 视频。
- 查看视频转写、翻译、视觉理解、互动数据和评论状态。
- 导入文章并查看清洗后的文章内容。
- 查看 Sensor Tower overview 和 CSV 导入记录。
- 检查本地 agent 和 CLI 依赖状态。

### Chrome 扩展

目录：

```text
chrome-extension/
```

用途：

- 在 Sensor Tower 页面采集 overview 和 CSV。
- 在 TikTok 搜索页采集候选视频。
- 在 TikTok 视频页补采评论。
- 通过 `http://localhost:3000/*` 把数据写回本地服务。

加载方式：

```bash
npm run agent:open
```

然后在 Chrome 扩展页加载未打包扩展：

```text
./chrome-extension
```

当前扩展版本在 `chrome-extension/manifest.json` 中是 `0.7.1`。

## 数据结构

核心数据默认在本地存储目录的 `data/` 下，不在代码仓库里。这些文件是当前工作台状态，不是临时缓存。

```text
~/Library/Application Support/TT2Text/data/apps.json
~/Library/Application Support/TT2Text/data/results.json
~/Library/Application Support/TT2Text/data/video-jobs.json
~/Library/Application Support/TT2Text/data/articles.json
~/Library/Application Support/TT2Text/data/app-metrics.json
~/Library/Application Support/TT2Text/data/sensortower-csv.json
~/Library/Application Support/TT2Text/data/tiktok-comments.json
~/Library/Application Support/TT2Text/data/conversion-errors.jsonl
~/Library/Application Support/TT2Text/data/jobs/
~/Library/Application Support/TT2Text/data/article-bundles/
~/Library/Application Support/TT2Text/data/article-samples/
~/Library/Application Support/TT2Text/data/sensortower-csv/
```

## SQL 数据层

项目现在提供一个本地 SQLite 镜像数据库，用来把 JSON/CSV 素材转成更接近 Supabase/Postgres 的关系结构。原始长文本、HTML、视频、图片、CSV 和报告文件仍保留在本地目录，SQL 只保存结构化字段、可查询事实和文件路径。

同步命令：

```bash
npm run db:sync
```

默认生成：

```text
~/Library/Application Support/TT2Text/data/research.sqlite
```

Schema 文件：

```text
db/schema.sql
```

同步脚本：

```text
scripts/sync_sqlite.mjs
```

同步脚本默认读取 `data/`。如需用临时数据目录做 mock 或测试，可指定：

```bash
TT2TEXT_DATA_DIR=/private/tmp/tt2text-sql-mock-data node scripts/sync_sqlite.mjs /private/tmp/tt2text-sql-mock.sqlite
```

当前表：

```text
apps
app_metric_snapshots
sensor_csv_imports
sensor_rows
tiktok_results
tiktok_comments
articles
video_jobs
report_runs
```

当前视图：

```text
app_country_market_summary
app_country_review_summary
app_country_market_review_comparison
```

设计原则：

- `apps` 是主表，其他表通过 `app_id` 关联。
- Sensor Tower 原始 CSV 继续保留在 `sensor/`，全量解析行写入 `sensor_rows`。
- Sensor Tower reviews 行会写入 `sensor_rows`，并标注 `feedback_source`、`feedback_platform`、`feedback_type`、`os`。例如当前 MEEFF reviews 为 `sensortower / app_store / review / ios`。
- 国家维度的下载、收入、评论差异通过 SQL 视图汇总。报告优先查 `app_country_market_review_comparison`，对比收入头部国家、下载头部国家的评分、情绪和评论量差异。
- TikTok 视频/图集结果写入 `tiktok_results`，评论写入 `tiktok_comments`。
- 文章正文 markdown 和 raw HTML 不进 SQL，只在 `articles` 中记录 `clean_markdown_path`、`brief_markdown_path`、`manifest_path` 等路径。
- 未来迁移 Supabase 时，可复用这些表名和大部分字段；文件资产可迁到 Supabase Storage，SQL 继续存路径或 public URL。

当前数据量概览：

```text
data/apps.json              5 个 App
data/results.json           194 条视频/图集结果
data/video-jobs.json        203 个处理任务
data/articles.json          6 篇文章
data/app-metrics.json       1 条 Sensor Tower overview
data/sensortower-csv.json   6 条 Sensor Tower CSV 导入记录
data/tiktok-comments.json   15 条 TikTok 评论导入记录
```

当前 App：

```text
MEEFF  1064381508
Amata  6476193842
Amora  6748601088
Forum  6758308862
NGL    1596550932
```

### `data/apps.json`

App 基础信息，来自 App Store lookup/search。常见字段：

```text
id
name
fullName
logoUrl
appStoreUrl
bundleId
sellerName
createdAt
```

### `data/results.json`

视频和图集处理结果。常见字段：

```text
id
appId
app
sourceUrl
hyperlink
title
publishedAt
publishedText
engagement
transcriptEn
transcriptZh
sourceLanguage
sourceLanguageProbability
visualSummary
visualFramePaths
firstFramePath
commentsRaw
commentInsights
relevance
createdAt
```

互动数据通常在 `engagement` 中，包括播放、点赞、评论、分享等字段。WebUI 里如果没有展示某个指标，先检查 `data/results.json` 是否已经录入，再改前端展示。

### `data/jobs/`

每个视频/图集任务一个目录，目录名通常是 `YYYYMMDDHHMMSS-xxxxxx`。常见文件：

```text
metadata.json
video.info.json
video.mp4
video.mkv
audio.wav
first-frame.jpg
images/
visual-summary.txt
```

这些文件支撑结果复查、重新视觉理解和报告取证，不要为了“清理空间”直接删。

### `data/video-jobs.json`

任务队列和历史状态。常见字段：

```text
id
status
progress
stage
stageKey
stageHistory
sourceUrl
normalizedUrl
appId
app
resultId
error
retryCount
createdAt
updatedAt
```

失败任务可以在 WebUI 或 API 里重试。

### `data/articles.json` 和 `data/article-bundles/`

文章索引在 `data/articles.json`，正文 bundle 在 `data/article-bundles/<id>/`。

Bundle 结构遵循 `docs/article-ingestion-rules.md`：

```text
raw.html
manifest.json
clean.md
brief.md
assets/
ocr/
```

`clean.md` 是报告写作时最适合读的线性正文。

### `data/app-metrics.json`

Sensor Tower overview 的结构化采集记录。字段包括：

```text
id
source
sourceUrl
pageTitle
appName
appId
app
metrics
tables
filters
overview
folderPath
htmlPath
pageText
raw
collectedAt
```

对应的人工可读归档在 `sensor/<AppName>/overview/<id>/`。

### `data/sensortower-csv.json` 和 `sensor/`

CSV 导入索引在 `data/sensortower-csv.json`。实际 CSV 和 preview 存在：

```text
sensor/<AppName>/<id>/sensortower.csv
sensor/<AppName>/<id>/parsed-preview.json
```

当前 MEEFF 已导入下载、收入、使用时长/打开频次、人口属性等 CSV。报告里的硬数字优先从这些文件核对。

### `data/tiktok-comments.json`

TikTok 评论补采记录。常见字段：

```text
id
sourceUrl
normalizedUrl
resultId
appId
videoTitle
capturedAt
requestedExpandCount
actualExpandCount
itemCount
items
importedAt
updatedAt
```

`items` 是评论列表。部分结果也会合并到 `data/results.json` 的 `commentsRaw` 字段。

## 报告产物

当前重点报告在：

```text
reports/meeff-report.html
reports/meeff-report.md
reports/meeff-source-summary.json
reports/meeff-sensor-summary.json
```

浏览器当前打开的是：

```text
http://localhost:3000/reports/meeff-report.html
```

MEEFF 报告当前核心判断：

- 社交产品的安全、反诈、客服、举报是 60 分基本面，不是最终差异化。
- MEEFF 更值得看的 90 分部分，是让用户相信自己可能遇到平时生活里遇不到的人。
- 下载市场和收入市场可能不是同一批国家：拉美、东南亚、北非更像人群池和内容扩散市场；韩日港美土等市场更像收入市场。
- TikTok 内容和评论区要作为“用户怎么想象这类产品”的证据，而不是只罗列播放量。

用户偏好的报告话术：

- 说人话，少用抽象咨询词。
- 不要在正文里讲“我们怎么爬虫、CSV 怎么来”，这些放到底部数据来源。
- 先给判断，再给证据。
- 案例阈值要高：要么很多人表达同一观点，要么这个 case 细节特别真实。
- 不要把诈骗、广告、假号讲成最终结论，它们是社交产品基本面。

需要避免的表达：

```text
产品叙事
柔性入口
信任基础设施
增长飞轮
口径
CSV 显示
本地爬虫抓到
对做产品的人来说
```

## 已知问题

详见：

```text
BUGS.md
```

当前最重要的 deferred bug：

- TikTok 一级评论不能稳定深度加载。
- TikTok 二级评论的“查看 X 条回复”自动点击不稳定。
- 手动多滑到底部能看到灰色 skeleton 加载框，加载后会出现更多评论；自动化还没有稳定复现。

后续排查方向：

- 重新确认 TikTok 实际监听滚动的节点。
- 尝试更接近真人操作的滚轮输入，比如 Chrome Debugger Protocol/Input domain。
- 二级回复需要单独排查 `button`、外层容器、span-only 版本的点击事件链。

## 接手建议

1. 先跑 `npm run agent:status`，确认本地服务、LaunchAgent、CLI 依赖都正常。
2. 打开 `http://localhost:3000/`，看 WebUI 能否读出 App、视频、文章、指标。
3. 如果继续写 MEEFF 报告，优先读 `reports/meeff-report.html` 和 `reports/meeff-report.md`。
4. 如果需要核数，优先查 `data/research.sqlite`；国家下载、收入和评论差异查 `app_country_market_review_comparison`。
5. 如果需要看 TikTok 素材，优先查 `data/results.json`、`data/tiktok-comments.json` 和对应 `data/jobs/<id>/`。
6. 如果要改采集能力，先读 `server.mjs`、`public/app.js`、`chrome-extension/background-tiktok.js`、`chrome-extension/tiktok-search-collector.js`。
7. 不要随意删除 `data/`、`sensor/`、`reports/`、`报告参考/`，这些都是报告证据链的一部分。

## Git 注意事项

当前工作区有大量既有修改和未跟踪文件，包括 Chrome 扩展、WebUI、脚本、报告和采集数据。接手 agent 不要使用 `git reset --hard` 或 `git checkout --` 清理工作区，除非用户明确要求。
