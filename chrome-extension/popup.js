import { getPopupElements } from "./popup-dom.js";
import {
  isCreativeCenterUrl,
  isSensorTowerOverviewUrl,
  isTikTokSearchUrl,
  isTikTokVideoUrl
} from "./popup-utils.js";
import { renderAdShotImportedStatus } from "./popup-shot-status.js";
import {
  initCreativeCenterMode,
  initSensorTowerMode,
  initTikTokMode,
  initTikTokVideoMode,
  initUnsupportedMode
} from "./popup-modes.js";
import { persistLastSelectedApp, selectedApp } from "./popup-apps.js";

const ctx = {
  el: getPopupElements(),
  state: {
    activeTab: null,
    currentMode: "unsupported",
    lastPayload: null,
    currentTikTokQuery: "",
    apps: [],
    popupOverlayTimer: null,
    statusPollTimer: null,
    activeBackgroundTaskId: ""
  },
  async debugLog(scope, event, detail = {}) {
    try {
      await chrome.runtime.sendMessage({
        type: "TT2TEXT_APPEND_DEBUG_LOG",
        payload: { scope, event, detail }
      });
    } catch {
      // Ignore debug logging failures.
    }
  }
};

init();
bindEvents();

function bindEvents() {
  const { el } = ctx;

  el.appSelectEl?.addEventListener("change", () => {
    const appId = String(el.appSelectEl?.value || "").trim();
    if (!appId) {
      return;
    }
    void persistLastSelectedApp(appId);
  });

  el.collectButton.addEventListener("click", async () => {
    el.collectButton.disabled = true;
    showPopupOverlay({
      title: ctx.state.currentMode === "tiktok"
        ? "正在采集搜索结果"
        : ctx.state.currentMode === "tiktok-video"
          ? "正在入库当前视频"
          : ctx.state.currentMode === "creative-center"
            ? "正在采集当前页面"
            : "正在导出数据",
      message: ctx.state.currentMode === "tiktok"
        ? "正在采集 TikTok 搜索结果并写入本地系统..."
        : ctx.state.currentMode === "tiktok-video"
          ? "正在入库当前 TikTok 视频，并采集当前已加载评论..."
          : ctx.state.currentMode === "creative-center"
            ? "正在采集 TikTok Creative Center 当前页..."
            : "正在导出 Sensor Tower CSV 并写入本地系统..."
    });

    const taskMessage = buildCollectTaskMessage();
    startBackgroundCollectionTask(taskMessage, {
      source: "collect-button",
      statusMessage: getCollectStatusMessage()
    });
  });

  el.commentCollectButton?.addEventListener("click", async () => {
    el.commentCollectButton.disabled = true;
    showPopupOverlay({
      title: "正在采集评论",
      message: "评论采集已交给后台执行；关闭插件面板不会中断。"
    });
    startBackgroundCollectionTask({
      type: "TT2TEXT_IMPORT_TIKTOK_COMMENTS",
      payload: {
        tabId: ctx.state.activeTab.id,
        expandCount: 0
      }
    }, {
      source: "comment-collect-button",
      statusMessage: "正在后台采集当前已加载评论..."
    });
  });

  el.batchCollectButton.addEventListener("click", async () => {
    el.batchCollectButton.disabled = true;
    el.collectButton.disabled = true;
    showPopupOverlay({
      title: "正在批量采集",
      message: "批量采集已交给后台执行；关闭插件面板不会中断。"
    });
    startBackgroundCollectionTask({
      type: "TT2TEXT_EXPORT_SENSOR_TOWER_BATCH",
      payload: {
        tabId: ctx.state.activeTab.id
      }
    }, {
      source: "batch-collect-button",
      statusMessage: "正在后台按固定筛选采集 Sensor Tower 全部数据..."
    });
  });

  el.testScrollButton.addEventListener("click", async () => {
    el.testScrollButton.disabled = true;
    el.resultMessage.textContent = "正在只测试 TikTok 页面滚动，不会写入本地系统...";
    try {
      const response = await chrome.runtime.sendMessage({
        type: "TT2TEXT_TEST_TIKTOK_SCROLL",
        payload: {
          query: ctx.state.currentTikTokQuery,
          tabId: ctx.state.activeTab.id
        }
      });
      if (!response?.ok) {
        throw new Error(response?.error || "滚动测试失败。");
      }
      el.resultMessage.textContent = `滚动测试完成：发现 ${response.payload?.collected || 0} 条视频链接，没有写入本地系统。`;
    } catch (error) {
      el.resultMessage.textContent = `滚动测试失败：${error.message}`;
    } finally {
      el.testScrollButton.disabled = ctx.state.currentMode !== "tiktok";
    }
  });
}

function buildCollectTaskMessage() {
  const app = selectedApp(ctx);
  if (ctx.state.currentMode === "sensortower") {
    return {
      type: isSensorTowerOverviewUrl(ctx.state.activeTab?.url || "")
        ? "TT2TEXT_IMPORT_SENSOR_TOWER_OVERVIEW"
        : "TT2TEXT_EXPORT_SENSOR_TOWER_CSV",
      payload: {
        tabId: ctx.state.activeTab.id
      }
    };
  }
  if (ctx.state.currentMode === "tiktok") {
    return {
      type: "TT2TEXT_IMPORT_TIKTOK_SEARCH",
      payload: {
        query: ctx.state.currentTikTokQuery,
        appQuery: ctx.state.currentTikTokQuery,
        tabId: ctx.state.activeTab.id,
        limit: 60
      }
    };
  }
  if (ctx.state.currentMode === "tiktok-video") {
    return {
      type: "TT2TEXT_IMPORT_TIKTOK_DETAIL_SHOT_WITH_COMMENTS",
      payload: {
        tabId: ctx.state.activeTab.id,
        targetApp: app?.name || "未指定",
        projectIds: [],
        appId: app?.id || ""
      }
    };
  }
  if (ctx.state.currentMode === "creative-center") {
    return {
      type: "TT2TEXT_IMPORT_AD_SHOTS_CURRENT_TAB",
      payload: {
        tabId: ctx.state.activeTab.id,
        targetApp: app?.name || "未指定",
        projectIds: [],
        appId: app?.id || "",
        limit: 80
      }
    };
  }
  throw new Error("当前页面暂不支持采集。");
}

function getCollectStatusMessage() {
  return ctx.state.currentMode === "tiktok"
    ? "正在后台采集 TikTok 搜索结果并写入本地系统..."
    : ctx.state.currentMode === "tiktok-video"
      ? "正在后台入库当前 TikTok 视频，并采集当前已加载评论..."
      : ctx.state.currentMode === "creative-center"
        ? "正在后台采集 TikTok Creative Center 当前页..."
        : "正在后台导出 Sensor Tower 数据并写入本地系统...";
}

async function startBackgroundCollectionTask(taskMessage, { source, statusMessage } = {}) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "TT2TEXT_START_BACKGROUND_IMPORT",
      payload: {
        source,
        statusMessage,
        taskMessage
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "后台采集任务启动失败。");
    }
    ctx.state.activeBackgroundTaskId = response.payload?.taskId || "";
    ctx.el.resultMessage.textContent = "采集任务已交给后台。你现在可以关闭插件面板。";
    showPopupOverlay({
      title: "后台采集中",
      message: "任务已交给后台执行；关闭插件面板不会中断。"
    });
    startStatusPolling();
  } catch (error) {
    await ctx.debugLog("popup", "task:start-error", {
      source,
      error: error?.message || String(error),
      mode: ctx.state.currentMode
    });
    showPopupOverlay({
      title: "采集失败",
      message: error?.message || String(error),
      error: true
    });
    restoreActionButtons();
  }
}

function startStatusPolling() {
  window.clearInterval(ctx.state.statusPollTimer);
  pollImportStatus({ allowTerminalPayload: true });
  ctx.state.statusPollTimer = window.setInterval(() => pollImportStatus({ allowTerminalPayload: true }), 1000);
}

async function pollImportStatus({ allowTerminalPayload = false } = {}) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "TT2TEXT_GET_IMPORT_STATUS" });
    if (!response?.ok) {
      throw new Error(response?.error || "读取后台采集状态失败。");
    }
    renderImportStatus(response.payload || {}, { allowTerminalPayload });
  } catch (error) {
    ctx.el.resultMessage.textContent = error?.message || String(error);
  }
}

function renderImportStatus(status = {}, { allowTerminalPayload = false } = {}) {
  const message = status.message || "";
  if (["running", "waiting_confirmation"].includes(status.state)) {
    if (message) {
      ctx.el.resultMessage.textContent = message;
    }
    showPopupOverlay({
      title: status.state === "waiting_confirmation" ? "等待确认" : "后台采集中",
      message: message || "后台任务正在运行。"
    });
    return;
  }

  if (status.state === "done" || status.state === "warning") {
    if (!allowTerminalPayload && !ctx.state.activeBackgroundTaskId) {
      return;
    }
    if (message) {
      ctx.el.resultMessage.textContent = message;
    }
    hidePopupOverlay();
    restoreActionButtons();
    renderStatusPayload(status.payload);
    stopStatusPollingSoon();
    return;
  }

  if (status.state === "error") {
    if (!allowTerminalPayload && !ctx.state.activeBackgroundTaskId) {
      return;
    }
    if (message) {
      ctx.el.resultMessage.textContent = message;
    }
    showPopupOverlay({
      title: "采集失败",
      message: message || "后台采集失败。",
      error: true
    });
    restoreActionButtons();
    stopStatusPollingSoon();
  }
}

function renderStatusPayload(payload = {}) {
  const shot = payload?.shot;
  if (shot && ctx.state.currentMode === "tiktok-video") {
    renderAdShotImportedStatus(ctx, payload.comments ? { ...shot, commentsRaw: payload.comments } : shot);
  }
}

function stopStatusPollingSoon() {
  window.clearTimeout(ctx.state.popupOverlayTimer);
  ctx.state.popupOverlayTimer = window.setTimeout(() => {
    window.clearInterval(ctx.state.statusPollTimer);
    ctx.state.statusPollTimer = null;
  }, 2500);
}

function showPopupOverlay({ title, message, error = false }) {
  window.clearTimeout(ctx.state.popupOverlayTimer);
  if (ctx.el.popupOverlayEl) {
    ctx.el.popupOverlayEl.hidden = false;
    ctx.el.popupOverlayEl.classList.toggle("error", Boolean(error));
  }
  if (ctx.el.popupOverlayTitleEl) {
    ctx.el.popupOverlayTitleEl.textContent = title || "";
  }
  if (ctx.el.popupOverlayMessageEl) {
    ctx.el.popupOverlayMessageEl.textContent = message || "";
  }
  if (ctx.el.popupOverlayEyebrowEl) {
    ctx.el.popupOverlayEyebrowEl.textContent = error ? "TT2TEXT ERROR" : "TT2TEXT COLLECTOR";
  }
}

function hidePopupOverlay() {
  window.clearTimeout(ctx.state.popupOverlayTimer);
  ctx.state.popupOverlayTimer = null;
  if (ctx.el.popupOverlayEl) {
    ctx.el.popupOverlayEl.hidden = true;
    ctx.el.popupOverlayEl.classList.remove("error");
  }
}

function restoreActionButtons() {
  ctx.el.collectButton.disabled = ctx.state.currentMode === "unsupported";
  if (ctx.el.commentCollectButton) {
    ctx.el.commentCollectButton.disabled = ctx.state.currentMode !== "tiktok-video";
  }
  if (ctx.el.batchCollectButton) {
    ctx.el.batchCollectButton.disabled = ctx.state.currentMode !== "sensortower";
  }
  if (ctx.el.testScrollButton) {
    ctx.el.testScrollButton.disabled = ctx.state.currentMode !== "tiktok";
  }
}

function init() {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      void hydrateInitialMode();
    }, 0);
  });
}

async function hydrateInitialMode() {
  try {
    [ctx.state.activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = ctx.state.activeTab?.url || "";
    if (url.includes("sensortower.com")) {
      void initSensorTowerMode(ctx);
      return;
    }
    if (isTikTokSearchUrl(url)) {
      initTikTokMode(ctx, url);
      return;
    }
    if (isTikTokVideoUrl(url)) {
      void initTikTokVideoMode(ctx, url);
      return;
    }
    if (isCreativeCenterUrl(url)) {
      void initCreativeCenterMode(ctx, url);
      return;
    }
    initUnsupportedMode(ctx);
  } catch (error) {
    initUnsupportedMode(ctx, `初始化失败：${error.message}`);
  } finally {
    window.setTimeout(() => {
      void pollImportStatus({ allowTerminalPayload: false });
    }, 150);
  }
}
