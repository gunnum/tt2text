import {
  createAdShotAnalysisService
} from "./analysis-queue.mjs";
import {
  createAdShotAppMatchService
} from "./app-match-service.mjs";
import {
  createAdShotCandidateService
} from "./candidate-service.mjs";
import {
  createAdShotImportService
} from "./import-service.mjs";

export function createAdShotAnalysisImportServices(deps = {}) {
  const requiredDeps = [
    "paths",
    "appDeps",
    "analysisDeps",
    "coreDeps",
    "ensureDir",
    "normalizeStringArray",
    "normalizeText",
    "truncateText",
    "normalizeToPublicPath",
    "resolveProjectPublicPath",
    "uniqueStrings",
    "createJobId",
    "formatDate"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAdShotAnalysisImportServices 缺少依赖：${dep}`);
    }
  }

  const {
    paths,
    appDeps,
    analysisDeps,
    coreDeps,
    ensureDir,
    normalizeStringArray,
    normalizeText,
    truncateText,
    normalizeToPublicPath,
    resolveProjectPublicPath,
    uniqueStrings,
    createJobId,
    formatDate,
    logger = console
  } = deps;
  const {
    projectRootDir,
    adShotAssetsDir
  } = paths;
  const {
    readApps,
    writeApps,
    matchAppByName,
    addAppFromStoreSearch,
    pickResultAppFields,
    normalizeAppDisplayName
  } = appDeps;
  const {
    runPhotoConversion,
    runPythonConversion,
    runVisualOcrExtraction,
    findJobVideoFile,
    buildAdShotAnalysis,
    analysisProviders,
    normalizeTikTokEngagement,
    normalizeVisualTextSegments,
    mergeVisualTextSegmentsWithOcr
  } = analysisDeps;
  const {
    readAdShots,
    writeAdShots,
    readAdShotById,
    readAdShotProjects,
    readAdShotCandidates,
    writeAdShotCandidates,
    normalizeAdShotRecord
  } = coreDeps;

  const adShotAnalysisService = createAdShotAnalysisService({
    readAdShots,
    writeAdShots,
    readAdShotById,
    ensureDir,
    runPhotoConversion,
    runPythonConversion,
    runVisualOcrExtraction,
    findJobVideoFile,
    buildAdShotAnalysis,
    analysisProviders,
    normalizeVisualTextSegments,
    mergeVisualTextSegmentsWithOcr,
    normalizeToPublicPath,
    resolveProjectPublicPath,
    adShotAssetsDir,
    formatDate,
    logger
  });
  const { analyzeAdShot } = adShotAnalysisService;

  const adShotAppMatchService = createAdShotAppMatchService({
    readApps,
    matchAppByName,
    addAppFromStoreSearch,
    pickResultAppFields,
    normalizeAppDisplayName,
    normalizeText,
    uniqueStrings
  });
  const { resolveAdShotAppMatch } = adShotAppMatchService;

  const adShotImportService = createAdShotImportService({
    readAdShots,
    writeAdShots,
    readAdShotProjects,
    readAdShotCandidates,
    writeAdShotCandidates,
    readApps,
    writeApps,
    pickResultAppFields,
    resolveAdShotAppMatch,
    ensureDir,
    createJobId,
    normalizeAdShotRecord,
    normalizeVisualTextSegments,
    normalizeToPublicPath,
    normalizeTikTokEngagement,
    normalizeStringArray,
    normalizeText,
    formatDate,
    adShotAssetsDir,
    projectRootDir,
    logger
  });
  const { importAdShot } = adShotImportService;

  const adShotCandidateService = createAdShotCandidateService({
    readAdShots,
    readAdShotProjects,
    readAdShotCandidates,
    writeAdShotCandidates,
    createJobId,
    normalizeStringArray,
    normalizeText,
    formatDate
  });
  const { importAdShotCandidates } = adShotCandidateService;

  return {
    recoverInterruptedAdShotAnalyses: () => adShotAnalysisService.recoverInterruptedAdShotAnalyses(),
    scanAndRequeueAnomalousAdShotAnalyses: (options) => adShotAnalysisService.scanAndRequeueAnomalousAdShotAnalyses(options),
    routeDeps: {
      resolveAdShotAppMatch,
      importAdShot,
      analyzeAdShot,
      importAdShotCandidates,
      scanAndRequeueAnomalousAdShotAnalyses: (options) => adShotAnalysisService.scanAndRequeueAnomalousAdShotAnalyses(options)
    }
  };
}
