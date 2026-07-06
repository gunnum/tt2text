import {
  createVideoAnalysisServices
} from "./video-analysis-service-assembly.mjs";
import {
  createVideoQueueServices
} from "./video-queue-service-assembly.mjs";

export function createVideoServices(deps = {}) {
  const requiredDeps = [
    "runtimeConfig",
    "readResults",
    "writeResults",
    "readVideoJobs",
    "writeVideoJobs",
    "readTikTokCommentsRaw",
    "writeTikTokComments",
    "appendConversionErrorLog",
    "appDeps",
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
      throw new Error(`createVideoServices 缺少依赖：${dep}`);
    }
  }

  const {
    runtimeConfig,
    readResults,
    writeResults,
    readVideoJobs,
    writeVideoJobs,
    readTikTokCommentsRaw,
    writeTikTokComments,
    readAdShots,
    writeAdShots,
    appendConversionErrorLog,
    appDeps,
    createJobId,
    normalizeVideoUrl,
    normalizeText,
    truncateText,
    normalizeToPublicPath,
    formatDate,
    ensureDir,
  } = deps;
  const videoAnalysisServices = createVideoAnalysisServices({
    runtimeConfig,
    readResults,
    writeResults,
    readTikTokCommentsRaw,
    writeTikTokComments,
    readAdShots,
    writeAdShots,
    createJobId,
    normalizeVideoUrl,
    normalizeText,
    truncateText,
    normalizeToPublicPath,
    formatDate,
    ensureDir
  });
  const videoQueueServices = createVideoQueueServices({
    runtimeConfig,
    readResults,
    writeResults,
    readVideoJobs,
    writeVideoJobs,
    appendConversionErrorLog,
    appDeps,
    analysisDeps: videoAnalysisServices.analysisDeps,
    createJobId,
    normalizeVideoUrl,
    normalizeText,
    truncateText,
    normalizeToPublicPath,
    formatDate,
    ensureDir
  });

  return {
    processVideoQueue: videoQueueServices.processVideoQueue,
    scanAndRequeueAnomalousNormalVideos: videoQueueServices.scanAndRequeueAnomalousNormalVideos,
    analysisDeps: videoAnalysisServices.analysisDeps,
    routeDeps: {
      ...videoAnalysisServices.routeDeps,
      ...videoQueueServices.routeDeps
    }
  };
}
