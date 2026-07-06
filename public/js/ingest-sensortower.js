import { escapeAttribute, escapeHtml, formatAppDisplayName, shortenText } from "./core/format.js";
import { setStatus, showToast } from "./core/ui.js";

const statusEl = document.querySelector("#status");
const overviewList = document.querySelector("#overview-list");
const csvList = document.querySelector("#csv-import-list");
const logList = document.querySelector("#plugin-log-list");
const csvPathForm = document.querySelector("#csv-path-form");
const csvPathStatus = document.querySelector("#csv-path-status");
const refreshButton = document.querySelector("#sensortower-refresh");
const clearLogsButton = document.querySelector("#clear-plugin-logs");
const toastEl = document.querySelector("#toast");

let currentMetrics = [];
let currentCsvImports = [];
let currentLogs = [];

refreshButton?.addEventListener("click", async () => {
  await loadAll();
});

clearLogsButton?.addEventListener("click", async () => {
    clearLogsButton.disabled = true;
    try {
      const response = await fetch("/api/plugin-debug-logs/clear", { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "清空调试日志失败");
      }
      await loadPluginLogs();
      setStatus(statusEl, "插件调试日志已清空。");
      showToast(toastEl, "插件调试日志已清空");
    } catch (error) {
      setStatus(statusEl, `清空调试日志失败：${error.message}`);
      showToast(toastEl, `清空调试日志失败：${error.message}`);
    } finally {
      clearLogsButton.disabled = false;
    }
  });

  csvPathForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = csvPathForm.querySelector("button[type='submit']");
    const input = csvPathForm.querySelector("input[name='path']");
    const path = input.value.trim();
    if (!path) {
      setCsvPathStatus("请先输入 CSV 文件路径。");
      return;
    }

    submitButton.disabled = true;
    setCsvPathStatus("正在导入本地 CSV...");
    setStatus(statusEl, "正在导入本地 SensorTower CSV。");
    try {
      const response = await fetch("/api/sensortower-csv/import-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "CSV 导入失败");
      }
      input.value = "";
      await Promise.all([loadCsvImports(), loadPluginLogs()]);
      setCsvPathStatus(`导入完成：${payload.archivedFilename || payload.originalFilename || payload.id}`);
      setStatus(statusEl, "本地 CSV 已导入。");
      showToast(toastEl, "本地 CSV 已导入");
    } catch (error) {
      setCsvPathStatus(`CSV 导入失败：${error.message}`);
      setStatus(statusEl, `CSV 导入失败：${error.message}`);
      showToast(toastEl, `CSV 导入失败：${error.message}`);
    } finally {
      submitButton.disabled = false;
    }
  });

  async function loadAll() {
    setStatus(statusEl, "正在刷新 SensorTower 录入页...");
    await Promise.all([loadMetrics(), loadCsvImports(), loadPluginLogs()]);
    setStatus(statusEl, "SensorTower 录入页已刷新。");
  }

  async function loadMetrics() {
    const response = await fetch("/api/app-metrics");
    currentMetrics = await response.json();
    renderMetrics(currentMetrics);
  }

  async function loadCsvImports() {
    const response = await fetch("/api/sensortower-csv/imports");
    currentCsvImports = await response.json();
    renderCsvImports(currentCsvImports);
  }

  async function loadPluginLogs() {
    const response = await fetch("/api/plugin-debug-logs");
    currentLogs = await response.json();
    renderPluginLogs(currentLogs);
  }

  function renderMetrics(items) {
    if (!overviewList) return;
    overviewList.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "video-job-empty";
      empty.textContent = "还没有 SensorTower overview 记录。";
      overviewList.appendChild(empty);
      return;
    }

    items.slice(0, 24).forEach((item) => {
      const row = document.createElement("article");
      row.className = "sensor-record-card";
      row.innerHTML = `
        <div class="sensor-record-head">
          <div>
            <p class="sensor-record-app">${escapeHtml(formatAppDisplayName(item.app?.name || item.appName || "未匹配"))}</p>
            <h3>${escapeHtml(item.pageTitle || item.sourceUrl || "SensorTower Overview")}</h3>
          </div>
          <span class="video-job-badge">${escapeHtml(item.collectedAt || "")}</span>
        </div>
        <p class="sensor-record-meta">${escapeHtml(item.matched ? "已匹配 App" : `未匹配：${item.appName || "未知 App"}`)}</p>
        <ul class="sensor-record-list">${renderMetricSummary(item)}</ul>
        <div class="sensor-record-actions">
          <a class="video-job-action" href="${escapeAttribute(item.sourceUrl || "#")}" target="_blank" rel="noreferrer">原页面</a>
          ${item.htmlPath ? `<a class="video-job-action" href="${escapeAttribute(item.htmlPath)}" target="_blank" rel="noreferrer">Overview 归档</a>` : ""}
          ${item.folderPath ? `<a class="video-job-action" href="${escapeAttribute(item.folderPath)}" target="_blank" rel="noreferrer">目录</a>` : ""}
        </div>
      `;
      overviewList.appendChild(row);
    });
  }

  function renderCsvImports(items) {
    if (!csvList) return;
    csvList.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "video-job-empty";
      empty.textContent = "还没有 CSV 导入记录。";
      csvList.appendChild(empty);
      return;
    }

    items.slice(0, 30).forEach((item) => {
      const row = document.createElement("article");
      row.className = "sensor-record-card";
      row.innerHTML = `
        <div class="sensor-record-head">
          <div>
            <p class="sensor-record-app">${escapeHtml(formatAppDisplayName(item.app?.name || item.appName || "未匹配"))}</p>
            <h3>${escapeHtml(item.archivedFilename || item.originalFilename || "未命名 CSV")}</h3>
          </div>
          <span class="video-job-badge">${escapeHtml(item.importedAt || "")}</span>
        </div>
        <p class="sensor-record-meta">${escapeHtml([item.dataType, item.metric, `${item.rowCount || 0} 行`].filter(Boolean).join(" · "))}</p>
        <p class="sensor-record-copy">${escapeHtml(formatCsvMeta(item))}</p>
        <div class="sensor-record-actions">
          ${item.csvPath ? `<a class="video-job-action" href="${escapeAttribute(item.csvPath)}" target="_blank" rel="noreferrer">CSV</a>` : ""}
          ${item.parsedPath ? `<a class="video-job-action" href="${escapeAttribute(item.parsedPath)}" target="_blank" rel="noreferrer">解析预览</a>` : ""}
          ${item.folderPath ? `<a class="video-job-action" href="${escapeAttribute(item.folderPath)}" target="_blank" rel="noreferrer">目录</a>` : ""}
        </div>
      `;
      csvList.appendChild(row);
    });
  }

  function renderPluginLogs(items) {
    if (!logList) return;
    logList.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "video-job-empty";
      empty.textContent = "还没有插件调试日志。";
      logList.appendChild(empty);
      return;
    }

    items.slice().reverse().slice(0, 40).forEach((item) => {
      const row = document.createElement("article");
      row.className = "plugin-log-card";
      row.innerHTML = `
        <div class="sensor-record-head">
          <div>
            <p class="sensor-record-app">${escapeHtml(item.scope || "unknown")}</p>
            <h3>${escapeHtml(item.event || "log")}</h3>
          </div>
          <span class="video-job-badge">${escapeHtml(item.receivedAt || item.at || "")}</span>
        </div>
        <pre class="plugin-log-pre">${escapeHtml(JSON.stringify(item.detail || {}, null, 2))}</pre>
      `;
      logList.appendChild(row);
    });
  }

  function renderMetricSummary(item) {
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
      summary.push(shortenText(item.pageText, 180));
    }
    if (!summary.length) {
      summary.push("已保存页面可见文本，暂未解析出指标。");
    }
    return summary.slice(0, 6).map((text) => `<li>${escapeHtml(text)}</li>`).join("");
  }

  function formatCsvMeta(item) {
    const parts = [];
    if (item.sourceUrl) parts.push(item.sourceUrl);
    if (item.matchSource) parts.push(`匹配：${item.matchSource}`);
    if (item.originalSource) parts.push(`来源：${item.originalSource}`);
    return shortenText(parts.join(" · "), 220) || "暂无额外信息。";
  }

  function setCsvPathStatus(message) {
    if (csvPathStatus) csvPathStatus.textContent = message;
  }

loadAll().catch((error) => {
  setStatus(statusEl, `初始化失败：${error.message}`);
});
