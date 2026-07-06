import {
  createRouteHandlerFactory,
  decodePathSuffix,
  exactPath,
  prefixPath,
  sendJson,
  withRequiredString,
  withRouteBody
} from "./route-utils.mjs";

export const adShotRouteDeps = [
  "readAdShots",
  "readAdShotById",
  "readAdShotProjectsWithStats",
  "readAdShotCandidates",
  "readAdShotSubscriptions",
  "readAdShotSubscriptionLogs",
  "resolveAdShotAppMatch",
  "importAdShot",
  "analyzeAdShot",
  "assignAdShotProjects",
  "deleteAdShot",
  "importAdShotCandidates",
  "saveAdShotProjects",
  "saveAdShotSubscription",
  "deleteAdShotSubscription",
  "appendAdShotSubscriptionLog",
  "serveAdShotPage"
];

export const createAdShotRoutes = createRouteHandlerFactory("createAdShotRoutes", adShotRouteDeps, (deps) => {
  const {
    readAdShots,
    readAdShotById,
    readAdShotProjectsWithStats,
    readAdShotCandidates,
    readAdShotSubscriptions,
    readAdShotSubscriptionLogs,
    resolveAdShotAppMatch,
    importAdShot,
    analyzeAdShot,
    assignAdShotProjects,
    deleteAdShot,
    importAdShotCandidates,
    saveAdShotProjects,
    saveAdShotSubscription,
    deleteAdShotSubscription,
    appendAdShotSubscriptionLog,
    serveAdShotPage
  } = deps;

  return [
    {
      method: "GET",
      match: exactPath("/api/ad-shots"),
      handle: async ({ res, url }) => {
        const sourceAdId = String(url.searchParams.get("sourceAdId") || "").trim();
        const sourceUrl = String(url.searchParams.get("sourceUrl") || "").trim();
        const sourceKind = String(url.searchParams.get("sourceKind") || "").trim().toLowerCase();
        const compact = ["1", "true", "yes"].includes(String(url.searchParams.get("compact") || "").trim().toLowerCase());
        const shots = await readAdShots();
        if (!sourceAdId && !sourceUrl) {
          return sendJson(res, 200, shots);
        }
        const shot = Array.isArray(shots)
          ? shots.find((item) => {
              if (!matchesAdShotStatusQuery(item, { sourceAdId, sourceUrl })) {
                return false;
              }
              if (!sourceKind) {
                return true;
              }
              const rawSource = String(
                item?.sourcePlatform
                || item?.source_platform
                || item?.platform
                || item?.captureContext
                || item?.capture_context
                || item?.sourceLabel
                || item?.source_label
                || item?.source
                || ""
              ).trim().toLowerCase().replace(/[-\s]+/g, "_");
              const sourceLabel = String(
                item?.sourceDisplay
                || item?.sourceLabel
                || item?.source_label
                || item?.source
                || ""
              ).trim().toLowerCase();
              const isTikTokDetail = [
                "tiktok",
                "tiktok_detail",
                "tiktok_video",
                "tiktok_video_detail",
                "tiktok_photo",
                "tiktok_photo_detail"
              ].includes(rawSource) || /tiktok.*详情/.test(sourceLabel);
              if (sourceKind === "tiktok") {
                return isTikTokDetail;
              }
              if (sourceKind === "topads") {
                return !isTikTokDetail;
              }
              return true;
            }) || null
          : null;
        return sendJson(res, 200, compact ? compactAdShotStatus(shot) : shot);
      }
    },
    {
      method: "GET",
      match: prefixPath("/api/ad-shots/"),
      handle: async ({ res, url }) => sendJson(
        res,
        200,
        await readAdShotById(decodePathSuffix(url.pathname, /^\/api\/ad-shots\//))
      )
    },
    {
      method: "GET",
      match: exactPath("/api/ad-shot-projects"),
      handle: async ({ res }) => sendJson(res, 200, await readAdShotProjectsWithStats())
    },
    {
      method: "GET",
      match: exactPath("/api/ad-shot-candidates"),
      handle: async ({ res }) => sendJson(res, 200, await readAdShotCandidates())
    },
    {
      method: "GET",
      match: exactPath("/api/ad-shot-subscriptions"),
      handle: async ({ res }) => sendJson(res, 200, await readAdShotSubscriptions())
    },
    {
      method: "GET",
      match: exactPath("/api/ad-shot-subscription-logs"),
      handle: async ({ res }) => sendJson(res, 200, await readAdShotSubscriptionLogs())
    },
    {
      method: "POST",
      match: exactPath("/api/ad-shots/match-app"),
      handle: withRouteBody(async ({ res, body }) => {
        const record = await resolveAdShotAppMatch(body);
        return sendJson(res, 200, record);
      })
    },
    {
      method: "POST",
      match: exactPath("/api/ad-shots/import"),
      handle: withRouteBody(async ({ res, body }) => {
        const record = await importAdShot(body);
        return sendJson(res, 200, record);
      })
    },
    {
      method: "POST",
      match: exactPath("/api/ad-shots/analyze"),
      handle: withRouteBody(async ({ res, body }) => {
        const record = await analyzeAdShot(body, { wait: false });
        return sendJson(res, 202, record);
      })
    },
    {
      method: "POST",
      match: exactPath("/api/ad-shots/assign-projects"),
      handle: withRouteBody(async ({ res, body }) => {
        const record = await assignAdShotProjects(body);
        return sendJson(res, 200, record);
      })
    },
    {
      method: "DELETE",
      match: prefixPath("/api/ad-shots/"),
      handle: async ({ res, url }) => sendJson(
        res,
        200,
        await deleteAdShot(decodePathSuffix(url.pathname, /^\/api\/ad-shots\//))
      )
    },
    {
      method: "POST",
      match: exactPath("/api/ad-shot-candidates/import"),
      handle: withRouteBody(async ({ res, body }) => {
        const record = await importAdShotCandidates(body);
        return sendJson(res, 200, record);
      })
    },
    {
      method: "POST",
      match: exactPath("/api/ad-shot-projects"),
      handle: withRouteBody(async ({ res, body }) => {
        const record = await saveAdShotProjects(body);
        return sendJson(res, 200, record);
      })
    },
    {
      method: "POST",
      match: exactPath("/api/ad-shot-subscriptions"),
      handle: withRouteBody(async ({ res, body }) => {
        const record = await saveAdShotSubscription(body);
        return sendJson(res, 200, record);
      })
    },
    {
      method: "POST",
      match: exactPath("/api/ad-shot-subscriptions/delete"),
      handle: withRouteBody(
        withRequiredString("id", "缺少订阅 ID。", async ({ res, subscriptionId }) => {
          const record = await deleteAdShotSubscription(subscriptionId);
          return sendJson(res, 200, record);
        }, { as: "subscriptionId" })
      )
    },
    {
      method: "POST",
      match: exactPath("/api/ad-shot-subscription-logs"),
      handle: withRouteBody(async ({ res, body }) => {
        const record = await appendAdShotSubscriptionLog(body);
        return sendJson(res, 200, record);
      })
    },
    {
      method: "DELETE",
      match: prefixPath("/api/ad-shot-subscriptions/"),
      handle: async ({ res, url }) => sendJson(
        res,
        200,
        await deleteAdShotSubscription(decodePathSuffix(url.pathname, /^\/api\/ad-shot-subscriptions\//))
      )
    },
    {
      method: "GET",
      match: prefixPath("/shots/"),
      handle: async ({ res, url }) => {
        const shotId = decodePathSuffix(url.pathname, /^\/shots\//);
        res.writeHead(302, {
          Location: `/videos/detail.html?source=shot&id=${encodeURIComponent(shotId)}&from=shots`,
          "Cache-Control": "no-store, max-age=0"
        });
        res.end();
        return true;
      }
    },
    {
      method: "HEAD",
      match: prefixPath("/shots/"),
      handle: async ({ res, url }) => {
        const shotId = decodePathSuffix(url.pathname, /^\/shots\//);
        res.writeHead(302, {
          Location: `/videos/detail.html?source=shot&id=${encodeURIComponent(shotId)}&from=shots`,
          "Cache-Control": "no-store, max-age=0"
        });
        res.end();
        return true;
      }
    }
  ];
});

function matchesAdShotStatusQuery(item = {}, { sourceAdId = "", sourceUrl = "" } = {}) {
  const normalizedQueryUrl = normalizeStatusUrl(sourceUrl);
  if (normalizedQueryUrl) {
    const candidateUrls = [
      item.sourceUrl,
      item.canonicalUrl,
      item.url,
      item.raw?.sourceUrl,
      item.raw?.canonicalUrl
    ].map(normalizeStatusUrl).filter(Boolean);
    if (candidateUrls.some((url) => url === normalizedQueryUrl)) {
      return true;
    }
  }

  const itemSourceAdId = String(item?.sourceAdId || item?.source_ad_id || item?.videoId || item?.sourceItemId || "").trim();
  return Boolean(sourceAdId && itemSourceAdId === sourceAdId);
}

function compactAdShotStatus(shot) {
  if (!shot || typeof shot !== "object" || Array.isArray(shot)) {
    return null;
  }
  const commentsRaw = shot.commentsRaw && typeof shot.commentsRaw === "object" ? shot.commentsRaw : null;
  const commentItems = Array.isArray(commentsRaw?.items) ? commentsRaw.items : [];
  const mediaCount = commentItems.reduce((total, item) => total + (Array.isArray(item?.media) ? item.media.length : 0), 0);
  return {
    id: shot.id || shot.shotId || "",
    shotId: shot.shotId || shot.id || "",
    sourceAdId: shot.sourceAdId || shot.videoId || shot.sourceItemId || "",
    sourcePlatform: shot.sourcePlatform || "",
    sourceDisplay: shot.sourceDisplay || "",
    sourceLabel: shot.sourceLabel || "",
    captureContext: shot.captureContext || "",
    sourceUrl: shot.sourceUrl || "",
    canonicalUrl: shot.canonicalUrl || "",
    shotUrl: shot.shotUrl || "",
    appId: shot.appId || shot.app?.id || "",
    app: shot.app || null,
    appDisplay: shot.appDisplay || "",
    appName: shot.appName || "",
    brandName: shot.brandName || "",
    targetApp: shot.targetApp || "",
    category: shot.category || "",
    appCategoriesSynced: shot.appCategoriesSynced || [],
    lastCollectedAt: shot.lastCollectedAt || "",
    lastImportedAt: shot.lastImportedAt || "",
    importedAt: shot.importedAt || "",
    savedAt: shot.savedAt || "",
    createdAt: shot.createdAt || "",
    capturedAt: shot.capturedAt || "",
    commentsRaw: commentsRaw
      ? {
          itemCount: Number(commentsRaw.itemCount || commentItems.length) || 0,
          mediaCount,
          capturedAt: commentsRaw.capturedAt || "",
          updatedAt: commentsRaw.updatedAt || "",
          importedAt: commentsRaw.importedAt || ""
        }
      : null
  };
}

function normalizeStatusUrl(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().toLowerCase();
  } catch {
    return text.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}
