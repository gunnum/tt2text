import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createReportOutputService } from "../server/report-output-service.mjs";
import {
  MODULE_DRILLDOWN_REQUIRED_PREFIXES,
  MODULE_QUALITY_MARKERS,
  REPORT_OUTPUT_MODULE_IDS,
  REQUIRED_OUTPUT_SECTIONS,
  validateReportOutputQualityContract,
  validateReportOutputMetaContract
} from "../server/report-output-quality-rules.mjs";

const AGNES_READY_MODULE_IDS = [...REPORT_OUTPUT_MODULE_IDS];

test("report module quality rules cover every module", () => {
  assert.deepEqual(validateReportOutputQualityContract(), []);
  assert.deepEqual(Object.keys(MODULE_QUALITY_MARKERS), REPORT_OUTPUT_MODULE_IDS);
  assert.deepEqual(Object.keys(MODULE_DRILLDOWN_REQUIRED_PREFIXES), REPORT_OUTPUT_MODULE_IDS);
  assert.deepEqual(REQUIRED_OUTPUT_SECTIONS, ["## 正式正文", "## Source Pack 摘要", "## 证据台账"]);
  for (const moduleId of REPORT_OUTPUT_MODULE_IDS) {
    assert.ok(MODULE_QUALITY_MARKERS[moduleId].length >= 1, `${moduleId} needs quality markers`);
    assert.ok(MODULE_DRILLDOWN_REQUIRED_PREFIXES[moduleId].length >= 1, `${moduleId} needs drilldown evidence requirements`);
  }
});

test("report output ignores an unfilled experience template", async () => {
  const projectRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt2text-report-output-"));
  try {
    const service = createReportOutputService(createReportOutputDeps(projectRootDir));

    const initial = await service.buildAppReportOutput("app-1");
    const initialExperience = initial.modules.find((module) => module.id === "experience");
    assert.equal(initial.sources.experienceDocs, 0);
    assert.equal(initialExperience.status, "blocked");
    assert.match(initialExperience.templatePath, /experience-templates/);

    const templatePath = path.join(projectRootDir, "reports", "experience-templates", "TestApp体验.md");
    const targetPath = path.join(projectRootDir, "reports", "TestApp体验.md");
    fs.copyFileSync(templatePath, targetPath);

    const withEmptyTemplate = await service.buildAppReportOutput("app-1");
    const emptyTemplateExperience = withEmptyTemplate.modules.find((module) => module.id === "experience");
    assert.equal(withEmptyTemplate.sources.experienceDocs, 0);
    assert.equal(emptyTemplateExperience.status, "blocked");

    fs.appendFileSync(targetPath, [
      "",
      "- 核心体验判断：首屏承诺很清楚，但注册后核心路径需要多次返回才找到匹配入口。",
      "- 看到什么 / 原话：注册后第一屏先出现付费提示，用户任务被打断。",
      "- 判断：EXP1 和 REV1 可以共同支撑商业化打断体验的判断。"
    ].join("\n"));

    const withFilledTemplate = await service.buildAppReportOutput("app-1");
    const filledTemplateExperience = withFilledTemplate.modules.find((module) => module.id === "experience");
    assert.equal(withFilledTemplate.sources.experienceDocs, 1);
    assert.equal(filledTemplateExperience.status, "ready");
  } finally {
    fs.rmSync(projectRootDir, { recursive: true, force: true });
  }
});

test("filled experience material generates Markdown and mindmap output", async () => {
  const projectRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt2text-report-output-"));
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.AGNES_API_KEY;
  const originalReportAi = process.env.TT2TEXT_REPORT_AI;
  try {
    process.env.AGNES_API_KEY = "test-key";
    delete process.env.TT2TEXT_REPORT_AI;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              executiveSummary: "体验材料显示首屏承诺清楚，但核心路径和商业化触点仍需要用 EXP1 继续验证。",
              reportDraftMarkdown: [
                "# 产品体验实测：TestApp",
                "",
                "## 首次进入",
                "- 注册后进入核心路径前会先遇到付费提示，外部承诺不能直接等同于真实体验 X1。",
                "",
                "## 核心任务路径",
                "- 当前体验记录显示核心任务路径存在返回和犹豫点，需要继续补截图确认具体阻断位置 X1。",
                "",
                "## 反馈与付费触发",
                "- 付费触发出现在核心体验前段，后续应继续验证它是否影响继续使用 X1。",
                "",
                "## 总结",
                "体验模块应把外部承诺和真实路径并排写，先确认用户能否顺利抵达核心任务 X1。"
              ].join("\n"),
              keyFindings: [{
                title: "路径有摩擦",
                insight: "核心任务路径存在返回和犹豫点，不能直接把外部素材承诺写成真实体验。",
                evidence: "体验证据 EXP1 显示注册后先遇到付费提示。",
                evidenceIds: ["X1"],
                confidence: "medium"
              }],
              tensions: [{
                title: "承诺与体验",
                explanation: "外部承诺强调快速建立关系，但体验记录显示进入核心路径前已有商业化打断。",
                evidence: "X1",
                evidenceIds: ["X1"]
              }],
              reportAngles: [{
                title: "体验反证",
                paragraph: "体验模块应把外部承诺和真实路径并排写，先确认用户能否顺利抵达匹配和互动。",
                evidenceIds: ["X1"]
              }],
              missingEvidence: ["还需要补充截图或录屏证明付费提示位置"],
              followUpQuestions: ["是否影响继续使用"]
            })
          }
        }]
      })
    });

    const service = createReportOutputService(createReportOutputDeps(projectRootDir));
    await service.buildAppReportOutput("app-1");
    const targetPath = path.join(projectRootDir, "reports", "TestApp体验.md");
    fs.writeFileSync(targetPath, filledExperienceMarkdown(), "utf8");

    const generated = await service.generateAppReportModule("app-1", "experience");
    assert.equal(generated.status, "ready");
    assert.equal(generated.generationStatus, "done");
    assert.equal(generated.aiStatus, "ready");
    assert.equal(generated.qualityStatus, "passed");
    assert.match(generated.markdown, /## 正式正文/);
    assert.match(generated.markdown, /## 证据台账/);
    assert.match(generated.markdown, /\|\s*X1\s*\| 体验文档 \|/);
    assert.doesNotMatch(generated.markdown, /## 8\. 信号下钻 \/ 原文样本|## 15\. 脑图/);
    const generatedMdPath = path.join(projectRootDir, "reports", "modules", "TestApp", "experience.md");
    const generatedMetaPath = path.join(projectRootDir, "reports", "modules", "TestApp", "experience.meta.json");
    assert.ok(fs.existsSync(generatedMdPath));
    assert.ok(fs.existsSync(generatedMetaPath));
    const meta = JSON.parse(fs.readFileSync(generatedMetaPath, "utf8"));
    assert.deepEqual(validateReportOutputMetaContract(meta, "experience"), []);

    const afterGenerate = await service.buildAppReportOutput("app-1");
    const experience = afterGenerate.modules.find((module) => module.id === "experience");
    assert.equal(afterGenerate.sources.experienceDocs, 1);
    assert.equal(experience.status, "ready");
    assert.equal(experience.generationStatus, "done");
    assert.equal(experience.qualityStatus, "passed");
  } finally {
    if (originalFetch) globalThis.fetch = originalFetch;
    else delete globalThis.fetch;
    if (originalApiKey == null) delete process.env.AGNES_API_KEY;
    else process.env.AGNES_API_KEY = originalApiKey;
    if (originalReportAi == null) delete process.env.TT2TEXT_REPORT_AI;
    else process.env.TT2TEXT_REPORT_AI = originalReportAi;
    fs.rmSync(projectRootDir, { recursive: true, force: true });
  }
});

test("Sensor Tower review parsedPath can be absolute", async () => {
  const projectRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt2text-report-output-"));
  try {
    const parsedPath = path.join(projectRootDir, ".tmp", "absolute-reviews.json");
    fs.mkdirSync(path.dirname(parsedPath), { recursive: true });
    fs.writeFileSync(parsedPath, JSON.stringify({ sampleRows: buildReviewRows() }, null, 2), "utf8");
    const service = createReportOutputService(createReportOutputDeps(projectRootDir, {
      sensorImports: [
        sensorImport("reviews", 80, { start: "2026-03-25", end: "2026-06-22" }, parsedPath)
      ]
    }));

    const output = await service.buildAppReportOutput("app-1");
    assert.equal(output.sources.reviewRows, 80);
    assert.equal(output.sources.reviewSamples, 25);
    assert.equal(output.sources.userVoice, 80);
  } finally {
    fs.rmSync(projectRootDir, { recursive: true, force: true });
  }
});

test("report output dedupes repeated Sensor Tower review imports before counting user voice", async () => {
  const projectRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt2text-report-output-"));
  try {
    const parsedPath = path.join(projectRootDir, ".tmp", "dedupe-reviews.json");
    fs.mkdirSync(path.dirname(parsedPath), { recursive: true });
    fs.writeFileSync(parsedPath, JSON.stringify({ sampleRows: buildReviewRows() }, null, 2), "utf8");
    const duplicateA = sensorImport("reviews", 80, { start: "2026-03-25", end: "2026-06-22" }, parsedPath);
    const duplicateB = { ...duplicateA, id: "st-reviews-dup", importedAt: "2026-06-22T13:00:00.000Z" };
    const service = createReportOutputService(createReportOutputDeps(projectRootDir, {
      sensorImports: [duplicateA, duplicateB]
    }));

    const output = await service.buildAppReportOutput("app-1");
    assert.equal(output.sources.reviewImports, 1);
    assert.equal(output.sources.reviewRows, 80);
    assert.equal(output.sources.userVoice, 80);
  } finally {
    fs.rmSync(projectRootDir, { recursive: true, force: true });
  }
});

test("category ranking output exposes top app market size", async () => {
  const projectRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt2text-report-output-"));
  try {
    const service = createReportOutputService(createReportOutputDeps(projectRootDir, {
      sensorImports: [
        categoryRankingImport()
      ]
    }));

    const detail = await service.buildAppReportOutput("app-1");
    assert.equal(detail.categoryRanking.summary.appCount, 3);
    assert.equal(detail.categoryRanking.summary.averageRevenueUsd90d, 600);
    assert.equal(detail.categoryRanking.summary.averageMonthlyRevenueUsd, 200);
    assert.equal(detail.categoryRanking.rows[0].monthlyRevenueUsd, 300);
    assert.equal(detail.categoryRanking.dateRange.start, "2026-03-24");
    assert.equal(detail.categoryRanking.dateRange.end, "2026-06-21");

    const ranking = await service.buildAppCategoryRankingOutput("app-1");
    assert.equal(ranking.categoryRanking.rows.length, 3);
    assert.equal(ranking.categoryRanking.countries.join(","), "all");
  } finally {
    fs.rmSync(projectRootDir, { recursive: true, force: true });
  }
});

test("category ranking output reuses the latest shared App IQ snapshot", async () => {
  const projectRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt2text-report-output-"));
  try {
    const app1 = {
      id: "app-1",
      name: "TestApp",
      fullName: "TestApp",
      sellerName: "Test Seller",
      category: "Social",
      bundleId: "com.testapp.social"
    };
    const app2 = {
      ...app1,
      id: "app-2",
      name: "Yuka",
      fullName: "Yuka"
    };
    const older = categoryRankingImport();
    const newer = {
      ...categoryRankingImport(),
      id: "st-category-yuka",
      appId: "app-2",
      importedAt: "2026-06-23T12:00:00.000Z",
      categoryRanking: {
        ...categoryRankingImport().categoryRanking,
        customFieldsFilterId: "test-filter",
        importedAt: "2026-06-23T12:00:00.000Z",
        rows: [
          { rank: 1, appName: "Shared Latest", revenueUsd90d: 1200, monthlyRevenueUsd: 400, downloads90d: 12000, dau: 120 }
        ]
      }
    };
    const service = createReportOutputService(createReportOutputDeps(projectRootDir, {
      apps: [app1, app2],
      sensorImports: [newer, older]
    }));

    const ranking = await service.buildAppCategoryRankingOutput("app-1");
    assert.equal(ranking.categoryRanking.importId, "st-category-yuka");
    assert.equal(ranking.categoryRanking.rows[0].appName, "Shared Latest");
    assert.equal(ranking.categoryRanking.summary.averageMonthlyRevenueUsd, 400);
  } finally {
    fs.rmSync(projectRootDir, { recursive: true, force: true });
  }
});

test("growth module counts ad shots as TT material", async () => {
  const projectRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt2text-report-output-"));
  try {
    const service = createReportOutputService(createReportOutputDeps(projectRootDir, {
      adShots: buildVideoRows().map((item, index) => ({
        ...item,
        shotId: `shot-${index + 1}`,
        id: undefined,
        appId: "app-1",
        appName: "TestApp"
      }))
    }));

    const detail = await service.buildAppReportOutput("app-1");
    const growth = detail.modules.find((module) => module.id === "growth_signals");
    assert.equal(detail.sources.ttVideosRaw, 6);
    assert.equal(detail.sources.ttVideos, 6);
    assert.equal(growth.status, "ready");
  } finally {
    fs.rmSync(projectRootDir, { recursive: true, force: true });
  }
});

test("complete source pack generates every report module with quality artifacts", async () => {
  const projectRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt2text-report-output-"));
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.AGNES_API_KEY;
  const originalReportAi = process.env.TT2TEXT_REPORT_AI;
  try {
    process.env.AGNES_API_KEY = "test-key";
    delete process.env.TT2TEXT_REPORT_AI;
    globalThis.fetch = async (_url, options = {}) => {
      const body = JSON.parse(options.body || "{}");
      const prompt = body.messages?.find((item) => item.role === "user")?.content || "";
      const founder = /创始人 \/ 公司 \/ 融资背景/.test(prompt);
      const content = founder ? {
        executiveSummary: "公司背景显示 TestApp 以 AI 记录切入，并通过 MyFitnessPal 收购完成退出。",
        reportDraftMarkdown: [
          "# 创始人 / 公司 / 融资背景：TestApp",
          "",
          "## 创业起点",
          "TestApp 从 AI calorie tracking 切入，试图降低饮食记录门槛 A2。",
          "",
          "## 产品路线",
          "产品路线围绕拍照识别和宏量营养反馈展开，后续与 MyFitnessPal 组合互补 A1。",
          "",
          "## 团队能力",
          "团队具备 AI 产品落地和轻量增长执行能力 A2。",
          "",
          "## 创始人过往代表作",
          "创始人在 TestApp 之前的代表作暂未确认，因此不做延伸判断 A2。",
          "",
          "## 增长打法",
          "增长更依赖清晰产品价值和应用商店表达，而不是公开融资叙事 A2。",
          "",
          "## 融资 / 收购",
          "MyFitnessPal 官方确认收购 TestApp，财务交易条款未披露 A1。",
          "",
          "## 待验证部分",
          "- 收购金额和交易条款未披露 A1。",
          "",
          "## 总结",
          "TestApp 的公司背景能解释它为什么以高频、低摩擦的 AI 记录任务切入，并最终进入 MyFitnessPal 的产品组合 A1。"
        ].join("\n"),
        keyFindings: [{
          title: "收购退出",
          insight: "MyFitnessPal 官方确认收购 TestApp。",
          evidence: "财务交易条款未披露",
          evidenceIds: ["A1"],
          confidence: "high"
        }],
        tensions: [],
        reportAngles: [{ title: "收购退出", paragraph: "MyFitnessPal 官方确认收购 TestApp，交易条款未披露 A1。", evidenceIds: ["A1"] }],
        missingEvidence: [],
        followUpQuestions: []
      } : {
        executiveSummary: "材料已经覆盖数据、素材、评论和体验，当前模块可以用证据链方式输出判断，但仍需保留样本边界。",
        reportDraftMarkdown: [
          "# 数据状态判断：TestApp",
          "",
          "## 当前判断",
          "TestApp 当前可以用本地数据、素材、评论和体验材料形成初步判断 A1、D1、V1、R1、T1、X1。",
          "",
          "## 关键依据",
          "- 已有文章、市场数据、素材和评论证据，可以支撑模块正文生成 A1、D1、V1、R1。",
          "",
          "## 总结",
          "正式报告应直接写结论，并在事实句后保留证据 ID A1。"
        ].join("\n"),
        keyFindings: [{
          title: "证据可追溯",
          insight: "当前判断需要回到证据台账和原文样本，避免把单一来源写成总体结论。",
          evidence: "A1、D1、V1、R1、T1、X1",
          evidenceIds: ["A1", "D1", "V1", "R1", "C1", "T1", "X1"],
          confidence: "medium"
        }],
        tensions: [{
          title: "承诺与现实",
          explanation: "增长素材的强承诺需要和评论、体验里的摩擦并排判断。",
          evidence: "V1、R1、X1",
          evidenceIds: ["V1", "R1", "X1"]
        }],
        reportAngles: [{
          title: "证据链写法",
          paragraph: "正式报告应先交代样本边界，再用原文和数据支撑主题判断，最后明确哪些结论还不能贸然下。",
          evidenceIds: ["A1", "T1", "R1"]
        }],
        missingEvidence: ["还需要真实业务数据或更多截图来提高强判断置信度"],
        followUpQuestions: ["哪些证据最能反证"]
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] })
      };
    };

    const deps = createReportOutputDeps(projectRootDir, createCompleteSourcePack(projectRootDir));
    const service = createReportOutputService(deps);
    fs.mkdirSync(path.join(projectRootDir, "reports"), { recursive: true });
    fs.writeFileSync(path.join(projectRootDir, "reports", "TestApp体验.md"), filledExperienceMarkdown(), "utf8");

    const beforeGenerate = await service.buildAppReportOutput("app-1");
    assert.equal(beforeGenerate.qualitySummary.total, REPORT_OUTPUT_MODULE_IDS.length);
    assert.equal(beforeGenerate.qualitySummary.ready, REPORT_OUTPUT_MODULE_IDS.length, `blocked: ${beforeGenerate.qualitySummary.blockedModuleIds.join(", ")}`);
    assert.deepEqual(beforeGenerate.qualitySummary.blockedModuleIds, []);

    const prepared = await service.prepareAppReportModuleAi("app-1", "country_market_split");
    assert.equal(prepared.available, true);
    assert.ok(fs.existsSync(prepared.sourcePackFilePath));
    assert.ok(fs.existsSync(prepared.promptFilePath));
    const sourcePack = JSON.parse(fs.readFileSync(prepared.sourcePackFilePath, "utf8"));
    assert.equal(sourcePack.sourcePack.module.id, "country_market_split");
    assert.equal(sourcePack.sourcePack.topRevenueCountries[0].country, "美国");
    assert.match(fs.readFileSync(prepared.promptFilePath, "utf8"), /国家市场分工/);

    const preparedCompetitors = await service.prepareAppReportModuleAi("app-1", "category_competitors");
    assert.equal(preparedCompetitors.available, true);
    assert.ok(fs.existsSync(preparedCompetitors.sourcePackFilePath));
    assert.ok(fs.existsSync(preparedCompetitors.promptFilePath));
    const competitorsSourcePack = JSON.parse(fs.readFileSync(preparedCompetitors.sourcePackFilePath, "utf8"));
    assert.equal(competitorsSourcePack.sourcePack.module.id, "category_competitors");
    assert.equal(competitorsSourcePack.sourcePack.rankingContext.categoryName, "Nutrition & Diet");
    assert.equal(competitorsSourcePack.sourcePack.topCompetitors[0].id, "K1");
    assert.equal(competitorsSourcePack.sourcePack.missingLocalCompetitors[0].id, "K1");
    assert.match(fs.readFileSync(preparedCompetitors.promptFilePath, "utf8"), /垂类竞品榜/);

    const preparedPainPoints = await service.prepareAppReportModuleAi("app-1", "user_pain_points");
    assert.equal(preparedPainPoints.available, true);
    assert.ok(fs.existsSync(preparedPainPoints.sourcePackFilePath));
    assert.ok(fs.existsSync(preparedPainPoints.promptFilePath));
    const painSourcePack = JSON.parse(fs.readFileSync(preparedPainPoints.sourcePackFilePath, "utf8"));
    assert.equal(painSourcePack.sourcePack.module.id, "user_pain_points");
    assert.equal(painSourcePack.sourcePack.officialPainSignals.storeScreenshots[0].id, "S1");
    assert.equal(painSourcePack.sourcePack.userVoiceSignals.appStoreReviewCases[0].id, "R1");
    assert.match(fs.readFileSync(preparedPainPoints.promptFilePath, "utf8"), /用户痛点/);

    const preparedGrowth = await service.prepareAppReportModuleAi("app-1", "growth_signals");
    assert.equal(preparedGrowth.available, true);
    assert.ok(fs.existsSync(preparedGrowth.sourcePackFilePath));
    assert.ok(fs.existsSync(preparedGrowth.promptFilePath));
    const growthSourcePack = JSON.parse(fs.readFileSync(preparedGrowth.sourcePackFilePath, "utf8"));
    assert.equal(growthSourcePack.sourcePack.module.id, "growth_signals");
    assert.equal(growthSourcePack.sourcePack.growthVideos[0].id, "V1");
    assert.equal(growthSourcePack.sourcePack.audienceComments[0].id, "C1");
    assert.match(fs.readFileSync(preparedGrowth.promptFilePath, "utf8"), /增长内容/);

    const preparedPaid = await service.prepareAppReportModuleAi("app-1", "paid_points");
    assert.equal(preparedPaid.available, true);
    assert.ok(fs.existsSync(preparedPaid.sourcePackFilePath));
    assert.ok(fs.existsSync(preparedPaid.promptFilePath));
    const paidSourcePack = JSON.parse(fs.readFileSync(preparedPaid.sourcePackFilePath, "utf8"));
    assert.equal(paidSourcePack.sourcePack.module.id, "paid_points");
    assert.equal(paidSourcePack.sourcePack.paywallSamples[0].id, "P1");
    assert.ok(paidSourcePack.sourcePack.highPayingMarkets[0].country);
    assert.ok(paidSourcePack.sourcePack.highPayingMarkets[0].rpd > 0);
    assert.match(fs.readFileSync(preparedPaid.promptFilePath, "utf8"), /付费点与价格结构/);

    const preparedFounder = await service.prepareAppReportModuleAi("app-1", "founder_company");
    assert.equal(preparedFounder.available, true);
    assert.ok(fs.existsSync(preparedFounder.sourcePackFilePath));
    assert.ok(fs.existsSync(preparedFounder.promptFilePath));
    const founderSourcePack = JSON.parse(fs.readFileSync(preparedFounder.sourcePackFilePath, "utf8"));
    const founderPrompt = fs.readFileSync(preparedFounder.promptFilePath, "utf8");
    assert.equal(founderSourcePack.sourcePack.module.id, "founder_company");
    assert.ok(founderSourcePack.sourcePack.companyArticles.some((item) => /myfitnesspal-acquires/.test(item.sourceUrl)));
    assert.ok(founderSourcePack.sourcePack.evidenceLedger.some((item) => /MyFitnessPal/.test(`${item.signal} ${item.evidence}`)));
    assert.match(founderPrompt, /创始人 \/ 公司 \/ 融资背景/);
    assert.match(founderPrompt, /模块专属 source selector/);
    assert.match(founderPrompt, /不要在正文反复写“据 xxx 报道”/);
    assert.match(founderPrompt, /每个小节至少引用 1 个 A 类证据 ID/);

    const generated = await service.generateAppReportModules("app-1", { skipExisting: false });
    assert.equal(generated.generatedCount, REPORT_OUTPUT_MODULE_IDS.length);
    assert.equal(generated.failedCount, 0);
    assert.equal(generated.skippedCount, 0);

    for (const module of generated.generated) {
      assert.equal(module.generationStatus, "done", `${module.id} should be generated`);
      if (AGNES_READY_MODULE_IDS.includes(module.id)) {
        assert.equal(module.aiStatus, "ready", `${module.id} should have Agnes insights`);
      } else {
        assert.equal(module.aiStatus, "unavailable", `${module.id} prompt should wait for confirmation`);
        assert.match(module.aiError, /模块 prompt 待确认/);
      }
      assert.equal(module.qualityStatus, "passed", `${module.id}: ${(module.qualityIssues || []).join("; ")}`);
      assert.ok(fs.existsSync(module.markdownFilePath), `${module.id} markdown missing`);
      assert.ok(fs.existsSync(module.reportMarkdownFilePath), `${module.id} report markdown missing`);
      assert.match(module.reportMarkdown, new RegExp(`# .+：TestApp`), `${module.id} report markdown should contain only report draft`);
      const metaPath = path.join(projectRootDir, "reports", "modules", "TestApp", `${module.id}.meta.json`);
      assert.ok(fs.existsSync(metaPath), `${module.id} meta missing`);
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      assert.deepEqual(validateReportOutputMetaContract(meta, module.id), []);
      assert.equal(meta.qualityContract.name, "module-report-source-pack-citations");
      assert.equal(meta.qualityContract.requiredArtifacts.includes("markdown"), true);
      assert.equal(meta.qualityContract.requiredArtifacts.includes("reportMarkdown"), true);
      assert.equal(meta.qualityContract.requiredArtifacts.includes("citations"), true);
      assert.equal(meta.qualityContract.requiredArtifacts.includes("meta"), true);
      assert.deepEqual(meta.qualityContract.requiredMindmapBranches, []);
      assert.equal(meta.citations?.[0]?.id, "A1");
      if (module.id === "founder_company") {
        assert.ok(meta.citations.some((item) => /myfitnesspal-acquires/.test(item.sourceUrl)));
        assert.match(module.markdown, /## Source Pack 摘要/);
        assert.match(module.markdown, /## 证据台账/);
      } else {
        assert.equal(meta.citations?.[0]?.sourceUrl, "https://example.com/research-note");
        assert.match(module.markdown, /## 正式正文/);
        assert.match(module.markdown, /## Source Pack 摘要/);
        assert.match(module.markdown, /## 证据台账/);
        assert.doesNotMatch(module.markdown, /## 15\. 脑图|## 9\. 判断 - 证据矩阵/);
      }
    }

    const afterGenerate = await service.buildAppReportOutput("app-1");
    const founderModule = afterGenerate.modules.find((module) => module.id === "founder_company");
    assert.equal(founderModule.citations?.[0]?.id, "A1");
    assert.ok(founderModule.citations.some((item) => /myfitnesspal-acquires/.test(item.sourceUrl)));
    assert.match(founderModule.reportMarkdown, /# 创始人 \/ 公司 \/ 融资背景：TestApp/);
    assert.doesNotMatch(founderModule.reportMarkdown, /## 1\. 样本边界/);
    assert.equal(afterGenerate.qualitySummary.done, REPORT_OUTPUT_MODULE_IDS.length);
    assert.equal(afterGenerate.qualitySummary.fresh, REPORT_OUTPUT_MODULE_IDS.length);
    assert.equal(afterGenerate.qualitySummary.passed, REPORT_OUTPUT_MODULE_IDS.length);
    assert.deepEqual(afterGenerate.qualitySummary.failedModuleIds, []);
    assert.deepEqual(
      afterGenerate.qualitySummary.aiUnavailableModuleIds,
      REPORT_OUTPUT_MODULE_IDS.filter((id) => !AGNES_READY_MODULE_IDS.includes(id))
    );
  } finally {
    if (originalFetch) globalThis.fetch = originalFetch;
    else delete globalThis.fetch;
    if (originalApiKey == null) delete process.env.AGNES_API_KEY;
    else process.env.AGNES_API_KEY = originalApiKey;
    if (originalReportAi == null) delete process.env.TT2TEXT_REPORT_AI;
    else process.env.TT2TEXT_REPORT_AI = originalReportAi;
    fs.rmSync(projectRootDir, { recursive: true, force: true });
  }
});

function createReportOutputDeps(projectRootDir, overrides = {}) {
  const app = {
    id: "app-1",
    name: "TestApp",
    fullName: "TestApp - AI Calorie Tracker",
    sellerName: "Test Seller",
    category: "Health & Fitness",
    bundleId: "com.testapp.health",
    country: "US"
  };
  return {
    projectRootDir,
    readApps: async () => overrides.apps || [app],
    readArticles: async () => overrides.articles || [],
    readAppMetrics: async () => overrides.appMetrics || [],
    readAppPaywalls: async () => overrides.appPaywalls || [],
    readSensorTowerCsvImports: async () => overrides.sensorImports || [],
    readResults: async () => overrides.results || [],
    readAdShots: async () => overrides.adShots || [],
    readTikTokCommentsRaw: async () => overrides.tiktokComments || [],
    fetchQiaomuReviewInsights: async () => overrides.qiaomu || { available: false },
    qiaomuBaseUrl: "http://localhost:4000",
    normalizeText,
    truncateText
  };
}

function createCompleteSourcePack(projectRootDir) {
  const parsedDir = path.join(projectRootDir, ".tmp", "sensor");
  fs.mkdirSync(parsedDir, { recursive: true });
  const parsedPath = path.join(parsedDir, "reviews.json");
  fs.writeFileSync(parsedPath, JSON.stringify({ sampleRows: buildReviewRows() }, null, 2), "utf8");
  const parsedPathFromRoot = path.relative(projectRootDir, parsedPath);
  const downloadsCsvPath = writeSensorCsv(projectRootDir, "downloads.csv", [
    ["Country", "Downloads"],
    ["US", "120000"],
    ["BR", "80000"],
    ["GB", "42000"]
  ]);
  const revenueCsvPath = writeSensorCsv(projectRootDir, "revenue.csv", [
    ["Country", "Revenue ($)"],
    ["US", "240000"],
    ["GB", "126000"],
    ["BR", "24000"]
  ]);

  return {
    articles: [
      {
        appId: "app-1",
        title: "TestApp 创始人采访：用 AI 降低饮食记录门槛",
        excerpt: "Founder Lee 在采访中称团队融资后继续做 AI-native calorie tracking，核心目标是用拍照和自动识别降低手动记录成本。",
        sourceName: "Research Note",
        sourceDomain: "example.com",
        sourceUrl: "https://example.com/research-note",
        author: "Reporter A",
        publishedAt: "2026-06-01"
      },
      {
        appId: "app-1",
        title: "TestApp 增长素材强调拍照识别和宏量营养反馈",
        excerpt: "外部素材常用 scan meal、calorie estimate、macro plan 作为进入理由，并和 MyFitnessPal、Yazio 形成替代场景。",
        sourceName: "Growth Desk",
        sourceDomain: "growth.example.com",
        sourceUrl: "https://growth.example.com/testapp-growth",
        author: "Reporter B",
        publishedAt: "2026-06-05"
      },
      {
        appId: "app-1",
        title: "MyFitnessPal acquires TestApp",
        excerpt: "MyFitnessPal 官方确认收购 TestApp，财务交易条款未披露。TestApp 将作为独立产品继续运营，并与 MyFitnessPal 产品组合互补。",
        sourceName: "GlobeNewswire",
        sourceDomain: "globenewswire.com",
        sourceUrl: "https://example.com/myfitnesspal-acquires-testapp",
        author: "Press Release",
        publishedAt: "2026-03-02"
      }
    ],
    appMetrics: [
      {
        appId: "app-1",
        metric: "downloads",
        value: 120000,
        date: "2026-06-01",
        overview: {
          screenshots: [
            { platform: "ios", imageUrl: "https://example.com/feature-1.png", alt: "Scan meals with AI" },
            { platform: "ios", imageUrl: "https://example.com/feature-2.png", alt: "Track calories and macros" }
          ]
        }
      }
    ],
    appPaywalls: [{
      appId: "app-1",
      appName: "TestApp",
      matches: [
        { appName: "TestApp", imageUrl: "https://example.com/paywall.png", pageUrl: "https://example.com/paywall", collectedAt: "2026-06-20T00:00:00.000Z" }
      ]
    }],
    sensorImports: [
      sensorImport("downloads", 90, { start: "2026-03-25", end: "2026-06-22" }, "", downloadsCsvPath),
      sensorImport("revenue", 90, { start: "2026-03-25", end: "2026-06-22" }, "", revenueCsvPath),
      sensorImport("active_usage", 90, { start: "2026-03-25", end: "2026-06-22" }),
      sensorImport("reviews", 80, { start: "2026-03-25", end: "2026-06-22" }, parsedPathFromRoot),
      categoryRankingImport()
    ],
    results: buildVideoRows(),
    tiktokComments: [{
      appId: "app-1",
      videoTitle: "TestApp Korean friend story",
      sourceUrl: "https://www.tiktok.com/@testapp/video/1",
      items: buildTikTokCommentRows()
    }],
    qiaomu: {
      available: true,
      status: "ready",
      counts: { themes: 4, insights: 3, trends: 2, analysis: 1, total: 10 },
      payload: {
        fetchedAt: "2026-06-22T00:00:00.000Z",
        themes: [{ name: "AI 识别准确度" }, { name: "广告干扰" }, { name: "记录流程" }],
        insights: [{ title: "商业化打断核心任务" }],
        trends: [{ title: "近 90 天评论" }],
        analysis: { summary: "评论洞察可用" }
      }
    }
  };
}

function sensorImport(dataType, rowCount, dateRange, parsedPath = "", csvPath = "") {
  return {
    id: `st-${dataType}`,
    appId: "app-1",
    dataType,
    rowCount,
    dateRange,
    importedAt: "2026-06-22T12:00:00.000Z",
    sourcePath: `/imports/${dataType}.csv`,
    parsedPath,
    csvPath
  };
}

function writeSensorCsv(projectRootDir, fileName, rows) {
  const dir = path.join(projectRootDir, ".tmp", "sensor");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, "\"\"")}"`).join(",")).join("\n"), "utf8");
  return path.relative(projectRootDir, filePath);
}

function categoryRankingImport() {
  return {
    id: "st-category",
    appId: "app-1",
    dataType: "category_rankings",
    rowCount: 3,
    dateRange: { start: "2026-03-24", end: "2026-06-21", duration: "P90D" },
    filters: { countries: ["all"], os: "unified", devices: ["iphone", "ipad", "android"], comparisonAttribute: "absolute" },
    importedAt: "2026-06-22T12:00:00.000Z",
    sourcePath: "/imports/category.csv",
    categoryRanking: {
      customFieldsFilterId: "test-filter",
      categoryName: "Nutrition & Diet",
      countries: ["all"],
      os: "unified",
      devices: ["iphone", "ipad", "android"],
      metric: "revenue",
      sort: "absolute",
      dateRange: { start: "2026-03-24", end: "2026-06-21", duration: "P90D" },
      importedAt: "2026-06-22T12:00:00.000Z",
      rows: [
        { rank: 1, appName: "Top App", revenueUsd90d: 900, monthlyRevenueUsd: 300, downloads90d: 9000, dau: 90 },
        { rank: 2, appName: "Middle App", revenueUsd90d: 600, monthlyRevenueUsd: 200, downloads90d: 6000, dau: 60 },
        { rank: 3, appName: "Small App", revenueUsd90d: 300, monthlyRevenueUsd: 100, downloads90d: 3000, dau: 30 }
      ]
    }
  };
}

function buildReviewRows() {
  const base = [
    "The AI meal scan works well and saves me from typing every ingredient manually.",
    "Create a meal is still bugged and logs 1400 calories as 1900 consumed calories.",
    "Too many ads interrupt tracking before I understand whether the calorie estimate is accurate.",
    "The subscription appears too early before I can test enough scans or macro plans.",
    "Camera loading bug makes it hard to scan dinner and keep my streak.",
    "I like the macro summary, but the app sometimes misreads portions and needs manual correction.",
    "Login bug blocked my account and I lost recent food records.",
    "Compared with MyFitnessPal and Yazio, TestApp feels faster but less transparent about estimates.",
    "The plan and reminders help me stay consistent with diet goals.",
    "AI recognition is impressive for packaged food but weak for home cooked meals.",
    "The app crashes when uploading photos and syncing nutrition history.",
    "Paywall blocks useful insights before I can trust the calorie tracking."
  ];
  return Array.from({ length: 80 }, (_, index) => ({
    Title: `Review ${index + 1}`,
    Content: base[index % base.length],
    Rating: index % 5 === 0 ? 1 : index % 3 === 0 ? 2 : 4,
    Sentiment: index % 2 === 0 ? "unhappy" : "mixed",
    Country: "US"
  }));
}

function buildVideoRows() {
  return Array.from({ length: 6 }, (_, index) => ({
    appId: "app-1",
    title: `TestApp AI calorie scan story ${index + 1}`,
    publishedText: `TestApp helped me scan meals, count calories and track macros with AI ${index + 1}`,
    visualSummary: "Phone screen shows TestApp camera scan, calorie estimate, macro summary and a subscription prompt inside the meal tracking flow.",
    transcriptZh: "这个 TestApp 主打拍照识别食物、自动估算 calories 和 macros，也有人拿它和 MyFitnessPal、Yazio 比较，但评论会追问准确度和付费点。",
    sourceUrl: `https://www.tiktok.com/@testapp/video/${index + 1}`,
    viewCount: 100000 - index * 5000,
    likeCount: 5000 - index * 200,
    commentCount: 900 - index * 50
  }));
}

function buildTikTokCommentRows() {
  const texts = [
    "Is TestApp better than MyFitnessPal for scanning calories or are estimates wrong?",
    "The ad makes meal tracking look easy but does it work for home cooked food?",
    "I tried TestApp and got subscription prompts before trusting enough scans.",
    "The macro plan looks useful, but portion accuracy worries me.",
    "Compared with Yazio, this feels faster but less transparent about AI estimates."
  ];
  return Array.from({ length: 25 }, (_, index) => ({
    text: texts[index % texts.length],
    likeCount: 100 - index,
    appId: "app-1"
  }));
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncateText(value, maxLength = 220) {
  const text = normalizeText(value);
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

function filledExperienceMarkdown() {
  return [
    "# TestApp 体验实测",
    "",
    "## 1. 一句话体验结论",
    "- 核心体验判断：首屏承诺清楚，但注册后核心路径需要多次返回才找到匹配入口。",
    "- 最强证据编号：EXP1、REV1",
    "- 置信度：中",
    "",
    "## 4. 体验路径证据台账",
    "| ID | 环节 | 我做了什么 | 看到什么 / 原话 | 情绪或摩擦 | 截图 / 录屏 | 能支撑什么 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    "| EXP1 | 入口 / 注册 | 用新号完成注册并进入首页 | 注册后第一屏先出现付费提示，然后才看到匹配入口 | 用户任务被打断，需要返回一次 | screenshot-exp1.png | 商业化触点打断核心体验 |",
    "",
    "## 7. 体验判断 - 证据矩阵",
    "| 判断 | 支撑体验证据 | 外部互证 | 置信度 | 可写入报告的位置 |",
    "| --- | --- | --- | --- | --- |",
    "| 首屏承诺清楚，但核心路径被付费提示打断 | EXP1 | REV1 | 中 | 体验结论 / 商业化摩擦 |"
  ].join("\n");
}
