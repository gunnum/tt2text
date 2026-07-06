import { escapeAttribute, escapeHtml, formatAppDisplayName, getSortTime } from "./core/format.js";
import { formatChromeExtensionError, requestChromeExtension } from "./core/chrome-extension.js";
import {
  dedupeBatchItems,
  formatEngagementCount,
  formatEngagementLine,
  formatPublishedLine,
  guessBatchCandidateRelevance
} from "./core/engagement.js";
import { setStatus, showToast } from "./core/ui.js";
import { createAdShotVideoCard } from "./core/video-card.js";

const appList = document.querySelector("#app-list");
const appEditToggle = document.querySelector("#app-edit-toggle");
const convertForm = document.querySelector("#convert-form");
const batchQueryInput = document.querySelector("#batch-query");
const batchLimitSelect = document.querySelector("#batch-limit");
const batchImportButton = document.querySelector("#batch-import-button");
const batchImportStatus = document.querySelector("#batch-import-status");
const statusEl = document.querySelector("#status");
const selectedAppBadge = document.querySelector("#selected-app-badge");
const videoJobList = document.querySelector("#video-job-list");
const videoLibrarySummary = document.querySelector("#video-library-summary");
const videoJobPagination = document.querySelector("#video-job-pagination");
const queueSizeInput = document.querySelector("#queue-size");
const videoSourceFilter = document.querySelector("#video-source-filter");
const recentResultsList = document.querySelector("#recent-results-list");
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
const toastEl = document.querySelector("#toast");

let apps = [];
let selectedAppId = "";
let currentResults = [];
let currentVideoJobs = [];
let currentAdShots = [];
let isAppEditMode = false;
let isLoadingVideoJobs = false;
let jobPollTimer = null;
let pendingBatchReview = null;

const VIDEO_LIBRARY_LIMIT = 20;
const DEFAULT_BATCH_IMPORT_LIMIT = 60;
const MAX_BATCH_IMPORT_LIMIT = 200;
const QUEUE_COLUMN_STORAGE_KEY = "tt2textQueueColumns";

  appEditToggle?.addEventListener("click", () => {
    isAppEditMode = !isAppEditMode;
    renderApps(selectedAppId);
  });

  convertForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = convertForm.querySelector("button[type='submit']");
    const input = convertForm.querySelector("input[name='url']");
    const url = input.value.trim();

    if (!selectedAppId) {
      setStatus(statusEl, "请先选择这个视频对应的 App。");
      return;
    }

    if (!url) {
      setStatus(statusEl, "请先输入视频链接。");
      return;
    }

    const duplicate = findDuplicateResult(url);
    const duplicateJob = findDuplicateVideoJob(url);
    if (duplicate || duplicateJob) {
      const message = duplicate
        ? `这个视频链接已经录入过了：${duplicate.title || duplicate.createdAt}`
        : `这个视频已经在队列里：${formatJobStatus(duplicateJob)}`;
      setStatus(statusEl, message);
      showToast(toastEl, message);
      return;
    }

    submitButton.disabled = true;
    const isTopAdsUrl = isTopAdsDetailUrl(url);
    setStatus(statusEl, isTopAdsUrl ? "正在录入视频素材。" : "正在录入视频。");
    try {
      const payload = isTopAdsUrl
        ? await importTopAdsVideo(url, selectedAppId)
        : await enqueueNormalVideo(url, selectedAppId);
      input.value = "";
      await loadVideoJobs();
      if (!isTopAdsUrl) startJobPolling();
      setStatus(statusEl, isTopAdsUrl ? "视频素材已录入。" : `已录入视频：${shortenUrl(url)}。`);
      showToast(toastEl, isTopAdsUrl ? "视频素材已录入" : "视频已录入");
    } catch (error) {
      setStatus(statusEl, `录入视频失败：${error.message}`);
      showToast(toastEl, `录入视频失败：${error.message}`);
    } finally {
      submitButton.disabled = false;
    }
  });

  batchImportButton?.addEventListener("click", async () => {
    const app = apps.find((item) => item.id === selectedAppId);
    if (!app) {
      setStatus(statusEl, "请先选择要绑定的 App。");
      return;
    }
    const query = (batchQueryInput.value.trim() || formatAppDisplayName(app.name)).trim();
    if (!query) {
      setStatus(statusEl, "请先输入 TikTok 搜索词。");
      return;
    }
    const limit = getBatchImportLimit();
    batchImportButton.disabled = true;
    batchImportStatus.textContent = `正在打开 TikTok 搜索「${query}」，采集前 ${limit} 个候选...`;
    setStatus(statusEl, "批量导入已触发，会先抓候选，等待你确认后才真正入队。");
    try {
      const payload = await requestTikTokBatchImport({ query, appId: app.id, limit, previewOnly: true });
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (!items.length) {
        throw new Error("没有采集到候选视频。");
      }
      const message = `已采集 ${items.length} 条候选，请手动勾选真正相关的视频。`;
      batchImportStatus.textContent = message;
      setStatus(statusEl, message);
      openBatchConfirmModal({ app, query, items, limit });
    } catch (error) {
      const message = `批量录入失败：${formatChromeExtensionError(error.message)}`;
      batchImportStatus.textContent = message;
      setStatus(statusEl, message);
      showToast(toastEl, message);
    } finally {
      batchImportButton.disabled = false;
    }
  });

  ignoreFailedJobsButton?.addEventListener("click", async () => {
    await handleFailedJobsAction({
      endpoint: "/api/video-jobs/ignore-failed",
      pendingText: "正在忽略全部失败任务...",
      doneText: (payload) => `已忽略 ${payload.ignored || 0} 个失败任务。`
    });
  });

  retryFailedJobsButton?.addEventListener("click", async () => {
    await handleFailedJobsAction({
      endpoint: "/api/video-jobs/retry-failed",
      pendingText: "正在把全部失败任务重新排队...",
      doneText: (payload) => `已重新排队 ${payload.retried || 0} 个失败任务。`
    });
  });

  queueSizeInput?.addEventListener("input", () => {
    setQueueSizeValue(queueSizeInput.value);
  });
  videoSourceFilter?.addEventListener("change", () => {
    renderVideoLibrary();
  });

  batchConfirmClose?.addEventListener("click", () => closeBatchConfirmModal());
  batchConfirmCancel?.addEventListener("click", () => closeBatchConfirmModal());
  batchConfirmModal?.addEventListener("click", (event) => {
    const card = batchConfirmModal.querySelector(".modal-card");
    if (card && !card.contains(event.target)) {
      closeBatchConfirmModal();
    }
  });
  batchSelectAll?.addEventListener("click", () => {
    batchConfirmList.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.checked = !input.disabled;
    });
    updateBatchSelectedCount();
  });
  batchSelectNone?.addEventListener("click", () => {
    batchConfirmList.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.checked = false;
    });
    updateBatchSelectedCount();
  });
  batchConfirmList?.addEventListener("change", (event) => {
    if (event.target.matches("input[type='checkbox']")) {
      updateBatchSelectedCount();
    }
  });
  batchConfirmSubmit?.addEventListener("click", async () => {
    if (!pendingBatchReview) {
      return;
    }
    const selectedItems = getSelectedBatchItems();
    if (!selectedItems.length) {
      showToast(toastEl, "请至少选择 1 条要入队的视频。");
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
      setStatus(statusEl, message);
      showToast(toastEl, message);
      notifyTikTokBatchConfirmed({
        query: pendingBatchReview.query,
        appId: pendingBatchReview.app.id,
        message
      });
      closeBatchConfirmModal();
      await loadVideoJobs();
      startJobPolling();
    } catch (error) {
      setStatus(statusEl, `批量入队失败：${error.message}`);
      showToast(toastEl, `批量入队失败：${error.message}`);
    } finally {
      batchConfirmSubmit.disabled = false;
      batchConfirmSubmit.textContent = "确认入队";
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

    if (selectedAppBadge) {
      const selectedApp = apps.find((app) => app.id === selectedAppId);
      selectedAppBadge.textContent = selectedApp
        ? `当前 App：${formatAppDisplayName(selectedApp.name)}`
        : "当前 App：未选择";
    }
    if (batchQueryInput) {
      const selectedApp = apps.find((app) => app.id === selectedAppId);
      batchQueryInput.placeholder = selectedApp
        ? `默认会用 ${formatAppDisplayName(selectedApp.name)} 作为搜索词`
        : "先选 App，再决定搜索词";
    }

    appList.innerHTML = "";
    appList.classList.toggle("app-edit-mode", isAppEditMode);
    appEditToggle.textContent = isAppEditMode ? "完成" : "编辑";
    appEditToggle.classList.toggle("active", isAppEditMode);
    appEditToggle.disabled = apps.length === 0;

    if (!apps.length) {
      const empty = document.createElement("p");
      empty.className = "app-empty";
      empty.textContent = "还没有 App。请先回首页右上角添加 App。";
      appList.appendChild(empty);
      renderRecentResults(currentResults);
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
        ${isActive ? '<span class="app-chip-check" aria-hidden="true">✓</span>' : ""}
        ${isAppEditMode ? `<span class="app-chip-delete" aria-label="删除 ${escapeAttribute(formatAppDisplayName(app.name))}">删除</span>` : ""}
      `;
      chip.addEventListener("click", async (event) => {
        if (event.target.closest(".app-chip-delete")) {
          event.stopPropagation();
          if (!isAppEditMode) return;
          await deleteAppFromLibrary(app);
          return;
        }
        renderApps(app.id);
        renderRecentResults(currentResults);
        setStatus(statusEl, `已选择 App：${app.name}。`);
      });
      appList.appendChild(chip);
    });

    renderRecentResults(currentResults);
  }

  async function deleteAppFromLibrary(app) {
    const displayName = formatAppDisplayName(app.name);
    const shouldDelete = window.confirm(`确定删除首页里的 App「${displayName}」吗？`);
    if (!shouldDelete) return;

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
      await Promise.all([loadApps(), loadResults(), loadVideoJobs()]);
      setStatus(statusEl, deleteRelated
        ? `已删除 ${displayName} 及相关内容。`
        : `已删除首页 App 信息：${displayName}，已有内容保留。`);
      showToast(toastEl, `已删除 ${displayName}`);
    } catch (error) {
      setStatus(statusEl, `删除 App 失败：${error.message}`);
      showToast(toastEl, `删除 App 失败：${error.message}`);
    }
  }

  async function loadResults() {
    const response = await fetch("/api/results");
    currentResults = await response.json();
    renderRecentResults(currentResults);
  }

  async function enqueueNormalVideo(url, appId) {
    const response = await fetch("/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, appId })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "录入视频失败");
    }
    return payload;
  }

  async function importTopAdsVideo(url, appId) {
    const response = await fetch("/api/ad-shots/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl: url,
        appId,
        captureContext: "manual_url"
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "录入视频素材失败");
    }
    return payload;
  }

  function isTopAdsDetailUrl(url) {
    return /ads\.tiktok\.com\/business\/creativecenter\/topads\//i.test(url);
  }

  function renderRecentResults(items) {
    if (!recentResultsList) return;
    recentResultsList.innerHTML = "";
    const visibleItems = items
      .filter((item) => !selectedAppId || item.appId === selectedAppId || item.app?.id === selectedAppId)
      .sort((a, b) => getSortTime(b.createdAt) - getSortTime(a.createdAt))
      .slice(0, 10);

    if (!visibleItems.length) {
      const empty = document.createElement("div");
      empty.className = "video-job-empty";
      empty.textContent = selectedAppId
        ? "这个 App 还没有视频记录。"
        : "还没有转换记录。";
      recentResultsList.appendChild(empty);
      return;
    }

    visibleItems.forEach((item) => {
      const row = document.createElement("article");
      row.className = "recent-result-card";
      row.innerHTML = `
        <div class="recent-result-head">
          <div>
            <p class="recent-result-app">${escapeHtml(formatAppDisplayName(item.app?.name || "未绑定"))}</p>
            <h3>${escapeHtml(item.title || shortenUrl(item.sourceUrl || item.hyperlink || "未命名视频"))}</h3>
          </div>
          <span class="video-job-badge">${escapeHtml(item.createdAt || "")}</span>
        </div>
        <p class="recent-result-copy">${escapeHtml((item.transcriptZh || item.visualSummary || "暂无中文内容。").slice(0, 180))}</p>
        <div class="recent-result-actions">
          <a class="video-job-action" href="${escapeAttribute(item.hyperlink || item.sourceUrl || "#")}" target="_blank" rel="noreferrer">原链接</a>
          ${item.firstFramePath ? `<a class="video-job-action" href="${escapeAttribute(item.firstFramePath)}" target="_blank" rel="noreferrer">首帧</a>` : ""}
        </div>
      `;
      recentResultsList.appendChild(row);
    });
  }

  async function loadVideoJobs() {
    if (isLoadingVideoJobs) return;
    isLoadingVideoJobs = true;
    try {
      const [jobsResponse, shotsResponse] = await Promise.all([
        fetch("/api/video-jobs"),
        fetch("/api/ad-shots")
      ]);
      if (!jobsResponse.ok) {
        throw new Error(`HTTP ${jobsResponse.status}`);
      }
      currentVideoJobs = await jobsResponse.json();
      currentAdShots = shotsResponse.ok ? await shotsResponse.json() : [];
      renderVideoLibrary();
      renderFailedJobCard(currentVideoJobs);
    } catch (error) {
      console.warn("Failed to refresh video jobs", error);
    } finally {
      isLoadingVideoJobs = false;
    }
  }

  function renderVideoLibrary() {
    const source = videoSourceFilter?.value || "all";
    const items = [
      ...(source === "queue" ? [] : currentAdShots.map(normalizeAdShotLibraryItem)),
      ...(source === "ads" ? [] : currentVideoJobs.map(normalizeVideoJobLibraryItem))
    ].sort((a, b) => getSortTime(b.sortTime) - getSortTime(a.sortTime));
    renderVideoLibrarySummary(items.length);
    renderVideoJobs(items);
  }

  function renderVideoLibrarySummary(totalCount) {
    if (!videoLibrarySummary) return;
    const source = videoSourceFilter?.value || "all";
    const sourceLabel = source === "queue"
      ? "TikTok 视频"
      : source === "ads"
        ? "视频素材"
        : "视频";
    videoLibrarySummary.textContent = `目前库里有 ${totalCount} 个${sourceLabel}，此处只展示最新 ${VIDEO_LIBRARY_LIMIT} 个。`;
  }

  function normalizeVideoJobLibraryItem(job) {
    return {
      type: "queue",
      id: job.id,
      sortTime: job.updatedAt || job.createdAt,
      raw: job
    };
  }

  function normalizeAdShotLibraryItem(shot) {
    return {
      type: "ads",
      id: shot.shotId || shot.id,
      sortTime: shot.updatedAt || shot.createdAt || shot.collectedAt,
      raw: shot
    };
  }

  function renderVideoJobs(items) {
    videoJobList.innerHTML = "";
    videoJobPagination.hidden = true;
    videoJobPagination.innerHTML = "";
    const visibleJobs = sortVideoJobsForDisplay(items).slice(0, VIDEO_LIBRARY_LIMIT);
    if (!visibleJobs.length) {
      const empty = document.createElement("div");
      empty.className = "video-job-empty";
      empty.textContent = "暂无排队任务。";
      videoJobList.appendChild(empty);
      return;
    }

    visibleJobs.forEach((item) => {
      const card = item.type === "ads" ? createAdShotVideoCard(item.raw, { from: "ingest" }) : renderVideoJobCard(item.raw);
      videoJobList.appendChild(card);
    });
  }

  function renderVideoJobCard(job) {
      const card = document.createElement("article");
      card.className = `video-job-card status-${job.status}`;
      const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
      const coverPath = getVideoJobCoverPath(job);
      const originalUrl = job.hyperlink || job.sourceUrl;
      const result = getVideoJobResult(job);
      const detailUrl = result?.id ? `/videos/detail.html?source=normal&id=${encodeURIComponent(result.id)}&from=ingest` : "";
      card.innerHTML = `
        <${detailUrl ? "a" : "div"} class="video-job-cover ${coverPath ? "" : "is-empty"}" ${detailUrl ? `href="${escapeAttribute(detailUrl)}"` : ""}>
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
            ${job.status === "failed" ? '<button type="button" class="video-job-retry-button">重试</button>' : ""}
            ${job.error ? `<p class="video-job-error">${escapeHtml(job.error)}</p>` : ""}
            <div class="video-job-hover-actions">
              <a class="video-job-action" href="${escapeAttribute(originalUrl)}" target="_blank" rel="noreferrer">原链接</a>
            </div>
            <div class="video-job-bottom">
              <span class="video-job-badge">${escapeHtml(formatJobStatus(job))}</span>
              <div class="video-job-progress" aria-label="转换进度 ${progress}%"><span style="width:${progress}%"></span></div>
            </div>
          </div>
        </${detailUrl ? "a" : "div"}>
      `;

      card.querySelectorAll(".video-job-action").forEach((action) => {
        action.addEventListener("click", (event) => event.stopPropagation());
      });

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
            setStatus(statusEl, `已重新排队：${shortenUrl(job.sourceUrl)}`);
            showToast(toastEl, "已重新排队");
            await loadVideoJobs();
            startJobPolling();
          } catch (error) {
            setStatus(statusEl, `重试失败：${error.message}`);
            showToast(toastEl, `重试失败：${error.message}`);
          } finally {
            retryButton.disabled = false;
          }
        });
      }

      return card;
  }

  async function handleFailedJobsAction({ endpoint, pendingText, doneText }) {
    setFailedJobButtonsDisabled(true);
    setStatus(statusEl, pendingText);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "操作失败");
      }
      await loadVideoJobs();
      const message = doneText(payload);
      setStatus(statusEl, message);
      showToast(toastEl, message);
    } catch (error) {
      const message = `失败任务处理失败：${error.message}`;
      setStatus(statusEl, message);
      showToast(toastEl, message);
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
    if (jobPollTimer) return;
    jobPollTimer = window.setInterval(async () => {
      await loadVideoJobs();
      if (currentVideoJobs.some((job) => ["running", "completed"].includes(job.status))) {
        await loadResults();
      }
    }, 2500);
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
        fallback.textContent = "No Cover";
        fallback.style.cssText = "position:absolute;inset:0;display:grid;place-items:center;color:rgba(255,255,255,.72);font-size:12px;font-weight:900;";
        media.append(fallback);
      }

      const body = document.createElement("span");
      body.style.cssText = "display:grid;gap:6px;padding:0 10px;";
      const title = document.createElement("strong");
      title.textContent = item.text || item.title || item.caption || `候选视频 ${index + 1}`;
      title.style.cssText = "display:-webkit-box;overflow:hidden;color:#1f1c18;font-size:13px;line-height:1.45;-webkit-box-orient:vertical;-webkit-line-clamp:3;";
      body.append(title);
      const meta = document.createElement("span");
      meta.textContent = [item.author, item.duration, shortenUrl(item.url || "")]
        .filter(Boolean)
        .join(" · ");
      meta.style.cssText = "color:#6c6257;font-size:12px;line-height:1.5;overflow-wrap:anywhere;";
      body.append(meta);

      row.append(checkbox, media, body);
      batchConfirmList.appendChild(row);
    });

    updateBatchSelectedCount();
    batchConfirmModal.showModal();
  }

  function closeBatchConfirmModal() {
    pendingBatchReview = null;
    batchConfirmModal.close();
  }

  function getSelectedBatchItems() {
    if (!pendingBatchReview) return [];
    const selectedIds = new Set(
      Array.from(batchConfirmList.querySelectorAll("input[type='checkbox']:checked"))
        .map((input) => input.value)
    );
    return pendingBatchReview.items
      .filter((item) => selectedIds.has(item.reviewId))
      .map((item) => ({
        url: item.url,
        title: item.title || item.text || "",
        caption: item.caption || "",
        text: item.text || "",
        author: item.author || "",
        duration: item.duration || "",
        coverUrl: item.coverUrl || "",
        mediaType: item.mediaType || ""
      }));
  }

  function updateBatchSelectedCount() {
    const total = batchConfirmList.querySelectorAll("input[type='checkbox']").length;
    const selected = batchConfirmList.querySelectorAll("input[type='checkbox']:checked").length;
    batchSelectedCount.textContent = `已选择 ${selected}/${total} 条`;
    batchConfirmSubmit.disabled = selected === 0;
  }

  function requestTikTokBatchImport(payload) {
    return requestChromeExtension("TT2TEXT_IMPORT_TIKTOK_SEARCH", payload, {
      timeoutMs: 120000,
      timeoutMessage: "没有收到 Chrome 插件响应。请刷新当前页面，并确认已重新加载 TT2Text Collector 插件。"
    });
  }

  function notifyTikTokBatchConfirmed(payload) {
    requestChromeExtension("TT2TEXT_CLEAR_TIKTOK_STATUS", payload, {
      timeoutMs: 3000,
      timeoutMessage: "插件状态清理超时。"
    }).catch(() => {});
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

  function sortVideoJobsForDisplay(jobs) {
    const statusRank = { failed: 0, running: 1, queued: 2, completed: 3 };
    return [...jobs].sort((a, b) => {
      if (a.type || b.type) {
        return getSortTime(b.sortTime) - getSortTime(a.sortTime);
      }
      const rankDiff = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
      if (rankDiff !== 0) return rankDiff;
      return getSortTime(b.updatedAt || b.createdAt) - getSortTime(a.updatedAt || a.createdAt);
    });
  }

  function getVideoJobCoverPath(job) {
    if (job.firstFramePath) return job.firstFramePath;
    if (job.coverUrl) return job.coverUrl;
    const result = getVideoJobResult(job);
    return result?.firstFramePath || "";
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
    if (job.status === "queued") return "等待封面";
    if (job.status === "running") return "处理中";
    if (job.status === "failed") return "无封面";
    return "封面生成中";
  }

  function getBatchImportLimit() {
    const rawLimit = Number(batchLimitSelect?.value) || DEFAULT_BATCH_IMPORT_LIMIT;
    return Math.max(1, Math.min(MAX_BATCH_IMPORT_LIMIT, rawLimit));
  }

  function formatJobStatus(job) {
    if (job.status === "queued") return "排队中";
    if (job.status === "running") return "处理中";
    if (job.status === "completed") return "已完成";
    if (job.status === "failed") return "失败";
    return job.status || "未知";
  }

  function shortenUrl(value) {
    const text = String(value || "");
    return text.length > 72 ? `${text.slice(0, 69)}...` : text;
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
Promise.all([loadApps(), loadResults(), loadVideoJobs()]).then(() => {
  startJobPolling();
  setStatus(statusEl, "视频录入页已接回真实队列。");
}).catch((error) => {
  setStatus(statusEl, `初始化失败：${error.message}`);
});
