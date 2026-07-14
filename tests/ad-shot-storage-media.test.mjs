import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { createAdShotStorageService } from "../server/ad-shots/storage-service.mjs";

test("ad shot storage skips corrupt image files and hydrates a valid fallback cover", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt2text-ad-shot-cover-"));
  try {
    const corruptPath = path.join(tempDir, "data/ad-shots/example/analysis/first-frame.jpg");
    const validPath = path.join(tempDir, "data/ad-shots/example/analysis/visual-frames/frame-01-0.00s.jpg");
    await fs.mkdir(path.dirname(validPath), { recursive: true });
    await fs.writeFile(corruptPath, "<html>not an image</html>");
    await fs.writeFile(validPath, Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]));
    const shots = [{
      shotId: "example",
      posterPath: "/data/ad-shots/example/analysis/first-frame.jpg",
      media: {
        posterPath: "/data/ad-shots/example/analysis/first-frame.jpg",
        firstFramePath: "/data/ad-shots/example/analysis/first-frame.jpg"
      },
      analysisArtifacts: {
        firstFramePath: "/data/ad-shots/example/analysis/first-frame.jpg",
        visualFramePaths: ["/data/ad-shots/example/analysis/visual-frames/frame-01-0.00s.jpg"]
      }
    }];
    const service = createAdShotStorageService({
      readJsonArrayFile: async () => structuredClone(shots),
      writeJsonFile: async () => {},
      readProjects: async () => [],
      normalizeAdShotRecord: (shot) => shot,
      normalizeText: (value) => String(value || "").trim(),
      resolveProjectPublicPath: (value) => path.join(tempDir, String(value).replace(/^\//, "")),
      files: { adShots: path.join(tempDir, "data/ad-shots.json") }
    });

    const [shot] = await service.readAdShots();
    assert.equal(shot.posterPath, "/data/ad-shots/example/analysis/visual-frames/frame-01-0.00s.jpg");
    assert.equal(shot.media.firstFramePath, "/data/ad-shots/example/analysis/visual-frames/frame-01-0.00s.jpg");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
