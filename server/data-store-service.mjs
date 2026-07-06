import { promises as fs } from "node:fs";

export function createDataStoreService(deps = {}) {
  const requiredDeps = [
    "files",
    "readJsonArrayFile",
    "writeJsonFileAtomic",
    "formatDate"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createDataStoreService 缺少依赖：${dep}`);
    }
  }

  const files = deps.files;

  async function readResults() {
    const parsed = await readJsonFile(files.results);
    return parsed.map((item) => normalizeResultRecord({
      transcriptEn: "",
      sourceLanguage: "",
      sourceLanguageProbability: null,
      engagement: defaultTikTokEngagement(),
      publishedAt: "",
      publishedText: "",
      duration: null,
      visualSummary: "",
      visualFramePaths: [],
      visualTextSegments: [],
      visualTextOcr: null,
      materialAnalysis: null,
      commentsRaw: null,
      commentInsights: [],
      relevance: {
        status: "unknown",
        isRelevant: null,
        confidence: 0,
        reason: "相关性尚未判断。",
        checkedAt: ""
      },
      app: null,
      ...item
    }));
  }

  async function writeResults(results) {
    await deps.writeJsonFileAtomic(files.results, results);
  }

  async function readTikTokCommentsRaw() {
    return deps.readJsonArrayFile(files.tiktokComments);
  }

  async function readTikTokComments() {
    return readTikTokCommentsRaw();
  }

  async function writeTikTokComments(records) {
    await deps.writeJsonFileAtomic(files.tiktokComments, records);
  }

  async function readVideoJobs() {
    const parsed = await deps.readJsonArrayFile(files.videoJobs);
    return parsed.map((item) => ({
      status: "queued",
      progress: 0,
      stage: "",
      stageKey: "queued",
      stageHistory: [],
      title: "",
      previewText: "",
      coverUrl: "",
      author: "",
      duration: "",
      engagement: defaultTikTokEngagement(),
      publishedAt: "",
      publishedText: "",
      resultId: "",
      error: "",
      retryCount: 0,
      sourceLanguage: "",
      sourceLanguageProbability: null,
      ...item
    }));
  }

  async function writeVideoJobs(jobs) {
    await deps.writeJsonFileAtomic(files.videoJobs, jobs);
  }

  async function appendConversionErrorLog(entry) {
    const payload = {
      ...entry,
      occurredAt: deps.formatDate(new Date())
    };
    await fs.appendFile(files.conversionErrors, `${JSON.stringify(payload)}\n`, "utf8");
  }

  async function readArticles() {
    const parsed = await readJsonFile(files.articles);
    return parsed.map((item) => ({
      app: null,
      imageCount: 0,
      contentBlockCount: 0,
      excerpt: "",
      coreInsights: [],
      briefMarkdownPath: "",
      ...item
    }));
  }

  async function writeArticles(articles) {
    await writeJsonFile(files.articles, articles);
  }

  async function readArticleAppLinks() {
    if (!files.articleAppLinks) return [];
    try {
      const parsed = await readJsonFile(files.articleAppLinks);
      return Array.isArray(parsed)
        ? parsed.map((item) => ({
          articleId: "",
          sourceUrl: "",
          appId: "",
          relation: "mention",
          relevance: "medium",
          note: "",
          createdAt: "",
          ...item
        }))
        : [];
    } catch {
      return [];
    }
  }

  async function writeArticleAppLinks(records) {
    if (!files.articleAppLinks) return;
    await writeJsonFile(files.articleAppLinks, records);
  }

  async function readApps() {
    const parsed = await readJsonFile(files.apps);
    return parsed.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function writeApps(apps) {
    await writeJsonFile(files.apps, apps);
  }

  async function readAppMetrics() {
    const parsed = await readJsonFile(files.appMetrics);
    return parsed.map((item) => ({
      app: null,
      appId: "",
      appName: "",
      matched: false,
      source: "sensortower",
      sourceUrl: "",
      pageTitle: "",
      pageText: "",
      metrics: [],
      tables: [],
      filters: [],
      overview: null,
      collectedAt: "",
      ...item
    }));
  }

  async function writeAppMetrics(records) {
    await writeJsonFile(files.appMetrics, records);
  }

  async function readAppPaywalls() {
    if (!files.appPaywalls) {
      return [];
    }
    return deps.readJsonArrayFile(files.appPaywalls);
  }

  async function writeAppPaywalls(records) {
    if (!files.appPaywalls) {
      return;
    }
    await deps.writeJsonFileAtomic(files.appPaywalls, records);
  }

  async function readSensorTowerCsvImports() {
    const parsed = await readJsonFile(files.sensorTowerCsv);
    return parsed.map((item) => ({
      id: "",
      source: "sensortower",
      sourceUrl: "",
      dataType: "unknown_metric",
      metric: "",
      appId: "",
      appName: "",
      app: null,
      matched: false,
      csvPath: "",
      parsedPath: "",
      rowCount: 0,
      headers: [],
      filters: {},
      dateRange: {},
      importedAt: "",
      ...item
    }));
  }

  async function writeSensorTowerCsvImports(records) {
    await deps.writeJsonFileAtomic(files.sensorTowerCsv, records);
  }

  async function readJsonFile(filePath) {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  }

  async function writeJsonFile(filePath, value) {
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
  }

  function defaultTikTokEngagement() {
    return {
      likeCount: null,
      likeText: "",
      commentCount: null,
      commentText: "",
      shareCount: null,
      shareText: "",
      viewCount: null,
      viewText: "",
      source: "tiktok-search"
    };
  }

  function normalizeResultRecord(item = {}) {
    const transcriptOriginal = normalizeText(item.transcriptOriginal || item.transcript_original || item.transcriptEn || item.transcript_en);
    const sourceUrl = normalizeText(item.sourceUrl || item.source_url || item.hyperlink);
    const firstFramePath = normalizeText(item.firstFramePath || item.first_frame_path);
    const imagePaths = Array.isArray(item.imagePaths || item.image_paths)
      ? (item.imagePaths || item.image_paths).map(normalizeText).filter(Boolean)
      : [];
    const analysis = item.analysis && typeof item.analysis === "object"
      ? item.analysis
      : item.materialAnalysis && typeof item.materialAnalysis === "object"
        ? item.materialAnalysis
        : null;
    const engagement = item.engagement && typeof item.engagement === "object"
      ? item.engagement
      : defaultTikTokEngagement();
    const sourceItemId = normalizeText(item.sourceItemId || item.source_item_id || extractSourceItemId(sourceUrl));

    return {
      ...item,
      sourceType: normalizeText(item.sourceType || item.source_type) || inferResultSourceType(sourceUrl),
      sourcePlatform: normalizeText(item.sourcePlatform || item.source_platform) || inferResultSourcePlatform(sourceUrl),
      sourceItemId,
      canonicalUrl: normalizeText(item.canonicalUrl || item.canonical_url || item.normalizedUrl || item.hyperlink || sourceUrl),
      mediaType: normalizeText(item.mediaType || item.media_type) || inferResultMediaType(sourceUrl),
      authorName: normalizeText(item.authorName || item.author_name || item.author),
      capturedAt: normalizeText(item.capturedAt || item.captured_at || item.createdAt),
      appId: normalizeText(item.appId || item.app?.id),
      rawBrandName: normalizeText(item.rawBrandName || item.raw_brand_name || item.brandName),
      projects: normalizeProjectNames(item.projects || item.projectNames || item.project_names),
      media: {
        videoPath: normalizeText(item.videoPath || item.video_path),
        posterPath: normalizeText(item.posterPath || item.poster_path || firstFramePath),
        firstFramePath,
        imagePaths,
        width: Number(item.width) || null,
        height: Number(item.height) || null
      },
      transcriptOriginal,
      analysis,
      metrics: {
        source: inferResultSourcePlatform(sourceUrl) === "tiktok" ? "tiktok_detail" : inferResultSourcePlatform(sourceUrl),
        likeCount: normalizeNullableCount(engagement.likeCount),
        commentCount: normalizeNullableCount(engagement.commentCount),
        shareCount: normalizeNullableCount(engagement.shareCount),
        viewCount: normalizeNullableCount(engagement.viewCount),
        raw: engagement
      }
    };
  }

  function inferResultSourceType(sourceUrl) {
    return inferResultSourcePlatform(sourceUrl) === "tiktok" ? "normal_tiktok_video" : "normal_video";
  }

  function inferResultSourcePlatform(sourceUrl) {
    const text = normalizeText(sourceUrl).toLowerCase();
    if (text.includes("tiktok.com")) return "tiktok";
    if (text.includes("youtube.com") || text.includes("youtu.be")) return "youtube";
    return "unknown";
  }

  function inferResultMediaType(sourceUrl) {
    return /\/photo\//i.test(sourceUrl) ? "photo" : "video";
  }

  function extractSourceItemId(sourceUrl) {
    const text = normalizeText(sourceUrl);
    return text.match(/\/(?:video|photo)\/(\d+)/i)?.[1]
      || text.match(/[?&]v=([^&]+)/i)?.[1]
      || "";
  }

  function normalizeProjectNames(items) {
    const rawItems = typeof items === "string"
      ? items.split(/[,，、\n]/)
      : Array.isArray(items)
        ? items
        : [];
    return Array.from(new Set(rawItems.map(normalizeText).filter(Boolean))).slice(0, 12);
  }

  function normalizeNullableCount(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
    const text = normalizeText(value).replace(/,/g, "");
    const match = text.match(/^(\d+(?:\.\d+)?)([KMB万千])?$/i);
    if (!match) return null;
    const number = Number(match[1]);
    if (!Number.isFinite(number)) return null;
    const unit = match[2]?.toLowerCase() || "";
    const multiplier = unit === "k"
      ? 1_000
      : unit === "m"
        ? 1_000_000
        : unit === "b"
          ? 1_000_000_000
          : unit === "万"
            ? 10_000
            : unit === "千"
              ? 1_000
              : 1;
    return Math.max(0, Math.round(number * multiplier));
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  return {
    readResults,
    writeResults,
    readTikTokCommentsRaw,
    readTikTokComments,
    writeTikTokComments,
    readVideoJobs,
    writeVideoJobs,
    appendConversionErrorLog,
    readArticles,
    writeArticles,
    readArticleAppLinks,
    writeArticleAppLinks,
    readApps,
    writeApps,
    readAppMetrics,
    writeAppMetrics,
    readAppPaywalls,
    writeAppPaywalls,
    readSensorTowerCsvImports,
    writeSensorTowerCsvImports
  };
}
