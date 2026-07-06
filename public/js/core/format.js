export function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

export function escapeAttribute(value) {
  return escapeHtml(value || "");
}

export function formatAppDisplayName(name) {
  const text = String(name || "未命名 App").trim();
  const displayName = text.split(/\s*[:：]\s*|\s+[–—-]\s+|,\s+/)[0].trim();
  return displayName || text || "未命名 App";
}

export function getSortTime(value) {
  const parsed = Date.parse(String(value || "").replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortByTime(items, field) {
  return [...items].sort((a, b) => getSortTime(b[field]) - getSortTime(a[field]));
}

export function shortenText(value, maxLength = 180) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

export function normalizeUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.searchParams.sort();
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").trim().replace(/\/$/, "");
  }
}
