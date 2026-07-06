const MATERIAL_ANALYSIS_SCHEMA = "tt2text.material_analysis.v1";

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
    cardTitle: "",
    cardSummary: "",
    videoStory: "",
    script: fallbackScript,
    hook: "等待人工复核：系统已完成视频语义提取，但结构化拆解未成功。",
    productMechanism: "等待人工复核。",
    productFeatures: [],
    reusableTemplate: "等待人工复核。",
    storyboardFormula: [],
    onScreenTextOriginal: "",
    onScreenTextZh: "",
    visualTextSegments: semanticVisualTextSegments,
    keyMoments: [],
    rewriteAngles: []
  };

  if (!sourceText) {
    return fallback;
  }

  const prompt = [
    "Use $ad-video-analyzer.",
    sourceContextLine,
    "请根据转写、画面语义、画面文字时间轴和基础元数据，输出适合入库展示的结构化中文 JSON。",
    "要求：",
    "- cardTitle 点出核心产品功能和视频解决的问题，不要只复述开头 hook。",
    "- cardSummary 用 2 到 3 句中文浓缩剧情、产品功能和解决的问题。",
    "- videoStory 按顺序讲清视频剧情：开头问了什么，中间展示了什么，哪个功能回答了问题，如何收尾。",
    "- script 是可读脚本，可以按镜头/字幕/口播顺序组织。",
    "- hook 只写开头提出的具体问题或情境，不要拔高成营销术语。",
    "- productFeatures 是数组，逐条列出视频里展示或说到的具体 app 功能；不要写成一大段。",
    "- productMechanism 用 1 到 2 句解释这些功能如何解决视频开头的问题。",
    "- storyboardFormula 是数组，按分镜公式写：分镜 1：抛出问题；分镜 2：展示产品核心使用方法；分镜 3：展示哪个功能解决分镜 1 的问题；分镜 4：收尾。可按实际视频增减。",
    "- reusableTemplate 可留空或简短复述 storyboardFormula，不要写泛泛改写建议。",
    "- onScreenTextOriginal 是画面中主要外文字幕/大字；没有就留空。",
    "- onScreenTextZh 是画面中文字的自然中文翻译；没有就留空。",
    "- visualTextSegments 是画面文字时间轴数组。只记录画面上真实出现的外文/屏幕文字；每段包含 start、end、original、zh。画面没有文字就不要生成段落。start/end 用秒，允许根据抽帧粗估。",
    "- 如果输入里已有“画面文字时间轴”，优先沿用它的时间段，不要压缩成一条静态字幕；你只可以修正明显不自然的中文译文。",
    ...(singleBeatHint.isSingleBeat ? [
      "- 这条视频的画面文字基本只有 1 段并覆盖全片，说明它更像单镜头/单信息点短视频。",
      "- 不要把同一段大字文案硬拆成多个起承转合；如果没有明确镜头切换、UI切换或时间上分开的动作，storyboardFormula 只写 1 条。"
    ] : []),
    ...(transcriptSignal.ignoreTranscript ? [
      "- 这条视频的音轨和画面主文案明显冲突，音轨更像 BGM/歌词或环境声，不要用它来拆分镜头结构。",
      "- 在这条视频里，storyboardFormula、videoStory、keyMoments 以画面文字和画面变化为准。"
    ] : []),
    "- keyMoments 最多 5 条，写关键镜头或信息点。",
    ...(isNormalTikTokVideo ? [
      "- 普通 TikTok 视频没有 TTCC 投放数据，不要编造 CTR、预算、投放排名或广告主来源。",
      "- 如果视频是用户故事、避雷、教程或自然讨论，也要按素材结构拆：它如何开场、呈现什么产品/问题、评论或画面提供了什么用户洞察。"
    ] : []),
    "- 不要输出情绪价值模块，不要输出泛泛的改写角度。",
    "只返回 JSON，不要 markdown，形状如下：",
    "{\"cardTitle\":\"...\",\"cardSummary\":\"...\",\"videoStory\":\"...\",\"script\":\"...\",\"hook\":\"...\",\"productFeatures\":[\"...\"],\"productMechanism\":\"...\",\"storyboardFormula\":[\"分镜 1：...\"],\"reusableTemplate\":\"...\",\"onScreenTextOriginal\":\"...\",\"onScreenTextZh\":\"...\",\"visualTextSegments\":[{\"start\":0,\"end\":2.4,\"original\":\"...\",\"zh\":\"...\"}],\"keyMoments\":[\"...\"]}",
    "",
    sourceText
  ].join("\n");

  try {
    const content = await runJsonTask(prompt, timeoutMs, jsonTaskOptions);
    const parsed = JSON.parse(extractJsonObject(content));
    const base = {
      cardTitle: truncateText(normalizeText(parsed.cardTitle), 80) || fallback.cardTitle,
      cardSummary: truncateText(normalizeText(parsed.cardSummary), 260) || fallback.cardSummary,
      videoStory: truncateText(normalizeText(parsed.videoStory), 800) || fallback.videoStory,
      script: truncateText(normalizeText(parsed.script), 5000) || fallback.script,
      hook: truncateText(normalizeText(parsed.hook), 1000) || fallback.hook,
      productFeatures: normalizeStringArray(parsed.productFeatures || parsed.featureList || parsed.features).slice(0, 8),
      productMechanism: truncateText(normalizeText(parsed.productMechanism), 1200) || fallback.productMechanism,
      storyboardFormula: normalizeStringArray(parsed.storyboardFormula || parsed.storyboard || parsed.shotFormula).slice(0, 6),
      reusableTemplate: truncateText(normalizeText(parsed.reusableTemplate), 1600) || fallback.reusableTemplate,
      onScreenTextOriginal: truncateText(normalizeText(parsed.onScreenTextOriginal), 240) || semanticVisualTextSegments[0]?.original || "",
      onScreenTextZh: truncateText(normalizeText(parsed.onScreenTextZh), 240) || semanticVisualTextSegments[0]?.zh || "",
      visualTextSegments: semanticVisualTextSegments.length
        ? semanticVisualTextSegments
        : normalizeVisualTextSegments(parsed.visualTextSegments, Number(shot.duration) || null),
      keyMoments: normalizeStringArray(parsed.keyMoments).slice(0, 5),
      rewriteAngles: []
    };
    return singleBeatHint.isSingleBeat
      ? collapseSingleBeatAnalysis(base, shot, singleBeatHint)
      : base;
  } catch (error) {
    return {
      ...fallback,
      structureError: error instanceof Error ? error.message : String(error)
    };
  }
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
  return {
    schema: MATERIAL_ANALYSIS_SCHEMA,
    source: normalizeText(context.source) || "normal_tiktok_video",
    status: analysis.structureError ? "needs_review" : "completed",
    cardTitle: truncateText(normalizeText(analysis.cardTitle || fallback.cardTitle), 80),
    cardSummary: truncateText(normalizeText(analysis.cardSummary || fallback.cardSummary), 260),
    videoStory: truncateText(normalizeText(analysis.videoStory || fallback.videoStory), 900),
    script: truncateText(normalizeText(analysis.script || fallback.script), 5000),
    hook: truncateText(normalizeText(analysis.hook || fallback.hook), 1000),
    productFeatures: normalizeStringArray(analysis.productFeatures || analysis.featureList || analysis.features || fallback.productFeatures).slice(0, 8),
    productMechanism: truncateText(normalizeText(analysis.productMechanism || fallback.productMechanism), 1200),
    storyboardFormula: normalizeStringArray(analysis.storyboardFormula || analysis.storyboard || analysis.shotFormula || fallback.storyboardFormula).slice(0, 8),
    reusableTemplate: truncateText(normalizeText(analysis.reusableTemplate || fallback.reusableTemplate), 1600),
    onScreenTextOriginal: truncateText(normalizeText(analysis.onScreenTextOriginal || fallback.onScreenTextOriginal), 240),
    onScreenTextZh: truncateText(normalizeText(analysis.onScreenTextZh || fallback.onScreenTextZh), 240),
    visualTextSegments,
    keyMoments: normalizeStringArray(analysis.keyMoments || fallback.keyMoments).slice(0, 6),
    structureError: truncateText(normalizeText(analysis.structureError || ""), 600),
    generatedAt: normalizeText(context.generatedAt) || now()
  };
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

function collapseSingleBeatAnalysis(analysis, shot, hint) {
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
    ? `分镜 1：整条视频基本只有一个镜头/信息点，用同一段大字文案${appName ? `和 ${appName} 相关画面` : ""}表达：${text}`
    : "分镜 1：整条视频基本只有一个镜头/信息点，没有明确的二次转场或独立步骤。";
  const singleMoment = `0s-${Number(hint.duration.toFixed(1))}s：${text || "单镜头信息表达"}`;
  return {
    ...analysis,
    videoStory: truncateText(
      normalizeText(analysis.videoStory || analysis.cardSummary || singleStep)
        .replace(/(^|。)(开头|中间|随后|接着|最后)[^。]*?/g, "$1")
        .trim() || singleStep,
      800
    ),
    storyboardFormula: [singleStep],
    reusableTemplate: singleStep,
    keyMoments: [singleMoment]
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
