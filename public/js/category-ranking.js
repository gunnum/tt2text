import { fetchJson } from "./core/http.js";
import { escapeHtml, formatAppDisplayName } from "./core/format.js";
import { showToast } from "./core/ui.js";

const params = new URLSearchParams(window.location.search);
const appId = params.get("appId") || "";
const titleEl = document.querySelector("#page-title");
const subtitleEl = document.querySelector("#page-subtitle");
const statsEl = document.querySelector("#ranking-stats");
const chartEl = document.querySelector("#ranking-chart");
const toastEl = document.querySelector("#toast");
const tabs = Array.from(document.querySelectorAll("[data-metric]"));

let state = {
  app: null,
  ranking: null,
  metric: "monthlyRevenueUsd"
};

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.metric = tab.dataset.metric || "monthlyRevenueUsd";
    tabs.forEach((item) => item.setAttribute("aria-selected", String(item === tab)));
    render();
  });
});

async function loadPage() {
  if (!appId) throw new Error("缺少 appId。");
  const payload = await fetchJson(`/api/report-output/${encodeURIComponent(appId)}/category-ranking`);
  state.app = payload.app;
  state.ranking = payload.categoryRanking;
  render();
}

function render() {
  const appName = formatAppDisplayName(state.app?.name || state.app?.fullName || "App");
  document.title = `${appName} 同类型应用排行 - T2T`;
  if (titleEl) titleEl.textContent = `${appName} 同类型应用排行`;

  const ranking = state.ranking;
  if (!ranking?.rows?.length) {
    if (subtitleEl) subtitleEl.textContent = "还没有导入同品类 Top Apps CSV。";
    if (statsEl) statsEl.innerHTML = "";
    if (chartEl) chartEl.innerHTML = '<div class="ranking-empty">请先在 Sensor Tower 同品类榜单导出最近 90 天、所有国家/地区、iOS + Android、收入绝对值排序 CSV，并通过插件导入。</div>';
    return;
  }

  const dateRange = formatDateRange(ranking.dateRange);
  if (subtitleEl) {
    subtitleEl.textContent = [
      ranking.categoryName || "同品类应用",
      dateRange || "未知时间段",
      (ranking.countries || []).join(" + ") || "未标注国家",
      "iOS + Android",
      "绝对值排序"
    ].filter(Boolean).join(" · ");
  }

  renderStats(ranking);
  renderChart(ranking);
}

function renderStats(ranking) {
  const summary = ranking.summary || {};
  statsEl.innerHTML = `
    <div class="ranking-stat"><b>${escapeHtml(formatMoney(summary.averageRevenueUsd90d || 0))}</b><span>Top ${escapeHtml(String(summary.appCount || 0))} 近90天平均收入</span></div>
    <div class="ranking-stat"><b>${escapeHtml(formatMoney(summary.averageMonthlyRevenueUsd || 0))}</b><span>月均收入，按 90 天收入 / 3</span></div>
    <div class="ranking-stat"><b>${escapeHtml(formatDateRange(ranking.dateRange) || "未知")}</b><span>数据时间段</span></div>
  `;
}

function renderChart(ranking) {
  const rows = [...ranking.rows]
    .sort((a, b) => Number(b[state.metric] || 0) - Number(a[state.metric] || 0))
    .slice(0, 25);
  const max = Math.max(...rows.map((row) => Number(row[state.metric] || 0)), 1);
  const metricLabel = metricConfig(state.metric).label;
  chartEl.innerHTML = rows.map((row, index) => {
    const value = Number(row[state.metric] || 0);
    const width = Math.max(2, Math.round(value / max * 100));
    const name = row.appName || row.unifiedName || "Unknown App";
    return `
      <article class="ranking-row">
        <div class="ranking-index">${index + 1}</div>
        <div class="ranking-logo" aria-hidden="true">${escapeHtml(name.slice(0, 1).toUpperCase())}</div>
        <div class="ranking-name">
          <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
          <div class="ranking-bar-track"><div class="ranking-bar" style="width:${width}%"></div></div>
        </div>
        <div class="ranking-value">
          ${escapeHtml(formatMetricValue(value, state.metric))}
          <small>${escapeHtml(metricLabel)}</small>
        </div>
      </article>
    `;
  }).join("");
}

function metricConfig(metric) {
  const map = {
    monthlyRevenueUsd: { label: "月均收入" },
    downloads90d: { label: "90天下载量" },
    dau: { label: "DAU" }
  };
  return map[metric] || map.monthlyRevenueUsd;
}

function formatMetricValue(value, metric) {
  return metric === "monthlyRevenueUsd" ? formatMoney(value) : formatNumber(value);
}

function formatDateRange(range = {}) {
  const start = range.start || range.startDate || range.start_date || "";
  const end = range.end || range.endDate || range.end_date || "";
  return start || end ? `${start || "未知"} 至 ${end || "未知"}` : "";
}

function formatMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "$0";
  if (number >= 1_000_000_000) return `$${(number / 1_000_000_000).toFixed(1)}B`;
  if (number >= 1_000_000) return `$${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `$${(number / 1_000).toFixed(1)}K`;
  return `$${Math.round(number).toLocaleString()}`;
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "0";
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(1)}B`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return Math.round(number).toLocaleString();
}

loadPage().catch((error) => {
  if (subtitleEl) subtitleEl.textContent = "加载失败";
  if (chartEl) chartEl.innerHTML = `<div class="ranking-empty">加载失败：${escapeHtml(error.message)}</div>`;
  showToast(toastEl, `加载失败：${error.message}`);
});
