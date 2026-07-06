import {
  createLibraryMaintenanceService
} from "./library-maintenance-service.mjs";

export function createMaintenanceServices(deps = {}) {
  const requiredDeps = [
    "runtimeConfig",
    "readResults",
    "writeResults",
    "readArticles",
    "writeArticles",
    "readAppMetrics",
    "writeAppMetrics",
    "readApps",
    "writeApps",
    "readVideoJobs",
    "writeVideoJobs",
    "normalizeVideoUrl",
    "normalizeSourceUrl"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createMaintenanceServices 缺少依赖：${dep}`);
    }
  }

  const {
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
  } = deps;
  const {
    jobsDir,
    projectRootDir
  } = runtimeConfig.paths;

  const libraryMaintenanceService = createLibraryMaintenanceService({
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
    normalizeSourceUrl,
    jobsDir,
    projectRootDir
  });
  const {
    deleteResults,
    setResultFavorite,
    deleteArticles,
    deleteAppMetrics,
    deleteApp,
    findDuplicateResult,
    findDuplicateArticle
  } = libraryMaintenanceService;

  return {
    routeDeps: {
      deleteResults,
      setResultFavorite,
      writeResults,
      deleteArticles,
      deleteAppMetrics,
      deleteApp,
      findDuplicateResult,
      findDuplicateArticle
    }
  };
}
