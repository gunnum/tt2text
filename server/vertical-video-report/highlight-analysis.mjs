import {
  CODEX_HIGHLIGHT_TIMEOUT_MS,
  HIGHLIGHT_BREAKDOWN_MAX,
  HIGHLIGHT_BREAKDOWN_MIN,
  HIGHLIGHT_SCHEMA_VERSION,
  HIGHLIGHT_SCENE_MAX
} from "./constants.mjs";
import { resolveVerticalVideoProfile } from "./analysis-profiles.mjs";

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
    const analyzable = videos.filter((video) => video.hasBaseAnalysis !== false && Array.isArray(video.storyboardScenes) && video.storyboardScenes.length);
    const positive = analyzable.filter((video) => Number(video.interactionScore) > 0);
    const source = positive.length ? positive : analyzable;
    return source.slice(0, Math.min(HIGHLIGHT_BREAKDOWN_MAX, Math.max(HIGHLIGHT_BREAKDOWN_MIN, source.length)));
  }

  function buildHighlightBreakdownPrompt(category, videos = []) {
    const profile = resolveVerticalVideoProfile(category);
    return [
      "你是垂类短视频研究员。输入已经包含统一的单视频基础分析和结构化分镜。",
      "你的任务只是在基础事实之上增加垂类点评，不能重新拆剧情、修改 Hook、增删分镜、修改时间或生成封面。",
      "不要调用外部模型，不要编造不可见画面。互动表现只能写成有证据的假设，不要宣称因果。",
      "返回严格 JSON，不要 Markdown，不要代码块。",
      "JSON 格式：",
      JSON.stringify({
        highlightSchemaVersion: HIGHLIGHT_SCHEMA_VERSION,
        items: [{
          id: "视频ID",
          baseAnalysisHash: "基础分析 Hash，原样返回",
          overallVerticalInsight: "这条视频在当前垂类中的主要研究价值，≤160字",
          performanceHypotheses: ["结合内容与互动数据提出的保守假设，最多3条"],
          hookInsight: "这个基础 Hook 在当前垂类中为什么值得关注，≤100字",
          sceneInsights: [{
            sceneId: "必须引用输入中的 sceneId",
            verticalWhyItWorks: "该分镜在当前垂类中的作用，≤100字",
            transferableLesson: "同垂类视频可以如何迁移，≤80字"
          }]
        }]
      }),
      "",
      "约束：",
      "- 每个基础分镜都返回一条 sceneInsights，数量和 sceneId 必须与输入一致。",
      "- 不要输出 storySummary、scene、moment、start、end、framePath、hooks.text 等基础事实字段。",
      "- 语言要具体，避免“节奏好、内容好”这类空话。",
      "- performanceHypotheses 可以参考赞评分享，但必须使用“可能、显示出、值得验证”等保守表达。",
      "- items 按输入顺序返回。",
      "",
      "垂类：" + (category.label || category.id || ""),
      "分析语境：" + profile.promptContext,
      "分析边界：只使用输入中出现的用户、场景、产品动作和结果；不要引入输入未出现的其他垂类概念。",
      "视频：",
      JSON.stringify(videos.map((video) => ({
        id: video.id,
        title: video.title,
        appName: video.appName,
        authorName: video.authorName,
        accountType: video.accountType,
        scriptType: video.scriptType,
        exposureLevel: video.exposureLevel,
        metrics: video.metrics,
        baseAnalysisHash: video.baseAnalysisHash,
        hook: video.hook,
        summary: video.summary,
        creativeStrategy: video.creativeStrategy,
        productFeatures: video.productFeatures,
        storyboardScenes: video.storyboardScenes.map((scene) => ({
          sceneId: scene.id,
          start: scene.start,
          end: scene.end,
          scene: scene.scene,
          role: scene.role,
          whyItWorks: scene.whyItWorks
        }))
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
    const baseScenes = Array.isArray(video.storyboardScenes) ? video.storyboardScenes : [];
    const sceneInsights = normalizeSceneInsights(item.sceneInsights || item.highlightScenes);
    const insightById = new Map(sceneInsights.filter((entry) => entry.sceneId).map((entry) => [entry.sceneId, entry]));
    const id = normalizeText(item.id || item.videoId || video.id);
    if (!id) return null;
    const legacyHooks = normalizeHooks(item.hooks || item.hookItems || item.hookList, video, item);
    const hookInsight = truncateText(normalizeText(item.hookInsight), 100) || legacyHooks[0]?.grab || fallbackHookMechanism(video);
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
      baseAnalysisHash: normalizeText(video.baseAnalysisHash || item.baseAnalysisHash),
      storySummary: fallbackStorySummary(video),
      overallVerticalInsight: truncateText(normalizeText(item.overallVerticalInsight || item.overallWin), 180),
      performanceHypotheses: normalizeStringArray(item.performanceHypotheses).slice(0, 3),
      hooks: [{ text: truncateText(normalizeText(video.hook), 80) || fallbackHookOriginal(video), grab: hookInsight }],
      highlightScenes: baseScenes.slice(0, HIGHLIGHT_SCENE_MAX).map((scene, index) => {
        const insight = insightById.get(scene.id) || sceneInsights[index] || {};
        return {
          sceneId: scene.id,
          start: scene.start,
          end: scene.end,
          moment: formatSceneRange(scene),
          scene: truncateText(normalizeText(scene.scene), 120),
          role: normalizeText(scene.role),
          why: truncateText(normalizeText(insight.verticalWhyItWorks || insight.why), 110) || fallbackSceneWhy(video, scene, index),
          learn: truncateText(normalizeText(insight.transferableLesson || insight.learn), 90) || fallbackSceneLearn(video, scene, index),
          frameTime: Number(scene.frameTime) || 0,
          framePath: normalizeText(scene.framePath) || selectFramePath(video.framePaths, index, video.posterPath)
        };
      })
    };
  }

  function normalizeSceneInsights(value) {
    return (Array.isArray(value) ? value : []).map((entry) => ({
      sceneId: normalizeText(entry?.sceneId || entry?.scene_id),
      verticalWhyItWorks: truncateText(normalizeText(entry?.verticalWhyItWorks || entry?.why), 110),
      transferableLesson: truncateText(normalizeText(entry?.transferableLesson || entry?.learn), 90)
    })).slice(0, HIGHLIGHT_SCENE_MAX);
  }

  function normalizeFramePaths(value) {
    return (Array.isArray(value) ? value : [])
      .map(normalizeText)
      .filter(Boolean)
      .filter((path, index, list) => list.indexOf(path) === index)
      .slice(0, 80);
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
      hookInsight: fallbackHookMechanism(video),
      overallVerticalInsight: "基础视频分析已完成，当前暂无额外垂类模型点评。"
    }));
  }

  function fallbackSceneWhy(video, scene, index) {
    if (index === 0 || scene.role === "hook" || scene.role === "problem") return fallbackOpeningWhy(video);
    if (scene.role === "cta") return "结尾把前面的内容承诺落到一个明确行动，是否有效仍需结合转化数据验证。";
    return fallbackMiddleWhy(video);
  }

  function fallbackSceneLearn(video, scene, index) {
    if (index === 0 || scene.role === "hook" || scene.role === "problem") return fallbackOpeningLearn(video);
    if (scene.role === "cta") return "CTA 应承接视频已经证明的结果，不要突然增加新的卖点。";
    return fallbackMiddleLearn(video);
  }

  function formatSceneRange(scene = {}) {
    const start = Number(scene.start);
    const end = Number(scene.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return `${formatSecond(start)}-${formatSecond(end)}s`;
    }
    return "分镜";
  }

  function normalizeStringArray(value) {
    if (typeof value === "string") return [normalizeText(value)].filter(Boolean);
    return (Array.isArray(value) ? value : []).map((item) => truncateText(normalizeText(item), 180)).filter(Boolean);
  }

  function formatSecond(value) {
    const number = Number(Number(value || 0).toFixed(2));
    return Number.isInteger(number) ? String(number) : String(number);
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
    const scriptType = video.scriptType || "";
    if (/好友动态|社交连接/.test(scriptType)) return "先给出好友关系、同频匹配或实时动态结果，再让产品机制自然出现。";
    if (/听歌数据|回顾/.test(scriptType)) return "把统计结果变成可分享、可比较的音乐身份，而不是只展示数字。";
    if (/场景点歌|播放控制/.test(scriptType)) return "用现场歌曲和人物反应证明点歌动作产生了即时结果。";
    if (/音乐身份|品味表达/.test(scriptType)) return "用具体歌曲、歌单或听歌习惯完成自我暴露，吸引同频用户回应。";
    if (/歌曲发现|求推荐/.test(scriptType)) return "用具体歌曲或氛围提出推荐需求，把评论区变成发现入口。";
    if (/强 App/.test(video.exposureLevel || "")) return "学习它把痛点快速落到 UI 路径和结果反馈。";
    if (/红人|内容/.test(video.accountType || "")) return "学习它先建立生活语境和观点信任，再轻带产品。";
    return "学习它用具体人群和具体场景承接卖点。";
  }

  function fallbackOpeningWhy(video = {}) {
    const scriptType = video.scriptType || "";
    if (/好友动态|社交连接/.test(scriptType)) return "先展示朋友、匹配或同频关系结果，用户会先对关系产生好奇。";
    if (/听歌数据|回顾/.test(scriptType)) return "用具体榜单、偏好或数据异常制造身份感和比较欲。";
    if (/场景点歌|播放控制/.test(scriptType)) return "具体歌曲响起后的现场反应本身就是剧情冲突。";
    if (/音乐身份|品味表达/.test(scriptType)) return "具体歌曲和听歌习惯能快速暴露人物状态与个性。";
    if (/歌曲发现|求推荐/.test(scriptType)) return "明确歌曲或氛围让观众马上知道自己能否参与推荐。";
    return "先用具体人物、场景、动作或结果让用户停下。";
  }

  function fallbackOpeningLearn(video = {}) {
    if (/好友动态|社交连接/.test(video.scriptType || "")) return "先给社交结果，再解释音乐产品如何促成这段连接。";
    if (/音乐|听歌|点歌|歌曲/.test(video.scriptType || "")) return "开头保留具体歌曲、歌手、数据或人物反应，不要先讲抽象定位。";
    return "开头先给真实问题或结果，再进入产品动作。";
  }

  function fallbackMiddleWhy(video = {}) {
    if (/好友动态|社交连接/.test(video.scriptType || "")) return "中段把关系结果落到查看动态、匹配、分享或聊天动作。";
    if (/听歌数据|回顾/.test(video.scriptType || "")) return "中段用统计卡片、榜单或对比证明数据确实属于这个用户。";
    if (/场景点歌|播放控制/.test(video.scriptType || "")) return "中段补足手机操作和现场播放之间的因果关系。";
    if (/音乐身份|品味表达/.test(video.scriptType || "")) return "中段用歌单、动态或具体歌曲继续强化人物音乐身份。";
    return "中段把承诺落到可见动作和结果，降低空泛感。";
  }

  function fallbackMiddleLearn(video = {}) {
    if (/音乐/.test(video.scriptType || "") || /点歌|听歌|好友动态|歌曲/.test(video.scriptType || "")) return "让音乐内容、人物关系和产品动作同时出现在同一段证明里。";
    return "用一个可见动作证明价值，避免只罗列功能。";
  }

  return {
    buildCodexHighlightBreakdowns,
    buildHighlightBreakdownPrompt,
    normalizeCodexHighlightPayload,
    normalizeHighlightBreakdowns,
    normalizeHighlightItem,
    normalizeHooks,
    normalizeSceneInsights,
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
