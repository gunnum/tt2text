import { fetchJson } from "./core/http.js";
import { escapeAttribute, escapeHtml, formatAppDisplayName } from "./core/format.js";

const params = new URLSearchParams(window.location.search);
const videoId = params.get("id");
const detailEl = document.querySelector("#video-detail");

try {
  if (!videoId) {
    throw new Error("缺少视频 id。");
  }

  const results = await fetchJson("/api/results");
  const item = results.find((result) => result.id === videoId);
  if (!item) {
    throw new Error("没有找到这个视频。");
  }

  document.title = `${item.title || "视频详情"} - T2T`;
  detailEl.innerHTML = renderVideoDetail(item);
} catch (error) {
  detailEl.innerHTML = `
    <section class="panel detail-section">
      <h2>读取失败</h2>
      <p>${escapeHtml(error.message)}</p>
    </section>
  `;
}

function renderVideoDetail(item) {
  const title = item.title || item.sourceUrl || "未命名视频";
  const sourceUrl = item.hyperlink || item.sourceUrl || "";
  const appName = item.app?.name || "";
  const comments = normalizeComments(item.commentsRaw).slice(0, 40);
  const insights = normalizeInsights(item.commentInsights);
  return `
    <section class="video-detail-layout">
      <aside class="video-detail-cover">
        ${item.firstFramePath
          ? `<img src="${escapeAttribute(item.firstFramePath)}" alt="${escapeAttribute(title + " 首帧")}" />`
          : '<div class="empty">Video</div>'}
      </aside>
      <div class="video-detail-main">
        <section class="panel video-detail-head">
          <h1 class="video-detail-title">${escapeHtml(title)}</h1>
          <div class="video-detail-meta">
            ${appName ? `<span>${escapeHtml(formatAppDisplayName(appName))}</span>` : ""}
            ${item.createdAt ? `<span>${escapeHtml(item.createdAt)}</span>` : ""}
            ${item.publishedText || item.publishedAt ? `<span>${escapeHtml(item.publishedText || item.publishedAt)}</span>` : ""}
          </div>
          <div class="video-detail-actions">
            ${sourceUrl ? `<a class="system-link" href="${escapeAttribute(sourceUrl)}" target="_blank" rel="noreferrer">原链接</a>` : ""}
            ${appName && item.app?.id ? `<a class="system-link" href="/apps/app.html?id=${encodeURIComponent(item.app.id)}">App 详情</a>` : ""}
          </div>
        </section>
        ${renderEngagement(item.engagement)}
        ${renderTextSection("中文内容", item.transcriptZh || item.visualSummary)}
        ${renderTextSection("英文转写", item.transcriptEn)}
        ${renderTextSection("画面总结", item.visualSummary)}
        ${renderInsightSection(insights)}
        ${renderCommentSection(comments)}
      </div>
    </section>
  `;
}

function renderEngagement(engagement = {}) {
  const metrics = [
    ["播放", engagement.viewText || formatCount(engagement.viewCount)],
    ["点赞", engagement.likeText || formatCount(engagement.likeCount)],
    ["评论", engagement.commentText || formatCount(engagement.commentCount)],
    ["分享", engagement.shareText || formatCount(engagement.shareCount)]
  ].filter(([, value]) => value);
  if (!metrics.length) return "";
  return `
    <section class="metric-strip">
      ${metrics.map(([label, value]) => `
        <div class="metric-tile">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `).join("")}
    </section>
  `;
}

function renderTextSection(title, text) {
  const value = String(text || "").trim();
  if (!value) return "";
  return `
    <section class="panel detail-section">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(value)}</p>
    </section>
  `;
}

function renderInsightSection(insights) {
  if (!insights.length) return "";
  return `
    <section class="panel detail-section">
      <h2>评论洞察</h2>
      <ul class="insight-list">
        ${insights.map((insight) => `<li>${escapeHtml(insight)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function renderCommentSection(comments) {
  if (!comments.length) return "";
  return `
    <section class="panel detail-section">
      <h2>评论</h2>
      <ul class="comment-list">
        ${comments.map((comment) => `
          <li>
            ${comment.text ? `<p>${escapeHtml(comment.text)}</p>` : ""}
            ${renderCommentMedia(comment.media)}
            ${comment.meta ? `<small>${escapeHtml(comment.meta)}</small>` : ""}
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}

function renderCommentMedia(media = []) {
  if (!Array.isArray(media) || !media.length) return "";
  return `
    <div class="comment-media-grid">
      ${media.map((item) => {
        const imageUrl = item.localPath || item.sourceUrl;
        const analysis = item.analysis && typeof item.analysis === "object" ? item.analysis : {};
        const summary = analysis.summaryZh || analysis.userSignal || analysis.skippedReason || item.error || "";
        return imageUrl ? `
          <figure class="comment-media">
            <a href="${escapeAttribute(imageUrl)}" target="_blank" rel="noreferrer">
              <img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(item.alt || "评论图片")}" loading="lazy" />
            </a>
            ${summary ? `<figcaption>${escapeHtml(summary)}</figcaption>` : ""}
          </figure>
        ` : "";
      }).join("")}
    </div>
  `;
}

function normalizeInsights(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item.trim();
    return String(item?.point || item?.text || item?.summary || "").trim();
  }).filter(Boolean);
}

function normalizeComments(value) {
  const items = Array.isArray(value?.items) ? value.items : [];
  return items.map((item) => {
    const text = String(item?.text || item?.rawText || "").trim();
    const media = Array.isArray(item?.media) ? item.media.filter((mediaItem) => mediaItem?.localPath || mediaItem?.sourceUrl) : [];
    return {
      text,
      media,
      meta: [item?.author, item?.timeText, item?.likeText].filter(Boolean).join(" / ")
    };
  }).filter((item) => item.text || item.media.length);
}

function formatCount(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("zh-CN") : String(value);
}
