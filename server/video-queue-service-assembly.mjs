import {
  createVideoConversionService
} from "./video-conversion-service.mjs";
import {
  createVideoJobService
} from "./video-job-service.mjs";
import {
  createVideoAnomalyService
} from "./video-anomaly-service.mjs";

export function createVideoQueueServices(deps = {}) {
  const requiredDeps = [
    "runtimeConfig",
    "readResults",
    "writeResults",
    "readVideoJobs",
    "writeVideoJobs",
    "appendConversionErrorLog",
    "appDeps",
    "analysisDeps",
    "createJobId",
    "normalizeVideoUrl",
    "normalizeText",
    "truncateText",
    "normalizeToPublicPath",
    "formatDate",
    "ensureDir"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createVideoQueueServices 缺少依赖：${dep}`);
    }
  }

  const {
    runtimeConfig,
    readResults,
    writeResults,
    readVideoJobs,
    writeVideoJobs,
    appendConversionErrorLog,
    appDeps,
    analysisDeps,
    createJobId,
    normalizeVideoUrl,
    normalizeText,
    truncateText,
    normalizeToPublicPath,
    formatDate,
    ensureDir
  } = deps;
  const requiredAppDeps = [
    "findAppById",
    "pickResultAppFields"
  ];
  for (const dep of requiredAppDeps) {
    if (!appDeps[dep]) {
      throw new Error(`createVideoQueueServices.appDeps 缺少依赖：${dep}`);
    }
  }
  const requiredAnalysisDeps = [
    "runPhotoConversion",
    "runPythonConversion",
    "runVisualOnlyConversion",
    "normalizeVideoSemanticPayload",
    "buildNormalVideoVisualTextAnalysis",
    "buildNormalVideoMaterialAnalysis",
    "findJobVideoFile",
    "mergeTikTokEngagement",
    "normalizeTikTokEngagement",
    "normalizePublishedDate",
    "extractTikTokAuthor",
    "assessVideoRelevance"
  ];
  for (const dep of requiredAnalysisDeps) {
    if (!analysisDeps[dep]) {
      throw new Error(`createVideoQueueServices.analysisDeps 缺少依赖：${dep}`);
    }
  }

  const {
    findAppById,
    pickResultAppFields
  } = appDeps;
  const {
    videoStageMeta,
    paths
  } = runtimeConfig;
  const {
    jobsDir
  } = paths;

  let videoConversionService;
  function processVideoQueue() {
    if (videoConversionService) {
      videoConversionService.processVideoQueue();
    }
  }

  const videoJobService = createVideoJobService({
    readVideoJobs,
    writeVideoJobs,
    readResults,
    normalizeVideoUrl,
    formatDate,
    stageMeta: videoStageMeta,
    processVideoQueue
  });
  const {
    readVideoJobsForApi,
    buildStageHistoryEntry,
    markVideoJobStage,
    updateVideoJob,
    retryVideoJob,
    retryFailedVideoJobs,
    ignoreFailedVideoJobs
  } = videoJobService;

  videoConversionService = createVideoConversionService({
    findAppById,
    pickResultAppFields,
    createJobId,
    normalizeVideoUrl,
    normalizeText,
    truncateText,
    normalizeTikTokEngagement: analysisDeps.normalizeTikTokEngagement,
    normalizePublishedDate: analysisDeps.normalizePublishedDate,
    extractTikTokAuthor: analysisDeps.extractTikTokAuthor,
    formatDate,
    normalizeToPublicPath,
    jobsDir,
    stageMeta: videoStageMeta,
    readVideoJobs,
    writeVideoJobs,
    readResults,
    writeResults,
    buildStageHistoryEntry,
    updateVideoJob,
    markVideoJobStage,
    runPhotoConversion: analysisDeps.runPhotoConversion,
    runPythonConversion: analysisDeps.runPythonConversion,
    runVisualOnlyConversion: analysisDeps.runVisualOnlyConversion,
    ensureDir,
    normalizeVideoSemanticPayload: analysisDeps.normalizeVideoSemanticPayload,
    buildNormalVideoVisualTextAnalysis: analysisDeps.buildNormalVideoVisualTextAnalysis,
    buildNormalVideoMaterialAnalysis: analysisDeps.buildNormalVideoMaterialAnalysis,
    findJobVideoFile: analysisDeps.findJobVideoFile,
    mergeTikTokEngagement: analysisDeps.mergeTikTokEngagement,
    assessVideoRelevance: analysisDeps.assessVideoRelevance,
    appendConversionErrorLog
  });
  const {
    enqueueVideoConversion,
    enqueueVideoBatch,
    refreshResultVisualUnderstanding
  } = videoConversionService;

  const videoAnomalyService = createVideoAnomalyService({
    readVideoJobs,
    writeVideoJobs,
    readResults,
    enqueueVideoConversion,
    processVideoQueue,
    buildStageHistoryEntry,
    normalizeVideoUrl,
    normalizeText,
    formatDate,
    stageMeta: videoStageMeta
  });
  const {
    scanAndRequeueAnomalousNormalVideos
  } = videoAnomalyService;

  return {
    processVideoQueue,
    scanAndRequeueAnomalousNormalVideos,
    routeDeps: {
      readVideoJobsForApi,
      enqueueVideoConversion,
      enqueueVideoBatch,
      retryVideoJob,
      retryFailedVideoJobs,
      ignoreFailedVideoJobs,
      refreshResultVisualUnderstanding,
      scanAndRequeueAnomalousNormalVideos
    }
  };
}
