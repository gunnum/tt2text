import { appendDebugLog, setBadge, setImportStatus } from "./background-common.js";
import { buildSensorTowerBatchUrls } from "./sensortower-presets.js";

const LOCAL_SENSOR_TOWER_CSV_URL = "http://localhost:3000/api/sensortower-csv/import-path";
const LOCAL_SENSOR_TOWER_CSV_CONTENT_URL = "http://localhost:3000/api/sensortower-csv/import-content";
const LOCAL_SENSOR_TOWER_OVERVIEW_URL = "http://localhost:3000/api/app-metrics/import";
const LOCAL_APP_PAYWALL_FIND_URL = "http://localhost:3000/api/apps/paywalls/find";
const LOCAL_APP_STORE_MEDIA_REFRESH_URL = "http://localhost:3000/api/apps/appstore-media/refresh";
let activeSensorTowerBatch = null;

export function canHandleSensorTowerMessage(message) {
  return [
    "TT2TEXT_IMPORT_SENSOR_TOWER_OVERVIEW",
    "TT2TEXT_EXPORT_SENSOR_TOWER_CSV",
    "TT2TEXT_EXPORT_SENSOR_TOWER_BATCH"
  ].includes(message?.type);
}

export async function handleSensorTowerMessage(message) {
  if (message?.type === "TT2TEXT_IMPORT_SENSOR_TOWER_OVERVIEW") {
    return importSensorTowerOverview(message.payload);
  }
  if (message?.type === "TT2TEXT_EXPORT_SENSOR_TOWER_BATCH") {
    return exportSensorTowerBatch(message.payload);
  }
  return exportSensorTowerCsv(message.payload);
}

async function exportSensorTowerBatch(payload = {}) {
  if (activeSensorTowerBatch) {
    throw new Error("已有 Sensor Tower 批量采集正在运行。请等当前任务结束，或重新加载扩展后再试。");
  }
  activeSensorTowerBatch = {
    startedAt: Date.now(),
    tabId: Number(payload.tabId) || 0
  };
  const sourceTabId = Number(payload.tabId);
  try {
    if (!sourceTabId) {
      throw new Error("缺少 Sensor Tower 页面 tab。");
    }
    const sourceTab = await chrome.tabs.get(sourceTabId);
    const pageContext = await collectSensorTowerPageContext(sourceTabId).catch((error) => {
      void appendDebugLog({
        scope: "background",
        event: "sensortower:batch:context-error",
        detail: { error: toErrorMessage(error), url: sourceTab.url || "" }
      });
      return {};
    });
    const urls = buildSensorTowerBatchUrls(sourceTab.url || "", pageContext);
    void appendDebugLog({
      scope: "background",
      event: "sensortower:batch:prepared",
      detail: {
        url: sourceTab.url || "",
        appName: pageContext.appName || "",
        appIqLink: pageContext.appIqLink || null,
        items: urls.map((item) => ({
          id: item.id,
          label: item.label,
          skipped: Boolean(item.skipped),
          error: item.error || "",
          url: summarizeSensorTowerUrl(item.url || ""),
          preferBrowserDownload: Boolean(item.preferBrowserDownload)
        }))
      }
    });
    const results = [];
    const totalSteps = urls.length + 3;
    let importedOverview = null;
    try {
      importedOverview = await importSensorTowerOverview({ tabId: sourceTabId });
      results.push({ id: "overview", label: "Overview 画像", ok: true, imported: importedOverview });
    } catch (error) {
      results.push({ id: "overview", label: "Overview 画像", ok: false, error: error instanceof Error ? error.message : String(error) });
    }

    await setBadge("1/" + totalSteps, "#0d6f5b");
    await setImportStatus({
      state: "running",
      message: "正在刷新 App Store 官方截图和预览视频...",
      tabId: sourceTabId,
      batch: { current: 2, total: totalSteps, label: "App Store Media" },
      updatedAt: new Date().toISOString()
    });
    await setBadge("2/" + totalSteps, "#0d6f5b");
    try {
      const appStoreMedia = await refreshAppStoreMediaForImportedApp(importedOverview);
      results.push({ id: "appstore_media", label: "App Store 官方截图/视频", ok: true, imported: appStoreMedia });
    } catch (error) {
      results.push({ id: "appstore_media", label: "App Store 官方截图/视频", ok: false, error: error instanceof Error ? error.message : String(error) });
    }

    await setImportStatus({
      state: "running",
      message: "正在查找 App paywall 截图...",
      tabId: sourceTabId,
      batch: { current: 3, total: totalSteps, label: "Paywall 截图" },
      updatedAt: new Date().toISOString()
    });
    await setBadge("3/" + totalSteps, "#0d6f5b");
    try {
      const paywalls = await findPaywallsForImportedApp(importedOverview);
      results.push({ id: "paywalls", label: "Paywall 截图", ok: true, imported: paywalls });
    } catch (error) {
      results.push({ id: "paywalls", label: "Paywall 截图", ok: false, error: error instanceof Error ? error.message : String(error) });
    }

    for (let index = 0; index < urls.length; index += 1) {
      const item = urls[index];
      if (item.skipped || !item.url) {
        void appendDebugLog({
          scope: "background",
          event: "sensortower:batch:item-skipped",
          detail: { id: item.id, label: item.label, error: item.error || "缺少采集 URL。" }
        });
        results.push({ ...item, ok: false, error: item.error || "缺少采集 URL。" });
        continue;
      }
      await setImportStatus({
        state: "running",
        message: `正在采集 Sensor Tower：${item.label}（${index + 4}/${totalSteps}）`,
        tabId: sourceTabId,
        batch: { current: index + 4, total: totalSteps, label: item.label },
        updatedAt: new Date().toISOString()
      });
      await setBadge(`${index + 4}/${totalSteps}`, "#0d6f5b");
      const tab = await chrome.tabs.create({ url: item.url, active: false });
      try {
        await waitForTabComplete(tab.id);
        await sleep(item.waitMs || 3500);
        void appendDebugLog({
          scope: "background",
          event: "sensortower:batch:item-start",
          detail: { id: item.id, label: item.label, url: summarizeSensorTowerUrl(item.url || "") }
        });
        const imported = await withTimeout(exportSensorTowerCsv({
          tabId: tab.id,
          batchItem: item
        }), item.timeoutMs || 130000, `采集 ${item.label} 超时，已跳过继续后续数据。`);
        void appendDebugLog({
          scope: "background",
          event: "sensortower:batch:item-done",
          detail: {
            id: item.id,
            label: item.label,
            dataType: imported?.dataType || "",
            rowCount: imported?.rowCount ?? null
          }
        });
        results.push({ ...item, ok: true, imported });
      } catch (error) {
        void appendDebugLog({
          scope: "background",
          event: "sensortower:batch:item-error",
          detail: { id: item.id, label: item.label, error: toErrorMessage(error) }
        });
        results.push({ ...item, ok: false, error: error instanceof Error ? error.message : String(error) });
      } finally {
        await chrome.tabs.remove(tab.id).catch(() => {});
        await sleep(1200);
      }
    }

    const failed = results.filter((item) => !item.ok);
    await setImportStatus({
      state: failed.length ? "error" : "done",
      message: failed.length
        ? `Sensor Tower 批量采集完成，但失败 ${failed.length}/${totalSteps} 个。`
        : `Sensor Tower 批量采集完成：${totalSteps} 个数据项。`,
      tabId: sourceTabId,
      batch: { total: totalSteps, failed: failed.length },
      updatedAt: new Date().toISOString()
    });
    await setBadge(failed.length ? "ERR" : "OK", failed.length ? "#b6452f" : "#0d6f5b");
    setTimeout(() => setBadge("", "#0d6f5b"), 4000);
    return { total: totalSteps, failed: failed.length, results };
  } catch (error) {
    await setImportStatus({
      state: "error",
      message: `Sensor Tower 批量采集中断：${toErrorMessage(error)}`,
      tabId: sourceTabId,
      batch: { failed: 1 },
      updatedAt: new Date().toISOString()
    }).catch(() => {});
    await setBadge("ERR", "#b6452f").catch(() => {});
    setTimeout(() => setBadge("", "#0d6f5b"), 4000);
    throw error;
  } finally {
    activeSensorTowerBatch = null;
  }
}

async function refreshAppStoreMediaForImportedApp(importedOverview) {
  const appId = importedOverview?.app?.id || importedOverview?.appId || "";
  if (!appId) {
    throw new Error("Overview 未匹配到本地 App，无法刷新 App Store media。");
  }
  const response = await fetch(LOCAL_APP_STORE_MEDIA_REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `App Store media 刷新失败：HTTP ${response.status}`);
  }
  return payload;
}

async function findPaywallsForImportedApp(importedOverview) {
  const appId = importedOverview?.app?.id || importedOverview?.appId || "";
  if (!appId) {
    throw new Error("Overview 未匹配到本地 App，无法自动查找 paywall。");
  }
  const response = await fetch(LOCAL_APP_PAYWALL_FIND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, refresh: false })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Paywall 查找失败：HTTP ${response.status}`);
  }
  return payload;
}

function summarizeSensorTowerUrl(value) {
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value);
    const keep = [
      "metric",
      "os",
      "custom_fields_filter_id",
      "uai",
      "saa",
      "sia",
      "ssaa",
      "ssia",
      "start_date",
      "end_date",
      "duration",
      "country",
      "device",
      "page_size"
    ];
    const params = new URLSearchParams();
    for (const key of keep) {
      for (const item of url.searchParams.getAll(key)) {
        params.append(key, item);
      }
    }
    return `${url.pathname}?${params.toString()}`;
  } catch {
    return String(value).slice(0, 500);
  }
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "");
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function collectSensorTowerPageContext(tabId) {
  await ensureSensorTowerContentScript(tabId);
  const response = await sendSensorTowerTabMessage(tabId, {
    type: "TT2TEXT_COLLECT_SENSOR_TOWER"
  });
  if (!response?.ok) {
    throw new Error(response?.error || "无法读取当前 Sensor Tower 页面上下文。");
  }
  return response.payload || {};
}

async function importSensorTowerOverview(payload = {}) {
  const tabId = Number(payload.tabId);
  if (!tabId) {
    throw new Error("缺少 Sensor Tower 页面 tab。");
  }

  await setImportStatus({
    state: "running",
    message: "正在采集 Sensor Tower Overview 画像...",
    tabId,
    updatedAt: new Date().toISOString()
  });

  const pageResponse = await sendSensorTowerTabMessage(tabId, {
    type: "TT2TEXT_COLLECT_SENSOR_TOWER_OVERVIEW"
  });
  if (!pageResponse?.ok) {
    throw new Error(pageResponse?.error || "无法采集 Sensor Tower Overview。");
  }

  const importResponse = await fetch(LOCAL_SENSOR_TOWER_OVERVIEW_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pageResponse.payload || {})
  });
  const imported = await importResponse.json().catch(() => ({}));
  if (!importResponse.ok) {
    throw new Error(imported.error || `Overview 入库失败：HTTP ${importResponse.status}`);
  }

  await setImportStatus({
    state: "done",
    message: `Sensor Tower Overview 已入库：${imported.app?.name || imported.appName || "未识别 App"}`,
    tabId,
    updatedAt: new Date().toISOString()
  });
  return imported;
}

async function exportSensorTowerCsv(payload = {}) {
  const tabId = Number(payload.tabId);
  if (!tabId) {
    throw new Error("缺少 Sensor Tower 页面 tab。");
  }

  await setImportStatus({
    state: "running",
    message: "正在触发 Sensor Tower CSV 导出...",
    tabId,
    updatedAt: new Date().toISOString()
  });
  await setBadge("CSV", "#0d6f5b");

  const captureId = `tt2text-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const preferBrowserDownload = Boolean(payload.batchItem?.preferBrowserDownload);
  const downloadWaiter = preferBrowserDownload ? createCsvDownloadWaiter(90000) : null;
  await ensureSensorTowerContentScript(tabId);
  if (!preferBrowserDownload) {
    await injectCsvCapture(tabId, captureId);
  }
  void appendDebugLog({
    scope: "background",
    event: "sensortower:csv:trigger",
    detail: {
      id: payload.batchItem?.id || "",
      label: payload.batchItem?.label || "",
      captureId
    }
  });
  let pageResponse;
  try {
    pageResponse = await sendSensorTowerTabMessage(tabId, {
      type: "TT2TEXT_CLICK_SENSOR_TOWER_CSV_EXPORT",
      captureId,
      preferBrowserDownload
    });
  } catch (error) {
    if (!preferBrowserDownload) {
      throw error;
    }
    void appendDebugLog({
      scope: "background",
      event: "sensortower:csv:message-channel-fallback",
      detail: {
        id: payload.batchItem?.id || "",
        label: payload.batchItem?.label || "",
        error: toErrorMessage(error)
      }
    });
    pageResponse = {
      ok: true,
      payload: await buildFallbackSensorTowerPagePayload(tabId, payload.batchItem)
    };
  }
  if (!pageResponse?.ok) {
    throw new Error(pageResponse?.error || "无法触发 Sensor Tower CSV 导出。");
  }
  const pagePayload = {
    ...(pageResponse.payload || {}),
    batchItem: payload.batchItem || null
  };

  if (pageResponse.payload?.noData) {
    const reason = pageResponse.payload.noDataReason || "当前筛选条件下无数据可下载。";
    void appendDebugLog({
      scope: "background",
      event: "sensortower:csv:no-data",
      detail: {
        id: payload.batchItem?.id || "",
        label: payload.batchItem?.label || "",
        reason,
        noDataText: pageResponse.payload?.exportDebug?.noDataText || ""
      }
    });
    await setImportStatus({
      state: "done",
      message: `Sensor Tower ${payload.batchItem?.label || "CSV"} 无数据可下载，已跳过。`,
      tabId,
      updatedAt: new Date().toISOString()
    });
    await setBadge("SKIP", "#7a8794");
    setTimeout(() => setBadge("", "#0d6f5b"), 4000);
    downloadWaiter?.cancel();
    return {
      appName: pagePayload.appName || "",
      dataType: pagePayload.dataType || "",
      chartId: payload.batchItem?.id || "",
      chartLabel: payload.batchItem?.label || "",
      rowCount: 0,
      noData: true,
      skipped: true,
      reason
    };
  }

  if (pageResponse.payload?.capturedCsv?.contentBase64 || pageResponse.payload?.capturedCsv?.contentText) {
    const captured = pageResponse.payload.capturedCsv;
    void appendDebugLog({
      scope: "background",
      event: "sensortower:csv:captured-content",
      detail: {
        id: payload.batchItem?.id || "",
        label: payload.batchItem?.label || "",
        filename: captured.filename || "",
        totalBytes: captured.totalBytes || 0
      }
    });
    validateSensorTowerCsvMatch({
      imported: null,
      pagePayload,
      batchItem: payload.batchItem,
      captured
    });
    const importResponse = await fetch(LOCAL_SENSOR_TOWER_CSV_CONTENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: captured.filename || `${payload.batchItem?.label || "sensortower"}.csv`,
        contentBase64: captured.contentBase64 || "",
        contentText: captured.contentText || "",
        mime: captured.mime || "",
        totalBytes: captured.totalBytes || 0,
        downloadUrl: captured.objectUrl || "",
        page: pagePayload
      })
    });
    const imported = await importResponse.json().catch(() => ({}));
    if (!importResponse.ok) {
      throw new Error(imported.error || `本地 CSV 内容入库失败：HTTP ${importResponse.status}`);
    }
    validateSensorTowerCsvMatch({ imported, pagePayload, batchItem: payload.batchItem, captured });
    await setImportStatus({
      state: "done",
      message: imported.duplicate
        ? `Sensor Tower CSV 重复，沿用已有记录：${imported.app?.name || imported.appName || imported.dataType || "未识别类型"}`
        : `Sensor Tower CSV 已入库：${imported.app?.name || imported.appName || imported.dataType || "未识别类型"}`,
      tabId,
      updatedAt: new Date().toISOString()
    });
    await setBadge("OK", "#0d6f5b");
    setTimeout(() => setBadge("", "#0d6f5b"), 4000);
    return imported;
  }

  void appendDebugLog({
    scope: "background",
    event: "sensortower:csv:waiting-download",
    detail: {
      id: payload.batchItem?.id || "",
      label: payload.batchItem?.label || "",
      exportDebug: pageResponse.payload?.exportDebug || null
    }
  });
  const activeDownloadWaiter = downloadWaiter || createCsvDownloadWaiter(45000);
  const download = await activeDownloadWaiter.promise;
  void appendDebugLog({
    scope: "background",
    event: "sensortower:csv:download-complete",
    detail: {
      id: payload.batchItem?.id || "",
      label: payload.batchItem?.label || "",
      filename: download.filename || "",
      totalBytes: download.totalBytes || 0
    }
  });
  const importResponse = await fetch(LOCAL_SENSOR_TOWER_CSV_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: download.filename,
      downloadUrl: download.url || "",
      mime: download.mime || "",
      totalBytes: download.totalBytes || 0,
      page: pagePayload
    })
  });
  const imported = await importResponse.json().catch(() => ({}));
  if (!importResponse.ok) {
    throw new Error(imported.error || `本地 CSV 入库失败：HTTP ${importResponse.status}`);
  }
  validateSensorTowerCsvMatch({ imported, pagePayload, batchItem: payload.batchItem, captured: download });

  await setImportStatus({
    state: "done",
    message: imported.duplicate
      ? `Sensor Tower CSV 重复，沿用已有记录：${imported.app?.name || imported.appName || imported.dataType || "未识别类型"}`
      : `Sensor Tower CSV 已入库：${imported.app?.name || imported.appName || imported.dataType || "未识别类型"}`,
    tabId,
    updatedAt: new Date().toISOString()
  });
  await setBadge("OK", "#0d6f5b");
  setTimeout(() => setBadge("", "#0d6f5b"), 4000);
  return imported;
}

async function buildFallbackSensorTowerPagePayload(tabId, batchItem = {}) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const sourceUrl = tab?.url || batchItem.url || "";
  return {
    url: sourceUrl,
    sourceUrl,
    title: tab?.title || "",
    pageTitle: tab?.title || "",
    appName: "",
    dataType: expectedDataTypeForBatchItem(batchItem) || inferDataTypeFromSensorTowerUrl(sourceUrl),
    exportTriggeredAt: new Date().toISOString(),
    exportDebug: {
      fallback: "message-channel-closed"
    },
    capturedCsv: null
  };
}

function inferDataTypeFromSensorTowerUrl(value = "") {
  const text = String(value || "").toLowerCase();
  if (text.includes("/market-analysis/top-apps")) return "category_rankings";
  if (text.includes("reviews")) return "reviews";
  if (text.includes("active-users")) return "active_users";
  if (text.includes("download")) return "downloads";
  if (text.includes("revenue")) return "revenue";
  if (text.includes("usage") || text.includes("retention") || text.includes("time-spent")) return "active_usage";
  return "unknown_metric";
}

function validateSensorTowerCsvMatch({ imported, pagePayload, batchItem, captured } = {}) {
  if (!batchItem?.id) {
    return;
  }
  const expectedType = expectedDataTypeForBatchItem(batchItem);
  const pageType = normalizeLower(pagePayload?.dataType);
  const importedType = normalizeLower(imported?.dataType);
  const sourceUrl = String(pagePayload?.url || pagePayload?.sourceUrl || "");
  const importedUrl = String(imported?.sourceUrl || "");
  if (expectedType && importedType && importedType !== expectedType) {
    throw new Error(`CSV 类型不匹配：${batchItem.label || batchItem.id} 预期 ${expectedType}，实际入库 ${importedType}。`);
  }
  if (expectedType && pageType && pageType !== expectedType) {
    throw new Error(`当前页面类型不匹配：${batchItem.label || batchItem.id} 预期 ${expectedType}，实际页面 ${pageType}。`);
  }
  if (sourceUrl && importedUrl && normalizeSensorTowerPath(sourceUrl) !== normalizeSensorTowerPath(importedUrl)) {
    throw new Error(`CSV 来源页面不匹配：${batchItem.label || batchItem.id} 捕获到了其他页面的 CSV。`);
  }
  if (batchItem.id === "category_revenue_top_90d" && imported && !imported.categoryRanking?.rows?.length) {
    throw new Error("同品类排行 CSV 已入库但没有解析出榜单行。");
  }
  if (captured?.pendingBlobUrlOnly) {
    throw new Error(`CSV 捕获不完整：${batchItem.label || batchItem.id} 只捕获到下载链接，没有拿到内容。`);
  }
}

function expectedDataTypeForBatchItem(batchItem = {}) {
  const id = normalizeLower(batchItem.id);
  if (id === "category_revenue_top_90d") return "category_rankings";
  if (id === "reviews") return "reviews";
  if (id === "active_users_mau") return "active_users";
  if (id === "downloads") return "downloads";
  if (id === "revenue") return "revenue";
  if (id === "engagement" || id === "retention_d1" || id === "demographics_age_gender") return "";
  return "";
}

function normalizeLower(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSensorTowerPath(value) {
  try {
    const url = new URL(value);
    return url.pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return String(value || "").split("?")[0].replace(/\/+$/, "").toLowerCase();
  }
}

async function sendSensorTowerTabMessage(tabId, message) {
  await ensureSensorTowerContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, message);
}

async function ensureSensorTowerContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "TT2TEXT_COLLECT_SENSOR_TOWER"
    });
    if (response?.ok) {
      return;
    }
  } catch (error) {
    if (!isMissingReceivingEndError(error)) {
      throw error;
    }
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content-sensortower.js"]
  });
  await sleep(250);
}

function isMissingReceivingEndError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /receiving end does not exist|could not establish connection/i.test(message);
}

async function injectCsvCapture(tabId, captureId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [captureId],
    func: (id) => {
      if (window.__tt2textCsvCapture?.id === id) {
        return;
      }
      const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
      const originalClick = HTMLAnchorElement.prototype.click;
      const captures = [];
      let accepting = false;
      const clickListener = (event) => {
        const anchor = event.target?.closest?.("a");
        if (!anchor) {
          return;
        }
        const href = anchor.href || "";
        const filename = anchor.download || "";
        if (href.startsWith("blob:") || (filename && looksLikeCsvFilename(filename))) {
          accepting = true;
          captureAnchorDownload(anchor);
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      };

      function post(payload) {
        window.postMessage({
          source: "tt2text-sensortower-csv-capture",
          captureId: id,
          payload
        }, "*");
      }

      function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunkSize = 0x8000;
        for (let index = 0; index < bytes.length; index += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
        }
        return btoa(binary);
      }

      function looksLikeCsvBlob(blob) {
        const type = String(blob?.type || "").toLowerCase();
        return !type || type.includes("csv") || type.includes("text") || type.includes("octet-stream") || type.includes("excel");
      }

      function looksLikeCsvFilename(filename) {
        return /\.csv$/i.test(String(filename || ""))
          || /sensor|tower|download|revenue|review|retention|demographic|ranking|rank|top\s*apps|收入|下载|评论|留存|用户属性|排行|排行榜|榜单|应用排行/i.test(String(filename || ""));
      }

      async function captureBlob(blob, objectUrl, filename) {
        try {
          const buffer = await blob.arrayBuffer();
          const payload = {
            filename: filename || "sensortower.csv",
            mime: blob.type || "",
            objectUrl,
            totalBytes: blob.size || buffer.byteLength,
            contentBase64: arrayBufferToBase64(buffer)
          };
          captures.push(payload);
          post(payload);
        } catch {
          // Ignore capture failures and let the extension fallback handle it.
        }
      }

      async function captureHref(href, filename) {
        try {
          if (!href) {
            post({ filename, objectUrl: href, pendingBlobUrlOnly: true });
            return;
          }
          const response = await fetch(href);
          const blob = await response.blob();
          await captureBlob(blob, href, filename);
        } catch {
          post({ filename, objectUrl: href, pendingBlobUrlOnly: true });
        }
      }

      function captureAnchorDownload(anchor) {
        const href = anchor.href || "";
        const filename = anchor.download || "";
        const latest = captures[captures.length - 1];
        if (latest?.contentBase64 || latest?.contentText) {
          latest.filename = filename || latest.filename;
          post(latest);
          return;
        }
        captureHref(href, filename);
      }

      URL.createObjectURL = function patchedCreateObjectURL(object) {
        const objectUrl = originalCreateObjectUrl(object);
        if (accepting && object instanceof Blob && looksLikeCsvBlob(object)) {
          captureBlob(object, objectUrl, "");
        }
        return objectUrl;
      };

      HTMLAnchorElement.prototype.click = function patchedAnchorClick() {
        const filename = this.download || "";
        const href = this.href || "";
        if (href.startsWith("blob:") || (filename && looksLikeCsvFilename(filename))) {
          accepting = true;
          captureAnchorDownload(this);
          return undefined;
        }
        return originalClick.apply(this, arguments);
      };
      document.addEventListener("click", clickListener, true);

      window.__tt2textCsvCapture = {
        id,
        restore() {
          URL.createObjectURL = originalCreateObjectUrl;
          HTMLAnchorElement.prototype.click = originalClick;
          document.removeEventListener("click", clickListener, true);
        }
      };
      setTimeout(() => {
        if (window.__tt2textCsvCapture?.id === id) {
          window.__tt2textCsvCapture.restore();
          delete window.__tt2textCsvCapture;
        }
      }, 30000);
    }
  });
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(done, 30000);

    function done() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        done();
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || tab?.status === "complete") {
        done();
      }
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createCsvDownloadWaiter(timeoutMs) {
  let cleanup = () => {};
  const promise = new Promise((resolve, reject) => {
    let downloadId = null;
    const startedAt = Date.now();
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("等待 CSV 下载超时。请确认 Sensor Tower 页面是否弹出了下载，或是否需要先选择 CSV 格式。"));
    }, timeoutMs);

    cleanup = function cleanupWaiter() {
      clearTimeout(timeout);
      chrome.downloads.onCreated.removeListener(onCreated);
      chrome.downloads.onChanged.removeListener(onChanged);
      chrome.downloads.onDeterminingFilename.removeListener(onDeterminingFilename);
    };

    function onDeterminingFilename(item, suggest) {
      if (!looksLikeCsvDownload(item)) {
        return;
      }
      const originalName = getDownloadBaseName(item.filename || item.url || "sensortower.csv");
      const safeName = sanitizeFilename(originalName.endsWith(".csv") ? originalName : `${originalName}.csv`);
      suggest({
        filename: `TT2Text/SensorTower/${formatDownloadTimestamp(new Date(startedAt))}-${safeName}`,
        conflictAction: "uniquify"
      });
    }

    function onCreated(item) {
      if (downloadId || !looksLikeCsvDownload(item)) {
        return;
      }
      downloadId = item.id;
    }

    async function onChanged(delta) {
      if (!downloadId || delta.id !== downloadId) {
        return;
      }
      if (delta.state?.current === "complete") {
        const [item] = await chrome.downloads.search({ id: downloadId });
        cleanup();
        resolve(item);
      }
      if (delta.error?.current) {
        cleanup();
        reject(new Error(`CSV 下载失败：${delta.error.current}`));
      }
    }

    chrome.downloads.onDeterminingFilename.addListener(onDeterminingFilename);
    chrome.downloads.onCreated.addListener(onCreated);
    chrome.downloads.onChanged.addListener(onChanged);
  });
  return {
    promise,
    cancel() {
      cleanup();
    }
  };
}

function looksLikeCsvDownload(item) {
  const text = `${item.filename || ""} ${item.url || ""} ${item.mime || ""}`.toLowerCase();
  return text.includes(".csv")
    || text.includes("text/csv")
    || text.includes("csv")
    || /ranking|rank|top\s*apps|排行|排行榜|榜单|应用排行/i.test(text);
}

function getDownloadBaseName(value) {
  try {
    const parsed = new URL(value);
    const pathname = decodeURIComponent(parsed.pathname || "");
    return pathname.split("/").filter(Boolean).pop() || "sensortower.csv";
  } catch {
    return String(value || "").split(/[\\/]/).filter(Boolean).pop() || "sensortower.csv";
  }
}

function sanitizeFilename(value) {
  return String(value || "sensortower.csv")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "sensortower.csv";
}

function formatDownloadTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}
