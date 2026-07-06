import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const REPORT_AI_WORKFLOW_VERSION = 1;

const SUPPORTED_MODULE_IDS = new Set([
  "anomaly_signal",
  "market_overview",
  "country_market_split",
  "category_competitors",
  "user_pain_points",
  "experience",
  "growth_signals",
  "paid_points",
  "user_reviews",
  "founder_company"
]);

export function createReportAiWorkflow(deps = {}) {
  const requiredDeps = ["projectRootDir", "normalizeText", "truncateText"];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createReportAiWorkflow 缺少依赖：${dep}`);
    }
  }
  const reportsDir = deps.reportsDir || path.join(deps.projectRootDir, "reports");

  async function prepareModule({ definition, app, counts, evidence, deterministicAnalysis, sourceFingerprint = "" }) {
    if (!isReportAiModuleSupported(definition?.id)) {
      return { available: false, error: "模块 prompt 待确认" };
    }
    const sourcePack = buildReportAiSourcePack({ definition, app, counts, evidence, deterministicAnalysis });
    const prompt = buildReportAiPrompt(definition.id, sourcePack);
    const paths = await writeReportAiArtifacts(app, definition, {
      sourcePack,
      prompt,
      sourceFingerprint
    });
    return {
      available: true,
      moduleId: definition.id,
      sourcePack,
      prompt,
      ...paths
    };
  }

  async function generateModuleInsights({ definition, app, counts, evidence, deterministicAnalysis, sourceFingerprint = "" }) {
    if (process.env.TT2TEXT_REPORT_AI === "off") {
      return { available: false, error: "TT2TEXT_REPORT_AI=off" };
    }
    const prepared = await prepareModule({ definition, app, counts, evidence, deterministicAnalysis, sourceFingerprint });
    if (!prepared.available) return prepared;

    const apiKey = readAgnesApiKey();
    if (!apiKey) {
      return {
        ...prepared,
        available: false,
        error: "AGNES_API_KEY 或 macOS Keychain agnes-ai/default 未配置"
      };
    }

    const model = process.env.TT2TEXT_REPORT_AI_MODEL || process.env.AGNES_MODEL || "agnes-2.0-flash";
    const baseUrl = (process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.com/v1").replace(/\/+$/, "");
    const timeoutMs = Number(process.env.TT2TEXT_REPORT_AI_TIMEOUT_MS || 60_000);
    const maxAttempts = Math.max(1, Number(process.env.TT2TEXT_REPORT_AI_ATTEMPTS || 2));
    let preparedForGeneration = prepared;

    if (definition.id === "paid_points") {
      const visionTimeoutMs = Number(process.env.TT2TEXT_PAYWALL_VISION_TIMEOUT_MS || Math.max(timeoutMs, 120_000));
      preparedForGeneration = await enrichPaidPointsWithVision({
        prepared,
        definition,
        app,
        apiKey,
        baseUrl,
        timeoutMs: visionTimeoutMs,
        sourceFingerprint
      });
    }
    if (definition.id === "user_reviews") {
      preparedForGeneration = await enrichUserReviewsWithCorpusDigest({
        prepared: preparedForGeneration,
        definition,
        app,
        evidence,
        apiKey,
        baseUrl,
        timeoutMs,
        sourceFingerprint
      });
    }
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const insights = await requestModuleAiInsights({
          baseUrl,
          apiKey,
          model,
          prompt: preparedForGeneration.prompt,
          timeoutMs
        });
        return { ...preparedForGeneration, ...insights };
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts || !isRetryableAiError(error)) break;
        await delay(Math.min(1000 * attempt, 2500));
      }
    }

    return {
      ...preparedForGeneration,
      available: false,
      error: formatAiError(lastError, timeoutMs, maxAttempts)
    };
  }

  async function enrichPaidPointsWithVision({ prepared, definition, app, apiKey, baseUrl, timeoutMs, sourceFingerprint = "" }) {
    const paywallSamples = prepared?.sourcePack?.paywallSamples || [];
    const imageUrls = paywallSamples.map((item) => normalizeText(item.imageUrl)).filter(Boolean).slice(0, 4);
    if (!imageUrls.length) return prepared;

    const visionModel = process.env.TT2TEXT_PAYWALL_VISION_MODEL
      || process.env.TT2TEXT_AGNES_VISION_MODEL
      || "agnes-1.5-flash";
    try {
      const paywallVision = await requestPaywallVisionAnalysis({
        baseUrl,
        apiKey,
        model: visionModel,
        imageUrls,
        paywallSamples,
        timeoutMs
      });
      const sourcePack = {
        ...prepared.sourcePack,
        paywallVision
      };
      const prompt = buildReportAiPrompt(definition.id, sourcePack);
      const paths = await writeReportAiArtifacts(app, definition, {
        sourcePack,
        prompt,
        sourceFingerprint
      });
      return {
        ...prepared,
        sourcePack,
        prompt,
        ...paths
      };
    } catch (error) {
      const sourcePack = {
        ...prepared.sourcePack,
        paywallVision: {
          available: false,
          provider: "Agnes",
          model: visionModel,
          error: formatAiError(error, timeoutMs, 1)
        }
      };
      const prompt = buildReportAiPrompt(definition.id, sourcePack);
      const paths = await writeReportAiArtifacts(app, definition, {
        sourcePack,
        prompt,
        sourceFingerprint
      });
      return {
        ...prepared,
        sourcePack,
        prompt,
        ...paths
      };
    }
  }

  async function enrichUserReviewsWithCorpusDigest({ prepared, definition, app, evidence, apiKey, baseUrl, timeoutMs, sourceFingerprint = "" }) {
    const reviewCorpus = Array.isArray(evidence?.reviewCorpus) ? evidence.reviewCorpus : [];
    if (!reviewCorpus.length) return prepared;
    try {
      const reviewCorpusDigest = await requestUserReviewCorpusDigest({
        baseUrl,
        apiKey,
        model: process.env.TT2TEXT_REPORT_AI_MODEL || process.env.AGNES_MODEL || "agnes-2.0-flash",
        reviewCorpus,
        ratingBreakdown: evidence?.reviewRatingBreakdown || null,
        timeoutMs
      });
      const sourcePack = {
        ...prepared.sourcePack,
        reviewCorpusDigest
      };
      const prompt = buildReportAiPrompt(definition.id, sourcePack);
      const paths = await writeReportAiArtifacts(app, definition, {
        sourcePack,
        prompt,
        sourceFingerprint
      });
      return {
        ...prepared,
        sourcePack,
        prompt,
        ...paths
      };
    } catch (error) {
      const sourcePack = {
        ...prepared.sourcePack,
        reviewCorpusDigest: {
          available: false,
          provider: "Agnes",
          model: process.env.TT2TEXT_REPORT_AI_MODEL || process.env.AGNES_MODEL || "agnes-2.0-flash",
          error: formatAiError(error, timeoutMs, 1)
        }
      };
      const prompt = buildReportAiPrompt(definition.id, sourcePack);
      const paths = await writeReportAiArtifacts(app, definition, {
        sourcePack,
        prompt,
        sourceFingerprint
      });
      return {
        ...prepared,
        sourcePack,
        prompt,
        ...paths
      };
    }
  }

  async function requestPaywallVisionAnalysis({ baseUrl, apiKey, model, imageUrls = [], paywallSamples = [], timeoutMs }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const prompt = buildPaywallVisionPrompt(paywallSamples);
      const content = [
        { type: "text", text: prompt },
        ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } }))
      ];
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "你是严谨的 paywall 截图 OCR 和视觉结构识别助手，只返回严格 JSON，不输出代码块。" },
            { role: "user", content }
          ],
          temperature: 0.1,
          max_tokens: 3600
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      const parsed = parseAiJson(payload?.choices?.[0]?.message?.content || "");
      return normalizePaywallVision(parsed, { model });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function requestModuleAiInsights({ baseUrl, apiKey, model, prompt, timeoutMs }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "你是严谨的中文 App 研究员，只返回严格 JSON，不输出代码块。" },
            { role: "user", content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 2600,
          response_format: { type: "json_object" }
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }

      const content = payload?.choices?.[0]?.message?.content || "";
      const parsed = parseAiJson(content);
      return normalizeModuleAiInsights(parsed, { model });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function requestUserReviewCorpusDigest({ baseUrl, apiKey, model, reviewCorpus = [], ratingBreakdown = null, timeoutMs }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(timeoutMs, 180_000));
    try {
      const reviewLines = reviewCorpus.slice(0, 2500).map((item, index) => {
        const rating = Number(item.rating || 0) || "";
        const country = normalizeText(item.country);
        const title = normalizeText(item.title);
        const text = normalizeText(item.text);
        return `R${index + 1}\t${rating ? `${rating}星` : "未评分"}\t${country || "未知国家"}\t${title ? `${title} | ` : ""}${text}`;
      }).join("\n");
      const prompt = [
        "你是中文 App 评论分析师。请只基于下面这批完整评论，输出严格 JSON，总结这个 App 的口碑结构。",
        "",
        "要求：",
        "- 只基于评论文本本身归纳，不外推下载、收入、留存或品牌地位。",
        "- sample_stats 里的 total / high_star / neutral / low_star 必须优先采用已给定的本地统计。",
        "- positive_breakdown 需要区分：泛化好评、具体功能认可、结果/效率认可。",
        "- positives / negatives / risks 每个主题都要包含 title、count、summary、representative_ids。",
        "- count 必须是这批评论里的命中数量估计，不能超过 sample_stats.total。",
        "- one_paragraph_takeaway 控制在 180 字内。",
        "",
        `本地星级统计：${JSON.stringify(ratingBreakdown || {})}`,
        "",
        `完整评论（共 ${reviewCorpus.length} 条）：`,
        reviewLines,
        "",
        "返回 JSON schema：",
        JSON.stringify(buildUserReviewDigestShape())
      ].join("\n");
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "你是严谨的中文 App 评论研究员，只返回严格 JSON，不输出代码块。" },
            { role: "user", content: prompt }
          ],
          temperature: 0.1,
          max_tokens: 2400,
          response_format: { type: "json_object" }
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }
      const content = payload?.choices?.[0]?.message?.content || "";
      const parsed = parseAiJson(content);
      return normalizeUserReviewDigest(parsed, {
        model,
        ratingBreakdown,
        total: reviewCorpus.length
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  function buildPaywallVisionPrompt(paywallSamples = []) {
    return [
      "请识别这些 App paywall 截图，只基于图片内容输出中文 JSON。",
      "",
      "要求：",
      "- 不要猜看不清的内容；看不清就写“不确定”。",
      "- visibleText 尽量逐条列出截图中可见文案。",
      "- prices 只写图片中明确出现的价格、周期、折扣或省钱比例。",
      "- benefits 只写图片明确表达的权益或卖点。",
      "- lockedFeatures 只写图片明确表达的锁定功能；如果只是隐含订阅，不要硬写具体锁点。",
      "- 看到 Try for $0.00 / No Payment Due Now 只能写“当前无需付款/试用入口”，不能写“首年免费”，除非图片明确写 first year free。",
      "- closeOrSkip 写是否看得到关闭、跳过、恢复购买、取消等入口。",
      "- uncertainty 写仍不能判断的部分。",
      "",
      "Paywall 样本：",
      JSON.stringify(paywallSamples.map((item, index) => ({
        imageIndex: index + 1,
        evidenceId: item.id,
        appName: item.appName,
        imageUrl: item.imageUrl,
        pageUrl: item.pageUrl,
        collectedAt: item.collectedAt
      })), null, 2),
      "",
      "输出 JSON 字段必须完全一致：",
      JSON.stringify({
        screens: [{
          imageIndex: 1,
          evidenceId: "P1",
          visibleText: ["截图中可见文案"],
          prices: ["明确价格或周期"],
          trial: "试用或无需立即付款信息",
          benefits: ["明确权益或卖点"],
          lockedFeatures: ["明确被锁功能；不确定则空数组"],
          cta: "主按钮文案",
          closeOrSkip: "关闭/跳过/Restore/取消入口",
          layoutNotes: "页面结构简述",
          uncertainty: ["看不清或不能判断的点"]
        }],
        summary: {
          mainOffer: "主要卖什么",
          priceStructure: "价格结构",
          trialOrPaymentTiming: "试用/扣费时机",
          likelyLockedValue: "明确证据不足时写不确定",
          remainingUncertainty: ["仍不确定什么"]
        }
      })
    ].join("\n");
  }

  function normalizePaywallVision(value, meta = {}) {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const screens = Array.isArray(record.screens) ? record.screens : [];
    return {
      available: true,
      provider: "Agnes",
      model: meta.model || "",
      screens: screens.slice(0, 6).map((screen, index) => {
        const item = screen && typeof screen === "object" ? screen : {};
        return {
          imageIndex: Number(item.imageIndex || index + 1),
          evidenceId: truncateText(item.evidenceId || `P${index + 1}`, 20),
          visibleText: normalizeStringList(item.visibleText, 24),
          prices: normalizeStringList(item.prices, 8),
          trial: truncateText(item.trial, 180),
          benefits: normalizeStringList(item.benefits, 12).map(cleanVisionText),
          lockedFeatures: normalizeStringList(item.lockedFeatures, 10),
          cta: truncateText(item.cta, 120),
          closeOrSkip: truncateText(item.closeOrSkip, 140),
          layoutNotes: truncateText(item.layoutNotes, 320),
          uncertainty: normalizeStringList(item.uncertainty, 10)
        };
      }),
      summary: normalizePaywallVisionSummary(record.summary)
    };
  }

  function normalizePaywallVisionSummary(value = {}) {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      mainOffer: cleanVisionText(truncateText(record.mainOffer, 260)),
      priceStructure: cleanVisionText(truncateText(record.priceStructure, 260)),
      trialOrPaymentTiming: cleanVisionText(truncateText(record.trialOrPaymentTiming, 220)),
      likelyLockedValue: cleanVisionText(truncateText(record.likelyLockedValue, 260)),
      remainingUncertainty: normalizeStringList(record.remainingUncertainty, 10)
    };
  }

  function cleanVisionText(value) {
    return normalizeText(value)
      .replace(/\s*\(implied by[^)]*\)/gi, "")
      .replace(/\bimplied by screenshot\b/gi, "")
      .trim();
  }

  function buildReportAiSourcePack({ definition, app, counts, evidence, deterministicAnalysis }) {
    const base = {
      workflowVersion: REPORT_AI_WORKFLOW_VERSION,
      app: {
        id: normalizeText(app?.id),
        name: displayAppName(app),
        fullName: normalizeText(app?.fullName),
        category: normalizeText(app?.category || app?.categories?.join?.("、")),
        sellerName: normalizeText(app?.sellerName)
      },
      module: {
        id: definition.id,
        title: definition.title,
        questions: deterministicAnalysis?.playbook?.questions || []
      }
    };
    if (definition.id === "country_market_split") {
      return {
        ...base,
        dataPeriod: normalizeDateRange(evidence?.countryMarket?.dateRange || evidence?.marketMetrics?.dataPeriod || {}),
        totals: {
          downloads: roundNumber(evidence?.countryMarket?.totalDownloads || 0),
          revenueUsd: roundMoney(evidence?.countryMarket?.totalRevenueUsd || 0),
          globalRpd: rpd(evidence?.countryMarket?.totalRevenueUsd, evidence?.countryMarket?.totalDownloads),
          countryCount: Number(evidence?.countryMarket?.rows?.length || 0)
        },
        topRevenueCountries: normalizeCountryRows(evidence?.countryMarket?.topRevenueCountries || []),
        topDownloadCountries: normalizeCountryRows(evidence?.countryMarket?.topDownloadCountries || []),
        topRpdCountries: normalizeCountryRows(evidence?.countryMarket?.topRpdCountries || []),
        downloadOverIndexCountries: normalizeCountryRows((evidence?.countryMarket?.rows || [])
          .filter((item) => Number(item.revenueDownloadShareGap || 0) < -0.01)
          .sort((a, b) => Number(a.revenueDownloadShareGap || 0) - Number(b.revenueDownloadShareGap || 0))
          .slice(0, 8)),
        revenueOverIndexCountries: normalizeCountryRows((evidence?.countryMarket?.rows || [])
          .filter((item) => Number(item.revenueDownloadShareGap || 0) > 0.01)
          .sort((a, b) => Number(b.revenueDownloadShareGap || 0) - Number(a.revenueDownloadShareGap || 0))
          .slice(0, 8))
      };
    }
    if (definition.id === "category_competitors") {
      const ranking = normalizeCategoryRankingPack(evidence?.categoryRanking || null, app);
      return {
        ...base,
        sourceCounts: {
          categoryRankings: Number(counts?.categoryRankings || 0),
          categoryRankingRows: Number(counts?.categoryRankingRows || 0)
        },
        rankingContext: ranking.context,
        targetApp: ranking.targetApp,
        nearbyCompetitors: ranking.nearbyCompetitors,
        topCompetitors: ranking.topCompetitors,
        missingLocalCompetitors: ranking.missingLocalCompetitors,
        deterministicCompetitorBreakdown: deterministicAnalysis?.moduleBreakdown || [],
        evidenceLedger: (deterministicAnalysis?.evidenceLedger || [])
          .filter((item) => /^K\d+/.test(item.id || ""))
          .slice(0, 20)
      };
    }
    if (definition.id === "user_pain_points") {
      return {
        ...base,
        sourceCounts: {
          painPointSources: Number(counts?.painPointSources || 0),
          storeScreenshots: Number(counts?.storeScreenshots || 0),
          articles: Number(counts?.articles || 0),
          ttVideos: Number(counts?.ttVideos || 0),
          ttComments: Number(counts?.ttComments || 0),
          reviewRows: Number(counts?.reviewRows || 0),
          reviewSamples: Number(counts?.reviewSamples || 0),
          experienceDocs: Number(counts?.experienceDocs || 0),
          paywalls: Number(counts?.paywalls || 0)
        },
        officialPainSignals: {
          storeScreenshots: normalizeStoreScreenshots(evidence?.storeScreenshots || []),
          articles: normalizeArticleSamples(evidence?.articleSamples || []),
          videos: normalizeVideoSamples(evidence?.videoSamples || [], 6)
        },
        userVoiceSignals: {
          themes: normalizeThemeSummary(evidence?.themeSummary || []),
          appStoreReviewCases: normalizeReviewSamples(evidence?.reviewSamples || [], 8),
          tiktokCommentCases: normalizeTtCommentSamples(evidence?.ttCommentSamples || [], 6)
        },
        validationSignals: {
          experienceDocs: normalizeExperienceDocs(evidence?.experienceDocs || []),
          paywallSamples: normalizePaywallSamples(evidence?.paywallSamples || [])
        },
        deterministicPainBreakdown: deterministicAnalysis?.moduleBreakdown || [],
        evidenceLedger: (deterministicAnalysis?.evidenceLedger || [])
          .filter((item) => /^(S|R|C|T|V|A|X|P)\d+/.test(item.id || ""))
          .slice(0, 28)
      };
    }
    if (definition.id === "growth_signals") {
      return {
        ...base,
        sourceCounts: {
          ttVideos: Number(counts?.ttVideos || 0),
          ttVideosRaw: Number(counts?.ttVideosRaw || 0),
          ttVideosNoisy: Number(counts?.ttVideosNoisy || 0),
          ttComments: Number(counts?.ttComments || 0),
          tiktokCommentImports: Number(counts?.tiktokCommentImports || 0)
        },
        videoRelevance: evidence?.videoRelevance || null,
        growthVideos: normalizeGrowthVideoSamples(evidence?.videoSamples || [], 16, "V"),
        noisyVideos: normalizeGrowthVideoSamples(evidence?.noisyVideoSamples || [], 5, "N"),
        audienceComments: normalizeTtCommentSamples(evidence?.ttCommentSamples || [], 12),
        deterministicGrowthBreakdown: deterministicAnalysis?.moduleBreakdown || [],
        evidenceLedger: prioritizeGrowthEvidenceLedger(deterministicAnalysis?.evidenceLedger || [])
      };
    }
    if (definition.id === "experience") {
      return {
        ...base,
        sourceCounts: {
          experienceDocs: Number(counts?.experienceDocs || 0),
          storeScreenshots: Number(counts?.storeScreenshots || 0),
          paywalls: Number(counts?.paywalls || 0),
          ttVideos: Number(counts?.ttVideos || 0),
          reviewSamples: Number(counts?.reviewSamples || 0),
          ttComments: Number(counts?.ttComments || 0)
        },
        experienceDocs: normalizeExperienceDocs(evidence?.experienceDocs || [], 8),
        storeScreenshots: normalizeStoreScreenshots(evidence?.storeScreenshots || []),
        paywallSamples: normalizePaywallSamples(evidence?.paywallSamples || []),
        videos: normalizeVideoSamples(evidence?.videoSamples || [], 6),
        appStoreReviewCases: normalizeReviewSamples(evidence?.reviewSamples || [], 6),
        tiktokCommentCases: normalizeTtCommentSamples(evidence?.ttCommentSamples || [], 6),
        deterministicExperienceBreakdown: deterministicAnalysis?.moduleBreakdown || [],
        evidenceLedger: (deterministicAnalysis?.evidenceLedger || [])
          .filter((item) => /^(X|P|S|V|R|C)\d+/.test(item.id || ""))
          .slice(0, 28)
      };
    }
    if (definition.id === "paid_points") {
      return {
        ...base,
        sourceCounts: {
          paidPointSources: Number(counts?.paidPointSources || 0),
          paywalls: Number(counts?.paywalls || 0),
          sensorImports: Number(counts?.sensorImports || 0),
          countryMarketRows: Number(counts?.countryMarketRows || 0)
        },
        paywallSamples: normalizePaywallSamples(evidence?.paywallSamples || []),
        revenueData: normalizeRevenueEvidenceItems(deterministicAnalysis?.evidenceLedger || []),
        highPayingMarkets: normalizeCountryRows(evidence?.countryMarket?.topRpdCountries || []).slice(0, 10),
        topRevenueMarkets: normalizeCountryRows(evidence?.countryMarket?.topRevenueCountries || []).slice(0, 8),
        topDownloadMarkets: normalizeCountryRows(evidence?.countryMarket?.topDownloadCountries || []).slice(0, 8),
        countryMarketEvidenceIds: selectCountryMarketEvidenceIds(deterministicAnalysis?.evidenceLedger || []),
        deterministicPaidBreakdown: deterministicAnalysis?.moduleBreakdown || [],
        evidenceLedger: (deterministicAnalysis?.evidenceLedger || [])
          .filter((item) => /^(P|D)\d+/.test(item.id || ""))
          .slice(0, 24)
      };
    }
    if (definition.id === "user_reviews") {
      return {
        ...base,
        sourceCounts: {
          userVoice: Number(counts?.userVoice || 0),
          reviewRows: Number(counts?.reviewRows || 0),
          reviewSamples: Number(counts?.reviewSamples || 0),
          reviewCorpus: Number(counts?.reviewCorpus || 0),
          ttComments: Number(counts?.ttComments || 0),
          riskSources: Number(counts?.riskSources || 0)
        },
        reviewRatingBreakdown: evidence?.reviewRatingBreakdown || null,
        reviewThemes: normalizeThemeSummary(evidence?.themeSummary || []),
        appStoreReviewCases: normalizeReviewSamples(evidence?.reviewSamples || [], 10),
        tiktokCommentCases: normalizeTtCommentSamples(evidence?.ttCommentSamples || [], 8),
        reviewCorpusDigest: null,
        deterministicReviewBreakdown: deterministicAnalysis?.moduleBreakdown || [],
        evidenceLedger: (deterministicAnalysis?.evidenceLedger || [])
          .filter((item) => /^(R|T|C)\d+/.test(item.id || ""))
          .slice(0, 28)
      };
    }
    if (definition.id === "founder_company") {
      const founderLedger = (deterministicAnalysis?.evidenceLedger || [])
        .filter((item) => /^A\d+/.test(item.id || ""))
        .slice(0, 12);
      return {
        ...base,
        sourceCounts: {
          articles: Number(counts?.articles || 0),
          companySources: Number(counts?.companySources || 0)
        },
        appReleaseSignals: normalizeAppReleaseSignals(evidence?.appReleaseSignals || [], 6),
        companyArticles: normalizeArticleSamples(evidence?.companyArticleSamples || evidence?.articleSamples || [], 12),
        evidenceLedger: founderLedger
      };
    }
    return {
      ...base,
      evidenceLedger: (deterministicAnalysis?.evidenceLedger || []).filter((item) => /^(D|K)/.test(item.id)).slice(0, 24),
      marketDataOnly: {
        marketMetrics: evidence?.marketMetrics || null,
        sensorNoDataSignals: evidence?.sensorNoDataSignals || [],
        sensorFailureSignals: evidence?.sensorFailureSignals || [],
        sensorImports: (evidence?.sensorImports || [])
          .filter((item) => /download|revenue|active|usage|category/i.test(item.dataType || ""))
          .slice(0, 12),
        countryMarket: evidence?.countryMarket || null,
        categoryRanking: evidence?.categoryRanking || null,
        deterministicDataSignals: deterministicAnalysis?.moduleBreakdown || [],
        evidenceLedger: (deterministicAnalysis?.evidenceLedger || []).filter((item) => /^(D|K)/.test(item.id)).slice(0, 18)
      }
    };
  }

  function buildReportAiPrompt(moduleId, sourcePack) {
    if (moduleId === "market_overview") return buildMarketOverviewPrompt(sourcePack);
    if (moduleId === "country_market_split") return buildCountryMarketSplitPrompt(sourcePack);
    if (moduleId === "category_competitors") return buildCategoryCompetitorsPrompt(sourcePack);
    if (moduleId === "user_pain_points") return buildUserPainPointsPrompt(sourcePack);
    if (moduleId === "experience") return buildExperiencePrompt(sourcePack);
    if (moduleId === "growth_signals") return buildGrowthSignalsPrompt(sourcePack);
    if (moduleId === "paid_points") return buildPaidPointsPrompt(sourcePack);
    if (moduleId === "user_reviews") return buildUserReviewsPrompt(sourcePack);
    if (moduleId === "founder_company") return buildFounderCompanyPrompt(sourcePack);
    return buildDataStatusPrompt(sourcePack);
  }

  async function writeReportAiArtifacts(app, definition, { sourcePack, prompt, sourceFingerprint = "" }) {
    const dir = path.join(reportsDir, "ai-source-packs", safeFileSegment(displayAppName(app)));
    await fs.promises.mkdir(dir, { recursive: true });
    const jsonPath = path.join(dir, `${definition.id}.json`);
    const promptPath = path.join(dir, `${definition.id}.prompt.md`);
    const meta = {
      generatedAt: new Date().toISOString(),
      workflowVersion: REPORT_AI_WORKFLOW_VERSION,
      moduleId: definition.id,
      sourceFingerprint
    };
    await fs.promises.writeFile(jsonPath, `${JSON.stringify({ meta, sourcePack }, null, 2)}\n`, "utf8");
    await fs.promises.writeFile(promptPath, `${prompt.trim()}\n`, "utf8");
    return {
      sourcePackPath: publicReportAiPath(app, definition, "json"),
      sourcePackFilePath: jsonPath,
      promptPath: publicReportAiPath(app, definition, "prompt.md"),
      promptFilePath: promptPath
    };
  }

  function isReportAiModuleSupported(moduleId) {
    return SUPPORTED_MODULE_IDS.has(normalizeText(moduleId));
  }

  function citationPromptRules() {
    return [
      "- 正文事实句优先用可读证据 ID 承接，例如文章 A、评论 R/C、视频 V、体验 X；数据 CSV、榜单、行数等内部材料只支撑数值判断，不要在 reportDraftMarkdown 正文里暴露 D 或 K 类 ID。",
      "- 只能使用 Source Pack 的 evidenceLedger 里真实存在的 ID；禁止创造 E1、B1、M1、APP1 或其他不存在编号。",
      "- 引用 ID 直接写成 A1、R1、C1、V1 这种形式；不要写成 [A1]、[R1]、[E1] 或脚注格式。",
      "- 文章、访谈、PR、官网等外部来源优先使用 A 类证据 ID；需要多个来源互证时写 A1、A2。",
      "- 除非媒体或作者本身是分析对象，否则不要在正文反复写“据 xxx 报道”“根据 xxx 采访”“xxx 表示”；把来源放到证据 ID 里。",
      "- reportDraftMarkdown 正文不要出现“报道指出”“报道提及”“采访中提到”“文章称”“媒体曝光”“主流媒体”等来源过程词；直接写可确认事实并在句末加证据 ID。",
      "- reportDraftMarkdown 正文不得使用“报道 / 采访 / 文章 / 媒体”这类来源过程词；只有在分析传播叙事本身时才可使用“叙事”。",
      "- reportDraftMarkdown 正文不要把 sourceName 当作句子主语，例如 TechCrunch、Business Insider、Latka、Apple Podcasts；这些名称只留在证据台账和前端引用卡里。",
      "- 如果引用的是原话或单一来源事实，要在句末放证据 ID，并避免把单一来源扩写成行业共识。",
      "- reportAngles.paragraph 也必须保留证据 ID，方便前端渲染为可点击引用角标。"
    ];
  }

  function buildDataStatusPrompt(sourcePack) {
    return [
      "你是中文 App 分析报告作者。请只基于输入的市场数据，写一个「数据状态判断」模块。",
      "",
      "目标：判断这个 App 当前处在什么数据状态，并生成一个贴合结果的标题。不要固定写模块名。",
      "",
      "可用数据：",
      "- 近 12 个月下载、收入、MAU / DAU 等活跃数据。",
      "- 最近 3 个月与周期初 3 个月的下载、收入变化。",
      "- 近 90 天垂类榜单排名、下载、收入。",
      "- 国家 / 地区下载、收入、收入占比、下载占比、RPD。",
      "",
      "写作要求：",
      "- 只输出严格 JSON，不要代码块。",
      "- 不要虚构材料里没有的事实、数字、日期或竞品；没有具体数值时直接写“当前数据不足以判断”。",
      "- 标题必须根据真实数据动态生成，不要套用示例。标题示例只用于理解：下载回落，收入保持韧性 / 排名高位稳定 / 收入稳增，下载放缓 / 数据不足，暂不判断变化。",
      "- 标题不要出现“动态标题”四个字，直接写真实标题，例如：# 下载回落，收入保持韧性：Cal AI。",
      "- 主趋势优先使用近 12 个月数据；近 90 天榜单只用于说明当前位置，不能替代长期趋势。",
      "- 不要写评论、App Store 评价、TikTok 评论、用户反馈、体验感受、用户痛点、付费点。",
      "- 不要写证据审计、脑图、ID 台账、样本缺口说明，也不要强行延展到产品机制。",
      "- 每条“数据结论”和“关键数据”直接写清楚数值、周期和变化，不要在正文里露出 D/K/CSV 引用编号。",
      ...citationPromptRules(),
      "- 国家付费强度只写 RPD，不要写 ARPU、LTV、CAC。",
      "- 补充信息只做可写入报告的数据状态判断，不解释获客渠道、投放策略、产品机制或用户为什么付费。",
      "",
      "reportDraftMarkdown 必须按这个结构输出：",
      "# 真实数据标题：App 名",
      "",
      "## 数据周期",
      "2025 年 6 月 23 日至 2026 年 6 月 22 日，共 12 个月的数据。",
      "",
      "## 数据结论",
      "- 结论 1：一句明确的数据状态判断；紧跟支撑这个判断的关键数据。",
      "- 结论 2：一句明确的数据状态判断；紧跟支撑这个判断的关键数据。",
      "- 结论 3：一句明确的数据状态判断；紧跟支撑这个判断的关键数据。",
      "",
      "## 关键数据",
      "- 列 5-7 条最重要的数据，优先包含近 12 个月下载/收入、月均、近 3 个月对比、活跃变化、近 90 天榜单、核心国家结构。",
      "",
      "## 补充信息",
      "只保留可直接写入报告的判断，不解释数据口径，不写审计缺口。",
      "",
      `Source Pack JSON:\n${JSON.stringify(sourcePack).slice(0, 28000)}`,
      "",
      "输出 JSON 字段必须完全一致：",
      JSON.stringify(buildExpectedJsonShape("下载回落，收入保持韧性"))
    ].join("\n");
  }

  function buildCountryMarketSplitPrompt(sourcePack) {
    return [
      "你是中文 App 分析报告作者。请只基于输入的国家市场数据，写一个「国家市场分工」模块。",
      "",
      "目标：判断这个 App 的下载、收入和付费强度分别由哪些国家承担。重点不是重复整体规模，而是说明国家之间的分工、错配和高价值市场。",
      "",
      "可用数据：",
      "- 国家 / 地区下载量",
      "- 国家 / 地区收入",
      "- 下载占比",
      "- 收入占比",
      "- RPD",
      "- 国家下载排名",
      "- 国家收入排名",
      "- 必要时可参考近 12 个月总下载、总收入作为分母",
      "",
      "写作要求：",
      "- 只输出严格 JSON，不要代码块。",
      "- 只写国家市场结构，不重复整体下载、整体收入、MAU、垂类排名。",
      "- 先写结论，再写数据。",
      "- 每条结论都必须有国家数据佐证。",
      "- 不要写用户评论、TikTok、商店文案、体验感受、产品机制。",
      "- 不要写“美国市场重要”这种空话，必须说明它重要在哪里：下载占比、收入占比、RPD、收入/下载错配。",
      "- 不要把 RPD 写成 ARPU，也不要推 LTV、CAC、留存、投放效率。",
      "- 如果下载 Top 国家和收入 Top 国家高度重合，写“下载和收入集中在同一批市场”。",
      "- 如果某些国家下载占比高但收入占比低，写“拉量市场”。",
      "- 如果某些国家下载占比低但收入占比高，写“高付费市场”。",
      "- 如果数据不足，不要硬写国家策略，只写“当前国家维度不足以判断”。",
      ...citationPromptRules(),
      "",
      "reportDraftMarkdown 必须按这个结构输出：",
      "# 国家市场分工：App 名",
      "",
      "## 数据周期",
      "2025 年 6 月 23 日至 2026 年 6 月 22 日，共 12 个月的数据。",
      "",
      "## 国家结论",
      "- 结论 1：一句明确判断；紧跟国家下载、收入、占比或 RPD 数据。",
      "- 结论 2：一句明确判断；紧跟国家下载、收入、占比或 RPD 数据。",
      "- 结论 3：一句明确判断；紧跟国家下载、收入、占比或 RPD 数据。",
      "",
      "## 关键数据",
      "- 列 5-8 条最重要的数据。",
      "",
      "## 补充信息",
      "只保留可直接写入报告的判断。不要解释数据口径，不写审计缺口，不写产品原因。",
      "",
      `Source Pack JSON:\n${JSON.stringify(sourcePack).slice(0, 28000)}`,
      "",
      "输出 JSON 字段必须完全一致：",
      JSON.stringify(buildExpectedJsonShape("国家市场分工"))
    ].join("\n");
  }

  function buildMarketOverviewPrompt(sourcePack) {
    return [
      "你是中文 App 分析报告作者。请只基于输入的市场数据，写一个「市场表现概览」模块。",
      "",
      "目标：用下载、收入、活跃、榜单和评论覆盖情况概括这个 App 的市场表现。重点是给读者一个规模、增长状态和数据可信度的整体判断。",
      "",
      "写作要求：",
      "- 只输出严格 JSON，不要代码块。",
      "- 先写结论，再写数据；不要写证据审计、脑图、矩阵、样本边界。",
      "- 只使用 source pack 中已有的 D/K/R/T/C/A 证据 ID，不要虚构数字。",
      "- 榜单排名、竞品位置必须引用 K 类证据；下载、收入、活跃趋势必须引用 D 类证据；不要用 R/T/C 评论证据支撑市场规模或排名。",
      "- 不要展开国家分工、竞品榜详情、用户痛点、增长素材、付费结构或创始人背景。",
      "- 数据不足时直接写“当前数据不足以判断”，不要编趋势。",
      ...citationPromptRules(),
      "",
      "reportDraftMarkdown 必须按这个结构输出：",
      "# 市场表现概览：App 名",
      "",
      "## 当前规模",
      "- 写下载、收入、活跃或榜单位置中最能说明规模的 2-3 个数字，必须带证据 ID。",
      "",
      "## 变化趋势",
      "- 写近 12 个月或最近 3 个月能确认的变化；没有趋势数据就写数据不足，必须带证据 ID。",
      "",
      "## 数据可信度",
      "- 写当前市场判断依赖哪些数据源，以及哪些口径还不足；保持报告口吻，不写审计流程。",
      "",
      "## 总结",
      "用 1 段总结这个 App 的市场表现，不新增无证据判断。",
      "",
      `Source Pack JSON:\n${JSON.stringify(sourcePack).slice(0, 28000)}`,
      "",
      "输出 JSON 字段必须完全一致：",
      JSON.stringify(buildExpectedJsonShape("市场表现概览"))
    ].join("\n");
  }

  function buildCategoryCompetitorsPrompt(sourcePack) {
    return [
      "你是中文 App 分析报告作者。请只基于输入的 Sensor Tower 垂类榜单数据，写一个「垂类竞品榜」模块。",
      "",
      "目标：把榜单读成一个清楚的竞争格局判断：这个榜单覆盖什么 App 类型，按过去多少天的累计收入拉了前多少名，目标 App 排第几、月均收入多少，距离第一名差多少，前后竞品是什么水平，以及最应该把哪些竞品录入库中继续做深度分析。",
      "",
      "可用数据：",
      "- 榜单口径：品类、国家/地区、OS、设备、指标、排序方式、时间窗。",
      "- 目标 App 在榜单中的排名、90 天累计收入、月均收入、90 天累计下载、折算月均下载、DAU。",
      "- 目标 App 前后相邻竞品。",
      "- Top 竞品列表。",
      "- 是否已匹配本地 app；未入库对象是后续补采清单，不是事实缺陷。",
      "",
      "写作要求：",
      "- 只输出严格 JSON，不要代码块。",
      "- 先写结论，再写数据，不要从证据过程写起。",
      "- 第一段必须说明：这是哪类 App 的榜单；过去多少天；按累计收入排序；榜单覆盖前多少名。",
      "- 90 天只用于说明排序口径和稳定排名，不要在分析结论里反复写“90 天收入怎样”。",
      "- 分析规模和差距时统一优先使用月均收入、月均下载和 DAU；需要从 90 天累计值换算时，用累计值除以 3。",
      "- 如果 categoryName 是技术 ID 或看不懂，要根据目标 App 和 Top 竞品名称推断一个人能看懂的类型，例如“AI calorie tracker / 饮食记录 / 卡路里追踪类榜单”，并说明这是根据榜单 App 名推断。",
      "- 必须写目标 App 排名、月均收入、月均下载、DAU。",
      "- 必须写它和第一名的月均收入差距：第一名是谁、第一名月均收入多少、目标 App 月均收入多少、差多少、约为第一名的几成或几倍差距。",
      "- 同一个比例或差距在全文必须保持一致；如果前文算出第一名约为目标 App 的 6.1 倍，后文不能改写成“近 10 倍”。",
      "- 必须写前后竞品水平：前 2-3 名代表头部天花板，目标 App 前后一名或相邻 2-4 个 App 代表同档位竞争。",
      "- 相邻竞品部分必须顺带给出后续关注点，但要简短：Foodvisor 这类高下载同档收入竞品看获量能力；Lose It! 这类高 DAU 低收入效率竞品看活跃留存和商业化效率；Cal AI 自身看付费设计和收入效率。每个 App 最多一句。",
      "- 必须结合收入相关数据输出 2-3 条结论，例如头部差距、同档位位置、月均下载/月均收入错配、DAU 与收入的差异。",
      "- 必须写库里覆盖不足，并推荐录入 3-5 个榜单里的 App；每个推荐都要说明为什么录入。",
      "- 每条判断必须引用 K 类证据 ID。",
      "- 不要写下载/收入长期趋势，这属于数据状态模块。",
      "- 不要写国家 RPD 或市场分工，这属于国家市场分工模块。",
      "- 不要写用户痛点、评论口碑、增长素材、paywall 或创始人背景。",
      "- 不要写“谁更好用”“谁产品更强”这类没有榜单数据支撑的优劣判断。",
      "- 目标 App 如果不在榜单里，要明确写“当前榜单未识别目标 App”，不要硬编排名。",
      "- 未入库竞品要写成补采动作：建议去 Sensor Tower 搜索并导入 overview / downloads / revenue / reviews。",
      "- 不要使用“可写入正式报告的判断”“不能贸然判断”这类内部标题；标题必须像正式报告小节。",
      ...citationPromptRules(),
      "",
      "reportDraftMarkdown 必须按这个结构输出：",
      "# 垂类竞品榜：App 名",
      "",
      "## 榜单位置",
      "第一段合并说明：这是哪类 App 的榜单、用累计 90 天收入做稳定排序、覆盖前多少名；目标 App 排名、月均收入、月均下载、DAU；如果类型来自 App 名推断，要直接说明。不要拆成“榜单口径”和“Cal AI 排在什么位置”两个小节。必须带 K 证据 ID。",
      "",
      "## 和第一名差多少",
      "- 写第一名是谁、第一名月均收入、目标 App 月均收入、绝对差距和相对比例；必须带 K 证据 ID。",
      "",
      "## 前后竞品是什么水平",
      "- 写目标 App 前后相邻或同档位竞品；说明月均收入、月均下载、DAU 的差距；顺带点出后续该关注什么；必须带 K 证据 ID。",
      "",
      "## 收入相关结论",
      "- 写 2-3 条和收入相关的结论：头部差距、同档位位置、月均下载/月均收入错配、DAU 与收入差异。",
      "",
      "## 推荐录入的竞品",
      "- 说明当前库中没有覆盖足够多竞品；推荐录入 3-5 个榜单 App，并说明录入后能支持什么深度分析。",
      "",
      `Source Pack JSON:\n${JSON.stringify(sourcePack).slice(0, 30000)}`,
      "",
      "输出 JSON 字段必须完全一致：",
      JSON.stringify(buildCategoryCompetitorsExpectedJsonShape())
    ].join("\n");
  }

  function buildCategoryCompetitorsExpectedJsonShape() {
    return {
      executiveSummary: "1-2句中文，概括目标 App 的榜单位置、与第一名差距、最该录入的竞品",
      reportDraftMarkdown: "# 垂类竞品榜：App 名\n\n## 榜单位置\n...\n\n## 和第一名差多少\n- ...\n\n## 前后竞品是什么水平\n- ...\n\n## 收入相关结论\n- ...\n\n## 推荐录入的竞品\n- ...",
      keyFindings: [{ title: "≤16字", insight: "榜单位置、收入差距或竞品录入判断", evidence: "排名、月均收入/月均下载/DAU≤120字", evidenceIds: [], confidence: "high|medium|low" }],
      tensions: [{ title: "头部差距", explanation: "目标 App 与第一名或相邻竞品的收入、下载、DAU 差异", evidence: "支撑证据≤120字", evidenceIds: [] }],
      reportAngles: [{ title: "≤16字", paragraph: "可直接放进报告的总结段，不要超过200字", evidenceIds: [] }],
      missingEvidence: [],
      followUpQuestions: []
    };
  }

  function buildUserPainPointsPrompt(sourcePack) {
    return [
      "你是中文 App 分析报告作者。请只基于输入材料，写一个「用户痛点」模块。",
      "",
      "目标：回答用户为什么需要这个 App，它帮用户省掉了什么麻烦、成本或心理负担。重点不是复述卖点，而是把材料拆成：用户任务、摩擦成本、替代方案、证据原话。",
      "",
      "可用数据：",
      "- 商店 feature 图和文章/PR：只能代表官方想强调的痛点或产品承诺。",
      "- TikTok 素材：只能代表外部传播如何包装痛点，不能直接当成真实体验。",
      "- App Store 评论、ST reviews、TikTok 评论：用于提炼真实用户 case、追问、抱怨和替代方案。",
      "- 体验 Markdown：用于验证或反证外部承诺是否被真实流程接住。",
      "- Paywall 样本：只用于观察痛点是否被产品放进付费权益，不展开价格结构。",
      "",
      "写作要求：",
      "- 只输出严格 JSON，不要代码块。",
      "- 不要虚构材料里没有的用户、场景、价格、功能、评论或结论。",
      "- 先区分官方痛点和用户痛点：官方说法不能直接写成用户真实需求。",
      "- 每条痛点判断都必须落到具体证据：商店截图 S、评论 R、TT 评论 C、主题 T、素材 V、文章 A、体验 X 或 paywall P。",
      "- 只能引用 evidenceLedger 中出现过的证据 ID；即使主题列表里有更多条目，也不能引用未进入 evidenceLedger 的 T/R/C 编号。",
      "- 优先写“用户任务 - 摩擦成本 - 替代方案 - 证据原话”，不要写泛泛的“提升效率”“满足需求”。",
      "- 不要写下载、收入、国家 RPD、榜单排名或市场规模，这些属于数据状态和国家市场模块。",
      "- 不要把本模块写成增长内容分析；hook、演示动作和素材包装只作为痛点表达来源。",
      "- 不要把本模块写成评论口碑综述；评论只用于抽取痛点、成本和风险边界。",
      "- 不要展开 paywall、价格结构、LTV、续费率或 CAC；paywall 只说明产品是否把同一痛点当成付费点。",
      "- 如果缺少评论、体验或可读商店文案，要在“待验证部分”里写清哪些痛点只能从官方表达判断。",
      ...citationPromptRules(),
      "",
      "reportDraftMarkdown 必须按这个结构输出：",
      "# 用户痛点：App 名",
      "",
      "## 核心痛点",
      "用 1 段说明用户最核心的任务和摩擦；必须带证据 ID。",
      "",
      "## 痛点结论",
      "- 结论 1：用户任务是什么；具体摩擦或成本是什么；用证据 ID 支撑。",
      "- 结论 2：用户为什么会寻找替代方案；用证据 ID 支撑。",
      "- 结论 3：官方痛点和用户原话是否一致；用证据 ID 支撑。",
      "",
      "## 用户 case",
      "- 任务：用户想完成什么。",
      "- 摩擦：原流程、旧工具或当前产品哪里造成成本。",
      "- 替代：用户拿什么做对比，或者希望省掉什么。",
      "- 原话证据：引用或转述一条最关键的评论、TT 评论、体验或文章证据，并标证据 ID。",
      "",
      "## 产品如何接住痛点",
      "写产品能力、官方承诺或体验证据如何回应上述痛点；必须带证据 ID。",
      "",
      "## 待验证部分",
      "列出真实体验或用户原话仍不足的部分。",
      "",
      `Source Pack JSON:\n${JSON.stringify(sourcePack).slice(0, 30000)}`,
      "",
      "输出 JSON 字段必须完全一致：",
      JSON.stringify(buildUserPainPointsExpectedJsonShape())
    ].join("\n");
  }

  function buildUserPainPointsExpectedJsonShape() {
    return {
      executiveSummary: "1-2句中文，概括最核心的用户痛点判断",
      reportDraftMarkdown: "# 用户痛点：App 名\n\n## 核心痛点\n...\n\n## 痛点结论\n- 结论 1：...\n\n## 用户 case\n- 任务：...\n- 摩擦：...\n- 替代：...\n- 原话证据：...\n\n## 产品如何接住痛点\n...\n\n## 待验证部分\n...",
      keyFindings: [{ title: "≤16字", insight: "痛点判断", evidence: "用户任务、摩擦或原话证据≤100字", evidenceIds: ["R1", "T1"], confidence: "high|medium|low" }],
      tensions: [{ title: "官方与用户错位", explanation: "官方承诺和用户原话之间的差异", evidence: "支撑证据≤100字", evidenceIds: ["S1", "R1"] }],
      reportAngles: [{ title: "≤16字", paragraph: "可写入正式报告的一段中文，不要超过180字", evidenceIds: ["R1", "T1"] }],
      missingEvidence: [],
      followUpQuestions: []
    };
  }

  function buildGrowthSignalsPrompt(sourcePack) {
    return [
      "你是中文 App 分析报告作者。请只基于输入的 TikTok 素材、转写摘要和评论，写一个「增长内容 / 传播表达」模块。",
      "",
      "目标：回答外部内容怎么包装这个 App：用什么 hook 吸引用户，展示什么动作，承诺什么结果，评论里用户追问、质疑或复述了什么。",
      "",
      "可用数据：",
      "- 相关 TT 素材：标题、摘要、播放、点赞、评论数。",
      "- 素材转写或视觉摘要：用于识别演示动作和结果承诺。",
      "- TT 评论：用于判断受众是否买账、是否追问教程、是否质疑准确性、价格或风险。",
      "- 疑似噪声素材：只能写进样本边界或排除说明，不能进入增长判断。",
      "",
      "写作要求：",
      "- 只输出严格 JSON，不要代码块。",
      "- 先写结论，再写素材，不要流水账列视频。",
      "- 正文必须用“结论 + 论据”的写法：每个小节先给一句明确结论，再用 1-2 条论据支撑。",
      "- 论据必须包含具体素材、评论或噪声证据 ID；不要只有抽象判断。",
      "- 不能只输出一个总判断；reportDraftMarkdown 至少要有 4 个结论，优先覆盖：主传播主线、hook 分层、演示动作、评论反馈、风险/噪声边界。",
      "- 如果有 10 条以上相关素材，要综合多个视频簇，不要只围绕 V1/V2 写。",
      "- 每条判断必须引用 V、C 或 N 类证据 ID。",
      "- 必须写清楚：主 hook、核心演示动作、结果承诺、受众反馈。",
      "- 必须区分创作者表达和受众反馈；没有 TT 评论时，只能写创作者表达，不能写用户买账。",
      "- 评论反馈只能按原话归类：追问就是追问，复述就是复述，夸赞就是夸赞，明确担心 scam/fake/安全/价格/准确性时才写质疑；不要把 WhatsApp、聊天、教程这类便利性评论硬解释成隐私担忧。",
      "- 必须写素材相关性边界：疑似噪声素材不能支撑增长判断。",
      "- 不要写下载、收入、排名、国家市场或 RPD，这些属于数据状态和国家市场模块。",
      "- 不要写产品真实体验结论；素材演示不等于实际体验。",
      "- 不要写用户痛点模块的“用户为什么需要它”，这里只写外部内容如何包装这种需求。",
      "- 不要写 paywall、价格结构、LTV、CAC 或续费率。",
      "- 标题必须像正式报告小节，不要用“可写入正式报告”“不能贸然判断”这类内部话。",
      ...citationPromptRules(),
      "",
      "reportDraftMarkdown 必须按这个结构输出：",
      "# 增长内容 / 传播表达：App 名",
      "",
      "## 传播主线",
      "- 结论 1：一句话说明外部内容主要怎么包装这个 App，必须带证据 ID。",
      "- 论据 1：列出支撑这个结论的 1-2 条素材或评论证据，写清素材内容、播放/评论或评论反馈，必须带证据 ID。",
      "",
      "## Hook 和卖点",
      "- 结论 2：一句话说明最主要的 hook 是什么、吸引什么人，必须带证据 ID。",
      "- 论据 2：列出支撑这个 hook 的素材或评论，必须带证据 ID。",
      "- 结论 3：如果有第二类 hook，用一句话说明；没有就不要硬写。",
      "- 论据 3：列出对应素材或评论；没有第二类 hook 就不要写。",
      "",
      "## 演示动作",
      "- 结论 4：一句话说明素材最常展示的操作路径，例如搜索下载、注册登录、匹配聊天、结果页、付费触发等，必须带证据 ID。",
      "- 论据 4：列出支撑这个动作路径的素材证据，必须带证据 ID。",
      "",
      "## 评论反馈",
      "- 结论 5：一句话说明评论反馈是追问、接受、复述还是质疑；没有评论时写“当前只能判断创作者表达”。",
      "- 论据 5：列出最能支撑的评论或素材反馈，必须带 C 或 V 证据 ID；没有评论时只能引用 V。",
      "",
      "## 噪声与边界",
      "- 结论 6：一句话说明哪些判断不能成立，或哪些高播放素材不能进入判断。",
      "- 论据 6：列出被排除的噪声素材或边界证据，必须带 N、V 或 C 证据 ID。",
      "",
      "## 总结",
      "用 1 段总结这个 App 当前最值得关注的传播表达；仍然保持结论先行，不新增无证据判断。",
      "",
      `Source Pack JSON:\n${JSON.stringify(sourcePack).slice(0, 30000)}`,
      "",
      "输出 JSON 字段必须完全一致：",
      JSON.stringify(buildGrowthSignalsExpectedJsonShape())
    ].join("\n");
  }

  function buildExperiencePrompt(sourcePack) {
    return [
      "你是中文 App 分析报告作者。请只基于输入的体验 Markdown、商店素材、评论和外部素材，写一个「产品体验实测」模块。",
      "",
      "目标：回答真实上手路径是否接住了外部承诺：首次进入、核心任务、AI/数据反馈、付费触发和主要摩擦。体验材料优先，外部材料只做验证或反证。",
      "",
      "写作要求：",
      "- 只输出严格 JSON，不要代码块。",
      "- 正文必须像正式报告，不写体验证据台账、矩阵、脑图或填写模板说明。",
      "- 每条体验判断必须引用 X 类体验证据；没有 X 证据时只能写“当前缺少实测材料”，不能用素材替代体验。",
      "- 可以引用 S/V/R/C/P 辅助说明外部承诺或用户反馈，但不能替代实测结论。",
      "- 不要写下载、收入、国家 RPD、榜单排名、创始人背景。",
      ...citationPromptRules(),
      "",
      "reportDraftMarkdown 必须按这个结构输出：",
      "# 产品体验实测：App 名",
      "",
      "## 首次进入",
      "- 写首次打开、注册/onboarding、权限或目标设置路径是否顺畅，必须带 X 证据 ID。",
      "",
      "## 核心任务路径",
      "- 写用户完成核心任务时的关键步骤、顺畅点和摩擦点，必须带 X 证据 ID。",
      "",
      "## 反馈与付费触发",
      "- 写 AI/内容/数据反馈是否及时，以及 paywall 在哪里出现；必须带 X 或 P 证据 ID。",
      "",
      "## 总结",
      "用 1 段总结体验是否接住外部承诺，不新增无证据判断。",
      "",
      `Source Pack JSON:\n${JSON.stringify(sourcePack).slice(0, 28000)}`,
      "",
      "输出 JSON 字段必须完全一致：",
      JSON.stringify(buildExpectedJsonShape("产品体验实测"))
    ].join("\n");
  }

  function buildGrowthSignalsExpectedJsonShape() {
    return {
      executiveSummary: "1-2句中文，概括素材传播主线和受众反馈",
      reportDraftMarkdown: "# 增长内容 / 传播表达：App 名\n\n## 传播主线\n- 结论 1：...\n- 论据 1：...\n\n## Hook 和卖点\n- 结论 2：...\n- 论据 2：...\n\n## 演示动作\n- 结论 4：...\n- 论据 4：...\n\n## 评论反馈\n- 结论 5：...\n- 论据 5：...\n\n## 噪声与边界\n- 结论 6：...\n- 论据 6：...\n\n## 总结\n...",
      keyFindings: [{ title: "≤16字", insight: "hook、演示动作或受众反馈判断", evidence: "素材或评论证据≤120字", evidenceIds: ["V1", "C1"], confidence: "high|medium|low" }],
      tensions: [{ title: "承诺与反馈", explanation: "素材承诺和评论追问/质疑之间的张力", evidence: "支撑证据≤120字", evidenceIds: ["V1", "C1"] }],
      reportAngles: [{ title: "≤16字", paragraph: "可直接放进报告的总结段，不要超过200字", evidenceIds: ["V1", "C1"] }],
      missingEvidence: [],
      followUpQuestions: []
    };
  }

  function buildPaidPointsPrompt(sourcePack) {
    return [
      "你是中文 App 分析报告作者。请只基于输入的 paywall、收入数据和国家 RPD，写一个「付费点与价格结构」模块。",
      "",
      "目标：回答这个 App 主要卖什么、可能锁住了什么、价格/权益结构目前能判断到哪一步，以及哪些市场表现出更强付费强度。",
      "",
      "可用数据：",
      "- Paywall 样本：图片 URL、页面 URL、采集时间、App 名称。只有 OCR/视觉识别文本存在时，才能写具体文案或权益。",
      "- Paywall 视觉识别：paywallVision.screens / summary 中的可见文案、价格、试用、权益、CTA、关闭入口和不确定项；如果 available=true，它就是本模块判断付费点的首要证据。",
      "- 收入数据：Sensor Tower revenue CSV 的数据类型、行数、日期范围。",
      "- 国家市场：高 RPD 国家、收入 Top 国家、下载 Top 国家。",
      "- 确定性拆解：系统基于已有源整理的 paywall、收入数据和高付费市场提示。",
      "",
      "写作要求：",
      "- 只输出严格 JSON，不要代码块。",
      "- 正文必须用“结论 + 论据”的写法：每个小节先给明确结论，再给 1-2 条论据。",
      "- 至少输出 3 个结论，优先覆盖：卖什么、锁什么/不能判断什么、哪些市场付费强。",
      "- 每条判断必须引用 P 或 D 类证据 ID；涉及国家付费强度时，可以引用 highPayingMarkets / topRevenueMarkets 中的国家名和 RPD 数字，但证据 ID 必须优先使用 countryMarketEvidenceIds 里的收入/下载数据证据。",
      "- 如果 paywallVision.available=true，必须写出图片里识别到的价格、试用/扣费提示、CTA 和明确权益，并引用对应 P 类证据。",
      "- 正文不要出现“视觉识别显示”“系统识别到”“截图识别出”这类过程话术，直接写信息本身，例如“页面提供年付 $29.99”。",
      "- paywallVision.screens[].lockedFeatures 为空时，不能写“锁住了某某功能”；只能写“未明确展示具体锁点”。",
      "- 没有明确免费/付费对比时，不能写“基础功能免费、高级功能付费”这类推断；只能写“免费边界不明确”。",
      "- Try for $0.00 / No Payment Due Now 只能解释为“当前无需付款/试用入口”，不能写“首年免费试用”，除非视觉识别明确出现 first year free。",
      "- 如果 paywall 只有图片 URL、没有 OCR 或视觉识别文案，不能编写具体卖点、价格、权益、按钮文案或折扣；只能写“已有 paywall 截图，具体权益仍需视觉识别”。",
      "- 如果 paywall 没有 OCR 或视觉识别文案，连总结也不能写“核心在于某某功能的解锁方式”；只能写“付费结构尚待识别”。",
      "- 可以判断“付费结构需要从 paywall 继续识别”，但不能把截图 URL 当成已识别文案。",
      "- 如果 paywallVision 给出 uncertainty，要在“它锁住了什么”或“总结”里说明仍不确定什么，不要把不确定项写成事实。",
      "- 可以写 RPD 高的国家更像高付费强度市场，但不要写 LTV、CAC、续费率、付费率、ARPU 或转化率，除非输入里明确给出。",
      "- 国家市场一律优先使用 source pack 中的中文国家名，不要在正文里只写代码。",
      "- 不要写用户是否嫌贵、是否满意、退款争议或订阅抱怨，这属于用户评论与口碑模块。",
      "- 不要写下载/收入长期趋势，这属于数据状态模块。",
      "- 不要写国家下载/收入分工全貌，这属于国家市场分工模块；本模块只引用高 RPD 或高收入市场来解释付费强度。",
      "- 不要写增长素材、用户痛点、实测体验或创始人背景。",
      "- 标题必须像正式报告小节，不要用“可写入正式报告”“不能贸然判断”这类内部话。",
      ...citationPromptRules(),
      "",
      "reportDraftMarkdown 必须按这个结构输出：",
      "# 付费点与价格结构：App 名",
      "",
      "## 它主要卖什么",
      "- 结论 1：一句话说明目前能确认的付费主卖点；如果 paywall 未 OCR，就说明只能确认已有 paywall 样本，具体卖点待识别。",
      "- 论据 1：引用 P 类 paywall 证据，说明截图/页面/采集时间；不得编具体文案。",
      "",
      "## 它锁住了什么",
      "- 结论 2：一句话说明免费边界、付费权益或锁点目前能否判断。",
      "- 论据 2：引用 P 或 D 类证据；如果证据不足，说明缺哪类 OCR/视觉识别/IAP 明细。",
      "",
      "## 哪些市场付费强",
      "- 结论 3：一句话说明高 RPD 或高收入市场带来的付费强度判断。",
      "- 论据 3：列出 2-5 个国家的 RPD、收入、下载，优先写中文国家名，必须带 D 类证据 ID。",
      "",
      "## 总结",
      "用 1 段总结这个 App 当前付费结构最值得继续查什么，不新增无证据判断。",
      "",
      `Source Pack JSON:\n${JSON.stringify(sourcePack).slice(0, 30000)}`,
      "",
      "输出 JSON 字段必须完全一致：",
      JSON.stringify(buildPaidPointsExpectedJsonShape())
    ].join("\n");
  }

  function buildPaidPointsExpectedJsonShape() {
    return {
      executiveSummary: "1-2句中文，概括付费主卖点、权益边界和高付费市场判断",
      reportDraftMarkdown: "# 付费点与价格结构：App 名\n\n## 它主要卖什么\n- 结论 1：...\n- 论据 1：...\n\n## 它锁住了什么\n- 结论 2：...\n- 论据 2：...\n\n## 哪些市场付费强\n- 结论 3：...\n- 论据 3：...\n\n## 总结\n...",
      keyFindings: [{ title: "≤16字", insight: "付费主卖点、权益边界或高付费市场判断", evidence: "paywall、收入或RPD证据≤120字", evidenceIds: ["P1"], confidence: "high|medium|low" }],
      tensions: [{ title: "证据边界", explanation: "paywall 截图、收入数据和 RPD 之间能判断与不能判断的边界", evidence: "支撑证据≤120字", evidenceIds: ["P1"] }],
      reportAngles: [{ title: "≤16字", paragraph: "可直接放进报告的总结段，不要超过180字", evidenceIds: ["P1"] }],
      missingEvidence: [],
      followUpQuestions: []
    };
  }

  function buildUserReviewsPrompt(sourcePack) {
    return [
      "你是中文 App 分析报告作者。请只基于输入的商店评论、TikTok 评论和评论主题拆解，写一个「用户评论与口碑」模块。",
      "",
      "目标：回答用户最认可什么、最常抱怨什么、评论里暴露出哪些风险信号，以及这些声音当前能支持到什么判断边界。",
      "",
      "可用数据：",
      "- reviewRatingBreakdown：本地按全量去重评论算出的总评论数、高星(4-5星)、中立(3星)、低星(1-2星)分布。",
      "- reviewCorpusDigest：如果 available=true，表示 Agnes 已先读过尽可能完整的评论全集；其中的 sample_stats、positive_breakdown、positives、negatives、risks 是本模块的优先依据。",
      "- 评论主题：reviewThemes 中的主题名、命中数量、代表表达。",
      "- 商店评论：appStoreReviewCases 中的评分、国家、时间、原话摘要。",
      "- TikTok 评论：tiktokCommentCases 中的点赞、时间、原话摘要。",
      "- 确定性拆解：系统基于评论和评论主题整理出的好评、差评、风险信号。",
      "",
      "写作要求：",
      "- 只输出严格 JSON，不要代码块。",
      "- 正文必须用“结论 + 论据”的写法：每个小节先给明确结论，再给 1-2 条论据。",
      "- 至少输出 3 个结论，优先覆盖：喜欢什么、抱怨什么、风险信号。",
      "- 每条判断必须只引用 evidenceLedger 里真实存在的 R、T 或 C 类证据 ID。",
      "- 可以引用评分、国家、点赞数、主题命中数，但不要把单条极端评论写成整体结论。",
      "- 每条论据都必须补数量信息，优先写主题命中数；如果没有主题命中数，也要写当前可见评论里至少有几条同类样本，例如“功能 bug / 性能问题命中 6 条”。",
      "- 如果 reviewCorpusDigest.available=true，正文里的总评论数、高星/低星样本数、功能认可数、结果/效率认可数，应优先使用 reviewCorpusDigest 和 reviewRatingBreakdown，不要自己重算。",
      "- 正文直接写信息本身，不要出现“评论显示”“系统识别到”“主题分析发现”这类过程话术。",
      "- 不要把“泛化好评多”写成核心结论或主要问题；所有 app 的短评里都会有大量 good / nice app / i like it，这类样本只作为背景，不需要重点展开。",
      "- 写“用户最认可什么”时，优先列出评论里出现过的具体认可点，例如易用、食物记录、扫描、结果、效率、数据库、提醒、界面等；如果高星样本只有泛化表达，就简短说明“具体称赞点有限”，不要反复批评。",
      "- 本模块只写口碑和风险，不展开成完整用户需求分析；不要替代用户痛点模块。",
      "- 如果评论提到太贵、自动续费、退款或广告打扰，可以作为口碑或风险信号写，但不要转去分析 paywall 结构。",
      "- 可以写评论里反复出现的产品稳定性、账号、广告、AI 结果质量等风险，但不要把偶发 bug 放大成主结论。",
      "- 除非至少有 2 条以上独立证据支持，否则不要写“高流失率”“高退款率”“客服缺失”“品牌信任度低”这类放大性结论。",
      "- 不要写下载、收入、国家 RPD、榜单排名、增长素材打法、创始人背景或实测体验。",
      "- 标题必须像正式报告小节，不要用“判断边界”“可写入正式报告”这类内部话。",
      ...citationPromptRules(),
      "",
      "reportDraftMarkdown 必须按这个结构输出：",
      "# 用户评论与口碑：App 名",
      "",
      "## 用户最认可什么",
      "- 结论 1：一句话概括用户最稳定的好评来源。",
      "- 论据 1：先写你的分析表述，不要直接堆英文/外语原文；说明具体正向评价主要指向哪些功能、结果或使用场景，并带数量信息。",
      "- 相关评价：用 3-5 条中文一句话归纳单条评价，每条只写中文归纳并带 R/T/C 证据 ID；不要把评论原文写进正文，原文由前端 hover 展示。",
      "",
      "## 用户最常抱怨什么",
      "- 结论 2：一句话概括最集中的差评或摩擦点。",
      "- 论据 2：先写你的分析表述，说明抱怨集中在哪些产品环节，并带数量信息。",
      "- 相关评价：用 3-5 条中文一句话归纳单条评价，每条只写中文归纳并带 R/T/C 证据 ID；不要把评论原文写进正文。",
      "",
      "## 需要额外留意的风险",
      "- 结论 3：一句话说明最值得继续盯的风险信号。",
      "- 论据 3：先写你的分析表述，说明风险为什么值得注意，并带数量信息。",
      "- 相关评价：用 3-5 条中文一句话归纳单条评价，每条只写中文归纳并带 R/T/C 证据 ID；不要把评论原文写进正文。",
      "",
      "## 总结",
      "用 1 段总结当前口碑的主线，不新增无证据判断。",
      "",
      `Source Pack JSON:\n${JSON.stringify(sourcePack).slice(0, 30000)}`,
      "",
      "输出 JSON 字段必须完全一致：",
      JSON.stringify(buildUserReviewsExpectedJsonShape())
    ].join("\n");
  }

  function buildUserReviewsExpectedJsonShape() {
    return {
      executiveSummary: "1-2句中文，概括用户最认可的价值、最集中的抱怨和风险信号",
      reportDraftMarkdown: "# 用户评论与口碑：App 名\n\n## 用户最认可什么\n- 结论 1：...\n- 论据 1：...\n\n## 用户最常抱怨什么\n- 结论 2：...\n- 论据 2：...\n\n## 需要额外留意的风险\n- 结论 3：...\n- 论据 3：...\n\n## 总结\n...",
      keyFindings: [{ title: "≤16字", insight: "价值感、差评主题或风险判断", evidence: "评论或主题证据≤120字", evidenceIds: ["R1", "C1"], confidence: "high|medium|low" }],
      tensions: [{ title: "口碑张力", explanation: "好评与差评、承诺与风险之间的张力", evidence: "支撑证据≤120字", evidenceIds: ["R1", "T1"] }],
      reportAngles: [{ title: "≤16字", paragraph: "可直接放进报告的总结段，不要超过180字", evidenceIds: ["R1", "C1"] }],
      missingEvidence: [],
      followUpQuestions: []
    };
  }

  function buildFounderCompanyPrompt(sourcePack) {
    return [
      "你是中文 App 分析报告作者。请只基于输入的文章、访谈、PR 和公司线索，写一个「创始人 / 公司 / 融资背景」模块。",
      "",
      "目标：把公司和创始人背景写成一段能解释产品与增长路径的故事，而不是资料卡。重点回答：谁做的、为什么从这里开始、创始人过往代表作是什么、团队能力如何对应产品路线、是否有融资/收购/PR 线索、还有哪些不能确认。",
      "",
      "可用数据：",
      "- appReleaseSignals：App 基础信息和 Sensor Tower overview 中的发布日期、版本等结构化信号，只用于判断时间，不要把 APP1/APP2 这类内部编号写进 reportDraftMarkdown 正文。",
      "- companyArticles：经过模块专属 source selector 选出的文章、访谈、PR、官方公告或交易线索。排序已优先考虑收购方、官方确认、交易时间、财务条款、创始人分工、过往代表作和融资线索。",
      "- evidenceLedger：A 类证据台账。只能引用其中真实存在的 A 编号。",
      "",
      "写作要求：",
      "- 只输出严格 JSON，不要代码块。",
      "- 不要虚构材料里没有的创始人姓名、学历、履历、融资轮次、金额、估值、投资方、收购方或时间。",
      "- 正文必须像正式报告小节，不写“本地材料里不清晰”“当前材料只能确认”“不能硬写”这类过程废话；信息不足时直接写事实边界，例如“只能确认团队能力方向，个人分工尚未看到多源互证”。",
      "- 创业起点要优先写清时间：如果 appReleaseSignals 有“全球发布日期/国家发布日期”，第一段必须写 App 于哪天上线；如果没有发布日期，但文章有 founded/launched/created 时间，也要写；都没有才不写时间。",
      "- 创业起点要写成一个起势：团队为什么会切这个问题、从哪个用户任务或产品机会进入；没有明确动机时，只写可确认的产品切入点。",
      "- 产品路线要解释从初始切入点到当前 App 能力的连续性，不能只列功能；涉及收购时必须直接写“被 XXX 收购”，不要写“成为关键补充”这类含混表达。",
      "- 团队能力必须写具体分工或能力映射：谁做产品、谁做增长/运营/技术；如果没有姓名或分工证据，就写“只能确认团队能力方向，个人分工尚未看到多源互证”。",
      "- 创始人过往代表作必须单独成节：只写材料明确提到的创始人/核心团队在该 App 之前或之外做过的产品、公司、内容项目、开源项目、学校/训练营项目、工作室或可验证作品；要说明这些作品如何解释当前 App 的能力来源或审美/增长路径。",
      "- 如果没有过往代表作证据，不要编；该小节写“目前已录入文章只能确认当前 App 相关经历，尚未看到可多源互证的过往代表作”，并把需要补采的方向放到待验证部分。",
      "- 增长打法只写公司或创始人背景能解释的部分，例如 founder-led 内容、UGC/短视频、产品驱动增长、收购后分发；不要替代增长内容模块。",
      "- 融资 / 收购部分只写材料明确支持的事实；如果只有收购，没有融资，就直接写收购，不要先铺垫“融资不清晰”。",
      "- 融资 / 收购小节第一句必须写已确认的资本事件或交易事实；禁止用“目前材料未提及”“当前材料没有”“融资信息不清晰”“未披露传统融资轮次”这类缺口句开头。",
      "- 如果没有融资轮次信息，不要在融资 / 收购小节里写废话铺垫；把“融资轮次、金额、投资方未确认”移到“待验证部分”。",
      "- 如果 companyArticles 中出现 MyFitnessPal、官方确认、acquires/acquired/acquisition 或“收购 Cal AI”，必须把 MyFitnessPal 写成收购方；禁止写“材料未明确被哪家机构收购”。",
      "- 如果 companyArticles 中出现“financial terms undisclosed / 财务交易条款未披露 / 内容称财务条款未披露”，待验证部分只能写“收购金额/财务条款未披露”，不能写“收购方不明确”。",
      "- 融资 / 收购小节第一句必须直接写交易主体、动作和时间，例如“MyFitnessPal 于 2025 年 12 月完成对 Cal AI 的收购，并在 2026 年 3 月宣布。”禁止写“这条线索更像……”“而非传统融资故事”。",
      "- 待验证部分要写真正影响判断的缺口，例如股权/融资信息缺失、收购后团队是否继续负责产品、创始人分工是否来自单一来源；不要写泛泛的“仍需更多资料”。",
      "- 总结要提炼公司背景对 App 成功路径的解释力，而不是重复事实。",
      "- 每个小节至少引用 1 个 A 类证据 ID；上线/发布日期来自 appReleaseSignals 时可以直接写日期，但不要输出 APP 编号，也不要把 A 编号挂在发布日期后面，除非该 A 来源本身明确支持这个日期。没有 A 证据时不要输出强结论。",
      ...citationPromptRules(),
      "",
      "reportDraftMarkdown 必须按这个结构输出：",
      "# 创始人 / 公司 / 融资背景：App 名",
      "",
      "## 创业起点",
      "用 1-2 段写上线/诞生时间、团队从什么问题或产品机会进入；有 appReleaseSignals 时必须写发布日期；必须带 A 证据 ID。",
      "",
      "## 产品路线",
      "用 1-2 段写产品从最初切入点到当前核心能力的连续性；必须带 A 证据 ID。",
      "",
      "## 团队能力",
      "写清楚创始人或团队各自做了什么；如果材料只支持能力方向，要明确边界但不要写成审计口吻；必须带 A 证据 ID。",
      "",
      "## 创始人过往代表作",
      "写创始人/核心团队在当前 App 之前或之外的代表作、项目或履历作品，以及它如何解释当前产品；没有证据时写事实边界；必须带 A 证据 ID。",
      "",
      "## 增长打法",
      "写公司/创始人背景如何解释增长路径；只写有文章证据支撑的部分；必须带 A 证据 ID。",
      "",
      "## 融资 / 收购",
      "写融资、收购、PR 或公司交易线索。没有融资就不要编融资；有收购就直接写收购事实；必须带 A 证据 ID。",
      "",
      "## 待验证部分",
      "- 列 2-4 个仍会影响判断的事实缺口或单一来源边界。",
      "",
      "## 总结",
      "用 1 段总结公司背景对产品路线和增长路径的解释力，不新增无证据判断。",
      "",
      `Source Pack JSON:\n${JSON.stringify(sourcePack).slice(0, 30000)}`,
      "",
      "输出 JSON 字段必须完全一致：",
      JSON.stringify(buildFounderCompanyExpectedJsonShape())
    ].join("\n");
  }

  function buildFounderCompanyExpectedJsonShape() {
    return {
      executiveSummary: "1-2句中文，概括公司/创始人背景如何解释产品路线和增长路径",
      reportDraftMarkdown: "# 创始人 / 公司 / 融资背景：App 名\n\n## 创业起点\n...\n\n## 产品路线\n...\n\n## 团队能力\n...\n\n## 创始人过往代表作\n...\n\n## 增长打法\n...\n\n## 融资 / 收购\n...\n\n## 待验证部分\n- ...\n\n## 总结\n...",
      keyFindings: [{ title: "≤16字", insight: "创始人、公司、产品路线、融资或收购判断", evidence: "文章证据≤120字", evidenceIds: ["A1"], confidence: "high|medium|low" }],
      tensions: [{ title: "事实缺口", explanation: "公司背景中仍不能确认或只有单一来源支持的部分", evidence: "支撑证据≤120字", evidenceIds: ["A1"] }],
      reportAngles: [{ title: "≤16字", paragraph: "可直接放进报告的公司背景段，不要超过220字，必须保留 A 类证据 ID", evidenceIds: ["A1"] }],
      missingEvidence: [],
      followUpQuestions: []
    };
  }

  function buildUserReviewDigestShape() {
    return {
      sample_stats: { total: 0, high_star: 0, neutral: 0, low_star: 0 },
      positive_breakdown: { generic_praise: 0, feature_praise: 0, result_or_efficiency_praise: 0 },
      positives: [{ title: "", count: 0, summary: "", representative_ids: ["R1"] }],
      negatives: [{ title: "", count: 0, summary: "", representative_ids: ["R2"] }],
      risks: [{ title: "", count: 0, summary: "", representative_ids: ["R3"] }],
      one_paragraph_takeaway: ""
    };
  }

  function normalizeUserReviewDigest(value, meta = {}) {
    const record = value && typeof value === "object" ? value : {};
    const safeTotal = Number(meta.total || 0);
    const localBreakdown = meta.ratingBreakdown || {};
    const total = Number(localBreakdown.total || safeTotal || 0);
    return {
      available: true,
      provider: "Agnes",
      model: meta.model || "",
      sampleStats: {
        total,
        highStar: Number(localBreakdown.highStar || record?.sample_stats?.high_star || 0),
        neutral: Number(localBreakdown.neutral || record?.sample_stats?.neutral || 0),
        lowStar: Number(localBreakdown.lowStar || record?.sample_stats?.low_star || 0)
      },
      positiveBreakdown: {
        genericPraise: Number(record?.positive_breakdown?.generic_praise || 0),
        featurePraise: Number(record?.positive_breakdown?.feature_praise || 0),
        resultOrEfficiencyPraise: Number(record?.positive_breakdown?.result_or_efficiency_praise || 0)
      },
      positives: normalizeDigestThemeItems(record?.positives),
      negatives: normalizeDigestThemeItems(record?.negatives),
      risks: normalizeDigestThemeItems(record?.risks),
      takeaway: truncateText(record?.one_paragraph_takeaway, 220)
    };
  }

  function normalizeDigestThemeItems(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 6).map((item) => ({
      title: truncateText(item?.title, 40),
      count: roundNumber(item?.count),
      summary: truncateText(item?.summary, 180),
      representativeIds: normalizeEvidenceIds(item?.representative_ids).filter((id) => /^R\d+$/.test(id) && Number(id.slice(1)) <= 10)
    })).filter((item) => item.title);
  }

  function prioritizeGrowthEvidenceLedger(items = []) {
    const priority = { V: 1, C: 2, N: 3, R: 4, T: 5 };
    return items
      .filter((item) => /^(V|C|N|T|R)\d+/.test(item.id || ""))
      .sort((a, b) => {
        const aId = String(a.id || "");
        const bId = String(b.id || "");
        const aPrefix = aId[0];
        const bPrefix = bId[0];
        const byPrefix = (priority[aPrefix] || 99) - (priority[bPrefix] || 99);
        if (byPrefix) return byPrefix;
        return Number(aId.slice(1) || 0) - Number(bId.slice(1) || 0);
      })
      .slice(0, 50);
  }

  function buildExpectedJsonShape(title) {
    return {
      executiveSummary: "1-2句中文，概括数据判断",
      reportDraftMarkdown: `# ${title}：App 名\n\n## 数据周期\n...\n\n## 数据结论/国家结论\n- 结论 1：...\n\n## 关键数据\n- ...\n\n## 补充信息\n...`,
      keyFindings: [{ title: "≤16字", insight: "数据结论", evidence: "支撑数据≤80字", evidenceIds: [] , confidence: "high|medium|low" }],
      tensions: [],
      reportAngles: [{ title: "≤16字", paragraph: "可写入正式报告的一段中文，不要超过160字", evidenceIds: [] }],
      missingEvidence: [],
      followUpQuestions: []
    };
  }

  function normalizeModuleAiInsights(value, meta = {}) {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const insights = {
      available: true,
      provider: "Agnes",
      model: meta.model || "",
      executiveSummary: truncateText(record.executiveSummary || record.summary, 900),
      reportDraftMarkdown: truncateMarkdown(record.reportDraftMarkdown || record.report_draft_markdown || "", 6000),
      keyFindings: normalizeAiItems(record.keyFindings, ["title", "insight", "evidence", "evidenceIds", "confidence"], 5),
      tensions: normalizeAiItems(record.tensions, ["title", "explanation", "evidence", "evidenceIds"], 4),
      reportAngles: normalizeAiItems(record.reportAngles, ["title", "paragraph", "evidenceIds"], 4),
      missingEvidence: normalizeStringList(record.missingEvidence, 6),
      followUpQuestions: normalizeStringList(record.followUpQuestions, 6)
    };
    const hasContent = insights.executiveSummary || insights.reportDraftMarkdown || insights.keyFindings.length || insights.reportAngles.length;
    if (!hasContent) {
      return { available: false, error: "Agnes 返回为空洞察" };
    }
    return insights;
  }

  function normalizeAiItems(value, fields, limit) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, limit).map((item) => {
      const record = item && typeof item === "object" ? item : {};
      return Object.fromEntries(fields.map((field) => {
        if (field === "evidenceIds") return [field, normalizeEvidenceIds(record[field])];
        return [field, truncateText(record[field], field === "paragraph" ? 220 : 140)];
      }));
    }).filter((item) => Object.values(item).some(Boolean));
  }

  function normalizeEvidenceIds(value) {
    const list = Array.isArray(value)
      ? value
      : normalizeText(value).split(/[、,\s]+/);
    return uniqueStrings(list.map((item) => normalizeText(item).toUpperCase()).filter((item) => /^[ADVRCTXNSPK]\d+$/.test(item))).slice(0, 6);
  }

  function normalizeStringList(value, limit) {
    return Array.isArray(value)
      ? value.map((item) => truncateText(item, 120)).filter(Boolean).slice(0, limit)
      : [];
  }

  function parseAiJson(content) {
    try {
      return JSON.parse(content);
    } catch {
      const match = String(content || "").match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }

  function readAgnesApiKey() {
    const envKey = normalizeText(process.env.AGNES_API_KEY || process.env.TT2TEXT_AGNES_API_KEY);
    if (envKey) return envKey;
    try {
      return execFileSync("security", ["find-generic-password", "-a", "default", "-s", "agnes-ai", "-w"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
      return "";
    }
  }

  function isRetryableAiError(error) {
    if (error?.name === "AbortError") return true;
    const status = Number(error?.status || 0);
    if ([408, 429, 500, 502, 503, 504].includes(status)) return true;
    const message = normalizeText(error?.message || error);
    return /fetch failed|network|timeout|timed? out|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message);
  }

  function formatAiError(error, timeoutMs, attempts) {
    const suffix = attempts > 1 ? `，已重试 ${attempts - 1} 次` : "";
    if (error?.name === "AbortError") return `Agnes 生成超时（${Math.round(timeoutMs / 1000)} 秒）${suffix}`;
    return `${error instanceof Error ? error.message : String(error || "Agnes 生成失败")}${suffix}`;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeCountryRows(rows = []) {
    return rows.map((item) => ({
      country: localizeCountryName(item.country),
      countryCode: normalizeText(item.country).toUpperCase(),
      downloads: roundNumber(item.downloads),
      revenueUsd: roundMoney(item.revenueUsd),
      rpd: rpd(item.revenueUsd, item.downloads),
      downloadSharePct: pct(item.downloadShare),
      revenueSharePct: pct(item.revenueShare),
      revenueMinusDownloadSharePct: pct(item.revenueDownloadShareGap),
      revenueToDownloadShareRatio: roundNumber(item.revenueToDownloadShareRatio, 2)
    })).filter((item) => item.country);
  }

  function localizeCountryName(value) {
    const code = normalizeText(value).toUpperCase();
    if (!code) return "";
    const manual = {
      CH: "瑞士",
      MT: "马耳他",
      MO: "澳门",
      LU: "卢森堡",
      KW: "科威特",
      AU: "澳大利亚",
      QA: "卡塔尔",
      US: "美国",
      GB: "英国",
      JP: "日本"
    };
    if (manual[code]) return manual[code];
    try {
      const display = new Intl.DisplayNames(["zh-Hans"], { type: "region" }).of(code);
      return normalizeText(display) || code;
    } catch {
      return code;
    }
  }

  function normalizeCategoryRankingPack(ranking = null, app = {}) {
    const rows = (ranking?.rows || []).map(normalizeCategoryRankingRow).filter((item) => item.appName || item.unifiedName);
    const targetIndex = findTargetCategoryRowIndex(rows, app);
    const targetApp = targetIndex >= 0 ? rows[targetIndex] : null;
    const nearbyStart = targetIndex >= 0 ? Math.max(0, targetIndex - 3) : 0;
    const nearbyEnd = targetIndex >= 0 ? Math.min(rows.length, targetIndex + 4) : Math.min(rows.length, 6);
    const missingLocalCompetitors = rows
      .filter((item) => !item.localAppId)
      .slice(0, 12);
    return {
      context: {
        categoryName: normalizeText(ranking?.categoryName) || "同品类应用",
        metric: normalizeText(ranking?.metric) || "revenue",
        sort: normalizeText(ranking?.sort) || "absolute",
        countries: Array.isArray(ranking?.countries) ? ranking.countries.map(normalizeText).filter(Boolean) : [],
        os: normalizeText(ranking?.os),
        devices: Array.isArray(ranking?.devices) ? ranking.devices.map(normalizeText).filter(Boolean) : [],
        dateRange: normalizeDateRange(ranking?.dateRange || {}),
        appCount: Number(ranking?.summary?.appCount || rows.length || 0),
        totalRevenueUsd90d: roundMoney(ranking?.summary?.totalRevenueUsd90d || 0),
        averageRevenueUsd90d: roundMoney(ranking?.summary?.averageRevenueUsd90d || 0),
        averageDownloads90d: roundNumber(ranking?.summary?.averageDownloads90d || 0)
      },
      targetApp,
      nearbyCompetitors: rows.slice(nearbyStart, nearbyEnd),
      topCompetitors: rows.slice(0, 12),
      missingLocalCompetitors
    };
  }

  function normalizeCategoryRankingRow(row = {}, index = 0) {
    return {
      id: `K${index + 1}`,
      rank: Number(row.rank || index + 1),
      appName: truncateText(row.appName || row.unifiedName, 120),
      unifiedName: truncateText(row.unifiedName || row.appName, 120),
      publisherName: truncateText(row.publisherName, 100),
      revenueUsd90d: roundMoney(row.revenueUsd90d || 0),
      monthlyRevenueUsd: roundMoney(row.monthlyRevenueUsd || 0),
      downloads90d: roundNumber(row.downloads90d || 0),
      monthlyDownloads: roundNumber(Number(row.downloads90d || 0) / 3),
      dau: roundNumber(row.dau || 0),
      localAppId: normalizeText(row.localAppId),
      localAppName: truncateText(row.localAppName, 120),
      isInLocalCatalog: Boolean(normalizeText(row.localAppId))
    };
  }

  function findTargetCategoryRowIndex(rows = [], app = {}) {
    const appId = normalizeText(app?.id);
    const appName = normalizeText(app?.name || app?.fullName).toLowerCase();
    const fullName = normalizeText(app?.fullName).toLowerCase();
    for (const index of [
      rows.findIndex((item) => appId && normalizeText(item.localAppId) === appId),
      rows.findIndex((item) => appName && normalizeText(`${item.appName} ${item.unifiedName}`).toLowerCase().includes(appName)),
      rows.findIndex((item) => fullName && normalizeText(`${item.appName} ${item.unifiedName}`).toLowerCase().includes(fullName))
    ]) {
      if (index >= 0) return index;
    }
    return -1;
  }

  function normalizeStoreScreenshots(rows = []) {
    return rows.slice(0, 8).map((item, index) => ({
      id: `S${index + 1}`,
      platform: normalizeText(item.platform),
      textOrAlt: truncateText(item.alt || item.title || item.caption || "", 180),
      imageUrl: truncateText(item.imageUrl || item.thumbnailUrl || "", 220)
    })).filter((item) => item.textOrAlt || item.imageUrl);
  }

  function normalizeArticleSamples(rows = [], limit = 6) {
    return rows.slice(0, limit).map((item, index) => ({
      id: `A${index + 1}`,
      title: truncateText(item.title, 120),
      excerpt: truncateText(item.excerpt, 260),
      sourceName: truncateText(item.sourceName, 80),
      sourceDomain: truncateText(item.sourceDomain, 80),
      sourceUrl: truncateText(item.sourceUrl, 220),
      author: truncateText(item.author, 80),
      publishedAt: normalizeText(item.publishedAt)
    })).filter((item) => item.title || item.excerpt);
  }

  function normalizeAppReleaseSignals(rows = [], limit = 6) {
    return rows.slice(0, limit).map((item, index) => ({
      id: normalizeText(item.id) || `APP${index + 1}`,
      label: truncateText(item.label, 80),
      value: truncateText(item.value, 120),
      sourceName: truncateText(item.sourceName, 80),
      sourceUrl: truncateText(item.sourceUrl, 220),
      use: truncateText(item.use, 120)
    })).filter((item) => item.label || item.value);
  }

  function normalizeVideoSamples(rows = [], limit = 6) {
    return rows.slice(0, limit).map((item, index) => ({
      id: `V${index + 1}`,
      title: truncateText(item.title, 120),
      summary: truncateText(item.summary || item.visualSummary || item.transcriptZh, 260),
      viewCount: roundNumber(item.viewCount),
      commentCount: roundNumber(item.commentCount)
    })).filter((item) => item.title || item.summary);
  }

  function normalizeGrowthVideoSamples(rows = [], limit = 8, prefix = "V") {
    return rows.slice(0, limit).map((item, index) => ({
      id: `${prefix}${index + 1}`,
      title: truncateText(item.title, 140),
      summary: truncateText(item.summary || item.visualSummary || item.transcriptZh || item.publishedText, 320),
      sourceUrl: truncateText(item.sourceUrl, 220),
      viewCount: roundNumber(item.viewCount),
      likeCount: roundNumber(item.likeCount),
      commentCount: roundNumber(item.commentCount)
    })).filter((item) => item.title || item.summary);
  }

  function normalizeThemeSummary(rows = []) {
    return rows.slice(0, 6).map((item, index) => ({
      id: `T${index + 1}`,
      title: truncateText(item.title || item.name || item.id, 80),
      count: roundNumber(item.count),
      examples: Array.isArray(item.examples)
        ? item.examples.map((example) => truncateText(example, 180)).filter(Boolean).slice(0, 3)
        : []
    })).filter((item) => item.title);
  }

  function normalizeReviewSamples(rows = [], limit = 8) {
    return rows.slice(0, limit).map((item, index) => ({
      id: `R${index + 1}`,
      rating: normalizeText(item.rating),
      country: normalizeText(item.country),
      text: truncateText(item.text, 260)
    })).filter((item) => item.text);
  }

  function normalizeTtCommentSamples(rows = [], limit = 6) {
    return rows.slice(0, limit).map((item, index) => ({
      id: `C${index + 1}`,
      text: truncateText(item.text, 220),
      videoTitle: truncateText(item.videoTitle, 100),
      likeCount: roundNumber(item.likeCount)
    })).filter((item) => item.text);
  }

  function normalizeExperienceDocs(rows = []) {
    return rows.slice(0, 4).map((item, index) => ({
      id: `X${index + 1}`,
      title: truncateText(item.title, 120),
      excerpt: truncateText(item.excerpt, 320),
      relativePath: truncateText(item.relativePath || item.path, 180)
    })).filter((item) => item.title || item.excerpt || item.relativePath);
  }

  function normalizePaywallSamples(rows = []) {
    return rows.slice(0, 4).map((item, index) => ({
      id: `P${index + 1}`,
      appName: truncateText(item.appName, 100),
      imageUrl: truncateText(item.imageUrl, 220),
      pageUrl: truncateText(item.pageUrl, 220),
      collectedAt: normalizeText(item.collectedAt)
    })).filter((item) => item.appName || item.imageUrl || item.pageUrl);
  }

  function normalizeRevenueEvidenceItems(rows = []) {
    return rows
      .filter((item) => item.type === "数据" && /revenue/i.test(`${item.signal || ""} ${item.evidence || ""}`))
      .slice(0, 8)
      .map((item, index) => ({
        id: normalizeText(item.id) || `D${index + 1}`,
        dataType: normalizeText(item.signal),
        evidence: truncateText(item.evidence, 220),
        use: truncateText(item.use, 120)
      }));
  }

  function selectCountryMarketEvidenceIds(rows = []) {
    const dataRows = rows.filter((item) => item.type === "数据");
    const latestRevenue = [...dataRows].reverse().find((item) => /revenue/i.test(item.signal || ""));
    const latestDownloads = [...dataRows].reverse().find((item) => /downloads?/i.test(item.signal || ""));
    return uniqueStrings([latestRevenue?.id, latestDownloads?.id].map(normalizeText).filter(Boolean));
  }

  function normalizeDateRange(range = {}) {
    return {
      start: normalizeText(range.start || range.startDate || range.start_date),
      end: normalizeText(range.end || range.endDate || range.end_date),
      duration: normalizeText(range.duration)
    };
  }

  function rpd(revenue, downloads) {
    const downloadCount = Number(downloads || 0);
    return downloadCount > 0 ? roundNumber(Number(revenue || 0) / downloadCount, 2) : 0;
  }

  function pct(value) {
    return roundNumber(Number(value || 0) * 100, 1);
  }

  function roundMoney(value) {
    return roundNumber(value, 2);
  }

  function roundNumber(value, digits = 0) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return 0;
    const multiplier = 10 ** digits;
    return Math.round(number * multiplier) / multiplier;
  }

  function publicReportAiPath(app, definition, extension) {
    return `/reports/ai-source-packs/${encodeURIComponent(safeFileSegment(displayAppName(app)))}/${encodeURIComponent(`${definition.id}.${extension}`)}`;
  }

  function safeFileSegment(value) {
    return normalizeText(value).replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "Unknown App";
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

  function uniqueStrings(values) {
    return [...new Set(values.map(normalizeText).filter(Boolean))];
  }

  return {
    isReportAiModuleSupported,
    prepareModule,
    generateModuleInsights,
    buildReportAiSourcePack,
    buildReportAiPrompt
  };
}
