import {
  createCategoryResolver,
  hashId,
  normalizeAppName,
  normalizeStringArray
} from "./category-resolver.mjs";
import {
  createHighlightAnalysis
} from "./highlight-analysis.mjs";
import {
  compareReportVideos
} from "./interaction-score.mjs";
import {
  createVerticalVideoMetaStore
} from "./meta-store.mjs";
import {
  enrichScriptTypeCount
} from "./script-type-insights.mjs";
import {
  createVideoNormalizer
} from "./video-normalizer.mjs";
import {
  resolveVerticalVideoProfile
} from "./analysis-profiles.mjs";

export function createVerticalVideoReportService(deps = {}) {
  const requiredDeps = [
    "projectRootDir",
    "readAdShots",
    "normalizeText",
    "truncateText"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createVerticalVideoReportService 缺少依赖：${dep}`);
    }
  }

  const {
    readCategoryMeta,
    writeCategoryMeta
  } = createVerticalVideoMetaStore({ projectRootDir: deps.projectRootDir, reportsDir: deps.reportsDir });
  const {
    buildCategories,
    findCategoryById
  } = createCategoryResolver({ normalizeText });
  const {
    toReportVideo
  } = createVideoNormalizer({ normalizeText, truncateText });
  const {
    buildCodexHighlightBreakdowns,
    normalizeHighlightBreakdowns
  } = createHighlightAnalysis({
    normalizeText,
    truncateText,
    runCodexJsonTask: deps.runCodexJsonTask,
    codexHighlightTimeoutMs: deps.codexHighlightTimeoutMs
  });

  async function buildVerticalVideoCategoryIndex() {
    const { shots, apps } = await loadVideoReportContext();
    const categories = buildCategories(shots, apps);
    const withMeta = await Promise.all(categories.map(async (category) => {
      const report = buildCategoryReport(category, shots, await readCategoryMeta(category.id), apps);
      return {
        id: category.id,
        label: category.label,
        description: category.description,
        source: category.source || "inferred",
        appCategoryLabel: category.appCategoryLabel || "",
        videoCount: report.summary.videoCount,
        appCount: report.summary.appCount,
        topInteractionScore: report.summary.topInteractionScore,
        latestCapturedAt: report.summary.latestCapturedAt,
        lastAnalyzedAt: report.analysis.lastAnalyzedAt,
        addedSinceLastAnalysis: report.analysis.addedSinceLastAnalysis,
        removedSinceLastAnalysis: report.analysis.removedSinceLastAnalysis,
        previousVideoCount: report.analysis.previousVideoCount,
        hasPreviousAnalysis: report.analysis.hasPreviousAnalysis,
        status: report.analysis.lastAnalyzedAt ? "analyzed" : "new"
      };
    }));
    return {
      generatedAt: new Date().toISOString(),
      totalVideoCount: shots.length,
      categories: withMeta.sort((a, b) => b.videoCount - a.videoCount || a.label.localeCompare(b.label, "zh-CN"))
    };
  }

  async function buildVerticalVideoCategoryReport(categoryId) {
    const { shots, apps } = await loadVideoReportContext();
    const categories = buildCategories(shots, apps);
    const category = findCategoryById(categories, categoryId);
    if (!category) {
      throw new Error("VIDEO_CATEGORY_NOT_FOUND");
    }
    return buildCategoryReport(category, shots, await readCategoryMeta(category.id), apps);
  }

  async function analyzeVerticalVideoCategory(categoryId) {
    const { shots, apps } = await loadVideoReportContext();
    const categories = buildCategories(shots, apps);
    const category = findCategoryById(categories, categoryId);
    if (!category) {
      throw new Error("VIDEO_CATEGORY_NOT_FOUND");
    }
    const profile = resolveVerticalVideoProfile(category);
    const currentVideos = category.shots.map((shot) => toReportVideo(shot, { profile })).sort(compareReportVideos);
    const previousMeta = await readCategoryMeta(category.id);
    const currentIds = currentVideos.map((item) => item.id);
    const highlightBreakdowns = await buildCodexHighlightBreakdowns(category, currentVideos);
    const meta = {
      categoryId: category.id,
      categoryLabel: category.label,
      categoryAliases: category.aliases || [],
      analyzedAt: new Date().toISOString(),
      videoCount: currentIds.length,
      videoIds: currentIds,
      sourceHash: buildSourceHash(currentVideos, profile),
      snapshotVersion: 1,
      analysisProfileId: profile.id,
      analysisProfileVersion: profile.version,
      previousAnalyzedAt: previousMeta?.analyzedAt || "",
      previousVideoCount: previousMeta?.videoCount || 0,
      highlightBreakdowns,
      highlightBreakdownProvider: highlightBreakdowns.provider || "heuristic",
      highlightBreakdownError: highlightBreakdowns.error || ""
    };
    await writeCategoryMeta(category.id, meta);
    return buildCategoryReport(category, shots, meta, apps);
  }

  async function loadVideoReportContext() {
    const [shots, apps] = await Promise.all([
      deps.readAdShots(),
      typeof deps.readApps === "function" ? deps.readApps().catch(() => []) : []
    ]);
    return { shots, apps };
  }

  function buildCategoryReport(category, allShots, meta, apps = []) {
    const profile = resolveVerticalVideoProfile(category);
    const videos = category.shots.map((shot) => toReportVideo(shot, { profile })).sort(compareReportVideos);
    const currentSourceHash = buildSourceHash(videos, profile);
    const metaMatchesProfile = Boolean(
      meta?.sourceHash === currentSourceHash
      && meta?.analysisProfileId === profile.id
      && Number(meta?.analysisProfileVersion) === Number(profile.version)
    );
    const strategyMeta = metaMatchesProfile ? meta : null;
    const appLogoIndex = buildAppLogoIndex(apps);
    const previousIds = new Set(Array.isArray(meta?.videoIds) ? meta.videoIds : []);
    const currentIds = new Set(videos.map((item) => item.id));
    const added = [...currentIds].filter((id) => previousIds.size && !previousIds.has(id));
    const removed = [...previousIds].filter((id) => !currentIds.has(id));
    return {
      generatedAt: new Date().toISOString(),
      category: {
        id: category.id,
        label: category.label,
        description: category.description,
        analysisProfileId: profile.id,
        analysisProfileVersion: profile.version
      },
      summary: buildSummary(videos, allShots.length),
      analysis: {
        lastAnalyzedAt: meta?.analyzedAt || "",
        sourceHash: currentSourceHash,
        lastSourceHash: meta?.sourceHash || "",
        addedSinceLastAnalysis: previousIds.size ? added.length : 0,
        removedSinceLastAnalysis: previousIds.size ? removed.length : 0,
        addedVideoIds: previousIds.size ? added : [],
        removedVideoIds: previousIds.size ? removed : [],
        previousVideoCount: meta?.videoCount || 0,
        hasPreviousAnalysis: Boolean(meta?.analyzedAt),
        isStale: Boolean(meta?.analyzedAt && !metaMatchesProfile),
        pendingBaseAnalysisCount: videos.filter((item) => !item.hasBaseAnalysis).length
      },
      distributions: {
        apps: topAppCounts(videos, 12, appLogoIndex),
        accountTypes: topCounts(videos.map((item) => item.accountType), 8),
        scriptTypes: topCounts(videos.map((item) => item.scriptType), 10).map((item) => enrichScriptTypeCount(item, profile)),
        sources: topCounts(videos.map((item) => item.sourceLabel), 8)
      },
      strategy: buildStrategyModules(category, videos, strategyMeta, profile),
      videos
    };
  }

  function buildSummary(videos, totalVideoCount) {
    const latestCapturedAt = videos
      .map((item) => Date.parse(item.capturedAt || ""))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0];
    return {
      totalLibraryVideoCount: totalVideoCount,
      videoCount: videos.length,
      appCount: new Set(videos.map((item) => item.appName).filter(Boolean)).size,
      availablePreviewCount: videos.filter((item) => item.videoPath).length,
      pendingBaseAnalysisCount: videos.filter((item) => !item.hasBaseAnalysis).length,
      topInteractionScore: videos[0]?.interactionScore || 0,
      latestCapturedAt: Number.isFinite(latestCapturedAt) ? new Date(latestCapturedAt).toISOString() : ""
    };
  }

  function buildStrategyModules(category, videos, meta = {}, profile = resolveVerticalVideoProfile(category)) {
    const categoryLabel = category.label || "垂类";
    const topScriptType = topCounts(videos.map((item) => item.scriptType), 1)[0]?.label || "高频脚本";
    const topApp = topCounts(videos.map((item) => item.appName), 1)[0]?.label || "头部 App";
    const appAccountVideoTypes = profile.id === "reading"
      ? buildReadingAppAccountVideoTypes()
      : profile.id === "music-social"
        ? buildMusicAppAccountVideoTypes()
        : buildGenericAppAccountVideoTypes(categoryLabel, topScriptType);
    const creatorContentVideoTypes = profile.id === "reading"
      ? buildReadingCreatorContentVideoTypes()
      : profile.id === "music-social"
        ? buildMusicCreatorContentVideoTypes()
        : buildGenericCreatorContentVideoTypes(categoryLabel, topScriptType);
    const cachedHighlightBreakdowns = meta?.highlightBreakdownProvider === "local-codex"
      ? meta?.highlightBreakdowns
      : null;
    const highlightBreakdowns = normalizeHighlightBreakdowns(cachedHighlightBreakdowns, videos);
    return {
      lessons: buildLessons(videos, topScriptType, topApp, profile),
      highlightBreakdowns,
      highlightBreakdownMeta: {
        provider: meta?.highlightBreakdownProvider || "heuristic",
        error: meta?.highlightBreakdownError || "",
        count: highlightBreakdowns.items.length
      },
      appAccountVideoTypes: enrichVideoTypeItems(appAccountVideoTypes, { categoryLabel, role: "app", profile }),
      creatorContentVideoTypes: enrichVideoTypeItems(creatorContentVideoTypes, { categoryLabel, role: "creator", profile })
    };
  }

  function buildLessons(videos, topScriptType, topApp, profile) {
    if (profile.id === "music-social") return buildMusicLessons(videos, topScriptType, topApp);
    if (profile.id !== "reading") return buildGenericLessons(videos, topScriptType, topApp);
    const hasOfficial = videos.some((video) => /官方|品牌/.test(video.accountType));
    const hasCreator = videos.some((video) => /红人|内容/.test(video.accountType));
    return {
      reusable: [
        {
          title: `${topScriptType} 是最大公约数`,
          body: `当前样本里「${topScriptType}」占比最高。可复用的不是固定句式，而是先把用户的时间浪费、注意力、读不完或选择困难说具体，再给出一个可执行动作。`
        },
        {
          title: "书单/计划比单点功能更像产品",
          body: "Day 1-Day 7、每日一本、主题书单、阅读计划这类结构能让用户马上理解打开 App 后要做什么，也更容易收藏。"
        },
        {
          title: "功能演示要绑定具体人群",
          body: "扫描、朗读、摘要、统计、目标这类功能，只有绑定 ADHD、通勤、没时间、读不完、想提升表达等人群场景时，才不像产品说明书。"
        },
        {
          title: hasCreator ? "红人号适合生活方式挂载" : "内容号适合先建立信任",
          body: hasCreator
            ? "红人/内容号不一定完整展示 App，可信度来自真实语境：晨间、通勤、学习、播客、工作焦虑，再轻轻带出工具。"
            : "如果缺少红人样本，初期可以用内容运营号验证观点和书名，先看收藏、评论和关注，再升级产品露出。"
        },
        {
          title: hasOfficial ? "官方号负责把 UI 证明讲清楚" : "官方号需要补 UI 证明",
          body: hasOfficial
            ? "官方/品牌号适合承担导入、播放、阅读、统计、目标等链路证明，让用户相信功能真的能完成。"
            : "如果官方号样本不足，应优先补真实 App 录屏，用界面路径证明承诺。"
        }
      ],
      pitfalls: []
    };
  }

  function buildMusicLessons(videos, topScriptType, topApp) {
    const hasOfficial = videos.some((video) => /官方|品牌/.test(video.accountType));
    const hasCreator = videos.some((video) => /红人|内容/.test(video.accountType));
    return {
      reusable: [
        {
          title: `${topScriptType} 是当前最大公约数`,
          body: `当前样本里「${topScriptType}」最多。音乐产品应先让用户看到品味表达、好友关系或现场反应，再解释功能。`
        },
        {
          title: "音乐品味本身就是社交资产",
          body: "音乐社交产品最有传播力的不是播放器能力，而是“谁在听什么”“我们是否同频”“我的歌单说明了什么”。"
        },
        {
          title: "数据要变成可分享的人格名片",
          body: "听歌统计、阶段回顾和排行榜只有变成身份表达、好友比较或评论话题，才不只是数据面板。"
        },
        {
          title: hasCreator ? "创作者先用具体歌曲和反应抓人" : "需要补充真实听歌场景",
          body: hasCreator
            ? "创作者内容优先出现具体歌曲、歌手、场景和表情反应，App 在中后段承担查看动态、分享或匹配的动作。"
            : "缺少创作者样本时，应补充聚会、通勤、机场、校园和现场点歌等真实听歌场景。"
        },
        {
          title: hasOfficial ? "官方号负责证明关键社交动作" : "官方号需要补产品路径证明",
          body: hasOfficial
            ? "官方号适合清楚展示好友动态、音乐匹配、数据回顾、歌曲分享和点歌控制的完整路径。"
            : `当前以 ${topApp} 等样本为主，仍需补真实 UI 录屏证明从音乐内容到社交结果的路径。`
        }
      ],
      pitfalls: []
    };
  }

  function buildGenericLessons(videos, topScriptType, topApp) {
    const hasOfficial = videos.some((video) => /官方|品牌/.test(video.accountType));
    const hasCreator = videos.some((video) => /红人|内容/.test(video.accountType));
    return {
      reusable: [
        { title: `${topScriptType} 是当前最大公约数`, body: `当前样本里「${topScriptType}」占比最高，应提炼它使用的真实场景、可见动作和结果反馈，而不是套用固定行业话术。` },
        { title: "先展示结果，再解释产品机制", body: "用户先理解使用后发生什么，再看功能路径，通常比从首页开始讲解更容易停留。" },
        { title: "功能必须绑定具体场景", body: "每个功能都要回答谁在什么时刻使用、完成什么动作、得到什么结果。" },
        { title: hasCreator ? "创作者负责建立真实语境" : "需要补充创作者视角", body: hasCreator ? "创作者优先讲经历、反应和结果，产品只承担关键动作。" : "可以用真实用户体验和生活场景补足内容信任。" },
        { title: hasOfficial ? "官方号负责产品证明" : "官方号需要补 UI 证明", body: hasOfficial ? "官方号应把关键操作和结果页讲清楚。" : `当前以 ${topApp} 等样本为主，需要补充真实产品路径。` }
      ],
      pitfalls: []
    };
  }

  function enrichVideoTypeItems(items = [], context = {}) {
    return items.map((item) => enrichVideoTypeItem(item, context));
  }

  function enrichVideoTypeItem(item = {}, { categoryLabel = "垂类", role = "app", profile = resolveVerticalVideoProfile({ label: categoryLabel }) } = {}) {
    const scenes = normalizeScenes(item.scenes?.length ? item.scenes : buildDefaultScenes(item, role, profile));
    const bgm = normalizeText(item.bgm || inferBgmType(item, role, profile));
    const topic = normalizeText(item.topic || item.title || `${categoryLabel}视频选题`);
    const account = normalizeText(item.account || (role === "app" ? "官方 App 号" : "网红&内容号"));
    const videoScriptPrompt = normalizeText(item.videoScriptPrompt || item.fullScript) || buildVideoScriptPrompt({
      ...item,
      account,
      topic,
      bgm,
      scenes,
      analysisContext: profile.promptContext
    });
    return {
      ...item,
      account,
      topic,
      bgm,
      scenes,
      scriptSummary: normalizeText(item.scriptSummary || item.script),
      visualSummary: normalizeText(item.visualSummary || item.visual),
      videoScriptPrompt,
      fullScript: videoScriptPrompt
    };
  }

  function buildDefaultScenes(item = {}, role = "app", profile = {}) {
    if (profile.id === "music-social") return buildMusicDefaultScenes(item, role);
    if (profile.id === "reading") return buildReadingDefaultScenes(item, role);
    const script = normalizeText(item.script);
    const visual = normalizeText(item.visual);
    if (role === "app") {
      return [
        { time: "0-3s", visual: "先展示用户问题或使用后的结果，配一句清晰大字标题。", line: firstSentence(script) || "先看这个场景里，产品到底解决了什么。" },
        { time: "3-8s", visual: visual || "切到真实 App 界面，展示进入核心功能的第一步。", line: "直接看实际操作，不先罗列功能。" },
        { time: "8-18s", visual: "连续录屏展示 2-3 个关键步骤和即时反馈。", line: script || "完成关键动作后，结果马上出现在界面上。" },
        { time: "18-27s", visual: "展示结果页、分享页或下一步入口，强化使用后的变化。", line: "这个结果才是用户真正愿意留下来的原因。" },
        { time: "27-33s", visual: "回到产品入口或下载/试用 CTA，保留核心关键词。", line: "想解决同样的问题，可以从这个功能开始。" }
      ];
    }
    return [
      { time: "0-3s", visual: "真人/生活场景开场，配大字标题，不急着露 App。", line: firstSentence(script) || "我最近发现一个很反直觉的办法。" },
      { time: "3-10s", visual: "用字幕和近景讲清具体困惑，画面保持真实生活感。", line: script || "问题不是你不努力，而是之前的方法不适合这个场景。" },
      { time: "10-20s", visual: visual || "插入真实使用过程、前后变化或结果画面。", line: "真正有用的是这个具体动作和它带来的结果。" },
      { time: "20-28s", visual: "轻露产品界面或关键动作，保持体验分享口吻。", line: "我用的就是这个功能，几步就能完成。" },
      { time: "28-35s", visual: "评论、收藏或主页 CTA，避免硬广口吻。", line: "遇到同样情况，可以先收藏下来试一次。" }
    ];
  }

  function buildReadingDefaultScenes(item = {}, role = "app") {
    const script = normalizeText(item.script);
    const visual = normalizeText(item.visual);
    return role === "app"
      ? [
          { time: "0-3s", visual: "大字标题点出阅读痛点或学习结果。", line: firstSentence(script) || "没时间读完，也可以先抓住核心观点。" },
          { time: "3-8s", visual: visual || "切到书籍详情、章节或任务入口。", line: "直接看 App 里怎么完成这次阅读。" },
          { time: "8-18s", visual: "展示选择内容、播放/阅读、收藏和进度反馈。", line: script || "先听摘要，再保存真正有用的观点。" },
          { time: "18-27s", visual: "展示完成状态、书架或下一步推荐。", line: "把一次阅读变成可以持续的小进度。" },
          { time: "27-33s", visual: "回到产品入口或试用 CTA。", line: "今天先从最想解决的问题开始。" }
        ]
      : [
          { time: "0-3s", visual: "真人或生活场景配观点大字。", line: firstSentence(script) || "这本书解决的不是知识问题，而是一个具体困惑。" },
          { time: "3-10s", visual: "讲清困惑和反常识观点。", line: script || "先把问题说具体，再给出书里的关键解释。" },
          { time: "10-20s", visual: visual || "插入书封、笔记和使用场景。", line: "把观点落成一个今天能执行的动作。" },
          { time: "20-28s", visual: "轻露书单、摘要或产品承接。", line: "需要完整脉络时，再进入对应内容。" },
          { time: "28-35s", visual: "收藏或评论 CTA。", line: "先收藏，下一次遇到这个问题再回来。" }
        ];
  }

  function buildMusicDefaultScenes(item = {}, role = "app") {
    const script = normalizeText(item.script);
    const visual = normalizeText(item.visual);
    return role === "app"
      ? [
          { time: "0-3s", visual: "先展示一首具体歌曲、好友反应或听歌结果。", line: firstSentence(script) || "原来朋友现在正在听这首歌。" },
          { time: "3-8s", visual: visual || "切到好友动态、音乐匹配、统计或点歌入口。", line: "打开 App，直接看到这次音乐互动。" },
          { time: "8-18s", visual: "录屏展示查看、匹配、分享或控制播放的关键步骤。", line: script || "从一首歌进入好友动态，再完成互动。" },
          { time: "18-27s", visual: "展示好友回应、匹配结果、数据卡片或现场播放结果。", line: "音乐不只是播放内容，也变成了社交线索。" },
          { time: "27-33s", visual: "回到分享或下载入口。", line: "想看看朋友都在听什么，可以从这里开始。" }
        ]
      : [
          { time: "0-3s", visual: "具体歌曲、歌手或夸张反应开场。", line: firstSentence(script) || "这首歌暴露了我最近的全部状态。" },
          { time: "3-10s", visual: "用真人反应和字幕讲清听歌场景。", line: script || "先说为什么这首歌和这个时刻有关。" },
          { time: "10-20s", visual: visual || "展示歌单、好友动态、统计卡片或现场画面。", line: "再让产品承担查看、记录或分享的动作。" },
          { time: "20-28s", visual: "轻露 App 结果页，回到人物关系或情绪结果。", line: "真正抓人的是音乐带来的身份和关系表达。" },
          { time: "28-35s", visual: "用歌曲推荐、评论或分享 CTA 收尾。", line: "你最近循环的是哪一首？" }
        ];
  }

  function normalizeScenes(scenes = []) {
    return scenes.map((scene, index) => ({
      time: normalizeText(scene.time || scene.duration || `${index * 6}-${index * 6 + 6}s`),
      visual: normalizeText(scene.visual || scene.shot || scene.picture || scene.frame),
      line: normalizeText(scene.line || scene.dialogue || scene.voiceover || scene.copy)
    })).filter((scene) => scene.visual || scene.line);
  }

  function inferBgmType(item = {}, role = "app", profile = {}) {
    const text = normalizeText([item.title, item.script, item.visual, ...(item.badges || [])].join(" "));
    if (profile.id === "music-social") return "优先使用视频涉及的真实歌曲或同风格音轨，让音乐内容本身参与叙事，同时保证字幕可读";
    if (/挑战|Day|任务|计划|系列/.test(text)) return "轻快、有节奏的 pop / study beats，适合做连续打卡感";
    if (/痛点|刷屏|拖延|读不完|焦虑/.test(text)) return "前 3 秒轻微 tension，随后转 calm beat 或 lo-fi";
    if (role === "creator") return "低侵入 lo-fi / acoustic / lifestyle vlog BGM，音量压低突出人声";
    return "干净的 tech / minimal pop / lo-fi study beat，节奏稳定不抢 UI 录屏";
  }

  function buildVideoScriptPrompt(item = {}) {
    const sceneRequirements = (item.scenes || []).map((scene, index) => [
      `${index + 1}. ${scene.time || ""}`.trim(),
      `   分镜画面方向：${scene.visual || "待补充画面"}`,
      `   台词/字幕方向：${scene.line || "待补充台词"}`
    ].join("\n")).join("\n");
    return [
      "你是短视频广告脚本策划，请基于下面的素材方向，生成一条可以直接进入生产环节的竖屏短视频脚本。",
      "",
      "【基础信息】",
      `- 垂类分析语境：${item.analysisContext || "只基于当前垂类和输入事实，不引入其他行业模板。"}`,
      `- 视频类型：${item.title || "未命名视频类型"}`,
      `- 适合账号类型：${item.account || "未标注账号"}`,
      `- 主题：${item.topic || item.title || "未标注主题"}`,
      `- 适用 BGM 类型：${item.bgm || "轻节奏背景音乐，音量低于人声"}`,
      `- 核心钩子方向：${item.script || item.scriptSummary || "用一个具体痛点切入，再给出可执行动作。"}`,
      `- 画面风格方向：${item.visual || item.visualSummary || "真实场景 + 清晰字幕 + 少量产品或结果画面。"}`,
      "",
      "【分镜方向】",
      sceneRequirements,
      "",
      "【请输出】",
      "1. 视频标题（≤18字）",
      "2. 适合账号类型",
      "3. 目标用户/使用场景",
      "4. BGM 建议",
      "5. 完整分镜表：时间段、画面描述、镜头/素材、屏幕文字、口播/台词",
      "6. 结尾 CTA（根据账号类型选择：下载试用 / 评论关键词 / 收藏 / 主页领取）",
      "7. 拍摄与剪辑备注",
      "",
      "【约束】",
      "- 竖屏 9:16，建议 25-35 秒。",
      "- 前 1 秒必须有大字标题或强钩子。",
      "- 台词要自然，避免产品说明书口吻。",
      "- App 账号可以更强 UI 录屏和结果页；网红/内容号先建立真实语境，再轻露产品。",
      "- 不要只复述上面的方向，要产出可直接拍摄/剪辑的具体脚本。"
    ].join("\n");
  }

  function firstSentence(value) {
    return normalizeText(value).split(/[。！？.!?]/).find((item) => normalizeText(item).length >= 6) || "";
  }

  function buildReadingAppAccountVideoTypes() {
    return [
      {
        title: "产品路径证明",
        script: "通勤前打开一本书，先听 3 分钟摘要；坐下后切回文字，把关键观点保存下来。",
        account: "官方 App 号",
        visual: "真实 App 录屏：书籍详情、章节结构、播放条、阅读页、收藏或进度反馈。",
        badges: ["功能证明", "强 App 露出", "转化承接"]
      },
      {
        title: "替代刷屏任务",
        script: "今天别把睡前 10 分钟交给短视频，打开一个 10 分钟学习任务，听完一本书的核心观点。",
        account: "官方 App 号",
        visual: "刷短视频场景对比 App 内每日任务、完成状态、下一本推荐。",
        badges: ["强痛点", "可投放", "任务感"]
      },
      {
        title: "主题书单挑战",
        script: "7 天让表达更清楚：Day 1《How to Talk to Anyone》，Day 2《Crucial Conversations》……",
        account: "官方 App 号",
        visual: "App 内书架、每日计划、书籍卡片和完成进度串起来。",
        badges: ["书库驱动", "系列化", "易收藏"]
      },
      {
        title: "具体人群功能演示",
        script: "如果你读不完长书，先别硬啃原文；用摘要、音频和章节结构抓住这本书的主线。",
        account: "官方 App 号",
        visual: "围绕读不完、通勤、注意力不集中等场景展示对应功能路径。",
        badges: ["人群明确", "UI 证明", "中后期投放"]
      }
    ];
  }

  function buildReadingCreatorContentVideoTypes() {
    return [
      {
        title: "一本书解决一个具体困惑",
        script: "为什么你知道该改变，却总是坚持不到第三天？《Atomic Habits》给的答案不是更努力，而是先改环境。",
        account: "网红&内容号",
        visual: "标题大字 + 静态生活画面 + 书封面 + 字幕声波，先推荐观点和书。",
        badges: ["不硬广", "适合日更", "可接书库封面"]
      },
      {
        title: "观点反常识短视频",
        script: "你以为拖延是懒，其实很多时候是任务太模糊。先把行动缩小到 2 分钟。",
        account: "网红&内容号",
        visual: "文字帧为主，配少量静态生活画面和书封面；产品只在主页或评论承接。",
        badges: ["低制作成本", "建立账号心智", "适合 A/B 测试"]
      },
      {
        title: "生活方式轻挂载",
        script: "我最近把早上刷手机的 10 分钟换成听一本书的摘要，最明显的变化是开会时更容易说出重点。",
        account: "网红号",
        visual: "晨间、通勤、咖啡、笔记等真实场景，不必重 UI；结尾轻露工具或书单。",
        badges: ["信任感", "弱产品露出", "适合 UGC"]
      },
      {
        title: "评论领书单",
        script: "如果你最近想提升表达，评论 keyword，我把这 5 本书的顺序发你。",
        account: "内容号",
        visual: "书单卡片、评论关键词、收藏提示，重点放在互动和选题验证。",
        badges: ["评论钩子", "需求验证", "易收藏"]
      }
    ];
  }

  function buildMusicAppAccountVideoTypes() {
    return [
      {
        title: "好友实时听歌动态",
        script: "打开 App 就看到朋友此刻正在听什么，从一首具体歌曲进入点赞、回复或分享。",
        account: "官方 App 号",
        visual: "真实录屏展示好友 feed、小组件、歌曲卡片和互动入口。",
        badges: ["音乐社交", "实时动态", "强产品证明"]
      },
      {
        title: "音乐品味匹配同好",
        script: "先展示两个音乐品味相近的人认识后的结果，再回到 App 解释如何完成匹配。",
        account: "官方 App 号",
        visual: "匹配结果、共同歌手/歌曲、聊天入口和关系结果交叉剪辑。",
        badges: ["关系结果", "品味匹配", "社交转化"]
      },
      {
        title: "听歌数据人格卡",
        script: "把本周循环歌曲、Top Artist 或阶段性听歌偏好做成一张可以分享和比较的音乐名片。",
        account: "官方 App 号",
        visual: "统计页、回顾卡片、好友比较和分享成品连续展示。",
        badges: ["数据可视化", "身份表达", "可分享"]
      },
      {
        title: "线下点歌结果证明",
        script: "从酒吧、台球厅或聚会现场的一首歌和人物反应开场，再展示手机点歌与播放结果。",
        account: "官方 App 号",
        visual: "现场反应、点歌界面、播放队列和成功播放画面。",
        badges: ["真实场景", "即时反馈", "线下转化"]
      }
    ];
  }

  function buildMusicCreatorContentVideoTypes() {
    return [
      {
        title: "我的音乐人格暴露",
        script: "用一首最近疯狂循环的歌或一份离谱歌单讲自己的状态，让听歌习惯成为人格笑点。",
        account: "网红&内容号",
        visual: "真人反应、大字字幕、具体歌曲和轻量听歌动态截图。",
        badges: ["自我暴露", "音乐品味", "评论共鸣"]
      },
      {
        title: "遇到同频朋友的结果剧情",
        script: "先演出因为喜欢同一首歌而认识、聊天或关系升温的结果，再轻带音乐社交 App。",
        account: "网红&内容号",
        visual: "双人互动、共同歌曲字幕和少量匹配/好友动态界面。",
        badges: ["关系剧情", "弱产品露出", "适合 UGC"]
      },
      {
        title: "歌曲求推荐互动",
        script: "给出一首具体歌曲或氛围，直接问大家还有哪些相似歌曲，把评论区变成推荐池。",
        account: "音乐内容号",
        visual: "歌曲片段、氛围场景、评论截图和收藏提示。",
        badges: ["评论钩子", "歌曲发现", "高收藏"]
      },
      {
        title: "现场点歌反应梗",
        script: "用“到底是谁点了这首歌”的反应剧情制造笑点，产品只作为现场事件的触发器。",
        account: "网红&内容号",
        visual: "现场人物反应、歌曲响起和极短点歌界面。",
        badges: ["反应剧情", "平台感", "轻功能挂载"]
      }
    ];
  }

  function buildGenericAppAccountVideoTypes(categoryLabel, topScriptType) {
    return [
      {
        title: `${categoryLabel}产品路径证明`,
        script: `先说出一个高频 ${categoryLabel} 场景，再展示 App 内完成这个动作的路径和结果。`,
        account: "官方 App 号",
        visual: "真实界面录屏、关键按钮、结果反馈和转化入口。",
        badges: ["功能证明", "强 App 露出", topScriptType]
      }
    ];
  }

  function buildGenericCreatorContentVideoTypes(categoryLabel, topScriptType) {
    return [
      {
        title: `${categoryLabel}真实场景口播`,
        script: `从一个真实生活场景切入，说出用户为什么会遇到这个问题，再给一个低门槛动作。`,
        account: "网红&内容号",
        visual: "生活场景、字幕大字、少量产品或结果画面，弱转化。",
        badges: ["内容信任", "轻产品露出", topScriptType]
      }
    ];
  }

  function topCounts(values, limit) {
    const counts = new Map();
    for (const value of values) {
      const text = normalizeText(value) || "未标注";
      counts.set(text, (counts.get(text) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"))
      .slice(0, limit);
  }

  function topAppCounts(videos, limit, appLogoIndex = new Map()) {
    const counts = new Map();
    for (const video of videos) {
      const label = normalizeText(video.appName) || "未标注 App";
      const current = counts.get(label) || { label, count: 0, logoUrl: "" };
      current.count += 1;
      current.logoUrl ||= normalizeText(video.appLogoUrl) || appLogoIndex.get(normalizeAppName(label)) || "";
      counts.set(label, current);
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-CN"))
      .slice(0, limit);
  }

  function buildAppLogoIndex(apps = []) {
    const index = new Map();
    for (const app of apps) {
      const logoUrl = normalizeText(app.logoUrl || app.artworkUrl || app.iconUrl);
      if (!logoUrl) continue;
      normalizeStringArray([app.name, app.fullName, app.appName])
        .map(normalizeAppName)
        .filter(Boolean)
        .forEach((name) => index.set(name, logoUrl));
    }
    return index;
  }

  function normalizeText(value) {
    return deps.normalizeText(value);
  }

  function truncateText(value, maxLength) {
    return deps.truncateText(value, maxLength);
  }

  return {
    buildVerticalVideoCategoryIndex,
    buildVerticalVideoCategoryReport,
    analyzeVerticalVideoCategory
  };
}

function buildSourceHash(videos, profile = {}) {
  const material = [
    `profile:${profile.id || "generic"}@${profile.version || 1}`,
    ...videos.map((item) => [
    item.id,
    item.baseAnalysisHash,
    item.scriptType,
    item.hasBaseAnalysis ? "ready" : "pending"
    ].join("|"))
  ].join("\n");
  return hashId(material);
}
