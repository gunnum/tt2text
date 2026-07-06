import { json } from "./http-utils.mjs";
import {
  adShotRouteDeps,
  createAdShotRoutes
} from "./routes/ad-shot-routes.mjs";
import {
  appRouteDeps,
  createAppRoutes
} from "./routes/app-routes.mjs";
import {
  articleRouteDeps,
  createArticleRoutes
} from "./routes/article-routes.mjs";
import {
  assertRouteDeps,
  dispatchRouteHandlers
} from "./routes/route-utils.mjs";
import {
  createStaticRoutes,
  staticRouteDeps
} from "./routes/static-routes.mjs";
import {
  createDoubaoVoiceRoutes,
  doubaoVoiceRouteDeps
} from "../doubao-voice-playground/doubao-voice-routes.mjs";
import {
  createVideoRoutes,
  videoRouteDeps
} from "./routes/video-routes.mjs";
import {
  createReportOutputRoutes,
  reportOutputRouteDeps
} from "./routes/report-output-routes.mjs";

const httpRouteDeps = uniqueRouteDeps([
  videoRouteDeps,
  articleRouteDeps,
  appRouteDeps,
  reportOutputRouteDeps,
  adShotRouteDeps,
  doubaoVoiceRouteDeps,
  staticRouteDeps
]);

export function createHttpRouter(deps = {}) {
  assertRouteDeps("createHttpRouter", deps, httpRouteDeps);

  const routeHandlers = createRouteHandlers(deps);

  return async function handleRequest(req, res) {
    try {
      const url = new URL(req.url || "/", "http://localhost:3000");
      if (await dispatchRouteHandlers(req, res, url, routeHandlers)) {
        return;
      }

      return json(res, 404, { error: "Not found" });
    } catch (error) {
      console.error(error);
      return json(res, 500, { error: error instanceof Error ? error.message : "未知错误" });
    }
  };
}

function createRouteHandlers(deps) {
  return [
    createVideoRoutes(deps),
    createArticleRoutes(deps),
    createAppRoutes(deps),
    createReportOutputRoutes(deps),
    createAdShotRoutes(deps),
    createDoubaoVoiceRoutes(deps),
    createStaticRoutes(deps)
  ];
}

function uniqueRouteDeps(depGroups) {
  return [...new Set(depGroups.flat())];
}
