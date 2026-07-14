import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  GENERIC_JUDGMENT_PATTERNS,
  MODULE_QUALITY_MARKERS,
  REPORT_OUTPUT_TEMPLATE_VERSION,
  REQUIRED_OUTPUT_SECTIONS,
  REQUIRED_MINDMAP_BRANCHES,
  MODULE_DRILLDOWN_REQUIRED_PREFIXES,
  EVIDENCE_ID_PATTERN_SOURCE,
  REPORT_OUTPUT_MODULE_IDS,
  assertReportOutputQualityContract,
  buildReportOutputQualityContractSummary,
  validateReportOutputMetaContract
} from "./report-output-quality-rules.mjs";
import {
  createReportAiWorkflow
} from "./report-ai-workflow.mjs";
import {
  dedupeSensorTowerCsvImports
} from "./sensortower-dedupe.mjs";

const MODULE_DEFINITIONS = [
  {
    id: "anomaly_signal",
    title: "数据状态判断",
    description: "只基于市场数据判断这个 App 当前的数据状态：规模、趋势、榜单位置和国家分布。",
    requirements: [
      { source: "marketData", min: 1, label: "市场/规模数据" }
    ]
  },
  {
    id: "market_overview",
    title: "市场表现概览",
    description: "整理下载、收入、活跃、评论等 Sensor Tower 数据覆盖。",
    requirements: [
      { source: "sensorImports", min: 2, label: "Sensor Tower CSV 数据" }
    ]
  },
  {
    id: "country_market_split",
    title: "国家市场分工",
    description: "整理下载国家、收入国家、RPD 和收入/下载错配。",
    requirements: [
      { source: "countryMarketSources", min: 1, label: "国家级下载/收入数据" }
    ]
  },
  {
    id: "category_competitors",
    title: "垂类竞品榜",
    description: "基于 Sensor Tower 同品类榜单列出竞品位置、规模和未入库对象。",
    requirements: [
      { source: "categoryRankings", min: 1, label: "ST 垂类竞品榜" }
    ]
  },
  {
    id: "user_pain_points",
    title: "用户痛点",
    description: "结合商店 feature 图、评论、TikTok 和文章，判断它满足了用户什么痛点。",
    requirements: [
      { source: "painPointSources", min: 2, label: "商店图、评论、TT、文章或体验文档" }
    ]
  },
  {
    id: "experience",
    title: "产品体验实测",
    description: "承接你手写的体验 Markdown，并结合素材补体验证据。",
    requirements: [
      { source: "experienceDocs", min: 1, label: "体验 Markdown" }
    ],
    optionalRequirements: [
      { source: "ttVideos", min: 3, label: "TT 素材" }
    ]
  },
  {
    id: "growth_signals",
    title: "增长素材与传播信号",
    description: "基于 TT 素材和评论整理 hook、演示动作、用户反馈和传播切口。",
    requirements: [
      { source: "ttVideos", min: 5, label: "TT 素材" }
    ],
    optionalRequirements: [
      { source: "ttComments", min: 20, label: "TT 评论" }
    ]
  },
  {
    id: "paid_points",
    title: "付费点与价格结构",
    description: "基于 paywall、付费权益和高付费市场判断它卖什么、锁什么、哪里更愿意付费。",
    requirements: [
      { source: "paidPointSources", min: 1, label: "paywall、收入或国家 RPD" }
    ]
  },
  {
    id: "user_reviews",
    title: "用户评论与口碑",
    description: "整理用户喜欢什么、抱怨什么，以及评论里暴露出的风险信号。",
    requirements: [
      { source: "userVoice", min: 30, label: "商店评论或 TT 评论" }
    ]
  },
  {
    id: "founder_company",
    title: "创始人 / 公司 / 融资背景",
    description: "从已录入文章和 PR 稿里提取公司、创始人、融资、收购或转型线索。",
    requirements: [
      { source: "companySources", min: 1, label: "公司/创始人/融资相关文章" }
    ]
  }
];

if (JSON.stringify(MODULE_DEFINITIONS.map((item) => item.id)) !== JSON.stringify(REPORT_OUTPUT_MODULE_IDS)) {
  throw new Error("REPORT_OUTPUT_MODULE_IDS 与 MODULE_DEFINITIONS 不一致");
}
assertReportOutputQualityContract(MODULE_DEFINITIONS.map((item) => item.id));

const THEME_PATTERNS = [
  {
    id: "value",
    title: "效果 / 价值感",
    pattern: /works?|useful|helpful|accurate|accuracy|result|results|love|great|amazing|worth|value|效果|有用|准确|準確|好用|值得|改善|成功|結果|가치|정확|funciona|útil/i
  },
  {
    id: "ads",
    title: "广告 / 商业化打扰",
    pattern: /\bads?\b|\badds\b|\badvert|广告|廣告|реклама|an[uú]ncio|anuncios|광고|annunci|\bpay\b|\bpaid\b|\$|subscription|订阅|付费|收费|expensive|price|publicidad/i
  },
  {
    id: "account",
    title: "账号 / 登录 / 误封",
    pattern: /ban|banned|blocked|account protection|log.?out|login|로그|차단|封禁|封号|禁止|登入|登录|bloquead/i
  },
  {
    id: "bugs",
    title: "功能 bug / 性能问题",
    pattern: /loading|load|bug|glitch|crash|freeze|slow|lag|error|notification|vpn|cache|sync|login|scan|camera|photo|picture|照片|图片|相机|掃描|扫描|轉圈|转圈|通知|오류|버그|에러|сообщ|фото/i
  },
  {
    id: "onboarding",
    title: "上手 / 核心流程摩擦",
    pattern: /onboarding|sign.?up|register|login|permission|hard to use|confusing|can't use|cannot use|tutorial|setup|注册|登录|登入|权限|不会用|难用|複雜|复杂|教程|설정|가입|로그인|confuso/i
  },
  {
    id: "core_task",
    title: "核心任务完成",
    pattern: /track|tracking|scan|scanner|log|logging|count|counter|plan|goal|routine|coach|reminder|meal|calorie|nutrition|diet|workout|sleep|habit|记录|追踪|扫描|計算|计算|计划|目标|提醒|饮食|熱量|热量|营养|减重|健身|习惯/i
  },
  {
    id: "ai",
    title: "AI 体验 / 自动化可信度",
    pattern: /\bAI\b|bot|algorithm|recommend|recognize|recognition|estimate|智能|识别|識別|推荐|估算|算法|机器人|자동|추천/i
  }
];

export function createReportOutputService(deps = {}) {
  const requiredDeps = [
    "projectRootDir",
    "readApps",
    "readArticles",
    "readAppMetrics",
    "readAppPaywalls",
    "readSensorTowerCsvImports",
    "readResults",
    "readTikTokCommentsRaw",
    "normalizeText",
    "truncateText"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createReportOutputService 缺少依赖：${dep}`);
    }
  }
  const reportAiWorkflow = createReportAiWorkflow({
    projectRootDir: deps.projectRootDir,
    reportsDir: deps.reportsDir,
    normalizeText: deps.normalizeText,
    truncateText: deps.truncateText
  });
  const reportsDir = deps.reportsDir || path.join(deps.projectRootDir, "reports");
  const storageRootDir = deps.storageRootDir || path.dirname(reportsDir);

  async function buildReportOutputOverview() {
    const context = await loadContext();
    return {
      generatedAt: new Date().toISOString(),
      apps: context.apps.map((app) => {
        const material = buildAppMaterial(app, context);
        const qualitySummary = buildQualitySummary(material.modules);
        return {
          app,
          sources: material.sources,
          readyModuleCount: material.modules.filter((item) => item.status === "ready").length,
          totalModuleCount: material.modules.length,
          qualitySummary,
          modules: material.modules
        };
      }).sort((a, b) => b.readyModuleCount - a.readyModuleCount || b.sources.total - a.sources.total)
    };
  }

  async function buildAppReportOutput(appId) {
    const context = await loadContext();
    const app = context.apps.find((item) => normalizeText(item.id) === normalizeText(appId));
    if (!app) {
      throw new Error("APP_NOT_FOUND");
    }
    const qiaomu = await loadQiaomuInsights(app);
    const material = buildAppMaterial(app, context, { qiaomu });
    return {
      generatedAt: new Date().toISOString(),
      app,
      sources: material.sources,
      qualitySummary: buildQualitySummary(material.modules),
      categoryRanking: material.categoryRanking,
      qiaomuOutput: material.qiaomuOutput,
      modules: material.modules
    };
  }

  async function buildAppCategoryRankingOutput(appId) {
    const context = await loadContext();
    const app = context.apps.find((item) => normalizeText(item.id) === normalizeText(appId));
    if (!app) {
      throw new Error("APP_NOT_FOUND");
    }
    const ranking = findLatestCategoryRanking(context.sensorImports, app.id);
    return {
      generatedAt: new Date().toISOString(),
      app,
      categoryRanking: ranking
    };
  }

  async function generateAppReportModule(appId, moduleId) {
    const context = await loadContext();
    const app = context.apps.find((item) => normalizeText(item.id) === normalizeText(appId));
    if (!app) {
      throw new Error("APP_NOT_FOUND");
    }

    const definition = MODULE_DEFINITIONS.find((item) => item.id === normalizeText(moduleId));
    if (!definition) {
      throw new Error("MODULE_NOT_FOUND");
    }

    const material = buildAppMaterial(app, context, { qiaomu: await loadQiaomuInsights(app) });
    const module = material.modules.find((item) => item.id === definition.id);
    if (!module) {
      throw new Error("MODULE_NOT_FOUND");
    }
    if (module.status !== "ready") {
      const error = new Error("MODULE_BLOCKED");
      error.module = module;
      throw error;
    }

    return generateReadyModuleOutput(app, definition, module, material);
  }

  async function prepareAppReportModuleAi(appId, moduleId) {
    const context = await loadContext();
    const app = context.apps.find((item) => normalizeText(item.id) === normalizeText(appId));
    if (!app) {
      throw new Error("APP_NOT_FOUND");
    }

    const definition = MODULE_DEFINITIONS.find((item) => item.id === normalizeText(moduleId));
    if (!definition) {
      throw new Error("MODULE_NOT_FOUND");
    }

    const material = buildAppMaterial(app, context, { qiaomu: await loadQiaomuInsights(app) });
    const module = material.modules.find((item) => item.id === definition.id);
    if (!module) {
      throw new Error("MODULE_NOT_FOUND");
    }
    if (module.status !== "ready") {
      const error = new Error("MODULE_BLOCKED");
      error.module = module;
      throw error;
    }

    const deterministicAnalysis = buildDeterministicModuleAnalysis(definition, app, material.sources, material.evidence, {
      generatedAt: new Date().toISOString()
    });
    return reportAiWorkflow.prepareModule({
      definition,
      app,
      counts: material.sources,
      evidence: material.evidence,
      deterministicAnalysis,
      sourceFingerprint: module.sourceFingerprint
    });
  }

  async function generateAppReportModules(appId, options = {}) {
    const context = await loadContext();
    const app = context.apps.find((item) => normalizeText(item.id) === normalizeText(appId));
    if (!app) {
      throw new Error("APP_NOT_FOUND");
    }

    const material = buildAppMaterial(app, context, { qiaomu: await loadQiaomuInsights(app) });
    const generated = [];
    const skipped = [];
    const failed = [];

    for (const module of material.modules) {
      if (module.status !== "ready") {
        skipped.push({ id: module.id, title: module.title, status: module.status, missingSummary: module.missingSummary });
        continue;
      }

      if (options.skipExisting !== false && moduleHasFreshAiMarkdown(module)) {
        skipped.push({ id: module.id, title: module.title, status: "done", reason: "已有最新 Agnes 洞察" });
        continue;
      }

      const definition = MODULE_DEFINITIONS.find((item) => item.id === module.id);
      try {
        generated.push(await generateReadyModuleOutput(app, definition, module, material));
      } catch (error) {
        failed.push({
          id: module.id,
          title: module.title,
          error: error instanceof Error ? error.message : String(error || "生成失败")
        });
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      app,
      generatedCount: generated.length,
      failedCount: failed.length,
      skippedCount: skipped.length,
      generated,
      failed,
      skipped
    };
  }

  function moduleHasFreshAiMarkdown(module = {}) {
    return Boolean(module.reportMarkdownPath && !module.needsUpdate && module.aiStatus === "ready");
  }

  async function generateReadyModuleOutput(app, definition, module, material) {
    const generatedAt = new Date().toISOString();
    const deterministicAnalysis = buildDeterministicModuleAnalysis(definition, app, material.sources, material.evidence, { generatedAt });
    const aiInsights = sanitizeModuleAiInsights(
      await generateModuleAiInsights(definition, app, material.sources, material.evidence, deterministicAnalysis, module.sourceFingerprint),
      deterministicAnalysis.evidenceLedger
    );
    const standardMarkdown = renderModuleMarkdown(deterministicAnalysis, { aiInsights });
    const reportMarkdown = buildReportMarkdown(aiInsights, standardMarkdown, definition, app);
    const markdown = renderModuleDebugMarkdown(definition, app, material.sources, material.evidence, deterministicAnalysis.evidenceLedger, aiInsights, reportMarkdown, generatedAt);
    const citations = buildModuleCitations(deterministicAnalysis.evidenceLedger);
    const output = await writeModuleMarkdown(app, definition, markdown, {
      moduleId: definition.id,
      appId: normalizeText(app.id),
      generatedAt,
      sourceFingerprint: module.sourceFingerprint,
      aiStatus: aiInsights?.available ? "ready" : "unavailable",
      aiError: aiInsights?.error || "",
      provider: aiInsights?.provider || "",
      model: aiInsights?.model || "",
      aiSourcePackPath: aiInsights?.sourcePackPath || "",
      aiPromptPath: aiInsights?.promptPath || "",
      templateVersion: REPORT_OUTPUT_TEMPLATE_VERSION,
      qualityContract: buildReportOutputQualityContractSummary(definition.id),
      citations,
      sourceSummary: buildModuleSourceSummary(definition.id, material.sources, material.evidence),
      markdownPath: moduleMarkdownPublicPath(app, definition),
      reportMarkdownPath: moduleReportMarkdownPublicPath(app, definition),
      mindmapPath: moduleMindmapPublicPath(app, definition)
    }, { reportMarkdown });
    return {
      ...module,
      generationStatus: "done",
      generatedAt,
      markdown,
      reportMarkdown,
      markdownPath: output.publicPath,
      markdownFilePath: output.filePath,
      reportMarkdownPath: output.reportPublicPath,
      reportMarkdownFilePath: output.reportPath,
      mindmapPath: output.mindmapPublicPath,
      mindmapFilePath: output.mindmapPath,
      aiStatus: aiInsights?.available ? "ready" : "unavailable",
      aiError: aiInsights?.error || "",
      citations,
      qualityStatus: output.quality.status,
      qualityIssues: output.quality.issues,
      freshness: "fresh",
      needsUpdate: false
    };
  }

  async function loadContext() {
    const [apps, articles, articleAppLinks, appMetrics, appPaywalls, sensorImports, results, adShots, tiktokCommentImports, pluginDebugLogs] = await Promise.all([
      deps.readApps(),
      deps.readArticles(),
      deps.readArticleAppLinks ? deps.readArticleAppLinks() : [],
      deps.readAppMetrics(),
      deps.readAppPaywalls(),
      deps.readSensorTowerCsvImports(),
      deps.readResults(),
      deps.readAdShots ? deps.readAdShots() : [],
      deps.readTikTokCommentsRaw(),
      deps.readPluginDebugLogs ? deps.readPluginDebugLogs() : []
    ]);
    return {
      apps,
      articles,
      articleAppLinks,
      appMetrics,
      appPaywalls,
      sensorImports,
      results,
      adShots,
      tiktokCommentImports,
      pluginDebugLogs
    };
  }

  async function loadQiaomuInsights(app) {
    if (!deps.fetchQiaomuReviewInsights) {
      return {
        available: false,
        status: "not_configured",
        error: "未配置 qiaomu 评论洞察服务。"
      };
    }
    try {
      const payload = await deps.fetchQiaomuReviewInsights(app.id, { app, max: 120, lightweight: true });
      const counts = countQiaomuPayload(payload);
      return {
        available: counts.total > 0,
        status: counts.total > 0 ? "ready" : "empty",
        counts,
        payload
      };
    } catch (error) {
      return {
        available: false,
        status: "failed",
        error: error instanceof Error ? error.message : String(error || "qiaomu 请求失败")
      };
    }
  }

  function buildAppMaterial(app, context, options = {}) {
    const appId = normalizeText(app.id);
    const articles = resolveArticlesForApp(context.articles, context.articleAppLinks, appId);
    const appMetrics = context.appMetrics.filter((item) => recordAppId(item) === appId);
    const latestOverview = findLatestOverview(appMetrics);
    const appReleaseSignals = buildAppReleaseSignals(app, latestOverview);
    const storeScreenshots = normalizeStoreScreenshots(latestOverview?.overview?.screenshots || latestOverview?.overview?.screenshots_json || []);
    const paywall = (context.appPaywalls || []).find((item) => normalizeText(item.appId) === appId) || null;
    const paywallSamples = normalizePaywallSamples(paywall);
    const sensorImports = dedupeSensorTowerCsvImports(context.sensorImports.filter((item) => recordAppId(item) === appId)).unique;
    const categoryRanking = annotateCategoryRankingWithLocalApps(findLatestCategoryRanking(sensorImports, appId), context.apps);
    const countryMarket = buildCountryMarketSummary(sensorImports);
    const marketMetrics = buildMarketDataStatusMetrics(sensorImports, categoryRanking, countryMarket, appId);
    const results = context.results.filter((item) => recordAppId(item) === appId);
    const adShots = (context.adShots || []).filter((item) => recordAppId(item) === appId).map(normalizeAdShotVideoRecord);
    const videos = [...results, ...adShots];
    const tiktokCommentImports = context.tiktokCommentImports.filter((item) => recordAppId(item) === appId);
    const tiktokComments = flattenTikTokComments(tiktokCommentImports);
    const reviewImport = latestImportByType(sensorImports, "reviews");
    const reviewCorpus = dedupeReviewRows(readFullCsvRows(reviewImport).map(normalizeReviewSample).filter((item) => item.text));
    const reviewSamples = selectRepresentativeReviewSamples(reviewCorpus, 25);
    const articleSamples = articles.slice(0, 6).map(normalizeArticleEvidenceSample);
    const companyArticleSamples = selectFounderCompanyArticles(articles).map(normalizeArticleEvidenceSample);
    const videoCorpus = buildVideoCorpus(app, videos);
    const videoSamples = [...videoCorpus.relevant]
      .sort((a, b) => numericEngagement(b, "viewCount") - numericEngagement(a, "viewCount"))
      .slice(0, 16)
      .map(normalizeVideoSample);
    const noisyVideoSamples = [...videoCorpus.noisy]
      .sort((a, b) => numericEngagement(b, "viewCount") - numericEngagement(a, "viewCount"))
      .slice(0, 8)
      .map(normalizeVideoSample);
    const ttCommentSamples = tiktokComments
      .sort((a, b) => Number(b.likeCount || 0) - Number(a.likeCount || 0))
      .slice(0, 12)
      .map((item) => ({
        text: truncateText(normalizeText(item.text || item.rawText), 180),
        rawText: normalizeText(item.rawText || item.text),
        zhText: normalizeText(item.zhText || item.translationZh || item.textZh),
        enText: normalizeText(item.enText || item.translationEn || item.textEn),
        videoTitle: truncateText(normalizeText(item.videoTitle), 80),
        likeCount: Number(item.likeCount || 0)
      }))
      .filter((item) => item.text);
    const qiaomuOutput = buildQiaomuOutput(app, options.qiaomu);
    const themeSummary = buildThemeSummary([
      ...reviewCorpus.map((item) => item.text),
      ...tiktokComments.map((item) => item.text || item.rawText),
      ...videoCorpus.relevant.map((item) => `${item.title || ""} ${item.transcriptZh || ""} ${item.visualSummary || ""}`)
    ]);
    const experienceDocs = findExperienceDocs(app);
    const dataTypes = uniqueStrings(sensorImports.map((item) => normalizeText(item.dataType)).filter(Boolean));
    const sensorNoDataSignals = buildSensorTowerNoDataSignals(sensorImports);
    const sensorFailureSignals = buildSensorTowerFailureSignals(context.pluginDebugLogs, app);
    const sourceCounts = {
      appProfile: 1,
      articles: articles.length,
      appMetrics: appMetrics.length,
      sensorImports: sensorImports.length,
      sensorNoData: sensorNoDataSignals.length,
      sensorFailures: sensorFailureSignals.length,
      categoryRankings: categoryRanking ? 1 : 0,
      categoryRankingRows: categoryRanking?.rows?.length || 0,
      countryMarketSources: countryMarket.rows.length ? 1 : 0,
      countryMarketRows: countryMarket.rows.length,
      storeScreenshots: storeScreenshots.length,
      paywalls: paywallSamples.length,
      marketData: sensorImports.filter((item) => ["downloads", "revenue", "active_usage", "active_users"].includes(normalizeText(item.dataType))).length + appMetrics.length,
      reviewImports: sensorImports.filter((item) => normalizeText(item.dataType) === "reviews").length,
      reviewRows: reviewCorpus.length,
      reviewSamples: reviewSamples.length,
      reviewCorpus: reviewCorpus.length,
      ttVideosRaw: videos.length,
      ttVideos: videoCorpus.relevant.length,
      ttVideosNoisy: videoCorpus.noisy.length,
      ttComments: tiktokComments.length,
      tiktokCommentImports: tiktokCommentImports.length,
      qiaomuInsights: qiaomuOutput.available ? 1 : 0,
      experienceDocs: experienceDocs.length,
      signalSources: countPositive([articles.length, videos.length, reviewCorpus.length + tiktokComments.length, appMetrics.length]),
      painPointSources: countPositive([articles.length, videos.length, reviewCorpus.length + tiktokComments.length, storeScreenshots.length, experienceDocs.length]),
      userVoice: reviewCorpus.length + tiktokComments.length,
      paidPointSources: countPositive([
        paywallSamples.length,
        sensorImports.filter((item) => normalizeText(item.dataType) === "revenue").length,
        countryMarket.rows.filter((item) => item.revenuePerDownloadUsd > 0).length
      ]),
      companySources: articles.filter((item) => /创始人|founder|融资|funding|raised|acquired|收购|公司|developer|CEO|PR|press|上市|估值|valuation/i.test(`${item.title || ""} ${item.excerpt || ""}`)).length,
      riskSources: (themeSummary.find((item) => item.id === "safety")?.count || 0)
        + (themeSummary.find((item) => item.id === "account")?.count || 0)
        + (themeSummary.find((item) => item.id === "bugs")?.count || 0)
    };
    sourceCounts.total = sourceCounts.articles + sourceCounts.sensorImports + sourceCounts.ttVideos + sourceCounts.ttComments + sourceCounts.experienceDocs + sourceCounts.appMetrics;

    const evidence = {
      dataTypes,
      articleSamples,
      companyArticleSamples,
      appReleaseSignals,
      videoSamples,
      noisyVideoSamples,
      videoRelevance: videoCorpus.summary,
      reviewCorpus,
      reviewSamples: reviewSamples.slice(0, 12),
      reviewRatingBreakdown: buildReviewRatingBreakdown(reviewCorpus),
      ttCommentSamples,
      themeSummary,
      storeScreenshots,
      paywallSamples,
      sensorNoDataSignals,
      sensorFailureSignals,
      categoryRanking: categoryRanking ? {
        categoryName: categoryRanking.categoryName,
        dateRange: categoryRanking.dateRange,
        summary: categoryRanking.summary,
        rows: categoryRanking.rows.slice(0, 50)
      } : null,
      countryMarket,
      marketMetrics,
      experienceDocs: experienceDocs.map((item) => ({
        title: item.title,
        path: item.path,
        relativePath: item.relativePath,
        modifiedAt: item.modifiedAt,
        size: item.size,
        excerpt: item.excerpt,
        headings: item.headings
      })),
      sensorImports: sensorImports.map((item) => ({
        id: normalizeText(item.id || item.importId || item.sourcePath || item.parsedPath),
        dataType: normalizeText(item.dataType),
        rowCount: Number(item.rowCount || 0),
        dateRange: item.dateRange || {},
        importedAt: normalizeText(item.importedAt),
        sourcePath: normalizeText(item.sourcePath || item.csvPath || item.originalPath),
        parsedPath: normalizeText(item.parsedPath)
      }))
    };
    const modules = MODULE_DEFINITIONS.map((definition) => buildModule(definition, app, sourceCounts, evidence));
    return {
      sources: sourceCounts,
      qiaomuOutput,
      categoryRanking,
      evidence,
      modules
    };
  }

  function resolveArticlesForApp(articles = [], links = [], appId = "") {
    const targetAppId = normalizeText(appId);
    const linkedArticleIds = new Set();
    const linkedUrls = new Set();
    for (const link of links || []) {
      if (normalizeText(link.appId) !== targetAppId) continue;
      const articleId = normalizeText(link.articleId);
      const sourceUrl = normalizeText(link.sourceUrl);
      if (articleId) linkedArticleIds.add(articleId);
      if (sourceUrl) linkedUrls.add(sourceUrl);
    }
    const selected = [];
    const seen = new Set();
    for (const article of articles || []) {
      const direct = recordAppId(article) === targetAppId;
      const linked = linkedArticleIds.has(normalizeText(article.id)) || linkedUrls.has(normalizeText(article.sourceUrl));
      if (!direct && !linked) continue;
      const key = normalizeText(article.sourceUrl) || normalizeText(article.id);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      selected.push(article);
    }
    return selected;
  }

  function annotateCategoryRankingWithLocalApps(ranking, apps = []) {
    if (!ranking?.rows?.length) return ranking;
    return {
      ...ranking,
      rows: ranking.rows.map((row) => {
        const local = findLocalAppForRankingRow(row, apps);
        return {
          ...row,
          localAppId: local?.id || "",
          localAppName: local ? displayAppName(local) : ""
        };
      })
    };
  }

  function findLocalAppForRankingRow(row = {}, apps = []) {
    const rowIds = [row.appId, row.unifiedId].map(normalizeText).filter(Boolean);
    const rowNames = [row.appName, row.unifiedName].map(normalizeLooseName).filter(Boolean);
    return apps.find((app) => {
      const appIds = [app.id, app.appStoreId, app.bundleId].map(normalizeText).filter(Boolean);
      if (rowIds.some((id) => appIds.includes(id))) return true;
      const appNames = [app.name, app.fullName].map(normalizeLooseName).filter(Boolean);
      return rowNames.some((name) => appNames.some((candidate) => candidate === name || candidate.includes(name) || name.includes(candidate)));
    }) || null;
  }

  function normalizeLooseName(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
  }

  function buildModule(definition, app, counts, evidence) {
    const required = definition.requirements.map((requirement) => {
      const current = Number(counts[requirement.source] || 0);
      return {
        ...requirement,
        current,
        missing: Math.max(0, requirement.min - current),
        met: current >= requirement.min
      };
    });
    const optional = (definition.optionalRequirements || []).map((requirement) => {
      const current = Number(counts[requirement.source] || 0);
      return {
        ...requirement,
        current,
        missing: Math.max(0, requirement.min - current),
        met: current >= requirement.min
      };
    });
    const status = required.every((item) => item.met) ? "ready" : "blocked";
    const sourceFingerprint = buildModuleSourceFingerprint(definition, app, counts, evidence);
    const generated = readModuleMarkdown(app, definition, sourceFingerprint);
    const ledgerCitations = buildModuleCitations(buildEvidenceLedger(definition.id, evidence));
    const citations = mergeModuleCitations(generated?.meta?.citations, ledgerCitations);
    const template = definition.id === "experience" ? ensureExperienceTemplate(app, counts, evidence) : null;
    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      status,
      generationStatus: generated ? "done" : "not_started",
      freshness: generated?.freshness || "missing",
      needsUpdate: Boolean(generated?.needsUpdate),
      sourceFingerprint,
      generatedAt: generated?.generatedAt || "",
      markdownPath: generated?.publicPath || "",
      reportMarkdownPath: generated?.reportPublicPath || generated?.meta?.reportMarkdownPath || "",
      mindmapPath: generated?.mindmapPublicPath || generated?.meta?.mindmapPath || "",
      metaPath: generated?.metaPublicPath || "",
      aiStatus: generated?.meta?.aiStatus || "",
      aiError: generated?.meta?.aiError || "",
      qualityStatus: generated?.quality?.status || (generated ? "unknown" : "missing"),
      qualityIssues: generated?.quality?.issues || [],
      qualityContract: summarizeQualityContract(generated?.meta?.qualityContract || buildReportOutputQualityContractSummary(definition.id)),
      citations,
      templatePath: template?.publicPath || "",
      templateFilePath: template?.filePath || "",
      targetExperiencePath: template?.targetPublicPath || "",
      targetExperienceFilePath: template?.targetFilePath || "",
      required,
      optional,
      missingSummary: required.filter((item) => !item.met).map((item) => `还差 ${item.missing} 个${item.label}`).join("；"),
      markdown: generated?.markdown || "",
      reportMarkdown: generated?.reportMarkdown || "",
      blockedMarkdown: status === "ready" ? "" : buildBlockedMarkdown(definition, app, required, optional),
      reviewVisual: definition.id === "user_reviews" ? buildUserReviewVisualData(evidence) : null
    };
  }

  function buildQualitySummary(modules = []) {
    const ready = modules.filter((item) => item.status === "ready");
    const done = ready.filter((item) => item.generationStatus === "done");
    const fresh = ready.filter((item) => item.freshness === "fresh");
    const stale = ready.filter((item) => item.needsUpdate);
    const passed = ready.filter((item) => item.qualityStatus === "passed");
    const failed = ready.filter((item) => item.qualityStatus === "failed");
    const blocked = modules.filter((item) => item.status !== "ready");
    const aiReady = ready.filter((item) => item.aiStatus === "ready");
    const aiUnavailable = ready.filter((item) => item.aiStatus === "unavailable");
    return {
      total: modules.length,
      ready: ready.length,
      done: done.length,
      fresh: fresh.length,
      stale: stale.length,
      passed: passed.length,
      failed: failed.length,
      blocked: blocked.length,
      aiReady: aiReady.length,
      aiUnavailable: aiUnavailable.length,
      staleModuleIds: stale.map((item) => item.id),
      failedModuleIds: failed.map((item) => item.id),
      blockedModuleIds: blocked.map((item) => item.id),
      aiUnavailableModuleIds: aiUnavailable.map((item) => item.id)
    };
  }

  function summarizeQualityContract(contract = {}) {
    return {
      name: normalizeText(contract.name),
      templateVersion: Number(contract.templateVersion || 0),
      requiredSectionCount: Number(contract.requiredSectionCount || 0),
      requiredArtifacts: Array.isArray(contract.requiredArtifacts) ? contract.requiredArtifacts : [],
      requiredMindmapBranches: Array.isArray(contract.requiredMindmapBranches) ? contract.requiredMindmapBranches : [],
      drilldownEvidencePrefixes: Array.isArray(contract.drilldownEvidencePrefixes) ? contract.drilldownEvidencePrefixes : [],
      moduleQualityMarkers: Array.isArray(contract.moduleQualityMarkers) ? contract.moduleQualityMarkers : []
    };
  }

  function buildMarkdown(moduleId, app, counts, evidence, options = {}) {
    const definition = MODULE_DEFINITIONS.find((item) => item.id === moduleId);
    if (!definition) return `# ${displayAppName(app)}\n\n暂无模块模板。`;
    return renderModuleMarkdown(buildDeterministicModuleAnalysis(definition, app, counts, evidence, options));
  }

  function buildDeterministicModuleAnalysis(definition, app, counts, evidence, options = {}) {
    const playbook = modulePlaybook(definition.id);
    const sourceBoundary = buildSourceBoundary(counts, evidence);
    const evidenceMap = buildEvidenceMap(definition.id, evidence);
    const evidenceLedger = buildEvidenceLedger(definition.id, evidence);
    const repeatedSignals = buildRepeatedSignals(definition.id, evidence);
    const anomalySignals = buildAnomalySignals(definition.id, counts, evidence);
    const moduleBreakdown = buildModuleBreakdown(definition.id, evidence, counts);
    const judgments = buildSupportedJudgments(definition.id, counts, evidence, playbook, evidenceLedger);
    const signalDrilldowns = buildSignalDrilldowns(definition.id, evidence, evidenceLedger, moduleBreakdown);
    const judgmentMatrix = buildJudgmentEvidenceMatrix(definition.id, judgments, evidenceLedger, evidence, counts);
    const caveats = buildJudgmentCaveats(definition.id, counts, evidence);
    const mindmap = buildModuleMindmap(definition, app, repeatedSignals, anomalySignals, judgments, moduleBreakdown, signalDrilldowns);
    const generatedAt = options.generatedAt || new Date().toISOString();

    return {
      definition,
      app,
      counts,
      evidence,
      playbook,
      sourceBoundary,
      evidenceMap,
      evidenceLedger,
      repeatedSignals,
      anomalySignals,
      moduleBreakdown,
      signalDrilldowns,
      judgments,
      judgmentMatrix,
      caveats,
      mindmap,
      generatedAt
    };
  }

  function renderModuleMarkdown(analysis, options = {}) {
    const {
      definition,
      app,
      evidence,
      playbook,
      sourceBoundary,
      evidenceMap,
      evidenceLedger,
      repeatedSignals,
      anomalySignals,
      moduleBreakdown,
      signalDrilldowns,
      judgments,
      judgmentMatrix,
      caveats,
      mindmap,
      generatedAt
    } = analysis;
    const aiInsights = options.aiInsights;

    return [
      `# ${definition.title}：${displayAppName(app)}`,
      "",
      `> 生成时间：${formatDateTime(generatedAt)}`,
      `> 方法：先做样本边界和证据地图，再提炼数据状态信号和可进入报告的判断。`,
      aiInsights?.available ? `> AI 洞察：${aiInsights.provider || "Agnes"} / ${aiInsights.model || "unknown"}` : "",
      aiInsights?.error ? `> AI 洞察未生成：${aiInsights.error}` : "",
      "",
      "## 1. 样本边界",
      ...bulletLines(sourceBoundary),
      "",
      "## 2. 本模块要回答的问题",
      ...bulletLines(playbook.questions),
      "",
      "## 3. 证据地图",
      ...evidenceMap.flatMap((group) => [
        `### ${group.title}`,
        ...bulletLines(group.items),
        ""
      ]),
      "## 4. 证据台账",
      ...renderEvidenceLedger(evidenceLedger),
      "",
      "## 5. 高频信号",
      ...bulletLines(repeatedSignals),
      "",
      "## 6. 数据状态信号",
      ...bulletLines(anomalySignals),
      "",
      "## 7. 模块专属拆解",
      ...moduleBreakdown.flatMap((group) => [
        `### ${group.title}`,
        ...bulletLines(group.items),
        ""
      ]),
      "## 8. 信号下钻 / 原文样本",
      ...renderSignalDrilldowns(signalDrilldowns),
      "",
      "## 9. 判断 - 证据矩阵",
      ...renderJudgmentEvidenceMatrix(judgmentMatrix),
      "",
      "## 10. AI 结构化洞察",
      ...renderAiInsightSection(aiInsights, definition.id),
      "",
      "## 11. 可形成的判断",
      ...bulletLines(judgments),
      "",
      "## 12. 不能贸然判断的部分",
      ...bulletLines(caveats),
      "",
      "## 13. 可写入正式报告的段落草稿",
      ...buildDraftParagraphs(definition.id, app, judgments, anomalySignals, evidence, moduleBreakdown, judgmentMatrix),
      "",
      "## 14. 证据链索引",
      ...renderEvidenceChainIndex(judgmentMatrix, evidenceLedger),
      "",
      "## 15. 脑图",
      "",
      "```mermaid",
      mindmap,
      "```"
    ].join("\n");
  }

  function modulePlaybook(moduleId) {
    const playbooks = {
      anomaly_signal: {
        questions: ["近 12 个月下载、收入和活跃处在什么状态？", "最近 3 个月相对周期初 3 个月是提升、回落还是稳定？", "近 90 天垂类榜单和国家分布说明它站在什么位置？"],
        focus: "只用市场数据判断当前数据状态。"
      },
      market_overview: {
        questions: ["市场数据覆盖哪些口径？", "下载、收入、活跃、评论之间有没有错配？", "哪些数据缺口会影响规模判断？"],
        focus: "先明确数据口径，再判断市场表现。"
      },
      country_market_split: {
        questions: ["哪些国家贡献下载，哪些国家贡献收入？", "哪些市场 RPD 或收入占比明显更高？", "下载市场和付费市场是否错配？"],
        focus: "用国家分工解释拉量市场、付费市场和高价值市场。"
      },
      category_competitors: {
        questions: ["它在 ST 垂类榜里排第几？", "榜单前后有哪些竞品？", "哪些榜单竞品尚未入库，需要引导去 ST 搜索？"],
        focus: "把垂类 Top Apps 榜单变成竞品采集和对比入口。"
      },
      user_pain_points: {
        questions: ["官方商店 feature 图在强调什么痛点？", "用户评论和 TikTok 里反复表达的真实痛点是什么？", "官方痛点、用户痛点和 paywall 付费点是否一致？"],
        focus: "合并用户任务和心理摩擦，回答这个 App 满足了什么痛点。"
      },
      experience: {
        questions: ["你的实测体验能验证或推翻哪些外部承诺？", "核心任务路径上的摩擦在哪里？", "哪些体验判断还需要补截图或流程记录？"],
        focus: "以手写体验为主，外部材料只做验证。"
      },
      growth_signals: {
        questions: ["素材反复使用什么 hook？", "演示动作和结果承诺是什么？", "评论里的反对意见和自传播语言是什么？"],
        focus: "把增长内容当成市场需求的显影剂。"
      },
      paid_points: {
        questions: ["Paywall 主卖点是什么？", "免费和付费权益边界在哪里？", "哪些国家 RPD 或收入占比更高，说明付费强度更突出？"],
        focus: "只判断它卖什么、锁什么、哪里更愿意付费，不推续费率或 LTV。"
      },
      user_reviews: {
        questions: ["用户喜欢什么？", "用户抱怨什么？", "哪些风险信号会影响产品承诺？"],
        focus: "把评论变成好评主题、差评主题和风险信号，不只做情绪比例。"
      },
      founder_company: {
        questions: ["已录入文章里有没有公司、创始人、融资、收购或转型线索？", "哪些信息可引用，哪些只是 PR 叙事？", "这些背景是否解释产品路线或增长动作？"],
        focus: "只在文章材料存在时提取公司背景，不补写没有来源的创始人故事。"
      }
    };
    return playbooks[moduleId] || { questions: ["这个模块能回答什么？"], focus: "先证据后判断。" };
  }

  async function generateModuleAiInsights(definition, app, counts, evidence, deterministicAnalysis, sourceFingerprint = "") {
    return reportAiWorkflow.generateModuleInsights({
      definition,
      app,
      counts,
      evidence,
      deterministicAnalysis,
      sourceFingerprint
    });
  }

  function renderAiInsightSection(aiInsights, moduleId = "") {
    if (!aiInsights?.available) {
      return bulletLines([aiInsights?.error ? `AI 洞察未生成：${aiInsights.error}` : "AI 洞察未生成，当前使用确定性证据拆解。"]);
    }
    if (aiInsights.reportDraftMarkdown) {
      return [
        "### 报告正文",
        "",
        aiInsights.reportDraftMarkdown,
        "",
        "### 结构化数据结论",
        ...bulletLines(aiInsights.keyFindings.map((item) => `${item.title}：${item.insight}${item.evidence ? `（数据：${renderEvidenceRef(item)}）` : ""}`))
      ];
    }
    return [
      "### 摘要",
      aiInsights.executiveSummary || "暂无。",
      "",
      "### 关键发现",
      ...bulletLines(aiInsights.keyFindings.map((item) => `${item.title}：${item.insight}（证据：${renderEvidenceRef(item)}；置信度：${item.confidence || "medium"}）`)),
      "",
      "### 可写角度",
      ...bulletLines(aiInsights.reportAngles.map((item) => `${item.title}：${item.paragraph}${item.evidenceIds?.length ? `（引用：${item.evidenceIds.join("、")}）` : ""}`))
    ];
  }

  function renderModuleDebugMarkdown(definition, app, counts, evidence, evidenceLedger = [], aiInsights = {}, reportMarkdown = "", generatedAt = new Date().toISOString()) {
    return [
      `# ${definition.title}：${displayAppName(app)}`,
      "",
      `> 生成时间：${formatDateTime(generatedAt)}`,
      `> 模式：${definition.id} 模块正文流。正式产物见 .report.md；本文件仅保留调试信息。`,
      aiInsights?.available ? `> AI 洞察：${aiInsights.provider || "Agnes"} / ${aiInsights.model || "unknown"}` : "",
      aiInsights?.error ? `> AI 洞察未生成：${aiInsights.error}` : "",
      "",
      "## 正式正文",
      "",
      reportMarkdown,
      "",
      "## Source Pack 摘要",
      ...renderModuleSourcePackSummary(definition.id, counts, evidence, evidenceLedger),
      "",
      "## 证据台账",
      ...renderEvidenceLedger(evidenceLedger || [])
    ].filter((line) => line !== "").join("\n");
  }

  function renderModuleSourcePackSummary(moduleId, counts = {}, evidence = {}, evidenceLedger = []) {
    const base = [
      `- 文章：${counts.articles || 0}`,
      `- Sensor Tower 导入：${counts.sensorImports || 0}`,
      `- TT 素材：${counts.ttVideos || 0}`,
      `- 评论/用户声音：${counts.userVoice || 0}`,
      `- 进入证据台账：${(evidenceLedger || []).length}`
    ];
    const extras = {
      anomaly_signal: [`- 市场数据源：${counts.marketData || 0}`],
      market_overview: [`- 市场数据源：${counts.marketData || 0}`],
      country_market_split: [`- 国家市场行数：${counts.countryMarketRows || 0}`],
      category_competitors: [`- 竞品榜单行数：${counts.categoryRankingRows || 0}`],
      user_pain_points: [`- 商店截图：${counts.storeScreenshots || 0}`, `- Paywall：${counts.paywalls || 0}`],
      experience: [`- 体验材料：${counts.experienceDocs || 0}`],
      growth_signals: [`- 疑似噪声素材：${counts.ttVideosNoisy || 0}`, `- TT 评论：${counts.ttComments || 0}`],
      paid_points: [`- Paywall：${counts.paywalls || 0}`, `- 国家市场行数：${counts.countryMarketRows || 0}`],
      user_reviews: [`- 评论行数：${counts.reviewRows || 0}`, `- TT 评论：${counts.ttComments || 0}`],
      founder_company: [`- 公司/创始人/融资/收购相关来源：${counts.companySources || 0}`, `- 进入 Agnes 的文章：${(evidence.companyArticleSamples || []).length}`]
    };
    return [...base, ...(extras[moduleId] || [])];
  }

  function buildReportMarkdown(aiInsights, fallbackMarkdown = "", definition = {}, app = {}) {
    const clean = (markdown) => cleanReportMarkdown(markdown, definition.id);
    if (aiInsights?.available && aiInsights.reportDraftMarkdown) {
      return clean(`${aiInsights.reportDraftMarkdown}`.trim());
    }
    const extracted = extractReportDraftMarkdown(fallbackMarkdown);
    if (extracted) return clean(extracted);
    return clean([
      `# ${definition.title || "模块报告"}：${displayAppName(app)}`,
      "",
      "> 当前 AI 正文未生成，需先补齐 Agnes 洞察。"
    ].join("\n"));
  }

  function cleanReportMarkdown(markdown = "", moduleId = "") {
    let cleaned = String(markdown || "").replace(new RegExp(`\\[(${EVIDENCE_ID_PATTERN_SOURCE}\\d+)\\]`, "g"), "$1");
    if (moduleId !== "founder_company") return cleaned.trim();
    return cleaned
      .replace(
        /(## 融资 \/ 收购\s*\n)(?:目前材料中未提及传统的风险投资融资轮次，而是直接指向了公司的出售事件。|当前材料没有明确融资轮次或投资方信息。|融资信息不清晰。|未披露传统融资轮次。)\s*\n*/g,
        "$1"
      )
      .replace(/目前本地材料里，?/g, "")
      .replace(/本地材料里，?/g, "")
      .replace(/当前材料中，?/g, "")
      .replace(/材料中，?/g, "")
      .replace(/材料仅能确认/g, "只能确认")
      .replace(/材料只支持/g, "只能确认")
      .replace(/材料只能确认/g, "只能确认")
      .replace(/虽然材料未详细披露/g, "虽然尚未看到多源披露")
      .replace(/尽管材料未详细披露/g, "虽然尚未看到多源披露")
      .replace(/材料中存在不同侧面的描述/g, "仍需进一步核实")
      .replace(/材料中未看到/g, "尚未看到")
      .replace(/当前材料只能确认/g, "只能确认")
      .replace(/## 未解决的问题/g, "## 待验证部分")
      .replace(/\s+\bAPP\d+\b(?=[。；;，,、\s])/g, "")
      .replace(/(20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日[^。\n]{0,24}(?:发布|上线|推出|上架)[^。\n]{0,24})\s+A\d+(?=。)/g, "$1")
      .replace(/最终成为 MyFitnessPal 在 AI 原生体验上的关键补充/g, "最终被 MyFitnessPal 收购，成为其 AI 原生营养追踪体验的一部分")
      .replace(/作为其数字营养追踪版图的关键补充/g, "纳入其数字营养追踪产品组合")
      .replace(/作为 MyFitnessPal .*?关键补充/g, "被 MyFitnessPal 收购并纳入其产品组合")
      .replace(/这条线索更像是一笔明确的收购退出，而非传统的公开融资故事[:：]?/g, "")
      .replace(/这条线索更像一笔收购退出，而不是公开融资故事[:：]?/g, "")
      .trim();
  }

  function extractReportDraftMarkdown(markdown = "") {
    const aiSection = extractSection(markdown, "## 10. AI 结构化洞察", "## 11.");
    if (!aiSection) return "";
    const draft = extractSection(aiSection, "### 报告正文", "### 结构化数据结论")
      || extractSection(aiSection, "### 报告正文", "### 摘要")
      || extractSection(aiSection, "### 报告正文", "## ");
    return draft.trim();
  }

  function sanitizeModuleAiInsights(aiInsights, evidenceLedger = []) {
    if (!aiInsights?.available) return aiInsights;
    const allowedIds = new Set(evidenceLedger.map((item) => item.id));
    const filterIds = (ids = []) => ids.filter((id) => allowedIds.has(id));
    return {
      ...aiInsights,
      keyFindings: aiInsights.keyFindings.map((item) => ({ ...item, evidenceIds: filterIds(item.evidenceIds) })),
      tensions: aiInsights.tensions.map((item) => ({ ...item, evidenceIds: filterIds(item.evidenceIds) })),
      reportAngles: aiInsights.reportAngles.map((item) => ({ ...item, evidenceIds: filterIds(item.evidenceIds) }))
    };
  }

  function renderEvidenceRef(item = {}) {
    const ids = Array.isArray(item.evidenceIds) ? item.evidenceIds.filter(Boolean) : [];
    const text = normalizeText(item.evidence);
    if (ids.length && text) return `${ids.join("、")}；${text}`;
    if (ids.length) return ids.join("、");
    return text || "暂无";
  }

  function buildSourceBoundary(counts, evidence) {
    return [
      `文章 ${counts.articles || 0} 条，Sensor Tower 导入 ${counts.sensorImports || 0} 份，TT 素材原始绑定 ${counts.ttVideosRaw || counts.ttVideos || 0} 条，其中相关性通过 ${counts.ttVideos || 0} 条，疑似噪声 ${counts.ttVideosNoisy || 0} 条，TT 评论 ${counts.ttComments || 0} 条。`,
      `用户声音口径合计 ${counts.userVoice || 0} 条，其中商店评论导入行数 ${counts.reviewRows || 0}，当前可展示评论样本 ${counts.reviewSamples || 0} 条。`,
      evidence.dataTypes?.length ? `Sensor Tower 数据类型：${evidence.dataTypes.join("、")}。` : "当前没有可识别的 Sensor Tower 数据类型。",
      evidence.videoRelevance ? `TT 素材相关性规则：${evidence.videoRelevance.rule}；通过 ${evidence.videoRelevance.relevant} / 原始 ${evidence.videoRelevance.total}。` : "",
      counts.experienceDocs ? `已有体验文档 ${counts.experienceDocs} 份，可用于承接主观实测判断。` : "还没有体验文档，涉及真实使用感的判断只能先保留为待验证。"
    ];
  }

  function buildEvidenceMap(moduleId, evidence) {
    const groups = [
      {
        title: "文章 / 外部叙事",
        items: evidence.articleSamples.slice(0, 5).map((item) => `《${item.title || "未命名文章"}》${item.sourceName ? `（${item.sourceName}）` : ""}：${item.excerpt || "可作为外部定位或背景线索"}`)
      },
      {
        title: "Sensor Tower / 数据口径",
        items: evidence.sensorImports.slice(0, 8).map((item) => `${item.dataType || "unknown"}：${item.rowCount || 0} 行${formatDateRange(item.dateRange) ? `，${formatDateRange(item.dateRange)}` : ""}${item.importedAt ? `，导入 ${item.importedAt}` : ""}`)
      },
      {
        title: "商店 Feature 图 / 官方痛点",
        items: (evidence.storeScreenshots || []).slice(0, 6).map((item, index) => `截图 ${index + 1}${item.platform ? `（${item.platform}）` : ""}：${item.alt || item.imageUrl || "可用于识别官方卖点"}`)
      },
      {
        title: "Paywall / 付费点",
        items: (evidence.paywallSamples || []).slice(0, 5).map((item) => `${item.appName || "Paywall"}：${item.imageUrl || item.pageUrl || "可用于识别付费主卖点"}${item.collectedAt ? `，采集 ${item.collectedAt}` : ""}`)
      },
      {
        title: "ST 垂类竞品榜",
        items: evidence.categoryRanking?.rows?.slice(0, 8).map((item) => `#${item.rank} ${item.appName || item.unifiedName || "Unknown"}：90天收入 ${formatMoneyShort(item.revenueUsd90d)}，下载 ${formatNumberShort(item.downloads90d)}${item.localAppId ? "，已入库" : "，未入库"}`) || []
      },
      {
        title: "TT 素材 / 增长表达",
        items: evidence.videoSamples.slice(0, moduleId === "growth_signals" ? 16 : 5).map((item) => `《${item.title || "未命名素材"}》：播放 ${item.viewCount || 0} / 评论 ${item.commentCount || 0}。${item.summary || "可观察传播承诺"}`)
      },
      {
        title: "疑似噪声 / 暂不进入判断",
        items: evidence.noisyVideoSamples.slice(0, 5).map((item) => `《${item.title || "未命名素材"}》：播放 ${item.viewCount || 0}。未通过 App 相关性规则，除非人工复核，不进入本模块判断。`)
      },
      {
        title: "用户声音 / 评论证据",
        items: [
          ...evidence.reviewSamples.slice(0, 5).map((item) => `商店评论${item.rating ? `（${item.rating} 星）` : ""}：${item.text}`),
          ...evidence.ttCommentSamples.slice(0, 5).map((item) => `TT 评论${item.likeCount ? `（赞 ${item.likeCount}）` : ""}：${item.text}`)
        ]
      },
      {
        title: "体验文档 / 人工实测",
        items: evidence.experienceDocs.map((item) => `${item.title}：${item.excerpt || item.path}`)
      }
    ];
    return groups.map((group) => ({ ...group, items: group.items.filter(Boolean) }));
  }

  function buildEvidenceLedger(moduleId, evidence) {
    const articleRows = moduleId === "founder_company"
      ? (evidence.companyArticleSamples || evidence.articleSamples || []).slice(0, 12)
      : (evidence.articleSamples || []).slice(0, 5);
    const rows = [
      ...articleRows.map((item, index) => ({
        id: `A${index + 1}`,
        type: "文章",
        signal: item.title || "未命名文章",
        evidence: item.excerpt || item.sourceName || "外部叙事线索",
        use: moduleEvidenceUse(moduleId, "article", item),
        sourceUrl: item.sourceUrl || "",
        sourceName: item.sourceName || "",
        sourceDomain: item.sourceDomain || "",
        publishedAt: item.publishedAt || "",
        author: item.author || "",
        title: item.title || "",
        originalText: item.originalText || item.excerpt || "",
        zhText: item.zhText || "",
        enText: item.enText || ""
      })),
      ...evidence.sensorImports.slice(0, 8).map((item, index) => ({
        id: `D${index + 1}`,
        type: "数据",
        signal: item.dataType || "unknown",
        evidence: `${item.rowCount || 0} 行${formatDateRange(item.dateRange) ? `，${formatDateRange(item.dateRange)}` : ""}${item.importedAt ? `，导入 ${item.importedAt}` : ""}`,
        use: moduleEvidenceUse(moduleId, "data", item)
      })),
      ...(evidence.storeScreenshots || []).slice(0, 6).map((item, index) => ({
        id: `S${index + 1}`,
        type: "商店截图",
        signal: item.platform || `截图 ${index + 1}`,
        evidence: item.alt || item.imageUrl || item.thumbnailUrl || "商店 feature 图",
        use: moduleEvidenceUse(moduleId, "store_screenshot", item)
      })),
      ...(evidence.paywallSamples || []).slice(0, 5).map((item, index) => ({
        id: `P${index + 1}`,
        type: "Paywall",
        signal: item.appName || `Paywall ${index + 1}`,
        evidence: item.imageUrl || item.pageUrl || "付费页截图",
        use: moduleEvidenceUse(moduleId, "paywall", item)
      })),
      ...(evidence.categoryRanking?.rows || []).slice(0, moduleId === "category_competitors" ? 20 : 10).map((item, index) => ({
        id: `K${index + 1}`,
        type: "竞品榜",
        signal: `#${item.rank || index + 1} ${item.appName || item.unifiedName || "Unknown"}`,
        evidence: `月均收入 ${formatMoneyShort(item.monthlyRevenueUsd || Number(item.revenueUsd90d || 0) / 3)}，月均下载 ${formatNumberShort(Number(item.downloads90d || 0) / 3)}，DAU ${formatNumberShort(item.dau)}${item.localAppId ? "，已入库" : "，未入库"}`,
        use: moduleEvidenceUse(moduleId, "category_ranking", item)
      })),
      ...evidence.videoSamples.slice(0, moduleId === "growth_signals" ? 16 : 6).map((item, index) => ({
        id: `V${index + 1}`,
        type: "TT 素材",
        signal: item.title || "未命名素材",
        evidence: `播放 ${item.viewCount || 0} / 评论 ${item.commentCount || 0}。${item.summary || "可观察传播承诺"}`,
        use: moduleEvidenceUse(moduleId, "video", item)
      })),
      ...evidence.noisyVideoSamples.slice(0, 5).map((item, index) => ({
        id: `N${index + 1}`,
        type: "疑似噪声素材",
        signal: item.title || "未命名素材",
        evidence: `播放 ${item.viewCount || 0}。未通过 App 相关性规则，除非人工复核，不进入本模块判断。`,
        use: moduleEvidenceUse(moduleId, "noise", item)
      })),
      ...evidence.reviewSamples.slice(0, moduleId === "user_reviews" ? 10 : 8).map((item, index) => ({
        id: `R${index + 1}`,
        type: "商店评论",
        signal: item.rating ? `${item.rating} 星评论` : "评论",
        evidence: item.text,
        use: moduleEvidenceUse(moduleId, "review", item),
        originalText: item.fullText || item.text || "",
        zhText: item.zhText || "",
        enText: item.enText || ""
      })),
      ...evidence.ttCommentSamples.slice(0, moduleId === "growth_signals" ? 12 : 6).map((item, index) => ({
        id: `C${index + 1}`,
        type: "TT 评论",
        signal: item.likeCount ? `赞 ${item.likeCount}` : item.videoTitle || "评论",
        evidence: item.text,
        use: moduleEvidenceUse(moduleId, "tt_comment", item),
        originalText: item.rawText || item.text || "",
        zhText: item.zhText || "",
        enText: item.enText || ""
      })),
      ...evidence.themeSummary.slice(0, 6).map((item, index) => ({
        id: `T${index + 1}`,
        type: "主题聚类",
        signal: `${item.title}（${item.count}）`,
        evidence: item.examples?.[0] || "主题命中但暂无样本",
        use: moduleEvidenceUse(moduleId, "theme", item)
      })),
      ...evidence.experienceDocs.slice(0, 4).map((item, index) => ({
        id: `X${index + 1}`,
        type: "体验文档",
        signal: item.title,
        evidence: item.excerpt || item.path,
        use: moduleEvidenceUse(moduleId, "experience", item)
      }))
    ].map((item) => ({
      ...item,
      signal: truncateText(item.signal, 90),
      evidence: truncateText(item.evidence, 220),
      use: truncateText(item.use, 120)
    })).filter((item) => item.evidence);

    return rows;
  }

  function buildModuleCitations(rows = []) {
    return rows
      .filter((item) => item.id && isVisibleReportCitation(item))
      .map((item) => ({
        id: item.id,
        type: item.type,
        title: truncateText(formatCitationTitle(item), 140),
        sourceName: truncateText(item.sourceName || item.sourceDomain || item.type || "本地来源", 80),
        sourceDomain: truncateText(item.sourceDomain || "", 80),
        sourceUrl: normalizeText(item.sourceUrl),
        author: truncateText(item.author || "", 80),
        publishedAt: normalizeText(item.publishedAt),
        excerpt: truncateText(item.evidence || "", 220),
        use: truncateText(item.use || "", 120),
        originalText: truncateText(item.originalText || "", 320),
        zhText: truncateText(item.zhText || "", 320),
        enText: truncateText(item.enText || "", 320)
      }))
      .filter((item) => item.title || item.sourceUrl || item.excerpt);
  }

  function isVisibleReportCitation(item = {}) {
    const type = normalizeText(item.type);
    return type !== "数据" && type !== "竞品榜";
  }

  function mergeModuleCitations(primary = [], fallback = []) {
    const rows = [
      ...(Array.isArray(primary) ? primary : []),
      ...(Array.isArray(fallback) ? fallback : [])
    ];
    const seen = new Set();
    return rows.filter((item) => {
      const id = normalizeText(item?.id).toUpperCase();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function formatCitationTitle(item = {}) {
    const type = normalizeText(item.type);
    const signal = normalizeText(item.signal);
    const title = normalizeText(item.title);
    if (type === "文章") return title || signal || "来源文章";
    if (type === "数据") return signal ? `数据：${signal}` : "本地数据";
    if (type === "竞品榜") return signal ? `竞品榜：${signal}` : "同类榜单";
    if (type === "商店评论") return signal ? `评论：${signal}` : "商店评论";
    if (type === "主题聚类") return signal ? `评论主题：${signal}` : "评论主题";
    if (type === "商店截图") return signal ? `商店截图：${signal}` : "商店截图";
    if (type === "Paywall") return signal ? `Paywall：${signal}` : "Paywall";
    return title || signal || type || "本地来源";
  }

  function normalizeArticleEvidenceSample(item = {}) {
    return {
      title: normalizeText(item.title),
      excerpt: normalizeText(item.excerpt),
      originalText: normalizeText(item.originalText || item.excerpt),
      zhText: normalizeText(item.zhText || item.translationZh || item.summaryZh),
      enText: normalizeText(item.enText || item.translationEn || item.summaryEn),
      sourceName: normalizeText(item.sourceName),
      sourceDomain: normalizeText(item.sourceDomain),
      sourceUrl: normalizeText(item.sourceUrl),
      author: normalizeText(item.author),
      publishedAt: normalizeText(item.publishedAt)
    };
  }

  function selectFounderCompanyArticles(articles = []) {
    const scored = articles
      .map((item, index) => ({
        item,
        index,
        score: scoreFounderCompanyArticle(item)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);
    return uniqueBy(scored.map((entry) => entry.item), (item) => normalizeText(item.sourceUrl) || `${normalizeText(item.title)}|${normalizeText(item.sourceName)}`).slice(0, 12);
  }

  function scoreFounderCompanyArticle(item = {}) {
    const text = `${item.title || ""} ${item.excerpt || ""} ${item.sourceName || ""} ${item.sourceDomain || ""}`.toLowerCase();
    let score = 0;
    if (/myfitnesspal/.test(text)) score += 80;
    if (/globenewswire|official|官方|press release|benesch/.test(text)) score += 60;
    if (/acquired|acquisition|收购|出售|sold|exit/.test(text)) score += 55;
    if (/financial terms|terms undisclosed|undisclosed|财务条款|交易条款|收购金额|未披露/.test(text)) score += 45;
    if (/founder|cofounder|创始人|zach|jake|henry|yadegari|castillo|langmack/.test(text)) score += 35;
    if (/previous|prior|past|earlier|portfolio|作品|代表作|过往|此前|曾经|履历|built|created|launched|school 42|42 school|coding school|工作室|开源|项目/.test(text)) score += 30;
    if (/funding|raised|融资|估值|valuation|investor|vc\b/.test(text)) score += 25;
    if (/flow|team|contractor|independent|独立/.test(text)) score += 12;
    if (/二级|转述|blog|youtube|instagram|reddit|stormy|profitablefounder/.test(text)) score -= 18;
    return score;
  }

  function uniqueBy(rows = [], keyFn = (item) => item) {
    const seen = new Set();
    const result = [];
    for (const row of rows) {
      const key = keyFn(row);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(row);
    }
    return result;
  }

  function moduleEvidenceUse(moduleId, type, item = {}) {
    const defaultUse = {
      article: "定位、背景叙事或竞品线索",
      data: "样本边界、规模口径或趋势口径",
      video: "增长表达、产品承诺或演示动作",
      noise: "错绑素材、弱相关素材或噪声排除依据",
      review: "用户痛点、风险、付费摩擦或 case",
      tt_comment: "受众反应、疑问、反对意见或自传播语言",
      theme: "高频信号入口",
      experience: "人工体验判断主轴",
      store_screenshot: "官方商店卖点、feature 图和痛点表达",
      paywall: "付费主卖点、权益边界和价格结构",
      category_ranking: "垂类竞品位置、规模和未入库采集对象"
    };
    const moduleUse = {
      anomaly_signal: "支撑数据状态判断",
      market_overview: type === "data" ? "支撑市场表现口径和时间窗" : "作为市场读数的补充解释",
      country_market_split: type === "data" ? "支撑国家下载、收入和 RPD 分工" : defaultUse[type],
      category_competitors: type === "category_ranking" ? "支撑竞品榜单和未入库引导" : defaultUse[type],
      user_pain_points: ["store_screenshot", "review", "tt_comment", "theme", "video", "article"].includes(type) ? "拆官方痛点、用户痛点和痛点边界" : defaultUse[type],
      experience: type === "experience" ? "作为体验结论主轴" : "用于验证或反证实测体验",
      growth_signals: type === "noise" ? "说明哪些高播放内容不应进入增长判断" : ["video", "tt_comment"].includes(type) ? "拆 hook、演示动作和受众反馈" : defaultUse[type],
      paid_points: ["paywall", "data"].includes(type) ? "判断付费主卖点、权益边界和高付费市场" : defaultUse[type],
      user_reviews: ["review", "tt_comment", "theme"].includes(type) ? "拆好评主题、差评主题和风险信号" : defaultUse[type],
      founder_company: type === "article" ? "提取公司、创始人、融资或 PR 线索" : defaultUse[type]
    };
    return moduleUse[moduleId] || defaultUse[type] || "作为模块辅助证据";
  }

  function renderEvidenceLedger(rows = []) {
    if (!rows.length) return ["- 暂无可编号证据。"];
    return [
      "| ID | 类型 | 信号 | 证据摘要 | 可支撑什么 |",
      "| --- | --- | --- | --- | --- |",
      ...rows.map((item) => `| ${escapeMarkdownTable(item.id)} | ${escapeMarkdownTable(item.type)} | ${escapeMarkdownTable(item.signal)} | ${escapeMarkdownTable(item.evidence)} | ${escapeMarkdownTable(item.use)} |`)
    ];
  }

  function buildJudgmentEvidenceMatrix(moduleId, judgments = [], evidenceLedger = [], evidence = {}, counts = {}) {
    const preferred = preferredEvidenceIds(moduleId, evidenceLedger);
    return judgments.slice(0, 6).map((judgment, index) => {
      const supportIds = preferred[index] || pickEvidenceIds(evidenceLedger, index);
      return {
        judgment: truncateText(judgment, 180),
        evidenceIds: supportIds,
        confidence: inferJudgmentConfidence(moduleId, supportIds, evidence, counts),
        useInReport: inferReportUse(moduleId, index)
      };
    });
  }

  function preferredEvidenceIds(moduleId, rows = []) {
    const byType = (types, limit = 4) => rows.filter((item) => types.includes(item.type)).map((item) => item.id).slice(0, limit);
    const byIdPrefix = (prefixes, limit = 4) => rows.filter((item) => prefixes.some((prefix) => item.id.startsWith(prefix))).map((item) => item.id).slice(0, limit);
    const byDataSignal = (pattern, limit = 4) => rows.filter((item) => item.id.startsWith("D") && pattern.test(`${item.signal || ""} ${item.evidence || ""}`)).map((item) => item.id).slice(0, limit);
    const map = {
      anomaly_signal: [byIdPrefix(["D", "T", "V"], 5), byIdPrefix(["D", "R", "S"], 5), byIdPrefix(["V", "R", "T"], 5), byIdPrefix(["K", "P", "D"], 4)],
      market_overview: [byType(["数据"], 5), byIdPrefix(["D"], 4), byIdPrefix(["D", "R", "T"], 5), byIdPrefix(["D"], 4)],
      country_market_split: [byDataSignal(/download|revenue|active|usage/i, 5), byIdPrefix(["D"], 4), byIdPrefix(["D"], 4)],
      category_competitors: [byIdPrefix(["K"], 5), byIdPrefix(["K", "D"], 5), byIdPrefix(["K"], 5)],
      user_pain_points: [byIdPrefix(["S", "T", "R"], 5), byIdPrefix(["R", "C", "T"], 5), byIdPrefix(["S", "P", "V"], 5), byIdPrefix(["X", "R", "S"], 4)],
      experience: [byIdPrefix(["X"], 3), byIdPrefix(["X", "V", "R", "C"], 4), byIdPrefix(["X", "R", "T"], 4), byIdPrefix(["X", "V"], 4)],
      growth_signals: [byIdPrefix(["V"], 5), byIdPrefix(["V", "T", "R"], 5), byIdPrefix(["N"], 5), byIdPrefix(["C", "V"], 5)],
      paid_points: [byIdPrefix(["P"], 4), uniqueStrings([...byDataSignal(/revenue/i, 4), ...byIdPrefix(["P"], 2)]).slice(0, 5), byIdPrefix(["P", "D"], 5)],
      user_reviews: [byIdPrefix(["R", "T", "C"], 5), byIdPrefix(["R", "T", "C"], 4), byIdPrefix(["R", "T", "C"], 5), byIdPrefix(["T", "R", "C"], 5)],
      founder_company: [byIdPrefix(["A"], 5), byIdPrefix(["A"], 4), byIdPrefix(["A"], 4)]
    };
    return map[moduleId] || [pickEvidenceIds(rows, 0)];
  }

  function pickEvidenceIds(rows = [], offset = 0) {
    if (!rows.length) return [];
    const rotated = [...rows.slice(offset), ...rows.slice(0, offset)];
    return rotated.slice(0, 4).map((item) => item.id);
  }

  function inferJudgmentConfidence(moduleId, evidenceIds = [], evidence = {}, counts = {}) {
    const hasData = evidenceIds.some((id) => id.startsWith("D"));
    const hasVoice = evidenceIds.some((id) => id.startsWith("R") || id.startsWith("C") || id.startsWith("T"));
    const hasVideo = evidenceIds.some((id) => id.startsWith("V"));
    const hasExperience = evidenceIds.some((id) => id.startsWith("X"));
    if (moduleId === "market_overview" && hasData && counts.sensorImports >= 2) return "high";
    if (moduleId === "experience" && !counts.experienceDocs) return "low";
    if (moduleId === "experience" && hasExperience) return hasVoice || hasVideo ? "high" : "medium";
    if ((hasVoice && counts.userVoice >= 30) || (hasVideo && counts.ttVideos >= 5)) return hasData ? "high" : "medium";
    return evidenceIds.length >= 3 ? "medium" : "low";
  }

  function inferReportUse(moduleId, index) {
    const map = {
      anomaly_signal: ["报告开头主判断候选", "规模背景", "用户现实张力", "增长逻辑", "风险边界"],
      market_overview: ["规模口径", "趋势读法", "数据缺口说明", "评论补充"],
      country_market_split: ["国家分工段", "付费强度段", "市场错配解释"],
      category_competitors: ["竞品池", "未入库补采清单", "横向比较入口"],
      user_pain_points: ["痛点段", "承诺与现实对照", "体验验证问题", "付费点承接"],
      experience: ["体验结论", "体验反证", "截图/流程补充清单"],
      growth_signals: ["增长素材结构", "hook 分类", "噪声过滤", "评论反应"],
      paid_points: ["付费主卖点", "权益边界", "高付费市场"],
      user_reviews: ["好评主题", "差评主题", "风险原话", "边界条件"],
      founder_company: ["公司背景", "创始人/融资线索", "引用边界"]
    };
    return map[moduleId]?.[index] || "正式报告备选判断";
  }

  function renderJudgmentEvidenceMatrix(rows = []) {
    if (!rows.length) return ["- 暂无判断矩阵。"];
    return [
      "| 判断 | 支撑证据 | 置信度 | 可进入报告的位置 |",
      "| --- | --- | --- | --- |",
      ...rows.map((item) => `| ${escapeMarkdownTable(item.judgment)} | ${escapeMarkdownTable(item.evidenceIds.join("、") || "待补")} | ${escapeMarkdownTable(item.confidence)} | ${escapeMarkdownTable(item.useInReport)} |`)
    ];
  }

  function buildSignalDrilldowns(moduleId, evidence, evidenceLedger = [], moduleBreakdown = []) {
    const rowById = new Map(evidenceLedger.map((item) => [item.id, item]));
    const rows = [];
    const addRow = ({ signal, sample, evidenceIds, explains, boundary }) => {
      const ids = uniqueStrings((evidenceIds || []).filter((id) => rowById.has(id))).slice(0, 5);
      if (!signal || !sample || !ids.length) return;
      rows.push({
        signal: truncateText(signal, 80),
        sample: truncateText(sample, 180),
        evidenceIds: ids,
        explains: truncateText(explains, 120),
        boundary: truncateText(boundary, 120)
      });
    };

    const addThemeRows = (themes, limit = 4) => {
      for (const theme of themes.slice(0, limit)) {
        const themeIndex = evidence.themeSummary.findIndex((item) => item.id === theme.id && item.title === theme.title);
        const themeId = themeIndex >= 0 ? `T${themeIndex + 1}` : "";
        addRow({
          signal: theme.title,
          sample: theme.examples?.[0] || rowById.get(themeId)?.evidence,
          evidenceIds: [themeId, ...matchingEvidenceIdsForTheme(theme, evidenceLedger)],
          explains: moduleSignalExplanation(moduleId, theme),
          boundary: themeBoundary(moduleId, theme)
        });
      }
    };

    const addVideoRows = (videos, limit = 3, explains = "说明外部传播如何包装产品承诺、演示动作或用户想象。") => {
      for (const video of videos.slice(0, limit)) {
        const videoIndex = evidence.videoSamples.indexOf(video);
        addRow({
          signal: video.title || `TT 素材 ${videoIndex + 1 || rows.length + 1}`,
          sample: video.summary || video.title,
          evidenceIds: videoIndex >= 0 ? [`V${videoIndex + 1}`] : [],
          explains,
          boundary: "素材是增长叙事，不等同于真实体验，需要和评论或实测对照。"
        });
      }
    };

    const addDataRows = (items, limit = 4, explains = "作为市场规模、趋势或时间窗口径入口。") => {
      for (const item of items.slice(0, limit)) {
        const dataIndex = evidence.sensorImports.indexOf(item);
        addRow({
          signal: item.dataType || `数据 ${dataIndex + 1 || rows.length + 1}`,
          sample: `${item.rowCount || 0} 行${formatDateRange(item.dateRange) ? `，${formatDateRange(item.dateRange)}` : ""}${item.importedAt ? `，导入 ${item.importedAt}` : ""}`,
          evidenceIds: dataIndex >= 0 ? [`D${dataIndex + 1}`] : [],
          explains,
          boundary: "CSV 口径只能说明数据覆盖，跨时间窗或跨类型比较前需要先对齐。"
        });
      }
    };

    const addReviewRows = (reviews, limit = 4, explains = "作为用户原话证据，可下钻判断任务、摩擦或风险。") => {
      for (const review of reviews.slice(0, limit)) {
        const reviewIndex = evidence.reviewSamples.indexOf(review);
        addRow({
          signal: review.rating ? `${review.rating} 星评论` : "商店评论",
          sample: review.text,
          evidenceIds: reviewIndex >= 0 ? [`R${reviewIndex + 1}`] : [],
          explains,
          boundary: "单条评论只能代表具体 case，需要和主题命中量或其他来源互证。"
        });
      }
    };

    const addTtCommentRows = (comments, limit = 3, explains = "作为受众反应，可验证素材承诺是否被追问、接受或质疑。") => {
      for (const comment of comments.slice(0, limit)) {
        const commentIndex = evidence.ttCommentSamples.indexOf(comment);
        addRow({
          signal: comment.likeCount ? `TT 评论 赞 ${comment.likeCount}` : "TT 评论",
          sample: comment.text,
          evidenceIds: commentIndex >= 0 ? [`C${commentIndex + 1}`] : [],
          explains,
          boundary: "TT 评论代表素材受众反应，不等同于商店内真实留存体验。"
        });
      }
    };

    const addArticleRows = (articles, limit = 3, explains = "作为外部叙事入口，帮助识别产品承诺。") => {
      for (const article of articles.slice(0, limit)) {
        const articleIndex = evidence.articleSamples.indexOf(article);
        addRow({
          signal: article.title || `文章 ${articleIndex + 1 || rows.length + 1}`,
          sample: article.excerpt || article.sourceName || article.title,
          evidenceIds: articleIndex >= 0 ? [`A${articleIndex + 1}`] : [],
          explains,
          boundary: "外部叙事只能说明承诺或背景，需要与用户声音、数据或体验对照。"
        });
      }
    };

    const addStoreScreenshotRows = (items = [], limit = 3) => {
      for (const item of items.slice(0, limit)) {
        const screenshotIndex = evidence.storeScreenshots.indexOf(item);
        addRow({
          signal: item.platform ? `商店 feature 图（${item.platform}）` : "商店 feature 图",
          sample: item.alt || item.imageUrl || item.thumbnailUrl || "商店截图待视觉识别",
          evidenceIds: screenshotIndex >= 0 ? [`S${screenshotIndex + 1}`] : [],
          explains: "作为官方痛点和产品卖点入口，用来和用户评论里的真实痛点对照。",
          boundary: "feature 图代表官方表达，不等同于用户实际完成任务的体验。"
        });
      }
    };

    const addPaywallRows = (items = [], limit = 3) => {
      for (const item of items.slice(0, limit)) {
        const paywallIndex = evidence.paywallSamples.indexOf(item);
        addRow({
          signal: item.appName || `Paywall ${paywallIndex + 1 || rows.length + 1}`,
          sample: item.imageUrl || item.pageUrl || "paywall 截图待视觉识别",
          evidenceIds: paywallIndex >= 0 ? [`P${paywallIndex + 1}`] : [],
          explains: "用于识别付费主卖点、免费/付费权益边界和付费触发位置。",
          boundary: "paywall 能说明产品试图卖什么，不能直接说明用户觉得价格是否合理。"
        });
      }
    };

    const addCategoryRankingRows = (items = [], limit = 6) => {
      for (const item of items.slice(0, limit)) {
        const rankingIndex = evidence.categoryRanking?.rows?.indexOf(item) ?? -1;
        addRow({
          signal: `#${item.rank || rankingIndex + 1} ${item.appName || item.unifiedName || "Unknown"}`,
          sample: `90天收入 ${formatMoneyShort(item.revenueUsd90d)}，下载 ${formatNumberShort(item.downloads90d)}${item.localAppId ? `，已入库 ${item.localAppName || item.localAppId}` : "，未入库，可去 Sensor Tower 搜索并导入"}`,
          evidenceIds: rankingIndex >= 0 ? [`K${rankingIndex + 1}`] : [],
          explains: "用于确定垂类竞品池、目标 app 所处位置，以及哪些榜单对象需要补采。",
          boundary: "榜单只能说明同类池和规模位置，不能直接推出产品优劣。"
        });
      }
    };

    const topThemes = evidence.themeSummary.slice(0, 4);

    if (moduleId === "anomaly_signal") {
      addDataRows(evidence.sensorImports.filter((item) => /download|revenue|active|usage|category/i.test(item.dataType || "")), 6, "作为数据状态判断的规模、趋势和时间窗口径入口。");
      addCategoryRankingRows(evidence.categoryRanking?.rows || [], 4);
    } else if (moduleId === "market_overview") {
      addDataRows(evidence.sensorImports, 5);
      addThemeRows(topThemes, 3);
    } else if (moduleId === "country_market_split") {
      addDataRows(evidence.sensorImports.filter((item) => /download|revenue|active|usage/i.test(item.dataType || "")), 5, "作为国家下载、收入和 RPD 分工的口径入口。");
      addThemeRows(topThemes, 2);
    } else if (moduleId === "category_competitors") {
      addCategoryRankingRows(evidence.categoryRanking?.rows || [], 8);
      addDataRows(evidence.sensorImports.filter((item) => /category_rankings/i.test(item.dataType || "")), 1, "说明竞品榜单 CSV 的导入时间窗和行数。");
    } else if (moduleId === "growth_signals") {
      addVideoRows(evidence.videoSamples, 5, "用于拆 hook、演示动作和结果承诺。");
      addTtCommentRows(evidence.ttCommentSamples, 3);
    } else if (moduleId === "paid_points") {
      addPaywallRows(evidence.paywallSamples || [], 5);
      addDataRows(evidence.sensorImports.filter((item) => /revenue/i.test(item.dataType || "")), 4, "作为收入和高付费市场的口径入口。");
    } else if (moduleId === "user_reviews") {
      addThemeRows(evidence.themeSummary.filter((item) => ["value", "account", "bugs", "ads", "onboarding", "core_task", "ai"].includes(item.id)), 5);
      addReviewRows(evidence.reviewSamples, 10, "作为好评、差评或风险原话，用来区分价值感、流程、稳定性或商业化问题。");
      addTtCommentRows(evidence.ttCommentSamples, 4, "作为外部受众反馈，可补充用户对价格、功能或结果的直接反应。");
    } else if (moduleId === "user_pain_points") {
      addStoreScreenshotRows(evidence.storeScreenshots || [], 4);
      addThemeRows(topThemes, 5);
      addReviewRows(evidence.reviewSamples, 3, "作为用户 case 原话，可拆任务、心理摩擦和替代方案。");
      addTtCommentRows(evidence.ttCommentSamples, 2, "作为期待或追问型 case 的受众语言。");
      addPaywallRows(evidence.paywallSamples || [], 1);
    } else if (moduleId === "founder_company") {
      addArticleRows(evidence.articleSamples.filter((item) => /创始人|founder|融资|funding|raised|acquired|收购|公司|developer|CEO|PR|press|上市|估值|valuation/i.test(`${item.title || ""} ${item.excerpt || ""}`)), 5, "作为公司、创始人、融资或 PR 背景来源。");
    } else {
      addThemeRows(topThemes, 4);
      addVideoRows(evidence.videoSamples, 3);
    }

    if (["experience", "user_pain_points"].includes(moduleId)) {
      for (const doc of evidence.experienceDocs.slice(0, 3)) {
        const docIndex = evidence.experienceDocs.indexOf(doc);
        addRow({
          signal: doc.title,
          sample: doc.excerpt || doc.headings?.join(" / ") || doc.path,
          evidenceIds: docIndex >= 0 ? [`X${docIndex + 1}`] : [],
          explains: "作为人工体验判断的主轴，验证外部承诺是否被产品流程接住。",
          boundary: "体验文档代表实测路径，不自动代表全部用户。"
        });
      }
    }

    if (!rows.length) {
      const fallback = moduleBreakdown.find((group) => group.items?.length);
      const fallbackId = evidenceLedger[0]?.id;
      addRow({
        signal: fallback?.title || "待下钻信号",
        sample: fallback?.items?.[0] || evidenceLedger[0]?.evidence || "暂无可下钻样本",
        evidenceIds: fallbackId ? [fallbackId] : [],
        explains: "当前只能作为候选分析入口。",
        boundary: "需要补充原文、评论或数据样本后再提升置信度。"
      });
    }

    return rows.slice(0, 8);
  }

  function matchingEvidenceIdsForTheme(theme = {}, evidenceLedger = []) {
    const examples = normalizeText((theme.examples || []).join(" "));
    const title = normalizeText(theme.title);
    return evidenceLedger
      .filter((row) => ["商店评论", "TT 评论"].includes(row.type))
      .filter((row) => {
        const text = normalizeText(`${row.signal} ${row.evidence}`);
        return examples && text && (examples.includes(text.slice(0, 18)) || text.includes(examples.slice(0, 18)) || title.includes(row.signal));
      })
      .map((row) => row.id)
      .slice(0, 3);
  }

  function moduleSignalExplanation(moduleId, theme = {}) {
    const map = {
      anomaly_signal: `可作为数据状态入口，但必须回到下载、收入、活跃或榜单数据验证。`,
      user_pain_points: `可拆成用户任务、心理摩擦、替代方案和原话证据。`,
      experience: `可作为体验实测的检查清单，但最终判断要回到你的路径记录。`,
      growth_signals: `可判断素材承诺是否被受众接受或质疑。`,
      paid_points: `可判断 paywall 是否锁住核心价值、制造权益边界或解释高付费市场。`,
      category_competitors: `可确定同品类竞品池和补采优先级。`,
      user_reviews: `可识别会破坏核心承诺的结构性风险或价值感来源。`,
      country_market_split: `可解释不同国家承担下载、收入或高 RPD 的分工。`,
      market_overview: `可解释数据变化背后的用户质量、口碑或商业化阻力。`,
      founder_company: `可判断公司/创始人/融资线索是否能解释产品路线。`
    };
    return map[moduleId] || `可作为“${theme.title}”的下钻入口。`;
  }

  function themeBoundary(moduleId, theme = {}) {
    const count = Number(theme.count || 0);
    const lowCount = count > 0 && count < 5 ? "命中量偏小，不能单独推成总体结论。" : "";
    const needsExperience = ["user_pain_points", "experience"].includes(moduleId)
      ? "仍需体验文档验证真实路径。"
      : "";
    return [lowCount || "代表高频信号，但仍要看样本来源和时间窗。", needsExperience].filter(Boolean).join(" ");
  }

  function renderSignalDrilldowns(rows = []) {
    if (!rows.length) return ["- 暂无可下钻样本。"];
    return [
      "| 信号 | 样本 / 原文 | 来源证据 | 能说明什么 | 边界 |",
      "| --- | --- | --- | --- | --- |",
      ...rows.map((item) => `| ${escapeMarkdownTable(item.signal)} | ${escapeMarkdownTable(item.sample)} | ${escapeMarkdownTable(item.evidenceIds.join("、"))} | ${escapeMarkdownTable(item.explains)} | ${escapeMarkdownTable(item.boundary)} |`)
    ];
  }

  function renderEvidenceChainIndex(judgmentRows = [], evidenceLedger = []) {
    if (!judgmentRows.length) return ["- 暂无证据链索引。"];
    const evidenceById = new Map(evidenceLedger.map((item) => [item.id, item]));
    return [
      "| 可写位置 | 判断摘要 | 核心证据链 | 引用边界 |",
      "| --- | --- | --- | --- |",
      ...judgmentRows.map((row) => {
        const chain = row.evidenceIds
          .map((id) => formatEvidenceChainItem(id, evidenceById.get(id)))
          .filter(Boolean)
          .join("；");
        return `| ${escapeMarkdownTable(row.useInReport || "正式报告备选判断")} | ${escapeMarkdownTable(truncateText(row.judgment || "", 92))} | ${escapeMarkdownTable(chain || "待补证据")} | ${escapeMarkdownTable(inferEvidenceBoundary(row, evidenceById))} |`;
      })
    ];
  }

  function formatEvidenceChainItem(id, evidence = {}) {
    const signal = normalizeText(evidence.signal || evidence.type || "");
    const detail = normalizeText(evidence.evidence || "");
    if (!id) return "";
    return `${id}${signal ? ` ${truncateText(signal, 28)}` : ""}${detail ? `：${truncateText(detail, 64)}` : ""}`;
  }

  function inferEvidenceBoundary(row = {}, evidenceById = new Map()) {
    const ids = row.evidenceIds || [];
    const types = new Set(ids.map((id) => id.slice(0, 1)));
    const boundaries = [];
    if (!types.has("X")) boundaries.push("不含人工体验，体验结论需另补");
    if (!types.has("D")) boundaries.push("不可单独证明规模");
    if (!types.has("R") && !types.has("C") && !types.has("T")) {
      boundaries.push(types.has("X") ? "体验证据需外部材料互证" : "主要说明外部叙事，需另接用户反馈");
    }
    if (ids.some((id) => id.startsWith("N"))) boundaries.push("含噪声素材，仅作排除依据");
    if (row.confidence === "low") boundaries.push("低置信度");
    const hasEvidence = ids.some((id) => evidenceById.has(id));
    if (!hasEvidence) boundaries.push("证据待补");
    return boundaries.length ? boundaries.join("；") : "可作为正文判断候选";
  }

  function buildRepeatedSignals(moduleId, evidence) {
    const themeLines = evidence.themeSummary.slice(0, 6).map((item) => `${item.title}：命中 ${item.count} 条；代表表达：${item.examples[0] || "暂无样本"}`);
    const moduleLines = {
      market_overview: [
        ...evidence.sensorImports.map((item) => `${item.dataType || "unknown"} 数据已有 ${item.rowCount || 0} 行，可作为市场概览的基础口径。`),
        ...(evidence.sensorNoDataSignals || []).map((item) => `${item.label} 在 ST 当前口径下无可用数据，优先按“低于 ST 可见/估算阈值”处理，不当作采集失败。`),
        ...(evidence.sensorFailureSignals || []).map((item) => `${item.label} 采集失败：${item.error || "未记录原因"}。这类信号不能解释为量少。`)
      ],
      country_market_split: [
        ...(evidence.countryMarket?.topRevenueCountries || []).slice(0, 3).map((item) => `收入市场：${item.country} 收入 ${formatMoneyShort(item.revenueUsd)}，下载 ${formatNumberShort(item.downloads)}。`),
        ...(evidence.countryMarket?.topRpdCountries || []).slice(0, 3).map((item) => `高 RPD：${item.country} $${Number(item.revenuePerDownloadUsd || 0).toFixed(2)}。`)
      ],
      category_competitors: (evidence.categoryRanking?.rows || []).slice(0, 6).map((item) => `竞品榜 #${item.rank} ${item.appName || item.unifiedName || "Unknown"}：${item.localAppId ? "已入库" : "未入库"}。`),
      user_pain_points: [
        ...(evidence.storeScreenshots || []).slice(0, 3).map((item, index) => `商店 feature 图 ${index + 1} 可作为官方痛点表达入口。`),
        ...evidence.videoSamples.slice(0, 3).map((item) => `素材承诺指向：${item.title}`)
      ],
      growth_signals: evidence.videoSamples.slice(0, 6).map((item) => `高互动素材《${item.title}》保留了可拆解的 hook / 演示动作，播放 ${item.viewCount || 0}。`),
      paid_points: [
        ...(evidence.paywallSamples || []).slice(0, 3).map((item) => `paywall 样本：${item.appName || item.imageUrl || item.pageUrl}。`),
        ...(evidence.countryMarket?.topRpdCountries || []).slice(0, 3).map((item) => `高付费市场：${item.country} RPD $${Number(item.revenuePerDownloadUsd || 0).toFixed(2)}。`)
      ],
      experience: evidence.experienceDocs.map((item) => `体验材料《${item.title}》可以作为人工判断主轴。`),
      founder_company: evidence.articleSamples.slice(0, 4).map((item) => `公司/创始人线索：《${item.title}》。`)
    };
    return [...(moduleLines[moduleId] || []), ...themeLines].filter(Boolean).slice(0, 8);
  }

  function buildAnomalySignals(moduleId, counts, evidence) {
    const signals = [];
    const topTheme = evidence.themeSummary[0];
    if (topTheme?.count) {
      signals.push(`${topTheme.title} 是当前最集中的用户信号，命中 ${topTheme.count} 条，优先检查它是否解释核心口碑阻力。`);
    }
    if (counts.reviewRows > 0 && evidence.reviewSamples.length === 0) {
      signals.push(`评论导入有 ${counts.reviewRows} 行，但当前样本读取为空，需要检查 parsedPath 或字段映射。`);
    }
    if (counts.ttVideos >= 5 && counts.ttComments === 0) {
      signals.push(`TT 素材数量足够但评论缺失，增长信号只能看创作者表达，暂时看不到受众反应。`);
    }
    if (counts.ttVideosNoisy > 0) {
      signals.push(`有 ${counts.ttVideosNoisy} 条 TT 素材疑似错绑或弱相关，增长/定位判断已先排除这些素材，避免高播放噪声污染结论。`);
    }
    if (moduleId === "paid_points" && evidence.paywallSamples?.length && !evidence.countryMarket?.topRpdCountries?.length) {
      signals.push("已有 paywall 图但缺少可计算的高 RPD 市场，付费点可以写权益结构，不能写市场付费强弱。");
    }
    if (moduleId === "category_competitors" && counts.categoryRankingRows < 10) {
      signals.push("竞品榜单行数偏少，当前更适合做补采入口，不适合做完整竞品格局。");
    }
    if (moduleId === "market_overview" && evidence.sensorNoDataSignals?.length) {
      signals.push(`有 ${evidence.sensorNoDataSignals.length} 个 Sensor Tower 数据项返回 0 行，应解释为当前筛选条件下 ST 无可用数据或低于可见阈值，不写成采集失败。`);
    }
    if (moduleId === "market_overview" && evidence.sensorFailureSignals?.length) {
      signals.push(`有 ${evidence.sensorFailureSignals.length} 个 Sensor Tower 采集失败项，应解释为采集链路异常或导出失败，不写成量少无数据。`);
    }
    if (moduleId === "country_market_split" && !evidence.countryMarket?.topRevenueCountries?.length) signals.push("国家收入/下载无法配对时，不要硬写国家分工。");
    return signals;
  }

  function buildSupportedJudgments(moduleId, counts, evidence, playbook) {
    const topTheme = evidence.themeSummary[0];
    const secondTheme = evidence.themeSummary[1];
    const hasMarket = Number(counts.marketData || 0) > 0;
    const hasVoice = Number(counts.userVoice || 0) > 0;
    const hasVideos = Number(counts.ttVideos || 0) > 0;
    const hasExperience = Number(counts.experienceDocs || 0) > 0;
    const templates = {
      anomaly_signal: [
        hasMarket ? "本模块只判断市场数据状态，优先看近 12 个月下载、收入和活跃变化。" : "缺少市场/规模数据时，只能输出数据不足，不写状态结论。",
        evidence.categoryRanking?.rows?.length ? "近 90 天垂类榜单只用于说明当前位置，不能替代 12 个月趋势。" : "",
        evidence.countryMarket?.topRevenueCountries?.length ? "国家分布用于判断收入基本盘和下载/收入错配，不延展到产品机制。" : ""
      ],
      market_overview: [
        `市场概览首先要确认数据口径：当前有 ${counts.sensorImports || 0} 份 Sensor Tower 导入，覆盖 ${evidence.dataTypes?.join("、") || "未知类型"}。`,
        "下载、收入、活跃和评论需要按时间窗对齐；不同时间窗的数据只能说明覆盖，不能直接拼成趋势。",
        hasVoice ? "评论数据可解释市场表现背后的用户质量，但不能替代下载、收入或活跃趋势。" : "",
        "下一步应优先计算收入/下载错配、国家分布和 RPD，而不是只列 CSV 行数。"
      ],
      user_pain_points: [
        evidence.storeScreenshots?.length ? "商店 feature 图可以作为官方痛点表达入口，但需要 OCR/视觉识别后再提炼具体文案。" : "缺少商店 feature 图时，官方痛点只能从商店描述、文章或素材标题推断。",
        topTheme ? `用户声音里最集中的痛点信号是“${topTheme.title}”，需要和官方商店卖点对照。` : "评论和 TT 评论尚未形成稳定痛点聚类。",
        hasVideos ? "TT 素材可说明增长内容在放大哪种痛点或结果承诺，但不能单独代表真实体验。" : "",
        hasExperience ? "体验文档可以验证痛点是否被产品路径真正解决。" : "缺少体验文档时，痛点模块应保留“待体验验证”。"
      ],
      country_market_split: [
        evidence.countryMarket?.topRevenueCountries?.length ? `收入 Top 市场包括：${evidence.countryMarket.topRevenueCountries.slice(0, 5).map((item) => `${item.country} ${formatMoneyShort(item.revenueUsd)}`).join("、")}。` : "还没有可计算的国家收入分布。",
        evidence.countryMarket?.topDownloadCountries?.length ? `下载 Top 市场包括：${evidence.countryMarket.topDownloadCountries.slice(0, 5).map((item) => `${item.country} ${formatNumberShort(item.downloads)}`).join("、")}。` : "还没有可计算的国家下载分布。",
        "国家分工只写 RPD 或下载分母下的付费强度 proxy，不写 ARPU。"
      ],
      category_competitors: [
        evidence.categoryRanking?.rows?.length ? `当前垂类榜单有 ${evidence.categoryRanking.rows.length} 个 app，可直接作为竞品采集入口。` : "还没有 ST 垂类竞品榜。",
        evidence.categoryRanking?.rows?.some((item) => !item.localAppId) ? "榜单里存在未入库 app，应在页面提示去 Sensor Tower 搜索并导入详情页。" : "榜单 app 基本已有本地匹配。",
        "这个模块先列榜单和采集缺口，不做硬竞品优劣判断。"
      ],
      experience: [
        hasExperience ? "体验模块应以你的实测路径为主线，外部评论和素材只做验证或反证。" : "体验模块还缺你的体验 Markdown，不能生成强体验判断。",
        hasVideos ? "TT 素材可提供用户进入产品前的期待，用来对照真实使用路径。" : "",
        hasVoice ? "评论样本可提示体验重点检查项，如注册、核心任务、AI 识别、稳定性、付费触发或隐私权限。" : "",
        "体验结论必须写具体任务路径，不能写泛泛的“好用/不好用”。"
      ],
      growth_signals: [
        hasVideos ? `增长模块应从 ${counts.ttVideos || 0} 条相关 TT 素材中拆 hook、演示动作、结果承诺和评论反应。` : "缺少相关 TT 素材，增长模块不宜生成强判断。",
        topTheme ? `素材里的承诺需要和“${topTheme.title}”这种真实用户信号互相校验。` : "",
        counts.ttVideosNoisy ? `有 ${counts.ttVideosNoisy} 条疑似噪声素材，增长判断必须先排除错绑高播放内容。` : "",
        counts.ttComments ? "TT 评论能补足受众是否买账、是否追问教程、是否表达风险顾虑。" : "缺少 TT 评论时，只能写创作者表达，不能写受众反馈。"
      ],
      paid_points: [
        evidence.paywallSamples?.length ? "已有 paywall 图，可识别主卖点和付费权益边界。" : "缺少 paywall 图时，只能列 IAP/收入和高付费市场，不能写付费点。",
        evidence.countryMarket?.topRpdCountries?.length ? `高 RPD 市场包括：${evidence.countryMarket.topRpdCountries.slice(0, 4).map((item) => `${item.country} $${item.revenuePerDownloadUsd.toFixed(2)}`).join("、")}。` : "缺少可计算的高 RPD 市场。",
        "本模块不判断价格满意度，不推续费率、LTV 或 CAC。"
      ],
      user_reviews: [
        topTheme ? `评论里最集中的主题是“${topTheme.title}”，可作为口碑切口。` : "评论尚未形成稳定主题。",
        secondTheme ? `第二层主题是“${secondTheme.title}”，可作为补充好评/差评或风险信号。` : "",
        hasVoice ? "当前用户声音口径足够做主题归纳，但不要把单条极端评论当整体结论。" : "",
        "评论模块应拆好评、差评和风险，不做泛泛正负面比例。"
      ],
      founder_company: [
        counts.companySources ? `已有 ${counts.companySources} 条公司/创始人/融资相关文章，可提取背景线索。` : "没有公司/创始人/融资材料时，本模块不应生成强判断。",
        "只引用已录入文章里的事实，不补写外部融资或履历。",
        "公司背景只有能解释产品路线、增长动作或商业化选择时才进入正式报告。"
      ]
    };
    return (templates[moduleId] || [`本模块当前可围绕“${playbook.focus}”展开，但每条判断必须回到证据地图。`])
      .map(normalizeText)
      .filter(Boolean)
      .slice(0, 7);
  }

  function buildModuleBreakdown(moduleId, evidence, counts) {
    const builders = {
      anomaly_signal: buildDataStatusBreakdown,
      market_overview: buildMarketOverviewBreakdown,
      country_market_split: buildCountryMarketSplitBreakdown,
      category_competitors: buildCategoryCompetitorsBreakdown,
      user_pain_points: buildUserPainPointsBreakdown,
      experience: buildExperienceBreakdown,
      growth_signals: buildGrowthSignalsBreakdown,
      paid_points: buildPaidPointsBreakdown,
      user_reviews: buildUserReviewsBreakdown,
      founder_company: buildFounderCompanyBreakdown
    };
    return builders[moduleId]?.(evidence, counts) || [{
      title: "分析切面",
      items: ["当前模块还没有专属拆解器，先使用通用证据地图和信号判断。"]
    }];
  }

  function buildDataStatusBreakdown(evidence, counts) {
    const ranking = evidence.categoryRanking;
    const country = evidence.countryMarket || {};
    return [
      {
        title: "数据状态",
        items: [
          counts.marketData ? `已有 ${counts.marketData} 类市场/规模数据，可判断下载、收入、活跃和榜单位置。` : "缺少市场/规模数据，当前只能输出数据不足。",
          evidence.sensorNoDataSignals?.length ? `另有 ${evidence.sensorNoDataSignals.length} 个 ST 数据项为 0 行，按“当前筛选条件无可用数据 / 低于 ST 可见阈值”记录。` : "",
          evidence.sensorFailureSignals?.length ? `另有 ${evidence.sensorFailureSignals.length} 个 ST 数据项采集失败，按“采集失败 / 需重试”记录，不能视为低量级无数据。` : "",
          ranking?.rows?.length ? `近 90 天垂类榜单有 ${ranking.rows.length} 个 app，可用于判断当前位置。` : "缺少近 90 天垂类榜单时，不写榜单位置。",
          country.topRevenueCountries?.length ? `国家收入 Top 市场包括：${country.topRevenueCountries.slice(0, 3).map((item) => `${item.country} ${formatMoneyShort(item.revenueUsd)}`).join("、")}。` : "缺少国家收入/下载配对时，不写国家基本盘。"
        ].filter(Boolean)
      },
      {
        title: "数据结论",
        items: [
          "每条结论必须先写判断，再用下载、收入、活跃、榜单或国家分布数据佐证。",
          "近 12 个月是主趋势口径，近 90 天榜单只说明当前位置。",
          "本模块不解释产品机制、用户痛点、体验感受或付费原因。"
        ]
      }
    ];
  }

  function buildMarketOverviewBreakdown(evidence) {
    return [
      {
        title: "数据覆盖",
        items: [
          ...evidence.sensorImports.map((item) => `${item.dataType || "unknown"}：${item.rowCount || 0} 行，${formatDateRange(item.dateRange) || "未知时间窗"}`),
          ...(evidence.sensorNoDataSignals || []).map((item) => `${item.label}：0 行，${item.explanation}`),
          ...(evidence.sensorFailureSignals || []).map((item) => `${item.label}：采集失败，${item.error || "未记录原因"}`)
        ].slice(0, 10)
      },
      {
        title: "读数顺序",
        items: [
          "先确认下载、收入、活跃、评论是否在同一时间窗，避免把不同口径拼成趋势。",
          "如果收入行数和下载行数都足够，下一步应计算收入/下载错配、国家分布和 RPD。",
          "评论数据可作为市场表现的定性补充，不能替代下载或收入趋势。"
        ]
      }
    ];
  }

  function buildCountryMarketSplitBreakdown(evidence) {
    const market = evidence.countryMarket || {};
    return [
      {
        title: "国家分工",
        items: [
          ...(market.topRevenueCountries || []).slice(0, 6).map((item) => `收入：${item.country} ${formatMoneyShort(item.revenueUsd)}，收入占比 ${(Number(item.revenueShare || 0) * 100).toFixed(1)}%，下载 ${formatNumberShort(item.downloads)}。`),
          ...(market.topDownloadCountries || []).slice(0, 6).map((item) => `下载：${item.country} ${formatNumberShort(item.downloads)}，下载占比 ${(Number(item.downloadShare || 0) * 100).toFixed(1)}%，收入 ${formatMoneyShort(item.revenueUsd)}。`)
        ].slice(0, 10)
      },
      {
        title: "付费强度",
        items: (market.topRpdCountries || []).slice(0, 8).map((item) => `${item.country}：RPD $${Number(item.revenuePerDownloadUsd || 0).toFixed(2)}，收入/下载占比倍数 ${Number(item.revenueToDownloadShareRatio || 0).toFixed(2)}。`)
      },
      {
        title: "读法边界",
        items: [
          `时间窗口：${formatDateRange(market.dateRange || {}) || "未知"}`,
          "这里只能用收入/下载计算 RPD 或付费强度 proxy；没有国家级 MAU/DAU 时不要写 ARPU。",
          "收入国家和下载国家不一致时，优先解释市场分工，而不是简单说哪个国家表现好。"
        ]
      }
    ];
  }

  function buildCategoryCompetitorsBreakdown(evidence) {
    const rows = evidence.categoryRanking?.rows || [];
    const missing = rows.filter((item) => !item.localAppId);
    return [
      {
        title: "榜单位置",
        items: rows.slice(0, 12).map((item) => `#${item.rank} ${item.appName || item.unifiedName || "Unknown"}：90天收入 ${formatMoneyShort(item.revenueUsd90d)}，下载 ${formatNumberShort(item.downloads90d)}${item.localAppId ? `，已入库 ${item.localAppName || item.localAppId}` : "，未入库"}。`)
      },
      {
        title: "未入库竞品",
        items: missing.length
          ? missing.slice(0, 12).map((item) => `${item.appName || item.unifiedName || "Unknown"}（${item.publisherName || "未知开发者"}）：建议去 Sensor Tower 搜索该 app 并导入 overview / downloads / revenue / reviews。`)
          : ["榜单 Top app 暂无明显未入库对象。"]
      },
      {
        title: "使用边界",
        items: [
          `榜单口径：${evidence.categoryRanking?.categoryName || "同品类应用"}，${formatDateRange(evidence.categoryRanking?.dateRange || {}) || "未知时间窗"}。`,
          "这个模块先做竞品池和补采入口，不直接写产品优劣结论。",
          "真正进入正式报告的竞品，应再按用户任务、付费强度、国家分工和增长表达筛选 2-4 个。"
        ]
      }
    ];
  }

  function buildUserPainPointsBreakdown(evidence) {
    const themes = evidence.themeSummary.slice(0, 5);
    return [
      {
        title: "官方痛点",
        items: [
          ...(evidence.storeScreenshots || []).slice(0, 6).map((item, index) => `商店 feature 图 ${index + 1}${item.platform ? `（${item.platform}）` : ""}：${item.alt || item.imageUrl || "待 OCR/视觉识别提取文案"}`),
          ...evidence.articleSamples.slice(0, 3).map((item) => `文章/PR：《${item.title}》${item.excerpt ? `：${truncateText(item.excerpt, 100)}` : ""}`),
          ...evidence.videoSamples.slice(0, 3).map((item) => `TT 素材：《${item.title}》：${extractPromiseText(item)}`)
        ].slice(0, 10)
      },
      {
        title: "用户痛点",
        items: themes.length
          ? themes.map((theme) => `${theme.title}：命中 ${theme.count} 条；代表表达：${theme.examples[0] || "暂无样本"}`)
          : ["评论和 TT 评论暂未形成稳定痛点主题。"]
      },
      {
        title: "痛点边界",
        items: [
          "商店 feature 图代表官方想卖的痛点，不等于用户真实痛点。",
          "评论和 TT 评论代表主动表达者，不等于全部用户；适合用来发现痛点类型。",
          "paywall 如果锁住同一个痛点，说明该痛点也被产品当成付费点。"
        ]
      }
    ];
  }

  function buildPaidPointsBreakdown(evidence) {
    const market = evidence.countryMarket || {};
    return [
      {
        title: "Paywall 主卖点",
        items: (evidence.paywallSamples || []).length
          ? evidence.paywallSamples.map((item) => `${item.appName || "Paywall"}：${item.imageUrl || item.pageUrl}${item.collectedAt ? `，采集 ${item.collectedAt}` : ""}`)
          : ["缺少 paywall 图，暂时不能识别付费主卖点。"]
      },
      {
        title: "付费权益结构",
        items: [
          "需要从 paywall OCR/视觉识别提取：免费能做什么、付费解锁什么、核心能力是否被锁住。",
          ...(evidence.sensorImports || []).filter((item) => item.dataType === "revenue").slice(0, 3).map((item) => `收入数据：${item.rowCount || 0} 行，${formatDateRange(item.dateRange) || "未知时间窗"}`)
        ]
      },
      {
        title: "高付费市场",
        items: (market.topRpdCountries || []).slice(0, 8).map((item) => `${item.country}：RPD $${Number(item.revenuePerDownloadUsd || 0).toFixed(2)}，收入 ${formatMoneyShort(item.revenueUsd)}，下载 ${formatNumberShort(item.downloads)}。`)
      }
    ];
  }

  function buildUserReviewsBreakdown(evidence) {
    const themes = evidence.themeSummary || [];
    const risks = themes.filter((item) => ["account", "bugs", "ads", "onboarding", "ai"].includes(item.id));
    return [
      {
        title: "好评主题",
        items: evidence.reviewSamples
          .filter((item) => Number(item.rating || 0) >= 4)
          .slice(0, 6)
          .map((item) => `${item.rating || ""} 星：${item.text}`)
      },
      {
        title: "差评主题",
        items: evidence.reviewSamples
          .filter((item) => Number(item.rating || 0) && Number(item.rating || 0) <= 2)
          .slice(0, 6)
          .map((item) => `${item.rating || ""} 星：${item.text}`)
      },
      {
        title: "风险信号",
        items: risks.length
          ? risks.flatMap((item) => item.examples.slice(0, 2).map((example) => `${item.title}（${item.count}）：${example}`)).slice(0, 10)
          : ["评论里暂未命中明确风险主题。"]
      }
    ];
  }

  function buildFounderCompanyBreakdown(evidence) {
    const companyArticles = evidence.articleSamples.filter((item) => /创始人|founder|融资|funding|raised|acquired|收购|公司|developer|CEO|PR|press|上市|估值|valuation/i.test(`${item.title || ""} ${item.excerpt || ""}`));
    return [
      {
        title: "公司背景",
        items: companyArticles.length
          ? companyArticles.map((item) => `《${item.title}》：${item.excerpt || item.sourceName || "公司背景线索"}`)
          : ["已录入文章里暂未发现明确公司背景线索。"]
      },
      {
        title: "创始人/融资线索",
        items: companyArticles
          .filter((item) => /创始人|founder|融资|funding|raised|CEO|估值|valuation/i.test(`${item.title || ""} ${item.excerpt || ""}`))
          .map((item) => `《${item.title}》：${item.excerpt || "待阅读全文确认"}`)
      },
      {
        title: "创始人过往代表作",
        items: companyArticles
          .filter((item) => /previous|prior|past|earlier|portfolio|作品|代表作|过往|此前|曾经|履历|built|created|launched|school 42|42 school|coding school|工作室|开源|项目/i.test(`${item.title || ""} ${item.excerpt || ""}`))
          .map((item) => `《${item.title}》：${item.excerpt || "待阅读全文确认"}`)
      },
      {
        title: "引用边界",
        items: [
          "只引用已录入文章或 PR 稿明确写出的公司/创始人/融资事实。",
          "如果只是 PR 叙事，需要在正式报告里降低确定性。",
          "公司背景只有能解释产品路线、增长动作或商业化选择时才进入正文。"
        ]
      }
    ];
  }

  function buildPositioningBreakdown(evidence) {
    const storeOrArticle = evidence.articleSamples.slice(0, 3).map((item) => `外部叙事：《${item.title}》指向 ${truncateText(item.excerpt || item.title, 100)}`);
    const materialPromises = evidence.videoSamples.slice(0, 4).map((item) => `素材承诺：《${item.title}》呈现 ${extractPromiseText(item)}`);
    const userReality = evidence.themeSummary.slice(0, 4).map((item) => `用户现实：${item.title} 命中 ${item.count} 条。`);
    return [
      { title: "承诺侧", items: [...storeOrArticle, ...materialPromises].slice(0, 6) },
      { title: "现实侧", items: userReality },
      {
        title: "定位判断方式",
        items: [
          "定位要看官方承诺、核心任务和用户反馈是否一致。",
          "如果素材强调的结果和评论里反复出现的摩擦不一致，定位判断应转向承诺与体验的错配。"
        ]
      }
    ];
  }

  function buildUserCasesBreakdown(evidence) {
    const themes = evidence.themeSummary.slice(0, 5);
    return themes.map((theme) => ({
      title: theme.title,
      items: [
        `用户任务：${inferUserTask(theme.id)}。`,
        `心理摩擦：${inferFriction(theme.id)}。`,
        `替代方案：${inferAlternative(theme.id)}。`,
        `可用原话：${theme.examples[0] || "暂无"}`
      ]
    }));
  }

  function buildExperienceBreakdown(evidence) {
    return [
      {
        title: "体验材料",
        items: evidence.experienceDocs.length
          ? evidence.experienceDocs.map((item) => `${item.title}：${item.excerpt || item.path}`)
          : ["还没有体验 Markdown；这一模块应等待你的实测输入后再生成强判断。"]
      },
      {
        title: "体验文档结构",
        items: evidence.experienceDocs.length
          ? evidence.experienceDocs.flatMap((item) => [
            `${item.title} 的小标题：${item.headings?.length ? item.headings.join(" / ") : "未提取到标题"}`,
            item.modifiedAt ? `最后修改：${item.modifiedAt}` : ""
          ]).filter(Boolean)
          : ["补充体验 Markdown 后，这里会读取文档标题、小标题和摘要。"]
      },
      {
        title: "体验写作骨架",
        items: ["用户原任务", "首次进入和注册", "核心任务路径", "AI / 内容 / 数据反馈", "付费与商业化触点", "体验强点与弱点", "外部素材承诺是否成立"]
      }
    ];
  }

  function buildGrowthSignalsBreakdown(evidence) {
    return [
      {
        title: "Hook 类型",
        items: clusterVideoSignals(evidence.videoSamples, [
          { label: "教程型", pattern: /how to|cara|tutorial|怎么|如何|教|pakai|use/i },
          { label: "结果展示型", pattern: /result|before|after|journey|progress|transform|story|结果|变化|前后|改善|成功/i },
          { label: "警示型", pattern: /scam|fake|watch out|不要|nao usem|小心|骗子|위험/i },
          { label: "愿望型", pattern: /goal|dream|wish|want|finally|目标|想要|终于|希望|理想/i }
        ])
      },
      {
        title: "演示动作",
        items: clusterVideoSignals(evidence.videoSamples, [
          { label: "商店搜索/下载", pattern: /app store|google play|下载|下载安装|search|store|login/i },
          { label: "核心功能演示", pattern: /scan|track|log|record|upload|photo|camera|AI|识别|扫描|记录|拍照|上传|功能/i },
          { label: "结果反馈展示", pattern: /score|plan|report|summary|insight|result|分析|报告|计划|结果|反馈/i },
          { label: "风险提醒", pattern: /scam|fake|骗子|小心|不要用|threat|blackmail/i }
        ])
      },
      {
        title: "受众反馈",
        items: evidence.ttCommentSamples.slice(0, 6).map((item) => `${item.likeCount ? `赞 ${item.likeCount}：` : ""}${item.text}`)
      }
    ];
  }

  function buildMonetizationBreakdown(evidence) {
    const paidTheme = evidence.themeSummary.find((item) => item.id === "ads");
    const revenueRows = evidence.sensorImports.filter((item) => item.dataType === "revenue");
    const paidReviewEvidence = evidence.reviewSamples
      .filter((item) => /\bads?\b|\badds\b|\badvert|\bpay\b|\bpaid\b|subscription|广告|付费|订阅|收费|publicidad/i.test(item.text))
      .slice(0, 5)
      .map((item) => `评论证据：${item.text}`);
    return [
      {
        title: "收入证据",
        items: revenueRows.length
          ? revenueRows.map((item) => `revenue：${item.rowCount || 0} 行，${formatDateRange(item.dateRange) || "未知时间窗"}`)
          : ["没有收入 CSV，商业化强度不能硬判断。"]
      },
      {
        title: "付费/广告摩擦",
        items: [
          paidTheme ? `商业化相关用户信号 ${paidTheme.count} 条。` : "评论/素材里暂未形成明显商业化抱怨主题。",
          ...paidReviewEvidence
        ]
      },
      {
        title: "判断方式",
        items: ["商业化模块要把收入事实、付费触发点、用户反感放在一起看。", "如果用户把广告或付费当成核心体验阻力，它会影响定位和留存判断。"]
      }
    ];
  }

  function buildCompetitionBreakdown(evidence, counts) {
    const competitorMentions = [
      ...evidence.articleSamples.map((item) => `${item.title} ${item.excerpt}`),
      ...evidence.videoSamples.map((item) => `${item.title} ${item.summary}`),
      ...evidence.reviewSamples.map((item) => item.text)
    ].filter((text) => /Tinder|Hinge|Bumble|Duolingo|Reddit|HelloTalk|Tandem|竞品|替代|vs|versus/i.test(text));
    return [
      {
        title: "替代方案线索",
        items: competitorMentions.slice(0, 8).map((item) => truncateText(item, 180))
      },
      {
        title: "当前可比维度",
        items: [
          counts.categoryRankings >= 2 ? "已有竞品/替代线索，可以做有限对比。" : "竞品线索偏弱，当前只适合列候选，不适合写硬结论。",
          "优先比较用户任务、核心结果、上手成本、AI/数据可信度、商业化边界和国家分工。"
        ]
      }
    ];
  }

  function buildRisksBreakdown(evidence) {
    const riskThemes = evidence.themeSummary.filter((item) => ["value", "account", "bugs", "ads", "onboarding", "core_task", "ai"].includes(item.id));
    return [
      {
        title: "风险分类",
        items: riskThemes.map((item) => `${riskRiskLabel(item.id)}：${item.title}，命中 ${item.count} 条。`)
      },
      {
        title: "证据原话",
        items: riskThemes.flatMap((item) => item.examples.slice(0, 2).map((example) => `${item.title}：${example}`)).slice(0, 8)
      },
      {
        title: "边界判断",
        items: ["风险模块要区分产品机制、运营治理、版本 bug 和商业化策略。", "只有反复出现且会破坏核心承诺的风险，才值得进入正式报告主线。"]
      }
    ];
  }

  function clusterVideoSignals(samples, rules) {
    return rules.map((rule) => {
      const matched = samples.filter((item) => rule.pattern.test(`${item.title || ""} ${item.summary || ""}`));
      if (!matched.length) return "";
      const top = [...matched].sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))[0];
      return `${rule.label}：${matched.length} 条；代表素材《${top.title}》（播放 ${top.viewCount || 0}）。`;
    }).filter(Boolean);
  }

  function extractPromiseText(item = {}) {
    const text = normalizeText(item.summary || item.title);
    if (!text) return "暂未提取出明确承诺";
    if (/scam|fake|骗子|小心|不要/i.test(text)) return "安全/信任风险提醒";
    if (/app store|google play|下载|install|login/i.test(text)) return "下载安装和进入流程";
    if (/scan|track|log|record|camera|AI|识别|扫描|记录|拍照/i.test(text)) return "核心功能或 AI 识别演示";
    if (/result|report|summary|plan|score|结果|报告|计划|分析/i.test(text)) return "结果反馈或目标达成展示";
    return truncateText(text, 80);
  }

  function inferUserTask(themeId) {
    const map = {
      value: "想确认这个 app 是否真的能带来可感知的结果或效率提升",
      ads: "想顺畅完成核心任务，但被广告、订阅或付费触发打断",
      account: "想稳定使用账号、历史记录和付费权益",
      bugs: "想完成拍照、上传、识别、记录或同步等基础动作，但被功能问题打断",
      onboarding: "想快速上手并理解第一步该做什么",
      core_task: "想稳定完成记录、识别、计划、反馈等核心任务",
      ai: "想知道 AI 识别、推荐或自动化判断是否可靠"
    };
    return map[themeId] || "想完成这个 app 承诺的核心任务";
  }

  function inferFriction(themeId) {
    const map = {
      value: "用户不确定投入时间、数据或订阅后是否能得到足够回报",
      ads: "商业化打断感强，用户会把广告和付费视为体验阻力",
      account: "账号、历史记录或权益不稳定会破坏继续使用意愿",
      bugs: "基础功能不稳定会让用户怀疑产品是否可靠",
      onboarding: "第一步不清晰会让用户在看到价值前流失",
      core_task: "核心任务路径太重或结果不可信，会削弱使用习惯",
      ai: "用户不确定算法是否理解自己的真实输入或目标"
    };
    return map[themeId] || "任务路径里存在未定位的心理或操作摩擦";
  }

  function inferAlternative(themeId) {
    const map = {
      value: "回到手动方法、表格、笔记或更可信的垂类工具",
      ads: "卸载、寻找广告更少的替代 app，或只使用免费方案",
      account: "迁移到数据更稳定、账号体系更可信的工具",
      bugs: "换到更稳定的同类工具或回到手动记录",
      onboarding: "选择上手更快、引导更清楚的替代 app",
      core_task: "回到已有习惯工具，或选择更垂直的专业替代品",
      ai: "回到手动输入、人工判断或更透明的规则型工具"
    };
    return map[themeId] || "用户可能转向更熟悉、更低摩擦的替代方案";
  }

  function riskRiskLabel(themeId) {
    const map = {
      value: "价值感",
      account: "账号与数据",
      bugs: "功能稳定性",
      ads: "商业化反感",
      onboarding: "上手门槛",
      core_task: "核心任务",
      ai: "AI 可信度"
    };
    return map[themeId] || "其他风险";
  }

  function buildJudgmentCaveats(moduleId, counts, evidence) {
    const caveats = [];
    if (!counts.experienceDocs && ["anomaly_signal", "experience", "user_pain_points"].includes(moduleId)) {
      caveats.push("缺少你的体验实测，不能把外部承诺直接写成真实体验结论。");
    }
    if (!counts.marketData && ["anomaly_signal", "market_overview", "paid_points"].includes(moduleId)) {
      caveats.push("缺少市场或收入数据，不能判断规模、增长速度或商业化强度。");
    }
    if (!counts.ttComments && ["growth_signals", "user_pain_points"].includes(moduleId)) {
      caveats.push("缺少 TT 评论，暂时只能分析素材表达，不能判断受众是否买账。");
    }
    if (!evidence.articleSamples.length && ["user_pain_points", "category_competitors"].includes(moduleId)) {
      caveats.push("缺少外部文章或竞品材料，定位和竞品判断需要降低确定性。");
    }
    caveats.push("AI 或规则只能做证据编目和候选判断，正式报告仍需要人工选择主线。");
    return caveats;
  }

  function buildDraftParagraphs(moduleId, app, judgments, anomalies, evidence, moduleBreakdown = [], judgmentMatrix = []) {
    const name = displayAppName(app);
    const specialized = buildSpecializedDraftParagraphs(moduleId, name, evidence, moduleBreakdown);
    const refs = matrixRefs(judgmentMatrix);
    if (specialized.length) return appendDraftRefs(specialized, refs);

    const topTheme = evidence.themeSummary[0]?.title;
    const paragraph = [
      `${name} 这一模块目前最值得保留的不是单一结论，而是证据之间的张力。${judgments[1] || judgments[0] || ""}`,
      topTheme ? `从当前样本看，“${topTheme}”是反复出现的信号；它需要和产品体验、素材承诺以及数据表现放在同一张证据地图里判断。` : "当前还没有形成稳定高频主题，正式报告里应先写样本边界，再写可验证的局部发现。",
      anomalies[0] ? `尤其要注意：${anomalies[0]} 这类异常比平均描述更适合成为段落入口。` : "如果后续补充更多材料，应优先寻找异常变化，而不是扩写背景介绍。"
    ].filter(Boolean).join("");
    const moduleTail = {
      growth_signals: "增长部分可以继续拆 hook、演示动作、结果承诺和评论反应，避免只罗列爆款视频。",
      user_pain_points: "用户 case 部分适合用“任务 - 摩擦 - 替代方案 - 证据原话”的格式展开。",
      experience: "体验部分应以你的实测为主线，把外部评论和素材作为验证或反证。",
      market_overview: "市场概览部分要优先写清数据口径和时间窗口，再讨论规模或趋势。",
      category_competitors: "竞品部分只有在替代关系明确时才写硬对比，否则先写候选假设。"
    };
    return appendDraftRefs([paragraph, "", moduleTail[moduleId] ? `> 写作提醒：${moduleTail[moduleId]}` : ""].filter(Boolean), refs);
  }

  function appendDraftRefs(paragraphs, refs = []) {
    if (!refs.length) return paragraphs;
    return [
      ...paragraphs,
      "",
      `> 可引用证据：${refs.join("、")}`
    ];
  }

  function matrixRefs(rows = []) {
    return uniqueStrings(rows.flatMap((item) => item.evidenceIds || [])).slice(0, 8);
  }

  function buildSpecializedDraftParagraphs(moduleId, name, evidence, moduleBreakdown) {
    if (moduleId === "growth_signals") {
      const hook = firstBreakdownItem(moduleBreakdown, "Hook 类型");
      const action = firstBreakdownItem(moduleBreakdown, "演示动作");
      return [
        `${name} 的增长素材不应只按播放量排序，而要拆成 hook、演示动作和结果承诺。${hook || "现有素材需要继续按教程、对比、结果展示、风险提醒等类型聚类。"} 这样才能看清素材是在放大哪个用户任务或痛点。`,
        `${action || "素材里的演示动作需要继续拆成搜索下载、核心操作、结果反馈和付费触发。"} 如果后续写进正式报告，增长部分应把承诺、演示和评论反应放在同一段里。`
      ];
    }

    if (moduleId === "user_pain_points") {
      const official = firstBreakdownItem(moduleBreakdown, "官方痛点");
      const userPain = firstBreakdownItem(moduleBreakdown, "用户痛点");
      return [
        `${name} 的痛点模块应先把官方表达和用户原话分开。${official || "商店 feature 图能提供官方想强调的任务场景。"} ${userPain || "评论和 TT 评论负责验证用户真正卡在哪里。"}`,
        moduleBreakdown[1]?.items?.length
          ? `这个 case 的结构可以写成：${moduleBreakdown[1].items.slice(0, 3).join(" ")}`
          : "正式写作时建议固定使用“用户任务 - 心理摩擦 - 替代方案 - 原话证据”的结构。"
      ];
    }

    if (moduleId === "paid_points") {
      const paywall = firstBreakdownItem(moduleBreakdown, "Paywall 主卖点");
      const rights = firstBreakdownItem(moduleBreakdown, "付费权益结构");
      const market = firstBreakdownItem(moduleBreakdown, "高付费市场");
      return [
        `${name} 的付费点应从 paywall 本身出发，而不是从“嫌贵”评论倒推。${paywall || "当前还需要 paywall 图识别主卖点。"} ${rights || "权益结构需要继续拆免费边界和付费解锁项。"}`,
        `${market || "如果国家收入和下载能配对，可以补高 RPD 市场作为商业化强度参考。"} 本模块只判断卖点、权益边界和高付费市场，不推价格满意度、续费率、LTV 或 CAC。`
      ];
    }

    if (moduleId === "user_reviews") {
      const good = firstBreakdownItem(moduleBreakdown, "好评主题");
      const bad = firstBreakdownItem(moduleBreakdown, "差评主题");
      const risk = firstBreakdownItem(moduleBreakdown, "风险信号");
      return [
        `${name} 的评论模块要把喜欢什么和抱怨什么分开看。${good || "好评主题需要从高星评论里提炼价值来源。"} ${bad || "差评主题需要从低星评论里提炼核心摩擦。"}`,
        `${risk || "风险信号要继续按账号、稳定性、商业化、AI 可信度或隐私安全拆开。"} 单条评论只做 case，不直接代表总体。`
      ];
    }

    if (moduleId === "market_overview") {
      const coverage = firstBreakdownItem(moduleBreakdown, "数据覆盖");
      return [
        `${name} 的市场概览应先写数据口径，而不是直接写结论。${coverage || "当前已接入多类 Sensor Tower 数据。"} `,
        "下一步最有价值的是把下载、收入、活跃和评论放到同一时间窗里看，判断它是规模增长、商业化效率提升，还是单一市场/单一事件带来的波动。"
      ];
    }

    if (moduleId === "category_competitors") {
      const ranking = firstBreakdownItem(moduleBreakdown, "榜单位置");
      const missing = firstBreakdownItem(moduleBreakdown, "未入库竞品");
      return [
        `${name} 的竞品模块先以 Sensor Tower 垂类榜单为准。${ranking || "当前还需要导入同品类榜单。"} 这一步的价值是确定竞品池和规模位置。`,
        `${missing || "如果榜单里有未入库 app，页面应引导去 Sensor Tower 搜索并导入。"} 真正写正文时，再从榜单里挑 2-4 个和用户任务、国家分工或付费强度相关的对象。`
      ];
    }

    return [];
  }

  function firstBreakdownItem(groups, title) {
    return groups.find((group) => group.title === title)?.items?.find(Boolean) || "";
  }

  function buildModuleMindmap(definition, app, repeatedSignals, anomalySignals, judgments, moduleBreakdown = [], signalDrilldowns = []) {
    const mindmapDrilldowns = selectMindmapDrilldowns(definition.id, signalDrilldowns);
    const children = [
      ["样本边界", "来源", "缺口"],
      ["证据地图", "文章", "数据", "素材", "评论", "体验"],
      ["高频信号", ...repeatedSignals.slice(0, 3).map(shortMindmapNode)],
      ["专属拆解", ...moduleBreakdown.slice(0, 3).map((group) => shortMindmapNode(group.title))],
      ["信号下钻", ...mindmapDrilldowns.map(formatDrilldownMindmapNode)],
      ["数据状态信号", ...anomalySignals.slice(0, 3).map(shortMindmapNode)],
      ["可写判断", ...judgments.slice(0, 3).map(shortMindmapNode)]
    ];
    return [
      "mindmap",
      `  root((${escapeMindmapText(definition.title)}))`,
      `    ${escapeMindmapText(displayAppName(app))}`,
      ...children.flatMap(([parent, ...items]) => [
        `    ${escapeMindmapText(parent)}`,
        ...items.map((item) => `      ${escapeMindmapText(item)}`)
      ])
    ].join("\n");
  }

  function selectMindmapDrilldowns(moduleId, rows = []) {
    const selected = rows.slice(0, 4);
    const hasPrefixRequirement = (requirement) => {
      const alternatives = String(requirement).split("|").map((item) => item.trim()).filter(Boolean);
      return selected.some((row) => (row.evidenceIds || []).some((id) => alternatives.some((prefix) => id.startsWith(prefix))));
    };
    for (const requirement of MODULE_DRILLDOWN_REQUIRED_PREFIXES[moduleId] || []) {
      if (hasPrefixRequirement(requirement)) continue;
      const alternatives = String(requirement).split("|").map((item) => item.trim()).filter(Boolean);
      const match = rows.find((row) => (row.evidenceIds || []).some((id) => alternatives.some((prefix) => id.startsWith(prefix))));
      if (match && !selected.includes(match)) selected.push(match);
    }
    return selected.slice(0, 7);
  }

  function buildModuleSourceFingerprint(definition, app, counts, evidence) {
    const relevantEvidence = selectFingerprintEvidence(definition.id, evidence);
    const payload = stableFingerprintValue({
      moduleId: definition.id,
      templateVersion: REPORT_OUTPUT_TEMPLATE_VERSION,
      app: {
        id: normalizeText(app.id),
        name: displayAppName(app),
        bundleId: normalizeText(app.bundleId),
        sellerName: normalizeText(app.sellerName)
      },
      counts: selectFingerprintCounts(definition.id, counts),
      evidence: relevantEvidence
    });
    return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
  }

  function buildModuleSourceSummary(moduleId, counts = {}, evidence = {}) {
    const summary = {
      total: counts.total || 0,
      articles: counts.articles || 0,
      sensorImports: counts.sensorImports || 0,
      sensorNoData: counts.sensorNoData || 0,
      sensorFailures: counts.sensorFailures || 0,
      sensorDataTypes: evidence.dataTypes || [],
      reviewRows: counts.reviewRows || 0,
      reviewSamples: counts.reviewSamples || 0,
      ttVideosRelevant: counts.ttVideos || 0,
      ttVideosRaw: counts.ttVideosRaw || 0,
      ttVideosNoisy: counts.ttVideosNoisy || 0,
      ttComments: counts.ttComments || 0,
      qiaomuInsights: counts.qiaomuInsights || 0,
      experienceDocs: counts.experienceDocs || 0,
      countryMarketRows: counts.countryMarketRows || 0,
      categoryRankingRows: counts.categoryRankingRows || 0,
      storeScreenshots: counts.storeScreenshots || 0,
      paywalls: counts.paywalls || 0,
      topThemes: (evidence.themeSummary || []).slice(0, 5).map((item) => ({
        id: item.id,
        title: item.title,
        count: item.count
      }))
    };
    const moduleSpecific = {
      moduleId,
      readySources: {
        marketData: counts.marketData || 0,
        signalSources: counts.signalSources || 0,
        painPointSources: counts.painPointSources || 0,
        paidPointSources: counts.paidPointSources || 0,
        categoryRankings: counts.categoryRankings || 0,
        companySources: counts.companySources || 0
      }
    };
    return stableFingerprintValue({ ...summary, ...moduleSpecific });
  }

  function selectFingerprintCounts(moduleId, counts = {}) {
    const baseKeys = ["articles", "sensorImports", "sensorNoData", "sensorFailures", "marketData", "ttVideos", "ttVideosRaw", "ttVideosNoisy", "ttComments", "userVoice", "reviewRows", "experienceDocs", "appMetrics", "storeScreenshots", "paywalls", "categoryRankingRows", "countryMarketRows"];
    const moduleKeys = {
      anomaly_signal: ["signalSources"],
      market_overview: ["reviewImports"],
      country_market_split: ["countryMarketSources", "countryMarketRows"],
      category_competitors: ["categoryRankings", "categoryRankingRows"],
      user_pain_points: ["painPointSources", "reviewSamples", "tiktokCommentImports", "storeScreenshots", "paywalls"],
      experience: ["painPointSources"],
      growth_signals: ["tiktokCommentImports"],
      paid_points: ["paidPointSources", "paywalls", "countryMarketRows"],
      user_reviews: ["riskSources", "reviewImports"],
      founder_company: ["companySources"]
    };
    return Object.fromEntries(uniqueStrings([...baseKeys, ...(moduleKeys[moduleId] || [])]).map((key) => [key, Number(counts[key] || 0)]));
  }

  function selectFingerprintEvidence(moduleId, evidence = {}) {
    const common = {
      dataTypes: evidence.dataTypes || [],
      sensorImports: evidence.sensorImports || [],
      sensorNoDataSignals: evidence.sensorNoDataSignals || [],
      sensorFailureSignals: evidence.sensorFailureSignals || [],
      themeSummary: (evidence.themeSummary || []).map((item) => ({
        id: item.id,
        count: item.count,
        examples: (item.examples || []).slice(0, 3)
      }))
    };
    const byModule = {
      anomaly_signal: {
        articles: evidence.articleSamples || [],
        videos: evidence.videoSamples || [],
        reviews: evidence.reviewSamples || [],
        ttComments: evidence.ttCommentSamples || []
      },
      market_overview: {},
      country_market_split: {
        countryMarket: evidence.countryMarket || null
      },
      category_competitors: {
        categoryRanking: evidence.categoryRanking || null
      },
      user_pain_points: {
        storeScreenshots: evidence.storeScreenshots || [],
        paywallSamples: evidence.paywallSamples || [],
        articles: evidence.articleSamples || [],
        videos: evidence.videoSamples || [],
        reviews: evidence.reviewSamples || [],
        ttComments: evidence.ttCommentSamples || []
      },
      experience: {
        experienceDocs: (evidence.experienceDocs || []).map((item) => ({
          title: item.title,
          relativePath: item.relativePath || item.path,
          modifiedAt: item.modifiedAt,
          size: item.size,
          excerpt: item.excerpt,
          headings: item.headings
        })),
        videos: evidence.videoSamples || [],
        reviews: evidence.reviewSamples || []
      },
      growth_signals: {
        videos: evidence.videoSamples || [],
        noisyVideos: evidence.noisyVideoSamples || [],
        ttComments: evidence.ttCommentSamples || [],
        videoRelevance: evidence.videoRelevance || {}
      },
      paid_points: {
        paywallSamples: evidence.paywallSamples || [],
        countryMarket: evidence.countryMarket || null,
        sensorImports: (evidence.sensorImports || []).filter((item) => item.dataType === "revenue")
      },
      user_reviews: {
        reviews: evidence.reviewSamples || [],
        ttComments: evidence.ttCommentSamples || []
      },
      founder_company: {
        articles: evidence.companyArticleSamples || evidence.articleSamples || []
      }
    };
    if (moduleId === "founder_company") {
      return stableFingerprintValue(byModule.founder_company);
    }
    return stableFingerprintValue({ ...common, ...(byModule[moduleId] || {}) });
  }

  function stableFingerprintValue(value) {
    if (Array.isArray(value)) return value.map(stableFingerprintValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableFingerprintValue(value[key])]));
    }
    return value == null ? "" : value;
  }

  function auditModuleQuality(markdown, meta = {}, moduleId = "", options = {}) {
    return auditReportModuleOutput(markdown, meta, moduleId);
  }

  function auditReportModuleOutput(markdown, meta = {}, moduleId = "") {
    const issues = [];
    for (const section of REQUIRED_OUTPUT_SECTIONS) {
      if (!markdown.includes(section)) issues.push(`缺少章节：${section.replace(/^##\s*/, "")}`);
    }
    if (!/\| ID \| 类型 \| 信号 \| 证据摘要 \| 可支撑什么 \|/.test(markdown)) issues.push("缺少证据台账表");
    const report = extractSection(markdown, "## 正式正文", "## Source Pack 摘要") || "";
    if (!/^#\s+.+：/m.test(report)) issues.push("正式正文缺少标题");
    if (/##\s*(?:1\. 样本边界|3\. 证据地图|9\. 判断 - 证据矩阵|15\. 脑图)/.test(report)) issues.push("正式正文混入旧审计章节");
    const ledgerIds = extractEvidenceLedgerIds(markdown);
    if (!ledgerIds.size) issues.push("证据台账缺少可识别 ID");
    const reportIds = [...report.matchAll(new RegExp(`\\b(${EVIDENCE_ID_PATTERN_SOURCE}\\d+)\\b`, "g"))].map((match) => match[1]);
    const visibleReportIds = reportIds.filter(isVisibleReportEvidenceId);
    if (moduleRequiresVisibleCitations(moduleId) && !visibleReportIds.length) issues.push("正式正文缺少可见证据引用");
    const unknownIds = [...report.matchAll(/\b([BEM]\d+)\b/g)].map((match) => match[1]);
    if (unknownIds.length) issues.push(`正式正文使用了不存在的证据编号类型：${uniqueStrings(unknownIds).join("、")}`);
    const invalidReportIds = uniqueStrings(reportIds.filter((id) => ledgerIds.size && !ledgerIds.has(id))).slice(0, 12);
    if (invalidReportIds.length) issues.push(`正式正文引用不存在证据：${invalidReportIds.join("、")}`);
    if (Number(meta.templateVersion || 0) !== REPORT_OUTPUT_TEMPLATE_VERSION) {
      issues.push(`模板版本不是最新：${meta.templateVersion || "缺失"}`);
    }
    const metaContractIssues = validateReportOutputMetaContract(meta, moduleId);
    for (const issue of metaContractIssues) issues.push(`qualityContract ${issue}`);
    if (!meta.sourceFingerprint) issues.push("缺少 sourceFingerprint");
    if (!meta.sourceSummary || typeof meta.sourceSummary !== "object") {
      issues.push("缺少 sourceSummary");
    } else {
      if (!meta.sourceSummary.moduleId) issues.push("sourceSummary 缺少 moduleId");
      if (!Number.isFinite(Number(meta.sourceSummary.total))) issues.push("sourceSummary 缺少 total");
    }
    if (meta.aiStatus !== "ready" && !isPromptPendingMeta(meta)) issues.push(`AI 未 ready：${meta.aiStatus || "缺失"}`);
    if (!Array.isArray(meta.citations)) issues.push("缺少 citations");
    if (!meta.reportMarkdownPath) issues.push("缺少 reportMarkdownPath");
    if (moduleId === "founder_company") {
      for (const issue of auditFounderCompanyReportText(report, ledgerIds)) issues.push(issue);
    }
    if (["market_overview", "anomaly_signal", "category_competitors"].includes(moduleId)) {
      for (const issue of auditMarketReferenceUse(report)) issues.push(issue);
    }
    return {
      status: issues.length ? "failed" : "passed",
      issues
    };
  }

  function auditFounderCompanyOutput(markdown, meta = {}) {
    const base = auditReportModuleOutput(markdown, meta, "founder_company");
    return base;
  }

  function moduleRequiresVisibleCitations(moduleId = "") {
    return !["anomaly_signal", "market_overview", "country_market_split", "category_competitors"].includes(normalizeText(moduleId));
  }

  function isVisibleReportEvidenceId(id = "") {
    return !/^[DK]\d+$/i.test(normalizeText(id));
  }

  function auditMarketReferenceUse(report = "") {
    const issues = [];
    const rankingMisrefs = [...report.matchAll(/[^。\n]*(?:榜单|排名|第\s*\d+\s*位|第\s*\d+\s*名)[^。\n]*\b([RTC]\d+)\b[^。\n]*[。]?/g)]
      .map((match) => match[1]);
    if (rankingMisrefs.length) issues.push(`榜单/排名判断引用了非榜单证据：${uniqueStrings(rankingMisrefs).join("、")}`);
    const marketMisrefs = [...report.matchAll(/[^。\n]*(?:下载|收入|活跃|MAU|DAU|RPD|月均|总收入)[^。\n]*\b([RTC]\d+)\b[^。\n]*[。]?/g)]
      .map((match) => match[1]);
    if (marketMisrefs.length) issues.push(`市场数据判断引用了评论证据：${uniqueStrings(marketMisrefs).join("、")}`);
    return issues;
  }

  function auditFounderCompanyReportText(report = "", ledgerIds = new Set()) {
    const issues = [];
    for (const section of ["## 创业起点", "## 产品路线", "## 团队能力", "## 创始人过往代表作", "## 增长打法", "## 融资 / 收购", "## 待验证部分", "## 总结"]) {
      if (!report.includes(section)) issues.push(`正式正文缺少：${section.replace(/^##\s*/, "")}`);
    }
    if (/## 未解决的问题/.test(report)) issues.push("正式正文仍使用旧标题：未解决的问题");
    const acquisitionSection = extractSection(report, "## 融资 / 收购", "## 待验证部分") || "";
    if (/更像.*收购退出|公开融资故事/.test(acquisitionSection)) issues.push("融资 / 收购开头仍有废话铺垫");
    if (/关键补充/.test(report)) issues.push("正式正文仍有含混表达：关键补充");
    const reportIds = [...report.matchAll(/\bA\d+\b/g)].map((match) => match[0]);
    if (!reportIds.length) issues.push("正式正文缺少 A 类引用");
    const invalid = uniqueStrings(reportIds.filter((id) => ledgerIds.size && !ledgerIds.has(id))).slice(0, 12);
    if (invalid.length) issues.push(`正式正文引用不存在证据：${invalid.join("、")}`);
    if (/\bAPP\d+\b/.test(report)) issues.push("正式正文不应暴露 APP 内部证据编号");
    const processTerms = uniqueStrings([
      ...report.matchAll(/材料|本地材料里|当前材料中|某媒体|多家媒体|媒体估计|据\s*[\w\u4e00-\u9fa5]+?\s*(?:报道|采访)|报道指出|报道提及|采访中提到|文章称|媒体曝光|主流媒体/g)
    ].map((match) => match[0])).slice(0, 8);
    if (processTerms.length) issues.push(`正式正文仍有来源过程词：${processTerms.join("、")}`);
    return issues;
  }

  function isPromptPendingMeta(meta = {}) {
    return normalizeText(meta.aiStatus) === "unavailable" && /模块 prompt 待确认/.test(normalizeText(meta.aiError));
  }

  function extractSection(text, start, end) {
    const startIndex = text.indexOf(start);
    if (startIndex < 0) return "";
    const endIndex = text.indexOf(end, startIndex + start.length);
    return text.slice(startIndex, endIndex < 0 ? undefined : endIndex);
  }

  function missingRequiredEvidencePrefixes(text = "", requirements = []) {
    return requirements.filter((requirement) => {
      const alternatives = String(requirement).split("|").map((item) => item.trim()).filter(Boolean);
      return !alternatives.some((prefix) => new RegExp(`\\b${prefix}\\d+\\b`).test(text));
    });
  }

  function extractEvidenceLedgerIds(markdown = "") {
    const ledger = extractSection(markdown, "## 4. 证据台账", "## 5.")
      || extractSection(markdown, "## 证据台账", "## ")
      || extractSection(markdown, "## 证据台账", "")
      || extractSection(markdown, "## A 类证据台账", "## ")
      || extractSection(markdown, "## A 类证据台账", "");
    const ids = [...ledger.matchAll(new RegExp(`^\\|\\s*(${EVIDENCE_ID_PATTERN_SOURCE}\\d+)\\s*\\|`, "gm"))].map((match) => match[1]);
    return new Set(ids);
  }

  function evidenceIdsNotInLedger(text = "", ledgerIds = new Set()) {
    if (!ledgerIds.size) return [];
    const ids = [...text.matchAll(new RegExp(`\\b(${EVIDENCE_ID_PATTERN_SOURCE}\\d+)\\b`, "g"))].map((match) => match[1]);
    return uniqueStrings(ids.filter((id) => !ledgerIds.has(id))).slice(0, 12);
  }

  function readModuleMarkdown(app, definition, currentFingerprint = "") {
    const filePath = moduleMarkdownFilePath(app, definition);
    try {
      const markdown = fs.readFileSync(filePath, "utf8");
      const stat = fs.statSync(filePath);
      const meta = readJsonSync(moduleMetaFilePath(app, definition)) || {};
      const reportPath = moduleReportMarkdownFilePath(app, definition);
      const reportExists = fs.existsSync(reportPath);
      const reportMarkdown = reportExists ? fs.readFileSync(reportPath, "utf8") : extractReportDraftMarkdown(markdown);
      const mindmapPath = moduleMindmapFilePath(app, definition);
      const mindmapExists = fs.existsSync(mindmapPath);
      const mindmapText = mindmapExists ? fs.readFileSync(mindmapPath, "utf8") : "";
      const savedFingerprint = normalizeText(meta.sourceFingerprint);
      const templateFresh = Number(meta.templateVersion || 0) === REPORT_OUTPUT_TEMPLATE_VERSION;
      const freshness = savedFingerprint && currentFingerprint && savedFingerprint === currentFingerprint && templateFresh ? "fresh" : "stale";
      const quality = auditModuleQuality(markdown, meta, definition.id, {
        mindmapExists,
        mindmapPath,
        mindmapText
      });
      return {
        markdown,
        generatedAt: normalizeText(meta.generatedAt) || stat.mtime.toISOString(),
        filePath,
        publicPath: moduleMarkdownPublicPath(app, definition),
        reportMarkdown,
        reportPath: reportExists ? reportPath : "",
        reportPublicPath: reportExists ? moduleReportMarkdownPublicPath(app, definition) : "",
        mindmapPath: mindmapExists ? mindmapPath : "",
        mindmapPublicPath: mindmapExists ? moduleMindmapPublicPath(app, definition) : "",
        meta,
        metaPublicPath: moduleMetaPublicPath(app, definition),
        quality,
        freshness,
        needsUpdate: freshness === "stale"
      };
    } catch {
      return null;
    }
  }

  async function writeModuleMarkdown(app, definition, markdown, meta = {}, options = {}) {
    const filePath = moduleMarkdownFilePath(app, definition);
    const reportPath = moduleReportMarkdownFilePath(app, definition);
    const metaPath = moduleMetaFilePath(app, definition);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmpPath, `${markdown.trim()}\n`, "utf8");
    await fs.promises.rename(tmpPath, filePath);
    const reportMarkdown = normalizeText(options.reportMarkdown) ? options.reportMarkdown : extractReportDraftMarkdown(markdown);
    const reportTmpPath = `${reportPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(reportTmpPath, `${reportMarkdown.trim()}\n`, "utf8");
    await fs.promises.rename(reportTmpPath, reportPath);
    const mindmapPath = moduleMindmapFilePath(app, definition);
    const mindmap = extractMermaidMindmap(markdown);
    if (mindmap.trim()) {
      const mindmapTmpPath = `${mindmapPath}.${process.pid}.${Date.now()}.tmp`;
      await fs.promises.writeFile(mindmapTmpPath, `${mindmap.trim()}\n`, "utf8");
      await fs.promises.rename(mindmapTmpPath, mindmapPath);
    }
    const metaTmpPath = `${metaPath}.${process.pid}.${Date.now()}.tmp`;
    const savedMeta = {
      ...meta,
      markdownPath: meta.markdownPath || moduleMarkdownPublicPath(app, definition),
      reportMarkdownPath: meta.reportMarkdownPath || moduleReportMarkdownPublicPath(app, definition),
      mindmapPath: mindmap.trim() ? (meta.mindmapPath || moduleMindmapPublicPath(app, definition)) : "",
      templateVersion: REPORT_OUTPUT_TEMPLATE_VERSION,
      metaVersion: 1
    };
    await fs.promises.writeFile(metaTmpPath, `${JSON.stringify(savedMeta, null, 2)}\n`, "utf8");
    await fs.promises.rename(metaTmpPath, metaPath);
    return {
      filePath,
      publicPath: moduleMarkdownPublicPath(app, definition),
      reportPath,
      reportPublicPath: moduleReportMarkdownPublicPath(app, definition),
      mindmapPath: mindmap.trim() ? mindmapPath : "",
      mindmapPublicPath: mindmap.trim() ? moduleMindmapPublicPath(app, definition) : "",
      metaPath,
      metaPublicPath: moduleMetaPublicPath(app, definition),
      quality: auditModuleQuality(markdown, savedMeta, definition.id, {
        mindmapExists: Boolean(mindmap.trim()),
        mindmapPath,
        mindmapText: mindmap
      })
    };
  }

  function moduleMarkdownFilePath(app, definition) {
    return path.join(reportsDir, "modules", safeFileSegment(displayAppName(app)), `${definition.id}.md`);
  }

  function moduleMarkdownPublicPath(app, definition) {
    return `/reports/modules/${encodeURIComponent(safeFileSegment(displayAppName(app)))}/${encodeURIComponent(definition.id)}.md`;
  }

  function moduleReportMarkdownFilePath(app, definition) {
    return path.join(reportsDir, "modules", safeFileSegment(displayAppName(app)), `${definition.id}.report.md`);
  }

  function moduleReportMarkdownPublicPath(app, definition) {
    return `/reports/modules/${encodeURIComponent(safeFileSegment(displayAppName(app)))}/${encodeURIComponent(`${definition.id}.report.md`)}`;
  }

  function moduleMindmapFilePath(app, definition) {
    return path.join(reportsDir, "modules", safeFileSegment(displayAppName(app)), `${definition.id}.mmd`);
  }

  function moduleMindmapPublicPath(app, definition) {
    return `/reports/modules/${encodeURIComponent(safeFileSegment(displayAppName(app)))}/${encodeURIComponent(definition.id)}.mmd`;
  }

  function moduleMetaFilePath(app, definition) {
    return path.join(reportsDir, "modules", safeFileSegment(displayAppName(app)), `${definition.id}.meta.json`);
  }

  function moduleMetaPublicPath(app, definition) {
    return `/reports/modules/${encodeURIComponent(safeFileSegment(displayAppName(app)))}/${encodeURIComponent(definition.id)}.meta.json`;
  }

  function ensureExperienceTemplate(app, counts = {}, evidence = {}) {
    const fileName = `${safeFileSegment(displayAppName(app))}体验.md`;
    const dir = path.join(reportsDir, "experience-templates");
    const filePath = path.join(dir, fileName);
    const publicPath = `/reports/experience-templates/${encodeURIComponent(fileName)}`;
    const targetFilePath = path.join(reportsDir, fileName);
    const targetPublicPath = `/reports/${encodeURIComponent(fileName)}`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, `${buildExperienceTemplateMarkdown(app, counts, evidence, { targetFilePath }).trim()}\n`, "utf8");
      return { filePath, publicPath, targetFilePath, targetPublicPath };
    } catch {
      return { filePath: "", publicPath: "", targetFilePath: "", targetPublicPath: "" };
    }
  }

  function buildExperienceTemplateMarkdown(app, counts = {}, evidence = {}, options = {}) {
    const name = displayAppName(app);
    const topThemes = (evidence.themeSummary || []).slice(0, 5);
    const topVideos = (evidence.videoSamples || []).slice(0, 3);
    const topReviews = (evidence.reviewSamples || []).slice(0, 3);
    return [
      `# ${name} 体验实测`,
      "",
      "> 这是填写模板，不会被系统当作正式体验材料。",
      `> 写完后请保存为：${options.targetFilePath || `reports/${safeFileSegment(name)}体验.md`}`,
      "> 保存后刷新 `/reports`，产品体验实测模块会点亮。",
      "> 写法目标：把你的体验记录成可追溯证据链。每条判断尽量引用 EXP、EXT、REV 或 VID 编号。",
      "",
      "## 1. 一句话体验结论",
      "- 核心体验判断：",
      "- 最强证据编号：",
      "- 置信度：高 / 中 / 低",
      "",
      "## 2. 测试边界",
      `- App：${name}`,
      "- 测试设备：",
      "- 测试系统：",
      "- 测试地区 / 语言：",
      "- 测试日期：",
      "- 测试账号状态：新号 / 老号 / 付费号 / 免费号",
      "",
      "## 3. 用户原任务",
      "- 我模拟的用户是谁：",
      "- 用户来这里想完成什么：",
      "- 用户替代方案可能是什么：",
      "",
      "## 4. 体验路径证据台账",
      "| ID | 环节 | 我做了什么 | 看到什么 / 原话 | 情绪或摩擦 | 截图 / 录屏 | 能支撑什么 |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| EXP1 | 入口 / 注册 |  |  |  |  |  |",
      "| EXP2 | 首屏承诺 |  |  |  |  |  |",
      "| EXP3 | 核心任务路径 |  |  |  |  |  |",
      "| EXP4 | AI / 内容 / 数据反馈 |  |  |  |  |  |",
      "| EXP5 | 付费 / 广告 / 商业化 |  |  |  |  |  |",
      "| EXP6 | 安全 / 举报 / 隐私 |  |  |  |  |  |",
      "",
      "## 5. 关键路径拆解",
      "### 首次进入与注册",
      "- 入口：App Store / Google Play / TikTok 链接 / 其他",
      "- 注册方式：",
      "- 权限请求：",
      "- 第一屏给我的承诺：",
      "- 卡点 / 犹豫点：",
      "- 关联证据 ID：",
      "",
      "### 核心任务路径",
      "- 路径步骤：",
      "- 哪一步最顺：",
      "- 哪一步最卡：",
      "- 失败 / 犹豫 / 返回发生在哪里：",
      "- 关联证据 ID：",
      "",
      "### AI / 内容 / 数据反馈",
      "- 结果是否符合外部素材承诺：",
      "- AI 识别 / 推荐 / 计算是否可信：",
      "- 数据反馈是否清楚：",
      "- 用户是否知道下一步该做什么：",
      "- 关联证据 ID：",
      "",
      "### 付费与商业化触点",
      "- 第一次看到付费 / 广告的位置：",
      "- 它是在增强体验，还是打断体验：",
      "- 我愿不愿意付费，为什么：",
      "- 关联证据 ID：",
      "",
      "### 安全感与风险",
      "- 假号 / 诈骗 / 骚扰感受：",
      "- 举报 / 拉黑 / 隐私保护：",
      "- 哪些风险会影响继续使用：",
      "- 关联证据 ID：",
      "",
      "## 6. 与外部证据对照",
      `- 当前系统已有 TT 相关素材：${counts.ttVideos || 0} 条`,
      `- 当前系统已有商店评论行数：${counts.reviewRows || 0} 条`,
      ...topThemes.map((item) => `- 可重点验证主题：${item.title}（${item.count}）`),
      "",
      "### 外部承诺 / 真实体验对照表",
      "| ID | 外部信号 | 系统样本 | 我的体验是否验证 | 对应体验证据 | 判断边界 |",
      "| --- | --- | --- | --- | --- | --- |",
      ...topVideos.map((item, index) => `| VID${index + 1} | TT 素材承诺 | ${escapeMarkdownTable(truncateText(item.title || item.summary, 80))} |  |  | 素材表达不等同于真实体验 |`),
      ...topReviews.map((item, index) => `| REV${index + 1} | 商店评论痛点 | ${escapeMarkdownTable(truncateText(item.text, 80))} |  |  | 单条评论需要和体验路径互证 |`),
      ...topThemes.slice(0, 3).map((item, index) => `| EXT${index + 1} | 主题聚类 | ${escapeMarkdownTable(`${item.title}（${item.count}）`)} |  |  | 主题命中不等同于全部用户 |`),
      "",
      "## 7. 体验判断 - 证据矩阵",
      "| 判断 | 支撑体验证据 | 外部互证 | 置信度 | 可写入报告的位置 |",
      "| --- | --- | --- | --- | --- |",
      "|  | EXP | VID / REV / EXT | 高 / 中 / 低 | 体验结论 / 定位反证 / 风险边界 |",
      "|  | EXP | VID / REV / EXT | 高 / 中 / 低 | 体验结论 / 用户 case / 商业化摩擦 |",
      "|  | EXP | VID / REV / EXT | 高 / 中 / 低 | 体验结论 / 增长承诺对照 |",
      "",
      "## 8. 可写入报告的体验段落草稿",
      "- 段落 1（体验结论）：",
      "- 段落 2（承诺与现实对照）：",
      "- 段落 3（风险 / 付费 / 供给边界）：",
      "",
      "## 9. 还需要补的截图 / 录屏 / 证据",
      "- 缺口 1：",
      "- 缺口 2：",
      "- 缺口 3："
    ].join("\n");
  }

  function safeFileSegment(value) {
    return normalizeText(value).replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "Unknown App";
  }

  function extractMermaidMindmap(markdown = "") {
    const match = markdown.match(/```mermaid\s*\n([\s\S]*?\bmindmap[\s\S]*?)```/);
    return match?.[1]?.trim() || "mindmap\n  root((待补))";
  }

  function formatDateRange(range = {}) {
    const start = normalizeText(range.start || range.startDate || range.start_date);
    const end = normalizeText(range.end || range.endDate || range.end_date);
    return start || end ? `${start || "未知"} 至 ${end || "未知"}` : "";
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return normalizeText(value);
    return date.toISOString().replace("T", " ").slice(0, 16);
  }

  function shortMindmapNode(value) {
    return truncateText(value, 24).replace(/[。；;:：]+$/g, "");
  }

  function formatDrilldownMindmapNode(row = {}) {
    const ids = Array.isArray(row.evidenceIds) ? row.evidenceIds.filter(Boolean).slice(0, 3).join("、") : "";
    const signal = shortMindmapNode(row.signal || row.sample || "下钻样本");
    return ids ? `${ids} ${signal}` : signal;
  }

  function escapeMindmapText(value) {
    return normalizeText(value).replace(/[()\[\]{}]/g, "").replace(/"/g, "'");
  }

  function escapeMarkdownTable(value) {
    return normalizeText(value).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
  }

  function buildCoreViewpointMarkdown(app, counts, evidence) {
    const topThemes = evidence.themeSummary.slice(0, 4);
    return [
      `# 核心观点：${displayAppName(app)}`,
      "",
      "## 可写主线候选",
      ...bulletLines([
        counts.marketData ? `已有 ${counts.marketData} 类市场/规模数据，可先判断规模与变化。` : "",
        counts.ttVideos ? `已有 ${counts.ttVideos} 条 TT 素材，可观察外部如何包装产品承诺。` : "",
        counts.userVoice ? `已有 ${counts.userVoice} 条用户声音样本，可提炼真实痛点。` : "",
        topThemes.length ? `当前最高频信号：${topThemes.map((item) => `${item.title} ${item.count}`).join("、")}。` : ""
      ]),
      "",
      "## 待人工确认",
      "- 这些候选只能作为分析包开头，最终主判断需要结合你的产品体验实测确认。",
      "- 如果体验无法接住素材承诺，核心观点应转向“增长叙事与真实体验的错配”。"
    ].join("\n");
  }

  function buildMarketOverviewMarkdown(app, counts, evidence) {
    return [
      `# 市场表现概览：${displayAppName(app)}`,
      "",
      "## 已有数据",
      ...bulletLines(evidence.sensorImports.map((item) => `${item.dataType || "unknown"}：${item.rowCount || 0} 行`)),
      "",
      "## 可输出内容",
      "- 下载、收入、活跃、评论等数据是否齐全。",
      "- 国家分布、收入/下载错配、评论国家分布可在下一步读取 CSV 明细后展开。"
    ].join("\n");
  }

  function buildPositioningMarkdown(app, counts, evidence) {
    return [
      `# 产品定位与核心承诺：${displayAppName(app)}`,
      "",
      "## 已有定位线索",
      ...bulletLines([
        app.fullName || app.name ? `商店名称：${app.fullName || app.name}` : "",
        app.sellerName ? `开发者：${app.sellerName}` : "",
        ...evidence.articleSamples.map((item) => `文章《${item.title}》：${item.excerpt || "可作为外部定位线索"}`),
        ...evidence.videoSamples.slice(0, 4).map((item) => `TT 素材《${item.title}》：${item.summary || "可观察传播承诺"}`)
      ]),
      "",
      "## 待补判断",
      "- 官方定位、用户实际使用目的、传播素材承诺是否一致。"
    ].join("\n");
  }

  function buildUserCasesMarkdown(app, counts, evidence) {
    const themes = evidence.themeSummary.filter((item) => item.count > 0).slice(0, 6);
    return [
      `# 典型痛点 / 用户 case：${displayAppName(app)}`,
      "",
      "## 候选 case 聚类",
      ...themes.flatMap((theme) => [
        `### ${theme.title}`,
        `- 命中样本：${theme.count}`,
        ...bulletLines(theme.examples.slice(0, 3).map((item) => `用户表达：${item}`)),
        "- 可写方向：结合体验实测判断这是核心痛点、边缘噪音，还是商业化/运营带来的副作用。",
        ""
      ]),
      "## 原始样本",
      ...bulletLines([
        ...evidence.reviewSamples.slice(0, 5).map((item) => `商店评论：${item.text}`),
        ...evidence.ttCommentSamples.slice(0, 5).map((item) => `TT 评论：${item.text}`)
      ])
    ].join("\n");
  }

  function buildExperienceMarkdown(app, counts, evidence) {
    return [
      `# 产品体验实测：${displayAppName(app)}`,
      "",
      "## 已有体验材料",
      ...bulletLines(evidence.experienceDocs.map((item) => `${item.title}：${item.excerpt || item.path}`)),
      "",
      "## 可结合的素材证据",
      ...bulletLines(evidence.videoSamples.slice(0, 5).map((item) => `TT 素材《${item.title}》：${item.summary || "可用于验证体验承诺"}`)),
      "",
      "## 建议输出结构",
      "- 一句话体验结论",
      "- 用户原任务",
      "- 首次进入流程",
      "- 核心任务路径",
      "- 体验强点 / 弱点",
      "- 付费与商业化感受",
      "- TT/TikTok 体验证据",
      "- 可进入正式报告的判断"
    ].join("\n");
  }

  function buildGrowthSignalsMarkdown(app, counts, evidence) {
    return [
      `# 增长素材与传播信号：${displayAppName(app)}`,
      "",
      "## 高播放/高互动素材样本",
      ...bulletLines(evidence.videoSamples.map((item) => `《${item.title}》：播放 ${item.viewCount || 0} / 评论 ${item.commentCount || 0}。${item.summary || ""}`)),
      "",
      "## TT 评论样本",
      ...bulletLines(evidence.ttCommentSamples.slice(0, 8).map((item) => `${item.text}${item.likeCount ? `（赞 ${item.likeCount}）` : ""}`)),
      "",
      "## 待提炼",
      "- 高频 hook、演示动作、结果展示、反对意见、用户自传播语言。"
    ].join("\n");
  }

  function buildMonetizationMarkdown(app, counts, evidence) {
    const paidTheme = evidence.themeSummary.find((item) => item.id === "ads");
    return [
      `# 商业化与付费结构：${displayAppName(app)}`,
      "",
      "## 收入与付费线索",
      ...bulletLines([
        ...evidence.sensorImports.filter((item) => item.dataType === "revenue").map((item) => `收入 CSV：${item.rowCount} 行`),
        paidTheme ? `用户评论/素材中商业化相关信号：${paidTheme.count} 条` : "",
        ...evidence.articleSamples.filter((item) => /收入|订阅|付费|商业化|流水|IAP/i.test(`${item.title} ${item.excerpt}`)).map((item) => `文章线索：《${item.title}》`)
      ]),
      "",
      "## 待判断",
      "- 收入来自订阅、IAP、广告、交易闭环，还是事件峰值。",
      "- 付费触发点是否与体验价值一致。"
    ].join("\n");
  }

  function buildCompetitionMarkdown(app, counts, evidence) {
    return [
      `# 竞品横向对比：${displayAppName(app)}`,
      "",
      "## 现有替代方案线索",
      ...bulletLines([
        ...evidence.articleSamples.filter((item) => /竞品|对比|替代|vs|versus/i.test(`${item.title} ${item.excerpt}`)).map((item) => `文章：《${item.title}》`),
        ...evidence.videoSamples.filter((item) => /Tinder|Hinge|Bumble|Duolingo|竞品|替代|对比/i.test(`${item.title} ${item.summary}`)).map((item) => `素材：《${item.title}》`),
        ...evidence.themeSummary.filter((item) => ["matching", "cross_border"].includes(item.id)).map((item) => `${item.title}：${item.count} 条用户声音`)
      ]),
      "",
      "## 待补",
      "- 竞品入选理由、目标用户差异、体验路径差异、商业化差异。"
    ].join("\n");
  }

  function buildRisksMarkdown(app, counts, evidence) {
    return [
      `# 风险与边界：${displayAppName(app)}`,
      "",
      "## 风险信号",
      ...evidence.themeSummary
        .filter((item) => ["safety", "account", "bugs", "ads"].includes(item.id) && item.count > 0)
        .flatMap((item) => [
          `### ${item.title}`,
          `- 命中样本：${item.count}`,
          ...bulletLines(item.examples.slice(0, 3)),
          ""
        ]),
      "## 待判断",
      "- 风险是产品机制带来的结构问题，还是单一版本/运营阶段问题。",
      "- 风险是否会削弱核心承诺或商业化可持续性。"
    ].join("\n");
  }

  function buildBlockedMarkdown(definition, app, required, optional) {
    return [
      `# ${definition.title}：${displayAppName(app)}`,
      "",
      "## 暂不能生成",
      ...bulletLines(required.filter((item) => !item.met).map((item) => `${item.label} 当前 ${item.current}，至少需要 ${item.min}，还差 ${item.missing}。`)),
      "",
      "## 可选增强",
      ...bulletLines(optional.map((item) => `${item.label} 当前 ${item.current}，建议 ${item.min}。`)),
      "",
      "补齐后该模块会在分析输出页点亮。"
    ].join("\n");
  }

  function readSensorSampleRows(record) {
    if (!record?.parsedPath) return [];
    const localPath = resolveStoredPath(record.parsedPath);
    return readJsonSync(localPath)?.sampleRows || [];
  }

  function findLatestCategoryRanking(sensorImports = [], appId = "") {
    const linkedKeys = new Set(sensorImports
      .filter((item) => normalizeText(item.dataType) === "category_rankings" || item.categoryRanking)
      .filter((item) => !appId || recordAppId(item) === normalizeText(appId))
      .map(categoryRankingSnapshotKey)
      .filter(Boolean));

    const candidates = sensorImports
      .filter((item) => normalizeText(item.dataType) === "category_rankings" || item.categoryRanking)
      .filter((item) => {
        if (!appId) return true;
        const key = categoryRankingSnapshotKey(item);
        return linkedKeys.has(key) || recordAppId(item) === normalizeText(appId);
      })
      .sort((a, b) => dateSortValue(b.importedAt || b.categoryRanking?.importedAt) - dateSortValue(a.importedAt || a.categoryRanking?.importedAt));
    const record = candidates[0];
    if (!record) return null;
    const meta = record.categoryRanking && typeof record.categoryRanking === "object"
      ? record.categoryRanking
      : buildCategoryRankingFromRecord(record);
    const rawRows = meta.rows || readSensorSampleRows(record);
    const rowLimit = Math.min(50, Number(meta.rowLimit || record.rowLimit || record.rowCount || rawRows.length || 50) || 50);
    const rows = normalizeCategoryRankingRows(rawRows, { limit: rowLimit });
    const summary = buildCategoryRankingSummary(rows, meta.summary);
    return {
      importId: normalizeText(record.id),
      snapshotKey: categoryRankingSnapshotKey(record),
      sourceUrl: normalizeText(meta.sourceUrl || record.sourceUrl),
      csvPath: normalizeText(record.csvPath),
      parsedPath: normalizeText(record.parsedPath),
      categoryName: normalizeText(meta.categoryName) || "同品类应用",
      rowLimit,
      metric: normalizeText(meta.metric || record.metric) || "revenue",
      sort: normalizeText(meta.sort || record.filters?.comparisonAttribute) || "absolute",
      countries: Array.isArray(meta.countries) ? meta.countries : record.filters?.countries || [],
      os: normalizeText(meta.os || record.filters?.os) || "unified",
      devices: Array.isArray(meta.devices) ? meta.devices : record.filters?.devices || [],
      dateRange: meta.dateRange || record.dateRange || {},
      importedAt: normalizeText(meta.importedAt || record.importedAt),
      summary,
      rows
    };
  }

  function buildCategoryRankingFromRecord(record = {}) {
    return {
      sourceUrl: record.sourceUrl,
      metric: record.metric,
      countries: record.filters?.countries || [],
      os: record.filters?.os || "",
      devices: record.filters?.devices || [],
      dateRange: record.dateRange || {},
      importedAt: record.importedAt,
      rows: readSensorSampleRows(record)
    };
  }

  function normalizeCategoryRankingRows(rows = [], { limit = 50 } = {}) {
    return rows.slice(0, limit).map((row, index) => {
      const revenueUsd90d = numericValue(row.revenueUsd90d ?? pickCsvValue(row, ["Revenue (Absolute)", "Revenue ($)", "Revenue", "Revenue USD", "IAP Revenue ($)"]));
      const downloads90d = numericValue(row.downloads90d ?? pickCsvValue(row, ["Downloads (Absolute)", "Downloads", "Download", "Units", "Installs"]));
      const dau = numericValue(row.dau ?? pickCsvValue(row, ["DAU (Absolute)", "DAU", "Average DAU", "Avg DAU", "Active Users"]));
      const appName = normalizeText(row.appName || pickCsvValue(row, ["App Name", "Name", "App", "Unified Name"]));
      return {
        rank: Number(row.rank || pickCsvValue(row, ["Rank", "#", "Ranking"])) || index + 1,
        appId: normalizeText(row.appId || pickCsvValue(row, ["App ID", "Store ID"])),
        unifiedId: normalizeText(row.unifiedId || pickCsvValue(row, ["Unified ID", "Unified App ID"])),
        appName,
        unifiedName: normalizeText(row.unifiedName || pickCsvValue(row, ["Unified Name"])) || appName,
        publisherName: normalizeText(row.publisherName || pickCsvValue(row, ["Unified Publisher Name", "Publisher Name", "Publisher", "Developer"])),
        revenueUsd90d,
        monthlyRevenueUsd: numericValue(row.monthlyRevenueUsd) || revenueUsd90d / 3,
        downloads90d,
        dau,
        raw: row.raw || row
      };
    }).filter((row) => row.appName || row.revenueUsd90d || row.downloads90d || row.dau);
  }

  function buildCategoryRankingSummary(rows = [], savedSummary = {}) {
    const totalRevenue90d = rows.reduce((sum, row) => sum + Number(row.revenueUsd90d || 0), 0);
    const totalMonthlyRevenue = rows.reduce((sum, row) => sum + Number(row.monthlyRevenueUsd || 0), 0);
    const totalDownloads90d = rows.reduce((sum, row) => sum + Number(row.downloads90d || 0), 0);
    const totalDau = rows.reduce((sum, row) => sum + Number(row.dau || 0), 0);
    return {
      appCount: rows.length,
      totalRevenueUsd90d: totalRevenue90d || Number(savedSummary.totalRevenueUsd90d || 0),
      averageRevenueUsd90d: rows.length ? totalRevenue90d / rows.length : Number(savedSummary.averageRevenueUsd90d || 0),
      averageMonthlyRevenueUsd: rows.length ? totalMonthlyRevenue / rows.length : Number(savedSummary.averageMonthlyRevenueUsd || 0),
      totalDownloads90d,
      averageDownloads90d: rows.length ? totalDownloads90d / rows.length : Number(savedSummary.averageDownloads90d || 0),
      averageDau: rows.length ? totalDau / rows.length : Number(savedSummary.averageDau || 0)
    };
  }

  function findLatestOverview(records = []) {
    return [...records]
      .filter((item) => item?.overview)
      .sort((a, b) => dateSortValue(b.collectedAt || b.importedAt) - dateSortValue(a.collectedAt || a.importedAt))[0] || null;
  }

  function buildAppReleaseSignals(app = {}, latestOverview = null) {
    const overview = latestOverview?.overview || {};
    const globalReleaseDate = normalizeText(overview.globalReleaseDate || overview.global_release_date);
    const countryReleaseDate = normalizeText(overview.countryReleaseDate || overview.country_release_date);
    const currentVersion = normalizeText(overview.currentVersion || overview.current_version);
    const currentVersionReleaseDate = normalizeText(overview.currentVersionReleaseDate || overview.current_version_release_date || overview.recentUpdateDate);
    const sourceUrl = normalizeText(latestOverview?.sourceUrl || latestOverview?.url);
    const signals = [];
    if (globalReleaseDate) {
      signals.push({
        id: "APP1",
        type: "app_profile",
        label: "全球发布日期",
        value: globalReleaseDate,
        sourceName: "Sensor Tower overview",
        sourceUrl,
        use: "用于创业起点和产品时间线"
      });
    }
    if (countryReleaseDate && countryReleaseDate !== globalReleaseDate) {
      signals.push({
        id: "APP2",
        type: "app_profile",
        label: "国家发布日期",
        value: countryReleaseDate,
        sourceName: "Sensor Tower overview",
        sourceUrl,
        use: "用于创业起点和产品时间线"
      });
    }
    if (currentVersion || currentVersionReleaseDate) {
      signals.push({
        id: `APP${signals.length + 1}`,
        type: "app_profile",
        label: "当前版本",
        value: [currentVersion, currentVersionReleaseDate].filter(Boolean).join(" / "),
        sourceName: "Sensor Tower overview",
        sourceUrl,
        use: "用于判断产品仍在更新"
      });
    }
    if (!signals.length && app?.createdAt) {
      signals.push({
        id: "APP1",
        type: "app_profile",
        label: "本地录入时间",
        value: normalizeText(app.createdAt),
        sourceName: "local app catalog",
        sourceUrl: normalizeText(app.appStoreUrl),
        use: "仅代表本地录入时间，不可写作首次上线时间"
      });
    }
    return signals;
  }

  function normalizeStoreScreenshots(items = []) {
    return Array.isArray(items)
      ? items.map((item) => ({
        platform: normalizeText(item.platform),
        thumbnailUrl: normalizeText(item.thumbnailUrl),
        imageUrl: normalizeText(item.imageUrl),
        alt: truncateText(normalizeText(item.alt), 180)
      })).filter((item) => item.imageUrl || item.thumbnailUrl || item.alt).slice(0, 12)
      : [];
  }

  function normalizePaywallSamples(paywall = null) {
    if (!paywall || typeof paywall !== "object") return [];
    const matches = Array.isArray(paywall.matches) && paywall.matches.length
      ? paywall.matches
      : paywall.bestMatch ? [paywall.bestMatch] : [];
    return matches.map((item) => ({
      appName: normalizeText(item.appName || paywall.appName),
      imageUrl: normalizeText(item.localImagePath || item.imageUrl),
      pageUrl: normalizeText(item.pageUrl),
      collectedAt: normalizeText(item.collectedAt || paywall.fetchedAt),
      appVersion: normalizeText(item.appVersion),
      score: Number(item.score || 0)
    })).filter((item) => item.imageUrl || item.pageUrl).slice(0, 6);
  }

  function buildCountryMarketSummary(sensorImports = []) {
    const latestDownloads = latestImportByType(sensorImports, "downloads");
    const latestRevenue = latestImportByType(sensorImports, "revenue", (item) => Number(item.rowCount || 0) > 10 && csvHasColumns(item, ["Revenue ($)", "Revenue (Absolute)", "Revenue", "IAP Revenue ($)"]));
    const rows = new Map();
    const add = (country, patch) => {
      const key = normalizeText(country);
      if (!key) return;
      rows.set(key, { country: key, downloads: 0, revenueUsd: 0, ...rows.get(key), ...patch });
    };
    for (const row of readFullCsvRows(latestDownloads)) {
      const country = pickCsvValue(row, ["Country / Region", "Country", "Region"]);
      const downloads = numericValue(pickCsvValue(row, ["Downloads", "Downloads (Absolute)", "Download", "Installs"]));
      if (!country || !downloads) continue;
      const previous = rows.get(country)?.downloads || 0;
      add(country, { downloads: previous + downloads });
    }
    for (const row of readFullCsvRows(latestRevenue)) {
      const country = pickCsvValue(row, ["Country / Region", "Country", "Region"]);
      const revenueUsd = numericValue(pickCsvValue(row, ["Revenue ($)", "Revenue (Absolute)", "Revenue", "IAP Revenue ($)"]));
      if (!country || !revenueUsd) continue;
      const previous = rows.get(country)?.revenueUsd || 0;
      add(country, { revenueUsd: previous + revenueUsd });
    }
    const list = [...rows.values()];
    const totalDownloads = list.reduce((sum, item) => sum + Number(item.downloads || 0), 0);
    const totalRevenueUsd = list.reduce((sum, item) => sum + Number(item.revenueUsd || 0), 0);
    const enriched = list.map((item) => {
      const downloadShare = totalDownloads ? item.downloads / totalDownloads : 0;
      const revenueShare = totalRevenueUsd ? item.revenueUsd / totalRevenueUsd : 0;
      return {
        ...item,
        revenuePerDownloadUsd: item.downloads ? item.revenueUsd / item.downloads : 0,
        downloadShare,
        revenueShare,
        revenueDownloadShareGap: revenueShare - downloadShare,
        revenueToDownloadShareRatio: downloadShare ? revenueShare / downloadShare : 0
      };
    }).sort((a, b) => Number(b.revenueUsd || 0) - Number(a.revenueUsd || 0));
    return {
      rows: enriched.slice(0, 80),
      topRevenueCountries: enriched.slice(0, 8),
      topDownloadCountries: [...enriched].sort((a, b) => Number(b.downloads || 0) - Number(a.downloads || 0)).slice(0, 8),
      topRpdCountries: [...enriched].filter((item) => item.downloads >= 100).sort((a, b) => Number(b.revenuePerDownloadUsd || 0) - Number(a.revenuePerDownloadUsd || 0)).slice(0, 8),
      dateRange: latestRevenue?.dateRange || latestDownloads?.dateRange || {},
      totalDownloads,
      totalRevenueUsd
    };
  }

  function buildSensorTowerNoDataSignals(sensorImports = []) {
    return sensorImports
      .filter((item) => Number(item?.rowCount || 0) === 0)
      .map((item) => {
        const dataType = normalizeText(item.dataType) || "unknown";
        const chartLabel = normalizeText(item.chartLabel);
        const dateRange = formatDateRange(item.dateRange);
        return {
          id: normalizeText(item.id || item.importId || item.sourcePath || item.parsedPath),
          dataType,
          label: chartLabel || dataType,
          dateRange: item.dateRange || {},
          importedAt: normalizeText(item.importedAt),
          explanation: `${dateRange || "当前时间窗"}在 Sensor Tower 当前筛选条件下没有可用行；用于判断“ST 未覆盖/体量可能低于可见阈值”，不是采集失败。`
        };
      });
  }

  function buildSensorTowerFailureSignals(pluginDebugLogs = [], app = {}) {
    const appName = normalizeText(displayAppName(app));
    const appId = normalizeText(app?.id);
    return [...(pluginDebugLogs || [])]
      .reverse()
      .filter((item) => {
        const event = normalizeText(item?.event);
        const mode = normalizeText(item?.detail?.mode);
        return event === "sensortower:batch:item-error"
          || event === "message:sensortower:error"
          || (event === "task:error" && mode === "sensortower");
      })
      .filter((item) => {
        const detailText = normalizeText(JSON.stringify(item?.detail || {}));
        return !appName || detailText.toLowerCase().includes(appName.toLowerCase()) || (appId && detailText.includes(appId)) || item?.event === "task:error";
      })
      .slice(0, 8)
      .map((item) => {
        const detail = item.detail || {};
        return {
          at: normalizeText(item.receivedAt || item.at),
          event: normalizeText(item.event),
          id: normalizeText(detail.id),
          label: normalizeText(detail.label || detail.id || "Sensor Tower"),
          error: truncateText(normalizeText(detail.error || detail.message), 240),
          explanation: "插件或本地采集链路返回错误；用于判断需重试或排查导出链路，不可解释为 ST 低量级无数据。"
        };
      })
      .filter((item) => item.error || item.event);
  }

  function buildMarketDataStatusMetrics(sensorImports = [], categoryRanking = null, countryMarket = null, appId = "") {
    const downloadsImport = latestImportByType(sensorImports, "downloads", (item) => Number(item.rowCount || 0) > 10);
    const revenueImport = latestImportByType(sensorImports, "revenue", (item) => Number(item.rowCount || 0) > 10 && csvHasColumns(item, ["Revenue ($)", "Revenue (Absolute)", "Revenue", "IAP Revenue ($)"]));
    const activeImport = latestImportByType(sensorImports, "active_users", (item) => Number(item.rowCount || 0) > 10);
    const downloadsMonthly = aggregateMonthlyMetric(readFullCsvRows(downloadsImport), ["Downloads", "Downloads (Absolute)", "Download", "Installs"]);
    const revenueMonthly = aggregateMonthlyMetric(readFullCsvRows(revenueImport), ["Revenue ($)", "Revenue (Absolute)", "Revenue", "IAP Revenue ($)"]);
    const mauMonthly = aggregateMonthlyMetric(readFullCsvRows(activeImport), ["MAU", "Monthly Active Users", "Active Users"]);
    const downloads = summarizeMonthlyTrend(downloadsMonthly);
    const revenue = summarizeMonthlyTrend(revenueMonthly);
    const mau = summarizeMonthlyTrend(mauMonthly);
    const appName = normalizeText(downloadsImport?.appName || revenueImport?.appName || activeImport?.appName);
    const targetRanking = findCategoryRankingTarget(categoryRanking, appName, appId);
    return {
      dataPeriod: downloadsImport?.dateRange || revenueImport?.dateRange || activeImport?.dateRange || {},
      downloads,
      revenueUsd: revenue,
      mau,
      categoryRanking: targetRanking ? {
        rank: targetRanking.rank,
        appName: targetRanking.appName || targetRanking.unifiedName,
        revenueUsd90d: targetRanking.revenueUsd90d,
        downloads90d: targetRanking.downloads90d,
        dateRange: categoryRanking?.dateRange || {}
      } : null,
      countryMarket: countryMarket ? {
        totalDownloads: countryMarket.totalDownloads || 0,
        totalRevenueUsd: countryMarket.totalRevenueUsd || 0,
        topRevenueCountries: (countryMarket.topRevenueCountries || []).slice(0, 5),
        topDownloadCountries: (countryMarket.topDownloadCountries || []).slice(0, 5),
        topRpdCountries: (countryMarket.topRpdCountries || []).slice(0, 5)
      } : null
    };
  }

  function aggregateMonthlyMetric(rows = [], metricKeys = []) {
    const monthly = new Map();
    for (const row of rows) {
      const date = normalizeText(pickCsvValue(row, ["Date", "Month"]));
      if (!date || !/^\d{4}-\d{2}/.test(date)) continue;
      const month = date.slice(0, 7);
      const value = numericValue(pickCsvValue(row, metricKeys));
      if (!value) continue;
      monthly.set(month, (monthly.get(month) || 0) + value);
    }
    return [...monthly.entries()]
      .map(([month, value]) => ({ month, value }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  function summarizeMonthlyTrend(monthly = []) {
    const values = monthly.filter((item) => Number.isFinite(Number(item.value)));
    const total = values.reduce((sum, item) => sum + Number(item.value || 0), 0);
    const firstMonth = values[0] || null;
    const latestMonth = values[values.length - 1] || null;
    const firstThree = summarizePeriod(values.slice(0, 3));
    const latestThree = summarizePeriod(values.slice(-3));
    const peak = values.reduce((best, item) => Number(item.value || 0) > Number(best?.value || 0) ? item : best, null);
    const latestVsFirstThreePct = firstThree.value ? (latestThree.value - firstThree.value) / firstThree.value : null;
    return {
      monthCount: values.length,
      total,
      monthlyAverage: values.length ? total / values.length : 0,
      firstMonth,
      latestMonth,
      firstThree,
      latestThree,
      latestVsFirstThreePct,
      peak,
      series: values.slice(-13)
    };
  }

  function summarizePeriod(items = []) {
    return {
      months: items.map((item) => item.month),
      value: items.reduce((sum, item) => sum + Number(item.value || 0), 0)
    };
  }

  function findCategoryRankingTarget(categoryRanking = null, appName = "", appId = "") {
    const rows = categoryRanking?.rows || [];
    if (!rows.length) return null;
    const target = normalizeText(appName || "").toLowerCase();
    const targetAppId = normalizeText(appId);
    return rows.find((item) => targetAppId && normalizeText(item.localAppId) === targetAppId)
      || rows.find((item) => target && normalizeText(`${item.appName} ${item.unifiedName}`).toLowerCase().includes(target.toLowerCase()))
      || rows.find((item) => /cal ai/i.test(`${item.appName || ""} ${item.unifiedName || ""}`))
      || null;
  }

  function latestImportByType(sensorImports = [], dataType = "", predicate = null) {
    return [...sensorImports]
      .filter((item) => normalizeText(item.dataType) === dataType)
      .filter((item) => (typeof predicate === "function" ? predicate(item) : true))
      .sort((a, b) => dateSortValue(b.importedAt) - dateSortValue(a.importedAt))[0] || null;
  }

  function readFullCsvRows(record = null) {
    const parsedRows = readSensorSampleRows(record);
    if (!record?.csvPath) return parsedRows;
    const filePath = resolveStoredPath(record.csvPath);
    try {
      const text = readCsvText(filePath);
      const rows = parseCsvRows(text);
      const headers = rows[0] || [];
      return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header || `col_${index + 1}`, row[index] || ""])));
    } catch {
      return parsedRows;
    }
  }

  function csvHasColumns(record = null, columns = []) {
    const headers = readCsvHeaders(record);
    return columns.some((column) => headers.some((header) => normalizeColumnKey(header) === normalizeColumnKey(column)));
  }

  function readCsvHeaders(record = null) {
    if (!record) return [];
    const parsed = readJsonSync(resolveStoredPath(record.parsedPath || "")) || {};
    if (Array.isArray(parsed.headers) && parsed.headers.length) return parsed.headers.map(normalizeText);
    const rows = readSensorSampleRows(record);
    if (rows.length) return Object.keys(rows[0] || {});
    if (!record.csvPath) return [];
    try {
      const text = readCsvText(resolveStoredPath(record.csvPath));
      return parseCsvRows(text)[0] || [];
    } catch {
      return [];
    }
  }

  function readCsvText(filePath) {
    const bytes = fs.readFileSync(filePath);
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString("utf16le").replace(/^\uFEFF/, "");
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.slice(2)).swap16().toString("utf16le");
    return bytes.toString("utf8").replace(/^\uFEFF/, "");
  }

  function resolveStoredPath(value = "") {
    const storedPath = normalizeText(value);
    if (!storedPath) return "";
    if (path.isAbsolute(storedPath) && fs.existsSync(storedPath)) return storedPath;
    if (typeof deps.resolvePublicPathToFile === "function" && storedPath.startsWith("/")) {
      return deps.resolvePublicPathToFile(storedPath);
    }
    if (storedPath.startsWith("/")) return path.resolve(storageRootDir, `.${storedPath}`);
    return path.resolve(storageRootDir, storedPath);
  }

  function parseCsvRows(text = "") {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    const delimiter = detectCsvDelimiter(text);
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];
      if (char === "\"") {
        if (inQuotes && next === "\"") {
          field += "\"";
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        row.push(field);
        field = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") index += 1;
        row.push(field);
        if (row.some((cell) => cell !== "")) rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }
    row.push(field);
    if (row.some((cell) => cell !== "")) rows.push(row);
    return rows;
  }

  function detectCsvDelimiter(text = "") {
    const firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
    return (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? "\t" : ",";
  }

  function formatMoneyShort(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number) || number <= 0) return "$0";
    if (number >= 1_000_000) return `$${(number / 1_000_000).toFixed(1)}M`;
    if (number >= 1_000) return `$${Math.round(number / 1_000)}K`;
    return `$${Math.round(number)}`;
  }

  function formatNumberShort(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number) || number <= 0) return "0";
    if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
    if (number >= 1_000) return `${Math.round(number / 1_000)}K`;
    return `${Math.round(number)}`;
  }

  function pickCsvValue(row = {}, keys = []) {
    for (const key of keys) {
      const direct = row?.[key];
      if (direct !== undefined && direct !== null && normalizeText(direct)) return direct;
      const normalizedKey = normalizeColumnKey(key);
      const match = Object.entries(row).find(([candidate]) => normalizeColumnKey(candidate) === normalizedKey);
      if (match && normalizeText(match[1])) return match[1];
    }
    return "";
  }

  function normalizeColumnKey(value) {
    return normalizeText(value).replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "").toLowerCase();
  }

  function categoryRankingSnapshotKey(record = {}) {
    const meta = record.categoryRanking && typeof record.categoryRanking === "object" ? record.categoryRanking : {};
    const filters = record.filters || {};
    if (meta.snapshotKey || record.categoryRankingSnapshotKey) {
      return normalizeText(meta.snapshotKey || record.categoryRankingSnapshotKey);
    }
    const customFieldsFilterId = normalizeText(meta.customFieldsFilterId || filters.customFieldsFilterId || extractSearchParam(meta.sourceUrl || record.sourceUrl, "custom_fields_filter_id"));
    const dateRange = meta.dateRange || record.dateRange || {};
    const countries = Array.isArray(meta.countries) ? meta.countries : filters.countries || [];
    const devices = Array.isArray(meta.devices) ? meta.devices : filters.devices || [];
    const parts = [
      customFieldsFilterId,
      normalizeText(meta.metric || record.metric || "revenue"),
      normalizeText(meta.sort || filters.comparisonAttribute || "absolute"),
      normalizeText(dateRange.start),
      normalizeText(dateRange.end),
      normalizeText(dateRange.duration),
      canonicalCountryKey(countries),
      canonicalListKey(devices),
      normalizeText(meta.os || filters.os || "unified")
    ];
    return parts[0] ? parts.join("|") : "";
  }

  function canonicalCountryKey(countries = []) {
    const values = stringArray(countries).map((item) => item.toUpperCase()).filter(Boolean);
    if (!values.length) return "";
    if (values.includes("ALL") || values.length >= 50) return "all";
    return Array.from(new Set(values)).sort().join(",");
  }

  function canonicalListKey(values = []) {
    return Array.from(new Set(stringArray(values).map((item) => item.toLowerCase()).filter(Boolean))).sort().join(",");
  }

  function stringArray(values = []) {
    const list = Array.isArray(values) ? values : [values];
    return list.map(normalizeText).filter(Boolean);
  }

  function extractSearchParam(sourceUrl, name) {
    try {
      return new URL(sourceUrl).searchParams.get(name) || "";
    } catch {
      return "";
    }
  }

  function numericValue(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const text = normalizeText(value);
    if (!text) return 0;
    const match = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (!match) return 0;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) return 0;
    const lower = text.toLowerCase();
    const multiplier = /\bb\b|十亿/.test(lower)
      ? 1_000_000_000
      : /\bm\b|百万/.test(lower)
        ? 1_000_000
        : /\bk\b|千/.test(lower)
          ? 1_000
          : /万/.test(lower)
            ? 10_000
            : 1;
    return number * multiplier;
  }

  function dateSortValue(value) {
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function readJsonSync(filePath) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function normalizeReviewSample(row = {}) {
    const fullText = normalizeText(row.Content || row.content);
    return {
      title: normalizeText(row.Title || row.title),
      text: truncateText(fullText, 240),
      fullText,
      zhText: normalizeText(row.zhText || row.textZh || row.translationZh || row["Chinese"] || row["中文"]),
      enText: normalizeText(row.enText || row.textEn || row.translationEn || row["English"] || row["英文"]),
      rating: Number(row.Rating || row.rating || 0) || null,
      sentiment: normalizeText(row.Sentiment || row.sentiment),
      country: normalizeText(row.Country || row.country)
    };
  }

  function dedupeReviewRows(rows = []) {
    const seen = new Set();
    const deduped = [];
    for (const row of rows) {
      const key = [
        normalizeText(row.title).toLowerCase(),
        normalizeText(row.text).toLowerCase(),
        normalizeText(row.rating),
        normalizeText(row.country).toUpperCase()
      ].join("|");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
    }
    return deduped;
  }

  function selectRepresentativeReviewSamples(rows = [], limit = 25) {
    const high = rows.filter((item) => Number(item.rating || 0) >= 4);
    const neutral = rows.filter((item) => Number(item.rating || 0) === 3);
    const low = rows.filter((item) => Number(item.rating || 0) > 0 && Number(item.rating || 0) <= 2);
    const pick = [];
    const pushUnique = (item) => {
      if (!item || pick.includes(item)) return;
      pick.push(item);
    };
    high.slice(0, 8).forEach(pushUnique);
    low.slice(0, 10).forEach(pushUnique);
    neutral.slice(0, 4).forEach(pushUnique);
    [...high, ...low, ...neutral]
      .sort((a, b) => (normalizeText(b.text).length - normalizeText(a.text).length))
      .slice(0, limit)
      .forEach(pushUnique);
    rows.slice(0, limit).forEach(pushUnique);
    return pick.slice(0, limit);
  }

  function buildReviewRatingBreakdown(rows = []) {
    const breakdown = {
      total: rows.length,
      highStar: 0,
      neutral: 0,
      lowStar: 0,
      byRating: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };
    for (const row of rows) {
      const rating = Number(row.rating || 0);
      if (!Number.isFinite(rating) || rating <= 0) continue;
      if (breakdown.byRating[rating] != null) breakdown.byRating[rating] += 1;
      if (rating >= 4) breakdown.highStar += 1;
      else if (rating === 3) breakdown.neutral += 1;
      else breakdown.lowStar += 1;
    }
    return breakdown;
  }

  function buildUserReviewVisualData(evidence = {}) {
    const reviewCorpus = Array.isArray(evidence.reviewCorpus) ? evidence.reviewCorpus : [];
    const ratingBreakdown = evidence.reviewRatingBreakdown || buildReviewRatingBreakdown(reviewCorpus);
    const detailedPositive = selectDetailedReviewExamples(reviewCorpus, {
      ratingMin: 4,
      minLength: 55,
      keywords: REVIEW_POSITIVE_DETAIL_KEYWORDS,
      limit: 5
    });
    const negativeExamples = selectDetailedReviewExamples(reviewCorpus, {
      ratingMax: 2,
      keywords: REVIEW_NEGATIVE_DETAIL_KEYWORDS,
      limit: 4
    });
    const riskExamples = selectDetailedReviewExamples(reviewCorpus, {
      ratingMax: 2,
      keywords: REVIEW_RISK_KEYWORDS,
      limit: 4
    });
    return {
      ratingBreakdown,
      themes: (evidence.themeSummary || []).slice(0, 8).map((item) => ({
        id: item.id,
        title: item.title,
        count: item.count,
        examples: (item.examples || []).slice(0, 2)
      })),
      detailedPositiveCount: countReadableReviews(reviewCorpus, {
        ratingMin: 4,
        minLength: 55
      }),
      sections: {
        positive: detailedPositive.map((item) => ({
          summary: summarizeReviewForDisplay(item, "positive"),
          rating: item.rating,
          country: item.country,
          text: item.fullText || item.text
        })),
        negative: negativeExamples.map((item) => ({
          summary: summarizeReviewForDisplay(item, "negative"),
          rating: item.rating,
          country: item.country,
          text: item.fullText || item.text
        })),
        risk: riskExamples.map((item) => ({
          summary: summarizeReviewForDisplay(item, "risk"),
          rating: item.rating,
          country: item.country,
          text: item.fullText || item.text
        }))
      }
    };
  }

  const REVIEW_POSITIVE_DETAIL_KEYWORDS = [
    "scan", "scanning", "photo", "picture", "calorie", "calories", "macro", "protein",
    "carbs", "weight", "lost", "track", "tracking", "meal", "food", "nutrition",
    "database", "simple", "quick", "helpful", "accurate", "accuracy", "goal",
    "progress", "diet", "workout", "recipe", "barcode", "plan"
  ];
  const REVIEW_NEGATIVE_DETAIL_KEYWORDS = [
    "bug", "bugs", "crash", "crashing", "inaccurate", "wrong", "sync", "lost",
    "reset", "manual", "scan", "scanning", "database", "subscription", "pay",
    "refund", "support", "streak", "lag", "slow", "login", "account"
  ];
  const REVIEW_RISK_KEYWORDS = [
    "subscription", "pay", "paid", "refund", "cancel", "trial", "money", "sync",
    "lost", "switch", "support", "manual", "scan", "inaccurate", "wrong"
  ];

  function selectDetailedReviewExamples(rows = [], options = {}) {
    const scored = rows
      .filter((item) => reviewMatchesRating(item, options))
      .map((item) => ({
        item,
        score: scoreReviewDetail(item, options)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || normalizeText(b.item.text).length - normalizeText(a.item.text).length);
    const selected = [];
    const seen = new Set();
    for (const entry of scored) {
      const text = normalizeText(entry.item.text);
      const key = text.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      selected.push(entry.item);
      if (selected.length >= (options.limit || 4)) break;
    }
    return selected;
  }

  function countDetailedReviews(rows = [], options = {}) {
    return rows.filter((item) => reviewMatchesRating(item, options) && scoreReviewDetail(item, options) > 0).length;
  }

  function countReadableReviews(rows = [], options = {}) {
    return rows.filter((item) => {
      if (!reviewMatchesRating(item, options)) return false;
      const text = normalizeText(item.fullText || item.text);
      return text.length >= (options.minLength || 55) && !isGenericPraise(text);
    }).length;
  }

  function reviewMatchesRating(item = {}, options = {}) {
    const rating = Number(item.rating || 0);
    if (options.ratingMin != null && rating < options.ratingMin) return false;
    if (options.ratingMax != null && rating > options.ratingMax) return false;
    return true;
  }

  function scoreReviewDetail(item = {}, options = {}) {
    const text = normalizeText(item.fullText || item.text);
    if (text.length < (options.minLength || 35)) return 0;
    if (isGenericPraise(text)) return 0;
    const lower = text.toLowerCase();
    const keywords = options.keywords || [];
    const hits = keywords.filter((keyword) => lower.includes(keyword)).length;
    if (!hits) return 0;
    const lengthScore = Math.min(8, Math.floor(text.length / 80));
    return hits * 4 + lengthScore + Number(item.rating || 0);
  }

  function isGenericPraise(text = "") {
    const normalized = normalizeText(text).toLowerCase().replace(/[.!?。！？\s]+/g, " ").trim();
    return /^(good|great|nice|wow|love it|i like it|easy to use|the best tracking app|bueno|amazing|perfect|excellent|best app)$/.test(normalized);
  }

  function summarizeReviewForDisplay(item = {}, kind = "") {
    const text = normalizeText(item.fullText || item.text);
    const lower = text.toLowerCase();
    if (kind === "positive") {
      if (/(photo|picture|scan|scanning)/i.test(text) && /(time|manual|anotando|faster|quick|easy)/i.test(text)) return "用户认为拍照记录比手动输入更省时间，饮食记录成本更低。";
      if (/(profile|perfil|plan|dieta|diet)/i.test(text)) return "用户认可先建立个人档案，再按自身目标生成饮食计划的流程。";
      if (/(lost|lose|weight|kg|physique|workout|nutrition|goals?)/i.test(text)) return "用户把产品和减重、体型变化、训练或营养管理目标联系在一起。";
      if (/(accurate|accuracy|nutrient|macro|calorie)/i.test(text)) return "用户认可拍照识别、热量或营养拆解带来的记录效率。";
      return "这条高星评论给出了比普通短评更具体的使用场景或结果反馈。";
    }
    if (/(sync|lost|reset|switch phone|device)/i.test(text)) return "用户反馈同步或设备切换问题会造成进度丢失，影响持续记录。";
    if (/(inaccurate|wrong|manual|correction|teaching|scan|scanning|database)/i.test(text)) return "用户认为识别结果或数据库不够可靠，实际使用中仍需要大量手动修正。";
    if (/(bug|crash|lag|slow|streak)/i.test(text)) return "用户反馈 bug、卡顿或连续记录异常会直接破坏核心记录体验。";
    if (/(subscription|pay|paid|trial|money|refund|cancel)/i.test(text)) return "用户的不满和订阅、退款或付费后体验落差直接相关。";
    if (lower.includes("support")) return "用户提到客服响应不足，使问题从体验摩擦升级为信任风险。";
    return kind === "risk"
      ? "这条低星评论暴露出可能影响付费转化或长期留存的风险。"
      : "这条低星评论给出了具体的产品摩擦或失败场景。";
  }

  function buildVideoCorpus(app, videos) {
    const scored = videos.map((item) => ({
      item,
      relevance: scoreVideoRelevance(app, item)
    }));
    const relevant = scored.filter((entry) => entry.relevance.relevant).map((entry) => ({
      ...entry.item,
      relevance: entry.relevance
    }));
    const noisy = scored.filter((entry) => !entry.relevance.relevant).map((entry) => ({
      ...entry.item,
      relevance: entry.relevance
    }));
    return {
      relevant,
      noisy,
      summary: {
        total: videos.length,
        relevant: relevant.length,
        noisy: noisy.length,
        rule: "命中 App 名称/别名/商店名/相关账号，或文本明确描述该 App；未命名且画面说明无法确认 App 的素材先标为噪声。"
      }
    };
  }

  function normalizeAdShotVideoRecord(shot = {}) {
    const analysis = shot.analysis && typeof shot.analysis === "object" ? shot.analysis : {};
    const metrics = shot.metrics && typeof shot.metrics === "object" ? shot.metrics : {};
    const media = shot.media && typeof shot.media === "object" ? shot.media : {};
    return {
      ...shot,
      id: shot.shotId || shot.id || "",
      sourceKind: "ad_shot",
      title: normalizeText(shot.title || shot.caption || shot.publishedText || analysis.title || shot.sourceUrl),
      publishedText: normalizeText(shot.publishedText || shot.caption || shot.title || analysis.caption),
      visualSummary: normalizeText(
        analysis.visualSummary
        || analysis.storySummary
        || analysis.summary
        || shot.visualSummary
        || shot.summary
        || media.description
      ),
      transcriptZh: normalizeText(shot.transcriptZh || analysis.transcriptZh || analysis.scriptZh),
      transcriptEn: normalizeText(shot.transcriptEn || analysis.transcriptEn || analysis.scriptEn),
      viewCount: numericFirst(shot.viewCount, shot.views, metrics.viewCount, metrics.views, analysis.viewCount),
      likeCount: numericFirst(shot.likeCount, shot.likes, metrics.likeCount, metrics.likes, analysis.likeCount),
      commentCount: numericFirst(shot.commentCount, shot.comments, metrics.commentCount, metrics.comments, analysis.commentCount),
      sourceUrl: normalizeText(shot.sourceUrl || shot.url || shot.shareUrl || media.sourceUrl)
    };
  }

  function numericFirst(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }
    return 0;
  }

  function scoreVideoRelevance(app, video = {}) {
    const aliases = appAliases(app);
    const title = normalizeText(video.title || video.publishedText);
    const body = normalizeText(`${video.visualSummary || ""} ${video.transcriptZh || ""} ${video.transcriptEn || ""}`);
    const url = normalizeText(video.sourceUrl);
    const sourceText = `${title} ${body} ${url}`.toLowerCase();
    const reasons = [];
    let score = 0;

    let aliasMatched = false;
    for (const alias of aliases) {
      if (!alias) continue;
      if (matchesAlias(sourceText, alias)) {
        aliasMatched = true;
        score += alias.length >= 5 ? 4 : 3;
        reasons.push(`命中别名 ${alias}`);
      }
    }

    if (/app store|google play|应用|app 截图|app screenshot|screen|feature|demo|功能|演示|scan|track|log|record|camera|AI|识别|扫描|记录|拍照/i.test(sourceText)) {
      score += 1;
      reasons.push("出现 App 场景词");
    }
    if (/calorie|nutrition|meal|diet|workout|health|habit|coach|goal|plan|热量|卡路里|营养|饮食|健康|习惯|目标|计划/i.test(sourceText)) {
      score += 1;
      reasons.push("出现垂类任务词");
    }
    if (/无法.*确认.*app|没有.*app 截图|没有 app 截图|没有.*功能演示|not.*app|nothing but/i.test(sourceText) && !reasons.some((item) => item.startsWith("命中别名"))) {
      score -= 3;
      reasons.push("文本提示无法确认 App");
    }

    const relevant = aliasMatched && score >= 3;
    return {
      score,
      relevant,
      reasons: reasons.slice(0, 5)
    };
  }

  function appAliases(app = {}) {
    const values = [
      app.name,
      normalizeText(app.fullName).toLowerCase().startsWith(normalizeText(app.name).toLowerCase())
        ? app.name
        : "",
      ...normalizeText(app.bundleId).split(/[^a-z0-9]+/i).filter((part) => part.length >= 5),
      "meeff",
      "meef",
      "meeffapp",
      "aplikasimeef"
    ];
    return uniqueStrings(values.flatMap((value) => {
      const text = normalizeText(value).toLowerCase();
      if (!text) return [];
      return [
        text,
        text.replace(/[^a-z0-9]+/g, "")
      ];
    })).filter((item) => item.length >= 4);
  }

  function matchesAlias(text, alias) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (/^[a-z0-9]+$/.test(alias)) {
      return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
    }
    return text.includes(alias);
  }

  function normalizeVideoSample(item = {}) {
    return {
      title: truncateText(normalizeText(item.title || item.publishedText || item.sourceUrl), 120),
      summary: truncateText(normalizeText(item.visualSummary || item.transcriptZh || item.transcriptEn), 260),
      viewCount: numericEngagement(item, "viewCount"),
      likeCount: numericEngagement(item, "likeCount"),
      commentCount: numericEngagement(item, "commentCount"),
      relevance: item.relevance || null
    };
  }

  function flattenTikTokComments(imports) {
    return imports.flatMap((record) => {
      const items = Array.isArray(record.items) ? record.items : [];
      return items.map((item) => ({
        ...item,
        videoTitle: item.videoTitle || record.videoTitle,
        appId: item.appId || record.appId,
        sourceUrl: item.sourceUrl || record.sourceUrl
      }));
    });
  }

  function buildThemeSummary(texts) {
    return THEME_PATTERNS.map((theme) => {
      const examples = [];
      let count = 0;
      for (const value of texts) {
        const text = truncateText(normalizeText(value).replace(/\s+/g, " "), 220);
        if (!text || !theme.pattern.test(text)) continue;
        count += 1;
        if (examples.length < 5) examples.push(text);
      }
      return {
        id: theme.id,
        title: theme.title,
        count,
        examples
      };
    }).filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
  }

  function countQiaomuPayload(payload = {}) {
    const themes = normalizeQiaomuArray(payload.themes).length;
    const insights = normalizeQiaomuArray(payload.insights).length;
    const trends = normalizeQiaomuArray(payload.trends).length;
    const analysis = payload.analysis && typeof payload.analysis === "object"
      ? Object.keys(payload.analysis).length
      : normalizeText(payload.analysis) ? 1 : 0;
    return {
      themes,
      insights,
      trends,
      analysis,
      total: themes + insights + trends + analysis
    };
  }

  function buildQiaomuOutput(app, qiaomu = {}) {
    const country = normalizeCountry(app?.country || app?.storeCountry || "us");
    const url = buildQiaomuHtmlUrl(app?.id, country);
    const baseOutput = {
      type: "html",
      label: "qiaomu HTML 评论分析",
      appStoreId: normalizeText(app?.id),
      country,
      url
    };
    if (!qiaomu.available) {
      return {
        ...baseOutput,
        available: false,
        status: qiaomu.status || "missing",
        error: qiaomu.error || ""
      };
    }
    const payload = qiaomu.payload || {};
    const counts = qiaomu.counts || countQiaomuPayload(payload);
    return {
      available: true,
      ...baseOutput,
      status: qiaomu.status || "ready",
      counts,
      fetchedAt: normalizeText(qiaomu.payload?.fetchedAt)
    };
  }

  function normalizeQiaomuArray(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.items)) return value.items;
    if (Array.isArray(value?.themes)) return value.themes;
    if (Array.isArray(value?.insights)) return value.insights;
    if (Array.isArray(value?.trends)) return value.trends;
    if (Array.isArray(value?.data)) return value.data;
    return [];
  }

  function buildQiaomuHtmlUrl(appStoreId, country) {
    const id = normalizeText(appStoreId);
    if (!id || !deps.qiaomuBaseUrl) return "";
    const base = String(deps.qiaomuBaseUrl).replace(/\/+$/, "");
    return `${base}/apps/${encodeURIComponent(country || "us")}/${encodeURIComponent(id)}`;
  }

  function normalizeCountry(value) {
    const text = normalizeText(value).toLowerCase();
    return /^[a-z]{2}$/.test(text) ? text : "us";
  }

  function findExperienceDocs(app) {
    const appName = normalizeText(app.name).toLowerCase();
    const candidates = [
      reportsDir,
      path.join(storageRootDir, ".tmp")
    ];
    const docs = [];
    for (const dir of candidates) {
      for (const filePath of listMarkdownFilesSync(dir, 3)) {
        if (filePath.includes(`${path.sep}experience-templates${path.sep}`)) continue;
        const lower = path.basename(filePath).toLowerCase();
        if (!/体验|experience|实测|test/.test(lower)) continue;
        if (appName && !lower.includes(appName.toLowerCase())) continue;
        const stat = statFileSync(filePath);
        const raw = readTextFileSync(filePath);
        const parsed = parseExperienceDoc(raw, filePath);
        if (!isUsableExperienceDoc(parsed, raw)) continue;
        docs.push({
          title: parsed.title || path.basename(filePath),
          path: filePath,
          relativePath: path.relative(storageRootDir, filePath),
          modifiedAt: stat?.mtime?.toISOString?.() || "",
          size: stat?.size || 0,
          excerpt: parsed.excerpt,
          headings: parsed.headings
        });
      }
    }
    return docs.sort((a, b) => normalizeText(b.modifiedAt).localeCompare(normalizeText(a.modifiedAt))).slice(0, 10);
  }

  function parseExperienceDoc(raw, filePath) {
    const source = String(raw || "");
    const titleFromHeading = source.match(/^#\s+(.+)$/m)?.[1];
    const headings = [...source.matchAll(/^#{1,3}\s+(.+)$/gm)]
      .map((match) => truncateText(normalizeText(match[1]), 80))
      .filter(Boolean)
      .slice(0, 12);
    const body = source
      .replace(/^---[\s\S]*?---/m, " ")
      .replace(/^#{1,6}\s+/gm, " ")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
      .replace(/\[[^\]]+]\([^)]+\)/g, (match) => match.replace(/^\[|\]\([^)]+\)$/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    return {
      title: titleFromHeading ? truncateText(normalizeText(titleFromHeading), 100) : path.basename(filePath),
      headings,
      excerpt: truncateText(normalizeText(body), 520)
    };
  }

  function isUsableExperienceDoc(parsed = {}, raw = "") {
    const filledItems = extractFilledExperienceItems(raw);
    if (filledItems.length >= 3) return true;
    if (/这是填写模板，不会被系统当作正式体验材料/.test(String(raw || ""))) return false;
    const text = normalizeText(parsed.excerpt)
      .replace(/这是填写模板，不会被系统当作正式体验材料/g, " ")
      .replace(/写完后请保存为：\S+/g, " ")
      .replace(/保存后刷新 `?\/reports`?，产品体验实测模块会点亮/g, " ")
      .replace(/App：\S+/g, " ")
      .replace(/测试设备：|测试系统：|测试地区 \/ 语言：|测试日期：|测试账号状态：/g, " ")
      .replace(/我模拟的用户是谁：|用户来这里想完成什么：|用户替代方案可能是什么：/g, " ")
      .replace(/入口：App Store \/ Google Play \/ TikTok 链接 \/ 其他|注册方式：|权限请求：|第一屏给我的承诺：|卡点 \/ 犹豫点：/g, " ")
      .replace(/路径步骤 \d：|路径步骤：|哪一步最顺：|哪一步最卡：|失败 \/ 犹豫 \/ 返回发生在哪里：|关联证据 ID：/g, " ")
      .replace(/供给是否符合外部素材承诺：|真人感 \/ 信任感：|回复率 \/ 互动质量：|推荐或筛选机制感受：/g, " ")
      .replace(/第一次看到付费 \/ 广告的位置：|它是在增强体验，还是打断体验：|我愿不愿意付费，为什么：/g, " ")
      .replace(/假号 \/ 诈骗 \/ 骚扰感受：|举报 \/ 拉黑 \/ 隐私保护：|哪些风险会影响继续使用：/g, " ")
      .replace(/当前系统已有 TT 相关素材：\d+ 条|当前系统已有商店评论行数：\d+ 条|可重点验证主题：[^。]+/g, " ")
      .replace(/核心体验判断：|最强证据编号：|置信度：高 \/ 中 \/ 低|判断 \d：|还需要补的截图 \/ 录屏 \/ 证据|缺口 \d：/g, " ")
      .replace(/MEEFF|体验实测|一句话体验结论|测试边界|新号|老号|付费号|免费号|用户原任务|体验路径证据台账|关键路径拆解|首次进入与注册|核心任务路径|匹配互动内容供给|付费与商业化触点|安全感与风险|与外部证据对照|外部承诺真实体验对照表|体验判断证据矩阵|可写入报告的体验段落草稿/g, " ")
      .replace(/EXP\d|VID\d|REV\d|EXT\d|TT 素材承诺|商店评论痛点|主题聚类|素材表达不等同于真实体验|单条评论需要和体验路径互证|主题命中不等同于全部用户/g, " ")
      .replace(/判断|支撑体验证据|外部互证|可写入报告的位置|体验结论|定位反证|风险边界|用户 case|商业化摩擦|增长承诺对照/g, " ")
      .replace(/\d+/g, " ")
      .replace(/[：:；;，,。\-\s/`><（）()]+/g, "");
    return text.length >= 80;
  }

  function extractFilledExperienceItems(raw = "") {
    const placeholderValues = new Set([
      "",
      "App Store / Google Play / TikTok 链接 / 其他",
      "新号 / 老号 / 付费号 / 免费号",
      "高 / 中 / 低",
      "EXP",
      "VID / REV / EXT",
      "体验结论 / 定位反证 / 风险边界",
      "体验结论 / 用户 case / 商业化摩擦",
      "体验结论 / 增长承诺对照"
    ]);
    return String(raw || "").split(/\r?\n/)
      .map((line) => normalizeText(line))
      .filter((line) => /^[-*]\s+/.test(line))
      .map((line) => line.replace(/^[-*]\s*/, ""))
      .map((line) => {
        const [, value = ""] = line.match(/^[^：:]{1,40}[：:]\s*(.+)$/) || [];
        if (!value && /^[^：:]{1,40}[：:]$/.test(line)) return "";
        return normalizeText(value || (/^判断\s*\d+[：:]?$/.test(line) ? "" : line));
      })
      .filter((value) => value && !placeholderValues.has(value))
      .filter((value) => !/^App：/.test(value))
      .filter((value) => !/^#+\s*/.test(value))
      .filter((value) => !/^>/.test(value))
      .filter((value) => !/^可重点验证主题/.test(value))
      .filter((value) => !/^当前系统已有/.test(value))
      .filter((value) => !/^\d+\s*条$/.test(value))
      .filter((value) => !/^.+（\d+）$/.test(value))
      .filter((value) => !/^路径步骤\s*\d/.test(value))
      .filter((value) => !/^判断\s*\d/.test(value))
      .filter((value) => !/^缺口\s*\d/.test(value))
      .filter((value) => !/^段落\s*\d/.test(value))
      .filter((value) => !/^EXP\d|^VID\d|^REV\d|^EXT\d/.test(value))
      .filter((value) => !/素材表达不等同于真实体验|单条评论需要和体验路径互证|主题命中不等同于全部用户/.test(value))
      .filter((value) => value.length >= 6);
  }

  function readTextFileSync(filePath) {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return "";
    }
  }

  function statFileSync(filePath) {
    try {
      return fs.statSync(filePath);
    } catch {
      return null;
    }
  }

  function listMarkdownFilesSync(dir, depth) {
    if (depth < 0) return [];
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.flatMap((entry) => {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listMarkdownFilesSync(filePath, depth - 1);
      return entry.isFile() && entry.name.endsWith(".md") ? [filePath] : [];
    });
  }

  function recordAppId(item = {}) {
    return normalizeText(item.appId || item.app_id || item.app?.id);
  }

  function numericEngagement(item, field) {
    return Number(item?.engagement?.[field] ?? item?.metrics?.[field] ?? item?.[field] ?? 0) || 0;
  }

  function sumRows(records) {
    return records.reduce((sum, item) => sum + (Number(item.rowCount || 0) || 0), 0);
  }

  function countPositive(values) {
    return values.filter((value) => Number(value || 0) > 0).length;
  }

  function uniqueStrings(values) {
    return [...new Set(values.map(normalizeText).filter(Boolean))];
  }

  function bulletLines(values) {
    const lines = values.map(normalizeText).filter(Boolean);
    return lines.length ? lines.map((item) => `- ${item}`) : ["- 暂无。"];
  }

  function displayAppName(app = {}) {
    return normalizeText(app.name || app.fullName || app.id) || "未命名 App";
  }

  function normalizeText(value) {
    return deps.normalizeText(value);
  }

  function truncateText(value, maxLength = 220) {
    return deps.truncateText(value, maxLength);
  }

  function truncateMarkdown(value, maxLength = 6000) {
    const text = String(value || "").replace(/\r\n/g, "\n").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
  }

  return {
    buildReportOutputOverview,
    buildAppReportOutput,
    buildAppCategoryRankingOutput,
    prepareAppReportModuleAi,
    generateAppReportModule,
    generateAppReportModules
  };
}
