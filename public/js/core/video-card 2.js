import { escapeAttribute, escapeHtml, formatAppDisplayName } from "./format.js";

export function createAdShotVideoCard(shot, options = {}) {
  const shotId = shot.shotId || shot.id || "";
  const shotUrl = shotId ? buildVideoDetailUrl("shot", shotId, options) : "#";
  const coverPath = getAdShotCoverPath(shot);
  const title = formatAdShotTitle(shot);
  const appName = shot.app?.name || shot.targetApp || shot.brandName || shot.rawBrandName || "未识别 App";
  const analysisStatus = normalizeStatus(shot.analysisStatus || shot.status);
  const card = document.createElement("article");
  card.className = `video-job-card status-${analysisStatus || "completed"}`;
  card.innerHTML = `
    <a class="video-job-cover ${coverPath ? "" : "is-empty"}" href="${escapeAttribute(shotUrl)}" target="_blank" rel="noreferrer">
      ${coverPath
        ? `<img src="${escapeAttribute(coverPath)}" alt="${escapeAttribute(title + " 封面")}" loading="lazy" />`
        : "<span>Video</span>"}
      <div class="video-job-overlay">
        <p class="video-job-time">${escapeHtml(shot.createdAt || shot.updatedAt || "")}</p>
        <p class="video-job-app">${escapeHtml(formatAppDisplayName(appName))}</p>
        <p class="video-job-title">${escapeHtml(title)}</p>
        <p class="video-job-meta">${escapeHtml(shot.industryLabel || shot.industry || "视频素材")}</p>
        <div class="video-job-bottom">
          <span class="video-job-badge">视频</span>
          <span class="video-job-badge video-job-badge-status">${escapeHtml(formatAnalysisStatus(analysisStatus))}</span>
        </div>
      </div>
    </a>
  `;
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
  const fallbackImagePaths = [
    ...(Array.isArray(shot.imagePaths) ? shot.imagePaths : []),
    ...(Array.isArray(shot.image_paths) ? shot.image_paths : []),
    ...(Array.isArray(shot.analysisArtifacts?.imagePaths) ? shot.analysisArtifacts.imagePaths : [])
  ].filter(Boolean);
  return shot.analysisArtifacts?.firstFramePath
    || shot.firstFramePath
    || shot.first_frame_path
    || shot.media?.firstFramePath
    || shot.media?.posterPath
    || shot.posterPath
    || shot.poster_path
    || shot.coverUrl
    || shot.posterUrl
    || shot.imageUrl
    || fallbackImagePaths[0]
    || "";
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

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["queued", "running", "failed", "completed", "pending"].includes(status)) return status;
  return "completed";
}

function formatAnalysisStatus(status) {
  if (status === "failed") return "分析异常";
  if (status === "running") return "分析中";
  if (status === "queued") return "排队中";
  if (status === "pending") return "待分析";
  return "已完成";
}
