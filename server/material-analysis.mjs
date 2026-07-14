import {
  AD_SHOT_ANALYSIS_SCHEMA,
  buildBaseAnalysisHash,
  buildBaseAnalysisPrompt,
  buildBaseAnalysisRepairPrompt,
  evaluateBaseAnalysisQuality,
  normalizeStoryboardScenes,
  storyboardScenesToFormula,
  storyboardScenesToKeyMoments
} from "./features/ad-shot-analysis/index.mjs";

const MAX_BASE_ANALYSIS_ATTEMPTS = 2;

export async function buildMaterialAnalysis({
  shot = {},
  semantic = {},
  runJsonTask,
  timeoutMs = 90_000,
  normalizeVisualTextSegments = defaultNormalizeVisualTextSegments,
  jsonTaskOptions = {}
} = {}) {
  if (typeof runJsonTask !== "function") {
    throw new Error("缺少素材分析 JSON 任务执行器。");
  }

  const isNormalTikTokVideo = normalizeMaterialSourcePlatform(shot) === "tiktok";
  const sourceContextLine = isNormalTikTokVideo
    ? "你在为 T2T 的普通 TikTok 视频素材库分析一条从 TikTok 视频详情页采集来的推广/UGC 视频。它不一定是投放广告，也不包含 Creative Center 的 CTR、预算或排名数据。"
    : "你在为 T2T 的 Ad Shots 模块分析一条 TikTok Creative Center Top Ads 推广视频。";
  const semanticVisualTextSegments = normalizeVisualTextSegments(
    semantic.visual_text_segments || semantic.visualTextSegments,
    Number(shot.duration) || null
  );
  const semanticDuration = resolveSemanticDuration(shot, semantic, semanticVisualTextSegments);
  const singleBeatHint = detectSingleBeatVideo(semanticVisualTextSegments, semanticDuration);
  const transcriptSignal = detectTranscriptSignal({
    transcriptEn: semantic.transcript_en,
    translationZh: semantic.translation_zh,
    visualSegments: semanticVisualTextSegments,
    singleBeatHint
  });
  const visualTextTimelineSource = semanticVisualTextSegments
    .map((segment) => `${segment.start}s-${segment.end}s 原文：${segment.original || "无"} 译文：${segment.zh || "无"}`)
    .join("；");
  const sourceText = normalizeText([
    `品牌：${shot.brandName || ""}`,
    `标题：${shot.title || semantic.title || ""}`,
    `投放目标：${shot.objectiveKey || ""}`,
    `素材来源：${shot.sourceLabel || ""}`,
    `英文转写：${truncateText(transcriptSignal.transcriptEn, 5000)}`,
    `中文口播：${truncateText(transcriptSignal.translationZh, 5000)}`,
    `画面总结：${truncateText(semantic.visual_summary || "", 5000)}`,
    `画面文字时间轴：${visualTextTimelineSource || "无"}`,
    transcriptSignal.note ? `音轨提示：${transcriptSignal.note}` : ""
  ].join("\n"));

  const fallbackScript = semantic.translation_zh || semantic.visual_summary || semantic.transcript_en || "未提取到有效脚本。";
  const fallback = {
    schema: AD_SHOT_ANALYSIS_SCHEMA,
    cardTitle: "",
    cardSummary: "",
    videoStory: "",
    script: fallbackScript,
    hook: "等待人工复核：系统已完成视频语义提取，但结构化拆解未成功。",
    productMechanism: "等待人工复核。",
    productFeatures: [],
    creativeStrategy: {},
    reusableTemplate: "等待人工复核。",
    storyboardFormula: [],
    storyboardScenes: [],
    onScreenTextOriginal: "",
    onScreenTextZh: "",
    visualTextSegments: semanticVisualTextSegments,
    keyMoments: [],
    rewriteAngles: []
  };

  if (!sourceText) {
    const quality = evaluateBaseAnalysisQuality(fallback);
    return withMaterialAnalysisQuality(fallback, quality, []);
  }

  const prompt = buildBaseAnalysisPrompt({
    sourceContextLine,
    sourceText,
    isNormalTikTokVideo,
    singleBeatHint,
    transcriptSignal
  });
  const attempts = [];
  let nextPrompt = prompt;
  let bestAnalysis = null;
  let lastError = null;

  for (let round = 1; round <= MAX_BASE_ANALYSIS_ATTEMPTS; round += 1) {
    try {
      const content = await runJsonTask(nextPrompt, timeoutMs, jsonTaskOptions);
      const parsed = JSON.parse(extractJsonObject(content));
      let candidate = normalizeGeneratedMaterialAnalysis(parsed, {
        fallback,
        shot,
        semantic,
        semanticDuration,
        semanticVisualTextSegments,
        normalizeVisualTextSegments
      });
      if (singleBeatHint.isSingleBeat) {
        candidate = collapseSingleBeatAnalysis(candidate, shot, singleBeatHint, {
          framePaths: semantic.visual_frame_paths || semantic.visualFramePaths,
          posterPath: semantic.first_frame_path || semantic.firstFramePath
        });
      }
      const quality = evaluateBaseAnalysisQuality(candidate);
      attempts.push({
        round,
        status: quality.status,
        score: quality.score,
        issues: quality.issues.map((issue) => issue.code)
      });
      candidate = withMaterialAnalysisQuality(candidate, quality, attempts);
      if (!bestAnalysis || candidate.qualityScore > bestAnalysis.qualityScore) {
        bestAnalysis = candidate;
      }
      if (quality.status === "passed") {
        return candidate;
      }
      if (round < MAX_BASE_ANALYSIS_ATTEMPTS) {
        nextPrompt = buildBaseAnalysisRepairPrompt({
          originalPrompt: prompt,
          previousAnalysis: candidate,
          issues: quality.issues,
          round: round + 1
        });
      }
    } catch (error) {
      lastError = error;
      attempts.push({
        round,
        status: "failed",
        score: 0,
        issues: [error instanceof Error ? error.message : String(error)]
      });
      if (round < MAX_BASE_ANALYSIS_ATTEMPTS) {
        nextPrompt = buildBaseAnalysisRepairPrompt({
          originalPrompt: prompt,
          previousAnalysis: bestAnalysis || fallback,
          issues: [{ message: error instanceof Error ? error.message : String(error) }],
          round: round + 1
        });
      }
    }
  }

  if (bestAnalysis) {
    return bestAnalysis;
  }
  const quality = evaluateBaseAnalysisQuality(fallback);
  return withMaterialAnalysisQuality({
    ...fallback,
    structureError: lastError instanceof Error ? lastError.message : String(lastError || "素材拆解未通过结构校验。")
  }, quality, attempts);
}

export function normalizeMaterialAnalysis(analysis = {}, context = {}, {
  normalizeVisualTextSegments = defaultNormalizeVisualTextSegments,
  now = () => new Date().toISOString()
} = {}) {
  const fallback = context.previousAnalysis && typeof context.previousAnalysis === "object" ? context.previousAnalysis : {};
  const visualTextSegments = normalizeVisualTextSegments(
    analysis.visualTextSegments || analysis.visual_text_segments || fallback.visualTextSegments,
    null
  );
  const storyboardScenes = normalizeStoryboardScenes({
    scenes: analysis.storyboardScenes || fallback.storyboardScenes,
    storyboardFormula: analysis.storyboardFormula || analysis.storyboard || analysis.shotFormula || fallback.storyboardFormula,
    keyMoments: analysis.keyMoments || fallback.keyMoments,
    duration: context.duration,
    framePaths: context.framePaths,
    posterPath: context.posterPath
  });
  const normalized = {
    schema: AD_SHOT_ANALYSIS_SCHEMA,
    source: normalizeText(context.source) || "normal_tiktok_video",
    cardTitle: truncateText(normalizeText(analysis.cardTitle || fallback.cardTitle), 80),
    cardSummary: truncateText(normalizeText(analysis.cardSummary || fallback.cardSummary), 260),
    videoStory: truncateText(normalizeText(analysis.videoStory || fallback.videoStory), 900),
    script: truncateText(normalizeText(analysis.script || fallback.script), 5000),
    hook: truncateText(normalizeText(analysis.hook || fallback.hook), 1000),
    productFeatures: normalizeStringArray(analysis.productFeatures || analysis.featureList || analysis.features || fallback.productFeatures).slice(0, 8),
    productMechanism: truncateText(normalizeText(analysis.productMechanism || fallback.productMechanism), 1200),
    creativeStrategy: normalizeCreativeStrategy(analysis.creativeStrategy || fallback.creativeStrategy),
    storyboardScenes,
    storyboardFormula: storyboardScenesToFormula(storyboardScenes),
    reusableTemplate: truncateText(normalizeText(analysis.reusableTemplate || fallback.reusableTemplate), 1600),
    onScreenTextOriginal: truncateText(normalizeText(analysis.onScreenTextOriginal || fallback.onScreenTextOriginal), 240),
    onScreenTextZh: truncateText(normalizeText(analysis.onScreenTextZh || fallback.onScreenTextZh), 240),
    visualTextSegments,
    keyMoments: storyboardScenesToKeyMoments(storyboardScenes),
    structureError: truncateText(normalizeText(analysis.structureError || ""), 600),
    generatedAt: normalizeText(context.generatedAt) || now()
  };
  const quality = analysis.qualityStatus
    ? {
        status: normalizeText(analysis.qualityStatus),
        score: Number(analysis.qualityScore) || 0,
        issues: normalizeQualityIssues(analysis.qualityIssues)
      }
    : evaluateBaseAnalysisQuality(normalized);
  return withMaterialAnalysisQuality(normalized, quality, analysis.analysisAttempts || []);
}

function normalizeGeneratedMaterialAnalysis(parsed = {}, {
  fallback,
  shot,
  semantic,
  semanticDuration,
  semanticVisualTextSegments,
  normalizeVisualTextSegments
} = {}) {
  const storyboardScenes = normalizeStoryboardScenes({
    scenes: parsed.storyboardScenes || parsed.storyboard_scenes,
    storyboardFormula: parsed.storyboardFormula || parsed.storyboard || parsed.shotFormula,
    keyMoments: parsed.keyMoments,
    duration: semanticDuration,
    framePaths: semantic.visual_frame_paths || semantic.visualFramePaths,
    posterPath: semantic.first_frame_path || semantic.firstFramePath
  });
  return {
    schema: AD_SHOT_ANALYSIS_SCHEMA,
    cardTitle: truncateText(normalizeText(parsed.cardTitle), 80) || fallback.cardTitle,
    cardSummary: truncateText(normalizeText(parsed.cardSummary), 260) || fallback.cardSummary,
    videoStory: truncateText(normalizeText(parsed.videoStory), 800) || fallback.videoStory,
    script: truncateText(normalizeText(parsed.script), 5000) || fallback.script,
    hook: truncateText(normalizeText(parsed.hook), 1000) || fallback.hook,
    productFeatures: normalizeStringArray(parsed.productFeatures || parsed.featureList || parsed.features).slice(0, 8),
    productMechanism: truncateText(normalizeText(parsed.productMechanism), 1200) || fallback.productMechanism,
    creativeStrategy: normalizeCreativeStrategy(parsed.creativeStrategy),
    storyboardScenes,
    storyboardFormula: storyboardScenesToFormula(storyboardScenes),
    reusableTemplate: truncateText(normalizeText(parsed.reusableTemplate), 1600) || fallback.reusableTemplate,
    onScreenTextOriginal: truncateText(normalizeText(parsed.onScreenTextOriginal), 240) || semanticVisualTextSegments[0]?.original || "",
    onScreenTextZh: truncateText(normalizeText(parsed.onScreenTextZh), 240) || semanticVisualTextSegments[0]?.zh || "",
    visualTextSegments: semanticVisualTextSegments.length
      ? semanticVisualTextSegments
      : normalizeVisualTextSegments(parsed.visualTextSegments, Number(shot.duration) || null),
    keyMoments: storyboardScenesToKeyMoments(storyboardScenes),
    rewriteAngles: []
  };
}

function withMaterialAnalysisQuality(analysis, quality, attempts) {
  const normalized = {
    ...analysis,
    schema: AD_SHOT_ANALYSIS_SCHEMA,
    qualityStatus: quality.status,
    qualityScore: Number(quality.score) || 0,
    qualityIssues: normalizeQualityIssues(quality.issues),
    analysisAttempts: (Array.isArray(attempts) ? attempts : []).slice(-3)
  };
  return {
    ...normalized,
    baseAnalysisHash: buildBaseAnalysisHash(normalized),
    status: normalized.structureError || normalized.qualityStatus !== "passed" ? "needs_review" : "completed"
  };
}

function normalizeCreativeStrategy(value = {}) {
  if (!value || typeof value !== "object") return {};
  const pattern = normalizeText(value.creativePattern || value.pattern).toLowerCase();
  const exposure = normalizeText(value.appExposureLevel || value.exposureLevel).toLowerCase();
  return {
    creativePattern: [
      "pain_point_demo",
      "result_first",
      "ugc_story",
      "listicle",
      "challenge",
      "tutorial",
      "comparison",
      "social_proof",
      "single_beat",
      "other"
    ].includes(pattern) ? pattern : "other",
    appExposureLevel: ["strong", "medium", "weak"].includes(exposure) ? exposure : "weak",
    hookMechanism: truncateText(normalizeText(value.hookMechanism), 300),
    creativeMechanism: truncateText(normalizeText(value.creativeMechanism), 500)
  };
}

function normalizeQualityIssues(value) {
  return (Array.isArray(value) ? value : []).map((issue) => {
    if (typeof issue === "string") return { code: issue, severity: "warning", message: issue };
    return {
      code: normalizeText(issue?.code) || "quality_issue",
      severity: normalizeText(issue?.severity) || "warning",
      message: truncateText(normalizeText(issue?.message), 300)
    };
  }).slice(0, 12);
}

function normalizeMaterialSourcePlatform(source = {}) {
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
  if ([
    "tiktok",
    "tiktok_detail",
    "tiktok_video",
    "tiktok_video_detail",
    "tiktok_photo",
    "tiktok_photo_detail"
  ].includes(key) || /tiktok.*详情/.test(key)) {
    return "tiktok";
  }
  return key || "tiktok_creative_center";
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

function extractJsonObject(content) {
  const text = String(content || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }
  return text;
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

function resolveSemanticDuration(shot, semantic, segments) {
  const explicit = Number(shot.duration || semantic.duration);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  if (!Array.isArray(segments) || !segments.length) {
    return null;
  }
  const maxEnd = Math.max(...segments.map((segment) => Number(segment?.end) || 0));
  return maxEnd > 0 ? maxEnd : null;
}

function detectSingleBeatVideo(segments, duration) {
  if (!Array.isArray(segments) || !segments.length) {
    return { isSingleBeat: false };
  }
  const normalizedDuration = Number(duration);
  if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0 || normalizedDuration > 12) {
    return { isSingleBeat: false };
  }

  const normalizedSegments = segments
    .map((segment) => ({
      start: Number(segment?.start) || 0,
      end: Number(segment?.end) || 0,
      original: normalizeText(segment?.original),
      zh: normalizeText(segment?.zh)
    }))
    .filter((segment) => segment.end > segment.start && (segment.original || segment.zh));
  if (!normalizedSegments.length) {
    return { isSingleBeat: false };
  }

  const minStart = Math.min(...normalizedSegments.map((segment) => segment.start));
  const maxEnd = Math.max(...normalizedSegments.map((segment) => segment.end));
  const startSpread = Math.max(...normalizedSegments.map((segment) => segment.start)) - minStart;
  const endSpread = maxEnd - Math.min(...normalizedSegments.map((segment) => segment.end));
  const coverage = Math.max(0, maxEnd - minStart) / normalizedDuration;
  const coreSegments = normalizedSegments.filter((segment) => ((segment.end - segment.start) / normalizedDuration) >= 0.6);
  const focusSegments = coreSegments.length ? coreSegments : normalizedSegments;
  const focusMinStart = Math.min(...focusSegments.map((segment) => segment.start));
  const focusMaxEnd = Math.max(...focusSegments.map((segment) => segment.end));
  const focusStartSpread = Math.max(...focusSegments.map((segment) => segment.start)) - focusMinStart;
  const focusEndSpread = focusMaxEnd - Math.min(...focusSegments.map((segment) => segment.end));
  const focusCoverage = Math.max(0, focusMaxEnd - focusMinStart) / normalizedDuration;
  const mergedText = normalizeText(
    Array.from(new Set(focusSegments.map((segment) => segment.zh || segment.original).filter(Boolean))).join(" ")
  );
  const wordishLength = mergedText.replace(/\s+/g, "").length;
  const looksLikeSingleBlock = focusSegments.length === 1
    || (
      focusSegments.length <= 10
      && focusStartSpread <= 0.8
      && focusEndSpread <= 0.8
    );
  if (!looksLikeSingleBlock || coverage < 0.72 || wordishLength < 16) {
    return { isSingleBeat: false };
  }
  return {
    isSingleBeat: true,
    duration: normalizedDuration,
    coverage: Math.max(coverage, focusCoverage),
    segment: {
      start: focusMinStart,
      end: focusMaxEnd,
      original: normalizeText(Array.from(new Set(focusSegments.map((segment) => segment.original).filter(Boolean))).join(" ")),
      zh: normalizeText(Array.from(new Set(focusSegments.map((segment) => segment.zh).filter(Boolean))).join(" "))
    }
  };
}

function collapseSingleBeatAnalysis(analysis, shot, hint, { framePaths = [], posterPath = "" } = {}) {
  const text = truncateText(
    normalizeText(
      hint?.segment?.zh
      || analysis.onScreenTextZh
      || hint?.segment?.original
      || analysis.onScreenTextOriginal
      || analysis.hook
      || analysis.cardSummary
    ),
    90
  );
  const appName = normalizeText(shot.appName || shot.appDisplay || shot.brandName || "");
  const singleStep = text
    ? `整条视频基本只有一个镜头或信息点，用同一段大字文案${appName ? `和 ${appName} 相关画面` : ""}表达：${text}`
    : "整条视频基本只有一个镜头或信息点，没有明确的二次转场或独立步骤。";
  const storyboardScenes = normalizeStoryboardScenes({
    scenes: [{
      start: 0,
      end: hint.duration,
      scene: singleStep,
      role: "hook",
      whyItWorks: analysis.creativeStrategy?.hookMechanism || "用单一信息点集中传达核心主张。",
      frameTime: Math.min(0.8, Math.max(0.2, hint.duration * 0.3))
    }],
    duration: hint.duration,
    framePaths,
    posterPath
  });
  return {
    ...analysis,
    videoStory: truncateText(
      normalizeText(analysis.videoStory || analysis.cardSummary || singleStep)
        .replace(/(^|。)(开头|中间|随后|接着|最后)[^。]*?/g, "$1")
        .trim() || singleStep,
      800
    ),
    creativeStrategy: {
      ...analysis.creativeStrategy,
      creativePattern: "single_beat"
    },
    storyboardScenes,
    storyboardFormula: storyboardScenesToFormula(storyboardScenes),
    reusableTemplate: singleStep,
    keyMoments: storyboardScenesToKeyMoments(storyboardScenes)
  };
}

function detectTranscriptSignal({ transcriptEn, translationZh, visualSegments, singleBeatHint } = {}) {
  const cleanedTranscriptEn = normalizeText(transcriptEn);
  const cleanedTranslationZh = normalizeText(translationZh);
  if (!cleanedTranscriptEn && !cleanedTranslationZh) {
    return { transcriptEn: "", translationZh: "", ignoreTranscript: false, note: "" };
  }
  const visualOriginal = normalizeText(visualSegments.map((segment) => segment.original || "").join(" "));
  const overlap = tokenOverlapScore(cleanedTranscriptEn, visualOriginal);
  const transcriptLooksCyrillic = scriptRatio(cleanedTranscriptEn, /[А-Яа-яЁё]/g) >= 0.25;
  const visualLooksLatin = scriptRatio(visualOriginal, /[A-Za-z]/g) >= 0.25;
  const likelyBgmLyrics = Boolean(singleBeatHint?.isSingleBeat)
    && visualOriginal.length >= 32
    && cleanedTranscriptEn.length > 0
    && overlap < 0.12
    && transcriptLooksCyrillic
    && visualLooksLatin;
  if (!likelyBgmLyrics) {
    return {
      transcriptEn: cleanedTranscriptEn,
      translationZh: cleanedTranslationZh,
      ignoreTranscript: false,
      note: ""
    };
  }
  return {
    transcriptEn: "",
    translationZh: "",
    ignoreTranscript: true,
    note: "音轨疑似 BGM 歌词，且与覆盖全片的主文案冲突，分镜分析时已降权忽略。"
  };
}

function tokenOverlapScore(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) {
    return 0;
  }
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / Math.max(left.size, right.size);
}

function tokenSet(text) {
  return new Set(
    normalizeText(text)
      .toLowerCase()
      .replace(/[^\\p{L}\\p{N}\\s]+/gu, " ")
      .split(/\\s+/)
      .filter((token) => token && token.length >= 2)
  );
}

function scriptRatio(text, pattern) {
  const cleaned = normalizeText(text);
  if (!cleaned) return 0;
  const matches = cleaned.match(pattern) || [];
  return matches.length / cleaned.length;
}
