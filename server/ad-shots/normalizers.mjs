import {
  firstNonEmptyVisualTextSegmentsWithNormalizer
} from "./visual-text.mjs";

export function normalizeAdShotRecord(shot, projects = [], options = {}) {
  const normalizeVisualTextSegments = typeof options.normalizeVisualTextSegments === "function"
    ? options.normalizeVisualTextSegments
    : defaultNormalizeVisualTextSegments;
  const normalized = {
    projectIds: [],
    projectNames: [],
    projects: [],
    status: "",
    highlight: "",
    appName: "",
    appDisplay: "",
    adCaption: "",
    landingPage: "",
    rawBrandName: "",
    transcriptOriginal: "",
    readableTitle: "",
    storySummary: "",
    category: "",
    regionLabel: "",
    sourceDisplay: "",
    ...shot
  };
  normalized.projectIds = resolveAdShotProjectIds(normalized, projects);
  normalized.projectNames = normalizeProjectNames(normalized.projectIds
    .map((projectId) => projects.find((project) => project.id === projectId)?.name || "")
    .filter(Boolean));
  normalized.projects = normalized.projectNames;
  normalized.rawBrandName = normalizeText(normalized.rawBrandName || normalized.brandName);
  normalized.transcriptOriginal = normalizeText(normalized.transcriptOriginal || normalized.transcript_original || normalized.transcriptEn || normalized.transcript_en);
  const canonicalAppName = normalizeText(normalized.app?.name || normalized.app?.fullName);
  const landingPageAppName = normalizeText(normalized.appMatchSource || normalized.app_match_source) === "landing-page"
    ? normalizeText(normalized.appMatchQuery || normalized.app_match_query)
    : "";
  normalized.appName = canonicalAppName || normalizeText(normalized.appName || normalized.brandName || landingPageAppName);
  normalized.appId = normalizeText(normalized.appId || normalized.app?.id);
  normalized.appDisplay = normalizeAdShotAppDisplay(canonicalAppName || normalized.appName);
  normalized.landingPage = normalizeText(normalized.landingPage || normalized.landing_page || normalized.raw?.landingPage);
  normalized.adCaption = normalizeText(
    normalized.adCaption
    || normalized.ad_caption
    || normalized.raw?.adCaption
    || normalized.title
  );
  normalized.category = normalizeAdShotCategory(normalized);
  normalized.regionLabel = normalizeAdShotRegionLabel(normalized);
  normalized.sourceDisplay = normalizeAdShotSourceDisplay(normalized);
  normalized.status = normalizeAdShotStatus(normalized);
  normalized.sourceType = normalizeAdShotSourceType(normalized);
  normalized.sourceItemId = normalizeText(normalized.sourceItemId || normalized.source_item_id || normalized.sourceAdId || normalized.videoId);
  normalized.canonicalUrl = normalizeText(normalized.canonicalUrl || normalized.canonical_url || normalized.sourceUrl);
  normalized.authorName = normalizeText(normalized.authorName || normalized.author_name || normalized.raw?.author || normalized.raw?.advertiser || normalized.brandName);
  normalized.authorAvatarUrl = normalizeText(normalized.authorAvatarUrl || normalized.author_avatar_url || normalized.authorAvatar || normalized.avatarUrl || normalized.profileImageUrl || normalized.raw?.authorAvatarUrl || normalized.raw?.authorAvatar || normalized.raw?.avatarUrl || normalized.raw?.profileImageUrl || normalized.raw?.author?.avatarUrl || normalized.raw?.author?.avatarThumb || normalized.raw?.authorStats?.avatarUrl);
  normalized.accountAvatarUrl = normalizeText(normalized.accountAvatarUrl || normalized.account_avatar_url || normalized.raw?.accountAvatarUrl);
  normalized.followerCount = firstNumeric(normalized.followerCount, normalized.follower_count, normalized.followers, normalized.fansCount, normalized.fans_count, normalized.authorFollowerCount, normalized.author_follower_count, normalized.authorFollowers, normalized.author_followers, normalized.raw?.followerCount, normalized.raw?.followers, normalized.raw?.fansCount, normalized.raw?.authorFollowerCount, normalized.raw?.authorFollowers, normalized.raw?.author?.followerCount, normalized.raw?.author?.followers, normalized.raw?.authorStats?.followerCount, normalized.raw?.authorStats?.followers);
  normalized.createdAt = normalizeText(normalized.createdAt || normalized.created_at || normalized.capturedAt);
  normalized.media = normalizeAdShotMedia(normalized);
  normalized.metrics = normalizeAdShotMetrics(normalized);
  normalized.analysis = normalizeAdShotAnalysis(normalized);
  normalized.topAds = normalizeAdShotTopAds(normalized);
  normalized.visualTextSegments = firstNonEmptyVisualTextSegmentsWithNormalizer(
    normalizeVisualTextSegments,
    Number(normalized.duration) || null,
    normalized.visualTextSegments,
    normalized.visual_text_segments,
    normalized.analysisSummary?.visualTextSegments
  );
  if (!normalized.onScreenTextOriginal && normalized.visualTextSegments[0]?.original) {
    normalized.onScreenTextOriginal = normalized.visualTextSegments[0].original;
  }
  if (!normalized.onScreenTextZh && normalized.visualTextSegments[0]?.zh) {
    normalized.onScreenTextZh = normalized.visualTextSegments[0].zh;
  }
  if (!normalized.raw || typeof normalized.raw !== "object") {
    normalized.raw = {};
  }
  if (!normalized.raw.landingPage && normalized.landingPage) {
    normalized.raw.landingPage = normalized.landingPage;
  }
  if (!normalized.raw.adCaption && normalized.adCaption) {
    normalized.raw.adCaption = normalized.adCaption;
  }
  normalized.analysis = normalizeAdShotAnalysis(normalized);
  normalized.highlight = buildAdShotHighlight(normalized);
  normalized.storySummary = buildAdShotStorySummary(normalized);
  normalized.readableTitle = buildAdShotReadableTitle(normalized);
  return normalized;
}

export function getAdShotAnalysisBundle(shot = {}) {
  return mergeAdShotAnalysis(
    shot.analysisSummary && typeof shot.analysisSummary === "object" ? shot.analysisSummary : {},
    shot.analysis && typeof shot.analysis === "object" ? shot.analysis : {}
  );
}

export function resolveAdShotProjectIds(shot, projects = []) {
  const projectIds = new Set(projects.map((project) => project.id));
  return Array.from(new Set(normalizeStringArray(
    shot.projectIds || shot.project_ids || shot.projectId || shot.project_id
  ).filter((projectId) => projectIds.has(projectId))));
}

export function isReadingProject(project) {
  return /听书|有声|阅读|书摘|图书|读书|知识|学习|audiobook|audio book|book|reading|summary|learning|knowledge/i.test(projectSearchText(project));
}

export function adShotIndustryKey(shot) {
  return normalizeText(shot.industryKey || shot.industry_key || shot.category || shot.industryLabel)
    .replace(/^label_/, "");
}

export function adShotSearchText(shot) {
  return normalizeText([
    shot.title,
    shot.readableTitle,
    shot.app?.name,
    shot.app?.fullName,
    shot.app?.bundleId,
    shot.appName,
    shot.appDisplay,
    shot.brandName,
    shot.rawBrandName,
    shot.targetApp,
    shot.projectName,
    Array.isArray(shot.projects) ? shot.projects.join(" ") : "",
    Array.isArray(shot.projectNames) ? shot.projectNames.join(" ") : "",
    shot.industryLabel,
    shot.category,
    shot.raw?.rawCandidate?.rawText
  ].filter(Boolean).join(" ")).toLowerCase();
}

export function isReadingAdShot(shot) {
  const text = adShotSearchText(shot);
  const key = adShotIndustryKey(shot);
  return /听书|有声书|阅读|读书|书摘|图书|知识|bookly|headway|wiser|book|books|reading|audiobook|audio book|book summary|summaries|micro learning|self[- ]?growth|bite[- ]?sized learning|learning english/i.test(text)
    || (["20104000000", "20102000000"].includes(key) && /book|read|learn|headway|wiser|bookly|summary|growth|知识|学习|阅读|书/i.test(text));
}

export function isSocialAdShot(shot) {
  const text = adShotSearchText(shot);
  return adShotIndustryKey(shot) === "20100000000" || /社交|交友|dating|friends?|bereal|social/i.test(text);
}

export function normalizeAdShotCategory(shot) {
  const text = normalizeText(shot.category || shot.industryLabel || shot.industryKey);
  if (!text) {
    return "全部行业";
  }
  const key = text.replace(/^label_/, "");
  if (isReadingAdShot(shot)) {
    return "阅读/听书";
  }
  const industryLabels = {
    "20100000000": "社交",
    "20102000000": "教育/学习",
    "20104000000": "图书/阅读"
  };
  return industryLabels[key] || key;
}

export function normalizeAdShotRegionLabel(shot) {
  const regions = normalizeStringArray(shot.countryCode || shot.regions || shot.filters?.regions);
  if (!regions.length) {
    return "全部地区";
  }
  const regionLabels = {
    AU: "澳大利亚",
    CA: "加拿大",
    DE: "德国",
    ES: "西班牙",
    FR: "法国",
    GB: "英国",
    IT: "意大利",
    JP: "日本",
    KR: "韩国",
    NL: "荷兰",
    SE: "瑞典",
    SG: "新加坡",
    US: "美国"
  };
  return regions.map((region) => regionLabels[region] || region).join(" / ");
}

export function isTikTokDetailSourceKey(value) {
  const raw = normalizeText(value).toLowerCase();
  const key = raw.replace(/[-\s]+/g, "_");
  return [
    "tiktok",
    "tiktok_detail",
    "tiktok_video",
    "tiktok_video_detail",
    "tiktok_photo",
    "tiktok_photo_detail"
  ].includes(key) || /tiktok.*详情/.test(raw);
}

export function normalizeAdShotSourcePlatform(source = {}) {
  const raw = typeof source === "string"
    ? source
    : source.sourcePlatform
      || source.source_platform
      || source.platform
      || source.captureContext
      || source.capture_context
      || source.sourceLabel
      || source.source_label
      || source.source
      || "";
  const key = normalizeText(raw).toLowerCase().replace(/[-\s]+/g, "_");
  if (isTikTokDetailSourceKey(key)) {
    return "tiktok";
  }
  if (!key || key.includes("creative_center") || key.includes("topads") || key === "ttcc") {
    return "tiktok_creative_center";
  }
  return key;
}

export function normalizeAdShotSourceDisplay(shot) {
  const raw = normalizeText(shot.sourceLabel || shot.source || shot.sourceDisplay || shot.sourceKey || shot.sourcePlatform);
  const key = raw.toLowerCase();
  if (isTikTokDetailSourceKey(key)) {
    return "TikTok 详情页";
  }
  if (!raw || key === "tiktok_creative_center") {
    return "TTCC";
  }
  const sourceLabels = {
    "8": "未细分来源",
    others: "未细分来源",
    spark_ads: "Spark Ads",
    "spark ads": "Spark Ads",
    advertiser_uploaded: "广告主上传",
    "advertiser uploaded": "广告主上传"
  };
  return sourceLabels[key] || raw;
}

export function getAdShotObjectiveInfo(shot) {
  const raw = normalizeText(shot.objectiveKey || shot.objective || shot.objectiveLabel);
  const key = raw.toLowerCase();
  const objectiveLabels = {
    campaign_objective_traffic: "引流（Traffic）",
    traffic: "引流（Traffic）",
    campaign_objective_conversion: "转化（Conversion）",
    conversion: "转化（Conversion）",
    campaign_objective_app_install: "应用安装",
    app_install: "应用安装",
    campaign_objective_reach: "触达",
    reach: "触达",
    campaign_objective_video_view: "视频观看",
    video_view: "视频观看",
    campaign_objective_lead_generation: "线索收集",
    lead_generation: "线索收集"
  };
  return {
    label: objectiveLabels[key] || raw || "未采集到",
    note: key === "campaign_objective_traffic" || key === "traffic"
      ? "TTCC 原始值是 Traffic，含义是把用户引导到落地页、应用页或外部链接。"
      : raw ? `TTCC 原始值：${raw}` : ""
  };
}

export function getAdShotSourceInfo(shot) {
  const rawSource = normalizeText(shot.sourceLabel || shot.source || shot.sourceDisplay);
  const sourceKey = normalizeText(shot.sourceKey);
  const raw = rawSource || sourceKey || normalizeText(shot.sourcePlatform);
  const key = raw.toLowerCase();
  if (isTikTokDetailSourceKey(key)) {
    return { label: "TikTok 详情页", note: "来源来自普通 TikTok 视频详情页，不包含 TikTok Creative Center 的投放排名、CTR 或预算数据。" };
  }
  if (!raw || key === "tiktok_creative_center") {
    return { label: "TTCC", note: "来源来自 TikTok Creative Center。" };
  }
  if (key === "others" || sourceKey === "8") {
    return {
      label: "平台未细分来源",
      note: "TikTok Creative Center 原始值是 Others，sourceKey 是 8。平台没有公开它是 Spark Ads、广告主上传，还是其他更细来源，所以这里只能标记为未细分来源。"
    };
  }
  if (["spark_ads", "spark ads"].includes(key)) {
    return {
      label: "Spark Ads",
      note: "通常指用创作者原生视频授权投放的广告。"
    };
  }
  if (["advertiser_uploaded", "advertiser uploaded"].includes(key)) {
    return {
      label: "广告主上传",
      note: "通常指广告主直接上传到广告系统的素材。"
    };
  }
  return {
    label: raw,
    note: rawSource && sourceKey ? `TTCC 原始值：${rawSource} / sourceKey ${sourceKey}` : ""
  };
}

export function buildAdShotPerformanceItems(shot, metrics = {}) {
  const performance = shot.raw?.performance && typeof shot.raw.performance === "object" ? shot.raw.performance : {};
  const like = normalizeNullableCount(performance.like ?? shot.like ?? metrics.like);
  const comment = normalizeNullableCount(performance.comment ?? shot.comment ?? metrics.comment);
  const share = normalizeNullableCount(performance.share ?? performance.forward ?? shot.share ?? metrics.forward ?? metrics.share);
  const view = normalizeNullableCount(performance.view ?? shot.view ?? metrics.view);
  if (normalizeAdShotSourcePlatform(shot) === "tiktok") {
    return [
      { label: "点赞", value: formatAdShotMetricCount(like) },
      { label: "评论", value: formatAdShotMetricCount(comment) },
      { label: "分享", value: formatAdShotMetricCount(share) },
      { label: "播放", value: formatAdShotMetricCount(view) }
    ];
  }
  const ctr = Number(performance.ctr ?? shot.ctr);
  const cost = performance.cost ?? shot.cost ?? null;
  return [
    { label: "点赞", value: formatAdShotMetricCount(like) },
    { label: "评论", value: formatAdShotMetricCount(comment) },
    { label: "转发", value: formatAdShotMetricCount(share) },
    { label: "CTR", value: formatAdShotCtrRank(ctr, shot.raw?.percentile) },
    { label: "预算", value: formatAdShotBudget(cost) }
  ];
}

export function getAdShotProductName(shot) {
  const raw = normalizeText(
    shot.app?.name
    || shot.app?.fullName
    || shot.appDisplay
    || shot.appName
    || shot.rawBrandName
    || shot.brandName
    || shot.title
  );
  if (!raw) {
    return "这款 App";
  }
  const firstPart = raw.split(/\s*[。.!！?？]\s*/).map((item) => normalizeText(item)).find(Boolean);
  return firstPart || raw;
}

export function formatAdShotDetailRegionLabel(shot) {
  const regions = normalizeStringArray(shot.countryCode || shot.regions || shot.filters?.regions);
  if (!regions.length) {
    return "全部地区";
  }
  const regionLabels = {
    AU: "澳大利亚",
    CA: "加拿大",
    DE: "德国",
    ES: "西班牙",
    FR: "法国",
    GB: "英国",
    IT: "意大利",
    JP: "日本",
    KR: "韩国",
    NL: "荷兰",
    SE: "瑞典",
    SG: "新加坡",
    US: "美国"
  };
  return regions.map((region) => {
    const code = normalizeText(region).toUpperCase();
    return regionLabels[code] ? `${regionLabels[code]} ${code}` : normalizeText(region);
  }).join(" / ");
}

export function buildAdShotHeroTitle(shot, analysis = {}, fallbackTitle = "Ad Shot") {
  const productName = getAdShotProductName(shot);
  const cardTitle = normalizeText(analysis.coreTitle || analysis.cardTitle || analysis.storyTitle || analysis.highlightTitle);
  if (cardTitle) {
    return cardTitle.includes(productName) ? cardTitle : `${productName}：${cardTitle}`;
  }
  const visualText = normalizeText(shot.onScreenTextZh || analysis.onScreenTextZh || analysis.visualTextZh);
  if (visualText) {
    return `${productName}：${truncateText(visualText, 42)}`;
  }
  return normalizeText(fallbackTitle) || "Ad Shot";
}

export function buildAdShotHeroSummary(shot, analysis = {}) {
  const summary = normalizeText(
    analysis.coreSummary
    || analysis.cardSummary
    || analysis.storySummary
    || analysis.productMechanism
    || buildAdShotStorySummary(shot)
  );
  return truncateText(summary || "等待分析后生成这条广告的剧情、产品机制和亮点。", 260);
}

export function buildAdShotInsightItems(shot, analysis = {}) {
  const hook = normalizeText(analysis.hook);
  const productMechanism = normalizeText(analysis.productMechanism);
  const cardSummary = normalizeText(analysis.coreSummary || analysis.cardSummary || buildAdShotStorySummary(shot));
  const scriptParagraphs = splitAdShotScriptIntoParagraphs(analysis.script);
  const productFeatures = normalizeStringArray(
    analysis.productFeatures
    || analysis.featureList
    || analysis.features
  );
  return [
    {
      label: "视频剧情",
      body: scriptParagraphs.length
        ? ""
        : truncateText(normalizeText(analysis.videoStory) || cardSummary || hook, 620),
      paragraphs: scriptParagraphs,
      items: []
    },
    {
      label: "产品 feature",
      items: productFeatures.length
        ? productFeatures
        : (productMechanism ? [productMechanism] : [])
    }
  ].map((item) => ({
    ...item,
    body: item.body || "",
    paragraphs: item.paragraphs?.length ? item.paragraphs : [],
    items: item.items?.length ? item.items : []
  }));
}

export function normalizeAdShotStatus(shot) {
  if (!canAnalyzeAdShot(shot)) {
    return "需补采";
  }
  if (shot.analysisStatus === "completed") {
    return "正常";
  }
  if (shot.analysisStatus === "queued") {
    return "排队中";
  }
  if (shot.analysisStatus === "running") {
    return "分析中";
  }
  if (shot.analysisStatus === "failed") {
    return "失败";
  }
  return "待分析";
}

export function canAnalyzeAdShot(shot = {}) {
  if (shot.videoPath) {
    return true;
  }
  return normalizeAdShotSourcePlatform(shot) === "tiktok" && Boolean(normalizeText(shot.sourceUrl));
}

export function buildAdShotHighlight(shot) {
  const analysis = getAdShotAnalysisBundle(shot);
  return truncateText(normalizeText(
    shot.highlight
    || analysis.highlight
    || analysis.hook
    || analysis.productMechanism
    || shot.title
    || shot.brandName
    || "等待分析后生成剧情和亮点。"
  ), 180);
}

export function buildAdShotStorySummary(shot) {
  const analysis = getAdShotAnalysisBundle(shot);
  const candidates = [
    analysis.storySummary,
    analysis.cardSummary,
    analysis.cardBody,
    shot.transcriptZh,
    analysis.productMechanism,
    shot.highlight,
    analysis.highlight,
    analysis.hook,
    summarizeAdShotScript(analysis.script)
  ];

  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (!text || /^等待/.test(text)) {
      continue;
    }
    return truncateText(text, 220);
  }
  return "等待分析后生成这条素材的剧情摘要。";
}

export function normalizeAdShotProjectTags(value) {
  const rawItems = typeof value === "string"
    ? value.split(/[,，、\n]/)
    : Array.isArray(value)
      ? value
      : [];
  return Array.from(new Set(rawItems
    .map((item) => truncateText(normalizeText(item), 40))
    .filter(Boolean)))
    .slice(0, 16);
}

function projectSearchText(project) {
  return normalizeText([project?.name, ...normalizeAdShotProjectTags(project?.tags)].join(" ")).toLowerCase();
}

function normalizeAdShotAppDisplay(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  const firstSentence = text.split(/\.\s+/)[0];
  return firstSentence && firstSentence.length <= 32 ? firstSentence : truncateText(text, 42);
}

function normalizeProjectNames(items) {
  return Array.from(new Set(normalizeStringArray(items))).slice(0, 12);
}

function normalizeAdShotSourceType(shot) {
  return normalizeAdShotSourcePlatform(shot) === "tiktok" ? "normal_tiktok_video" : "ttcc_top_ads";
}

function normalizeAdShotMedia(shot) {
  const imagePaths = [
    ...(Array.isArray(shot.imagePaths) ? shot.imagePaths : []),
    ...(Array.isArray(shot.image_paths) ? shot.image_paths : []),
    ...(Array.isArray(shot.analysisArtifacts?.imagePaths) ? shot.analysisArtifacts.imagePaths : [])
  ].map(normalizeText).filter(Boolean);
  return {
    videoPath: normalizeText(shot.videoPath || shot.video_path),
    posterPath: normalizeText(shot.posterPath || shot.poster_path),
    firstFramePath: normalizeText(shot.firstFramePath || shot.first_frame_path || shot.posterPath || shot.poster_path),
    imagePaths: Array.from(new Set(imagePaths)),
    width: Number(shot.width) || null,
    height: Number(shot.height) || null
  };
}

function normalizeAdShotMetrics(shot) {
  const performance = shot.raw?.performance && typeof shot.raw.performance === "object" ? shot.raw.performance : {};
  const metrics = shot.raw?.metrics && typeof shot.raw.metrics === "object" ? shot.raw.metrics : {};
  return {
    source: normalizeAdShotSourcePlatform(shot) === "tiktok" ? "tiktok_detail" : "ttcc_top_ads",
    likeCount: normalizeNullableCount(performance.like ?? shot.like ?? metrics.like),
    commentCount: normalizeNullableCount(performance.comment ?? shot.comment ?? metrics.comment),
    shareCount: normalizeNullableCount(performance.share ?? performance.forward ?? shot.share ?? metrics.forward ?? metrics.share),
    viewCount: normalizeNullableCount(performance.view ?? shot.view ?? metrics.view),
    ctrRank: formatAdShotCtrRank(performance.ctr ?? shot.ctr, shot.raw?.percentile),
    budget: formatAdShotBudget(performance.cost ?? shot.cost),
    cost: performance.cost ?? shot.cost ?? null,
    raw: Object.keys(performance).length ? performance : metrics
  };
}

function normalizeAdShotAnalysis(shot) {
  const analysis = getAdShotAnalysisBundle(shot);
  return {
    ...analysis,
    cardTitle: normalizeText(analysis.cardTitle || analysis.readableTitle || shot.readableTitle),
    cardSummary: normalizeText(analysis.cardSummary || analysis.storySummary || shot.storySummary),
    visualTextSegments: Array.isArray(analysis.visualTextSegments) ? analysis.visualTextSegments : shot.visualTextSegments || []
  };
}

function normalizeAdShotTopAds(shot) {
  if (normalizeAdShotSourcePlatform(shot) === "tiktok") {
    return null;
  }
  const objectiveInfo = getAdShotObjectiveInfo(shot);
  return {
    countryCode: normalizeStringArray(shot.countryCode || shot.country_code),
    industryKey: adShotIndustryKey(shot),
    industryLabel: normalizeAdShotCategory(shot),
    objectiveKey: normalizeText(shot.objectiveKey || shot.objective_key),
    landingPage: normalizeText(shot.landingPage || shot.landing_page || shot.raw?.landingPage),
    objectiveLabel: objectiveInfo.label,
    sourceLabel: normalizeAdShotSourceDisplay(shot),
    sourceKey: normalizeText(shot.sourceKey || shot.source_key),
    appMatchStatus: normalizeText(shot.appMatchStatus || shot.app_match_status),
    appMatchSource: normalizeText(shot.appMatchSource || shot.app_match_source),
    appMatchQuery: normalizeText(shot.appMatchQuery || shot.app_match_query),
    detailPath: normalizeText(shot.detailPath || shot.detail_path),
    htmlPath: normalizeText(shot.htmlPath || shot.html_path),
    capturePackagePath: normalizeText(shot.capturePackagePath || shot.capture_package_path)
  };
}

function buildAdShotReadableTitle(shot) {
  const analysis = getAdShotAnalysisBundle(shot);
  const candidates = [
    analysis.cardTitle,
    analysis.readableTitle,
    analysis.storyTitle,
    titleFromAdShotScript(analysis.script),
    shot.highlight,
    analysis.highlight,
    analysis.hook,
    analysis.productMechanism,
    shot.transcriptZh,
    shot.title,
    shot.brandName
  ];

  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (!text || /^等待/.test(text)) {
      continue;
    }
    return truncateText(toReadableAdShotTitle(text), 64);
  }
  return "等待分析后生成剧情和亮点";
}

function toReadableAdShotTitle(text) {
  const firstSentence = normalizeText(text).split(/[。！？]/)[0] || text;
  const firstClause = firstSentence.split(/[，；:：]/)[0];
  if (firstClause.length >= 8) {
    return firstClause;
  }
  return firstSentence || text;
}

function summarizeAdShotScript(script) {
  const cleaned = cleanAdShotScriptText(script);
  if (!cleaned) {
    return "";
  }
  const sentences = cleaned
    .split(/(?<=[。！？])\s*/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
  return (sentences.length ? sentences.slice(0, 3).join(" ") : cleaned);
}

function titleFromAdShotScript(script) {
  const cleaned = cleanAdShotScriptText(script);
  if (!cleaned) {
    return "";
  }
  const sentence = normalizeText(cleaned.split(/[。！？]/)[0]);
  if (!sentence) {
    return "";
  }
  return sentence
    .replace(/^开场是[：:]/, "")
    .replace(/，这其实是一个/, "：")
    .replace(/，这其实是/, "：");
}

function cleanAdShotScriptText(script) {
  return normalizeText(script)
    .replace(/镜头\/字幕\d+\s*[：:]/g, "")
    .replace(/开场用一句[^：:]{0,60}[：:]/g, "开场是：")
    .replace(/补充产品规则[：:]/g, "接着说明：")
    .replace(/情节转向好友关系[：:]/g, "然后落到好友关系：")
    .replace(/情绪落点[：:]/g, "最后情绪落点：")
    .replace(/收束到品牌感受[：:]/g, "收尾是：");
}

function formatAdShotMetricCount(value) {
  return value === null || value === undefined ? "-" : String(value);
}

function formatAdShotCtrRank(value, fallbackPercentile = null) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    return `Top ${Math.round(number > 1 ? number : number * 100)}%`;
  }
  const percentile = Number(fallbackPercentile);
  return Number.isFinite(percentile) && percentile > 0 ? `Top ${Math.round(percentile)}%` : "-";
}

function formatAdShotBudget(value) {
  const key = normalizeText(value).toLowerCase();
  const budgetLabels = {
    "0": "低",
    "1": "中",
    "2": "高",
    low: "低",
    medium: "中",
    high: "高"
  };
  return budgetLabels[key] || (key ? normalizeText(value) : "-");
}

function normalizeNullableCount(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
  }
  const text = normalizeText(value).replace(/,/g, "");
  const match = text.match(/^(\d+(?:\.\d+)?)([KMB万千])?$/i);
  if (!match) {
    return null;
  }
  const number = Number(match[1]);
  if (!Number.isFinite(number)) {
    return null;
  }
  const unit = match[2]?.toLowerCase() || "";
  const multiplier = unit === "k"
    ? 1_000
    : unit === "m"
      ? 1_000_000
      : unit === "b"
        ? 1_000_000_000
        : unit === "万"
          ? 10_000
          : unit === "千"
            ? 1_000
            : 1;
  return Math.max(0, Math.round(number * multiplier));
}

function defaultNormalizeVisualTextSegments(items, duration = null) {
  if (!Array.isArray(items)) {
    return [];
  }
  const maxDuration = Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : null;
  return items
    .map((item) => {
      const start = Math.max(0, Number(item?.start ?? item?.startTime ?? item?.from ?? item?.begin) || 0);
      let end = Number(item?.end ?? item?.endTime ?? item?.to ?? item?.until);
      if (!Number.isFinite(end) || end <= start) {
        end = start + 2.5;
      }
      const cappedEnd = maxDuration ? Math.min(maxDuration, end) : end;
      const normalizedEnd = cappedEnd > start ? cappedEnd : (maxDuration ? Math.min(maxDuration, start + 1) : start + 1);
      const original = truncateText(normalizeText(item?.original || item?.source || item?.text || item?.onScreenTextOriginal), 240);
      const zh = truncateText(normalizeText(item?.zh || item?.translationZh || item?.translation_zh || item?.translation || item?.onScreenTextZh), 240);
      return original || zh
        ? {
            start: Number(start.toFixed(2)),
            end: Number(normalizedEnd.toFixed(2)),
            original,
            zh
          }
        : null;
    })
    .filter(Boolean)
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .slice(0, 40);
}

function normalizeStringArray(items) {
  if (typeof items === "string") {
    return [truncateText(normalizeText(items), 180)].filter(Boolean);
  }
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => truncateText(normalizeText(item), 180)).filter(Boolean);
}

function truncateText(value, maxLength) {
  const text = normalizeText(value);
  if (!maxLength || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstNumeric(...values) {
  const value = values.find((item) => Number.isFinite(Number(item)) && Number(item) >= 0);
  return value === undefined ? undefined : Number(value);
}

function splitAdShotScriptIntoParagraphs(script) {
  const normalized = normalizeText(script);
  if (!normalized || /^等待/.test(normalized)) {
    return [];
  }
  const matches = Array.from(normalized.matchAll(/镜头\s*\d+\s*[：:]/g));
  if (!matches.length) {
    return [normalized];
  }
  const paragraphs = [];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? normalized.length) : normalized.length;
    const segment = normalizeText(normalized.slice(start, end));
    if (segment) {
      paragraphs.push(segment);
    }
  }
  return paragraphs;
}

function mergeAdShotAnalysis(...sources) {
  const merged = {};
  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }
    for (const [key, value] of Object.entries(source)) {
      if (isEmptyAdShotAnalysisValue(value)) {
        continue;
      }
      if (merged[key] === undefined || isPlaceholderAdShotAnalysisValue(merged[key])) {
        merged[key] = value;
      }
    }
  }
  return merged;
}

function isEmptyAdShotAnalysisValue(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    const text = normalizeText(value);
    return !text || /^等待/.test(text);
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }
  return false;
}

function isPlaceholderAdShotAnalysisValue(value) {
  const text = normalizeText(value);
  return Boolean(text) && /^等待/.test(text);
}
