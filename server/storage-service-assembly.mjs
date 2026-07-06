import {
  createDataStoreService
} from "./data-store-service.mjs";
import {
  createFilesystemService
} from "./filesystem-service.mjs";
import {
  createJsonFileService
} from "./json-file-service.mjs";

export function createStorageServices(deps = {}) {
  const requiredDeps = [
    "runtimeConfig",
    "formatDate"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createStorageServices 缺少依赖：${dep}`);
    }
  }

  const {
    runtimeConfig,
    formatDate,
    logger = console
  } = deps;
  const {
    resultsFile,
    articlesFile,
    articleAppLinksFile,
    appsFile,
    appMetricsFile,
    appPaywallsFile,
    sensorTowerCsvFile,
    tiktokCommentsFile,
    videoJobsFile,
    conversionErrorsFile
  } = runtimeConfig.paths;

  const filesystemService = createFilesystemService();
  const {
    ensureDir,
    ensureFile
  } = filesystemService;
  const jsonFileService = createJsonFileService({ logger });
  const {
    readJsonArrayFile,
    writeJsonFileAtomic
  } = jsonFileService;
  const dataStoreService = createDataStoreService({
    readJsonArrayFile,
    writeJsonFileAtomic,
    formatDate,
    files: {
      results: resultsFile,
      tiktokComments: tiktokCommentsFile,
      videoJobs: videoJobsFile,
      articles: articlesFile,
      articleAppLinks: articleAppLinksFile,
      apps: appsFile,
      appMetrics: appMetricsFile,
      appPaywalls: appPaywallsFile,
      sensorTowerCsv: sensorTowerCsvFile,
      conversionErrors: conversionErrorsFile
    }
  });

  return {
    fsDeps: {
      ensureDir,
      ensureFile
    },
    jsonDeps: {
      readJsonArrayFile,
      writeJsonFileAtomic
    },
    dataStoreDeps: dataStoreService
  };
}
