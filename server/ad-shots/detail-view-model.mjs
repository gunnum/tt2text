import {
  buildAdShotHeroSummary,
  buildAdShotHeroTitle,
  buildAdShotInsightItems,
  buildAdShotPerformanceItems,
  canAnalyzeAdShot,
  formatAdShotDetailRegionLabel,
  getAdShotAnalysisBundle,
  getAdShotObjectiveInfo,
  getAdShotSourceInfo,
  normalizeAdShotCategory,
  normalizeAdShotSourcePlatform
} from "./normalizers.mjs";
import {
  firstNonEmptyVisualTextSegmentsWithNormalizer,
  isTrustedVisualTextBBox
} from "./visual-text.mjs";

export function buildAdShotDetailViewModel(shot = {}, options = {}) {
  const normalizeText = typeof options.normalizeText === "function" ? options.normalizeText : defaultNormalizeText;
  const normalizeVisualTextSegments = typeof options.normalizeVisualTextSegments === "function"
    ? options.normalizeVisualTextSegments
    : defaultNormalizeVisualTextSegments;
  const normalizeToPublicPath = typeof options.normalizeToPublicPath === "function"
    ? options.normalizeToPublicPath
    : defaultNormalizeToPublicPath;

  const standardAppName = normalizeText(shot.app?.name || shot.app?.fullName || shot.appName || shot.appDisplay);
  const rawBrandName = normalizeText(shot.rawBrandName || shot.brandName);
  const title = shot.title || standardAppName || rawBrandName || shot.sourceAdId || "Ad Shot";
  const analysis = getAdShotAnalysisBundle(shot);
  const metrics = shot.raw?.metrics && typeof shot.raw.metrics === "object" ? shot.raw.metrics : {};
  const sourcePlatform = normalizeAdShotSourcePlatform(shot);
  const isTikTokDetail = sourcePlatform === "tiktok";
  const isPhotoShot = normalizeText(shot.mediaType || shot.media_type).toLowerCase() === "photo"
    || /\/photo\//i.test(shot.sourceUrl || "");
  const objectiveInfo = getAdShotObjectiveInfo(shot);
  const sourceInfo = getAdShotSourceInfo(shot);
  const shotUrl = shot.shotUrl || `/shots/${shot.shotId}`;
  const regionLabel = formatAdShotDetailRegionLabel(shot);
  const heroTitle = buildAdShotHeroTitle(shot, analysis, title);
  const heroSummary = buildAdShotHeroSummary(shot, analysis);
  const categoryLabel = normalizeAdShotCategory(shot);
  const originalTitle = normalizeText(title);
  const rawCountryCodes = Array.isArray(shot.countryCode) ? shot.countryCode.filter(Boolean) : [];
  const regionSummary = formatRegionSummary(rawCountryCodes);
  const speechSubtitle = normalizeChineseSubtitle(shot.transcriptZh || analysis.speechSubtitleZh || analysis.subtitleZh);
  const visualSubtitleOriginal = normalizeText(shot.onScreenTextOriginal || analysis.onScreenTextOriginal || shot.visualTextOriginal || analysis.visualTextOriginal);
  const visualSubtitle = normalizeText(shot.onScreenTextZh || shot.visualTextZh || analysis.onScreenTextZh || analysis.visualTextZh);
  const duration = Number(shot.duration) || null;
  const explicitVisualTextSegments = firstNonEmptyVisualTextSegmentsWithNormalizer(
    normalizeVisualTextSegments,
    duration,
    shot.visualTextSegments,
    analysis.visualTextSegments
  );
  const visualTextSegments = explicitVisualTextSegments.length
    ? explicitVisualTextSegments
    : normalizeVisualTextSegments(visualSubtitle ? [{
      start: 0,
      end: Math.min(Number(shot.duration) || 4, 4),
      original: visualSubtitleOriginal,
      zh: visualSubtitle
    }] : [], duration);
  const speechSubtitleSegments = buildAdShotSubtitleSegments(
    speechSubtitle || buildFallbackSubtitleFromVisualTextSegments(visualTextSegments)
  );
  const positionedVisualTextSegments = visualTextSegments.filter((segment) =>
    isTrustedVisualTextBBox(segment) && normalizeText(segment.zh)
  );
  const hasSubtitleOverlay = Boolean(speechSubtitleSegments.length || positionedVisualTextSegments.length);
  const showAnalyzeButton = canAnalyzeAdShot(shot) && shot.analysisStatus !== "completed";
  const analyzeButtonLabel = ["queued", "running"].includes(shot.analysisStatus) ? "分析中" : "开始分析";
  const analysisStatusTag = shot.analysisStatus === "queued"
    ? "排队中"
    : shot.analysisStatus === "running"
      ? "分析中"
      : shot.analysisStatus === "failed"
        ? "分析异常"
        : "";
  const analysisStatusNotice = buildAnalysisStatusNotice(shot, normalizeText);
  const rawImagePaths = [
    ...(Array.isArray(shot.media?.imagePaths) ? shot.media.imagePaths : []),
    ...(Array.isArray(shot.imagePaths) ? shot.imagePaths : []),
    ...(Array.isArray(shot.image_paths) ? shot.image_paths : []),
    ...(Array.isArray(shot.analysisArtifacts?.imagePaths) ? shot.analysisArtifacts.imagePaths : [])
  ];
  const imagePaths = Array.from(new Set(rawImagePaths.map(normalizeToPublicPath).filter(Boolean)));
  const mediaImagePaths = Array.from(new Set([
    ...(isPhotoShot ? imagePaths : []),
    ...(!shot.videoPath && shot.media?.posterPath ? [shot.media.posterPath] : []),
    ...(!shot.videoPath && shot.posterPath ? [shot.posterPath] : [])
  ].filter(Boolean)));
  const landingPage = normalizeText(shot.landingPage || shot.landing_page || shot.raw?.landingPage);
  const adCaption = normalizeText(shot.adCaption || shot.ad_caption || shot.raw?.adCaption || shot.title);
  const heroTags = [
    categoryLabel,
    regionSummary.shortLabel,
    analysisStatusTag
  ].filter(Boolean);
  const metaItems = [
    { label: "App", value: standardAppName },
    { label: isTikTokDetail ? "账号/来源品牌" : "来源品牌", value: isTikTokDetail ? (shot.raw?.author || rawBrandName) : rawBrandName },
    { label: "行业", value: categoryLabel },
    { label: "地区", value: regionSummary.shortLabel || regionLabel, note: regionSummary.fullLabel || "" },
    ...(isTikTokDetail
      ? []
      : [{ label: "投放目标", value: objectiveInfo.label, note: objectiveInfo.note }]),
    { label: "Landing Page", value: landingPage },
    { label: "Ad caption", value: adCaption },
    { label: "时长", value: shot.duration ? `${shot.duration}s` : "" },
    { label: "入库时间", value: shot.capturedAt }
  ];
  const performanceTitle = isTikTokDetail ? "素材互动" : "广告投放效果";
  const performanceNote = isTikTokDetail
    ? "这些指标来自普通 TikTok 详情页可见互动数据，不包含 TikTok Creative Center 的 CTR、预算或投放排名。"
    : "这些指标来自 TikTok Creative Center。CTR Top xx% 是平台给出的点击率排名区间，不等于具体点击率；预算是平台给出的投放预算档位。";
  const sourceItems = [
    { label: isPhotoShot ? "图集理解" : "语音字幕", value: isPhotoShot ? (shot.analysisStatus === "completed" ? "图片视觉理解" : "待生成") : (speechSubtitle ? "音频转写 + 中文翻译" : "待生成") },
    { label: "画面文字", value: visualTextSegments.length ? `OCR/视觉识别 ${visualTextSegments.length} 段` : "待识别" },
    { label: "素材拆解", value: shot.analysisStatus === "completed" ? "LLM 生成" : "待生成" }
  ];
  const interactiveTimeAnalysis = normalizeInteractiveTimeAnalysis(shot.interactiveTimeAnalysis || shot.interactive_time_analysis || shot.raw?.interactiveTimeAnalysis);
  const interactiveTimeAnalysisItems = interactiveTimeAnalysis?.tabs?.length
    ? interactiveTimeAnalysis.tabs.map((tab) => ({
        label: tab.label,
        value: tab.rankText || tab.infoText || (tab.highlightSeconds?.length ? `${tab.highlightSeconds.join(" / ")} 秒` : "已采集")
      }))
    : [];
  const analysisProgress = shot.analysisProgress && typeof shot.analysisProgress === "object" ? shot.analysisProgress : {};
  const analysisEvents = Array.isArray(shot.analysisEvents) ? shot.analysisEvents : [];
  const latestAnalysisEvent = analysisEvents[analysisEvents.length - 1] || {};
  const showAnalysisProgress = ["queued", "running", "failed"].includes(shot.analysisStatus);
  const analysisProgressLabel = analysisProgress.stageLabel || latestAnalysisEvent.stageLabel || shot.analysisStage || analysisStatusNotice?.label || "";
  const analysisProgressMessage = analysisProgress.message || latestAnalysisEvent.message || shot.analysisError || "";
  const analysisProgressAt = analysisProgress.updatedAt || latestAnalysisEvent.at || shot.updatedAt || "";

  return {
    title,
    analysis,
    metrics,
    sourcePlatform,
    isTikTokDetail,
    isPhotoShot,
    objectiveInfo,
    sourceInfo,
    shotUrl,
    regionLabel,
    heroTitle,
    heroSummary,
    categoryLabel,
    originalTitle,
    regionSummary,
    speechSubtitle,
    speechSubtitleSegments,
    visualTextSegments,
    positionedVisualTextSegments,
    hasSubtitleOverlay,
    showAnalyzeButton,
    analyzeButtonLabel,
    analysisStatusTag,
    analysisStatusNotice,
    imagePaths,
    mediaImagePaths,
    heroTags,
    metaItems,
    performanceItems: buildAdShotPerformanceItems(shot, metrics),
    insightItems: buildAdShotInsightItems(shot, analysis),
    performanceTitle,
    performanceNote,
    sourceItems,
    interactiveTimeAnalysis,
    interactiveTimeAnalysisItems,
    analysisProgress,
    analysisEvents,
    showAnalysisProgress,
    analysisProgressLabel,
    analysisProgressMessage,
    analysisProgressAt
  };
}

function normalizeInteractiveTimeAnalysis(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const tabs = Array.isArray(value.tabs)
    ? value.tabs.map((tab) => normalizeInteractiveMetricTab(tab)).filter(Boolean)
    : [];
  if (!tabs.length) {
    return null;
  }
  return {
    captureMode: defaultNormalizeText(value.captureMode || value.capture_mode) || "ui_tab_rotation",
    capturedAt: defaultNormalizeText(value.capturedAt || value.captured_at),
    activeTab: defaultNormalizeText(value.activeTab || value.active_tab),
    tabOrder: Array.isArray(value.tabOrder)
      ? value.tabOrder.map((item) => defaultNormalizeText(item)).filter(Boolean)
      : tabs.map((tab) => tab.label),
    tabs
  };
}

function normalizeInteractiveMetricTab(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const label = defaultNormalizeText(value.label);
  if (!label) {
    return null;
  }
  return {
    key: defaultNormalizeText(value.key) || label.toLowerCase(),
    label,
    activeLabel: defaultNormalizeText(value.activeLabel || value.active_label) || label,
    infoText: defaultNormalizeText(value.infoText || value.info_text),
    rankText: defaultNormalizeText(value.rankText || value.rank_text),
    highlightSeconds: Array.isArray(value.highlightSeconds)
      ? value.highlightSeconds.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item >= 0)
      : [],
    chart: value.chart && typeof value.chart === "object" ? value.chart : null
  };
}

function formatRegionSummary(countryCodes = []) {
  const codes = countryCodes
    .map((item) => defaultNormalizeText(item).toUpperCase())
    .filter(Boolean);
  if (!codes.length) {
    return {
      shortLabel: "",
      fullLabel: ""
    };
  }
  if (codes.length <= 5) {
    return {
      shortLabel: codes.join(" / "),
      fullLabel: codes.join(" / ")
    };
  }
  return {
    shortLabel: `${codes.slice(0, 5).join(" / ")} 等，共 ${codes.length} 个`,
    fullLabel: codes.join(" / ")
  };
}

function buildAnalysisStatusNotice(shot, normalizeText) {
  if (shot.analysisStatus === "queued") {
    return {
      label: "排队中",
      className: "queued",
      detail: "已加入分析队列，等待开始处理。"
    };
  }
  if (shot.analysisStatus === "running") {
    return {
      label: "分析中",
      className: "running",
      detail: "正在生成素材拆解，可能需要几分钟。"
    };
  }
  if (shot.analysisStatus === "failed") {
    return {
      label: "分析异常",
      className: "failed",
      detail: normalizeText(shot.analysisError) || "素材拆解生成失败，可以重新生成。"
    };
  }
  return null;
}

function buildAdShotSubtitleSegments(text) {
  const normalized = defaultNormalizeText(text);
  if (!normalized) {
    return [];
  }

  const sentenceParts = normalized
    .split(/(?<=[。！？!?])\s*/)
    .map((item) => defaultNormalizeText(item))
    .filter(Boolean);
  const parts = sentenceParts.length ? sentenceParts : [normalized];
  const segments = [];
  for (const part of parts) {
    if (part.length <= 44) {
      segments.push(part);
      continue;
    }

    const clauses = part
      .split(/(?<=[，,；;：:])\s*/)
      .map((item) => defaultNormalizeText(item))
      .filter(Boolean);
    if (clauses.length <= 1) {
      segments.push(...splitTextByLength(part, 36));
      continue;
    }

    let current = "";
    for (const clause of clauses) {
      if (!current || `${current}${clause}`.length <= 44) {
        current = `${current}${clause}`;
        continue;
      }
      segments.push(current);
      current = clause;
    }
    if (current) {
      segments.push(current);
    }
  }

  return segments
    .map((item) => truncateText(item, 58))
    .filter(Boolean)
    .slice(0, 12);
}

function buildFallbackSubtitleFromVisualTextSegments(segments = []) {
  const lines = segments
    .map((segment) => defaultNormalizeText(segment?.zh))
    .filter((text) => text && !/品牌名|品牌 logo|logo|水印/i.test(text));
  return Array.from(new Set(lines)).join("。");
}

function normalizeChineseSubtitle(value) {
  const text = defaultNormalizeText(value);
  if (!text) {
    return "";
  }
  return /[\u3400-\u9fff]/.test(text) ? text : "";
}

function splitTextByLength(text, maxLength) {
  const normalized = defaultNormalizeText(text);
  if (!normalized) {
    return [];
  }

  const parts = [];
  for (let index = 0; index < normalized.length; index += maxLength) {
    parts.push(normalized.slice(index, index + maxLength));
  }
  return parts;
}

function defaultNormalizeVisualTextSegments(items) {
  return Array.isArray(items) ? items : [];
}

function defaultNormalizeToPublicPath(value) {
  return defaultNormalizeText(value);
}

function truncateText(value, maxLength) {
  const text = defaultNormalizeText(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function defaultNormalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
