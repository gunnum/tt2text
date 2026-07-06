import fs from "node:fs/promises";
import path from "node:path";

const PAYWALL_SCREENS_BASE_URL = "https://www.paywallscreens.com";
const DEFAULT_APPS_FILE = "data/apps.json";
const DEFAULT_OUTPUT_FILE = ".tmp/paywallscreens/app-paywall-matches.json";

const args = parseArgs(process.argv.slice(2));
const appsFile = args.apps || DEFAULT_APPS_FILE;
const outputFile = args.output || DEFAULT_OUTPUT_FILE;
const limit = Number.parseInt(args.limit || "", 10) || undefined;
const shouldDownloadImages = args["skip-images"] !== "true";

async function main() {
  const apps = JSON.parse(await fs.readFile(appsFile, "utf8"));
  const scopedApps = limit ? apps.slice(0, limit) : apps;
  const results = [];

  for (const app of scopedApps) {
    const queries = buildQueries(app);
    const candidates = [];
    const errors = [];

    for (const query of queries) {
      try {
        const paywalls = await searchPaywalls(query);
        candidates.push(...paywalls.map((paywall) => ({ query, paywall })));
      } catch (error) {
        errors.push({ query, error: error.message });
      }
      await wait(150);
    }

    const matches = dedupeCandidates(candidates)
      .map((candidate) => scoreCandidate(app, candidate))
      .filter((candidate) => candidate.score >= 60)
      .sort((a, b) => b.score - a.score);

    results.push({
      appStoreId: app.id,
      name: app.name,
      fullName: app.fullName || "",
      bundleId: app.bundleId || "",
      matched: matches.length > 0,
      bestMatch: matches[0] ? summarizeMatch(matches[0]) : null,
      matches: matches.map(summarizeMatch),
      errors
    });
  }

  if (shouldDownloadImages) {
    await downloadMatchedImages(results, path.join(path.dirname(outputFile), "images"));
  }

  const summary = {
    source: PAYWALL_SCREENS_BASE_URL,
    generatedAt: new Date().toISOString(),
    total: results.length,
    matched: results.filter((item) => item.matched).length,
    unmatched: results.filter((item) => !item.matched).length,
    results
  };

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(summary, null, 2)}\n`);

  printSummary(summary, outputFile);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function buildQueries(app) {
  const names = [
    app.id,
    safeSearchText(app.name),
    safeSearchText(app.fullName),
    stripSubtitle(app.fullName),
    stripSubtitle(app.name)
  ];
  return [...new Set(names.map((value) => String(value || "").trim()).filter(Boolean))];
}

async function searchPaywalls(query) {
  const url = new URL("/api/paywalls", PAYWALL_SCREENS_BASE_URL);
  url.searchParams.set("search", query);
  url.searchParams.set("category", "");
  url.searchParams.set("sort", "");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`PaywallScreens search failed for "${query}": ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function dedupeCandidates(candidates) {
  const byId = new Map();
  for (const candidate of candidates) {
    const id = candidate.paywall?.id || candidate.paywall?.image_url;
    if (!id || byId.has(id)) continue;
    byId.set(id, candidate);
  }
  return [...byId.values()];
}

function scoreCandidate(app, candidate) {
  const paywallApp = candidate.paywall.app || {};
  const appId = String(app.id || "");
  const paywallAppId = String(candidate.paywall.app_id || paywallApp.id || "");
  const localNames = [app.name, app.fullName].map(normalizeName).filter(Boolean);
  const paywallName = normalizeName(paywallApp.name);
  const bundleMatches = app.bundleId && app.bundleId === paywallApp.bundle_id;

  let score = 0;
  if (appId && paywallAppId && appId === paywallAppId) score += 100;
  if (bundleMatches) score += 80;
  if (localNames.includes(paywallName)) score += 70;
  if (localNames.some((name) => name && paywallName.includes(name))) score += 55;
  if (localNames.some((name) => name && name.includes(paywallName))) score += 45;
  if (candidate.query && normalizeName(candidate.query) === paywallName) score += 20;

  return { ...candidate, score };
}

function summarizeMatch(candidate) {
  const paywall = candidate.paywall;
  const app = paywall.app || {};
  const metadata = paywall.metadata || {};
  return {
    score: candidate.score,
    query: candidate.query,
    paywallId: paywall.id,
    appStoreId: String(paywall.app_id || app.id || ""),
    appName: app.name || "",
    bundleId: app.bundle_id || "",
    developer: app.artist_name || "",
    pageUrl: app.slug ? `${PAYWALL_SCREENS_BASE_URL}/apps/${app.slug}` : "",
    imageUrl: paywall.image_url || "",
    collectedAt: paywall.collected_at || "",
    appVersion: app.version || "",
    appUpdatedAt: app.current_version_release_date || "",
    estimatedMonthlyRevenue: metadata.estimated_revenue ?? null,
    estimatedMonthlyDownloads: metadata.estimated_downloads ?? null,
    averageUserRating: app.average_user_rating ?? null,
    userRatingCount: app.user_rating_count ?? null
  };
}

function stripSubtitle(value) {
  return safeSearchText(String(value || "").split(/[:\-–—|]/)[0]?.trim() || "");
}

function safeSearchText(value) {
  return String(value || "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(app|ios|mobile|paywall)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printSummary(summary, savedPath) {
  console.log(`PaywallScreens matches: ${summary.matched}/${summary.total}`);
  console.log(`Saved: ${savedPath}`);
  for (const item of summary.results) {
    const suffix = item.bestMatch ? ` -> ${item.bestMatch.appName} (${item.bestMatch.pageUrl})` : "";
    console.log(`${item.matched ? "MATCH" : "MISS "} ${item.name}${suffix}`);
  }
}

async function downloadMatchedImages(results, imagesDir) {
  await fs.mkdir(imagesDir, { recursive: true });
  for (const item of results) {
    if (!item.bestMatch?.imageUrl) continue;
    try {
      const response = await fetch(item.bestMatch.imageUrl);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const extension = imageExtension(item.bestMatch.imageUrl, response.headers.get("content-type"), bytes);
      const file = path.join(imagesDir, `${safeFilename(`${item.name}-${item.appStoreId}`)}${extension}`);
      await fs.writeFile(file, bytes);
      item.bestMatch.localImagePath = file;
      for (const match of item.matches) {
        if (match.paywallId === item.bestMatch.paywallId) match.localImagePath = file;
      }
    } catch (error) {
      item.imageDownloadError = error.message;
    }
  }
}

function imageExtension(url, contentType = "", bytes = Buffer.alloc(0)) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return ".png";
  if (bytes.slice(0, 4).toString("ascii") === "RIFF" && bytes.slice(8, 12).toString("ascii") === "WEBP") return ".webp";
  if (contentType.includes("image/jpeg")) return ".jpg";
  if (contentType.includes("image/png")) return ".png";
  if (contentType.includes("image/webp")) return ".webp";
  const pathname = new URL(url).pathname;
  const extension = path.extname(pathname).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp"].includes(extension) ? extension : ".png";
}

function safeFilename(value) {
  return String(value || "paywall")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "paywall";
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
