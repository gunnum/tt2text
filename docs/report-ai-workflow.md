# App 报告 AI 生成工作流

这个工作流把报告模块拆成四步：

1. 录入数据：Sensor Tower CSV、榜单、paywall、文章、评论等先进入项目数据层。
2. 预清洗 source pack：按模块把可用数据整理成干净 JSON，写入 `reports/ai-source-packs/<App>/<module>.json`。
3. 生成 prompt：同目录写入 `<module>.prompt.md`，后续调 prompt 时直接复用。
4. 调 Agnes：读取 source pack + prompt，输出到 `reports/modules/<App>/<module>.md`。

## 当前已接入模块

- `anomaly_signal`：数据状态判断。
- `country_market_split`：国家市场分工。

其他模块会继续返回 `模块 prompt 待确认`，等 prompt 逐个确认后再接入同一套流程。

## 命令

只准备数据包和 prompt，不调用 Agnes：

```bash
node scripts/run_report_ai_module.mjs --app calai --module country_market_split --mode prepare
```

准备数据包、调用 Agnes、写入模块 Markdown：

```bash
node scripts/run_report_ai_module.mjs --app calai --module country_market_split --mode generate
```

模块 1 同理：

```bash
node scripts/run_report_ai_module.mjs --app calai --module anomaly_signal --mode generate
```

## 录入数据后是否要提前准备

需要。录入或更新 Sensor Tower CSV 后，建议先跑 `--mode prepare`。这样可以提前发现：

- 国家下载 / 收入 CSV 有没有配齐。
- 收入 CSV 是否被误识别。
- 时间窗是否仍是近 12 个月。
- source pack 里有没有足够字段给 prompt 使用。

真正调 Agnes 验证 prompt 时，就只需要读取已经清洗好的 source pack，不再临时拼数据。

## 后续接新模块

每个新模块只补两块：

- `sourcePack`：这个模块需要的干净输入数据。
- `prompt`：这个模块确认过的写作规则和输出 JSON 结构。

服务端、CLI、报告页面会自动复用同一套调用和落盘流程。
