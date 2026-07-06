import {
  createAppService
} from "./app-service.mjs";
import {
  createSensorTowerService
} from "./sensortower-service.mjs";

export function createAppCatalogServices(deps = {}) {
  const requiredDeps = [
    "readApps",
    "writeApps",
    "normalizeStringArray",
    "normalizeText",
    "truncateText",
    "formatDate"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAppCatalogServices 缺少依赖：${dep}`);
    }
  }

  const {
    readApps,
    writeApps,
    normalizeStringArray,
    normalizeText,
    truncateText,
    formatDate
  } = deps;

  const sensorTowerService = createSensorTowerService({
    normalizeText,
    truncateText,
    normalizeStringArray
  });
  const {
    matchAppByName,
    normalizeAppNameForMatch,
    normalizeAppDisplayName
  } = sensorTowerService;

  const appService = createAppService({
    readApps,
    writeApps,
    formatDate,
    normalizeAppNameForMatch,
    normalizeAppDisplayName
  });
  const {
    addAppFromStoreUrl,
    addAppFromStoreId,
    addAppFromStoreSearch,
    findAppById,
    updateAppCategories,
    pickResultAppFields,
    refreshAppStoreMediaForApp
  } = appService;

  return {
    appDeps: {
      readApps,
      writeApps,
      findAppById,
      pickResultAppFields,
      matchAppByName,
      addAppFromStoreId,
      addAppFromStoreSearch,
      refreshAppStoreMediaForApp,
      normalizeAppDisplayName
    },
    routeDeps: {
      readApps,
      addAppFromStoreUrl,
      refreshAppStoreMediaForApp,
      updateAppCategories
    }
  };
}
