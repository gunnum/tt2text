const ARTICLE_SEARCH_MIN_LIMIT = 10;
const ARTICLE_SEARCH_MAX_LIMIT = 100;
const ARTICLE_SEARCH_STEP = 10;
const ARTICLE_SEARCH_CANDIDATE_MULTIPLIER = 5;
const ARTICLE_SEARCH_BLOCKED_HOSTS = [
  "apps.apple.com",
  "play.google.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "tiktok.com",
  "www.tiktok.com",
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "x.com",
  "twitter.com",
  "www.reddit.com",
  "reddit.com",
  "pinterest.com",
  "www.pinterest.com",
  "similarweb.com",
  "www.similarweb.com",
  "apptopia.com",
  "www.apptopia.com",
  "appfigures.com",
  "www.appfigures.com",
  "apkpure.com",
  "apkpure.net",
  "www.apkpure.com",
  "www.apkpure.net",
  "appbrain.com",
  "www.appbrain.com",
  "captain-droid.com",
  "www.captain-droid.com",
  "andro.io",
  "sensortower.com",
  "app.sensortower.com"
];
const ARTICLE_SEARCH_LOW_VALUE_HOST_HINTS = [
  "apk",
  "download",
  "appbrain.com",
  "apkpure",
  "captain-droid",
  "andro.io",
  "appshunter.io",
  "justuseapp.com",
  "appadvice.com",
  "uptodown.com"
];

export function createArticleSearchService(deps = {}) {
  const requiredDeps = [
    "findAppById",
    "readArticles",
    "runArticleIngestion",
    "pickResultAppFields",
    "normalizeText",
    "normalizeSourceUrl"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createArticleSearchService 缺少依赖：${dep}`);
    }
  }

  async function searchAndImportArticles(body = {}) {
    const app = await deps.findAppById(body.appId);
    if (!app) {
      throw new Error("选择的 App 不存在，请先重新录入或刷新页面。");
    }

    const targetLimit = normalizeArticleSearchLimit(body.limit);
    const queries = buildArticleSearchQueries(app, body.query);
    const existingArticles = await deps.readArticles();
    const existingUrlSet = new Set(existingArticles.map((item) => normalizeSourceUrl(item.sourceUrl)));
    const rawCandidates = [];

    for (const query of queries) {
      const items = await searchArticleCandidates(query).catch((error) => {
        console.error(`article search failed for ${query}`, error);
        return [];
      });
      rawCandidates.push(...items.map((item) => ({ ...item, query })));
      if (rawCandidates.length >= targetLimit * ARTICLE_SEARCH_CANDIDATE_MULTIPLIER) {
        break;
      }
    }

    const candidates = rankArticleCandidates(rawCandidates, app, existingUrlSet)
      .slice(0, Math.max(targetLimit * 2, targetLimit + 20));
    if (body.dryRun === true) {
      return {
        app: deps.pickResultAppFields(app),
        requested: targetLimit,
        queries,
        searched: rawCandidates.length,
        candidates: candidates.slice(0, targetLimit),
        imported: [],
        skipped: [],
        failed: [],
        dryRun: true,
        qualityRules: getArticleSearchQualityRules()
      };
    }

    const imported = [];
    const skipped = [];
    const failed = [];

    for (const candidate of candidates) {
      if (imported.length >= targetLimit) {
        break;
      }
      const normalizedUrl = normalizeSourceUrl(candidate.url);
      if (existingUrlSet.has(normalizedUrl)) {
        skipped.push({ ...candidate, reason: "duplicate" });
        continue;
      }
      try {
        const article = await deps.runArticleIngestion(candidate.url, app.id);
        imported.push({ candidate, article });
        existingUrlSet.add(normalizedUrl);
      } catch (error) {
        failed.push({
          candidate,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      app: deps.pickResultAppFields(app),
      requested: targetLimit,
      queries,
      searched: rawCandidates.length,
      candidates: candidates.slice(0, 40),
      imported,
      skipped,
      failed,
      qualityRules: getArticleSearchQualityRules()
    };
  }

  function getArticleSearchQualityRules() {
    return [
      "要求标题、摘要或 URL 命中 App 名称。",
      "过滤 App Store、Google Play、TikTok、YouTube、Reddit、下载站、应用统计页等非文章页。",
      "按 App 名命中、文章型关键词、域名质量、重复情况综合打分。",
      "逐条录入，失败不中断后续候选。"
    ];
  }

  function normalizeArticleSearchLimit(limit) {
    const value = Number(limit) || ARTICLE_SEARCH_MIN_LIMIT;
    const stepped = Math.round(value / ARTICLE_SEARCH_STEP) * ARTICLE_SEARCH_STEP;
    return Math.min(ARTICLE_SEARCH_MAX_LIMIT, Math.max(ARTICLE_SEARCH_MIN_LIMIT, stepped));
  }

  function buildArticleSearchQueries(app, customQuery = "") {
    const appName = normalizeText(app.name);
    const fullName = normalizeText(app.fullName);
    const sellerName = normalizeText(app.sellerName);
    const baseNames = uniqueStrings([customQuery, appName, fullName])
      .filter((item) => item && item.length <= 80);
    const primaryName = baseNames[0] || appName || fullName;
    const quotedNames = uniqueStrings(baseNames.map((item) => `"${item.replace(/"/g, "")}"`));
    const queries = [];

    for (const name of baseNames) {
      queries.push(`${name} app review`);
      queries.push(`${name} app news`);
      queries.push(`${name} social app`);
      queries.push(`${name} dating app`);
      queries.push(`${name} startup`);
      queries.push(`${name} revenue downloads`);
      queries.push(`${name} interview founder`);
    }
    for (const name of quotedNames) {
      queries.push(`${name} app review`);
      queries.push(`${name} app news`);
      queries.push(`${name} social app`);
      queries.push(`${name} dating app`);
      queries.push(`${name} startup`);
      queries.push(`${name} revenue downloads`);
      queries.push(`${name} interview founder`);
    }
    if (sellerName && primaryName) {
      queries.push(`"${primaryName.replace(/"/g, "")}" "${sellerName.replace(/"/g, "")}"`);
    }

    return uniqueStrings(queries).slice(0, 16);
  }

  async function searchArticleCandidates(query) {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TT2TextArticleSearch/1.0)",
        "Accept": "text/html,application/xhtml+xml"
      }
    });
    if (!response.ok) {
      throw new Error(`搜索失败：HTTP ${response.status}`);
    }
    const html = await response.text();
    return parseDuckDuckGoResults(html);
  }

  function parseDuckDuckGoResults(html) {
    const results = [];
    const blocks = String(html || "").split(/<div class="result results_links_deep/).slice(1);
    for (const block of blocks) {
      const linkMatch = block.match(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!linkMatch) {
        continue;
      }
      const url = normalizeSearchResultUrl(decodeHtmlEntities(linkMatch[1]));
      if (!url) {
        continue;
      }
      const title = stripHtml(linkMatch[2]);
      const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)
        || block.match(/<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
      const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";
      results.push({ url, title, snippet });
    }
    if (!results.length) {
      for (const match of String(html || "").matchAll(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const url = normalizeSearchResultUrl(decodeHtmlEntities(match[1]));
        if (!url) {
          continue;
        }
        results.push({
          url,
          title: stripHtml(match[2]),
          snippet: ""
        });
      }
    }
    return results;
  }

  function normalizeSearchResultUrl(rawUrl) {
    let value = normalizeText(rawUrl);
    if (!value) {
      return "";
    }
    if (value.startsWith("//duckduckgo.com/l/")) {
      value = `https:${value}`;
    }
    try {
      const parsed = new URL(value);
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) {
        return normalizeSourceUrl(uddg);
      }
      return normalizeSourceUrl(value);
    } catch {
      return "";
    }
  }

  function rankArticleCandidates(items, app, existingUrlSet) {
    const seen = new Set();
    const appTerms = buildAppMatchTerms(app);
    const ranked = [];
    for (const item of items) {
      const url = normalizeSearchResultUrl(item.url);
      if (!url || seen.has(url)) {
        continue;
      }
      seen.add(url);
      const quality = scoreArticleCandidate({ ...item, url }, appTerms, existingUrlSet);
      if (!quality.keep) {
        continue;
      }
      ranked.push({
        url,
        title: normalizeText(item.title),
        snippet: normalizeText(item.snippet),
        query: normalizeText(item.query),
        score: quality.score,
        reasons: quality.reasons,
        host: getUrlHost(url)
      });
    }
    return ranked.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  }

  function buildAppMatchTerms(app) {
    return uniqueStrings([
      normalizeText(app.name),
      normalizeText(app.fullName),
      normalizeText(app.bundleId),
      normalizeText(app.sellerName)
    ]).filter((item) => item && item.length >= 3);
  }

  function scoreArticleCandidate(item, appTerms, existingUrlSet) {
    const url = normalizeSourceUrl(item.url);
    const host = getUrlHost(url);
    const haystack = normalizeForSearch(`${item.title} ${item.snippet} ${url}`);
    const reasons = [];
    let score = 0;

    if (!url.startsWith("http")) {
      return { keep: false, score: 0, reasons: ["invalid-url"] };
    }
    if (existingUrlSet.has(url)) {
      return { keep: false, score: 0, reasons: ["duplicate"] };
    }
    if (isBlockedArticleSearchHost(host)) {
      return { keep: false, score: 0, reasons: ["blocked-host"] };
    }
    if (/\.(pdf|zip|dmg|apk|ipa)(?:$|[?#])/i.test(url)) {
      return { keep: false, score: 0, reasons: ["non-html-file"] };
    }
    if (/(?:^|[/-])(apk|download|free-android-app|android-apk)(?:$|[/?#-])/i.test(url)) {
      return { keep: false, score: 0, reasons: ["download-page"] };
    }

    const matchedTerms = appTerms.filter((term) => normalizeForSearch(term) && haystack.includes(normalizeForSearch(term)));
    if (!matchedTerms.length) {
      return { keep: false, score: 0, reasons: ["app-name-not-found"] };
    }
    score += 48 + Math.min(22, matchedTerms.length * 7);
    reasons.push("app-name-match");

    const titleText = normalizeForSearch(item.title);
    if (matchedTerms.some((term) => titleText.includes(normalizeForSearch(term)))) {
      score += 22;
      reasons.push("title-match");
    }

    const articleSignals = [
      "review",
      "analysis",
      "interview",
      "founder",
      "startup",
      "growth",
      "revenue",
      "download",
      "dating app",
      "social app",
      "case study",
      "safe",
      "legit",
      "scam",
      "news"
    ];
    const strongArticleSignals = [
      "review",
      "analysis",
      "interview",
      "founder",
      "startup",
      "growth",
      "revenue",
      "case study",
      "safe",
      "legit",
      "scam",
      "news",
      "in depth"
    ];
    for (const signal of articleSignals) {
      if (haystack.includes(signal)) {
        score += 5;
      }
    }
    const hasStrongArticleSignal = strongArticleSignals.some((signal) => haystack.includes(signal));
    if (hasStrongArticleSignal) {
      reasons.push("article-signal");
    } else {
      return { keep: false, score: 0, reasons: ["weak-article-signal"] };
    }

    if (ARTICLE_SEARCH_LOW_VALUE_HOST_HINTS.some((hint) => host.includes(hint))) {
      score -= 38;
      reasons.push("low-value-domain");
    }
    if (/(blog|medium|substack|news|tech|review|dating|startup|business|wired|forbes|dazed|elle)/i.test(host)) {
      score += 10;
      reasons.push("article-like-domain");
    }
    if (/[?&](utm_|ref=|fbclid=|gclid=)/i.test(item.url)) {
      score -= 6;
      reasons.push("tracking-url");
    }

    return {
      keep: score >= 70,
      score,
      reasons
    };
  }

  function isBlockedArticleSearchHost(host) {
    if (!host) {
      return true;
    }
    return ARTICLE_SEARCH_BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  }

  function getUrlHost(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  }

  function normalizeForSearch(value) {
    return normalizeText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  function uniqueStrings(items) {
    return Array.from(new Set(items.map((item) => normalizeText(item)).filter(Boolean)));
  }

  function stripHtml(value) {
    return decodeHtmlEntities(String(value || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  }

  function decodeHtmlEntities(value) {
    return String(value || "")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
  }

  function normalizeText(value) {
    return deps.normalizeText(value);
  }

  function normalizeSourceUrl(value) {
    return deps.normalizeSourceUrl(value);
  }

  return {
    searchAndImportArticles,
    getArticleSearchQualityRules,
    normalizeArticleSearchLimit,
    buildArticleSearchQueries,
    searchArticleCandidates,
    parseDuckDuckGoResults,
    normalizeSearchResultUrl,
    rankArticleCandidates,
    buildAppMatchTerms,
    scoreArticleCandidate,
    isBlockedArticleSearchHost,
    getUrlHost,
    normalizeForSearch,
    stripHtml,
    decodeHtmlEntities
  };
}
