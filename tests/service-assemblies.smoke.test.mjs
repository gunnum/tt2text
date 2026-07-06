import test from "node:test";
import assert from "node:assert/strict";

import { createAdShotServices } from "../server/ad-shots/service-assembly.mjs";
import { createAppCatalogServices } from "../server/app-catalog-service-assembly.mjs";
import { createAppServices } from "../server/app-service-assembly.mjs";
import { createArticleServices } from "../server/article-service-assembly.mjs";
import { createMaintenanceServices } from "../server/maintenance-service-assembly.mjs";
import { createSensorTowerServices } from "../server/sensortower-service-assembly.mjs";
import { createVideoAnalysisServices } from "../server/video-analysis-service-assembly.mjs";
import { createVideoQueueServices } from "../server/video-queue-service-assembly.mjs";
import { createVideoServices } from "../server/video-service-assembly.mjs";
import {
  createVideoRuntimeConfigStub
} from "./helpers/assembly-test-helpers.mjs";

test("video services expose queue and analysis surfaces", () => {
  const videoServices = createVideoServices({
    runtimeConfig: createVideoRuntimeConfigStub(),
    readResults: async () => [],
    writeResults: async () => {},
    readVideoJobs: async () => [],
    writeVideoJobs: async () => {},
    readTikTokCommentsRaw: async () => [],
    writeTikTokComments: async () => {},
    appendConversionErrorLog: async () => {},
    appDeps: {
      findAppById: async () => null,
      pickResultAppFields: () => ({})
    },
    createJobId: () => "job-1",
    normalizeVideoUrl: (value) => value,
    normalizeText: (value) => value,
    truncateText: (value) => value,
    normalizeToPublicPath: (value) => value,
    formatDate: () => "2026-01-01",
    ensureDir: async () => {}
  });

  assert.equal(typeof videoServices.processVideoQueue, "function");
  assert.equal(typeof videoServices.analysisDeps.runPythonConversion, "function");
  assert.equal(typeof videoServices.analysisDeps.assessVideoRelevance, "function");
  assert.equal(typeof videoServices.routeDeps.enqueueVideoConversion, "function");
  assert.equal(typeof videoServices.routeDeps.importTikTokComments, "function");
});

test("video services require runtime config", () => {
  assert.throws(
    () => createVideoServices({}),
    /createVideoServices 缺少依赖：runtimeConfig/
  );
});

test("video analysis services expose analysis helpers and import route", () => {
  const videoAnalysisServices = createVideoAnalysisServices({
    runtimeConfig: createVideoRuntimeConfigStub(),
    readResults: async () => [],
    writeResults: async () => {},
    readTikTokCommentsRaw: async () => [],
    writeTikTokComments: async () => {},
    createJobId: () => "job-1",
    normalizeVideoUrl: (value) => value,
    normalizeText: (value) => value,
    truncateText: (value) => value,
    normalizeToPublicPath: (value) => value,
    formatDate: () => "2026-01-01",
    ensureDir: async () => {}
  });

  assert.equal(typeof videoAnalysisServices.analysisDeps.runPhotoConversion, "function");
  assert.equal(typeof videoAnalysisServices.analysisDeps.runVisualOnlyConversion, "function");
  assert.equal(typeof videoAnalysisServices.analysisDeps.buildNormalVideoMaterialAnalysis, "function");
  assert.equal(typeof videoAnalysisServices.analysisDeps.mergeVisualTextSegmentsWithOcr, "function");
  assert.equal(typeof videoAnalysisServices.routeDeps.importTikTokComments, "function");
});

test("video analysis services require runtime config", () => {
  assert.throws(
    () => createVideoAnalysisServices({}),
    /createVideoAnalysisServices 缺少依赖：runtimeConfig/
  );
});

test("video queue services require appDeps.findAppById", () => {
  assert.throws(
    () => createVideoQueueServices({
      runtimeConfig: createVideoRuntimeConfigStub(),
      readResults: async () => [],
      writeResults: async () => {},
      readVideoJobs: async () => [],
      writeVideoJobs: async () => {},
      appendConversionErrorLog: async () => {},
      appDeps: {
        pickResultAppFields: () => ({})
      },
      analysisDeps: {
        runPhotoConversion: async () => ({}),
        runPythonConversion: async () => ({}),
        runVisualOnlyConversion: async () => ({}),
        normalizeVideoSemanticPayload: (value) => value,
        buildNormalVideoVisualTextAnalysis: async () => ({}),
        buildNormalVideoMaterialAnalysis: async () => ({}),
        findJobVideoFile: async () => null,
        mergeTikTokEngagement: (value) => value,
        normalizeTikTokEngagement: (value) => value,
        normalizePublishedDate: (value) => value,
        extractTikTokAuthor: (value) => value,
        assessVideoRelevance: async () => ({})
      },
      createJobId: () => "job-1",
      normalizeVideoUrl: (value) => value,
      normalizeText: (value) => value,
      truncateText: (value) => value,
      normalizeToPublicPath: (value) => value,
      formatDate: () => "2026-01-01",
      ensureDir: async () => {}
    }),
    /createVideoQueueServices\.appDeps 缺少依赖：findAppById/
  );
});

test("video queue services require analysisDeps.assessVideoRelevance", () => {
  assert.throws(
    () => createVideoQueueServices({
      runtimeConfig: createVideoRuntimeConfigStub(),
      readResults: async () => [],
      writeResults: async () => {},
      readVideoJobs: async () => [],
      writeVideoJobs: async () => {},
      appendConversionErrorLog: async () => {},
      appDeps: {
        findAppById: async () => null,
        pickResultAppFields: () => ({})
      },
      analysisDeps: {
        runPhotoConversion: async () => ({}),
        runPythonConversion: async () => ({}),
        runVisualOnlyConversion: async () => ({}),
        normalizeVideoSemanticPayload: (value) => value,
        buildNormalVideoVisualTextAnalysis: async () => ({}),
        buildNormalVideoMaterialAnalysis: async () => ({}),
        findJobVideoFile: async () => null,
        mergeTikTokEngagement: (value) => value,
        normalizeTikTokEngagement: (value) => value,
        normalizePublishedDate: (value) => value,
        extractTikTokAuthor: (value) => value
      },
      createJobId: () => "job-1",
      normalizeVideoUrl: (value) => value,
      normalizeText: (value) => value,
      truncateText: (value) => value,
      normalizeToPublicPath: (value) => value,
      formatDate: () => "2026-01-01",
      ensureDir: async () => {}
    }),
    /createVideoQueueServices\.analysisDeps 缺少依赖：assessVideoRelevance/
  );
});

test("app catalog services expose catalog and matching surfaces", () => {
  const appCatalogServices = createAppCatalogServices({
    readApps: async () => [],
    writeApps: async () => {},
    normalizeStringArray: (value) => value,
    normalizeText: (value) => value,
    truncateText: (value) => value,
    formatDate: () => "2026-01-01"
  });

  assert.equal(typeof appCatalogServices.appDeps.readApps, "function");
  assert.equal(typeof appCatalogServices.appDeps.findAppById, "function");
  assert.equal(typeof appCatalogServices.appDeps.matchAppByName, "function");
  assert.equal(typeof appCatalogServices.routeDeps.addAppFromStoreUrl, "function");
  assert.equal(typeof appCatalogServices.routeDeps.updateAppCategories, "function");
});

test("app services require readApps dependency", () => {
  assert.throws(
    () => createAppServices({}),
    /createAppServices 缺少依赖：readApps/
  );
});

test("app services expose catalog deps and sensor tower routes", () => {
  const appServices = createAppServices({
    runtimeConfig: {
      paths: {
        sensorTowerHumanDir: "/tmp/sensortower-human",
        projectRootDir: process.cwd(),
        pluginDebugLogFile: "/tmp/plugin-debug.log"
      }
    },
    readApps: async () => [],
    writeApps: async () => {},
    readAppMetrics: async () => [],
    writeAppMetrics: async () => {},
    readAppPaywalls: async () => [],
    writeAppPaywalls: async () => {},
    readSensorTowerCsvImports: async () => [],
    writeSensorTowerCsvImports: async () => {},
    normalizeStringArray: (value) => value,
    normalizeText: (value) => value,
    truncateText: (value) => value,
    createJobId: () => "job-1",
    formatDate: () => "2026-01-01",
    ensureDir: async () => {},
    normalizeToPublicPath: (value) => value,
    safePathSegment: (value) => value,
    safeFilename: (value) => value
  });

  assert.equal(typeof appServices.appDeps.readApps, "function");
  assert.equal(typeof appServices.appDeps.addAppFromStoreSearch, "function");
  assert.equal(typeof appServices.routeDeps.readApps, "function");
  assert.equal(typeof appServices.routeDeps.updateAppCategories, "function");
  assert.equal(typeof appServices.routeDeps.readAppMetrics, "function");
  assert.equal(typeof appServices.routeDeps.importSensorTowerCsvFromContent, "function");
});

test("sensor tower services require appDeps.matchAppByName", () => {
  assert.throws(
    () => createSensorTowerServices({
      runtimeConfig: {
        paths: {
          sensorTowerHumanDir: "/tmp/sensortower-human"
        }
      },
      appDeps: {
        readApps: async () => [],
        addAppFromStoreId: async () => null,
        addAppFromStoreSearch: async () => null,
        pickResultAppFields: () => ({})
      },
      readAppMetrics: async () => [],
      writeAppMetrics: async () => {},
      readSensorTowerCsvImports: async () => [],
      writeSensorTowerCsvImports: async () => {},
      normalizeStringArray: (value) => value,
      normalizeText: (value) => value,
      truncateText: (value) => value,
      createJobId: () => "job-1",
      formatDate: () => "2026-01-01",
      ensureDir: async () => {},
      normalizeToPublicPath: (value) => value,
      safePathSegment: (value) => value,
      safeFilename: (value) => value
    }),
    /createSensorTowerServices\.appDeps 缺少依赖：matchAppByName/
  );
});

test("article services expose ingestion and search routes", () => {
  const articleServices = createArticleServices({
    runtimeConfig: {
      paths: {
        projectRootDir: process.cwd(),
        articleBundlesDir: "/tmp/article-bundles",
        articleRunner: "/tmp/article-runner"
      }
    },
    appDeps: {
      findAppById: async () => null,
      pickResultAppFields: () => ({})
    },
    readArticles: async () => [],
    writeArticles: async () => {},
    ensureDir: async () => {},
    createJobId: () => "job-1",
    formatDate: () => "2026-01-01",
    normalizeToPublicPath: (value) => value,
    truncateText: (value) => value,
    normalizeText: (value) => value,
    normalizeSourceUrl: (value) => value
  });

  assert.equal(typeof articleServices.routeDeps.readArticles, "function");
  assert.equal(typeof articleServices.routeDeps.runArticleIngestion, "function");
  assert.equal(typeof articleServices.routeDeps.searchAndImportArticles, "function");
});

test("article services require appDeps.pickResultAppFields", () => {
  assert.throws(
    () => createArticleServices({
      runtimeConfig: {
        paths: {
          projectRootDir: process.cwd(),
          articleBundlesDir: "/tmp/article-bundles",
          articleRunner: "/tmp/article-runner"
        }
      },
      appDeps: {
        findAppById: async () => null
      },
      readArticles: async () => [],
      writeArticles: async () => {},
      ensureDir: async () => {},
      createJobId: () => "job-1",
      formatDate: () => "2026-01-01",
      normalizeToPublicPath: (value) => value,
      truncateText: (value) => value,
      normalizeText: (value) => value,
      normalizeSourceUrl: (value) => value
    }),
    /createArticleServices\.appDeps 缺少依赖：pickResultAppFields/
  );
});

test("maintenance services expose delete, duplicate, and result-state routes", () => {
  const maintenanceServices = createMaintenanceServices({
    runtimeConfig: {
      paths: {
        jobsDir: "/tmp/video-jobs",
        projectRootDir: process.cwd()
      }
    },
    readResults: async () => [],
    writeResults: async () => {},
    readArticles: async () => [],
    writeArticles: async () => {},
    readAppMetrics: async () => [],
    writeAppMetrics: async () => {},
    readApps: async () => [],
    writeApps: async () => {},
    readVideoJobs: async () => [],
    writeVideoJobs: async () => {},
    normalizeVideoUrl: (value) => value,
    normalizeSourceUrl: (value) => value
  });

  assert.equal(typeof maintenanceServices.routeDeps.deleteResults, "function");
  assert.equal(typeof maintenanceServices.routeDeps.deleteArticles, "function");
  assert.equal(typeof maintenanceServices.routeDeps.deleteApp, "function");
  assert.equal(typeof maintenanceServices.routeDeps.findDuplicateResult, "function");
  assert.equal(typeof maintenanceServices.routeDeps.findDuplicateArticle, "function");
  assert.equal(typeof maintenanceServices.routeDeps.setResultFavorite, "function");
  assert.equal(typeof maintenanceServices.routeDeps.writeResults, "function");
});

test("maintenance services require normalizeSourceUrl", () => {
  assert.throws(
    () => createMaintenanceServices({
      runtimeConfig: {
        paths: {
          jobsDir: "/tmp/video-jobs",
          projectRootDir: process.cwd()
        }
      },
      readResults: async () => [],
      writeResults: async () => {},
      readArticles: async () => [],
      writeArticles: async () => {},
      readAppMetrics: async () => [],
      writeAppMetrics: async () => {},
      readApps: async () => [],
      writeApps: async () => {},
      readVideoJobs: async () => [],
      writeVideoJobs: async () => {},
      normalizeVideoUrl: (value) => value,
      normalizeSourceUrl: null
    }),
    /createMaintenanceServices 缺少依赖：normalizeSourceUrl/
  );
});

test("ad shot services expose recovery and route surfaces", () => {
  const adShotServices = createAdShotServices({
    paths: {
      adShotsFile: "/tmp/ad-shots.json",
      adShotProjectsFile: "/tmp/ad-shot-projects.json",
      adShotCandidatesFile: "/tmp/ad-shot-candidates.json",
      adShotSubscriptionsFile: "/tmp/ad-shot-subscriptions.json",
      adShotSubscriptionLogsFile: "/tmp/ad-shot-subscription-logs.json",
      projectRootDir: process.cwd(),
      adShotAssetsDir: "/tmp/ad-shot-assets"
    },
    readJsonArrayFile: async () => [],
    writeJsonFileAtomic: async () => {},
    appDeps: {
      readApps: async () => [],
      writeApps: async () => {},
      matchAppByName: async () => null,
      addAppFromStoreSearch: async () => null,
      pickResultAppFields: () => ({}),
      normalizeAppDisplayName: (value) => value
    },
    ensureDir: async () => {},
    analysisDeps: {
      normalizeVisualTextSegments: (value) => value,
      runPhotoConversion: async () => ({}),
      runPythonConversion: async () => ({}),
      runVisualOcrExtraction: async () => [],
      findJobVideoFile: async () => null,
      buildAdShotAnalysis: async () => ({}),
      normalizeTikTokEngagement: (value) => value,
      mergeVisualTextSegmentsWithOcr: (value) => value
    },
    normalizeStringArray: (value) => value,
    normalizeText: (value) => value,
    truncateText: (value) => value,
    normalizeToPublicPath: (value) => value,
    resolveProjectPublicPath: (value) => value,
    uniqueStrings: (value) => value,
    slugifyId: (value) => value,
    createJobId: () => "job-1",
    formatDate: () => "2026-01-01"
  });

  assert.equal(typeof adShotServices.defaultAdShotProjects, "function");
  assert.ok(Array.isArray(adShotServices.defaultAdShotProjects()));
  assert.equal(typeof adShotServices.recoverInterruptedAdShotAnalyses, "function");
  assert.equal(typeof adShotServices.routeDeps.importAdShot, "function");
  assert.equal(typeof adShotServices.routeDeps.readAdShotSubscriptions, "function");
});

test("vertical video report service exposes category report surfaces", async () => {
  const { createVerticalVideoReportService } = await import("../server/vertical-video-report-service.mjs");
  const service = createVerticalVideoReportService({
    projectRootDir: process.cwd(),
    readAdShots: async () => [],
    normalizeText: (value) => value,
    truncateText: (value) => value
  });

  assert.equal(typeof service.buildVerticalVideoCategoryIndex, "function");
  assert.equal(typeof service.buildVerticalVideoCategoryReport, "function");
  assert.equal(typeof service.analyzeVerticalVideoCategory, "function");
});

test("ad shot services require analysis deps", () => {
  assert.throws(
    () => createAdShotServices({}),
    /createAdShotServices 缺少依赖：readJsonArrayFile/
  );
});
