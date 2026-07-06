import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export function createRuntimeConfig(moduleUrl, env = process.env) {
  const filename = fileURLToPath(moduleUrl);
  const projectRootDir = path.dirname(filename);
  const publicDir = path.join(projectRootDir, "public");
  const storageRootDir = resolveStorageRootDir(env);
  const dataDir = path.join(storageRootDir, "data");
  const reportsDir = path.join(storageRootDir, "reports");
  const sensorTowerHumanDir = path.join(storageRootDir, "sensor");
  const localOutputDir = path.join(storageRootDir, "output");
  const localTmpDir = path.join(storageRootDir, ".tmp");
  const localToolsDir = path.join(storageRootDir, ".tools");
  const jobsDir = path.join(dataDir, "jobs");

  return {
    paths: {
      projectRootDir,
      publicDir,
      storageRootDir,
      dataDir,
      reportsDir,
      sensorTowerHumanDir,
      localOutputDir,
      localTmpDir,
      localToolsDir,
      jobsDir,
      articleBundlesDir: path.join(dataDir, "article-bundles"),
      resultsFile: path.join(dataDir, "results.json"),
      articlesFile: path.join(dataDir, "articles.json"),
      articleAppLinksFile: path.join(dataDir, "article-app-links.json"),
      appsFile: path.join(dataDir, "apps.json"),
      appMetricsFile: path.join(dataDir, "app-metrics.json"),
      appPaywallsFile: path.join(dataDir, "app-paywalls.json"),
      adShotsFile: path.join(dataDir, "ad-shots.json"),
      adShotProjectsFile: path.join(dataDir, "ad-shot-projects.json"),
      adShotCandidatesFile: path.join(dataDir, "ad-shot-candidates.json"),
      adShotSubscriptionsFile: path.join(dataDir, "ad-shot-subscriptions.json"),
      adShotSubscriptionLogsFile: path.join(dataDir, "ad-shot-subscription-logs.json"),
      pluginDebugLogFile: path.join(dataDir, "plugin-debug.log"),
      adShotAssetsDir: path.join(dataDir, "ad-shots"),
      sensorTowerCsvDir: path.join(dataDir, "sensortower-csv"),
      tiktokCommentsMediaDir: path.join(dataDir, "tiktok-comments-media"),
      sensorTowerCsvFile: path.join(dataDir, "sensortower-csv.json"),
      tiktokCommentsFile: path.join(dataDir, "tiktok-comments.json"),
      videoJobsFile: path.join(dataDir, "video-jobs.json"),
      conversionErrorsFile: path.join(dataDir, "conversion-errors.jsonl"),
      pythonRunner: path.join(projectRootDir, "scripts", "transcribe_translate.py"),
      visualOcrRunner: path.join(projectRootDir, "scripts", "extract_visual_text_ocr.py"),
      photoRunner: path.join(projectRootDir, "scripts", "process_tiktok_photo.py"),
      articleRunner: path.join(projectRootDir, "scripts", "extract_article_bundle.mjs"),
      qiaomuBaseUrl: env.QIAOMU_BASE_URL || "http://localhost:4000"
    },
    port: Number(env.PORT || 3000),
    binaries: {
      codexBin: env.TT2TEXT_CODEX_BIN || "codex",
      ocrPythonBin: env.TT2TEXT_OCR_PYTHON || "python3.12"
    },
    progress: {
      pythonProgressPrefix: "__TT2TEXT_PROGRESS__"
    },
    timeouts: {
      videoConversionTimeoutMs: Number(env.TT2TEXT_VIDEO_CONVERSION_TIMEOUT_MS || 20 * 60 * 1000),
      codexRelevanceTimeoutMs: Number(env.TT2TEXT_CODEX_RELEVANCE_TIMEOUT_MS || 90 * 1000),
      visualOcrTimeoutMs: Number(env.TT2TEXT_VISUAL_OCR_TIMEOUT_MS || 8 * 60 * 1000)
    },
    videoStageMeta: {
      queued: { label: "排队等待", progress: 0 },
      download: { label: "下载视频", progress: 20 },
      detect_language: { label: "识别语言", progress: 34 },
      transcribe: { label: "音频转写", progress: 52 },
      visual: { label: "画面理解", progress: 66 },
      translate: { label: "翻译中文", progress: 76 },
      finalize: { label: "整理结果", progress: 92 },
      completed: { label: "转换完成", progress: 100 }
    }
  };
}

function resolveStorageRootDir(env = process.env) {
  const explicit = env.TT2TEXT_STORAGE_DIR || env.TT2TEXT_DATA_ROOT || env.TT2TEXT_HOME;
  if (explicit) {
    return path.resolve(expandHome(explicit));
  }

  if (env.TT2TEXT_DATA_DIR) {
    return path.resolve(expandHome(env.TT2TEXT_DATA_DIR), "..");
  }

  return path.join(os.homedir(), "Library", "Application Support", "TT2Text");
}

function expandHome(value) {
  const text = String(value || "").trim();
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}
