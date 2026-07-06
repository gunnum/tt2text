import {
  createRouteHandlerFactory,
  exactPath,
  sendJson,
  withRequiredString,
  withRouteBody,
  withStringIdList
} from "./route-utils.mjs";

export const appRouteDeps = [
  "readApps",
  "readAppMetrics",
  "readSensorTowerCsvImports",
  "getAppDashboardSummary",
  "findPaywallScreensForApp",
  "getAgentStatus",
  "addAppFromStoreUrl",
  "refreshAppStoreMediaForApp",
  "updateAppCategories",
  "fetchQiaomuReviewInsights",
  "deleteApp",
  "importAppMetrics",
  "importSensorTowerCsvFromPath",
  "importSensorTowerCsvFromContent",
  "deleteAppMetrics",
  "appendPluginDebugLog",
  "readPluginDebugLogs",
  "clearPluginDebugLogs"
];

export const createAppRoutes = createRouteHandlerFactory("createAppRoutes", appRouteDeps, (deps) => {
  const {
    readApps,
    readAppMetrics,
    readSensorTowerCsvImports,
    getAppDashboardSummary,
    findPaywallScreensForApp,
    getAgentStatus,
    addAppFromStoreUrl,
    refreshAppStoreMediaForApp,
    updateAppCategories,
    fetchQiaomuReviewInsights,
    deleteApp,
    importAppMetrics,
    importSensorTowerCsvFromPath,
    importSensorTowerCsvFromContent,
    deleteAppMetrics,
    appendPluginDebugLog,
    readPluginDebugLogs,
    clearPluginDebugLogs
  } = deps;

  return [
    {
      method: "GET",
      match: exactPath("/api/apps"),
      handle: async ({ res }) => sendJson(res, 200, await readApps())
    },
    {
      method: "GET",
      match: exactPath("/api/app-metrics"),
      handle: async ({ res }) => sendJson(res, 200, await readAppMetrics())
    },
    {
      method: "GET",
      match: exactPath("/api/apps/dashboard"),
      handle: async ({ res, url }) => {
        const appId = normalizeText(url.searchParams.get("appId"));
        if (!appId) {
          return sendJson(res, 400, { error: "缺少 App ID。" });
        }
        return sendJson(res, 200, await getAppDashboardSummary(appId));
      }
    },
    {
      method: "GET",
      match: exactPath("/api/sensortower-csv/imports"),
      handle: async ({ res }) => sendJson(res, 200, await readSensorTowerCsvImports())
    },
    {
      method: "GET",
      match: exactPath("/api/sensortower-csv/latest"),
      handle: async ({ res, url }) => {
        const appId = normalizeLookupText(url.searchParams.get("appId"));
        const appName = normalizeLookupText(url.searchParams.get("appName"));
        const dataType = normalizeLookupText(url.searchParams.get("dataType"));
        const imports = await readSensorTowerCsvImports();
        const logs = await readPluginDebugLogs();
        const matchedImports = imports.filter((item) => matchesSensorTowerLookup(item, { appId, appName, dataType }));
        const latestSuccess = matchedImports[0] || null;
        const latestFailure = [...logs]
          .reverse()
          .find((item) => item?.scope === "popup" && item?.event === "task:error" && item?.detail?.mode === "sensortower")
          || [...logs].reverse().find((item) => item?.scope === "background" && item?.event === "message:sensortower:error")
          || null;
        return sendJson(res, 200, {
          latestSuccess: latestSuccess ? pickLatestCsvImport(latestSuccess) : null,
          latestFailure: latestFailure ? pickLatestFailure(latestFailure) : null
        });
      }
    },
    {
      method: "GET",
      match: exactPath("/api/agent/status"),
      handle: async ({ res }) => sendJson(res, 200, await getAgentStatus())
    },
    {
      method: "GET",
      match: exactPath("/api/plugin-debug-logs"),
      handle: async ({ res }) => sendJson(res, 200, await readPluginDebugLogs())
    },
    {
      method: "GET",
      match: exactPath("/api/apps/review-insights"),
      handle: async ({ res, url }) => {
        const apps = await readApps();
        const appStoreId = await resolveAppStoreId({
          apps,
          appId: url.searchParams.get("appId"),
          appStoreId: url.searchParams.get("appStoreId")
        });
        if (!appStoreId) {
          return sendJson(res, 400, { error: "缺少 App Store ID。" });
        }
        const app = apps.find((item) => String(item?.id || "").trim() === appStoreId) || null;
        const payload = await fetchQiaomuReviewInsights(appStoreId, {
          max: url.searchParams.get("max"),
          app
        });
        return sendJson(res, 200, payload);
      }
    },
    {
      method: "POST",
      match: exactPath("/api/apps/paywalls/find"),
      handle: withRouteBody(
        withRequiredString("appId", "缺少 App ID。", async ({ res, appId, body }) => {
          const apps = await readApps();
          const app = apps.find((item) => normalizeText(item.id) === normalizeText(appId));
          if (!app) {
            return sendJson(res, 404, { error: "没有找到这个 App。" });
          }
          const record = await findPaywallScreensForApp(app, { refresh: Boolean(body.refresh) });
          return sendJson(res, 200, record);
        })
      )
    },
    {
      method: "POST",
      match: exactPath("/api/apps"),
      handle: withRouteBody(
        withRequiredString("url", "缺少 App Store 链接。", async ({ res, appUrl }) => {
          const app = await addAppFromStoreUrl(appUrl);
          return sendJson(res, 200, app);
        }, { trim: true, as: "appUrl" })
      )
    },
    {
      method: "POST",
      match: exactPath("/api/apps/appstore-media/refresh"),
      handle: withRouteBody(
        withRequiredString("appId", "缺少 App ID。", async ({ res, appId }) => {
          const app = await refreshAppStoreMediaForApp(appId);
          return sendJson(res, 200, app);
        })
      )
    },
    {
      method: "POST",
      match: exactPath("/api/apps/delete"),
      handle: withRouteBody(
        withRequiredString("id", "缺少 App ID。", async ({ res, id, body }) => {
          const payload = await deleteApp(id, Boolean(body.deleteRelated));
          return sendJson(res, 200, payload);
        })
      )
    },
    {
      method: "POST",
      match: exactPath("/api/apps/categories"),
      handle: withRouteBody(
        withRequiredString("id", "缺少 App ID。", async ({ res, id, body }) => {
          const app = await updateAppCategories(id, body.categories);
          return sendJson(res, 200, app);
        })
      )
    },
    {
      method: "POST",
      match: exactPath("/api/app-metrics/import"),
      handle: withRouteBody(async ({ res, body }) => {
        const record = await importAppMetrics(body);
        return sendJson(res, 200, record);
      })
    },
    {
      method: "POST",
      match: exactPath("/api/plugin-debug-logs"),
      handle: withRouteBody(async ({ res, body }) => {
        const record = await appendPluginDebugLog(body);
        return sendJson(res, 200, record);
      })
    },
    {
      method: "POST",
      match: exactPath("/api/plugin-debug-logs/clear"),
      handle: withRouteBody(async ({ res }) => {
        const record = await clearPluginDebugLogs();
        return sendJson(res, 200, record);
      })
    },
    {
      method: "POST",
      match: exactPath("/api/sensortower-csv/import-path"),
      handle: withRouteBody(async ({ res, body }) => {
        const record = await importSensorTowerCsvFromPath(body);
        return sendJson(res, 200, record);
      })
    },
    {
      method: "POST",
      match: exactPath("/api/sensortower-csv/import-content"),
      handle: withRouteBody(async ({ res, body }) => {
        const record = await importSensorTowerCsvFromContent(body);
        return sendJson(res, 200, record);
      })
    },
    {
      method: "POST",
      match: exactPath("/api/app-metrics/delete"),
      handle: withRouteBody(
        withStringIdList(async ({ res, ids }) => {
          const payload = await deleteAppMetrics(ids);
          return sendJson(res, 200, payload);
        })
      )
    }
  ];
});

function normalizeLookupText(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesSensorTowerLookup(item, { appId, appName, dataType }) {
  if (dataType && normalizeLookupText(item?.dataType) !== dataType) {
    return false;
  }
  if (appId && String(item?.appId || "").trim().toLowerCase() === appId) {
    return true;
  }
  if (!appName) {
    return true;
  }
  const candidate = normalizeLookupText(item?.app?.name || item?.appName);
  return candidate === appName || candidate.includes(appName) || appName.includes(candidate);
}

function pickLatestCsvImport(item) {
  return {
    id: item.id,
    appId: item.appId || "",
    appName: item.app?.name || item.appName || "",
    dataType: item.dataType || "",
    chartLabel: item.chartLabel || "",
    os: item.filters?.os || "",
    rowCount: item.rowCount || 0,
    importedAt: item.importedAt || "",
    csvPath: item.csvPath || ""
  };
}

function pickLatestFailure(item) {
  return {
    at: item.receivedAt || item.at || "",
    error: item.detail?.error || "",
    event: item.event || ""
  };
}

async function resolveAppStoreId({ apps, appId, appStoreId }) {
  const direct = normalizeText(appStoreId);
  if (direct) {
    return direct;
  }
  const id = normalizeText(appId);
  if (!id) {
    return "";
  }
  const app = apps.find((item) => item.id === id);
  return normalizeText(app?.id);
}

function normalizeText(value) {
  return String(value || "").trim();
}
