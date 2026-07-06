import {
  createSensorTowerImportService
} from "./sensortower-import-service.mjs";
import {
  createSensorTowerService
} from "./sensortower-service.mjs";
import {
  renderSensorTowerOverviewHtml
} from "./sensortower-overview-renderer.mjs";

export function createSensorTowerServices(deps = {}) {
  const requiredDeps = [
    "runtimeConfig",
    "appDeps",
    "readAppMetrics",
    "writeAppMetrics",
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
      throw new Error(`createSensorTowerServices 缺少依赖：${dep}`);
    }
  }

  const {
    runtimeConfig,
    appDeps,
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
    safeFilename
  } = deps;
  const requiredAppDeps = [
    "readApps",
    "addAppFromStoreId",
    "addAppFromStoreSearch",
    "pickResultAppFields",
    "matchAppByName"
  ];
  for (const dep of requiredAppDeps) {
    if (!appDeps[dep]) {
      throw new Error(`createSensorTowerServices.appDeps 缺少依赖：${dep}`);
    }
  }

  const {
    sensorTowerHumanDir
  } = runtimeConfig.paths;
  const sensorTowerService = createSensorTowerService({
    normalizeText,
    truncateText,
    normalizeStringArray
  });
  const {
    parseSensorTowerUrl,
    decodeCsvBuffer,
    parseCsvPreview,
    parseCsvRows,
    serializeCsvRows,
    extractAppStoreIdFromSensorTowerUrl,
    normalizeMetricItems,
    normalizeTables,
    normalizeSensorTowerOverview,
    sanitizeMetricRawPayload
  } = sensorTowerService;

  const sensorTowerImportService = createSensorTowerImportService({
    readApps: appDeps.readApps,
    readAppMetrics,
    writeAppMetrics,
    readCsvImports: readSensorTowerCsvImports,
    writeCsvImports: writeSensorTowerCsvImports,
    addAppFromStoreId: appDeps.addAppFromStoreId,
    addAppFromStoreSearch: appDeps.addAppFromStoreSearch,
    pickResultAppFields: appDeps.pickResultAppFields,
    matchAppByName: appDeps.matchAppByName,
    extractAppStoreIdFromSensorTowerUrl,
    parseSensorTowerUrl,
    decodeCsvBuffer,
    parseCsvPreview,
    parseCsvRows,
    serializeCsvRows,
    normalizeSensorTowerOverview,
    normalizeMetricItems,
    normalizeTables,
    sanitizeMetricRawPayload,
    normalizeStringArray,
    normalizeText,
    truncateText,
    createJobId,
    formatDate,
    ensureDir,
    normalizeToPublicPath,
    safePathSegment,
    safeFilename,
    renderSensorTowerOverviewHtml,
    sensorTowerHumanDir
  });
  const {
    importAppMetrics,
    importSensorTowerCsvFromPath,
    importSensorTowerCsvFromContent
  } = sensorTowerImportService;

  return {
    routeDeps: {
      readAppMetrics,
      readSensorTowerCsvImports,
      importAppMetrics,
      importSensorTowerCsvFromPath,
      importSensorTowerCsvFromContent
    }
  };
}
