import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { createAdShotAnalysisService } from "../server/ad-shots/analysis-queue.mjs";
import { preserveAdShotVideo } from "../server/ad-shots/media-storage.mjs";

test("preserveAdShotVideo promotes an analysis copy to the durable shot directory", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt2text-ad-shot-media-"));
  try {
    const shotDir = path.join(tempDir, "shot-media");
    const analysisDir = path.join(shotDir, "analysis");
    await fs.mkdir(analysisDir, { recursive: true });
    const analysisVideoPath = path.join(analysisDir, "video.mp4");
    await fs.writeFile(analysisVideoPath, "video-content");

    const durablePath = await preserveAdShotVideo({ sourcePath: analysisVideoPath, shotDir });

    assert.equal(durablePath, path.join(shotDir, "video.mp4"));
    assert.equal(await fs.readFile(durablePath, "utf8"), "video-content");
    assert.equal(await fs.readFile(analysisVideoPath, "utf8"), "video-content");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("reanalysis promotes a legacy analysis video before invoking conversion", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt2text-ad-shot-reanalysis-"));
  try {
    const shotId = "shot-legacy";
    const shotDir = path.join(tempDir, shotId);
    const analysisDir = path.join(shotDir, "analysis");
    await fs.mkdir(analysisDir, { recursive: true });
    const legacyVideoPath = path.join(analysisDir, "video.mp4");
    await fs.writeFile(legacyVideoPath, "legacy-video");
    let shots = [{
      ...createShot(shotId, "https://www.tiktok.com/@demo/video/legacy"),
      videoPath: legacyVideoPath,
      analysisStatus: "completed",
      analysisSummary: { script: "已有分析" }
    }];
    let conversionInput = "";

    const service = createAdShotAnalysisService({
      readAdShots: async () => structuredClone(shots),
      writeAdShots: async (next) => {
        shots = structuredClone(next);
      },
      readAdShotById: async (id) => structuredClone(shots.find((item) => item.shotId === id) || null),
      ensureDir: (dir) => fs.mkdir(dir, { recursive: true }),
      runPhotoConversion: async () => { throw new Error("should not run photo conversion"); },
      runPythonConversion: async (input) => {
        conversionInput = input;
        assert.equal(await fs.readFile(input, "utf8"), "legacy-video");
        return { transcript_en: "", translation_zh: "", visual_summary: "", visual_text_segments: [] };
      },
      runVisualOcrExtraction: async () => ({ ok: false, visual_text_segments: [], error: "skip" }),
      findJobVideoFile: async () => legacyVideoPath,
      buildAdShotAnalysis: async () => ({ script: "新分析", visualTextSegments: [] }),
      normalizeVisualTextSegments: () => [],
      mergeVisualTextSegmentsWithOcr: ({ fallbackSegments = [] } = {}) => fallbackSegments,
      normalizeToPublicPath: (value) => value,
      resolveProjectPublicPath: (value) => value,
      adShotAssetsDir: tempDir,
      formatDate: () => "2026-07-13 20:00",
      logger: console
    });

    await service.runAdShotAnalysisNow({ shotId });

    const durablePath = path.join(shotDir, "video.mp4");
    assert.equal(conversionInput, durablePath);
    assert.equal(shots[0].videoPath, durablePath);
    assert.equal(shots[0].media.videoPath, durablePath);
    assert.equal(await fs.readFile(durablePath, "utf8"), "legacy-video");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

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

test("queued analysis repairs a stale persisted status without duplicating the task", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt2text-ad-shot-queue-repair-"));
  try {
    let shots = [
      createShot("shot-active", "https://www.tiktok.com/@demo/video/active"),
      createShot("shot-waiting", "https://www.tiktok.com/@demo/video/waiting")
    ];
    let releaseActive;
    const activeReleased = new Promise((resolve) => {
      releaseActive = resolve;
    });
    const buildCalls = [];
    const service = createAdShotAnalysisService({
      readAdShots: async () => structuredClone(shots),
      writeAdShots: async (next) => {
        shots = structuredClone(next);
      },
      readAdShotById: async (shotId) => structuredClone(shots.find((item) => item.shotId === shotId) || null),
      ensureDir: async () => {},
      runPhotoConversion: async () => { throw new Error("should not run photo conversion"); },
      runPythonConversion: async (input) => ({
        title: input,
        webpage_url: input,
        transcript_en: "",
        translation_zh: "",
        visual_summary: "",
        visual_text_segments: [],
        duration: 5
      }),
      runVisualOcrExtraction: async () => ({ ok: false, visual_text_segments: [], error: "skip" }),
      findJobVideoFile: async () => "",
      buildAdShotAnalysis: async (shot) => {
        buildCalls.push(shot.shotId);
        if (shot.shotId === "shot-active") await activeReleased;
        return { script: "分析完成", visualTextSegments: [] };
      },
      analysisProviders: ["codex"],
      normalizeVisualTextSegments: () => [],
      mergeVisualTextSegmentsWithOcr: ({ fallbackSegments = [] } = {}) => fallbackSegments,
      normalizeToPublicPath: (value) => value,
      resolveProjectPublicPath: (value) => value,
      adShotAssetsDir: tempDir,
      formatDate: () => "2026-07-13 23:30",
      logger: console
    });

    await service.enqueueAdShotAnalysis("shot-active");
    await waitFor(() => buildCalls.includes("shot-active"));
    await service.enqueueAdShotAnalysis("shot-waiting");
    shots[1].analysisStatus = "pending";
    shots[1].analysisProgress = null;

    const repaired = await service.enqueueAdShotAnalysis("shot-waiting");
    assert.equal(repaired.analysisStatus, "queued");
    assert.equal(shots[1].analysisStatus, "queued");
    assert.match(shots[1].analysisProgress.message, /修复持久化队列状态/);

    releaseActive();
    await waitFor(() => shots.every((shot) => shot.analysisStatus === "completed"));
    assert.deepEqual(buildCalls, ["shot-active", "shot-waiting"]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("ad shot analysis failure does not treat placeholder summary as completed", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt2text-ad-shot-fail-"));
  try {
    let shots = [
      {
        ...createShot("shot-fail", "https://www.tiktok.com/@demo/video/fail"),
        analysisStatus: "pending",
        analysisSummary: {
          cardTitle: "",
          cardSummary: "",
          script: "等待接入视频转语义工作流。",
          hook: "等待分析。",
          productMechanism: "等待分析。",
          reusableTemplate: "等待分析。",
          onScreenTextOriginal: "",
          onScreenTextZh: "",
          visualTextSegments: []
        }
      }
    ];

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
      runPythonConversion: async () => {
        throw new Error("转写超时（>20 分钟），任务已终止，可点击重试。");
      },
      runVisualOcrExtraction: async () => ({
        ok: false,
        visual_text_segments: [],
        error: "skip"
      }),
      findJobVideoFile: async () => "",
      buildAdShotAnalysis: async () => {
        throw new Error("should not build analysis");
      },
      normalizeVisualTextSegments: () => [],
      mergeVisualTextSegmentsWithOcr: ({ fallbackSegments = [] } = {}) => fallbackSegments,
      normalizeToPublicPath: (value) => value,
      resolveProjectPublicPath: (value) => value,
      adShotAssetsDir: tempDir,
      formatDate: () => "2026-07-13 10:51",
      logger: console
    });

    await assert.rejects(
      () => service.runAdShotAnalysisNow({ shotId: "shot-fail" }),
      /转写超时/
    );
    assert.equal(shots[0].analysisStatus, "failed");
    assert.equal(shots[0].analysisProgress.stageKey, "failed");
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
