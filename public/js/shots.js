import { fetchJson } from "./core/http.js";
import { escapeAttribute, escapeHtml, shortenText } from "./core/format.js";
import { createAdShotVideoCard } from "./core/video-card.js";
import { bindUnifiedVideoPlayer, renderUnifiedVideoPlayer } from "./core/video-player.js";
import { getAnalysisProgressInfo } from "./core/analysis-progress.js";

const tabsEl = document.querySelector("#shot-tabs");
const reportSlotEl = document.querySelector("#report-card-slot");
const mappedAppsSlotEl = document.querySelector("#mapped-apps-slot");
const waterfallEl = document.querySelector("#shots-waterfall");
const analysisQueueCardEl = document.querySelector("#analysis-queue-card");
const analysisQueueDialogEl = document.querySelector("#analysis-queue-dialog");
const analysisQueueCloseEl = document.querySelector("#analysis-queue-close");
const analysisQueueSummaryEl = document.querySelector("#analysis-queue-summary");
const analysisQueueListEl = document.querySelector("#analysis-queue-list");
const shotPlayerDialogEl = document.querySelector("#shot-player-dialog");
const shotPlayerStageEl = document.querySelector("#shot-player-stage");
const shotPlayerTitleEl = document.querySelector("#shot-player-title");
const shotPlayerTitleLinkEl = document.querySelector("#shot-player-title-link");
const shotPlayerMetaEl = document.querySelector("#shot-player-meta");

const APP_CATEGORY_OPTIONS = ["dating社交", "熟人社交", "社区", "读书", "工具"];
const ACTIVE_ANALYSIS_STATUSES = new Set(["queued", "running"]);
let state = {
  apps: [],
  shots: [],
  categories: [],
  reports: [],
  activeCategory: "all",
  selectedAppIds: new Set(),
  queuePollTimer: null
};
let shotPlayerSubtitleCleanup = null;

async function loadPage() {
  const [apps, shots, reportIndex] = await Promise.all([
    fetchJson("/api/apps"),
    fetchJson("/api/ad-shots"),
    fetchJson("/api/report-output/video-categories")
  ]);
  state.apps = apps;
  state.shots = shots;
  state.reports = reportIndex.categories || [];
  state.categories = buildAppCategoryOptions(apps);
  render();
  startQueuePolling();
}

function render() {
  renderTabs();
  renderReportCard();
  renderMappedApps();
  renderShots();
  renderAnalysisQueue();
}

function renderTabs() {
  const tabs = [
    { id: "all", label: "全部" },
    ...state.categories.map((category) => ({ id: category, label: category }))
  ];
  tabsEl.innerHTML = tabs.map((tab) => `
    <button class="shot-tab" type="button" role="tab" aria-selected="${tab.id === state.activeCategory ? "true" : "false"}" data-category="${escapeAttribute(tab.id)}">
      ${escapeHtml(tab.label)}
    </button>
  `).join("");
  tabsEl.querySelectorAll(".shot-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeCategory = button.dataset.category || "all";
      state.selectedAppIds = new Set();
      render();
    });
  });
}

function renderReportCard() {
  if (state.activeCategory === "all") {
    reportSlotEl.innerHTML = `
      <div class="report-card">
        <div class="report-card-top">
          <div>
            <h2>视频总数</h2>
            <p>全部已收录短视频。</p>
          </div>
        </div>
        <div class="report-metrics">
          <span><b>${escapeHtml(state.shots.length || 0)}</b>视频总数</span>
        </div>
      </div>
    `;
    return;
  }
  const report = findActiveReport();
  if (!report) {
    reportSlotEl.innerHTML = `
      <div class="video-job-empty">
        当前类别还没有可用的垂类视频报告。
      </div>
    `;
    return;
  }
  reportSlotEl.innerHTML = `
    <a class="report-card" href="/reports/vertical-video.html?category=${encodeURIComponent(report.id)}">
      <div class="report-card-top">
        <div>
          <h2>${escapeHtml(report.label)}垂类视频推广分析</h2>
          <p>上次生成：${escapeHtml(report.lastAnalyzedAt ? formatDateTime(report.lastAnalyzedAt) : "未生成")}</p>
        </div>
        <span class="report-arrow" aria-hidden="true">${renderArrowIcon()}</span>
      </div>
      <div class="report-metrics">
        <span><b>${escapeHtml(report.videoCount || 0)}</b>视频总数</span>
        <span><b>${escapeHtml(formatNumber(report.addedSinceLastAnalysis || 0))}</b>距上次分析新增视频数</span>
        <span><b>${escapeHtml(formatNumber(countOver1kViews()))}</b>&gt;1k 播放的视频数</span>
      </div>
    </a>
  `;
}

function renderShots() {
  const visibleShots = filterShotsByActiveCategory();
  waterfallEl.innerHTML = "";
  if (!visibleShots.length) {
    waterfallEl.innerHTML = '<div class="video-job-empty">当前类别还没有视频。</div>';
    return;
  }
  const columnCount = getShotsColumnCount();
  const columns = Array.from({ length: columnCount }, () => {
    const column = document.createElement("div");
    column.className = "shots-waterfall-column";
    waterfallEl.appendChild(column);
    return column;
  });
  visibleShots.forEach((shot, index) => {
    columns[index % columnCount].appendChild(createAdShotVideoCard(shot, { from: "shots" }));
  });
  bindShotPlayerTriggers();
  bindDurationTags();
}

function getShotsColumnCount() {
  const width = window.innerWidth || document.documentElement.clientWidth || 1440;
  if (width <= 540) return 1;
  if (width <= 820) return 2;
  if (width <= 1180) return 3;
  return 4;
}

function renderMappedApps() {
  const apps = getActiveCategoryApps();
  if (!mappedAppsSlotEl) return;
  mappedAppsSlotEl.innerHTML = `
    <div class="mapped-apps">
      ${renderMappedAppAllOption()}
      ${apps.map(renderMappedAppLogo).join("") || '<span class="helper-text">当前 tab 没有映射 App。</span>'}
    </div>
  `;
  mappedAppsSlotEl.querySelectorAll("[data-app-filter]").forEach((button) => {
    button.addEventListener("click", () => toggleAppFilter(button.dataset.appFilter || "all"));
  });
}

function renderMappedAppAllOption() {
  const selected = state.selectedAppIds.size === 0;
  return `
    <button class="mapped-app-link mapped-app-all" type="button" data-app-filter="all" aria-pressed="${selected ? "true" : "false"}" title="全部 App" aria-label="全部 App">
      All
    </button>
  `;
}

function renderMappedAppLogo(app) {
  const name = app.name || app.fullName || app.id || "App";
  const logo = app.logoUrl || app.artworkUrl || app.iconUrl || "";
  const selected = state.selectedAppIds.has(String(app.id));
  return `
    <button class="mapped-app-link" type="button" data-app-filter="${escapeAttribute(app.id)}" aria-pressed="${selected ? "true" : "false"}" title="${escapeAttribute(name)}" aria-label="${escapeAttribute(name)}">
      ${logo ? `<img src="${escapeAttribute(logo)}" alt="${escapeAttribute(name)}" loading="lazy" referrerpolicy="no-referrer" />` : escapeHtml(name.slice(0, 1).toUpperCase())}
    </button>
  `;
}

function toggleAppFilter(appId) {
  if (appId === "all") {
    state.selectedAppIds = new Set();
    render();
    return;
  }
  const next = new Set(state.selectedAppIds);
  if (next.has(appId)) next.delete(appId);
  else next.add(appId);
  state.selectedAppIds = next;
  render();
}

function renderAnalysisQueue() {
  const queueItems = getAnalysisQueueItems();
  const runningCount = queueItems.filter((shot) => shot.analysisStatus === "running").length;
  const queuedCount = queueItems.filter((shot) => shot.analysisStatus === "queued").length;
  if (analysisQueueCardEl) {
    analysisQueueCardEl.hidden = queueItems.length === 0;
    analysisQueueCardEl.classList.toggle("is-active", queueItems.length > 0);
    analysisQueueCardEl.classList.toggle("is-idle", queueItems.length === 0);
    analysisQueueCardEl.innerHTML = `
      <strong>${escapeHtml(queueItems.length)} 个视频正在分析中</strong>
      <span>${escapeHtml(runningCount)} 个处理中，${escapeHtml(queuedCount)} 个排队等待</span>
    `;
  }
  if (analysisQueueSummaryEl) {
    analysisQueueSummaryEl.textContent = queueItems.length
      ? `${queueItems.length} 个视频在队列中：${runningCount} 个处理中，${queuedCount} 个排队等待。`
      : "当前没有分析任务。";
  }
  if (!analysisQueueListEl) return;
  analysisQueueListEl.innerHTML = queueItems.length
    ? queueItems.map(renderAnalysisQueueItem).join("")
    : '<div class="video-job-empty">当前没有排队或正在分析的视频。</div>';
}

function renderAnalysisQueueItem(shot) {
  const shotId = shot.shotId || shot.id || "";
  const title = shot.analysis?.cardTitle || shot.readableTitle || shot.title || shot.highlight || "未命名视频";
  const href = shotId ? `/videos/detail.html?source=shot&id=${encodeURIComponent(shotId)}&from=shots` : "#";
  const status = normalizeAnalysisStatus(shot.analysisStatus);
  const progress = shot.analysisProgress || {};
  const progressInfo = getAnalysisProgressInfo({
    status,
    stageKey: progress.stageKey,
    stageLabel: progress.stageLabel || shot.analysisStage,
    message: progress.message
  });
  const stage = progressInfo.label;
  const message = progress.message || shot.analysisError || "等待下一步进度。";
  const appName = shot.app?.name || shot.appDisplay || shot.appName || shot.brandName || shot.targetApp || "未标注 App";
  const updatedAt = progress.updatedAt || shot.updatedAt || shot.analysisStartedAt || shot.analysisQueuedAt || "";
  return `
    <article class="analysis-queue-item">
      <div class="analysis-queue-item-top">
        <div>
          <h3><a href="${escapeAttribute(href)}">${escapeHtml(shortenText(title, 92))}</a></h3>
          <p class="analysis-queue-meta">${escapeHtml(appName)}${updatedAt ? ` · ${escapeHtml(updatedAt)}` : ""}</p>
        </div>
        <span class="analysis-queue-status ${escapeAttribute(status)}">${escapeHtml(formatAnalysisStatus(status))}</span>
      </div>
      <div class="analysis-progress-meta">
        <span class="analysis-progress-step">${escapeHtml(progressInfo.shortText)}</span>
        <span class="analysis-progress-label">${escapeHtml(stage)}</span>
      </div>
      <div class="analysis-progress-track" aria-label="${escapeAttribute(progressInfo.fullText)}">
        <div class="analysis-progress-bar" style="width:${escapeAttribute(progressWidthForStatus(status, progress.stageKey))}%"></div>
      </div>
      <p class="analysis-queue-message">${escapeHtml(message)}</p>
    </article>
  `;
}

function getAnalysisQueueItems() {
  return state.shots
    .filter((shot) => ACTIVE_ANALYSIS_STATUSES.has(normalizeAnalysisStatus(shot.analysisStatus)))
    .sort(compareAnalysisQueueItems);
}

function compareAnalysisQueueItems(a, b) {
  const rank = { running: 0, queued: 1 };
  const statusDiff = (rank[normalizeAnalysisStatus(a.analysisStatus)] ?? 9) - (rank[normalizeAnalysisStatus(b.analysisStatus)] ?? 9);
  if (statusDiff) return statusDiff;
  return Date.parse(b.analysisStartedAt || b.analysisQueuedAt || b.updatedAt || "") - Date.parse(a.analysisStartedAt || a.analysisQueuedAt || a.updatedAt || "");
}

function normalizeAnalysisStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function formatAnalysisStatus(status) {
  if (status === "running") return "分析中";
  if (status === "queued") return "排队中";
  return "等待中";
}

function progressWidthForStatus(status, stageKey = "") {
  const progress = getAnalysisProgressInfo({ status, stageKey });
  if (status === "queued") return Math.max(10, progress.percent);
  return progress.percent;
}

function findActiveReport() {
  if (state.activeCategory === "all") {
    return state.reports.find((report) => report.id === "reading") || state.reports[0] || null;
  }
  const appCategoryReportId = appCategoryReportIdForLabel(state.activeCategory);
  return state.reports.find((report) => report.id === appCategoryReportId)
    || state.reports.find((report) => report.source === "app_category" && report.appCategoryLabel === state.activeCategory)
    || state.reports.find((report) => report.label === state.activeCategory)
    || null;
}

function filterShotsByActiveCategory() {
  const shots = [...state.shots].sort(compareShotTime);
  const categoryShots = state.activeCategory === "all"
    ? shots
    : shots.filter((shot) => resolveShotCategories(shot).includes(state.activeCategory));
  if (!state.selectedAppIds.size) return categoryShots;
  return categoryShots.filter((shot) => {
    const app = findShotApp(shot);
    const ids = [shot.appId, shot.app?.id, shot.app?.trackId, app?.id].map((item) => String(item || "").trim()).filter(Boolean);
    return ids.some((id) => state.selectedAppIds.has(id));
  });
}

function getActiveCategoryApps() {
  if (state.activeCategory === "all") {
    return state.apps;
  }
  return state.apps.filter((app) => resolveAppCategories(app).includes(state.activeCategory));
}

function countOver1kViews() {
  return filterShotsByActiveCategory().filter((shot) => {
    const count = Number(shot.metrics?.viewCount || shot.raw?.metrics?.view || shot.raw?.performance?.view || shot.viewCount || 0);
    return Number.isFinite(count) && count > 1000;
  }).length;
}

function displayCategoriesForShot(shot) {
  const categories = resolveShotCategories(shot);
  if (state.activeCategory !== "all" && categories.includes(state.activeCategory)) {
    return [state.activeCategory];
  }
  return categories;
}

function resolveShotCategories(shot) {
  const app = findShotApp(shot);
  return Array.from(new Set([
    ...resolveAppCategories(app || {}),
    ...(Array.isArray(shot.appCategoriesSynced) ? shot.appCategoriesSynced : [])
  ].map((item) => String(item || "").trim()).filter(Boolean)));
}

function findShotApp(shot) {
  const ids = [shot.appId, shot.app?.id, shot.app?.trackId, shot.app?.bundleId].map((item) => String(item || "").trim()).filter(Boolean);
  const byId = state.apps.find((app) => ids.includes(String(app.id || "")) || ids.includes(String(app.trackId || "")) || ids.includes(String(app.bundleId || "")));
  if (byId) return byId;
  const names = [shot.app?.name, shot.app?.fullName, shot.appDisplay, shot.appName, shot.brandName, shot.targetApp]
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);
  return state.apps.find((app) => [app.name, app.fullName, app.appName]
    .map((item) => String(item || "").trim().toLowerCase())
    .some((name) => name && names.includes(name)));
}

function buildAppCategoryOptions(apps) {
  const appCategories = new Set(apps.flatMap(resolveAppCategories));
  const extraCategories = Array.from(appCategories)
    .filter((category) => !APP_CATEGORY_OPTIONS.includes(category))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  return [...APP_CATEGORY_OPTIONS, ...extraCategories];
}

function resolveAppCategories(app = {}) {
  return Array.from(new Set([
    ...(Array.isArray(app.categories) ? app.categories : []),
    app.category
  ].map((item) => String(item || "").trim()).filter(Boolean)));
}

function appCategoryReportIdForLabel(label) {
  const report = state.reports.find((item) => item.source === "app_category" && item.appCategoryLabel === label);
  return report?.id || "";
}

function compareShotTime(a, b) {
  return Date.parse(b.createdAt || b.capturedAt || b.updatedAt || "") - Date.parse(a.createdAt || a.capturedAt || a.updatedAt || "");
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number).toLocaleString("zh-CN") : "0";
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value || "";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatShortDuration(value) {
  const totalSeconds = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function renderArrowIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 12h14"></path>
      <path d="m12 5 7 7-7 7"></path>
    </svg>
  `;
}

function bindAnalysisQueueDialog() {
  analysisQueueCardEl?.addEventListener("click", openAnalysisQueueDialog);
  analysisQueueCloseEl?.addEventListener("click", closeAnalysisQueueDialog);
  analysisQueueDialogEl?.addEventListener("click", (event) => {
    const card = analysisQueueDialogEl.querySelector(".analysis-queue-card-panel");
    if (card && !card.contains(event.target)) closeAnalysisQueueDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && analysisQueueDialogEl?.open) closeAnalysisQueueDialog();
  });
}

function bindShotPlayerTriggers() {
  waterfallEl?.querySelectorAll(".video-job-trigger").forEach((button) => {
    button.addEventListener("click", () => {
      const shotId = button.dataset.shotId || "";
      const shot = state.shots.find((item) => String(item.shotId || item.id || "") === shotId) || null;
      openShotPlayer({
        shotId,
        title: button.dataset.title || "视频预览",
        videoPath: button.dataset.videoPath || "",
        posterPath: button.dataset.posterPath || "",
        detailUrl: button.dataset.shotUrl || "",
        shot
      });
    });
  });
}

function bindDurationTags() {
  waterfallEl?.querySelectorAll(".video-job-media-tag.is-pending[data-video-path]").forEach((tag) => {
    const videoPath = tag.dataset.videoPath || "";
    if (!videoPath || tag.dataset.bound === "true") return;
    tag.dataset.bound = "true";
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.playsInline = true;
    probe.src = videoPath;
    const cleanup = () => {
      probe.removeAttribute("src");
      probe.load();
    };
    probe.addEventListener("loadedmetadata", () => {
      const duration = Number(probe.duration || 0);
      if (duration > 0) {
        tag.textContent = formatShortDuration(duration);
        tag.classList.remove("is-pending");
      } else {
        tag.remove();
      }
      cleanup();
    }, { once: true });
    probe.addEventListener("error", () => {
      tag.remove();
      cleanup();
    }, { once: true });
  });
}

function openShotPlayer({ shotId = "", title = "", videoPath = "", posterPath = "", detailUrl = "", shot = null } = {}) {
  if (!shotPlayerDialogEl || !shotPlayerStageEl) return;
  if (typeof shotPlayerSubtitleCleanup === "function") {
    shotPlayerSubtitleCleanup();
    shotPlayerSubtitleCleanup = null;
  }
  shotPlayerTitleEl.textContent = title || "视频预览";
  if (shotPlayerTitleLinkEl) {
    if (detailUrl) {
      shotPlayerTitleLinkEl.href = detailUrl;
      shotPlayerTitleLinkEl.classList.remove("is-disabled");
      shotPlayerTitleLinkEl.setAttribute("aria-label", `打开详情：${title || "视频预览"}`);
    } else {
      shotPlayerTitleLinkEl.href = "#";
      shotPlayerTitleLinkEl.classList.add("is-disabled");
      shotPlayerTitleLinkEl.removeAttribute("aria-label");
    }
  }
  shotPlayerMetaEl.textContent = shotId || detailUrl || "";
  shotPlayerStageEl.innerHTML = renderUnifiedVideoPlayer({
    videoPath,
    posterPath,
    coverPath: posterPath,
    title,
    item: shot || {},
    emptyLabel: "当前素材没有可播放视频。"
  });
  if (videoPath) {
    shotPlayerSubtitleCleanup = bindUnifiedVideoPlayer(shotPlayerStageEl, {
      item: shot || {},
      duration: Number(shot?.duration || shot?.media?.duration || 0)
    });
  }
  if (typeof shotPlayerDialogEl.showModal === "function") {
    shotPlayerDialogEl.showModal();
  } else {
    shotPlayerDialogEl.setAttribute("open", "");
  }
}

function closeShotPlayer() {
  if (typeof shotPlayerSubtitleCleanup === "function") {
    shotPlayerSubtitleCleanup();
    shotPlayerSubtitleCleanup = null;
  }
  const media = shotPlayerStageEl?.querySelector("video");
  if (media) {
    media.pause();
    media.removeAttribute("src");
    media.load();
  }
  if (shotPlayerStageEl) {
    shotPlayerStageEl.innerHTML = "";
  }
  shotPlayerDialogEl?.close?.();
  shotPlayerDialogEl?.removeAttribute("open");
}

function openAnalysisQueueDialog() {
  renderAnalysisQueue();
  if (typeof analysisQueueDialogEl?.showModal === "function") {
    analysisQueueDialogEl.showModal();
  } else {
    analysisQueueDialogEl?.setAttribute("open", "");
  }
}

function closeAnalysisQueueDialog() {
  analysisQueueDialogEl?.close?.();
  analysisQueueDialogEl?.removeAttribute("open");
}

function startQueuePolling() {
  stopQueuePolling();
  scheduleQueuePoll(getAnalysisQueueItems().length ? 3000 : 12000);
}

function scheduleQueuePoll(delayMs) {
  stopQueuePolling();
  state.queuePollTimer = window.setTimeout(async () => {
    try {
      const shots = await fetchJson("/api/ad-shots");
      state.shots = Array.isArray(shots) ? shots : [];
      renderAnalysisQueue();
      scheduleQueuePoll(getAnalysisQueueItems().length ? 3000 : 12000);
    } catch {
      scheduleQueuePoll(12000);
    }
  }, delayMs);
}

function stopQueuePolling() {
  if (state.queuePollTimer) {
    window.clearTimeout(state.queuePollTimer);
    state.queuePollTimer = null;
  }
}

bindAnalysisQueueDialog();
shotPlayerDialogEl?.addEventListener("click", (event) => {
  const panel = shotPlayerDialogEl.querySelector(".shot-player-panel");
  if (panel && !panel.contains(event.target)) closeShotPlayer();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && shotPlayerDialogEl?.open) closeShotPlayer();
});
loadPage().catch((error) => {
  if (waterfallEl) {
    waterfallEl.innerHTML = `<div class="video-job-empty">加载失败：${escapeHtml(error.message)}</div>`;
  }
});

window.addEventListener("resize", () => {
  window.clearTimeout(window.__shotsLayoutTimer);
  window.__shotsLayoutTimer = window.setTimeout(() => {
    renderShots();
  }, 120);
});
