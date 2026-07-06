import {
  createRouteHandlerFactory,
  exactPath,
  sendJson,
  withRequiredString,
  withRouteBody,
  withStringIdList
} from "./route-utils.mjs";

export const videoRouteDeps = [
  "readResults",
  "setResultFavorite",
  "readVideoJobsForApi",
  "findDuplicateResult",
  "enqueueVideoConversion",
  "enqueueVideoBatch",
  "retryVideoJob",
  "retryFailedVideoJobs",
  "ignoreFailedVideoJobs",
  "refreshResultVisualUnderstanding",
  "importTikTokComments",
  "deleteResults"
];

export const createVideoRoutes = createRouteHandlerFactory("createVideoRoutes", videoRouteDeps, (deps) => {
  const {
    readResults,
    setResultFavorite,
    readVideoJobsForApi,
    findDuplicateResult,
    enqueueVideoConversion,
    enqueueVideoBatch,
    retryVideoJob,
    retryFailedVideoJobs,
    ignoreFailedVideoJobs,
    refreshResultVisualUnderstanding,
    importTikTokComments,
    deleteResults
  } = deps;

  return [
    {
      method: "GET",
      match: exactPath("/api/results"),
      handle: async ({ res }) => sendJson(res, 200, await readResults())
    },
    {
      method: "POST",
      match: exactPath("/api/results/favorite"),
      handle: withRouteBody(
        withRequiredString("id", "缺少结果 ID。", async ({ res, id, body }) => {
          try {
            const result = await setResultFavorite(id, body?.favorite);
            return sendJson(res, 200, result);
          } catch (error) {
            if (error instanceof Error && error.message === "RESULT_NOT_FOUND") {
              return sendJson(res, 404, { error: "找不到这个视频记录。" });
            }
            throw error;
          }
        })
      )
    },
    {
      method: "GET",
      match: exactPath("/api/video-jobs"),
      handle: async ({ res }) => sendJson(res, 200, await readVideoJobsForApi())
    },
    {
      method: "POST",
      match: exactPath("/api/convert"),
      handle: withRouteBody(
        withRequiredString(
          "url",
          "缺少视频链接。",
          withRequiredString("appId", "请先选择对应 App。", async ({ res, videoUrl, appId }) => {
            const duplicate = await findDuplicateResult(videoUrl);
            if (duplicate) {
              return sendJson(res, 409, {
                error: "这个视频链接已经录入过了。",
                duplicate
              });
            }

            const job = await enqueueVideoConversion(videoUrl, appId);
            return sendJson(res, 202, job);
          }),
          { trim: true, as: "videoUrl" }
        )
      )
    },
    {
      method: "POST",
      match: exactPath("/api/convert/batch"),
      handle: withRouteBody(
        withRequiredString("appId", "请先选择对应 App。", async ({ res, body }) => {
          const payload = await enqueueVideoBatch(body);
          return sendJson(res, 202, payload);
        })
      )
    },
    {
      method: "POST",
      match: exactPath("/api/video-jobs/retry"),
      handle: withRouteBody(
        withRequiredString("id", "缺少任务 ID。", async ({ res, id }) => {
          const job = await retryVideoJob(id);
          return sendJson(res, 200, job);
        })
      )
    },
    {
      method: "POST",
      match: exactPath("/api/video-jobs/retry-failed"),
      handle: async ({ res }) => sendJson(res, 200, await retryFailedVideoJobs())
    },
    {
      method: "POST",
      match: exactPath("/api/video-jobs/ignore-failed"),
      handle: async ({ res }) => sendJson(res, 200, await ignoreFailedVideoJobs())
    },
    {
      method: "POST",
      match: exactPath("/api/results/visual-refresh"),
      handle: withRouteBody(
        withRequiredString("id", "缺少结果 ID。", async ({ res, id }) => {
          const result = await refreshResultVisualUnderstanding(id);
          return sendJson(res, 200, result);
        })
      )
    },
    {
      method: "POST",
      match: exactPath("/api/tiktok-comments/import"),
      handle: withRouteBody(async ({ res, body }) => {
        const record = await importTikTokComments(body);
        return sendJson(res, 200, record);
      })
    },
    {
      method: "POST",
      match: exactPath("/api/results/delete"),
      handle: withRouteBody(
        withStringIdList(async ({ res, ids }) => {
          const payload = await deleteResults(ids);
          return sendJson(res, 200, payload);
        })
      )
    }
  ];
});
