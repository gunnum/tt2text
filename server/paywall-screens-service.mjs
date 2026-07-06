const PAYWALL_SCREENS_BASE_URL = "https://www.paywallscreens.com";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_TIMEOUT_MS = 4500;
const PAGE_IMAGE_TIMEOUT_MS = 3500;
const ENRICH_LIMIT = 8;

export function createPaywallScreensService(deps = {}) {
  const requiredDeps = [
    "readAppPaywalls",
    "writeAppPaywalls",
    "normalizeText",
    "truncateText",
    "formatDate"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createPaywallScreensService 缺少依赖：${dep}`);
    }
  }

  async function findPaywallScreensForApp(app, { refresh = false } = {}) {
    if (!app?.id && !app?.name) {
      throw new Error("缺少 App 信息。");
    }
    const appId = normalizeText(app.id);
    const cache = await deps.readAppPaywalls();
    const cached = cache.find((item) => normalizeText(item.appId) === appId);
    if (!refresh && cached && !isCacheExpired(cached)) {
      return cached;
    }

    const queries = buildQueries(app).slice(0, 4);
    const candidates = [];
    const errors = [];
    const searchResults = await Promise.all(queries.map(async (query) => {
      try {
        const paywalls = await searchPaywalls(query);
        return { query, paywalls, error: "" };
      } catch (error) {
        return { query, paywalls: [], error: error instanceof Error ? error.message : String(error) };
      }
    }));
    for (const result of searchResults) {
      if (result.error) {
        errors.push({ query: result.query, error: result.error });
      }
      candidates.push(...result.paywalls.map((paywall) => ({ query: result.query, paywall })));
    }

    const matches = dedupeCandidates(candidates)
      .map((candidate) => scoreCandidate(app, candidate))
      .filter((candidate) => candidate.score >= 60)
      .sort((a, b) => b.score - a.score)
      .slice(0, ENRICH_LIMIT)
      .map(summarizeMatch);

    const enrichedMatches = await enrichMatchesWithPageImages(matches);

    const lookupStatus = resolveLookupStatus({ matches: enrichedMatches, errors });
    const previousBest = cached?.bestMatch || null;
    const bestMatch = enrichedMatches[0] || null;
    const refreshStatus = resolveRefreshStatus({ refresh, cached, matches: enrichedMatches, previousBest, bestMatch, lookupStatus });
    const fallbackToCached = Boolean(refresh && cached?.matched && !enrichedMatches.length && lookupStatus === "failed");
    const checkedAt = deps.formatDate(new Date());
    const record = {
      appId,
      appName: normalizeText(app.name),
      source: PAYWALL_SCREENS_BASE_URL,
      matched: fallbackToCached ? Boolean(cached?.matched) : enrichedMatches.length > 0,
      bestMatch: fallbackToCached ? (cached?.bestMatch || null) : bestMatch,
      matches: fallbackToCached ? (cached?.matches || []) : enrichedMatches,
      lookupStatus,
      crawlStatus: lookupStatus,
      queries,
      errors,
      fetchedAt: checkedAt,
      checkedAt,
      refreshStatus
    };
    const nextCache = [record, ...cache.filter((item) => normalizeText(item.appId) !== appId)];
    await deps.writeAppPaywalls(nextCache);
    return record;
  }

  function isCacheExpired(record) {
    const time = Date.parse(normalizeText(record.fetchedAt).replace(" ", "T"));
    return !Number.isFinite(time) || Date.now() - time > CACHE_TTL_MS;
  }

  async function searchPaywalls(query) {
    const url = new URL("/api/paywalls", PAYWALL_SCREENS_BASE_URL);
    url.searchParams.set("search", query);
    url.searchParams.set("category", "");
    url.searchParams.set("sort", "");
    const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  async function enrichMatchesWithPageImages(matches) {
    const pageImageResults = await Promise.all(matches.map(async (match) => {
      const pageImages = await fetchPaywallPageImages(match.pageUrl, match.appStoreId);
      return { match, pageImages };
    }));
    const expanded = [];
    for (const { match, pageImages } of pageImageResults) {
      if (!pageImages.length) {
        expanded.push(match);
        continue;
      }
      for (const imageUrl of pageImages) {
        expanded.push({
          ...match,
          imageUrl,
          dedupeKey: `${match.paywallId || match.appStoreId || match.pageUrl}|${imageUrl}`
        });
      }
    }
    return dedupeExpandedMatches(expanded);
  }

  async function fetchPaywallPageImages(pageUrl, appStoreId) {
    if (!pageUrl) return [];
    try {
      const response = await fetch(pageUrl, { signal: AbortSignal.timeout(PAGE_IMAGE_TIMEOUT_MS) });
      if (!response.ok) {
        return [];
      }
      const html = await response.text();
      const matches = html.match(/https:\/\/[^"' ]+\/paywalls\/[^"' )]+\.(?:png|jpg|jpeg|webp)/gi) || [];
      const currentAppImages = appStoreId
        ? matches.filter((url) => url.includes(`/paywalls/${appStoreId}/`))
        : matches;
      return Array.from(new Set(currentAppImages.length ? currentAppImages : matches));
    } catch {
      return [];
    }
  }

  function normalizeText(value) {
    return deps.normalizeText(value);
  }

  return {
    findPaywallScreensForApp
  };
}

function buildQueries(app) {
  return [...new Set([
    app.id,
    safeSearchText(app.name),
    safeSearchText(app.fullName),
    stripSubtitle(app.fullName),
    stripSubtitle(app.name),
    app.bundleId
  ].map((value) => String(value || "").trim()).filter(Boolean))];
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
  const paywall = candidate.paywall || {};
  const paywallApp = paywall.app || {};
  const appId = String(app.id || "");
  const paywallAppId = String(paywall.app_id || paywallApp.id || "");
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
  const paywall = candidate.paywall || {};
  const app = paywall.app || {};
  const metadata = paywall.metadata || {};
  return {
    score: candidate.score,
    query: candidate.query,
    paywallId: paywall.id || "",
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

function resolveLookupStatus({ matches, errors }) {
  if (matches.length) {
    return "matched";
  }
  if (errors.length) {
    return "failed";
  }
  return "unlisted";
}

function resolveRefreshStatus({ refresh, cached, matches, previousBest, bestMatch, lookupStatus }) {
  if (lookupStatus === "failed") {
    return "failed";
  }
  if (!refresh) {
    return cached ? "cached" : (matches.length ? "initial" : "missing");
  }
  if (!cached) {
    return matches.length ? "initial" : "missing";
  }
  if (!matches.length) {
    return cached?.matched ? "current" : "missing";
  }
  return samePaywall(previousBest, bestMatch) ? "current" : "updated";
}

function dedupeExpandedMatches(matches) {
  const seen = new Set();
  const result = [];
  for (const match of matches) {
    const key = match.dedupeKey || `${match.paywallId}|${match.imageUrl}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(match);
  }
  return result;
}

function samePaywall(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return [
    left.paywallId,
    left.imageUrl,
    left.collectedAt,
    left.appVersion,
    left.appUpdatedAt
  ].join("|") === [
    right.paywallId,
    right.imageUrl,
    right.collectedAt,
    right.appVersion,
    right.appUpdatedAt
  ].join("|");
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
