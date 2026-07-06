import {
  createAgentServices
} from "./agent-service-assembly.mjs";
import {
  createAppServices
} from "./app-service-assembly.mjs";
import {
  createArticleServices
} from "./article-service-assembly.mjs";
import {
  createBootstrapServices
} from "./bootstrap-service-assembly.mjs";
import {
  createMaintenanceServices
} from "./maintenance-service-assembly.mjs";
import {
  createReviewInsightsService
} from "./review-insights-service.mjs";
import {
  createReportOutputService
} from "./report-output-service.mjs";
import {
  createVerticalVideoReportService
} from "./vertical-video-report-service.mjs";
import {
  createCodexJsonService
} from "./codex-json-service.mjs";
import {
  createStorageServices
} from "./storage-service-assembly.mjs";
import {
  createServerUtils
} from "./server-utils.mjs";
import {
  createVideoServices
} from "./video-service-assembly.mjs";
import {
  createAdShotServices
} from "./ad-shots/service-assembly.mjs";

export function createApplicationServices({
  runtimeConfig,
  env = process.env,
  logger = console
} = {}) {
  if (!runtimeConfig) {
    throw new Error("createApplicationServices 缺少依赖：runtimeConfig");
  }

  const { paths } = runtimeConfig;
  const {
    projectRootDir,
    publicDir,
    storageRootDir,
    reportsDir
  } = paths;
  const codexJsonService = createCodexJsonService({
    codexBin: runtimeConfig.binaries.codexBin,
    projectRootDir,
    env
  });

  const serverUtils = createServerUtils({ projectRootDir, storageRootDir, publicDir });
  const {
    uniqueStrings,
    normalizeStringArray,
    truncateText,
    normalizeText,
    createJobId,
    normalizeToPublicPath,
    resolveProjectPublicPath,
    resolvePublicPathToFile,
    safePathSegment,
    safeFilename,
    formatChinaDate,
    normalizeVideoUrl,
    normalizeSourceUrl,
    slugifyId
  } = serverUtils;
  const storageServices = createStorageServices({
    runtimeConfig,
    formatDate: formatChinaDate,
    logger
  });
  const {
    fsDeps,
    jsonDeps,
    dataStoreDeps
  } = storageServices;
  const {
    ensureDir,
    ensureFile
  } = fsDeps;
  const {
    readJsonArrayFile,
    writeJsonFileAtomic
  } = jsonDeps;
  const {
    readResults,
    writeResults,
    readTikTokCommentsRaw,
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
  } = dataStoreDeps;
  const agentServices = createAgentServices({
    runtimeConfig,
    env
  });
  const appServices = createAppServices({
    runtimeConfig,
    readApps,
    writeApps,
    readAppMetrics,
    writeAppMetrics,
    readAppPaywalls,
    writeAppPaywalls,
    readSensorTowerCsvImports,
    writeSensorTowerCsvImports,
    normalizeStringArray,
    normalizeText,
    truncateText,
    createJobId,
    formatDate: formatChinaDate,
    ensureDir,
    normalizeToPublicPath,
    resolvePublicPathToFile,
    safePathSegment,
    safeFilename
  });
  const {
    appDeps
  } = appServices;
  const articleServices = createArticleServices({
    runtimeConfig,
    env,
    appDeps,
    readArticles,
    writeArticles,
    ensureDir,
    createJobId,
    formatDate: formatChinaDate,
    normalizeToPublicPath,
    truncateText,
    normalizeText,
    normalizeSourceUrl
  });
  const maintenanceServices = createMaintenanceServices({
    runtimeConfig,
    readResults,
    writeResults,
    readArticles,
    writeArticles,
    readAppMetrics,
    writeAppMetrics,
    readApps,
    writeApps,
    readVideoJobs,
    writeVideoJobs,
    normalizeVideoUrl,
    normalizeSourceUrl
  });
  const readAdShotsForComments = () => readJsonArrayFile(paths.adShotsFile);
  const writeAdShotsForComments = (shots) => writeJsonFileAtomic(paths.adShotsFile, shots);
  const videoServices = createVideoServices({
    runtimeConfig,
    env,
    readResults,
    writeResults,
    readVideoJobs,
    writeVideoJobs,
    readTikTokCommentsRaw,
    writeTikTokComments,
    readAdShots: readAdShotsForComments,
    writeAdShots: writeAdShotsForComments,
    appendConversionErrorLog,
    appDeps,
    createJobId,
    normalizeVideoUrl,
    normalizeText,
    truncateText,
    normalizeToPublicPath,
    formatDate: formatChinaDate,
    ensureDir
  });
  const adShotServices = createAdShotServices({
    paths,
    readJsonArrayFile,
    writeJsonFileAtomic,
    appDeps,
    ensureDir,
    analysisDeps: videoServices.analysisDeps,
    normalizeStringArray,
    normalizeText,
    truncateText,
    normalizeToPublicPath,
    resolveProjectPublicPath,
    uniqueStrings,
    slugifyId,
    createJobId,
    formatDate: formatChinaDate,
    logger
  });
  const reviewInsightsService = createReviewInsightsService({
    qiaomuBaseUrl: runtimeConfig.paths.qiaomuBaseUrl
  });
  const reportOutputService = createReportOutputService({
    projectRootDir,
    reportsDir,
    storageRootDir,
    resolvePublicPathToFile,
    qiaomuBaseUrl: runtimeConfig.paths.qiaomuBaseUrl,
    readApps,
    readArticles,
    readArticleAppLinks,
    readAppMetrics,
    readAppPaywalls,
    readSensorTowerCsvImports,
    readPluginDebugLogs: appServices.routeDeps.readPluginDebugLogs,
    readResults,
    readTikTokCommentsRaw,
    fetchQiaomuReviewInsights: reviewInsightsService.routeDeps.fetchQiaomuReviewInsights,
    normalizeText,
    truncateText
  });
  const verticalVideoReportService = createVerticalVideoReportService({
    projectRootDir,
    reportsDir,
    readAdShots: adShotServices.routeDeps.readAdShots,
    readApps,
    runCodexJsonTask: codexJsonService.runCodexJsonTask,
    codexHighlightTimeoutMs: runtimeConfig.timeouts.codexRelevanceTimeoutMs,
    normalizeText,
    truncateText
  });
  const bootstrapServices = createBootstrapServices({
    runtimeConfig,
    ensureDir,
    ensureFile,
    readVideoJobs,
    writeVideoJobs,
    processVideoQueue: videoServices.processVideoQueue,
    formatDate: formatChinaDate,
    defaultAdShotProjects: adShotServices.defaultAdShotProjects,
    recoverInterruptedAdShotAnalyses: adShotServices.recoverInterruptedAdShotAnalyses
  });
  const normalVideoAnomalyScheduler = createDailyScheduler({
    name: "normal-video-anomaly-analysis",
    enabled: env.TT2TEXT_DISABLE_NORMAL_VIDEO_ANOMALY_CRON !== "1",
    hour: Number(env.TT2TEXT_NORMAL_VIDEO_ANOMALY_CRON_HOUR || 4),
    minute: Number(env.TT2TEXT_NORMAL_VIDEO_ANOMALY_CRON_MINUTE || 20),
    logger,
    task: async () => {
      const result = await videoServices.scanAndRequeueAnomalousNormalVideos?.();
      if (result?.queuedCount) {
        logger.info?.(`普通视频异常分析检查已重新排队 ${result.queuedCount} 条。`);
      }
      return result;
    }
  });

  return {
    bootstrap: async () => {
      await bootstrapServices.bootstrap();
      normalVideoAnomalyScheduler.start();
    },
    routeDeps: {
      projectRootDir,
      publicDir,
      storageRootDir,
      resolvePublicPathToFile,
      readResults,
      ...agentServices.routeDeps,
      ...appServices.routeDeps,
      ...articleServices.routeDeps,
      ...videoServices.routeDeps,
      ...maintenanceServices.routeDeps,
      ...reviewInsightsService.routeDeps,
      ...reportOutputService,
      ...verticalVideoReportService,
      ...adShotServices.routeDeps
    }
  };
}

function createDailyScheduler({
  name,
  enabled = true,
  hour = 4,
  minute = 20,
  task,
  logger = console
} = {}) {
  let timer = null;
  let running = false;
  const normalizedHour = Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.floor(hour))) : 4;
  const normalizedMinute = Number.isFinite(minute) ? Math.min(59, Math.max(0, Math.floor(minute))) : 20;

  const scheduleNext = () => {
    if (!enabled || typeof task !== "function") return;
    const delay = nextDailyDelayMs(normalizedHour, normalizedMinute);
    timer = setTimeout(run, delay);
    timer.unref?.();
  };

  const run = async () => {
    timer = null;
    if (running) {
      scheduleNext();
      return;
    }
    running = true;
    try {
      await task();
    } catch (error) {
      logger.error?.(`${name || "daily-scheduler"} 执行失败：`, error);
    } finally {
      running = false;
      scheduleNext();
    }
  };

  return {
    start() {
      if (timer || !enabled) return;
      scheduleNext();
      logger.info?.(`${name || "daily-scheduler"} 已启用，每天 ${String(normalizedHour).padStart(2, "0")}:${String(normalizedMinute).padStart(2, "0")} 检查。`);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    runNow: run
  };
}

function nextDailyDelayMs(hour, minute) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return Math.max(1_000, next.getTime() - now.getTime());
}
