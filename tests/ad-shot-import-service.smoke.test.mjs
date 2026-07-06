import test from "node:test";
import assert from "node:assert/strict";

import { createAdShotImportService } from "../server/ad-shots/import-service.mjs";

test("importAdShot updates lastCollectedAt when a TikTok detail shot is re-collected", async () => {
  const existingShots = [{
    shotId: "shot_existing",
    sourcePlatform: "tiktok",
    sourceAdId: "7599706533366222102",
    sourceUrl: "https://www.tiktok.com/@bereal/photo/7599706533366222102",
    canonicalUrl: "https://www.tiktok.com/@bereal/photo/7599706533366222102",
    capturedAt: "2026-06-17 14:30",
    createdAt: "2026-06-17 14:30",
    updatedAt: "2026-06-17 14:30",
    lastCollectedAt: "2026-06-17 14:30",
    projectIds: [],
    raw: {}
  }];
  let writtenShots = null;
  const service = createAdShotImportService({
    readAdShots: async () => existingShots,
    writeAdShots: async (shots) => {
      writtenShots = shots;
    },
    readAdShotProjects: async () => [],
    readAdShotCandidates: async () => [],
    writeAdShotCandidates: async () => {},
    readApps: async () => [],
    pickResultAppFields: (app) => app,
    resolveAdShotAppMatch: async () => ({ appId: "", app: null, status: "unmatched", source: "", query: "", evidence: [], error: "" }),
    ensureDir: async () => {},
    createJobId: () => "job_test",
    normalizeAdShotRecord: (record) => record,
    normalizeVisualTextSegments: (value) => value,
    normalizeToPublicPath: (value) => value,
    normalizeTikTokEngagement: (value) => value,
    normalizeStringArray: (value) => Array.isArray(value) ? value.filter(Boolean).map(String) : [],
    normalizeText: (value) => String(value || "").trim(),
    formatDate: () => "2026-07-01 18:15",
    adShotAssetsDir: "/tmp/ad-shots",
    projectRootDir: "/tmp"
  });

  const result = await service.importAdShot({
    sourcePlatform: "tiktok",
    source_url: "https://www.tiktok.com/@bereal/photo/7599706533366222102",
    source_ad_id: "7599706533366222102",
    title: "BeReal dump from our creators",
    image_urls: ["https://example.com/1.jpg"]
  });

  assert.equal(result.duplicate, true);
  assert.equal(result.lastCollectedAt, "2026-07-01 18:15");
  assert.equal(result.updatedAt, "2026-07-01 18:15");
  assert.ok(Array.isArray(writtenShots));
  assert.equal(writtenShots[0].lastCollectedAt, "2026-07-01 18:15");
});
