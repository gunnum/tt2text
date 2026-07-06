import { fetchWithTimeout, isSensorTowerOverviewUrl } from "./popup-utils.js";
import { renderAdShotImportedStatus } from "./popup-shot-status.js";

const LOCAL_SENSOR_TOWER_LATEST_URL = "http://localhost:3000/api/sensortower-csv/latest";

export function renderDetectedApp(ctx, payload = {}) {
  const appName = payload.app?.name || payload.appName || "未识别 App";
  const developer = payload.app?.developer || payload.appDeveloper || payload.developer || "";
  ctx.el.detectedAppEl.textContent = appName;
  ctx.el.detectedDeveloperEl.textContent = developer ? `开发者：${developer}` : "";
}

export async function refreshSensorTowerLatestStatus(ctx, payload = ctx.state.lastPayload || {}) {
  const card = ctx.el.sensorLatestCardEl;
  if (!card) return;
  const appName = payload.app?.name || payload.appName || ctx.el.detectedAppEl?.textContent || "";
  const appId = payload.app?.id || payload.appId || "";
  const params = new URLSearchParams();
  if (appId) params.set("appId", appId);
  if (appName && appName !== "未识别 App" && appName !== "等待识别") params.set("appName", appName);
  const currentDataType = inferSensorTowerDataType(ctx.state.activeTab?.url || "");
  if (currentDataType) params.set("dataType", currentDataType);

  card.hidden = false;
  card.classList.remove("failed");
  ctx.el.sensorLatestTitleEl.textContent = "正在读取最近采集...";
  ctx.el.sensorLatestDetailEl.textContent = "";

  try {
    const response = await fetchWithTimeout(ctx, `${LOCAL_SENSOR_TOWER_LATEST_URL}?${params.toString()}`, {}, 2500);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    renderSensorTowerLatestStatus(ctx, payload);
  } catch (error) {
    ctx.el.sensorLatestTitleEl.textContent = "最近采集读取失败";
    ctx.el.sensorLatestDetailEl.textContent = error?.message || String(error);
  }
}

function renderSensorTowerLatestStatus(ctx, payload = {}) {
  const success = payload.latestSuccess || null;
  const failure = payload.latestFailure || null;
  const card = ctx.el.sensorLatestCardEl;
  if (!success && !failure) {
    card.classList.remove("failed");
    ctx.el.sensorLatestTitleEl.textContent = "暂无采集记录";
    ctx.el.sensorLatestDetailEl.textContent = "还没有这个 App 的 Sensor Tower CSV 入库。";
    return;
  }

  const successTime = Date.parse(normalizeDateTime(success?.importedAt));
  const failureTime = Date.parse(normalizeDateTime(failure?.at));
  const showFailure = failure && (!success || (Number.isFinite(failureTime) && Number.isFinite(successTime) && failureTime > successTime));

  if (showFailure) {
    card.classList.add("failed");
    ctx.el.sensorLatestTitleEl.textContent = `上次失败：${failure.at || "未知时间"}`;
    ctx.el.sensorLatestDetailEl.textContent = failure.error || "未记录失败原因。";
    return;
  }

  card.classList.remove("failed");
  const type = [success.dataType, success.os, success.rowCount ? `${success.rowCount} 行` : ""].filter(Boolean).join(" · ");
  ctx.el.sensorLatestTitleEl.textContent = `上次成功：${success.importedAt || "未知时间"}`;
  ctx.el.sensorLatestDetailEl.textContent = type || success.csvPath || "Sensor Tower CSV 已入库。";
}

function normalizeDateTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.includes("T") ? text : text.replace(" ", "T");
}

function inferSensorTowerDataType(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.includes("reviews")) return "reviews";
    if (path.includes("active-users")) return "active_users";
    if (path.includes("download")) return "downloads";
    if (path.includes("revenue")) return "revenue";
    if (path.includes("retention") || path.includes("usage") || path.includes("time-spent") || path.includes("demographics")) return "active_usage";
    if (path.includes("rank")) return "rankings";
  } catch {
    return "";
  }
  return "";
}

export async function collectSensorTower(ctx) {
  if (isSensorTowerOverviewUrl(ctx.state.activeTab?.url || "")) {
    await collectSensorTowerOverview(ctx);
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "TT2TEXT_EXPORT_SENSOR_TOWER_CSV",
    payload: {
      tabId: ctx.state.activeTab.id
    }
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Sensor Tower CSV 导出失败。");
  }
  const saved = response.payload || {};

  renderDetectedApp(ctx, saved);
  await refreshSensorTowerLatestStatus(ctx, saved);
  ctx.el.resultMessage.textContent = `CSV 已入库：${saved.app?.name || saved.appName || "未识别 App"} · ${saved.dataType || "unknown"} · ${saved.rowCount ?? 0} 行`;
}

export async function collectSensorTowerOverview(ctx) {
  const response = await chrome.runtime.sendMessage({
    type: "TT2TEXT_IMPORT_SENSOR_TOWER_OVERVIEW",
    payload: {
      tabId: ctx.state.activeTab.id
    }
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Sensor Tower Overview 采集失败。");
  }
  const saved = response.payload || {};
  renderDetectedApp(ctx, saved);
  const overview = saved.overview || saved.raw?.overview || {};
  ctx.el.resultMessage.textContent = `Overview 已入库：${saved.app?.name || saved.appName || "未识别 App"} · ${overview.category || "未识别类别"} · IAP ${overview.inAppPurchases?.length || 0} 项`;
}

export async function collectTikTokSearch(ctx) {
  const response = await chrome.runtime.sendMessage({
    type: "TT2TEXT_IMPORT_TIKTOK_SEARCH",
    payload: {
      query: ctx.state.currentTikTokQuery,
      appQuery: ctx.state.currentTikTokQuery,
      tabId: ctx.state.activeTab.id,
      limit: 60
    }
  });
  if (!response?.ok) {
    throw new Error(response?.error || "TikTok 搜索采集失败。");
  }

  const totals = response.payload?.totals || {};
  ctx.el.resultMessage.textContent = `已采集：排队 ${totals.queued || 0} 条，重复 ${totals.skipped_duplicate || 0} 条。相关性会在转写后由 LLM 判断。`;
}

export async function collectTikTokComments(ctx) {
  const response = await chrome.runtime.sendMessage({
    type: "TT2TEXT_IMPORT_TIKTOK_COMMENTS",
    payload: {
      tabId: ctx.state.activeTab.id,
      expandCount: 0
    }
  });
  if (!response?.ok) {
    throw new Error(response?.error || "TikTok 评论采集失败。");
  }

  const payload = response.payload || {};
  ctx.el.resultMessage.textContent = `当前已加载评论已入库：${payload.itemCount || 0} 条，${payload.matched ? "已绑定本地视频" : "未匹配本地视频"}。`;
  return payload;
}

export async function collectTikTokDetailShot(ctx, selectedApp = null) {
  let payload = {};
  let shot = {};
  let importError = "";
  const response = await chrome.runtime.sendMessage({
    type: "TT2TEXT_IMPORT_TIKTOK_DETAIL_SHOT_WITH_COMMENTS",
    payload: {
      tabId: ctx.state.activeTab.id,
      targetApp: selectedApp?.name || "未指定",
      projectIds: [],
      appId: selectedApp?.id || ""
    }
  });
  if (response?.ok) {
    payload = response.payload || {};
    shot = payload.shot || {};
    renderAdShotImportedStatus(ctx, shot);
  } else {
    importError = response?.error || "TikTok 素材入库失败。";
  }
  const comments = payload.comments || null;
  const commentError = payload.commentError || "";
  if (shot && Object.keys(shot).length) {
    renderAdShotImportedStatus(ctx, comments ? { ...shot, commentsRaw: comments } : shot);
  }
  const mediaCount = countCommentMedia(comments);
  ctx.el.resultMessage.textContent = [
    importError ? `素材入库失败：${importError}` : (shot.duplicate ? "视频已存在，已跳过重复入库" : "视频已入库"),
    commentError ? `当前已加载评论采集失败：${commentError}` : `当前已加载评论 ${comments?.itemCount || 0} 条${mediaCount ? `，图片 ${mediaCount} 张` : ""}`
  ].join("；");
  return payload;
}

export async function collectAdShotsCurrentTab(ctx, selectedApp = null) {
  const response = await chrome.runtime.sendMessage({
    type: "TT2TEXT_IMPORT_AD_SHOTS_CURRENT_TAB",
    payload: {
      tabId: ctx.state.activeTab.id,
      targetApp: selectedApp?.name || "未指定",
      projectIds: [],
      appId: selectedApp?.id || "",
      limit: 80
    }
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Creative Center 采集失败。");
  }

  const payload = response.payload || {};
  ctx.el.resultMessage.textContent = payload.mode === "detail"
    ? `${payload.shot?.duplicate ? "广告已存在，已跳过重复入库" : "广告已入库"}`
    : `候选池已更新：新增 ${payload.created || 0} 条，更新 ${payload.updated || 0} 条。`;
  return payload;
}

export async function collectCurrentSensorTowerPage(ctx) {
  const response = await sendSensorTowerTabMessage(ctx.state.activeTab.id, {
    type: "TT2TEXT_COLLECT_SENSOR_TOWER"
  });
  if (!response?.ok) {
    throw new Error(response?.error || "无法读取当前页面。请刷新 Sensor Tower 页面后重试。");
  }
  return response.payload;
}

async function sendSensorTowerTabMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!isMissingReceivingEndError(error)) {
      throw error;
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-sensortower.js"]
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return chrome.tabs.sendMessage(tabId, message);
  }
}

function isMissingReceivingEndError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /receiving end does not exist|could not establish connection/i.test(message);
}

function countCommentMedia(comments = {}) {
  const items = Array.isArray(comments.items) ? comments.items : [];
  return items.reduce((total, item) => total + (Array.isArray(item?.media) ? item.media.length : 0), 0);
}
