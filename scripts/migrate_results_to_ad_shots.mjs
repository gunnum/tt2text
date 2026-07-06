import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { normalizeAdShotRecord } from "../server/ad-shots/normalizers.mjs";
import { resolveDataDir } from "./local-storage.mjs";

const dataDir = resolveDataDir(process.env);
const resultsFile = path.join(dataDir, "results.json");
const adShotsFile = path.join(dataDir, "ad-shots.json");
const projectsFile = path.join(dataDir, "ad-shot-projects.json");

const results = await readJson(resultsFile);
const adShots = await readJson(adShotsFile);
const projects = await readJson(projectsFile);

const existingBySourceUrl = new Map(adShots.map((item, index) => [normalizeText(item.sourceUrl || item.canonicalUrl), index]).filter(([key]) => key));
const existingBySourceItemId = new Map(adShots.map((item, index) => [normalizeText(item.sourceItemId || item.sourceAdId || item.videoId), index]).filter(([key]) => key));
const existingByMigratedResultId = new Map(adShots.map((item, index) => [normalizeText(item.raw?.migratedFromResultId), index]).filter(([key]) => key));
const nextAdShots = [...adShots];
let migratedCount = 0;
let updatedExisting = 0;
let skippedExisting = 0;

for (const result of results) {
  const sourceUrl = normalizeText(result.sourceUrl || result.hyperlink);
  const sourceItemId = normalizeText(result.sourceItemId || extractSourceItemId(sourceUrl) || result.id);
  const migratedResultId = normalizeText(result.id);
  const existingIndex = existingByMigratedResultId.get(migratedResultId)
    ?? existingBySourceUrl.get(sourceUrl)
    ?? existingBySourceItemId.get(sourceItemId)
    ?? -1;
  const migrated = normalizeAdShotRecord(buildMigratedShot(result), projects);
  if (existingIndex >= 0) {
    const existing = nextAdShots[existingIndex];
    if (normalizeText(existing.raw?.migratedFromResultId) === migratedResultId) {
      nextAdShots[existingIndex] = normalizeAdShotRecord({
        ...existing,
        ...migrated,
        shotId: existing.shotId || migrated.shotId,
        shotUrl: existing.shotId ? `/shots/${existing.shotId}` : migrated.shotUrl,
        raw: {
          ...(existing.raw && typeof existing.raw === "object" ? existing.raw : {}),
          ...(migrated.raw && typeof migrated.raw === "object" ? migrated.raw : {})
        }
      }, projects);
      updatedExisting += 1;
      continue;
    }
    skippedExisting += 1;
    continue;
  }
  nextAdShots.unshift(migrated);
  migratedCount += 1;
  const insertedIndex = 0;
  if (sourceUrl) existingBySourceUrl.set(sourceUrl, insertedIndex);
  if (sourceItemId) existingBySourceItemId.set(sourceItemId, insertedIndex);
  if (migratedResultId) existingByMigratedResultId.set(migratedResultId, insertedIndex);
}

if (migratedCount || updatedExisting) {
  await writeJson(adShotsFile, nextAdShots);
}

console.log(JSON.stringify({
  results: results.length,
  adShotsBefore: adShots.length,
  migrated: migratedCount,
  updatedExisting,
  skippedExisting,
  adShotsAfter: nextAdShots.length
}, null, 2));

function buildMigratedShot(result) {
  const sourceUrl = normalizeText(result.sourceUrl || result.hyperlink);
  const firstFramePath = normalizePublicPath(result.firstFramePath || result.first_frame_path);
  const videoPath = resolveVideoPath(result, firstFramePath);
  const imagePaths = Array.isArray(result.imagePaths || result.image_paths)
    ? (result.imagePaths || result.image_paths).map(normalizePublicPath).filter(Boolean)
    : [];
  const visualFrames = normalizeVisualFrames(result.visualFramePaths || result.visual_frames || result.visualSummary?.frames);
  const analysis = normalizeAnalysis(result);
  const summaryZh = normalizeSummaryText(result.visualSummary);
  const transcriptZh = normalizeText(result.transcriptZh);
  const createdAt = normalizeText(result.createdAt || result.capturedAt || result.updatedAt);
  const mediaType = inferMediaType(result, sourceUrl, imagePaths);
  const shotId = `shot_migrated_${normalizeText(result.id) || createFallbackId(sourceUrl)}`;
  const sourceItemId = normalizeText(result.sourceItemId || extractSourceItemId(sourceUrl) || result.id);
  const app = result.app && typeof result.app === "object" ? {
    id: normalizeText(result.app.id || result.appId),
    name: normalizeText(result.app.name),
    logoUrl: normalizeText(result.app.logoUrl),
    appStoreUrl: normalizeText(result.app.appStoreUrl),
    fullName: normalizeText(result.app.fullName)
  } : null;
  const author = normalizeText(result.authorName || result.author || sourceUrl.match(/@([^/]+)/)?.[1] || "");
  const observedText = Array.isArray(result.visualSummary?.observedText) ? result.visualSummary.observedText.map(normalizeText).filter(Boolean) : [];
  return {
    shotId,
    sourcePlatform: "tiktok",
    sourceType: "normal_tiktok_video",
    sourceAdId: sourceItemId,
    sourceItemId,
    sourceUrl,
    canonicalUrl: normalizeText(result.canonicalUrl || result.normalizedUrl || sourceUrl),
    targetApp: normalizeText(result.app?.name || result.app?.fullName || result.appId || ""),
    captureContext: "legacy_results_migration",
    title: normalizeText(result.title || sourceUrl || result.id),
    brandName: normalizeText(result.brandName || result.rawBrandName || result.app?.name),
    rawBrandName: normalizeText(result.rawBrandName || result.brandName || result.app?.name),
    appId: normalizeText(result.appId || result.app?.id),
    app,
    appMatchStatus: normalizeText(result.appId || result.app?.id) ? "matched" : "",
    appMatchSource: normalizeText(result.appId || result.app?.id) ? "legacy-results" : "",
    appMatchQuery: normalizeText(result.app?.name || result.app?.fullName),
    appCategoriesSynced: [],
    projectIds: [],
    countryCode: [],
    industryKey: "",
    objectiveKey: "",
    landingPage: "",
    adCaption: normalizeText(result.title),
    sourceLabel: "TikTok 详情页",
    sourceKey: "tiktok_detail",
    mediaType,
    videoId: sourceItemId,
    duration: Number(result.duration) || null,
    width: Number(result.width || result.media?.width) || null,
    height: Number(result.height || result.media?.height) || null,
    videoPath,
    posterPath: mediaType === "photo" ? "" : firstFramePath,
    firstFramePath,
    imagePaths,
    detailPath: "",
    htmlPath: "",
    capturePackagePath: "",
    shotUrl: `/shots/${shotId}`,
    lastCollectedAt: createdAt,
    capturedAt: createdAt,
    createdAt,
    updatedAt: normalizeText(result.updatedAt || createdAt),
    analysisStatus: hasMigratedAnalysis(result, analysis) ? "completed" : "pending",
    analysisSummary: analysis || {
      cardTitle: "",
      cardSummary: "",
      visualTextSegments: []
    },
    analysis: analysis || null,
    analysisStage: hasMigratedAnalysis(result, analysis) ? "分析完成" : "",
    analysisError: "",
    analysisQueuedAt: hasMigratedAnalysis(result, analysis) ? createdAt : "",
    analysisStartedAt: hasMigratedAnalysis(result, analysis) ? createdAt : "",
    analysisCompletedAt: hasMigratedAnalysis(result, analysis) ? normalizeText(result.updatedAt || createdAt) : "",
    analysisProgress: hasMigratedAnalysis(result, analysis) ? {
      stageKey: "completed",
      stageLabel: "分析完成",
      message: "从旧 results 迁移",
      updatedAt: normalizeText(result.updatedAt || createdAt)
    } : null,
    analysisEvents: hasMigratedAnalysis(result, analysis) ? [
      {
        stageKey: "completed",
        stageLabel: "分析完成",
        message: "从旧 results 迁移",
        at: normalizeText(result.updatedAt || createdAt)
      }
    ] : [],
    transcriptEn: normalizeText(result.transcriptEn),
    transcriptZh,
    transcriptOriginal: normalizeText(result.transcriptOriginal || result.transcriptEn),
    visualSummary: summaryZh,
    sourceLanguage: normalizeText(result.sourceLanguage),
    sourceLanguageProbability: Number.isFinite(Number(result.sourceLanguageProbability)) ? Number(result.sourceLanguageProbability) : null,
    onScreenTextOriginal: observedText.join(" / "),
    onScreenTextZh: "",
    visualTextSegments: normalizeVisualTextSegments(result.visualTextSegments || result.visual_text_segments),
    commentsRaw: result.commentsRaw || null,
    commentInsights: Array.isArray(result.commentInsights) ? result.commentInsights : [],
    relevance: result.relevance || null,
    authorName: author,
    publishedAt: normalizeText(result.publishedAt),
    publishedText: normalizeText(result.publishedText),
    media: {
      videoPath,
      posterPath: mediaType === "photo" ? "" : firstFramePath,
      firstFramePath,
      imagePaths,
      width: Number(result.width || result.media?.width) || null,
      height: Number(result.height || result.media?.height) || null
    },
    metrics: {
      source: "tiktok_detail",
      likeCount: normalizeCount(result.engagement?.likeCount),
      commentCount: normalizeCount(result.engagement?.commentCount),
      shareCount: normalizeCount(result.engagement?.shareCount),
      viewCount: normalizeCount(result.engagement?.viewCount),
      ctrRank: "-",
      budget: "-",
      cost: null,
      raw: result.engagement || {}
    },
    analysisArtifacts: {
      firstFramePath,
      visualFramePaths: visualFrames,
      imagePaths,
      mediaType
    },
    raw: {
      migratedFromResultId: normalizeText(result.id),
      migratedAt: new Date().toISOString(),
      sourceUrl,
      adCaption: normalizeText(result.title),
      author,
      publishedText: normalizeText(result.publishedText),
      performance: {
        like: normalizeCount(result.engagement?.likeCount),
        comment: normalizeCount(result.engagement?.commentCount),
        share: normalizeCount(result.engagement?.shareCount),
        view: normalizeCount(result.engagement?.viewCount),
        ctr: null,
        cost: null
      },
      metrics: {
        like: normalizeCount(result.engagement?.likeCount),
        comment: normalizeCount(result.engagement?.commentCount),
        share: normalizeCount(result.engagement?.shareCount),
        view: normalizeCount(result.engagement?.viewCount)
      },
      relevance: result.relevance || null,
      visualSummaryRaw: result.visualSummary || null,
      materialAnalysis: result.materialAnalysis || result.analysis || null
    }
  };
}

function normalizeAnalysis(result) {
  const analysis = result.analysis && typeof result.analysis === "object"
    ? result.analysis
    : result.materialAnalysis && typeof result.materialAnalysis === "object"
      ? result.materialAnalysis
      : null;
  const summaryZh = normalizeSummaryText(result.visualSummary);
  if (!analysis) {
    if (!summaryZh && !normalizeText(result.transcriptZh)) return null;
    return {
      cardTitle: normalizeText(result.title),
      cardSummary: normalizeText(summaryZh || result.transcriptZh),
      videoStory: normalizeText(summaryZh || result.transcriptZh),
      productFeatures: [],
      storyboardFormula: [],
      reusableTemplate: "",
      onScreenTextOriginal: "",
      onScreenTextZh: "",
      visualTextSegments: normalizeVisualTextSegments(result.visualTextSegments || result.visual_text_segments),
      highlight: normalizeText(result.title || summaryZh || result.transcriptZh)
    };
  }
  return {
    ...analysis,
    cardTitle: normalizeText(analysis.cardTitle || analysis.readableTitle || result.title),
    cardSummary: normalizeText(analysis.cardSummary || summaryZh || result.transcriptZh),
    videoStory: normalizeText(analysis.videoStory || summaryZh || result.transcriptZh),
    productFeatures: Array.isArray(analysis.productFeatures) ? analysis.productFeatures.map(normalizeText).filter(Boolean) : [],
    storyboardFormula: Array.isArray(analysis.storyboardFormula) ? analysis.storyboardFormula.map(normalizeText).filter(Boolean) : [],
    reusableTemplate: normalizeText(analysis.reusableTemplate),
    onScreenTextOriginal: normalizeText(analysis.onScreenTextOriginal),
    onScreenTextZh: normalizeText(analysis.onScreenTextZh),
    visualTextSegments: normalizeVisualTextSegments(analysis.visualTextSegments || result.visualTextSegments || result.visual_text_segments),
    highlight: normalizeText(analysis.highlight || analysis.hook || result.title)
  };
}

function hasMigratedAnalysis(result, analysis) {
  return Boolean(
    analysis
    || normalizeText(result.transcriptZh)
    || normalizeSummaryText(result.visualSummary)
  );
}

function resolveVideoPath(result, firstFramePath = "") {
  const explicit = normalizePublicPath(result.videoPath || result.video_path || result.localVideoPath || result.local_video_path || result.media?.videoPath);
  if (explicit && fileExists(explicit)) return explicit;
  const match = firstFramePath.match(/^(\/data\/jobs\/[^/]+)\/first-frame\.(?:jpg|jpeg|png|webp)$/i);
  if (match) {
    const candidate = `${match[1]}/video.mp4`;
    if (fileExists(candidate)) return candidate;
  }
  return "";
}

function inferMediaType(result, sourceUrl = "", imagePaths = []) {
  const explicit = normalizeText(result.mediaType || result.media_type);
  if (explicit) return explicit;
  if (/\/photo\//i.test(sourceUrl)) return "photo";
  if (imagePaths.length && !resolveVideoPath(result, normalizePublicPath(result.firstFramePath || result.first_frame_path))) return "photo";
  return "video";
}

function normalizeVisualFrames(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizePublicPath(item)).filter(Boolean);
}

function normalizeVisualTextSegments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const original = normalizeText(item.original || item.text);
      const zh = normalizeText(item.zh || item.translation || item.summaryZh);
      if (!original && !zh) return null;
      return {
        ...item,
        original,
        zh
      };
    })
    .filter(Boolean);
}

function normalizeSummaryText(value) {
  if (!value) return "";
  if (typeof value === "string") return normalizeText(value);
  if (typeof value === "object") {
    return normalizeText(value.summaryZh || value.summary || value.text || "");
  }
  return "";
}

function normalizePublicPath(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (text.startsWith("/data/")) return text;
  const normalizedProjectRoot = `${projectRoot}${path.sep}`;
  if (text.startsWith(normalizedProjectRoot)) {
    return `/${path.relative(projectRoot, text).replaceAll(path.sep, "/")}`;
  }
  if (text.startsWith("data/")) {
    return `/${text.replaceAll(path.sep, "/")}`;
  }
  return text;
}

function fileExists(publicPath) {
  if (!publicPath) return false;
  const fullPath = path.join(projectRoot, publicPath.replace(/^\//, ""));
  try {
    return statSync(fullPath);
  } catch {
    return false;
  }
}

function statSync(fullPath) {
  return existsSync(fullPath);
}

function normalizeCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function extractSourceItemId(sourceUrl) {
  return normalizeText(sourceUrl).match(/\/(?:video|photo)\/(\d+)/i)?.[1] || "";
}

function createFallbackId(sourceUrl) {
  return Buffer.from(sourceUrl || String(Date.now())).toString("base64").replace(/[^a-z0-9]/gi, "").slice(0, 16).toLowerCase();
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}
