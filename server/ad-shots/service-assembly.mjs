import {
  createAdShotAnalysisImportServices
} from "./analysis-import-service-assembly.mjs";
import {
  createAdShotCoreServices
} from "./core-service-assembly.mjs";
import {
  createAdShotDeleteService
} from "./delete-service.mjs";
import {
  createAdShotSubscriptionServices
} from "./subscription-service-assembly.mjs";

export function createAdShotServices(deps = {}) {
  const requiredDeps = [
    "readJsonArrayFile",
    "writeJsonFileAtomic",
    "paths",
    "appDeps",
    "ensureDir",
    "analysisDeps",
    "normalizeStringArray",
    "normalizeText",
    "truncateText",
    "normalizeToPublicPath",
    "resolveProjectPublicPath",
    "uniqueStrings",
    "slugifyId",
    "createJobId",
    "formatDate"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAdShotServices 缺少依赖：${dep}`);
    }
  }

  const {
    paths,
    readJsonArrayFile,
    writeJsonFileAtomic,
    appDeps,
    ensureDir,
    analysisDeps,
    normalizeStringArray,
    normalizeText,
    truncateText,
    normalizeToPublicPath,
    resolveProjectPublicPath,
    uniqueStrings,
    slugifyId,
    createJobId,
    formatDate,
    logger = console
  } = deps;

  const coreServices = createAdShotCoreServices({
    paths,
    readJsonArrayFile,
    writeJsonFileAtomic,
    analysisDeps,
    normalizeStringArray,
    normalizeText,
    truncateText,
    normalizeToPublicPath,
    resolveProjectPublicPath,
    slugifyId,
    createJobId,
    formatDate
  });
  const analysisImportServices = createAdShotAnalysisImportServices({
    paths,
    appDeps,
    analysisDeps,
    coreDeps: coreServices,
    ensureDir,
    normalizeStringArray,
    normalizeText,
    truncateText,
    normalizeToPublicPath,
    resolveProjectPublicPath,
    uniqueStrings,
    createJobId,
    formatDate,
    logger
  });
  const subscriptionServices = createAdShotSubscriptionServices({
    coreDeps: coreServices,
    normalizeText,
    truncateText,
    slugifyId,
    createJobId,
    formatDate
  });
  const deleteService = createAdShotDeleteService({
    readAdShots: coreServices.readAdShots,
    writeAdShots: coreServices.writeAdShots,
    readAdShotById: coreServices.readAdShotById,
    normalizeText,
    adShotAssetsDir: paths.adShotAssetsDir
  });

  return {
    defaultAdShotProjects: coreServices.defaultAdShotProjects,
    recoverInterruptedAdShotAnalyses: analysisImportServices.recoverInterruptedAdShotAnalyses,
    scanAndRequeueAnomalousAdShotAnalyses: analysisImportServices.scanAndRequeueAnomalousAdShotAnalyses,
    routeDeps: {
      readAdShots: coreServices.readAdShots,
      readAdShotById: coreServices.readAdShotById,
      readAdShotProjectsWithStats: coreServices.readAdShotProjectsWithStats,
      readAdShotCandidates: coreServices.readAdShotCandidates,
      assignAdShotProjects: coreServices.assignAdShotProjects,
      saveAdShotProjects: coreServices.saveAdShotProjects,
      deleteAdShot: deleteService.deleteAdShot,
      serveAdShotPage: coreServices.serveAdShotPage,
      ...analysisImportServices.routeDeps,
      ...subscriptionServices.routeDeps
    }
  };
}
