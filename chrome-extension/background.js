import { appendDebugLog, clearDebugLogs, getDebugLogs, getImportStatus, isDebugLoggingEnabled, setBadge, setDebugLoggingEnabled, setImportStatus } from "./background-common.js";
import { canHandleAdShotsMessage, handleAdShotsMessage } from "./background-ad-shots.js";
import { canHandleSensorTowerMessage, handleSensorTowerMessage } from "./background-sensortower.js";
import { canHandleTikTokMessage, handleTikTokMessage } from "./background-tiktok.js";

const activeImportTasks = new Map();
const IMPORT_KEEPALIVE_ALARM = "tt2text-import-keepalive";

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm?.name !== IMPORT_KEEPALIVE_ALARM || !activeImportTasks.size) {
    return;
  }
  void chrome.storage.local.set({
    tt2textImportKeepalive: {
      at: new Date().toISOString(),
      active: activeImportTasks.size
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "TT2TEXT_START_BACKGROUND_IMPORT") {
    try {
      const taskMessage = message?.payload?.taskMessage;
      const taskId = startBackgroundImportTask(taskMessage, {
        source: message?.payload?.source || "popup",
        statusMessage: message?.payload?.statusMessage || ""
      });
      sendResponse({ ok: true, payload: { taskId } });
    } catch (error) {
      sendResponse({ ok: false, error: toErrorMessage(error) });
    }
    return false;
  }

  if (message?.type === "TT2TEXT_GET_DEBUG_LOGS") {
    getDebugLogs()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  if (message?.type === "TT2TEXT_CLEAR_DEBUG_LOGS") {
    clearDebugLogs()
      .then(() => sendResponse({ ok: true, payload: { cleared: true } }))
      .catch((error) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  if (message?.type === "TT2TEXT_GET_DEBUG_LOGGING_ENABLED") {
    isDebugLoggingEnabled()
      .then((payload) => sendResponse({ ok: true, payload: { enabled: payload } }))
      .catch((error) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  if (message?.type === "TT2TEXT_SET_DEBUG_LOGGING_ENABLED") {
    setDebugLoggingEnabled(Boolean(message?.payload?.enabled))
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  if (message?.type === "TT2TEXT_APPEND_DEBUG_LOG") {
    appendDebugLog(message?.payload || {})
      .then(() => sendResponse({ ok: true, payload: { appended: true } }))
      .catch((error) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  if (message?.type === "TT2TEXT_GET_IMPORT_STATUS") {
    getImportStatus()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  if (canHandleTikTokMessage(message)) {
    void appendDebugLog({ scope: "background", event: "message:tiktok", detail: { type: message?.type } });
    handleTikTokMessage(message)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => {
        void appendDebugLog({ scope: "background", event: "message:tiktok:error", detail: { type: message?.type, error: toErrorMessage(error) } });
        sendResponse({ ok: false, error: toErrorMessage(error) });
      });
    return true;
  }

  if (canHandleAdShotsMessage(message)) {
    void appendDebugLog({ scope: "background", event: "message:adshot", detail: { type: message?.type } });
    handleAdShotsMessage(message)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => {
        void appendDebugLog({ scope: "background", event: "message:adshot:error", detail: { type: message?.type, error: toErrorMessage(error) } });
        sendResponse({ ok: false, error: toErrorMessage(error) });
      });
    return true;
  }

  if (canHandleSensorTowerMessage(message)) {
    void appendDebugLog({ scope: "background", event: "message:sensortower", detail: { type: message?.type } });
    handleSensorTowerMessage(message)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => {
        void appendDebugLog({ scope: "background", event: "message:sensortower:error", detail: { type: message?.type, error: toErrorMessage(error) } });
        sendResponse({ ok: false, error: toErrorMessage(error) });
      });
    return true;
  }

  return false;
});

function startBackgroundImportTask(taskMessage, options = {}) {
  if (!taskMessage || typeof taskMessage !== "object") {
    throw new Error("缺少后台采集任务。");
  }
  if (!canHandleTikTokMessage(taskMessage) && !canHandleAdShotsMessage(taskMessage) && !canHandleSensorTowerMessage(taskMessage)) {
    throw new Error(`不支持的后台采集任务：${taskMessage.type || "unknown"}`);
  }
  const taskId = `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const promise = runBackgroundImportTask(taskId, taskMessage, options)
    .catch(() => null)
    .finally(() => {
      activeImportTasks.delete(taskId);
      if (!activeImportTasks.size) {
        Promise.resolve(chrome.alarms?.clear?.(IMPORT_KEEPALIVE_ALARM)).catch(() => {});
      }
    });
  activeImportTasks.set(taskId, promise);
  chrome.alarms?.create?.(IMPORT_KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  return taskId;
}

async function runBackgroundImportTask(taskId, taskMessage, options = {}) {
  await appendDebugLog({
    scope: "background",
    event: "task:start",
    detail: { taskId, type: taskMessage.type, source: options.source || "" }
  });
  await setImportStatus({
    state: "running",
    taskId,
    taskType: taskMessage.type,
    message: options.statusMessage || "采集任务已交给后台执行，关闭插件面板也会继续。",
    updatedAt: new Date().toISOString()
  });

  try {
    const payload = canHandleTikTokMessage(taskMessage)
      ? await handleTikTokMessage(taskMessage)
      : canHandleAdShotsMessage(taskMessage)
        ? await handleAdShotsMessage(taskMessage)
        : await handleSensorTowerMessage(taskMessage);
    const currentStatus = await getImportStatus().catch(() => ({}));
    await setImportStatus({
      ...(currentStatus && typeof currentStatus === "object" ? currentStatus : {}),
      state: payload?.importError || payload?.commentError ? "warning" : "done",
      taskId,
      taskType: taskMessage.type,
      message: payload?.message || formatTaskDoneMessage(taskMessage, payload),
      payload,
      updatedAt: new Date().toISOString()
    });
    await appendDebugLog({
      scope: "background",
      event: "task:done",
      detail: { taskId, type: taskMessage.type }
    });
    return payload;
  } catch (error) {
    const message = toErrorMessage(error);
    await setImportStatus({
      state: "error",
      taskId,
      taskType: taskMessage.type,
      message,
      updatedAt: new Date().toISOString()
    });
    await setBadge("ERR", "#b6452f").catch(() => {});
    await appendDebugLog({
      scope: "background",
      event: "task:error",
      detail: { taskId, type: taskMessage.type, error: message }
    });
    throw error;
  }
}

function formatTaskDoneMessage(taskMessage, payload = {}) {
  switch (taskMessage?.type) {
    case "TT2TEXT_IMPORT_TIKTOK_SEARCH": {
      const totals = payload?.totals || {};
      return `TikTok 搜索采集完成：排队 ${totals.queued || 0} 条，重复 ${totals.skipped_duplicate || 0} 条。`;
    }
    case "TT2TEXT_IMPORT_TIKTOK_DETAIL_SHOT_WITH_COMMENTS":
    case "TT2TEXT_IMPORT_TIKTOK_DETAIL_SHOT":
      return "TikTok 视频采集完成。";
    case "TT2TEXT_IMPORT_TIKTOK_COMMENTS":
      return `TikTok 评论采集完成：${payload?.itemCount || 0} 条。`;
    case "TT2TEXT_IMPORT_AD_SHOTS_CURRENT_TAB":
      return payload?.mode === "detail"
        ? "Creative Center 当前广告已入库。"
        : `Creative Center 候选池已更新：新增 ${payload?.created || 0} 条，更新 ${payload?.updated || 0} 条。`;
    case "TT2TEXT_EXPORT_SENSOR_TOWER_BATCH":
    case "TT2TEXT_EXPORT_SENSOR_TOWER_CSV":
    case "TT2TEXT_IMPORT_SENSOR_TOWER_OVERVIEW":
      return "Sensor Tower 采集完成。";
    default:
      return "采集任务完成。";
  }
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
