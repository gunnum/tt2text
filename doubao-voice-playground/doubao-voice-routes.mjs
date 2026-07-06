import path from "node:path";
import { createDoubaoVoiceService } from "./doubao-voice-service.mjs";
import { serveFile } from "../server/http-utils.mjs";
import {
  createRouteHandlerFactory,
  exactPath,
  sendJson,
  withRouteBody
} from "../server/routes/route-utils.mjs";

export const doubaoVoiceRouteDeps = [
  "projectRootDir"
];

export const createDoubaoVoiceRoutes = createRouteHandlerFactory("createDoubaoVoiceRoutes", doubaoVoiceRouteDeps, (deps) => {
  const service = createDoubaoVoiceService({
    outputDir: path.join(deps.projectRootDir, "data", "doubao-voice-playground")
  });
  const pagePath = path.join(deps.projectRootDir, "doubao-voice-playground", "doubao-voice-playground.html");

  return [
    {
      method: "GET",
      match: exactPath("/doubao-voice-playground.html"),
      handle: async ({ res }) => {
        await serveFile(res, pagePath, { rootDir: deps.projectRootDir });
        return true;
      }
    },
    {
      method: "GET",
      match: exactPath("/api/doubao-voice/options"),
      handle: async ({ res }) => sendJson(res, 200, service.getOptions())
    },
    {
      method: "POST",
      match: exactPath("/api/doubao-voice/generate"),
      handle: withRouteBody(async ({ res, body }) => {
        const result = await service.generate(body);
        return sendJson(res, 200, result);
      })
    },
    {
      method: "POST",
      match: exactPath("/api/doubao-voice/remix-local-pause"),
      handle: withRouteBody(async ({ res, body }) => {
        const result = await service.remixLocalPause(body);
        return sendJson(res, 200, result);
      })
    },
    {
      method: "POST",
      match: exactPath("/api/doubao-voice/delete"),
      handle: withRouteBody(async ({ res, body }) => {
        const result = await service.deleteResult(body);
        return sendJson(res, 200, result);
      })
    }
  ];
});
