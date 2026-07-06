import {
  createBootstrapService
} from "./bootstrap-service.mjs";

export function createBootstrapServices(deps = {}) {
  const requiredDeps = [
    "runtimeConfig",
    "ensureDir",
    "ensureFile",
    "readVideoJobs",
    "writeVideoJobs",
    "processVideoQueue",
    "formatDate",
    "defaultAdShotProjects",
    "recoverInterruptedAdShotAnalyses"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createBootstrapServices 缺少依赖：${dep}`);
    }
  }

  const {
    runtimeConfig,
    ensureDir,
    ensureFile,
    readVideoJobs,
    writeVideoJobs,
    processVideoQueue,
    formatDate,
    defaultAdShotProjects,
    recoverInterruptedAdShotAnalyses
  } = deps;
  const {
    publicDir,
    dataDir,
    jobsDir,
    articleBundlesDir,
    adShotAssetsDir,
    sensorTowerCsvDir,
    tiktokCommentsMediaDir,
    sensorTowerHumanDir,
    resultsFile,
    articlesFile,
    articleAppLinksFile,
    appsFile,
    appMetricsFile,
    appPaywallsFile,
    adShotsFile,
    adShotProjectsFile,
    adShotCandidatesFile,
    adShotSubscriptionsFile,
    adShotSubscriptionLogsFile,
    pluginDebugLogFile,
    sensorTowerCsvFile,
    tiktokCommentsFile,
    videoJobsFile
  } = runtimeConfig.paths;

  const bootstrapService = createBootstrapService({
    readVideoJobs,
    writeVideoJobs,
    processVideoQueue,
    formatDate,
    ensureDir,
    ensureFile,
    dirs: {
      public: publicDir,
      data: dataDir,
      jobs: jobsDir,
      articleBundles: articleBundlesDir,
      sensorTowerCsv: sensorTowerCsvDir,
      tiktokCommentsMedia: tiktokCommentsMediaDir,
      sensorTowerHuman: sensorTowerHumanDir,
      adShotAssets: adShotAssetsDir
    },
    files: {
      results: resultsFile,
      articles: articlesFile,
      articleAppLinks: articleAppLinksFile,
      apps: appsFile,
      appMetrics: appMetricsFile,
      appPaywalls: appPaywallsFile,
      adShots: adShotsFile,
      adShotProjects: adShotProjectsFile,
      adShotCandidates: adShotCandidatesFile,
      adShotSubscriptions: adShotSubscriptionsFile,
      adShotSubscriptionLogs: adShotSubscriptionLogsFile,
      pluginDebugLog: pluginDebugLogFile,
      sensorTowerCsv: sensorTowerCsvFile,
      tiktokComments: tiktokCommentsFile,
      videoJobs: videoJobsFile
    }
  });
  const { bootstrapStorage } = bootstrapService;

  async function bootstrap() {
    await bootstrapStorage({
      defaultAdShotProjects,
      recoverInterruptedAdShotAnalyses
    });
  }

  return {
    bootstrap
  };
}
