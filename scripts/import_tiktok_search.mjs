#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_APP_QUERY = "Amata";

const args = parseArgs(process.argv.slice(2));
const baseUrl = args.baseUrl || DEFAULT_BASE_URL;
const appQuery = args.app || DEFAULT_APP_QUERY;
const inputPath = args.input || "";
const dryRun = Boolean(args.dryRun);

if (!inputPath) {
  printUsage();
  process.exit(1);
}

const rawItems = await readInputItems(inputPath);
const candidates = rawItems
  .map(normalizeCandidate)
  .filter((item) => item.url && item.url.includes("tiktok.com/") && item.url.includes("/video/"));

const [apps, results, jobs] = await Promise.all([
  getJson("/api/apps"),
  getJson("/api/results"),
  getJson("/api/video-jobs")
]);

const app = findApp(apps, appQuery);
if (!app) {
  throw new Error(`没有找到匹配 App：${appQuery}`);
}

const existing = new Set();
for (const result of results) {
  for (const url of [result.sourceUrl, result.hyperlink].filter(Boolean)) {
    existing.add(normalizeSourceUrl(url));
  }
}
for (const job of jobs) {
  if (["queued", "running"].includes(job.status)) {
    existing.add(normalizeSourceUrl(job.sourceUrl));
  }
}

const summary = [];
for (const item of candidates) {
  const normalizedUrl = normalizeSourceUrl(item.url);

  if (existing.has(normalizedUrl)) {
    summary.push({ status: "skipped_duplicate", url: item.url, reason: "已存在或正在队列中" });
    continue;
  }

  if (dryRun) {
    summary.push({ status: "would_queue", url: item.url, reason: "搜索页批量导入，相关性将在转写后由 LLM 判断" });
    continue;
  }

  const response = await fetch(`${baseUrl}/api/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: item.url, appId: app.id })
  });
  const payload = await response.json().catch(() => ({}));

  if (response.ok) {
    existing.add(normalizedUrl);
    summary.push({ status: "queued", url: item.url, jobId: payload.id, reason: "搜索页批量导入，相关性将在转写后由 LLM 判断" });
  } else if (response.status === 409) {
    existing.add(normalizedUrl);
    summary.push({ status: "skipped_duplicate", url: item.url, reason: payload.error || "重复视频" });
  } else {
    summary.push({ status: "failed", url: item.url, error: payload.error || `HTTP ${response.status}`, reason: "导入失败" });
  }
}

console.log(JSON.stringify({
  app: { id: app.id, name: app.name },
  inputCount: rawItems.length,
  candidateCount: candidates.length,
  summary,
  totals: summarize(summary)
}, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      parsed[key] = argv[index + 1] || "";
      index += 1;
    }
  }
  return parsed;
}

function printUsage() {
  console.error("usage: node scripts/import_tiktok_search.mjs --input <items.json> [--app Amata] [--base-url http://localhost:3000] [--dry-run]");
  console.error("note: WebUI 批量录入会通过 Chrome 扩展采集 TikTok 搜索页，再调用 /api/convert/batch。这个脚本保留给离线 JSON 导入。");
}

async function readInputItems(path) {
  const payload = JSON.parse(await readFile(path, "utf8"));
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload.items)) {
    return payload.items;
  }
  if (Array.isArray(payload.videoLinks)) {
    return payload.videoLinks;
  }
  throw new Error("输入 JSON 需要是数组，或包含 items/videoLinks 数组。");
}

function normalizeCandidate(item) {
  if (typeof item === "string") {
    return { url: item, text: "", author: "" };
  }
  return {
    url: String(item.url || item.href || "").trim(),
    text: normalizeText([item.text, item.caption, item.title, item.description, item.anchorText].filter(Boolean).join(" ")),
    author: normalizeText(item.author || item.username || extractAuthor(item.url || item.href || ""))
  };
}

function findApp(apps, query) {
  const target = normalizeAppNameForMatch(query);
  return apps.find((app) => normalizeAppNameForMatch(app.name) === target)
    || apps.find((app) => {
      const candidate = normalizeAppNameForMatch(app.name);
      return candidate && (candidate.includes(target) || target.includes(candidate));
    })
    || apps.find((app) => /amata/i.test(app.name));
}

function normalizeAppNameForMatch(value) {
  return String(value || "")
    .split(":")[0]
    .replace(/\b(app|ios|android)\b/gi, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "")
    .toLowerCase()
    .trim();
}

function normalizeSourceUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (["t", "q", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].includes(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").trim().replace(/\/$/, "");
  }
}

function extractAuthor(url) {
  const match = String(url || "").match(/tiktok\.com\/@([^/]+)/i);
  return match ? match[1] : "";
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} 请求失败：HTTP ${response.status}`);
  }
  return response.json();
}

function summarize(items) {
  return items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
}
