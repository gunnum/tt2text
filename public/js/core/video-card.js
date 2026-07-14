import { escapeAttribute, escapeHtml, formatAppDisplayName } from "./format.js";

export function createAdShotVideoCard(shot, options = {}) {
  const shotId = shot.shotId || shot.id || "";
  const shotUrl = shotId ? buildVideoDetailUrl("ttcc", shotId, options) : "#";
  const analysisStatus = getEffectiveAdShotAnalysisStatus(shot);
  const statusLabel = formatAnalysisStatus(analysisStatus);
  const coverPaths = getAdShotCoverPaths(shot);
  const coverPath = coverPaths[0] || "";
  const videoPath = getAdShotVideoPath(shot);
  const title = formatAdShotTitle(shot);
  const appName = shot.app?.name || shot.targetApp || shot.brandName || shot.rawBrandName || "未识别 App";
  const createdAt = shot.createdAt || shot.capturedAt || shot.updatedAt || "";
  const mediaTag = getAdShotMediaTag(shot, videoPath);
  const card = document.createElement("article");
  card.className = `video-job-card status-${escapeAttribute(analysisStatus || "completed")}`;
  card.innerHTML = `
    <button class="video-job-cover video-job-trigger ${coverPath ? "" : "is-empty"}" type="button" data-shot-id="${escapeAttribute(shotId)}" data-shot-url="${escapeAttribute(shotUrl)}" data-video-path="${escapeAttribute(videoPath)}" data-poster-path="${escapeAttribute(coverPath || "")}" data-title="${escapeAttribute(title)}" aria-label="播放 ${escapeAttribute(title)}">
      ${coverPath
        ? `<img src="${escapeAttribute(coverPath)}" alt="${escapeAttribute(title + " 封面")}" loading="lazy" />`
        : "<span>Ads</span>"}
      ${mediaTag
        ? `<span class="video-job-media-tag${mediaTag.pending ? " is-pending" : ""}"${mediaTag.pending ? ` data-video-path="${escapeAttribute(videoPath)}"` : ""}>${escapeHtml(mediaTag.text || "")}</span>`
        : ""}
    </button>
    <div class="video-job-panel">
      <a class="video-job-text-link" href="${escapeAttribute(shotUrl)}" target="_blank" rel="noreferrer">
        <p class="video-job-title video-job-title-dark">${escapeHtml(title)}</p>
        <p class="video-job-app video-job-app-dark">${escapeHtml(formatAppDisplayName(appName))}</p>
      </a>
      <div class="video-job-footer">
        <p class="video-job-time video-job-time-dark">${escapeHtml(createdAt)}</p>
        ${statusLabel ? `<span class="video-job-badge video-job-badge-status">${escapeHtml(statusLabel)}</span>` : ""}
      </div>
    </div>
  `;
  bindCoverFallback(card, coverPaths, title);
  return card;
}

export function createResultVideoCard(item, options = {}) {
  const coverPath = item.firstFramePath || item.coverUrl || "";
  const title = item.title || item.previewText || shortenUrl(item.sourceUrl || item.hyperlink || "未命名视频");
  const detailUrl = item.id ? buildVideoDetailUrl("normal", item.id, options) : (item.hyperlink || item.sourceUrl || "#");
  const card = document.createElement("article");
  card.className = "video-job-card status-completed";
  card.innerHTML = `
    <a class="video-job-cover ${coverPath ? "" : "is-empty"}" href="${escapeAttribute(detailUrl)}">
      ${coverPath
        ? `<img src="${escapeAttribute(coverPath)}" alt="${escapeAttribute(title + " 首帧")}" loading="lazy" />`
        : "<span>Video</span>"}
      <div class="video-job-overlay">
        <p class="video-job-time">${escapeHtml(item.createdAt || "")}</p>
        ${item.app?.name ? `<p class="video-job-app">${escapeHtml(formatAppDisplayName(item.app.name))}</p>` : ""}
        <p class="video-job-title">${escapeHtml(title)}</p>
        <p class="video-job-meta">${escapeHtml((item.transcriptZh || item.visualSummary || "普通视频").slice(0, 80))}</p>
        <div class="video-job-bottom">
          <span class="video-job-badge">视频</span>
        </div>
      </div>
    </a>
  `;
  return card;
}

export function getAdShotCoverPath(shot) {
  return getAdShotCoverPaths(shot)[0] || "";
}

export function getAdShotCoverPaths(shot) {
  const mediaType = String(shot.mediaType || shot.media?.type || "").trim().toLowerCase();
  const isPhoto = mediaType === "photo" || /\/photo\//i.test(String(shot.sourceUrl || ""));
  const localImagePaths = [
    ...(Array.isArray(shot.media?.imagePaths) ? shot.media.imagePaths : []),
    ...(Array.isArray(shot.imagePaths) ? shot.imagePaths : []),
    ...(Array.isArray(shot.image_paths) ? shot.image_paths : []),
    ...(Array.isArray(shot.analysisArtifacts?.imagePaths) ? shot.analysisArtifacts.imagePaths : [])
  ].filter(Boolean);
  const inferredAnalysisPaths = inferAdShotAnalysisCoverPaths(shot);
  const analyzedFramePaths = [
    ...(Array.isArray(shot.analysisArtifacts?.visualFramePaths) ? shot.analysisArtifacts.visualFramePaths : []),
    ...(Array.isArray(shot.analysisArtifacts?.visualOcrFramePaths) ? shot.analysisArtifacts.visualOcrFramePaths : [])
  ].filter(Boolean);
  const videoCovers = [
    shot.media?.firstFramePath,
    shot.firstFramePath,
    shot.first_frame_path,
    shot.media?.posterPath,
    shot.posterPath,
    shot.analysisArtifacts?.firstFramePath,
    ...analyzedFramePaths,
    ...inferredAnalysisPaths,
    shot.media?.posterUrl,
    shot.coverUrl,
    shot.posterUrl,
    shot.imageUrl,
    ...localImagePaths
  ];
  const photoCovers = [
    ...localImagePaths,
    shot.media?.firstFramePath,
    shot.firstFramePath,
    shot.first_frame_path,
    shot.media?.posterPath,
    shot.posterPath,
    shot.analysisArtifacts?.firstFramePath,
    ...analyzedFramePaths,
    ...inferredAnalysisPaths,
    shot.media?.posterUrl,
    shot.coverUrl,
    shot.posterUrl,
    shot.imageUrl
  ];
  return uniqueTruthy(isPhoto ? photoCovers : videoCovers);
}

function inferAdShotAnalysisCoverPaths(shot = {}) {
  const shotId = String(shot.shotId || shot.id || "").trim();
  if (!shotId) return [];
  const base = `/data/ad-shots/${encodeURIComponent(shotId)}/analysis`;
  return [
    `${base}/first-frame.jpg`,
    `${base}/visual-frames/frame-01-0.00s.jpg`,
    `${base}/ocr-frames/ocr-frame-001-0.00s.jpg`
  ];
}

export function getAdShotVideoPath(shot) {
  return shot.videoPath
    || shot.media?.videoPath
    || shot.analysisArtifacts?.videoPath
    || (shot.shotId ? `/data/ad-shots/${encodeURIComponent(shot.shotId)}/analysis/video.mp4` : "");
}

export function getEffectiveAdShotAnalysisStatus(shot = {}) {
  const status = normalizeStatus(shot.analysisStatus || shot.status);
  if (status === "completed" && isCompletedWithPlaceholderAnalysis(shot)) {
    return hasAnalysisFailureSignal(shot) ? "failed" : "pending";
  }
  return status;
}

function bindCoverFallback(card, coverPaths, title) {
  const image = card.querySelector(".video-job-cover img");
  if (!image || coverPaths.length <= 1) return;
  let index = 0;
  image.addEventListener("error", () => {
    index += 1;
    const nextCoverPath = coverPaths[index] || "";
    if (!nextCoverPath) {
      image.remove();
      const cover = card.querySelector(".video-job-cover");
      cover?.classList.add("is-empty");
      if (cover && !cover.querySelector(":scope > span:not(.video-job-media-tag)")) {
        cover.insertAdjacentHTML("afterbegin", "<span>Ads</span>");
      }
      return;
    }
    image.src = nextCoverPath;
    image.alt = `${title} 封面`;
  });
}

function uniqueTruthy(values) {
  const seen = new Set();
  return values.filter((value) => {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

export function formatAdShotTitle(shot) {
  return shot.analysis?.cardTitle
    || shot.readableTitle
    || shot.highlight
    || shot.title
    || shot.cardTitle
    || shot.brandName
    || shot.rawBrandName
    || shot.shotId
    || shot.id
    || "Ad Shot";
}

function getAdShotMediaTag(shot, videoPath = "") {
  const mediaType = String(shot.mediaType || shot.media?.type || "").trim().toLowerCase();
  if (mediaType === "photo" || /\/photo\//i.test(String(shot.sourceUrl || ""))) {
    const pictureCount = getAdShotPictureCount(shot);
    return { text: `${pictureCount || 1} pics`, pending: false };
  }
  const duration = Number(shot.duration || shot.media?.duration || 0);
  if (duration > 0) {
    return { text: formatDuration(duration), pending: false };
  }
  if (videoPath) {
    return { text: "", pending: true };
  }
  return null;
}

function getAdShotPictureCount(shot) {
  const localCount = [
    ...(Array.isArray(shot.media?.imagePaths) ? shot.media.imagePaths : []),
    ...(Array.isArray(shot.imagePaths) ? shot.imagePaths : []),
    ...(Array.isArray(shot.image_paths) ? shot.image_paths : []),
    ...(Array.isArray(shot.analysisArtifacts?.imagePaths) ? shot.analysisArtifacts.imagePaths : [])
  ].filter(Boolean).length;
  if (localCount) return localCount;
  const rawCount = [
    ...(Array.isArray(shot.raw?.imageUrls) ? shot.raw.imageUrls : []),
    ...(Array.isArray(shot.raw?.image_urls) ? shot.raw.image_urls : [])
  ].filter((url) => /^https?:\/\//i.test(String(url || "")) && !/comment-sign|static-tx|tcc-config|webarch-solution|secsdk|tos-maliva-avt/i.test(String(url || ""))).length;
  return rawCount;
}

function formatDuration(value) {
  const totalSeconds = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatAnalysisStatus(status) {
  const map = {
    pending: "待分析",
    queued: "排队中",
    running: "分析中",
    failed: "分析异常"
  };
  return map[status] || "";
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  const map = {
    "待分析": "pending",
    "排队中": "queued",
    "分析中": "running",
    "分析异常": "failed",
    "失败": "failed",
    "完成": "completed",
    "分析完成": "completed"
  };
  return map[status] || status;
}

function hasAnalysisFailureSignal(shot = {}) {
  const progressKey = String(shot.analysisProgress?.stageKey || shot.analysis_stage_key || "").trim().toLowerCase();
  return Boolean(String(shot.analysisError || "").trim()) || progressKey === "completed_with_warning";
}

function isCompletedWithPlaceholderAnalysis(shot = {}) {
  if (!hasAnalysisFailureSignal(shot) && hasUsableAnalysisContent(shot)) return false;
  return !hasUsableAnalysisContent(shot);
}

function hasUsableAnalysisContent(shot = {}) {
  if (normalizeText(shot.transcriptZh || shot.transcript_zh || shot.visualSummary || shot.visual_summary)) return true;
  if (Array.isArray(shot.visualTextSegments) && shot.visualTextSegments.length > 0) return true;
  const analysis = shot.analysisSummary && typeof shot.analysisSummary === "object" ? shot.analysisSummary : {};
  const meaningfulFields = [
    analysis.videoStory,
    analysis.storySummary,
    analysis.cardSummary,
    analysis.script,
    analysis.hook,
    analysis.productMechanism,
    analysis.reusableTemplate,
    analysis.onScreenTextOriginal,
    analysis.onScreenTextZh
  ].map(normalizeText).filter(Boolean);
  if (meaningfulFields.some((value) => !isPlaceholderAnalysisText(value))) return true;
  return [
    analysis.productFeatures,
    analysis.storyboardFormula,
    analysis.visualTextSegments,
    analysis.keyMoments
  ].some((value) => Array.isArray(value) && value.length > 0);
}

function isPlaceholderAnalysisText(value) {
  const text = normalizeText(value);
  if (!text) return true;
  return /^等待(?:分析|接入|生成|识别|转写)/.test(text)
    || /^待(?:分析|生成|识别|转写)/.test(text)
    || text === "暂无素材拆解。";
}

function normalizeText(value) {
  return String(value || "").trim();
}

function shortenUrl(value) {
  const text = String(value || "");
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

function buildVideoDetailUrl(source, id, options = {}) {
  const params = new URLSearchParams({
    source,
    id
  });
  if (options.from) params.set("from", options.from);
  if (options.appId) params.set("appId", options.appId);
  return `/videos/detail.html?${params.toString()}`;
}
