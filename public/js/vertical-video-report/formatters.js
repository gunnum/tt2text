import { escapeAttribute, escapeHtml, shortenText } from "../core/format.js";

export { escapeAttribute, escapeHtml, shortenText };

export function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return Math.round(number).toLocaleString("zh-CN");
}

export function formatDateTime(value) {
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

export function renderMetric(label, value) {
  return `<article class="metric-card"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></article>`;
}
