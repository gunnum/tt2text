import { fetchJson } from "./core/http.js";
import { escapeAttribute, escapeHtml, sortByTime } from "./core/format.js";
import { setStatus, showToast } from "./core/ui.js";

const statusEl = document.querySelector("#status");
const shotEl = document.querySelector("#recent-shots");
const videoEl = document.querySelector("#recent-videos");
const toastEl = document.querySelector("#toast");

async function loadPage() {
  setStatus(statusEl, "正在加载社媒视频入口...");
  const [shots, videos] = await Promise.all([
    fetchJson("/api/ad-shots"),
    fetchJson("/api/results")
  ]);

  renderList(shotEl, sortByTime(shots, "createdAt").slice(0, 8), renderShotCard, "还没有 Ad Shots。");
  renderList(videoEl, sortByTime(videos, "createdAt").slice(0, 8), renderVideoCard, "还没有普通视频素材。");
  setStatus(statusEl, "社媒视频入口已刷新。");
}

  function renderShotCard(item) {
    const shotId = item.shotId || item.id || "";
    return `
      <article class="record-card">
        <h3>${escapeHtml(item.title || item.cardTitle || item.id || "Ad Shot")}</h3>
        <p>${escapeHtml(item.app?.name || item.brandName || item.rawBrandName || "未绑定 App")}</p>
        <div class="record-actions">
          <span class="video-job-badge">${escapeHtml(item.createdAt || "")}</span>
          ${shotId ? `<a class="video-job-action" href="/shots/${encodeURIComponent(shotId)}">详情页</a>` : ""}
        </div>
      </article>
    `;
  }

  function renderVideoCard(item) {
    return `
      <article class="record-card">
        <h3>${escapeHtml(item.title || "未命名视频")}</h3>
        <p>${escapeHtml(item.transcriptZh || item.visualSummary || "暂无中文内容。")}</p>
        <div class="record-actions">
          <span class="video-job-badge">${escapeHtml(item.createdAt || "")}</span>
          <a class="video-job-action" href="${escapeAttribute(item.hyperlink || item.sourceUrl || "#")}" target="_blank" rel="noreferrer">原链接</a>
        </div>
      </article>
    `;
  }

  function renderList(target, items, renderItem, emptyText) {
    target.innerHTML = "";
    if (!items.length) {
      target.innerHTML = `<div class="video-job-empty">${emptyText}</div>`;
      return;
    }
    target.innerHTML = items.map(renderItem).join("");
  }

loadPage().catch((error) => {
  setStatus(statusEl, `加载失败：${error.message}`);
  showToast(toastEl, `加载失败：${error.message}`);
});
