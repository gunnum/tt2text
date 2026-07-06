import { pathToFileURL } from "node:url";

import { createApplicationServices } from "../../server/application-services.mjs";
import { createRuntimeConfig } from "../../server/runtime-config.mjs";

export function createApp() {
  const runtimeConfig = createRuntimeConfig(
    pathToFileURL(`${process.cwd()}/server.mjs`).href,
    process.env
  );
  return createApplicationServices({
    runtimeConfig,
    env: process.env,
    logger: console
  });
}

export function createVideoRuntimeConfigStub() {
  return {
    paths: {
      projectRootDir: process.cwd(),
      pythonRunner: "/tmp/python-runner.py",
      visualOcrRunner: "/tmp/ocr-runner.py",
      photoRunner: "/tmp/photo-runner.py",
      jobsDir: "/tmp/video-jobs"
    },
    binaries: {
      codexBin: "codex",
      ocrPythonBin: "python3"
    },
    progress: {
      pythonProgressPrefix: "[progress]"
    },
    timeouts: {
      videoConversionTimeoutMs: 1000,
      codexRelevanceTimeoutMs: 1000,
      visualOcrTimeoutMs: 1000
    },
    videoStageMeta: {}
  };
}
