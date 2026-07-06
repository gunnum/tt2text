import test from "node:test";
import assert from "node:assert/strict";

import { createAdShotRoutes } from "../server/routes/ad-shot-routes.mjs";
import { createAppRoutes } from "../server/routes/app-routes.mjs";
import { createArticleRoutes } from "../server/routes/article-routes.mjs";
import { createVideoRoutes } from "../server/routes/video-routes.mjs";
import {
  readJsonResponse,
  runRoute
} from "./helpers/http-test-helpers.mjs";

test("video routes validate required convert fields and duplicate conflicts", async () => {
  const handler = createVideoRoutes({
    readResults: async () => [],
    setResultFavorite: async () => ({}),
    readVideoJobsForApi: async () => [],
    findDuplicateResult: async (url) => (url === "https://dup.example/video" ? { id: "dup-1" } : null),
    enqueueVideoConversion: async (videoUrl, appId) => ({ id: "job-1", videoUrl, appId }),
    enqueueVideoBatch: async () => ({}),
    retryVideoJob: async () => ({}),
    retryFailedVideoJobs: async () => ({}),
    ignoreFailedVideoJobs: async () => ({}),
    refreshResultVisualUnderstanding: async () => ({}),
    importTikTokComments: async () => ({}),
    deleteResults: async () => ({})
  });

  const missingRes = await runRoute(handler, {
    method: "POST",
    pathname: "/api/convert",
    payload: { appId: "app-1" }
  });
  assert.equal(missingRes.statusCode, 400);
  assert.deepEqual(readJsonResponse(missingRes), { error: "缺少视频链接。" });

  const duplicateRes = await runRoute(handler, {
    method: "POST",
    pathname: "/api/convert",
    payload: {
      url: "https://dup.example/video",
      appId: "app-1"
    }
  });
  assert.equal(duplicateRes.statusCode, 409);
  assert.deepEqual(readJsonResponse(duplicateRes), {
    error: "这个视频链接已经录入过了。",
    duplicate: { id: "dup-1" }
  });
});

test("video routes return 202 for successful convert requests", async () => {
  const handler = createVideoRoutes({
    readResults: async () => [],
    setResultFavorite: async () => ({}),
    readVideoJobsForApi: async () => [],
    findDuplicateResult: async () => null,
    enqueueVideoConversion: async (videoUrl, appId) => ({ id: "job-2", videoUrl, appId }),
    enqueueVideoBatch: async () => ({}),
    retryVideoJob: async () => ({}),
    retryFailedVideoJobs: async () => ({}),
    ignoreFailedVideoJobs: async () => ({}),
    refreshResultVisualUnderstanding: async () => ({}),
    importTikTokComments: async () => ({}),
    deleteResults: async () => ({})
  });

  const res = await runRoute(handler, {
    method: "POST",
    pathname: "/api/convert",
    payload: { url: "https://ok.example/video", appId: "app-2" }
  });

  assert.equal(res.statusCode, 202);
  assert.deepEqual(readJsonResponse(res), {
    id: "job-2",
    videoUrl: "https://ok.example/video",
    appId: "app-2"
  });
});

test("video routes update favorite state for an existing result", async () => {
  const handler = createVideoRoutes({
    readResults: async () => [{ id: "result-1", title: "demo", isFavorite: false }],
    setResultFavorite: async (id, favorite) => ({ id, title: "demo", isFavorite: favorite }),
    readVideoJobsForApi: async () => [],
    findDuplicateResult: async () => null,
    enqueueVideoConversion: async () => ({}),
    enqueueVideoBatch: async () => ({}),
    retryVideoJob: async () => ({}),
    retryFailedVideoJobs: async () => ({}),
    ignoreFailedVideoJobs: async () => ({}),
    refreshResultVisualUnderstanding: async () => ({}),
    importTikTokComments: async () => ({}),
    deleteResults: async () => ({})
  });

  const res = await runRoute(handler, {
    method: "POST",
    pathname: "/api/results/favorite",
    payload: { id: "result-1", favorite: true }
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(readJsonResponse(res), { id: "result-1", title: "demo", isFavorite: true });
});

test("video routes return 404 when favorite target does not exist", async () => {
  const handler = createVideoRoutes({
    readResults: async () => [],
    setResultFavorite: async () => {
      throw new Error("RESULT_NOT_FOUND");
    },
    readVideoJobsForApi: async () => [],
    findDuplicateResult: async () => null,
    enqueueVideoConversion: async () => ({}),
    enqueueVideoBatch: async () => ({}),
    retryVideoJob: async () => ({}),
    retryFailedVideoJobs: async () => ({}),
    ignoreFailedVideoJobs: async () => ({}),
    refreshResultVisualUnderstanding: async () => ({}),
    importTikTokComments: async () => ({}),
    deleteResults: async () => ({})
  });

  const res = await runRoute(handler, {
    method: "POST",
    pathname: "/api/results/favorite",
    payload: { id: "missing-id", favorite: true }
  });

  assert.equal(res.statusCode, 404);
  assert.deepEqual(readJsonResponse(res), { error: "找不到这个视频记录。" });
});

test("article routes validate app selection before search import", async () => {
  const handler = createArticleRoutes({
    readArticles: async () => [],
    findDuplicateArticle: async () => null,
    runArticleIngestion: async () => ({}),
    searchAndImportArticles: async () => ({}),
    deleteArticles: async () => ({})
  });

  const res = await runRoute(handler, {
    method: "POST",
    pathname: "/api/articles/search-import",
    payload: {}
  });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(readJsonResponse(res), { error: "请先选择对应 App。" });
});

test("app routes validate delete ids list", async () => {
  const handler = createAppRoutes({
    readApps: async () => [],
    readAppMetrics: async () => [],
    readSensorTowerCsvImports: async () => [],
    getAppDashboardSummary: async () => ({}),
    findPaywallScreensForApp: async () => ({}),
    getAgentStatus: async () => ({}),
    addAppFromStoreUrl: async () => ({}),
    refreshAppStoreMediaForApp: async () => ({}),
    updateAppCategories: async () => ({}),
    fetchQiaomuReviewInsights: async () => ({}),
    deleteApp: async () => ({}),
    importAppMetrics: async () => ({}),
    importSensorTowerCsvFromPath: async () => ({}),
    importSensorTowerCsvFromContent: async () => ({}),
    deleteAppMetrics: async () => ({}),
    appendPluginDebugLog: async () => ({}),
    readPluginDebugLogs: async () => [],
    clearPluginDebugLogs: async () => ({})
  });

  const res = await runRoute(handler, {
    method: "POST",
    pathname: "/api/app-metrics/delete",
    payload: { ids: ["ok", 3] }
  });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(readJsonResponse(res), { error: "缺少有效的删除 id 列表。" });
});

test("app routes return 200 for successful app add", async () => {
  const handler = createAppRoutes({
    readApps: async () => [],
    readAppMetrics: async () => [],
    readSensorTowerCsvImports: async () => [],
    getAppDashboardSummary: async () => ({}),
    findPaywallScreensForApp: async () => ({}),
    getAgentStatus: async () => ({}),
    addAppFromStoreUrl: async (appUrl) => ({ id: "app-3", url: appUrl }),
    refreshAppStoreMediaForApp: async () => ({}),
    updateAppCategories: async () => ({}),
    fetchQiaomuReviewInsights: async () => ({}),
    deleteApp: async () => ({}),
    importAppMetrics: async () => ({}),
    importSensorTowerCsvFromPath: async () => ({}),
    importSensorTowerCsvFromContent: async () => ({}),
    deleteAppMetrics: async () => ({}),
    appendPluginDebugLog: async () => ({}),
    readPluginDebugLogs: async () => [],
    clearPluginDebugLogs: async () => ({})
  });

  const res = await runRoute(handler, {
    method: "POST",
    pathname: "/api/apps",
    payload: { url: " https://apps.example/item " }
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(readJsonResponse(res), {
    id: "app-3",
    url: "https://apps.example/item"
  });
});

test("app routes proxy qiaomu review insights by app id", async () => {
  const handler = createAppRoutes({
    readApps: async () => [{ id: "1064381508", name: "MEEFF" }],
    readAppMetrics: async () => [],
    readSensorTowerCsvImports: async () => [],
    getAppDashboardSummary: async () => ({}),
    findPaywallScreensForApp: async () => ({}),
    getAgentStatus: async () => ({}),
    addAppFromStoreUrl: async () => ({}),
    refreshAppStoreMediaForApp: async () => ({}),
    updateAppCategories: async () => ({}),
    fetchQiaomuReviewInsights: async (appStoreId, options) => ({ appStoreId, max: options.max }),
    deleteApp: async () => ({}),
    importAppMetrics: async () => ({}),
    importSensorTowerCsvFromPath: async () => ({}),
    importSensorTowerCsvFromContent: async () => ({}),
    deleteAppMetrics: async () => ({}),
    appendPluginDebugLog: async () => ({}),
    readPluginDebugLogs: async () => [],
    clearPluginDebugLogs: async () => ({})
  });

  const res = await runRoute(handler, {
    method: "GET",
    pathname: "/api/apps/review-insights?appId=1064381508&max=300"
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(readJsonResponse(res), {
    appStoreId: "1064381508",
    max: "300"
  });
});

test("ad shot routes validate subscription delete id and analyze status", async () => {
  const handler = createAdShotRoutes({
    readAdShots: async () => [],
    readAdShotById: async () => ({}),
    readAdShotProjectsWithStats: async () => [],
    readAdShotCandidates: async () => [],
    readAdShotSubscriptions: async () => [],
    readAdShotSubscriptionLogs: async () => [],
    resolveAdShotAppMatch: async () => ({}),
    importAdShot: async () => ({}),
    analyzeAdShot: async () => ({ queued: true }),
    assignAdShotProjects: async () => ({}),
    deleteAdShot: async () => ({}),
    importAdShotCandidates: async () => ({}),
    saveAdShotProjects: async () => ({}),
    saveAdShotSubscription: async () => ({}),
    deleteAdShotSubscription: async () => ({}),
    appendAdShotSubscriptionLog: async () => ({}),
    serveAdShotPage: async () => ({}),
    appendAdShotSubscriptionLog: async () => ({}),
    serveAdShotPage: async () => true
  });

  const missingRes = await runRoute(handler, {
    method: "POST",
    pathname: "/api/ad-shot-subscriptions/delete",
    payload: {}
  });
  assert.equal(missingRes.statusCode, 400);
  assert.deepEqual(readJsonResponse(missingRes), { error: "缺少订阅 ID。" });

  const analyzeRes = await runRoute(handler, {
    method: "POST",
    pathname: "/api/ad-shots/analyze",
    payload: { id: "shot-1" }
  });
  assert.equal(analyzeRes.statusCode, 202);
  assert.deepEqual(readJsonResponse(analyzeRes), { queued: true });
});
