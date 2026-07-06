import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { createAdShotAnalysisService } from "../server/ad-shots/analysis-queue.mjs";

test("ad shot analysis queue runs two tasks concurrently across codex and agnes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt2text-ad-shot-queue-"));
  try {
    let shots = [
      createShot("shot-1", "https://www.tiktok.com/@demo/video/1"),
      createShot("shot-2", "https://www.tiktok.com/@demo/video/2")
    ];
    const buildCalls = [];
    let activeBuilds = 0;
    let maxActiveBuilds = 0;
    let releaseBuilds;
    const buildsReleased = new Promise((resolve) => {
      releaseBuilds = resolve;
    });

    const service = createAdShotAnalysisService({
      readAdShots: async () => structuredClone(shots),
      writeAdShots: async (next) => {
        shots = structuredClone(next);
      },
      readAdShotById: async (shotId) => structuredClone(shots.find((item) => item.shotId === shotId) || null),
      ensureDir: async () => {},
      runPhotoConversion: async () => {
        throw new Error("should not run photo conversion");
      },
      runPythonConversion: async (input) => ({
        title: `Title ${input}`,
        webpage_url: input,
        transcript_en: "",
        translation_zh: "",
        visual_summary: "",
        visual_text_segments: [],
        duration: 5
      }),
      runVisualOcrExtraction: async () => ({
        ok: false,
        visual_text_segments: [],
        error: "skip"
      }),
      findJobVideoFile: async () => "",
      buildAdShotAnalysis: async (shot, semantic, options = {}) => {
        buildCalls.push({
          shotId: shot.shotId,
          preferredProvider: options.preferredProvider
        });
        activeBuilds += 1;
        maxActiveBuilds = Math.max(maxActiveBuilds, activeBuilds);
        await options.onProviderEvent?.({
          type: "start",
          provider: options.preferredProvider || "codex"
        });
        await buildsReleased;
        activeBuilds -= 1;
        return {
          cardTitle: "",
          cardSummary: "",
          videoStory: "",
          script: "",
          hook: "",
          productFeatures: [],
          productMechanism: "",
          storyboardFormula: [],
          reusableTemplate: "",
          onScreenTextOriginal: "",
          onScreenTextZh: "",
          visualTextSegments: [],
          keyMoments: []
        };
      },
      analysisProviders: ["codex", "agnes"],
      normalizeVisualTextSegments: () => [],
      mergeVisualTextSegmentsWithOcr: ({ ocrSegments = [], semanticSegments = [], structuredSegments = [], fallbackSegments = [] } = {}) =>
        ocrSegments.length ? ocrSegments : (semanticSegments.length ? semanticSegments : (structuredSegments.length ? structuredSegments : fallbackSegments)),
      normalizeToPublicPath: (value) => value,
      resolveProjectPublicPath: (value) => value,
      adShotAssetsDir: tempDir,
      formatDate: () => "2026-07-06T00:00:00.000Z",
      logger: console
    });

    await service.enqueueAdShotAnalysis("shot-1");
    await service.enqueueAdShotAnalysis("shot-2");

    await waitFor(() => buildCalls.length === 2);
    assert.deepEqual(
      buildCalls.map((item) => item.preferredProvider),
      ["codex", "agnes"]
    );
    assert.equal(maxActiveBuilds, 2);

    releaseBuilds();
    await waitFor(() => shots.every((shot) => shot.analysisStatus === "completed"));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

function createShot(shotId, sourceUrl) {
  return {
    shotId,
    sourcePlatform: "tiktok",
    sourceUrl,
    mediaType: "video",
    title: shotId,
    duration: 5,
    analysisEvents: []
  };
}

async function waitFor(predicate, {
  timeoutMs = 5000,
  intervalMs = 20
} = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitFor timeout");
}
