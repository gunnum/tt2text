import {
  CODEX_HIGHLIGHT_TIMEOUT_MS,
  HIGHLIGHT_BREAKDOWN_MAX,
  HIGHLIGHT_BREAKDOWN_MIN,
  HIGHLIGHT_SCHEMA_VERSION,
  HIGHLIGHT_SCENE_MAX
} from "./constants.mjs";

export function createHighlightAnalysis({
  normalizeText,
  truncateText,
  runCodexJsonTask,
  codexHighlightTimeoutMs
} = {}) {
  if (typeof normalizeText !== "function" || typeof truncateText !== "function") {
    throw new Error("createHighlightAnalysis 缺少依赖：normalizeText/truncateText");
  }

  async function buildCodexHighlightBreakdowns(category, videos = []) {
    const candidates = pickHighlightVideos(videos);
    if (!candidates.length) return { highlightSchemaVersion: HIGHLIGHT_SCHEMA_VERSION, provider: "none", items: [] };
    if (typeof runCodexJsonTask !== "function") {
      return { highlightSchemaVersion: HIGHLIGHT_SCHEMA_VERSION, provider: "heuristic", items: fallbackHighlightBreakdowns(candidates) };
    }
    const prompt = buildHighlightBreakdownPrompt(category, candidates);
    try {
      const content = await runCodexJsonTask(prompt, Number(codexHighlightTimeoutMs) || CODEX_HIGHLIGHT_TIMEOUT_MS);
      const parsed = JSON.parse(extractJsonObject(content));
      const items = normalizeCodexHighlightPayload(parsed, candidates);
      return {
        highlightSchemaVersion: HIGHLIGHT_SCHEMA_VERSION,
        provider: "local-codex",
        items: items.length ? items : fallbackHighlightBreakdowns(candidates)
      };
    } catch (error) {
      return {
        highlightSchemaVersion: HIGHLIGHT_SCHEMA_VERSION,
        provider: "heuristic",
        error: error instanceof Error ? error.message : String(error),
        items: fallbackHighlightBreakdowns(candidates)
      };
    }
  }

  function pickHighlightVideos(videos = []) {
    const positive = videos.filter((video) => Number(video.interactionScore) > 0);
    const source = positive.length ? positive : videos;
    return source.slice(0, Math.min(HIGHLIGHT_BREAKDOWN_MAX, Math.max(HIGHLIGHT_BREAKDOWN_MIN, source.length)));
  }

  function buildHighlightBreakdownPrompt(category, videos = []) {
    return [
      "你是短视频广告拆解专家。请只基于输入的视频元数据、脚本摘要、hook 和互动数据，挑出每条高互动视频最值得学习的高光分镜。",
      "不要调用外部模型，不要编造不可见画面；如果输入不足，就基于已给 hook/脚本/标题做保守拆解。",
      "返回严格 JSON，不要 Markdown，不要代码块。",
      "JSON 格式：",
      JSON.stringify({
        highlightSchemaVersion: HIGHLIGHT_SCHEMA_VERSION,
        items: [{
          id: "视频ID",
          storySummary: "剧情简介：这条视频怎么展开，以及为什么这个叙事成立，≤160字",
          hooks: [{ text: "Hook 原句/动作/反差点，≤60字", grab: "抓用户的原因，≤80字" }],
          highlightScenes: [{ moment: "权威开场/替代动作等", scene: "画面/段落≤70字", why: "为什么抓人≤80字", learn: "怎么迁移≤70字" }]
        }]
      }),
      "",
      "约束：",
      "- 每条视频最多 5 个高光分镜；根据实际信息量决定数量，不要硬凑。",
      "- hooks 写这个视频包含几个 Hook，以及每个 Hook 抓用户的是什么；不要拆成“原句/机制”两段字段。",
      "- 旧字段 hookOriginal、hookMechanism、overallWin、learn 仅用于兼容旧缓存；新 JSON 不要主动输出这些字段。",
      "- 语言要具体，避免“节奏好、内容好”这类空话。",
      "- 不展示互动分；只围绕原始赞评分享播放数据解释内容。",
      "- 标题保持干净，不要把 hashtag 或平台标签写进标题。",
      "- 适合页面卡片展示，整体精炼。",
      "- items 按输入顺序返回。",
      "",
      "垂类：" + (category.label || category.id || ""),
      "视频：",
      JSON.stringify(videos.map((video) => ({
        id: video.id,
        title: video.title,
        appName: video.appName,
        authorName: video.authorName,
        accountType: video.accountType,
        scriptType: video.scriptType,
        exposureLevel: video.exposureLevel,
        interactionScore: video.interactionScore,
        metrics: video.metrics,
        hook: video.hook,
        summary: video.summary,
        script: truncateText(video.script, 700),
        productFeatures: video.productFeatures
      })), null, 2)
    ].join("\n");
  }

  function normalizeCodexHighlightPayload(payload, videos = []) {
    const byId = new Map(videos.map((video) => [video.id, video]));
    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    return rawItems.map((item) => {
      const video = byId.get(normalizeText(item?.id)) || videos.find((candidate) => normalizeText(candidate.id) === normalizeText(item?.videoId));
      if (!video) return null;
      return normalizeHighlightItem({ ...item, video });
    }).filter(Boolean);
  }

  function normalizeHighlightBreakdowns(value, videos = []) {
    if (value && typeof value === "object" && Array.isArray(value.items)) {
      const videoById = new Map(videos.map((video) => [video.id, video]));
      return {
        highlightSchemaVersion: HIGHLIGHT_SCHEMA_VERSION,
        provider: value.provider || "cached",
        error: value.error || "",
        items: value.items.map((item) => normalizeHighlightItem({
          ...item,
          video: item.video || videoById.get(item.id)
        })).filter(Boolean)
      };
    }
    return {
      highlightSchemaVersion: HIGHLIGHT_SCHEMA_VERSION,
      provider: "heuristic",
      items: fallbackHighlightBreakdowns(pickHighlightVideos(videos))
    };
  }

  function normalizeHighlightItem(item = {}) {
    const video = item.video || {};
    const scenes = Array.isArray(item.highlightScenes) ? item.highlightScenes : [];
    const id = normalizeText(item.id || item.videoId || video.id);
    if (!id) return null;
    return {
      id,
      title: cleanVideoTitle(item.title || video.title),
      appName: normalizeText(item.appName || video.appName),
      appLogoUrl: normalizeText(item.appLogoUrl || video.appLogoUrl),
      authorName: normalizeText(item.authorName || video.authorName),
      authorAvatarUrl: normalizeText(item.authorAvatarUrl || item.authorAvatar || item.avatarUrl || item.profileImageUrl || video.authorAvatarUrl || video.authorAvatar || video.avatarUrl || video.profileImageUrl),
      accountAvatarUrl: normalizeText(item.accountAvatarUrl || video.accountAvatarUrl),
      followerCount: firstNumeric(item.followerCount, item.followers, item.fansCount, item.authorFollowerCount, item.authorFollowers, video.followerCount, video.followers, video.fansCount, video.authorFollowerCount, video.authorFollowers),
      accountType: normalizeText(item.accountType || video.accountType),
      scriptType: normalizeText(item.scriptType || video.scriptType),
      exposureLevel: normalizeText(item.exposureLevel || video.exposureLevel),
      interactionScore: Number(item.interactionScore ?? video.interactionScore ?? 0),
      metrics: item.metrics || video.metrics || {},
      shotUrl: normalizeText(item.shotUrl || video.shotUrl),
      sourceUrl: normalizeText(item.sourceUrl || video.sourceUrl),
      videoPath: normalizeText(item.videoPath || video.videoPath),
      posterPath: normalizeText(item.posterPath || video.posterPath),
      framePaths: normalizeFramePaths(item.framePaths || video.framePaths),
      transcriptZh: normalizeText(item.transcriptZh || video.transcriptZh),
      speechSubtitleZh: normalizeText(item.speechSubtitleZh || video.speechSubtitleZh),
      visualTextSegments: Array.isArray(item.visualTextSegments) ? item.visualTextSegments : (Array.isArray(video.visualTextSegments) ? video.visualTextSegments : []),
      bgmTitle: normalizeText(item.bgmTitle || video.bgmTitle || video.musicTrack || video.musicTitle || video.soundTitle),
      musicTrack: normalizeText(item.musicTrack || video.musicTrack || video.bgmTitle || video.musicTitle || video.soundTitle),
      musicTitle: normalizeText(item.musicTitle || video.musicTitle || video.musicTrack || video.bgmTitle || video.soundTitle),
      soundTitle: normalizeText(item.soundTitle || video.soundTitle || video.musicTrack || video.bgmTitle || video.musicTitle),
      musicArtist: normalizeText(item.musicArtist || video.musicArtist),
      audioKind: normalizeText(item.audioKind || video.audioKind || video.audioType),
      audioType: normalizeText(item.audioType || video.audioType || video.audioKind),
      isBgmOnly: Boolean(item.isBgmOnly ?? video.isBgmOnly),
      storySummary: truncateText(normalizeText(item.storySummary || item.overallWin), 180) || fallbackStorySummary(video),
      hooks: normalizeHooks(item.hooks || item.hookItems || item.hookList, video, item),
      highlightScenes: scenes.slice(0, HIGHLIGHT_SCENE_MAX).map((scene, index) => ({
        moment: truncateText(normalizeText(scene.moment), 24) || "高光分镜",
        scene: truncateText(normalizeText(scene.scene), 80),
        why: truncateText(normalizeText(scene.why), 95),
        learn: truncateText(normalizeText(scene.learn), 80),
        framePath: normalizeText(scene.framePath || scene.imagePath || scene.screenshotPath) || selectFramePath(item.framePaths || video.framePaths, index, item.posterPath || video.posterPath)
      })).filter((scene) => scene.scene || scene.why || scene.learn)
    };
  }

  function normalizeFramePaths(value) {
    return (Array.isArray(value) ? value : [])
      .map(normalizeText)
      .filter(Boolean)
      .filter((path, index, list) => list.indexOf(path) === index)
      .slice(0, 12);
  }

  function firstNumeric(...values) {
    const value = values.find((item) => Number.isFinite(Number(item)) && Number(item) >= 0);
    return value === undefined ? undefined : Number(value);
  }

  function selectFramePath(framePaths, index = 0, posterPath = "") {
    const normalized = normalizeFramePaths(framePaths);
    return normalized[index] || normalized[0] || normalizeText(posterPath);
  }

  function normalizeHooks(value, video = {}, legacy = {}) {
    const rawItems = Array.isArray(value) ? value : [];
    const items = rawItems.map((item) => {
      if (typeof item === "string") {
        return { text: truncateText(normalizeText(item), 80), grab: fallbackHookMechanism(video) };
      }
      return {
        text: truncateText(normalizeText(item?.text || item?.hook || item?.original || item?.line), 80),
        grab: truncateText(normalizeText(item?.grab || item?.why || item?.reason || item?.mechanism), 100)
      };
    }).filter((item) => item.text || item.grab).slice(0, 5);
    if (items.length) return items;
    const legacyHook = {
      text: truncateText(normalizeText(legacy.hookOriginal || legacy.hook), 80),
      grab: truncateText(normalizeText(legacy.hookMechanism || legacy.learn), 100)
    };
    return (legacyHook.text || legacyHook.grab) ? [legacyHook] : fallbackHooks(video);
  }

  function fallbackHighlightBreakdowns(videos = []) {
    return videos.map((video) => normalizeHighlightItem({
      video,
      storySummary: fallbackStorySummary(video),
      hooks: fallbackHooks(video),
      highlightScenes: [
        {
          moment: "开头 0-3s",
          scene: video.hook || video.title,
          why: "先用具体痛点或反差让用户停下，而不是直接讲产品。",
          learn: "开头先抛具体问题，再进入观点或功能证明。"
        },
        {
          moment: "中段证明",
          scene: video.summary || video.scriptType,
          why: "中段把承诺落到人群、场景或产品动作，降低空泛感。",
          learn: "用一个可见动作证明价值，别只罗列功能。"
        }
      ]
    }));
  }

  function fallbackHooks(video = {}) {
    return [{
      text: fallbackHookOriginal(video),
      grab: fallbackHookMechanism(video)
    }];
  }

  function fallbackStorySummary(video = {}) {
    return truncateText(video.summary || video.script || (video.accountType || "该账号") + "用「" + (video.scriptType || "高频脚本") + "」切入，先提出具体问题，再用产品或观点承接。", 180);
  }

  function fallbackHookOriginal(video = {}) {
    return video.hook || video.title || "脚本结构化信息不足，需回看视频人工复核。";
  }

  function fallbackHookMechanism(video = {}) {
    if (/强 App/.test(video.exposureLevel || "")) return "学习它把痛点快速落到 UI 路径和结果反馈。";
    if (/红人|内容/.test(video.accountType || "")) return "学习它先建立生活语境和观点信任，再轻带产品。";
    return "学习它用具体人群和具体场景承接卖点。";
  }

  return {
    buildCodexHighlightBreakdowns,
    buildHighlightBreakdownPrompt,
    normalizeCodexHighlightPayload,
    normalizeHighlightBreakdowns,
    normalizeHighlightItem,
    normalizeHooks,
    fallbackHighlightBreakdowns,
    pickHighlightVideos
  };
}

function extractJsonObject(content) {
  const fence = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);
  const text = String(content || "").trim()
    .replace(new RegExp("^" + fence + "(?:json)?\\s*", "i"), "")
    .replace(new RegExp("\\s*" + fence + "$", "i"), "")
    .trim();
  if (text.startsWith("{") && text.endsWith("}")) return text;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("找不到 JSON 对象。");
  return match[0];
}

function cleanVideoTitle(value) {
  return String(value || "")
    .replace(/#[\p{L}\p{N}_-]+/gu, "")
    .replace(/\s*[·|｜-]\s*(TikTok|Instagram|YouTube|Shorts|广告|Ad)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
