import {
  normalizeAdShotSourcePlatform
} from "../ad-shots/normalizers.mjs";
import {
  calculateInteractionScore,
  numericCount
} from "./interaction-score.mjs";
import {
  normalizeStringArray
} from "./category-resolver.mjs";

export function createVideoNormalizer({ normalizeText, truncateText } = {}) {
  if (typeof normalizeText !== "function" || typeof truncateText !== "function") {
    throw new Error("createVideoNormalizer 缺少依赖：normalizeText/truncateText");
  }

  function toReportVideo(shot) {
    const analysis = shot.analysis && typeof shot.analysis === "object" ? shot.analysis : {};
    const metrics = shot.metrics && typeof shot.metrics === "object" ? shot.metrics : {};
    const likeCount = numericCount(metrics.likeCount);
    const commentCount = numericCount(metrics.commentCount);
    const saveCount = numericCount(metrics.saveCount);
    const shareCount = numericCount(metrics.shareCount);
    const viewCount = numericCount(metrics.viewCount);
    const interactionScore = calculateInteractionScore({ likeCount, commentCount, shareCount });
    const script = normalizeText(analysis.script || analysis.videoStory || shot.storySummary || shot.transcriptZh || shot.transcriptOriginal);
    const title = normalizeText(analysis.cardTitle || shot.readableTitle || shot.title || shot.highlight || shot.sourceUrl);
    const summary = truncateText(normalizeText(analysis.cardSummary || shot.storySummary || shot.highlight || script), 260);
    const productFeatures = normalizeStringArray(analysis.productFeatures || analysis.featureList || analysis.features);
    const transcriptZh = normalizeText(shot.transcriptZh || shot.translation_zh || analysis.speechSubtitleZh || analysis.subtitleZh);
    const musicTrack = normalizeText(shot.musicTrack || shot.bgmTitle || shot.musicTitle || shot.soundTitle || shot.raw?.musicTrack || shot.raw?.bgmTitle || shot.raw?.track || analysis.musicTrack || analysis.bgmTitle || analysis.musicTitle || analysis.soundTitle);
    const musicArtist = normalizeText(shot.musicArtist || shot.soundArtist || shot.artist || shot.raw?.musicArtist || shot.raw?.artist || analysis.musicArtist || analysis.soundArtist);
    const audioKind = normalizeText(shot.audioKind || shot.audioType || shot.audio_kind || shot.audio_type || analysis.audioKind || analysis.audioType)
      || (musicTrack && !transcriptZh ? "bgm_only" : "");
    const authorAvatarUrl = normalizeText(shot.authorAvatarUrl || shot.authorAvatar || shot.avatarUrl || shot.profileImageUrl || shot.raw?.authorAvatarUrl || shot.raw?.authorAvatar || shot.raw?.avatarUrl || shot.raw?.profileImageUrl || shot.raw?.author?.avatarUrl || shot.raw?.author?.avatarThumb || shot.raw?.authorStats?.avatarUrl);
    const followerCount = firstNumeric(shot.followerCount, shot.followers, shot.fansCount, shot.authorFollowerCount, shot.authorFollowers, shot.raw?.followerCount, shot.raw?.followers, shot.raw?.fansCount, shot.raw?.authorFollowerCount, shot.raw?.authorFollowers, shot.raw?.author?.followerCount, shot.raw?.author?.followers, shot.raw?.authorStats?.followerCount, shot.raw?.authorStats?.followers);
    return {
      id: normalizeText(shot.shotId || shot.id || shot.sourceItemId || shot.sourceAdId || shot.sourceUrl),
      title: title || "未命名视频",
      appName: normalizeText(shot.app?.name || shot.appDisplay || shot.appName || shot.brandName || shot.targetApp) || "未标注 App",
      appLogoUrl: normalizeText(shot.app?.logoUrl || shot.appLogoUrl || shot.logoUrl),
      authorName: normalizeText(shot.authorName || shot.raw?.author || shot.brandName) || "未知作者",
      authorAvatarUrl,
      accountAvatarUrl: normalizeText(shot.accountAvatarUrl || shot.raw?.accountAvatarUrl),
      followerCount,
      sourcePlatform: normalizeAdShotSourcePlatform(shot),
      sourceLabel: normalizeText(shot.sourceDisplay || shot.sourceLabel) || "未标注来源",
      shotUrl: normalizeText(shot.shotUrl) || (shot.shotId ? "/shots/" + encodeURIComponent(shot.shotId) : ""),
      sourceUrl: normalizeText(shot.sourceUrl || shot.canonicalUrl),
      capturedAt: normalizeText(shot.createdAt || shot.capturedAt || shot.updatedAt || shot.analysisCompletedAt),
      analysisCompletedAt: normalizeText(shot.analysisCompletedAt),
      videoPath: normalizeText(shot.media?.videoPath || shot.videoPath),
      posterPath: normalizeText(shot.media?.posterPath || shot.posterPath || shot.media?.firstFramePath),
      framePaths: normalizeFramePaths(shot),
      transcriptZh,
      speechSubtitleZh: normalizeText(analysis.speechSubtitleZh || analysis.subtitleZh),
      visualTextSegments: normalizeVisualTextSegmentsForPlayer(shot.visualTextSegments || analysis.visualTextSegments, Number(shot.duration) || null),
      bgmTitle: musicTrack,
      musicTrack,
      musicTitle: musicTrack,
      soundTitle: musicTrack,
      musicArtist,
      audioKind,
      audioType: audioKind,
      isBgmOnly: Boolean(musicTrack && !transcriptZh),
      metrics: { likeCount, commentCount, saveCount, shareCount, viewCount },
      interactionScore,
      hook: truncateText(inferHook(script, shot), 160),
      summary,
      script: truncateText(script, 900),
      productFeatures: productFeatures.slice(0, 8),
      accountType: inferAccountType(shot),
      scriptType: inferScriptType(shot, script),
      exposureLevel: inferExposureLevel(shot, productFeatures, script)
    };
  }

  function inferAccountType(shot) {
    const author = normalizeText(shot.authorName || shot.raw?.author || shot.brandName).toLowerCase();
    const app = normalizeText(shot.app?.name || shot.appName || shot.brandName).toLowerCase();
    if (/founder|ceo|创始人|cliffweitzman/.test(author)) return "创始人/品牌人格号";
    if (normalizeAdShotSourcePlatform(shot) !== "tiktok") return "官方/品牌矩阵号";
    if (app && author && (author.includes(app) || app.includes(author))) return "官方 App 号";
    if (/app|official|team|hq|growth|challenge/.test(author)) return "官方/品牌矩阵号";
    return "红人/内容号";
  }

  function normalizeFramePaths(shot = {}) {
    return [
      ...(Array.isArray(shot.analysisArtifacts?.visualFramePaths) ? shot.analysisArtifacts.visualFramePaths : []),
      ...(Array.isArray(shot.analysisArtifacts?.visualOcrFramePaths) ? shot.analysisArtifacts.visualOcrFramePaths : []),
      ...(Array.isArray(shot.media?.imagePaths) ? shot.media.imagePaths : []),
      ...(Array.isArray(shot.imagePaths) ? shot.imagePaths : []),
      ...(Array.isArray(shot.image_paths) ? shot.image_paths : []),
      shot.media?.firstFramePath,
      shot.media?.posterPath,
      shot.posterPath
    ].map(normalizeText).filter(Boolean).filter((path, index, list) => list.indexOf(path) === index).slice(0, 12);
  }

  function normalizeVisualTextSegmentsForPlayer(value, duration = null) {
    const maxDuration = Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : null;
    return (Array.isArray(value) ? value : [])
      .map((item) => {
        const start = Math.max(0, Number(item?.start ?? item?.startTime ?? item?.from ?? item?.begin) || 0);
        let end = Number(item?.end ?? item?.endTime ?? item?.to ?? item?.until);
        if (!Number.isFinite(end) || end <= start) end = start + 2.5;
        const cappedEnd = maxDuration ? Math.min(maxDuration, end) : end;
        const original = truncateText(normalizeText(item?.original || item?.source || item?.text || item?.onScreenTextOriginal), 240);
        const zh = truncateText(normalizeText(item?.zh || item?.translationZh || item?.translation_zh || item?.translation || item?.onScreenTextZh), 240);
        const bbox = normalizeVisualTextBbox(item?.bbox || item?.box || item?.rect);
        return original || zh
          ? {
              start: Number(start.toFixed(2)),
              end: Number(Math.max(start + 0.5, cappedEnd).toFixed(2)),
              original,
              zh,
              ...(bbox ? { bbox } : {})
            }
          : null;
      })
      .filter(Boolean)
      .slice(0, 40);
  }

  function normalizeVisualTextBbox(value) {
    if (!value || typeof value !== "object") return null;
    const x = Number(value.x ?? value.left);
    const y = Number(value.y ?? value.top);
    const w = Number(value.w ?? value.width);
    const h = Number(value.h ?? value.height);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    return { x, y, w, h };
  }

  function firstNumeric(...values) {
    const value = values.find((item) => Number.isFinite(Number(item)) && Number(item) >= 0);
    return value === undefined ? undefined : Number(value);
  }

  function inferScriptType(shot, script) {
    const text = normalizeText([
      shot.title,
      shot.readableTitle,
      shot.highlight,
      shot.storySummary,
      script
    ].filter(Boolean).join(" ")).toLowerCase();
    if (/scroll|doom|social media|micro.?learning|micro learning|碎片|刷屏|短视频|微学习/.test(text)) return "替代刷屏/微学习";
    if (/tracker|tracking|progress|goal|calendar|stats|goodreads|记录|追踪|统计|目标|进度/.test(text)) return "读书管理/记录";
    if (/scan|ocr|adhd|dyslexia|listen|text to speech|pdf|朗读|扫描|拍照|倍速|注意力/.test(text)) return "痛点功能演示";
    if (/challenge|day \d+|days?|books? list|recommend|tbr|书单|挑战|每天|计划/.test(text)) return "主题书单/挑战";
    if (/youtube|podcast|sponsor|download|知识类|播客|赞助|安装入口/.test(text)) return "知识内容场景挂载";
    return "泛知识/观点口播";
  }

  function inferExposureLevel(shot, productFeatures, script) {
    const text = normalizeText([script, shot.storySummary, shot.highlight].join(" ")).toLowerCase();
    const app = normalizeText(shot.app?.name || shot.appName || shot.brandName).toLowerCase();
    if (productFeatures.length >= 4 || /界面|页面|app store|download|scan|listen|stats|progress/.test(text)) return "强 App 露出";
    if (app && text.includes(app.toLowerCase())) return "中 App 露出";
    if (productFeatures.length >= 1) return "中 App 露出";
    return "弱/无 App 露出";
  }

  function inferHook(script, shot) {
    const candidates = [
      script.split(/[。！？.!?]\s*/).find((item) => normalizeText(item).length >= 8),
      shot.highlight,
      shot.title
    ];
    return candidates.map(normalizeText).find(Boolean) || "脚本结构化信息不足，需回看视频人工复核。";
  }

  return {
    toReportVideo,
    inferAccountType,
    inferScriptType,
    inferExposureLevel,
    inferHook
  };
}
