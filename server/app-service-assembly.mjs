import {
  createAppCatalogServices
} from "./app-catalog-service-assembly.mjs";
import {
  createAppDashboardService
} from "./app-dashboard-service.mjs";
import {
  createPaywallScreensService
} from "./paywall-screens-service.mjs";
import {
  createSensorTowerServices
} from "./sensortower-service-assembly.mjs";
import {
  createPluginDebugLogService
} from "./plugin-debug-log-service.mjs";

export function createAppServices(deps = {}) {
  const requiredDeps = [
    "readApps",
    "writeApps",
    "readAppMetrics",
    "writeAppMetrics",
    "readAppPaywalls",
    "writeAppPaywalls",
    "readSensorTowerCsvImports",
    "writeSensorTowerCsvImports",
    "normalizeStringArray",
    "normalizeText",
    "truncateText",
    "createJobId",
    "formatDate",
    "ensureDir",
    "normalizeToPublicPath",
    "safePathSegment",
    "safeFilename"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAppServices 缺少依赖：${dep}`);
    }
  }

  const {
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
    formatDate,
    ensureDir,
    normalizeToPublicPath,
    resolvePublicPathToFile,
    safePathSegment,
    safeFilename
  } = deps;
  const appCatalogServices = createAppCatalogServices({
    readApps,
    writeApps,
    formatDate,
    normalizeStringArray,
    normalizeText,
    truncateText
  });
  const sensorTowerServices = createSensorTowerServices({
    runtimeConfig,
    appDeps: appCatalogServices.appDeps,
    readAppMetrics,
    writeAppMetrics,
    readSensorTowerCsvImports,
    writeSensorTowerCsvImports,
    normalizeStringArray,
    normalizeText,
    truncateText,
    createJobId,
    formatDate,
    ensureDir,
    normalizeToPublicPath,
    safePathSegment,
    safeFilename,
    ensureDir,
    normalizeToPublicPath
  });
  const pluginDebugLogService = createPluginDebugLogService({
    pluginDebugLogFile: runtimeConfig.paths.pluginDebugLogFile,
    formatDate
  });
  const appDashboardService = createAppDashboardService({
    projectRootDir: runtimeConfig.paths.projectRootDir,
    resolvePublicPathToFile,
    readApps,
    readAppMetrics,
    readSensorTowerCsvImports,
    readAppPaywalls,
    normalizeText
  });
  const paywallScreensService = createPaywallScreensService({
    readAppPaywalls,
    writeAppPaywalls,
    normalizeText,
    truncateText,
    formatDate
  });

  return {
    appDeps: appCatalogServices.appDeps,
    routeDeps: {
      ...appCatalogServices.routeDeps,
      ...sensorTowerServices.routeDeps,
      getAppDashboardSummary: appDashboardService.getAppDashboardSummary,
      findPaywallScreensForApp: paywallScreensService.findPaywallScreensForApp,
      appendPluginDebugLog: pluginDebugLogService.appendPluginDebugLog,
      readPluginDebugLogs: pluginDebugLogService.readPluginDebugLogs,
      clearPluginDebugLogs: pluginDebugLogService.clearPluginDebugLogs
    }
  };
}
