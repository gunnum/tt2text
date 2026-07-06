import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAdShotRecord } from "../server/ad-shots/normalizers.mjs";

const projects = [
  { id: "proj_reading", name: "听书阅读", status: "active" },
  { id: "proj_social", name: "社交素材", status: "active" }
];

test("new ad shots do not receive an inferred project", () => {
  const shot = normalizeAdShotRecord({
    shotId: "shot_new",
    appName: "Example",
    title: "A social app video"
  }, projects);

  assert.deepEqual(shot.projectIds, []);
  assert.deepEqual(shot.projectNames, []);
  assert.deepEqual(shot.projects, []);
});

test("manual project assignments remain supported", () => {
  const shot = normalizeAdShotRecord({
    shotId: "shot_manual",
    projectIds: ["proj_reading"]
  }, projects);

  assert.deepEqual(shot.projectIds, ["proj_reading"]);
  assert.deepEqual(shot.projectNames, ["听书阅读"]);
});
