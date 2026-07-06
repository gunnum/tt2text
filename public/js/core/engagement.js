import { formatAppDisplayName } from "./format.js";

export function formatPublishedLine(item = {}) {
  const value = item.publishedAt || item.publishedText || "";
  return value ? `发布 ${value}` : "";
}

export function formatEngagementCount(count, fallbackText = "") {
  if (Number.isFinite(Number(count))) {
    const value = Number(count);
    if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
    return String(value);
  }
  return String(fallbackText || "").trim();
}

export function formatEngagementLine(engagement = {}) {
  const parts = [];
  const likeText = formatEngagementCount(engagement.likeCount, engagement.likeText);
  const commentText = formatEngagementCount(engagement.commentCount, engagement.commentText);
  if (likeText) parts.push(`赞 ${likeText}`);
  if (commentText) parts.push(`评 ${commentText}`);
  return parts.join(" · ");
}

export function dedupeBatchItems(items, normalizeUrl) {
  const seen = new Set();
  const list = [];
  for (const item of Array.isArray(items) ? items : []) {
    const normalizedUrl = normalizeUrl(item?.url || "");
    if (!normalizedUrl || seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    list.push(item);
  }
  return list;
}

export function normalizeAppNameForMatch(value) {
  return String(value || "")
    .split(":")[0]
    .replace(/\b(app|ios|android)\b/gi, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "")
    .toLowerCase()
    .trim();
}

export function guessBatchCandidateRelevance(item, app, query) {
  const appName = normalizeAppNameForMatch(formatAppDisplayName(app?.name || ""));
  const queryName = normalizeAppNameForMatch(query);
  const haystack = normalizeAppNameForMatch([
    item?.text,
    item?.caption,
    item?.title,
    item?.description,
    item?.author,
    item?.coverUrl,
    item?.url
  ].filter(Boolean).join(" "));
  const tokens = Array.from(new Set([appName, queryName].filter((token) => token.length >= 3)));
  if (!tokens.length || !haystack) return true;
  return tokens.some((token) => haystack.includes(token));
}
