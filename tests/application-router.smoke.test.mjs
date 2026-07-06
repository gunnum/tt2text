import test from "node:test";
import assert from "node:assert/strict";

import { createApplicationServices } from "../server/application-services.mjs";
import { createHttpRouter } from "../server/router-service.mjs";
import {
  createApp
} from "./helpers/assembly-test-helpers.mjs";
import {
  createResponseRecorder
} from "./helpers/http-test-helpers.mjs";

test("application services expose bootstrap and route dependencies", () => {
  const app = createApp();

  assert.equal(typeof app.bootstrap, "function");
  assert.equal(typeof app.routeDeps, "object");
  assert.equal(typeof app.routeDeps.projectRootDir, "string");
  assert.equal(typeof app.routeDeps.publicDir, "string");
  assert.equal(typeof app.routeDeps.readResults, "function");
  assert.equal(typeof app.routeDeps.readApps, "function");
  assert.equal(typeof app.routeDeps.readArticles, "function");
  assert.equal(typeof app.routeDeps.enqueueVideoConversion, "function");
  assert.equal(typeof app.routeDeps.importAdShot, "function");
  assert.equal(typeof app.routeDeps.analyzeAdShot, "function");
  assert.equal(typeof app.routeDeps.readAdShotSubscriptions, "function");
  assert.equal(typeof app.routeDeps.serveAdShotPage, "function");
  assert.equal(typeof app.routeDeps.buildVerticalVideoCategoryIndex, "function");
  assert.equal(typeof app.routeDeps.buildVerticalVideoCategoryReport, "function");
  assert.equal(typeof app.routeDeps.analyzeVerticalVideoCategory, "function");
});

test("application services require runtime config", () => {
  assert.throws(
    () => createApplicationServices(),
    /createApplicationServices 缺少依赖：runtimeConfig/
  );
});

test("http router instantiates from application route dependencies", async () => {
  const app = createApp();
  const handler = createHttpRouter(app.routeDeps);

  assert.equal(typeof handler, "function");

  const req = { method: "GET", url: "/__codex_smoke_not_found__" };
  const res = createResponseRecorder();

  await handler(req, res);

  assert.equal(res.statusCode, 404);
  assert.match(res.headers["content-type"] || "", /application\/json/i);
  assert.equal(res.writableEnded, true);
  assert.deepEqual(JSON.parse(res.body), { error: "Not found" });
});

test("http router rejects missing route dependencies", () => {
  assert.throws(
    () => createHttpRouter({}),
    /createHttpRouter 缺少依赖：readResults/
  );
});
