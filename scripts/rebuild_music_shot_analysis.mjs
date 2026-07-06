import { promises as fs } from "node:fs";
import path from "node:path";
import { createRuntimeConfig } from "../server/runtime-config.mjs";
import { createCodexJsonService } from "../server/codex-json-service.mjs";
import { buildMaterialAnalysis } from "../server/material-analysis.mjs";
import { normalizeVisualTextSegments } from "../server/ad-shots/visual-text.mjs";

const runtimeConfig = createRuntimeConfig(new URL("../server.mjs", import.meta.url).href, process.env);
const projectRootDir = runtimeConfig.paths.projectRootDir;
const adShotsFile = runtimeConfig.paths.adShotsFile;
const adShotsDir = runtimeConfig.paths.adShotAssetsDir;

const codexJsonService = createCodexJsonService({
  codexBin: runtimeConfig.binaries.codexBin,
  projectRootDir,
  env: process.env
});

const MUSIC_APPS = new Set([
  "stats.fm for Spotify Music App",
  "EQUALS",
  "Airbuds Widget",
  "TouchTunes",
  "SoundCloud",
  "Pandora",
  "SongShift"
]);

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value, maxLength) {
  const text = normalizeText(value);
  if (!maxLength || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date).replace(/\//g, "-");
}

async function loadJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function buildHighlight(shot, analysis) {
  return normalizeText(
    shot.highlight
    || analysis.hook
    || analysis.cardTitle
    || shot.adCaption
    || shot.title
  );
}

async function buildSemanticFromArtifacts(shot) {
  const analysisDir = path.join(adShotsDir, shot.shotId, "analysis");
  const [metadata, visualSummary, visualOcr] = await Promise.all([
    loadJsonIfExists(path.join(analysisDir, "metadata.json")),
    loadJsonIfExists(path.join(analysisDir, "visual-summary.json")),
    loadJsonIfExists(path.join(analysisDir, "visual-ocr.json"))
  ]);

  const duration =
    Number(shot.duration)
    || Number(metadata?.duration)
    || Number(visualOcr?.duration)
    || null;

  const visualTextSegments = normalizeVisualTextSegments(
    visualOcr?.visual_text_segments
      || visualSummary?.visual_text_segments
      || shot.visualTextSegments
      || shot.analysisSummary?.visualTextSegments,
    duration
  );

  const semantic = {
    title: normalizeText(metadata?.title || shot.title || shot.readableTitle),
    webpage_url: normalizeText(metadata?.webpage_url || shot.sourceUrl || shot.canonicalUrl),
    transcript_en: normalizeText(shot.transcriptEn || shot.transcriptOriginal || ""),
    translation_zh: normalizeText(shot.transcriptZh || ""),
    source_language: normalizeText(shot.sourceLanguage || ""),
    source_language_probability: shot.sourceLanguageProbability ?? null,
    first_frame_path: normalizeText(shot.media?.firstFramePath || shot.posterPath || ""),
    visual_summary: normalizeText(shot.visualSummary || visualSummary?.summary_zh || ""),
    visual_text_segments: visualTextSegments
  };

  const hasEnough =
    Boolean(semantic.transcript_en || semantic.translation_zh || semantic.visual_summary || semantic.visual_text_segments.length);

  return { semantic, hasEnough };
}

async function main() {
  const allShots = JSON.parse(await fs.readFile(adShotsFile, "utf8"));
  const targets = allShots.filter((shot) => MUSIC_APPS.has(shot.appName || shot.targetApp || ""));
  const completedAt = formatDate(new Date());
  const summary = {
    total: targets.length,
    rebuilt: [],
    skipped: [],
    failed: []
  };

  for (const shot of targets) {
    const { semantic, hasEnough } = await buildSemanticFromArtifacts(shot);
    if (!hasEnough) {
      summary.skipped.push({
        shotId: shot.shotId,
        app: shot.appName || shot.targetApp || "",
        reason: "missing_semantic_artifacts"
      });
      console.log(`[skip] ${shot.shotId} | missing semantic artifacts`);
      continue;
    }

    try {
      const structured = await buildMaterialAnalysis({
        shot,
        semantic,
        runJsonTask: codexJsonService.runCodexJsonTask,
        timeoutMs: runtimeConfig.timeouts.codexRelevanceTimeoutMs,
        normalizeVisualTextSegments
      });
      shot.analysisSummary = {
        ...structured,
        highlight: buildHighlight(shot, structured)
      };
      shot.analysisStatus = "completed";
      shot.analysisStage = "分析完成";
      shot.analysisError = "";
      shot.analysisCompletedAt = completedAt;
      shot.updatedAt = completedAt;
      if (semantic.transcript_en) shot.transcriptEn = semantic.transcript_en;
      if (semantic.translation_zh) shot.transcriptZh = semantic.translation_zh;
      if (semantic.visual_summary) shot.visualSummary = semantic.visual_summary;
      if (semantic.visual_text_segments.length) {
        shot.visualTextSegments = semantic.visual_text_segments;
        shot.onScreenTextOriginal = structured.onScreenTextOriginal || semantic.visual_text_segments[0]?.original || shot.onScreenTextOriginal || "";
        shot.onScreenTextZh = structured.onScreenTextZh || semantic.visual_text_segments[0]?.zh || shot.onScreenTextZh || "";
      }
      summary.rebuilt.push({
        shotId: shot.shotId,
        app: shot.appName || shot.targetApp || "",
        storyboardSteps: Array.isArray(structured.storyboardFormula) ? structured.storyboardFormula.length : 0
      });
      console.log(`[rebuilt] ${shot.shotId} | ${(shot.appName || shot.targetApp || "")} | steps=${summary.rebuilt.at(-1).storyboardSteps}`);
    } catch (error) {
      summary.failed.push({
        shotId: shot.shotId,
        app: shot.appName || shot.targetApp || "",
        reason: truncateText(error instanceof Error ? error.message : String(error), 400)
      });
      console.log(`[failed] ${shot.shotId} | ${summary.failed.at(-1).reason}`);
    }
  }

  await fs.writeFile(adShotsFile, JSON.stringify(allShots, null, 2), "utf8");
  await fs.mkdir(path.join(projectRootDir, ".tmp", "experiments"), { recursive: true });
  await fs.writeFile(
    path.join(projectRootDir, ".tmp", "experiments", "music-analysis-rebuild-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
