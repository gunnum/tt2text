import {
  createCodexJsonService
} from "./codex-json-service.mjs";
import {
  createAgnesJsonService
} from "./agnes-json-service.mjs";
import {
  createNormalVideoAnalysisService
} from "./normal-video-analysis.mjs";
import {
  createTikTokService
} from "./tiktok-service.mjs";
import {
  createVideoRelevanceService
} from "./video-relevance-service.mjs";
import {
  createVideoRunnerService
} from "./video-runner-service.mjs";
import {
  mergeVisualTextSegmentsWithOcr,
  normalizeVisualTextSegments
} from "./ad-shots/visual-text.mjs";

export function createVideoAnalysisServices(deps = {}) {
  const requiredDeps = [
    "runtimeConfig",
    "readResults",
    "writeResults",
    "readTikTokCommentsRaw",
    "writeTikTokComments",
    "createJobId",
    "normalizeVideoUrl",
    "normalizeText",
    "truncateText",
    "normalizeToPublicPath",
    "formatDate",
    "ensureDir"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createVideoAnalysisServices 缺少依赖：${dep}`);
    }
  }

  const {
    runtimeConfig,
    readResults,
    writeResults,
    readTikTokCommentsRaw,
    writeTikTokComments,
    readAdShots,
    writeAdShots,
    createJobId,
    normalizeVideoUrl,
    normalizeText,
    truncateText,
    normalizeToPublicPath,
    formatDate,
    ensureDir,
    env = process.env
  } = deps;
  const {
    paths,
    binaries,
    progress,
    timeouts
  } = runtimeConfig;
  const {
    projectRootDir,
    pythonRunner,
    visualOcrRunner,
    photoRunner
  } = paths;
  const {
    codexBin,
    ocrPythonBin
  } = binaries;
  const {
    pythonProgressPrefix
  } = progress;
  const {
    videoConversionTimeoutMs,
    codexRelevanceTimeoutMs,
    visualOcrTimeoutMs
  } = timeouts;

  const videoRunnerService = createVideoRunnerService({
    projectRootDir,
    pythonRunner,
    visualOcrRunner,
    photoRunner,
    videoConversionTimeoutMs,
    visualOcrTimeoutMs,
    ocrPythonBin,
    progressPrefix: pythonProgressPrefix,
    normalizeText,
    truncateText
  });
  const {
    runPythonConversion,
    runVisualOcrExtraction,
    runVisualOnlyConversion,
    runPhotoConversion
  } = videoRunnerService;

  const codexJsonService = createCodexJsonService({
    codexBin,
    projectRootDir,
    env
  });
  const { runCodexJsonTask } = codexJsonService;
  const agnesJsonService = createAgnesJsonService({
    projectRootDir,
    env
  });
  const { runAgnesJsonTask } = agnesJsonService;
  const availableAnalysisProviders = [
    "codex",
    ...(agnesJsonService.isAvailable() ? ["agnes"] : [])
  ];

  async function runStructuredJsonTask(prompt, timeoutMs, options = {}) {
    const order = providerOrder(options.preferredProvider, availableAnalysisProviders);
    const errors = [];
    let previousError = null;
    for (let index = 0; index < order.length; index += 1) {
      const provider = order[index];
      const previousProvider = index > 0 ? order[index - 1] : "";
      if (index > 0 && typeof options.onProviderEvent === "function") {
        await options.onProviderEvent({
          type: "fallback",
          fromProvider: previousProvider,
          toProvider: provider,
          fromError: previousError
        });
      }
      if (typeof options.onProviderEvent === "function") {
        await options.onProviderEvent({
          type: "start",
          provider
        });
      }
      try {
        const runner = provider === "agnes" ? runAgnesJsonTask : runCodexJsonTask;
        const content = await runner(prompt, timeoutMs, options);
        if (typeof options.onProviderEvent === "function") {
          await options.onProviderEvent({
            type: "success",
            provider
          });
        }
        return content;
      } catch (error) {
        previousError = error;
        errors.push(`${providerLabel(provider)}：${error instanceof Error ? error.message : String(error)}`);
        if (typeof options.onProviderEvent === "function") {
          await options.onProviderEvent({
            type: "error",
            provider,
            error
          });
        }
      }
    }
    throw new Error(errors.join(" | "));
  }

  const videoRelevanceService = createVideoRelevanceService({
    runJsonTask: runStructuredJsonTask,
    timeoutMs: codexRelevanceTimeoutMs,
    normalizeText,
    truncateText,
    formatDate
  });
  const { assessVideoRelevance } = videoRelevanceService;

  const normalVideoAnalysisService = createNormalVideoAnalysisService({
    runJsonTask: runStructuredJsonTask,
    timeoutMs: codexRelevanceTimeoutMs,
    normalizeVisualTextSegments,
    mergeVisualTextSegmentsWithOcr,
    normalizeText,
    truncateText,
    normalizeToPublicPath,
    formatDate,
    ensureDir,
    runVisualOcrExtraction
  });
  const {
    normalizeVideoSemanticPayload,
    buildNormalVideoVisualTextAnalysis,
    buildNormalVideoMaterialAnalysis,
    findJobVideoFile,
    buildAdShotAnalysis
  } = normalVideoAnalysisService;

  const tiktokService = createTikTokService({
    runtimeConfig,
    readResults,
    writeResults,
    readComments: readTikTokCommentsRaw,
    writeComments: writeTikTokComments,
    readAdShots,
    writeAdShots,
    createJobId,
    formatDate,
    normalizeToPublicPath,
    normalizeText,
    normalizeVideoUrl,
    ensureDir
  });
  const {
    importTikTokComments,
    normalizeTikTokEngagement,
    mergeTikTokEngagement,
    normalizePublishedDate,
    extractTikTokAuthor
  } = tiktokService;

  return {
    analysisDeps: {
      runPhotoConversion,
      runPythonConversion,
      runVisualOcrExtraction,
      runVisualOnlyConversion,
      normalizeVideoSemanticPayload,
      buildNormalVideoVisualTextAnalysis,
      buildNormalVideoMaterialAnalysis,
      findJobVideoFile,
      buildAdShotAnalysis,
      analysisProviders: availableAnalysisProviders,
      normalizeTikTokEngagement,
      mergeTikTokEngagement,
      normalizePublishedDate,
      extractTikTokAuthor,
      assessVideoRelevance,
      normalizeVisualTextSegments,
      mergeVisualTextSegmentsWithOcr
    },
    routeDeps: {
      importTikTokComments
    }
  };
}

function providerOrder(preferredProvider, availableProviders = []) {
  const normalized = normalizeProvider(preferredProvider);
  const providers = Array.isArray(availableProviders) && availableProviders.length
    ? availableProviders
    : ["codex"];
  if (!normalized || !providers.includes(normalized)) {
    return providers.slice();
  }
  return [normalized, ...providers.filter((provider) => provider !== normalized)];
}

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return ["codex", "agnes"].includes(provider) ? provider : "";
}

function providerLabel(provider) {
  return provider === "agnes" ? "Agnes" : "Codex CLI";
}
