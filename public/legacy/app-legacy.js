import { formatCliName } from "./js/core/agent.js";
import { formatChromeExtensionError, requestChromeExtension } from "./js/core/chrome-extension.js";
import {
  dedupeBatchItems,
  formatEngagementCount,
  formatEngagementLine,
  formatPublishedLine,
  guessBatchCandidateRelevance
} from "./js/core/engagement.js";
import { escapeAttribute, escapeHtml, formatAppDisplayName } from "./js/core/format.js";
import { setStatus as setStatusText, showToast as showToastMessage } from "./js/core/ui.js";

const form = document.querySelector("#convert-form");
const articleForm = document.querySelector("#article-form");
const articleSearchButton = document.querySelector("#article-search-button");
const articleSearchLimitSelect = document.querySelector("#article-search-limit");
const articleSearchStatus = document.querySelector("#article-search-status");
const appForm = document.querySelector("#app-form");
const appList = document.querySelector("#app-list");
const appEditToggle = document.querySelector("#app-edit-toggle");
const batchQueryInput = document.querySelector("#batch-query");
const batchLimitSelect = document.querySelector("#batch-limit");
const batchImportButton = document.querySelector("#batch-import-button");
const batchImportStatus = document.querySelector("#batch-import-status");
const statusEl = document.querySelector("#status");
const videoJobList = document.querySelector("#video-job-list");
const videoJobPagination = document.querySelector("#video-job-pagination");
const queueSizeInput = document.querySelector("#queue-size");
const resultsList = document.querySelector("#results-list");
const articlesList = document.querySelector("#articles-list");
const metricsList = document.querySelector("#metrics-list");
const template = document.querySelector("#result-template");
const articleTemplate = document.querySelector("#article-template");
const metricsTemplate = document.querySelector("#metrics-template");
const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
const resultTypeButtons = Array.from(document.querySelectorAll(".result-type-button"));
const resultTypePanels = Array.from(document.querySelectorAll(".content-type-panel"));
const favoritesEntryButton = document.querySelector("#favorites-entry");
const refreshTikTokCommentsButton = document.querySelector("#refresh-tiktok-comments");
const transcriptModal = document.querySelector("#transcript-modal");
const modalTitle = document.querySelector("#modal-title");
const modalEnglish = document.querySelector("#modal-english");
const modalChinese = document.querySelector("#modal-chinese");
const modalComments = document.querySelector("#modal-comments");
const modalInsights = document.querySelector("#modal-insights");
const modalMaterialAnalysis = document.querySelector("#modal-material-analysis");
const modalVisualText = document.querySelector("#modal-visual-text");
const modalClose = document.querySelector("#modal-close");
const resultsHeader = document.querySelector("#results-header");
const articlesHeader = document.querySelector("#articles-header");
const metricsHeader = document.querySelector("#metrics-header");
const resultsToolbar = document.querySelector("#results-toolbar");
const editToggle = document.querySelector("#edit-toggle");
const deleteSelectedButton = document.querySelector("#delete-selected");
const editCancelButton = document.querySelector("#edit-cancel");
const selectionSummary = document.querySelector("#selection-summary");
const toastEl = document.querySelector("#toast");
const failedJobCard = document.querySelector("#failed-job-card");
const failedJobCount = document.querySelector("#failed-job-count");
const ignoreFailedJobsButton = document.querySelector("#ignore-failed-jobs");
const retryFailedJobsButton = document.querySelector("#retry-failed-jobs");
const batchConfirmModal = document.querySelector("#batch-confirm-modal");
const batchConfirmTitle = document.querySelector("#batch-confirm-title");
const batchConfirmSummary = document.querySelector("#batch-confirm-summary");
const batchConfirmList = document.querySelector("#batch-confirm-list");
const batchConfirmClose = document.querySelector("#batch-confirm-close");
const batchConfirmCancel = document.querySelector("#batch-confirm-cancel");
const batchConfirmSubmit = document.querySelector("#batch-confirm-submit");
const batchSelectAll = document.querySelector("#batch-select-all");
const batchSelectNone = document.querySelector("#batch-select-none");
const batchSelectedCount = document.querySelector("#batch-selected-count");
const agentRefreshButton = document.querySelector("#agent-refresh");
const agentServerStatus = document.querySelector("#agent-server-status");
const agentServerDetail = document.querySelector("#agent-server-detail");
const agentLaunchStatus = document.querySelector("#agent-launch-status");
const agentLaunchDetail = document.querySelector("#agent-launch-detail");
const agentCliList = document.querySelector("#agent-cli-list");
const agentCommandList = document.querySelector("#agent-command-list");
const agentLogPaths = document.querySelector("#agent-log-paths");

function setStatus(message) {
  setStatusText(statusEl, message);
}

function showToast(message) {
  showToastMessage(toastEl, message);
}

let isEditMode = false;
let isAppEditMode = false;
let activeResultType = "videos";
let isFavoritesOnly = false;
let selectedIds = new Set();
let apps = [];
let currentResults = [];
let currentArticles = [];
let currentMetrics = [];
let currentVideoJobs = [];
let jobPollTimer = null;
let isLoadingVideoJobs = false;
let videoJobPage = 1;
const VIDEO_JOBS_PER_PAGE = 60;
const QUEUE_COLUMN_STORAGE_KEY = "tt2textQueueColumns";
let selectedAppId = "";
let pendingBatchReview = null;
const DEFAULT_BATCH_IMPORT_LIMIT = 60;
const MAX_BATCH_IMPORT_LIMIT = 200;

tabButtons.forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
});

resultTypeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activateResultType(button.dataset.resultType);
  });
});

favoritesEntryButton?.addEventListener("click", () => {
  isFavoritesOnly = !isFavoritesOnly;
  favoritesEntryButton.setAttribute("aria-pressed", String(isFavoritesOnly));
  favoritesEntryButton.classList.toggle("active", isFavoritesOnly);
  if (activeResultType !== "videos") {
    activateTab("results");
    activateResultType("videos");
    return;
  }
  renderResults(currentResults);
});

appEditToggle.addEventListener("click", () => {
  isAppEditMode = !isAppEditMode;
  renderApps(selectedAppId);
});

if (queueSizeInput) {
  queueSizeInput.addEventListener("input", () => {
    setQueueSizeValue(queueSizeInput.value);
  });
}

ignoreFailedJobsButton.addEventListener("click", async () => {
  await handleFailedJobsAction({
    endpoint: "/api/video-jobs/ignore-failed",
    pendingText: "正在忽略全部失败任务...",
    doneText: (payload) => `已忽略 ${payload.ignored || 0} 个失败任务。`
  });
});

retryFailedJobsButton.addEventListener("click", async () => {
  await handleFailedJobsAction({
    endpoint: "/api/video-jobs/retry-failed",
    pendingText: "正在把全部失败任务重新排队...",
    doneText: (payload) => `已重新排队 ${payload.retried || 0} 个失败任务。`
  });
});

refreshTikTokCommentsButton?.addEventListener("click", async () => {
  const app = apps.find((item) => item.id === selectedAppId);
  if (!app) {
    setStatus("请先选择要补采评论的 App。");
    return;
  }

  refreshTikTokCommentsButton.disabled = true;
  refreshTikTokCommentsButton.textContent = "补采中...";
  setStatus(`正在通过 Chrome 插件补采 ${formatAppDisplayName(app.name)} 的 TikTok 评论。`);
  try {
    const payload = await requestTikTokCommentsBatch({
      appId: app.id,
      items: currentResults
        .filter((item) => item.appId === app.id || item.app?.id === app.id)
        .map((item) => ({
          id: item.id,
          sourceUrl: item.hyperlink || item.sourceUrl,
          title: item.title,
          appId: item.appId
        })),
      limit: 300,
      expandCount: 5,
      onlyMissing: false
    });
    const message = `TikTok 评论补采完成：成功 ${payload.success || 0}/${payload.total || 0}，失败 ${payload.failed || 0}。`;
    setStatus(message);
    showToast(message);
    await loadResults();
  } catch (error) {
    const message = `TikTok 评论补采失败：${formatChromeExtensionError(error.message)}`;
    setStatus(message);
    showToast(message);
  } finally {
    refreshTikTokCommentsButton.disabled = false;
    refreshTikTokCommentsButton.textContent = "补采 TikTok 评论";
  }
});

agentRefreshButton.addEventListener("click", () => {
  loadAgentStatus();
});

batchImportButton.addEventListener("click", async () => {
  const app = apps.find((item) => item.id === selectedAppId);
  if (!app) {
    setStatus("请先选择要绑定的 App。");
    return;
  }

  const query = (batchQueryInput.value.trim() || formatAppDisplayName(app.name)).trim();
  if (!query) {
    setStatus("请先输入 TikTok 搜索词。");
    return;
  }

  const limit = getBatchImportLimit();
  batchImportButton.disabled = true;
  batchImportStatus.textContent = `正在打开 TikTok 搜索「${query}」，采集前 ${limit} 个候选...`;
  setStatus("批量导入已触发，会先采集候选，等待你手动确认后才入队。");

  try {
    const payload = await requestTikTokBatchImport({ query, appId: app.id, limit, previewOnly: true });
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) {
      throw new Error("没有采集到候选视频。");
    }
    const message = `已采集 ${items.length} 条候选，请手动勾选真正相关的视频。`;
    batchImportStatus.textContent = message;
    setStatus(message);
    openBatchConfirmModal({ app, query, items, limit });
  } catch (error) {
    const message = `批量录入失败：${formatChromeExtensionError(error.message)}`;
    batchImportStatus.textContent = message;
    setStatus(message);
  } finally {
    batchImportButton.disabled = false;
  }
});

batchConfirmClose.addEventListener("click", () => closeBatchConfirmModal());
batchConfirmCancel.addEventListener("click", () => closeBatchConfirmModal());

batchConfirmModal.addEventListener("click", (event) => {
  const card = batchConfirmModal.querySelector(".modal-card");
  if (!card.contains(event.target)) {
    closeBatchConfirmModal();
  }
});

batchSelectAll.addEventListener("click", () => {
  batchConfirmList.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = !input.disabled;
  });
  updateBatchSelectedCount();
});

batchSelectNone.addEventListener("click", () => {
  batchConfirmList.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = false;
  });
  updateBatchSelectedCount();
});

batchConfirmList.addEventListener("change", (event) => {
  if (event.target.matches("input[type='checkbox']")) {
    updateBatchSelectedCount();
  }
});

batchConfirmSubmit.addEventListener("click", async () => {
  if (!pendingBatchReview) {
    return;
  }
  const selectedItems = getSelectedBatchItems();
  if (!selectedItems.length) {
    showToast("请至少选择 1 条要入队的视频。");
    return;
  }

  batchConfirmSubmit.disabled = true;
  batchConfirmSubmit.textContent = "正在入队...";
  try {
    const response = await fetch("/api/convert/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: pendingBatchReview.app.id,
        items: selectedItems,
        limit: selectedItems.length
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "批量入队失败");
    }
    const totals = payload.totals || {};
    const message = `已确认 ${selectedItems.length} 条：排队 ${totals.queued || 0} 条，重复 ${totals.skipped_duplicate || 0} 条。`;
    batchImportStatus.textContent = message;
    setStatus(message);
    showToast(message);
    notifyTikTokBatchConfirmed({
      query: pendingBatchReview.query,
      appId: pendingBatchReview.app.id,
      message
    });
    closeBatchConfirmModal();
    await loadVideoJobs();
    startJobPolling();
  } catch (error) {
    setStatus(`批量入队失败：${error.message}`);
  } finally {
    batchConfirmSubmit.disabled = false;
    batchConfirmSubmit.textContent = "确认入队";
  }
});

editToggle.addEventListener("click", () => {
  isEditMode = true;
  selectedIds = new Set();
  syncEditMode();
  renderFromCurrentDomSelectionReset();
});

editCancelButton.addEventListener("click", () => {
  isEditMode = false;
  selectedIds = new Set();
  syncEditMode();
  renderFromCurrentDomSelectionReset();
});

deleteSelectedButton.addEventListener("click", async () => {
  if (!selectedIds.size) {
    return;
  }

  deleteSelectedButton.disabled = true;
  editCancelButton.disabled = true;
  try {
    const response = await fetch(getDeleteEndpointForActiveType(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selectedIds) })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "删除失败");
    }

    selectedIds = new Set();
    await loadActiveResults();
    updateSelectionSummary();
  } catch (error) {
    setStatus(`删除失败：${error.message}`);
  } finally {
    deleteSelectedButton.disabled = false;
    editCancelButton.disabled = false;
  }
});

function getDeleteEndpointForActiveType() {
  if (activeResultType === "articles") {
    return "/api/articles/delete";
  }
  if (activeResultType === "metrics") {
    return "/api/app-metrics/delete";
  }
  return "/api/results/delete";
}

modalClose.addEventListener("click", () => {
  transcriptModal.close();
});

transcriptModal.addEventListener("click", (event) => {
  const card = transcriptModal.querySelector(".modal-card");
  if (!card.contains(event.target)) {
    transcriptModal.close();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = form.querySelector("button[type='submit']");
  const input = form.querySelector("input[name='url']");
  const appId = selectedAppId;
  const url = input.value.trim();

  if (!appId) {
    setStatus("请先选择这个视频对应的 App。");
    return;
  }

  if (!url) {
    setStatus("请先输入视频链接。");
    return;
  }

  const duplicate = findDuplicateResult(url);
  const duplicateJob = findDuplicateVideoJob(url);
  if (duplicate || duplicateJob) {
    const message = duplicate
      ? `这个视频链接已经录入过了：${duplicate.title || duplicate.createdAt}`
      : `这个视频已经在队列里：${formatJobStatus(duplicateJob)}`;
    setStatus(message);
    showToast(message);
    activateTab("results");
    return;
  }

  submitButton.disabled = true;
  setStatus("正在加入转换队列。");

  try {
    const response = await fetch("/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, appId })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "转换失败");
    }

    setStatus(`已加入队列：${shortenUrl(url)}。你可以继续录入下一个视频。`);
    input.value = "";
    await loadVideoJobs();
    startJobPolling();
  } catch (error) {
    setStatus(`加入队列失败：${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
});

appForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = appForm.querySelector("button[type='submit']");
  const input = appForm.querySelector("input[name='appStoreUrl']");
  const url = input.value.trim();

  if (!url) {
    setStatus("请先粘贴 App Store 链接。");
    return;
  }

  submitButton.disabled = true;
  setStatus("正在读取 App Store 信息。");

  try {
    const response = await fetch("/api/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "录入 App 失败");
    }

    input.value = "";
    await loadApps(payload.id);
    setStatus(`已录入 App：${payload.name}。现在可以选择它并提交视频链接。`);
  } catch (error) {
    setStatus(`录入 App 失败：${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
});

articleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = articleForm.querySelector("button[type='submit']");
  const input = articleForm.querySelector("input[name='url']");
  const appId = selectedAppId;
  const url = input.value.trim();

  if (!appId) {
    setStatus("请先选择这篇文章对应的 App。");
    return;
  }

  if (!url) {
    setStatus("请先输入文章链接。");
    return;
  }

  const duplicate = findDuplicateArticle(url);
  if (duplicate) {
    const message = `这篇文章已经录入过了：${duplicate.title || duplicate.createdAt}`;
    setStatus(message);
    showToast(message);
    activateTab("results");
    activateResultType("articles");
    return;
  }

  submitButton.disabled = true;
  setStatus("正在录入文章：抓取 HTML、提取正文和图片，并生成文章 bundle。");

  try {
    const response = await fetch("/api/articles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, appId })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "录入文章失败");
    }

    setStatus("文章录入完成，已经加入文章列表。");
    input.value = "";
    await loadArticles();
    activateTab("results");
    activateResultType("articles");
  } catch (error) {
    setStatus(`录入文章失败：${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
});

articleSearchButton?.addEventListener("click", async () => {
  const app = apps.find((item) => item.id === selectedAppId);
  if (!app) {
    const message = "请先选择要搜索文章的 App。";
    setStatus(message);
    if (articleSearchStatus) articleSearchStatus.textContent = message;
    return;
  }

  const limit = getArticleSearchLimit();
  articleSearchButton.disabled = true;
  articleSearchButton.textContent = "搜索录入中...";
  const pendingMessage = `正在全网搜索 ${formatAppDisplayName(app.name)} 相关文章，并尝试录入 ${limit} 条高质量候选。`;
  setStatus(pendingMessage);
  if (articleSearchStatus) articleSearchStatus.textContent = "正在搜索、去重、过滤低质页面，并逐条生成文章 bundle。";

  try {
    const response = await fetch("/api/articles/search-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: app.id, limit })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "全网搜索文章失败");
    }

    const importedCount = Array.isArray(payload.imported) ? payload.imported.length : 0;
    const failedCount = Array.isArray(payload.failed) ? payload.failed.length : 0;
    const skippedCount = Array.isArray(payload.skipped) ? payload.skipped.length : 0;
    const message = `文章搜索完成：搜索候选 ${payload.searched || 0} 条，录入 ${importedCount}/${payload.requested || limit} 条，跳过 ${skippedCount} 条，失败 ${failedCount} 条。`;
    setStatus(message);
    if (articleSearchStatus) articleSearchStatus.textContent = message;
    showToast(message);
    await loadArticles();
    activateTab("results");
    activateResultType("articles");
  } catch (error) {
    const message = `全网搜索文章失败：${error.message}`;
    setStatus(message);
    if (articleSearchStatus) articleSearchStatus.textContent = message;
  } finally {
    articleSearchButton.disabled = false;
    articleSearchButton.textContent = "搜索并录入";
  }
});

async function loadApps(nextSelectedAppId = selectedAppId) {
  const response = await fetch("/api/apps");
  apps = await response.json();
  renderApps(nextSelectedAppId);
}

function renderApps(nextSelectedAppId = "") {
  selectedAppId = apps.some((app) => app.id === nextSelectedAppId)
    ? nextSelectedAppId
    : apps[0]?.id || "";

  appList.innerHTML = "";
  appList.classList.toggle("app-edit-mode", isAppEditMode);
  appEditToggle.textContent = isAppEditMode ? "完成" : "编辑";
  appEditToggle.classList.toggle("active", isAppEditMode);
  appEditToggle.disabled = apps.length === 0;

  if (!apps.length) {
    const empty = document.createElement("p");
    empty.className = "app-empty";
    empty.textContent = "还没有录入 App。先贴一个 App Store 链接。";
    appList.appendChild(empty);
    return;
  }

  apps.forEach((app) => {
    const isActive = app.id === selectedAppId;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "app-chip";
    chip.classList.toggle("active", isActive);
    chip.setAttribute("aria-pressed", String(isActive));
    chip.innerHTML = `
      <img src="${escapeAttribute(app.logoUrl)}" alt="" />
      <span>${escapeHtml(formatAppDisplayName(app.name))}</span>
      ${isActive ? `<span class="app-chip-check" aria-hidden="true">✓</span>` : ""}
      ${isAppEditMode ? `<span class="app-chip-delete" aria-label="删除 ${escapeAttribute(formatAppDisplayName(app.name))}">删除</span>` : ""}
    `;
    chip.addEventListener("click", async (event) => {
      if (event.target.closest(".app-chip-delete")) {
        event.stopPropagation();
        if (!isAppEditMode) {
          return;
        }
        await deleteAppFromLibrary(app);
        return;
      }
      renderApps(app.id);
      setStatus(`已选择 App：${app.name}。`);
    });
    appList.appendChild(chip);
  });
}

async function deleteAppFromLibrary(app) {
  const displayName = formatAppDisplayName(app.name);
  const shouldDelete = window.confirm(`确定删除首页里的 App「${displayName}」吗？`);
  if (!shouldDelete) {
    return;
  }

  const deleteRelated = window.confirm(
    `是否同时删除「${displayName}」相关的视频、文章和 App 数据？\n\n点“确定”：全删干净。\n点“取消”：只删首页 App 信息，库里已有内容保留。`
  );

  try {
    const response = await fetch("/api/apps/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: app.id, deleteRelated })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "删除 App 失败");
    }

    if (selectedAppId === app.id) {
      selectedAppId = "";
    }
    isAppEditMode = false;
    await loadApps();
    await Promise.all([loadResults(), loadArticles(), loadMetrics(), loadVideoJobs()]);
    setStatus(deleteRelated
      ? `已删除 ${displayName} 及相关内容。`
      : `已删除首页 App 信息：${displayName}，已有内容保留。`);
  } catch (error) {
    setStatus(`删除 App 失败：${error.message}`);
  }
}

async function loadResults() {
  const response = await fetch("/api/results");
  const items = await response.json();
  currentResults = items;
  renderResults(currentResults);
  if (currentVideoJobs.length) {
    renderVideoJobs(currentVideoJobs);
  }
}

async function loadVideoJobs() {
  if (isLoadingVideoJobs) {
    return;
  }
  isLoadingVideoJobs = true;
  try {
    const response = await fetch("/api/video-jobs");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    currentVideoJobs = await response.json();
    renderVideoJobs(currentVideoJobs);
    renderFailedJobCard(currentVideoJobs);
  } catch (error) {
    console.warn("Failed to refresh video jobs", error);
  } finally {
    isLoadingVideoJobs = false;
  }
}

async function handleFailedJobsAction({ endpoint, pendingText, doneText }) {
  setFailedJobButtonsDisabled(true);
  setStatus(pendingText);
  try {
    const response = await fetch(endpoint, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "操作失败");
    }
    await loadVideoJobs();
    const message = doneText(payload);
    setStatus(message);
    showToast(message);
  } catch (error) {
    const message = `失败任务处理失败：${error.message}`;
    setStatus(message);
    showToast(message);
  } finally {
    setFailedJobButtonsDisabled(false);
  }
}

function renderFailedJobCard(jobs) {
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  failedJobCard.hidden = failedCount === 0;
  failedJobCount.textContent = `${failedCount} 个任务失败`;
}

function setFailedJobButtonsDisabled(disabled) {
  ignoreFailedJobsButton.disabled = disabled;
  retryFailedJobsButton.disabled = disabled;
}

function startJobPolling() {
  if (jobPollTimer) {
    return;
  }
  jobPollTimer = window.setInterval(async () => {
    await loadVideoJobs();
    if (currentVideoJobs.some((job) => ["running", "completed"].includes(job.status))) {
      await loadResults();
    }
  }, 2500);
}

function stopJobPolling() {
  if (!jobPollTimer) {
    return;
  }
  window.clearInterval(jobPollTimer);
  jobPollTimer = null;
}

function renderVideoJobs(jobs) {
  videoJobList.innerHTML = "";
  const sortedJobs = sortVideoJobsForDisplay(jobs);
  const totalPages = Math.max(1, Math.ceil(sortedJobs.length / VIDEO_JOBS_PER_PAGE));
  videoJobPage = Math.min(Math.max(1, videoJobPage), totalPages);
  renderVideoJobPagination(sortedJobs.length);
  const startIndex = (videoJobPage - 1) * VIDEO_JOBS_PER_PAGE;
  const visibleJobs = sortedJobs.slice(startIndex, startIndex + VIDEO_JOBS_PER_PAGE);
  if (!visibleJobs.length) {
    const empty = document.createElement("div");
    empty.className = "video-job-empty";
    empty.textContent = "暂无排队任务。";
    videoJobList.appendChild(empty);
    return;
  }

  visibleJobs.forEach((job) => {
    const card = document.createElement("article");
    card.className = `video-job-card status-${job.status}`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `查看任务：${job.title || job.sourceUrl}`);
    const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
    const coverPath = getVideoJobCoverPath(job);
    const result = getVideoJobResult(job);
    const originalUrl = job.hyperlink || job.sourceUrl;
    card.innerHTML = `
      <div class="video-job-cover ${coverPath ? "" : "is-empty"}">
        ${coverPath
          ? `<img src="${escapeAttribute(coverPath)}" alt="${escapeAttribute((job.title || "视频") + " 首帧")}" loading="lazy" />`
          : `<span>${escapeHtml(formatJobCoverPlaceholder(job))}</span>`}
        <div class="video-job-overlay">
          <p class="video-job-time">${escapeHtml(job.createdAt || "")}</p>
          ${job.app?.name ? `<p class="video-job-app">${escapeHtml(formatAppDisplayName(job.app.name))}</p>` : ""}
          <p class="video-job-title">${escapeHtml(job.title || job.previewText || shortenUrl(job.sourceUrl))}</p>
          ${formatPublishedLine(job) ? `<p class="video-job-meta">${escapeHtml(formatPublishedLine(job))}</p>` : ""}
          ${formatEngagementLine(job.engagement) ? `<p class="video-job-meta">${escapeHtml(formatEngagementLine(job.engagement))}</p>` : ""}
          ${job.retryCount ? `<p class="video-job-meta">已重试 ${job.retryCount} 次</p>` : ""}
          ${job.status === "failed" ? `<button type="button" class="video-job-retry-button">重试</button>` : ""}
          ${job.error ? `<p class="video-job-error">${escapeHtml(job.error)}</p>` : ""}
          <div class="video-job-hover-actions">
            <a class="video-job-action" href="${escapeAttribute(originalUrl)}" target="_blank" rel="noreferrer">原链接</a>
            <button type="button" class="video-job-action video-job-record-button" ${result ? "" : "disabled"}>录入记录</button>
          </div>
          <div class="video-job-bottom">
            <span class="video-job-badge">${escapeHtml(formatJobStatus(job))}</span>
            <div class="video-job-progress" aria-label="转换进度 ${progress}%"><span style="width: ${progress}%"></span></div>
          </div>
        </div>
      </div>
    `;

    card.addEventListener("click", () => {
      focusVideoResultForJob(job);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        focusVideoResultForJob(job);
      }
    });

    card.querySelectorAll(".video-job-action").forEach((action) => {
      action.addEventListener("click", (event) => {
        event.stopPropagation();
      });
    });

    const recordButton = card.querySelector(".video-job-record-button");
    if (recordButton) {
      recordButton.addEventListener("click", (event) => {
        event.stopPropagation();
        focusVideoResultForJob(job);
      });
    }

    const retryButton = card.querySelector(".video-job-retry-button");
    if (retryButton) {
      retryButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        retryButton.disabled = true;
        try {
          const response = await fetch("/api/video-jobs/retry", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: job.id })
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || "重试失败");
          }
          setStatus(`已重新排队：${shortenUrl(job.sourceUrl)}`);
          await loadVideoJobs();
          startJobPolling();
        } catch (error) {
          setStatus(`重试失败：${error.message}`);
        } finally {
          retryButton.disabled = false;
        }
      });
    }

    videoJobList.appendChild(card);
  });
}

function sortVideoJobsForDisplay(jobs) {
  const statusRank = {
    failed: 0,
    running: 1,
    queued: 2,
    completed: 3
  };
  return [...jobs].sort((a, b) => {
    const rankDiff = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return getJobSortTime(b) - getJobSortTime(a);
  });
}

function getJobSortTime(job) {
  const raw = job.updatedAt || job.createdAt || "";
  const parsed = Date.parse(String(raw).replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function setQueueSizeValue(value) {
  const sizeValue = Math.max(3, Math.min(6, Number(value) || 6));
  const columns = 9 - sizeValue;
  document.documentElement.style.setProperty("--queue-columns", String(columns));
  if (queueSizeInput) {
    queueSizeInput.value = String(sizeValue);
  }
  localStorage.setItem(QUEUE_COLUMN_STORAGE_KEY, String(sizeValue));
}

async function focusVideoResultForJob(job) {
  await loadResults();
  const result = getVideoJobResult(job);
  if (!result) {
    const message = job.status === "failed"
      ? "这个任务失败了，还没有转换结果。可以先点重试。"
      : "这个任务还没完成，完成后点击卡片会跳到对应结果。";
    setStatus(message);
    showToast(message);
    return;
  }

  activateTab("results");
  await activateResultType("videos");
  window.setTimeout(() => {
    const row = Array.from(resultsList.querySelectorAll(".result-row"))
      .find((candidate) => candidate.dataset.id === result.id);
    if (!row) {
      return;
    }
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.classList.add("focus-flash");
    window.setTimeout(() => row.classList.remove("focus-flash"), 1800);
  }, 80);
}

function renderVideoJobPagination(totalCount) {
  if (!videoJobPagination) {
    return;
  }
  const totalPages = Math.ceil(totalCount / VIDEO_JOBS_PER_PAGE);
  if (totalPages <= 1) {
    videoJobPagination.hidden = true;
    videoJobPagination.innerHTML = "";
    return;
  }
  videoJobPagination.hidden = false;
  videoJobPagination.innerHTML = `
    <button type="button" class="video-job-page-button" data-page-action="prev" ${videoJobPage <= 1 ? "disabled" : ""}>上一页</button>
    <span>第 ${videoJobPage} / ${totalPages} 页，共 ${totalCount} 个任务</span>
    <button type="button" class="video-job-page-button" data-page-action="next" ${videoJobPage >= totalPages ? "disabled" : ""}>下一页</button>
  `;
  videoJobPagination.querySelectorAll(".video-job-page-button").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.pageAction;
      videoJobPage += action === "next" ? 1 : -1;
      renderVideoJobs(currentVideoJobs);
      videoJobList.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  });
}

function getVideoJobCoverPath(job) {
  if (job.firstFramePath) {
    return job.firstFramePath;
  }
  if (job.coverUrl) {
    return job.coverUrl;
  }
  return getVideoJobResult(job)?.firstFramePath || "";
}

function getVideoJobResult(job) {
  const normalizedSource = normalizeVideoUrl(job.sourceUrl);
  return currentResults.find((item) => {
    return item.id === job.resultId
      || item.id === job.id
      || [item.sourceUrl, item.hyperlink].filter(Boolean).some((url) => normalizeVideoUrl(url) === normalizedSource);
  }) || null;
}

function formatJobCoverPlaceholder(job) {
  if (job.status === "queued") {
    return "等待封面";
  }
  if (job.status === "running") {
    return "处理中";
  }
  if (job.status === "failed") {
    return "无封面";
  }
  return "封面生成中";
}

async function loadArticles() {
  const response = await fetch("/api/articles");
  const items = await response.json();
  currentArticles = items;
  renderArticles(items);
}

async function loadMetrics() {
  const response = await fetch("/api/app-metrics");
  const items = await response.json();
  currentMetrics = items;
  renderMetrics(items);
}

async function loadActiveResults() {
  if (activeResultType === "metrics") {
    await loadMetrics();
    return;
  }
  if (activeResultType === "articles") {
    await loadArticles();
    return;
  }
  await loadResults();
}

function renderResults(items) {
  resultsList.innerHTML = "";
  const visibleItems = isFavoritesOnly ? items.filter((item) => item.isFavorite) : items;
  syncFavoriteEntry();
  if (!visibleItems.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = isFavoritesOnly
      ? "还没有收藏的视频。先在列表里收藏几条吧。"
      : "还没有转换记录。先去“输入链接”页提交一个视频吧。";
    resultsList.appendChild(empty);
    return;
  }

  visibleItems.forEach((item) => {
    const fragment = template.content.cloneNode(true);
    const row = fragment.querySelector(".result-row");
    row.dataset.id = item.id;
    fragment.querySelector(".thumb").src = item.firstFramePath;
    fragment.querySelector(".thumb").alt = `${item.title} 首帧`;
    fragment.querySelector(".title-text").textContent = item.title;
    const favoriteButton = fragment.querySelector(".favorite-button");
    updateFavoriteButton(favoriteButton, item.isFavorite);
    renderResultEngagement(fragment.querySelector(".engagement-cell"), item.engagement);
    fragment.querySelector(".transcript-chinese").textContent = item.transcriptZh || "暂无中文翻译。";
    fragment.querySelector(".time-cell").textContent = item.createdAt;
    renderCommentStatus(fragment, item.commentsRaw);
    renderInsightList(fragment.querySelector(".comment-insights"), item.commentInsights);
    renderResultApp(fragment, item.app);

    const checkbox = fragment.querySelector(".record-checkbox");
    checkbox.checked = selectedIds.has(item.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedIds.add(item.id);
      } else {
        selectedIds.delete(item.id);
      }
      updateSelectionSummary();
    });

    const thumbLink = fragment.querySelector(".thumb-link");
    thumbLink.href = item.hyperlink;

    favoriteButton.addEventListener("click", async () => {
      await toggleFavorite(item, favoriteButton);
    });

    const copyCommentsButton = fragment.querySelector(".copy-comments-button");
    copyCommentsButton.disabled = !hasComments(item.commentsRaw);
    copyCommentsButton.addEventListener("click", async () => {
      await copyCommentsJson(item.commentsRaw, copyCommentsButton);
    });

    const previewButtons = fragment.querySelectorAll(".preview-button");
    previewButtons.forEach((previewButton) => {
      previewButton.hidden = !hasPreviewContent(item, previewButton.dataset.previewKind);
      previewButton.addEventListener("click", () => {
        modalTitle.textContent = item.title || "完整视频文字";
        modalEnglish.textContent = item.transcriptOriginal || item.transcriptEn || "暂无原文转写。";
        modalChinese.textContent = item.transcriptZh || "暂无中文翻译。";
        modalComments.textContent = formatCommentsJson(item.commentsRaw);
        renderMaterialAnalysis(modalMaterialAnalysis, item);
        renderVisualTextSegments(modalVisualText, item);
        renderInsightList(modalInsights, item.commentInsights);
        transcriptModal.showModal();
      });
    });

    const visualRefreshButton = fragment.querySelector(".visual-refresh-button");
    if (visualRefreshButton) {
      visualRefreshButton.hidden = item.mediaType === "photo";
      visualRefreshButton.addEventListener("click", async () => {
        await refreshVisualUnderstanding(item.id, visualRefreshButton);
      });
    }

    resultsList.appendChild(fragment);
  });

  syncEditMode();
  updateSelectionSummary();
}

async function refreshVisualUnderstanding(resultId, button) {
  button.disabled = true;
  const previousText = button.textContent;
  button.textContent = "理解中...";
  setStatus("正在抽帧并调用 LLM 理解视频画面。");
  try {
    const response = await fetch("/api/results/visual-refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: resultId })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "画面理解失败。");
    }
    setStatus("画面理解已完成，视频文字已更新。");
    showToast("画面理解已完成。");
    await loadResults();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`画面理解失败：${message}`);
    showToast(`画面理解失败：${message}`);
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}

function syncFavoriteEntry() {
  if (!favoritesEntryButton) {
    return;
  }
  favoritesEntryButton.hidden = activeResultType !== "videos";
  favoritesEntryButton.setAttribute("aria-pressed", String(isFavoritesOnly));
  favoritesEntryButton.classList.toggle("active", isFavoritesOnly);
}

function updateFavoriteButton(button, isFavorite) {
  if (!button) {
    return;
  }
  button.setAttribute("aria-pressed", String(Boolean(isFavorite)));
  button.classList.toggle("active", Boolean(isFavorite));
  button.textContent = isFavorite ? "已收藏" : "收藏";
  button.title = isFavorite ? "取消收藏这个视频" : "收藏这个视频";
}

async function toggleFavorite(item, button) {
  const nextFavorite = !item.isFavorite;
  button.disabled = true;
  try {
    const response = await fetch("/api/results/favorite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, favorite: nextFavorite })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "收藏更新失败");
    }
    currentResults = currentResults.map((result) => (
      result.id === item.id ? { ...result, isFavorite: Boolean(payload.isFavorite) } : result
    ));
    renderResults(currentResults);
    const message = payload.isFavorite ? "已加入收藏。" : "已取消收藏。";
    setStatus(message);
    showToast(message);
  } catch (error) {
    setStatus(`收藏操作失败：${error.message}`);
    showToast(`收藏操作失败：${error.message}`);
  } finally {
    button.disabled = false;
  }
}

function renderMetrics(items) {
  metricsList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "还没有 App 数据。去 Sensor Tower 页面点击 Chrome 插件里的“采集到本地系统”。";
    metricsList.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const fragment = metricsTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".metrics-row");
    row.dataset.id = item.id;
    fragment.querySelector(".metrics-match-cell").textContent = item.matched ? "已匹配" : `未匹配：${item.appName || "未知 App"}`;
    const link = fragment.querySelector(".metrics-page-link");
    link.href = item.sourceUrl;
    fragment.querySelector(".metrics-page-title").textContent = item.pageTitle || item.sourceUrl;
    renderMetricSummary(fragment.querySelector(".metrics-summary-list"), item);
    fragment.querySelector(".metrics-time-cell").textContent = item.collectedAt;
    renderResultApp(fragment, item.app);

    const checkbox = fragment.querySelector(".record-checkbox");
    checkbox.checked = selectedIds.has(item.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedIds.add(item.id);
      } else {
        selectedIds.delete(item.id);
      }
      updateSelectionSummary();
    });

    metricsList.appendChild(fragment);
  });

  syncEditMode();
  updateSelectionSummary();
}

function renderMetricSummary(target, item) {
  target.innerHTML = "";
  const metrics = Array.isArray(item.metrics) ? item.metrics.slice(0, 6) : [];
  const tableCount = Array.isArray(item.tables) ? item.tables.length : 0;
  const summary = metrics.map((metric) => {
    const label = metric.label ? `${metric.label}：` : "";
    return `${label}${metric.value || ""}`.trim();
  }).filter(Boolean);

  if (tableCount) {
    summary.push(`采集到 ${tableCount} 个表格。`);
  }
  if (!summary.length && item.pageText) {
    summary.push(shortenUrl(item.pageText));
  }
  if (!summary.length) {
    summary.push("已保存页面可见文本，暂未解析出指标。");
  }

  summary.slice(0, 6).forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    target.appendChild(li);
  });
}

function renderArticles(items) {
  articlesList.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "还没有文章记录。先去“输入链接”页提交一篇文章吧。";
    articlesList.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const fragment = articleTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".article-row");
    row.dataset.id = item.id;
    fragment.querySelector(".article-title-text").textContent = item.title;
    const originalLink = fragment.querySelector(".article-original-link");
    originalLink.href = item.sourceUrl;
    const briefLink = fragment.querySelector(".article-brief-link");
    briefLink.href = `/article-view.html?id=${encodeURIComponent(item.id)}`;
    fragment.querySelector(".article-meta-cell").textContent = formatArticleMeta(item);
    renderInsightList(fragment.querySelector(".article-core-insights"), normalizeArticleInsights(item.coreInsights));
    fragment.querySelector(".article-image-count").textContent = `${item.imageCount || 0} 张`;
    fragment.querySelector(".article-time-cell").textContent = item.createdAt;
    renderResultApp(fragment, item.app);

    const checkbox = fragment.querySelector(".record-checkbox");
    checkbox.checked = selectedIds.has(item.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedIds.add(item.id);
      } else {
        selectedIds.delete(item.id);
      }
      updateSelectionSummary();
    });

    articlesList.appendChild(fragment);
  });

  syncEditMode();
  updateSelectionSummary();
}

function hasPreviewContent(item, kind) {
  if (kind === "english") {
    return Boolean((item.transcriptOriginal || item.transcriptEn || "").trim());
  }
  if (kind === "chinese") {
    return Boolean((item.transcriptZh || item.visualSummary || "").trim())
      || hasMaterialAnalysis(item)
      || hasVisualTextSegments(item);
  }
  if (kind === "insights") {
    return Array.isArray(item.commentInsights) && item.commentInsights.some((insight) => String(insight?.point || insight || "").trim())
      || hasMaterialAnalysis(item)
      || hasVisualTextSegments(item);
  }
  return true;
}

function renderCommentStatus(fragment, commentsRaw) {
  const status = fragment.querySelector(".comment-status");
  const text = fragment.querySelector(".comment-status-text");
  const count = getCommentCount(commentsRaw);
  const hasAnyComments = count > 0;

  status.classList.toggle("has-comments", hasAnyComments);
  text.textContent = hasAnyComments ? `有（${count} 条）` : "无";
}

async function copyCommentsJson(commentsRaw, button) {
  if (!hasComments(commentsRaw)) {
    return;
  }

  const originalText = button.textContent;
  try {
    await navigator.clipboard.writeText(formatCommentsJson(commentsRaw));
    button.textContent = "已复制";
  } catch (error) {
    button.textContent = "复制失败";
  } finally {
    window.setTimeout(() => {
      button.textContent = originalText;
    }, 1400);
  }
}

function formatCommentsJson(commentsRaw) {
  if (!commentsRaw) {
    return "暂无评论原文。";
  }
  return JSON.stringify(commentsRaw, null, 2);
}

function hasComments(commentsRaw) {
  return getCommentCount(commentsRaw) > 0;
}

function getCommentCount(commentsRaw) {
  return Array.isArray(commentsRaw?.items) ? commentsRaw.items.length : 0;
}

function hasMaterialAnalysis(item = {}) {
  const analysis = item.analysis && typeof item.analysis === "object"
    ? item.analysis
    : item.materialAnalysis && typeof item.materialAnalysis === "object"
      ? item.materialAnalysis
      : null;
  if (!analysis) {
    return Boolean((item.visualSummary || item.transcriptZh || "").trim());
  }
  return [
    analysis.videoStory,
    analysis.cardSummary,
    analysis.script,
    analysis.productMechanism,
    ...(Array.isArray(analysis.productFeatures) ? analysis.productFeatures : []),
    ...(Array.isArray(analysis.storyboardFormula) ? analysis.storyboardFormula : [])
  ].some((value) => String(value || "").trim());
}

function hasVisualTextSegments(item = {}) {
  return normalizeModalVisualTextSegments(item).length > 0;
}

function renderMaterialAnalysis(target, item = {}) {
  if (!target) return;
  target.innerHTML = "";
  const analysis = buildDisplayMaterialAnalysis(item);
  if (!hasDisplayMaterialAnalysis(analysis)) {
    const empty = document.createElement("p");
    empty.className = "modal-text muted";
    empty.textContent = "暂无素材拆解。点击列表里的“理解画面”后会生成视频剧情、产品 feature 和分镜解构。";
    target.appendChild(empty);
    return;
  }

  const storyText = [analysis.videoStory, analysis.cardSummary]
    .map((value) => String(value || "").trim())
    .find(Boolean);
  appendMaterialBlock(target, "视频剧情", storyText, analysis.keyMoments);
  appendMaterialBlock(target, "产品 feature", analysis.productMechanism, analysis.productFeatures);
  appendMaterialBlock(target, "分镜解构", analysis.reusableTemplate, analysis.storyboardFormula);

  if (analysis.structureError) {
    const note = document.createElement("p");
    note.className = "material-analysis-note";
    note.textContent = `拆解需复核：${analysis.structureError}`;
    target.appendChild(note);
  }
}

function buildDisplayMaterialAnalysis(item = {}) {
  const analysis = item.analysis && typeof item.analysis === "object"
    ? item.analysis
    : item.materialAnalysis && typeof item.materialAnalysis === "object"
      ? item.materialAnalysis
      : {};
  const fallbackStory = String(item.visualSummary || item.transcriptZh || "").trim();
  return {
    videoStory: analysis.videoStory || analysis.cardSummary || fallbackStory,
    cardSummary: analysis.cardSummary || "",
    productMechanism: analysis.productMechanism || "",
    productFeatures: normalizeTextList(analysis.productFeatures),
    storyboardFormula: normalizeTextList(analysis.storyboardFormula),
    reusableTemplate: analysis.reusableTemplate || "",
    keyMoments: normalizeTextList(analysis.keyMoments),
    structureError: analysis.structureError || ""
  };
}

function hasDisplayMaterialAnalysis(analysis = {}) {
  return [
    analysis.videoStory,
    analysis.cardSummary,
    analysis.productMechanism,
    analysis.reusableTemplate,
    ...normalizeTextList(analysis.productFeatures),
    ...normalizeTextList(analysis.storyboardFormula),
    ...normalizeTextList(analysis.keyMoments)
  ].some((value) => String(value || "").trim());
}

function appendMaterialBlock(target, title, body, items = []) {
  const block = document.createElement("section");
  block.className = "material-analysis-block";
  const heading = document.createElement("h3");
  heading.textContent = title;
  block.appendChild(heading);

  const bodyText = String(body || "").trim();
  if (bodyText) {
    const paragraph = document.createElement("p");
    paragraph.className = "material-analysis-body";
    paragraph.textContent = bodyText;
    block.appendChild(paragraph);
  }

  const listItems = normalizeTextList(items);
  if (listItems.length) {
    const list = document.createElement("ol");
    list.className = "material-analysis-list";
    listItems.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
    block.appendChild(list);
  }

  if (!bodyText && !listItems.length) {
    const empty = document.createElement("p");
    empty.className = "material-analysis-empty";
    empty.textContent = "暂无结构化内容。";
    block.appendChild(empty);
  }

  target.appendChild(block);
}

function renderVisualTextSegments(target, item = {}) {
  if (!target) return;
  target.innerHTML = "";
  const segments = normalizeModalVisualTextSegments(item);
  if (!segments.length) {
    const empty = document.createElement("p");
    empty.className = "modal-text muted";
    empty.textContent = item.visualTextOcr?.error
      ? `暂无画面文字。OCR 状态：${item.visualTextOcr.error}`
      : "暂无画面文字时间轴。";
    target.appendChild(empty);
    return;
  }

  segments.forEach((segment) => {
    const row = document.createElement("div");
    row.className = "visual-text-item";
    const time = document.createElement("span");
    time.className = "visual-text-time";
    time.textContent = `${formatSegmentTime(segment.start)}-${formatSegmentTime(segment.end)}`;
    const text = document.createElement("div");
    text.className = "visual-text-copy";
    const original = document.createElement("b");
    original.textContent = segment.original || "无原文";
    const zh = document.createElement("small");
    zh.textContent = segment.zh || "无中文翻译";
    text.append(original, zh);
    row.append(time, text);
    target.appendChild(row);
  });
}

function normalizeModalVisualTextSegments(item = {}) {
  const analysisSegments = item.analysis?.visualTextSegments || item.materialAnalysis?.visualTextSegments;
  const candidates = Array.isArray(item.visualTextSegments) && item.visualTextSegments.length
    ? item.visualTextSegments
    : Array.isArray(analysisSegments)
      ? analysisSegments
      : [];
  return candidates
    .map((segment) => ({
      start: Number(segment?.start) || 0,
      end: Number(segment?.end) || 0,
      original: String(segment?.original || segment?.text || "").trim(),
      zh: String(segment?.zh || segment?.translationZh || segment?.translation || "").trim()
    }))
    .filter((segment) => segment.original || segment.zh)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .slice(0, 40);
}

function normalizeTextList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const text = String(value || "").trim();
  return text ? [text] : [];
}

function formatSegmentTime(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.max(0, number).toFixed(1)}s` : "0.0s";
}

function renderInsightList(target, insights) {
  target.innerHTML = "";
  const validInsights = Array.isArray(insights)
    ? insights.filter((insight) => String(insight?.point || insight || "").trim())
    : [];

  if (!validInsights.length) {
    const empty = document.createElement("li");
    empty.textContent = "暂无可归纳观点。";
    target.appendChild(empty);
    return;
  }

  validInsights.forEach((insight) => {
    const item = document.createElement("li");
    if (typeof insight === "string") {
      item.textContent = insight;
    } else {
      item.textContent = insight.point;
    }
    target.appendChild(item);
  });
}

function renderResultApp(fragment, app) {
  const link = fragment.querySelector(".result-app-link");
  const logo = fragment.querySelector(".result-app-logo");
  const name = fragment.querySelector(".result-app-name");

  if (!app) {
    link.removeAttribute("href");
    logo.hidden = true;
    name.textContent = "未绑定";
    return;
  }

  link.href = app.appStoreUrl || "#";
  logo.src = app.logoUrl || "";
  logo.hidden = !app.logoUrl;
  name.textContent = formatAppDisplayName(app.name);
}

async function loadAgentStatus() {
  agentRefreshButton.disabled = true;
  try {
    const response = await fetch("/api/agent/status");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "读取 Agent 状态失败");
    }
    renderAgentStatus(payload);
  } catch (error) {
    agentServerStatus.textContent = "读取失败";
    agentServerDetail.textContent = error.message;
    agentLaunchStatus.textContent = "未知";
    agentLaunchDetail.textContent = "无法读取 LaunchAgent 状态。";
    agentCliList.innerHTML = "";
  } finally {
    agentRefreshButton.disabled = false;
  }
}

function renderAgentStatus(status) {
  agentServerStatus.textContent = status.localServer?.running ? "运行中" : "未运行";
  agentServerDetail.textContent = status.localServer?.running
    ? `${status.localServer.url} · pid ${status.localServer.pid}`
    : "本地服务未响应。";

  agentLaunchStatus.textContent = status.launchAgent?.loaded ? "已安装并加载" : "未加载";
  agentLaunchDetail.textContent = status.launchAgent?.loaded
    ? `label ${status.launchAgent.label}${status.launchAgent.pid ? ` · pid ${status.launchAgent.pid}` : ""}`
    : "还没有安装 LaunchAgent，或当前服务是手动启动。";

  renderAgentCommands(status.commands);
  agentLogPaths.textContent = formatAgentLogs(status.logs);
  renderAgentCliList(status.cli || {});
}

function renderAgentCommands(commands = {}) {
  agentCommandList.innerHTML = "";
  [
    ["安装", commands.install || "install-agent.command"],
    ["执行 / 启动", commands.start || "start-agent.command"],
    ["停机", commands.stop || "stop-agent.command"],
    ["卸载", commands.uninstall || "uninstall-agent.command"]
  ].forEach(([label, command]) => {
    const card = document.createElement("article");
    card.className = "agent-command-item";
    card.innerHTML = `
      <span>${escapeHtml(label)}</span>
      <code>${escapeHtml(command)}</code>
      <button type="button">复制</button>
    `;
    card.querySelector("button").addEventListener("click", async () => {
      await navigator.clipboard.writeText(command);
      showToast(`已复制：${label}`);
    });
    agentCommandList.appendChild(card);
  });
}

function renderAgentCliList(cli) {
  agentCliList.innerHTML = "";
  Object.entries(cli).forEach(([name, item]) => {
    const row = document.createElement("article");
    row.className = "agent-cli-row";
    row.classList.toggle("missing", !item.available);
    row.innerHTML = `
      <span>${escapeHtml(formatCliName(name))}</span>
      <strong>${item.available ? "可用" : "缺失"}</strong>
      <p>${escapeHtml(item.version || item.error || item.command || "")}</p>
    `;
    agentCliList.appendChild(row);
  });
}

function formatAgentLogs(logs = {}) {
  return [
    `stdout: ${logs.stdout || ".codex_tmp/agent.out.log"}`,
    `stderr: ${logs.stderr || ".codex_tmp/agent.err.log"}`
  ].join("\n");
}

function getBatchImportLimit() {
  const rawLimit = Number(batchLimitSelect?.value) || DEFAULT_BATCH_IMPORT_LIMIT;
  return Math.max(1, Math.min(MAX_BATCH_IMPORT_LIMIT, rawLimit));
}

function getArticleSearchLimit() {
  const rawLimit = Number(articleSearchLimitSelect?.value) || 10;
  return Math.max(10, Math.min(100, Math.round(rawLimit / 10) * 10));
}

function openBatchConfirmModal({ app, query, items, limit = DEFAULT_BATCH_IMPORT_LIMIT }) {
  const preparedItems = dedupeBatchItems(items, normalizeVideoUrl).slice(0, limit).map((item, index) => ({
    ...item,
    reviewId: `${Date.now()}-${index}`,
    likelyRelevant: guessBatchCandidateRelevance(item, app, query)
  }));
  pendingBatchReview = { app, query, items: preparedItems };
  const coverCount = preparedItems.filter((item) => item.coverUrl).length;
  batchConfirmTitle.textContent = `确认「${query}」的候选视频`;
  batchConfirmSummary.textContent = `目标 App：${formatAppDisplayName(app.name)}。已抓到 ${coverCount}/${preparedItems.length} 个封面；默认会勾选标题/卡片文案命中 App 或搜索词的候选。`;
  batchConfirmList.innerHTML = "";
  batchConfirmList.dataset.ui = "card-grid-v2";

  preparedItems.forEach((item, index) => {
    const row = document.createElement("label");
    row.className = "batch-confirm-item";
    row.style.cssText = [
      "position:relative",
      "display:flex",
      "flex-direction:column",
      "gap:7px",
      "width:170px",
      "min-height:340px",
      "min-width:0",
      "padding:0 0 9px",
      "border:1px solid rgba(54,44,34,.12)",
      "border-radius:18px",
      "background:rgba(255,252,246,.78)",
      "overflow:hidden",
      "cursor:pointer"
    ].join(";");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = item.reviewId;
    checkbox.checked = item.likelyRelevant;
    checkbox.style.cssText = "position:absolute;top:7px;left:7px;z-index:2;width:16px;height:16px;accent-color:#0d6f5b;";

    const media = document.createElement("span");
    media.className = "batch-confirm-media";
    media.style.cssText = [
      "position:relative",
      "display:block",
      "aspect-ratio:9/16",
      "width:100%",
      "height:238px",
      "min-height:238px",
      "flex:0 0 238px",
      "background:linear-gradient(145deg,#211910,#77634e)",
      "overflow:hidden"
    ].join(";");
    if (item.coverUrl) {
      const image = document.createElement("img");
      image.src = item.coverUrl;
      image.alt = item.text || item.title || `候选视频 ${index + 1}`;
      image.loading = "lazy";
      image.style.cssText = "display:block;width:100%;height:100%;object-fit:cover;";
      media.append(image);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "batch-confirm-media-fallback";
      fallback.textContent = "No Cover";
      fallback.style.cssText = "position:absolute;inset:0;display:grid;place-items:center;color:rgba(255,255,255,.72);font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;";
      media.append(fallback);
    }
    if (item.duration) {
      const duration = document.createElement("span");
      duration.className = "batch-confirm-duration";
      duration.textContent = item.duration;
      media.append(duration);
    }
    if (item.mediaType === "photo") {
      const badge = document.createElement("span");
      badge.className = "batch-confirm-duration";
      badge.textContent = "图集";
      media.append(badge);
    }

    const body = document.createElement("span");
    body.className = "batch-confirm-item-body";
    body.style.cssText = "display:grid;gap:4px;min-width:0;padding:0 9px;";
    const title = document.createElement("span");
    title.className = "batch-confirm-item-title";
    title.textContent = item.text || item.caption || item.title || `候选视频 ${index + 1}`;
    title.style.cssText = "display:-webkit-box;min-height:36px;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;color:#252018;font-size:12px;font-weight:800;line-height:1.55;";
    const meta = document.createElement("span");
    meta.className = "batch-confirm-item-meta";
    meta.textContent = [
      item.author ? `@${item.author}` : "",
      item.mediaType === "photo" ? "图集将走图片理解" : "",
      item.url
    ].filter(Boolean).join(" · ");
    meta.style.cssText = "display:-webkit-box;min-height:30px;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;color:#7a6f64;font-size:11px;line-height:1.45;overflow-wrap:anywhere;";
    const engagement = document.createElement("span");
    engagement.className = "batch-confirm-item-engagement";
    engagement.textContent = formatEngagementLine(item.engagement);
    engagement.hidden = !engagement.textContent;
    engagement.style.cssText = "color:#0d6f5b;font-size:11px;font-weight:900;line-height:1.3;";
    const published = document.createElement("span");
    published.className = "batch-confirm-item-published";
    published.textContent = formatPublishedLine(item);
    published.hidden = !published.textContent;
    published.style.cssText = "color:#7a6f64;font-size:11px;font-weight:800;line-height:1.3;";

    body.append(title, meta);
    if (!published.hidden) {
      body.append(published);
    }
    if (!engagement.hidden) {
      body.append(engagement);
    }
    row.append(checkbox, media, body);
    batchConfirmList.append(row);
  });

  updateBatchSelectedCount();
  batchConfirmModal.showModal();
}

function closeBatchConfirmModal() {
  pendingBatchReview = null;
  batchConfirmModal.close();
}

function getSelectedBatchItems() {
  if (!pendingBatchReview) {
    return [];
  }
  const selectedIds = new Set(
    Array.from(batchConfirmList.querySelectorAll("input[type='checkbox']:checked")).map((input) => input.value)
  );
  return pendingBatchReview.items
    .filter((item) => selectedIds.has(item.reviewId))
    .map(({ reviewId, likelyRelevant, ...item }) => item);
}

function updateBatchSelectedCount() {
  const total = batchConfirmList.querySelectorAll("input[type='checkbox']").length;
  const selected = batchConfirmList.querySelectorAll("input[type='checkbox']:checked").length;
  batchSelectedCount.textContent = `已选择 ${selected}/${total} 条`;
  batchConfirmSubmit.disabled = selected === 0;
}

function renderResultEngagement(container, engagement = {}) {
  if (!container) {
    return;
  }
  const metrics = [
    ["赞", formatEngagementCount(engagement.likeCount, engagement.likeText)],
    ["评", formatEngagementCount(engagement.commentCount, engagement.commentText)],
    ["播", formatEngagementCount(engagement.viewCount, engagement.viewText)],
    ["转", formatEngagementCount(engagement.shareCount, engagement.shareText)]
  ].filter(([, value]) => value);
  container.classList.toggle("is-empty", !metrics.length);
  if (!metrics.length) {
    container.textContent = "暂无数据";
    return;
  }
  container.innerHTML = metrics.map(([label, value]) => `
    <span class="engagement-pill">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </span>
  `).join("");
}

function requestTikTokBatchImport(payload) {
  return requestChromeExtension("TT2TEXT_IMPORT_TIKTOK_SEARCH", payload, {
    timeoutMs: 120000,
    timeoutMessage: "没有收到 Chrome 插件响应。请刷新 TT2Text 页面，并确认已重新加载 TT2Text Collector 插件；也可以直接打开 TikTok 搜索页后从插件 popup 采集。"
  });
}

function requestTikTokCommentsBatch(payload) {
  return requestChromeExtension("TT2TEXT_IMPORT_TIKTOK_COMMENTS_BATCH", payload, {
    timeoutMs: 30 * 60 * 1000,
    timeoutMessage: "补采 TikTok 评论还没有返回。请确认 Chrome 插件仍在运行，或稍后查看结果表评论状态。"
  });
}

function notifyTikTokBatchConfirmed(payload) {
  requestChromeExtension("TT2TEXT_CLEAR_TIKTOK_STATUS", payload, {
    timeoutMs: 3000,
    timeoutMessage: "插件状态清理超时。"
  }).catch(() => {
    // Confirmation has already been written locally; extension status cleanup is best-effort.
  });
}

function activateTab(name) {
  const isResultsTab = name === "results";
  const isAgentTab = name === "agent";
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === name;
    button.classList.toggle("active", isActive);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.tabPanel === name);
  });
  resultsToolbar.hidden = !isResultsTab;
  document.body.classList.toggle("results-tab-active", isResultsTab);
  if (isAgentTab) {
    loadAgentStatus();
  }
}

async function activateResultType(name) {
  activeResultType = ["articles", "metrics"].includes(name) ? name : "videos";
  if (activeResultType !== "videos") {
    isFavoritesOnly = false;
  }
  selectedIds = new Set();
  isEditMode = false;

  resultTypeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.resultType === activeResultType);
  });
  resultTypePanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.resultPanel === activeResultType);
  });

  await loadActiveResults();
  syncEditMode();
  syncFavoriteEntry();
  updateSelectionSummary();
}

function syncEditMode() {
  editToggle.hidden = isEditMode;
  deleteSelectedButton.hidden = !isEditMode;
  editCancelButton.hidden = !isEditMode;
  selectionSummary.hidden = !isEditMode;

  resultsHeader.classList.toggle("edit-mode", isEditMode);
  articlesHeader.classList.toggle("edit-mode", isEditMode);
  metricsHeader.classList.toggle("edit-mode", isEditMode);
  document.querySelectorAll(".result-grid, .article-grid, .metrics-grid").forEach((grid) => {
    grid.classList.toggle("edit-mode", isEditMode);
  });

  document.querySelectorAll(".edit-only").forEach((node) => {
    node.hidden = !isEditMode;
  });
}

function updateSelectionSummary() {
  selectionSummary.textContent = `已选择 ${selectedIds.size} 条`;
  deleteSelectedButton.disabled = selectedIds.size === 0;
}

function renderFromCurrentDomSelectionReset() {
  loadActiveResults();
}

function findDuplicateResult(url) {
  const normalizedUrl = normalizeVideoUrl(url);
  return currentResults.find((item) => {
    return [item.sourceUrl, item.hyperlink]
      .filter(Boolean)
      .some((existingUrl) => normalizeVideoUrl(existingUrl) === normalizedUrl);
  }) || null;
}

function findDuplicateVideoJob(url) {
  const normalizedUrl = normalizeVideoUrl(url);
  return currentVideoJobs.find((item) => {
    return ["queued", "running"].includes(item.status) && normalizeVideoUrl(item.sourceUrl) === normalizedUrl;
  }) || null;
}

function findDuplicateArticle(url) {
  const normalizedUrl = normalizeVideoUrl(url);
  return currentArticles.find((item) => normalizeVideoUrl(item.sourceUrl) === normalizedUrl) || null;
}

function formatJobStatus(job) {
  if (job.status === "queued") {
    return "排队中";
  }
  if (job.status === "running") {
    return "处理中";
  }
  if (job.status === "completed") {
    return "已完成";
  }
  if (job.status === "failed") {
    return "失败";
  }
  return job.status || "未知";
}

function shortenUrl(value) {
  const text = String(value || "");
  return text.length > 72 ? `${text.slice(0, 69)}...` : text;
}

function formatArticleMeta(item) {
  const parts = [item.sourceName, item.author].filter(Boolean);
  const primary = parts.length ? parts.join(" / ") : "未知来源";
  return item.publishedAt ? `${primary}\n${formatDateOnly(item.publishedAt)}` : primary;
}

function normalizeArticleInsights(insights) {
  const validInsights = Array.isArray(insights)
    ? insights.map((insight) => insight?.point || insight).filter((insight) => String(insight || "").trim())
    : [];
  return validInsights.slice(0, 5);
}

function formatDateOnly(value) {
  return String(value || "").split("T")[0] || value;
}

function normalizeVideoUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    ["t", "q", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((key) => {
      parsed.searchParams.delete(key);
    });
    parsed.searchParams.sort();
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").trim().replace(/\/$/, "");
  }
}

setQueueSizeValue(localStorage.getItem(QUEUE_COLUMN_STORAGE_KEY) || "6");
loadApps();
loadResults();
loadArticles();
loadMetrics();
loadVideoJobs();
startJobPolling();
