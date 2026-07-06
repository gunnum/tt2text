import {
  createRouteHandlerFactory,
  decodePathSuffix,
  exactPath,
  prefixPath,
  readRouteBody,
  sendJson
} from "./route-utils.mjs";

export const reportOutputRouteDeps = [
  "buildReportOutputOverview",
  "buildAppReportOutput",
  "buildAppCategoryRankingOutput",
  "buildVerticalVideoCategoryIndex",
  "buildVerticalVideoCategoryReport",
  "analyzeVerticalVideoCategory",
  "prepareAppReportModuleAi",
  "generateAppReportModule",
  "generateAppReportModules"
];

export const createReportOutputRoutes = createRouteHandlerFactory("createReportOutputRoutes", reportOutputRouteDeps, (deps) => {
  const {
    buildReportOutputOverview,
    buildAppReportOutput,
    buildAppCategoryRankingOutput,
    buildVerticalVideoCategoryIndex,
    buildVerticalVideoCategoryReport,
    analyzeVerticalVideoCategory,
    prepareAppReportModuleAi,
    generateAppReportModule,
    generateAppReportModules
  } = deps;

  return [
    {
      method: "GET",
      match: exactPath("/api/report-output"),
      handle: async ({ res }) => sendJson(res, 200, await buildReportOutputOverview())
    },
    {
      method: "POST",
      match: prefixPath("/api/report-output/"),
      handle: async ({ req, res, url }) => {
        const batchMatch = url.pathname.match(/^\/api\/report-output\/([^/]+)\/modules\/generate-all$/);
        if (batchMatch) {
          const appId = decodeURIComponent(batchMatch[1]);
          try {
            const body = await readRouteBody(req).catch(() => ({}));
            return sendJson(res, 200, await generateAppReportModules(appId, {
              skipExisting: body?.force === true ? false : true
            }));
          } catch (error) {
            if (error?.message === "APP_NOT_FOUND") {
              return sendJson(res, 404, { error: "找不到这个 App。" });
            }
            throw error;
          }
        }

        const videoCategoryAnalyzeMatch = url.pathname.match(/^\/api\/report-output\/video-categories\/([^/]+)\/analyze$/);
        if (videoCategoryAnalyzeMatch) {
          const categoryId = decodeURIComponent(videoCategoryAnalyzeMatch[1]);
          try {
            return sendJson(res, 200, await analyzeVerticalVideoCategory(categoryId));
          } catch (error) {
            if (error?.message === "VIDEO_CATEGORY_NOT_FOUND") {
              return sendJson(res, 404, { error: "找不到这个视频垂类。" });
            }
            throw error;
          }
        }

        const match = url.pathname.match(/^\/api\/report-output\/([^/]+)\/modules\/([^/]+)\/generate$/);
        const prepareMatch = url.pathname.match(/^\/api\/report-output\/([^/]+)\/modules\/([^/]+)\/prepare-ai$/);
        if (!match && !prepareMatch) return false;
        const activeMatch = match || prepareMatch;
        const appId = decodeURIComponent(activeMatch[1]);
        const moduleId = decodeURIComponent(activeMatch[2]);
        try {
          return sendJson(res, 200, match
            ? await generateAppReportModule(appId, moduleId)
            : await prepareAppReportModuleAi(appId, moduleId));
        } catch (error) {
          if (error?.message === "APP_NOT_FOUND") {
            return sendJson(res, 404, { error: "找不到这个 App。" });
          }
          if (error?.message === "MODULE_NOT_FOUND") {
            return sendJson(res, 404, { error: "找不到这个分析模块。" });
          }
          if (error?.message === "MODULE_BLOCKED") {
            return sendJson(res, 409, { error: "这个模块材料还不够。", module: error.module });
          }
          throw error;
        }
      }
    },
    {
      method: "GET",
      match: prefixPath("/api/report-output/"),
      handle: async ({ res, url }) => {
        if (url.pathname === "/api/report-output/video-categories") {
          return sendJson(res, 200, await buildVerticalVideoCategoryIndex());
        }
        const videoCategoryMatch = url.pathname.match(/^\/api\/report-output\/video-categories\/([^/]+)$/);
        if (videoCategoryMatch) {
          const categoryId = decodeURIComponent(videoCategoryMatch[1]);
          try {
            return sendJson(res, 200, await buildVerticalVideoCategoryReport(categoryId));
          } catch (error) {
            if (error?.message === "VIDEO_CATEGORY_NOT_FOUND") {
              return sendJson(res, 404, { error: "找不到这个视频垂类。" });
            }
            throw error;
          }
        }

        const rankingMatch = url.pathname.match(/^\/api\/report-output\/([^/]+)\/category-ranking$/);
        if (rankingMatch) {
          const appId = decodeURIComponent(rankingMatch[1]);
          try {
            return sendJson(res, 200, await buildAppCategoryRankingOutput(appId));
          } catch (error) {
            if (error?.message === "APP_NOT_FOUND") {
              return sendJson(res, 404, { error: "找不到这个 App。" });
            }
            throw error;
          }
        }
        const appId = decodePathSuffix(url.pathname, /^\/api\/report-output\//);
        try {
          return sendJson(res, 200, await buildAppReportOutput(appId));
        } catch (error) {
          if (error?.message === "APP_NOT_FOUND") {
            return sendJson(res, 404, { error: "找不到这个 App。" });
          }
          throw error;
        }
      }
    }
  ];
});
