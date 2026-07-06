import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildAdShotHighlight,
  canAnalyzeAdShot,
  normalizeAdShotSourcePlatform
} from "./normalizers.mjs";

export const AD_SHOT_ANALYSIS_STAGE_META = {
  queued: "排队等待",
  started: "开始分析",
  semantic_start: "视频转语义启动",
  semantic_download: "读取视频信息",
  semantic_detect_language: "识别语言",
  semantic_transcribe: "音频转写",
  semantic_visual: "画面理解",
  semantic_translate: "字幕翻译",
  semantic_finalize: "整理语义结果",
  semantic_completed: "视频转语义完成",
  ocr_start: "画面文字定位启动",
  ocr_completed: "画面文字定位完成",
  ocr_failed: "画面文字定位失败",
  merge_visual_text: "合并画面文字时间轴",
  llm_start: "生成素材拆解",
  llm_completed: "素材拆解完成",
  llm_warning: "素材拆解需复核",
  saving: "写入分析结果",
  completed: "分析完成",
  failed: "分析失败",
  interrupted: "分析中断",
  restart_requested: "恢复分析"
};

const DEFAULT_STALE_ANALYSIS_MS = 2 * 60 * 60 * 1000;

export function createAdShotAnalysisService(deps = {}) {
  const required = [
    "readAdShots",
    "writeAdShots",
    "readAdShotById",
    "ensureDir",
    "runPhotoConversion",
    "runPythonConversion",
    "runVisualOcrExtraction",
    "findJobVideoFile",
    "buildAdShotAnalysis",
    "normalizeVisualTextSegments",
    "mergeVisualTextSegmentsWithOcr",
    "normalizeToPublicPath",
    "resolveProjectPublicPath",
    "adShotAssetsDir",
    "formatDate"
  ];
  for (const key of required) {
    if (!deps[key]) {
      throw new Error(`缺少 Ad Shot 分析服务依赖：${key}`);
    }
  }

  const analysisLocks = new Map();
  const runLocks = new Map();
  const queue = [];
  const queueIds = new Set();
  const analysisProviders = normalizeProviderList(deps.analysisProviders);
  let queueRunning = false;
  let activeQueueWorkers = 0;
  let nextQueueProviderIndex = 0;
  const logger = deps.logger || console;

  function getMaxConcurrentWorkers() {
    return getMaxConcurrentWorkersForProviders(analysisProviders);
  }

  function pickNextQueueProvider() {
    const provider = analysisProviders[nextQueueProviderIndex % analysisProviders.length] || "codex";
    nextQueueProviderIndex = (nextQueueProviderIndex + 1) % analysisProviders.length;
    return provider;
  }

  async function analyzeAdShot(payload = {}, options = {}) {
    const shotId = normalizeText(payload.shot_id || payload.shotId || payload.id);
    if (!shotId) {
      throw new Error("缺少 Shot ID。");
    }

    if (options.fromQueue) {
      return runAdShotAnalysisNow(payload, options);
    }

    return enqueueAdShotAnalysis(shotId, options);
  }

  async function enqueueAdShotAnalysis(shotId, options = {}) {
    const normalizedShotId = normalizeText(shotId);
    if (!normalizedShotId) {
      throw new Error("缺少 Shot ID。");
    }

    if (runLocks.has(normalizedShotId) || queueIds.has(normalizedShotId)) {
      return deps.readAdShotById(normalizedShotId);
    }

    const shots = await deps.readAdShots();
    const index = shots.findIndex((item) => item.shotId === normalizedShotId);
    if (index < 0) {
      throw new Error("没有找到这个 Ad Shot。");
    }

    const shot = shots[index];
    if (!canAnalyzeAdShot(shot)) {
      throw new Error("这个 Shot 没有本地缓存视频，无法分析。");
    }

    const queuedAt = deps.formatDate(new Date());
    const message = options.resume ? "中断后已重新加入分析队列。" : "已加入分析队列，等待开始处理。";
    const previousEvents = Array.isArray(shot.analysisEvents) ? shot.analysisEvents : [];
    shots[index] = {
      ...shot,
      analysisStatus: "queued",
      analysisStage: AD_SHOT_ANALYSIS_STAGE_META.queued,
      analysisError: "",
      analysisQueuedAt: queuedAt,
      analysisProgress: {
        stageKey: "queued",
        stageLabel: AD_SHOT_ANALYSIS_STAGE_META.queued,
        message,
        updatedAt: queuedAt
      },
      analysisEvents: [
        ...previousEvents,
        buildAdShotAnalysisEvent("queued", message, queuedAt)
      ].slice(-40),
      updatedAt: queuedAt
    };
    await deps.writeAdShots(shots);

    if (!activeQueueWorkers && !queue.length) {
      nextQueueProviderIndex = 0;
    }
    queue.push({
      shotId: normalizedShotId,
      resume: Boolean(options.resume),
      preferredProvider: normalizeProvider(options.preferredProvider)
    });
    queueIds.add(normalizedShotId);
    processAdShotAnalysisQueue();
    return deps.readAdShotById(normalizedShotId);
  }

  function processAdShotAnalysisQueue() {
    if (queueRunning) {
      return;
    }
    queueRunning = true;
    setTimeout(() => {
      queueRunning = false;
      drainAdShotAnalysisQueue();
    }, 0);
  }

  function drainAdShotAnalysisQueue() {
    const maxConcurrentWorkers = getMaxConcurrentWorkers();
    while (queue.length && activeQueueWorkers < maxConcurrentWorkers) {
      const item = queue.shift();
      if (!item?.shotId) {
        continue;
      }
      queueIds.delete(item.shotId);
      activeQueueWorkers += 1;
      const preferredProvider = item.preferredProvider || pickNextQueueProvider();
      runAdShotAnalysisNow(
        { shotId: item.shotId },
        {
          fromQueue: true,
          resume: item.resume,
          preferredProvider
        }
      )
        .catch((error) => {
          logger.error?.(`Ad Shot 分析失败 ${item.shotId}:`, error);
        })
        .finally(() => {
          activeQueueWorkers = Math.max(0, activeQueueWorkers - 1);
          if (queue.length) {
            processAdShotAnalysisQueue();
          }
        });
    }
  }

  async function runAdShotAnalysisNow(payload = {}, options = {}) {
    const shotId = normalizeText(payload.shot_id || payload.shotId || payload.id);
    if (!shotId) {
      throw new Error("缺少 Shot ID。");
    }

    if (runLocks.has(shotId)) {
      return deps.readAdShotById(shotId);
    }

    const shots = await deps.readAdShots();
    const index = shots.findIndex((item) => item.shotId === shotId);
    if (index < 0) {
      throw new Error("没有找到这个 Ad Shot。");
    }

    const shot = shots[index];
    if (!canAnalyzeAdShot(shot)) {
      throw new Error("这个 Shot 没有本地缓存视频，无法分析。");
    }

    const isTikTokDetail = normalizeAdShotSourcePlatform(shot) === "tiktok";
    const isPhotoShot = normalizeText(shot.mediaType || shot.media_type).toLowerCase() === "photo"
      || /\/photo\//i.test(shot.sourceUrl || "");
    let localVideoPath = "";
    let conversionInput = "";
    let usesSourceUrl = false;
    if (shot.videoPath) {
      const cachedVideoPath = deps.resolveProjectPublicPath(shot.videoPath);
      const stat = await fs.stat(cachedVideoPath).catch(() => null);
      if (stat?.isFile()) {
        localVideoPath = cachedVideoPath;
        conversionInput = cachedVideoPath;
      } else if (!isTikTokDetail || !shot.sourceUrl) {
        throw new Error(`本地缓存视频不存在：${shot.videoPath}`);
      }
    }
    if (!conversionInput && isTikTokDetail && shot.sourceUrl) {
      conversionInput = shot.sourceUrl;
      usesSourceUrl = true;
    }
    if (!conversionInput) {
      throw new Error("这个 Shot 没有可分析的视频缓存或 TikTok 来源 URL。");
    }

    const analysisDir = path.join(deps.adShotAssetsDir, shot.shotId, "analysis");
    await deps.ensureDir(analysisDir);

    const startedAt = deps.formatDate(new Date());
    const previousEvents = Array.isArray(shot.analysisEvents) ? shot.analysisEvents : [];
    const startedMessage = isPhotoShot
      ? (options.resume ? "恢复后通过 TikTok URL 处理图集素材" : "通过 TikTok URL 处理图集素材")
      : usesSourceUrl
        ? (options.resume ? "恢复后通过 TikTok URL 下载并处理视频" : "通过 TikTok URL 下载并处理视频")
        : (options.resume ? "恢复后重新处理本地缓存视频" : "开始处理本地缓存视频");
    shots[index] = {
      ...shot,
      analysisStatus: "running",
      analysisStage: AD_SHOT_ANALYSIS_STAGE_META.started,
      analysisError: "",
      analysisStartedAt: startedAt,
      analysisProgress: {
        stageKey: "started",
        stageLabel: AD_SHOT_ANALYSIS_STAGE_META.started,
        message: startedMessage,
        updatedAt: startedAt
      },
      analysisEvents: [
        ...previousEvents,
        buildAdShotAnalysisEvent("started", startedMessage, startedAt)
      ].slice(-40),
      updatedAt: startedAt
    };
    await deps.writeAdShots(shots);

    const runPromise = (async () => {
      const duration = Number(shot.duration) || null;
      const progress = (stageKey, message = "") => markAdShotAnalysisStage(shotId, stageKey, message);
      try {
        await progress("semantic_start", isPhotoShot
          ? "启动 TikTok 图集视觉理解脚本"
          : usesSourceUrl
            ? "启动 TikTok URL 下载和视频转语义脚本"
            : "启动视频转语义脚本");
        const semantic = isPhotoShot
          ? await deps.runPhotoConversion(conversionInput, analysisDir, {
              text: shot.title || shot.raw?.publishedText || "",
              title: shot.title || "",
              posterUrl: shot.posterPath || "",
              coverUrl: shot.posterPath || "",
              imageUrls: shot.raw?.imageUrls || shot.raw?.image_urls || shot.imageUrls || shot.image_urls || [],
              image_urls: shot.raw?.imageUrls || shot.raw?.image_urls || shot.imageUrls || shot.image_urls || [],
              mediaType: "photo",
              author: shot.raw?.author || "",
              engagement: shot.raw?.performance || {}
            }, async (event) => {
              await progress(`semantic_${event?.stageKey || "started"}`, event?.message || "");
            })
          : await deps.runPythonConversion(conversionInput, analysisDir, async (event) => {
              await progress(`semantic_${event?.stageKey || "started"}`, event?.message || "");
            }, {
              alwaysVisual: true,
              visualFrameInterval: 1,
              maxVisualFrames: 60
            });
        await progress("semantic_completed", isPhotoShot ? "图集视觉理解结果已返回" : "转写、翻译和画面理解结果已返回");

        const ocrVideoPath = isPhotoShot ? "" : (localVideoPath || await deps.findJobVideoFile(analysisDir));
        const visualOcr = isPhotoShot
          ? {
              ok: false,
              visual_text_segments: [],
              error: "图集素材不执行视频 OCR 定位。"
            }
          : ocrVideoPath
            ? await (async () => {
                await progress("ocr_start", "启动画面文字 OCR 定位");
                const result = await deps.runVisualOcrExtraction(ocrVideoPath, analysisDir);
                await progress(result?.ok ? "ocr_completed" : "ocr_failed", result?.ok
                  ? `识别到 ${Array.isArray(result.visual_text_segments || result.visualTextSegments) ? (result.visual_text_segments || result.visualTextSegments).length : 0} 段画面文字`
                  : (result?.error || "OCR 没有返回有效结果"));
                return result;
              })()
            : {
                ok: false,
                visual_text_segments: [],
                error: "视频转语义后没有找到本地视频文件，跳过 OCR 定位。"
              };
        if (!isPhotoShot && !ocrVideoPath) {
          await progress("ocr_failed", visualOcr.error);
        }
        const ocrVisualTextSegments = deps.normalizeVisualTextSegments(visualOcr?.visual_text_segments || visualOcr?.visualTextSegments, duration);
        await progress("merge_visual_text", `合并 ${ocrVisualTextSegments.length} 段 OCR 画面文字`);
        const semanticForAnalysis = ocrVisualTextSegments.length
          ? {
              ...semantic,
              visual_text_segments: deps.mergeVisualTextSegmentsWithOcr({
                duration,
                ocrSegments: ocrVisualTextSegments,
                semanticSegments: semantic.visual_text_segments || semantic.visualTextSegments
              })
            }
          : semantic;
        const structured = await deps.buildAdShotAnalysis(shot, semanticForAnalysis, {
          preferredProvider: normalizeProvider(options.preferredProvider) || "codex",
          onProviderEvent: async (event) => {
            if (!event || typeof event !== "object") {
              return;
            }
            if (event.type === "start") {
              await progress("llm_start", `调用 ${providerLabel(event.provider)} 生成素材拆解 JSON`);
              return;
            }
            if (event.type === "fallback") {
              await progress(
                "llm_start",
                buildProviderFallbackMessage(event.fromProvider, event.toProvider, event.fromError)
              );
            }
          }
        });
        await progress(structured.structureError ? "llm_warning" : "llm_completed", structured.structureError || "素材拆解 JSON 已生成");
        await progress("saving", "写入字幕、画面文字和素材拆解结果");
        const completedAt = deps.formatDate(new Date());
        const latestShots = await deps.readAdShots();
        const latestIndex = latestShots.findIndex((item) => item.shotId === shotId);
        if (latestIndex < 0) {
          throw new Error("分析完成后没有找到原 Shot 记录。");
        }

        const latestDuration = Number(latestShots[latestIndex].duration || shot.duration) || null;
        const cachedAnalysisVideoPath = ocrVideoPath ? deps.normalizeToPublicPath(ocrVideoPath) : "";
        const analysisFirstFramePath = semanticForAnalysis.first_frame_path ? deps.normalizeToPublicPath(semanticForAnalysis.first_frame_path) : "";
        const rawSemanticImagePaths = Array.isArray(semanticForAnalysis.image_paths)
          ? semanticForAnalysis.image_paths
          : Array.isArray(semanticForAnalysis.imagePaths)
            ? semanticForAnalysis.imagePaths
            : [];
        const semanticImagePaths = rawSemanticImagePaths.map(deps.normalizeToPublicPath).filter(Boolean);
        const finalMediaType = isPhotoShot
          ? "photo"
          : normalizeText(latestShots[latestIndex].mediaType || latestShots[latestIndex].media_type || shot.mediaType) || "video";
        const finalVisualTextSegments = deps.mergeVisualTextSegmentsWithOcr({
          duration: latestDuration,
          ocrSegments: ocrVisualTextSegments,
          semanticSegments: structured.visualTextSegments,
          structuredSegments: semanticForAnalysis.visual_text_segments || semanticForAnalysis.visualTextSegments,
          fallbackSegments: latestShots[latestIndex].visualTextSegments
        });
        const updated = {
          ...latestShots[latestIndex],
          title: latestShots[latestIndex].title || semanticForAnalysis.title || shot.title,
          analysisStatus: "completed",
          analysisStage: AD_SHOT_ANALYSIS_STAGE_META.completed,
          analysisError: "",
          analysisCompletedAt: completedAt,
          analysisProgress: {
            stageKey: "completed",
            stageLabel: AD_SHOT_ANALYSIS_STAGE_META.completed,
            message: "分析结果已入库",
            updatedAt: completedAt
          },
          analysisEvents: [
            ...(Array.isArray(latestShots[latestIndex].analysisEvents) ? latestShots[latestIndex].analysisEvents : []),
            buildAdShotAnalysisEvent("completed", "分析结果已入库", completedAt)
          ].slice(-40),
          analysisSummary: {
            ...structured,
            highlight: buildAdShotHighlight({ ...latestShots[latestIndex], analysisSummary: structured })
          },
          videoPath: cachedAnalysisVideoPath || latestShots[latestIndex].videoPath || "",
          posterPath: analysisFirstFramePath || latestShots[latestIndex].posterPath || "",
          transcriptEn: semanticForAnalysis.transcript_en || "",
          transcriptZh: semanticForAnalysis.translation_zh || "",
          onScreenTextOriginal: structured.onScreenTextOriginal || latestShots[latestIndex].onScreenTextOriginal || "",
          onScreenTextZh: structured.onScreenTextZh || latestShots[latestIndex].onScreenTextZh || "",
          visualTextSegments: finalVisualTextSegments,
          visualSummary: semanticForAnalysis.visual_summary || "",
          sourceLanguage: semanticForAnalysis.source_language || "",
          sourceLanguageProbability: semanticForAnalysis.source_language_probability ?? null,
          mediaType: finalMediaType,
          imagePaths: semanticImagePaths.length
            ? semanticImagePaths
            : Array.isArray(latestShots[latestIndex].imagePaths)
              ? latestShots[latestIndex].imagePaths
              : [],
          media: {
            ...(latestShots[latestIndex].media && typeof latestShots[latestIndex].media === "object" ? latestShots[latestIndex].media : {}),
            videoPath: cachedAnalysisVideoPath || latestShots[latestIndex].videoPath || latestShots[latestIndex].media?.videoPath || "",
            posterPath: analysisFirstFramePath || latestShots[latestIndex].posterPath || latestShots[latestIndex].media?.posterPath || "",
            firstFramePath: analysisFirstFramePath || latestShots[latestIndex].firstFramePath || latestShots[latestIndex].media?.firstFramePath || ""
          },
          analysisArtifacts: {
            firstFramePath: analysisFirstFramePath,
            visualFramePaths: Array.isArray(semanticForAnalysis.visual_frame_paths)
              ? semanticForAnalysis.visual_frame_paths.map(deps.normalizeToPublicPath)
              : [],
            imagePaths: semanticImagePaths,
            mediaType: finalMediaType,
            visualOcrStatus: visualOcr?.ok ? "completed" : "skipped",
            visualOcrError: visualOcr?.ok ? "" : truncateText(normalizeText(visualOcr?.error), 600),
            visualOcrPath: visualOcr?.output_path ? deps.normalizeToPublicPath(visualOcr.output_path) : "",
            visualOcrFramePaths: Array.isArray(visualOcr?.frame_paths)
              ? visualOcr.frame_paths.map(deps.normalizeToPublicPath)
              : [],
            visualOcrSegmentCount: ocrVisualTextSegments.length
          },
          updatedAt: completedAt
        };
        latestShots[latestIndex] = updated;
        await deps.writeAdShots(latestShots);
        return updated;
      } catch (error) {
        const failedAt = deps.formatDate(new Date());
        const latestShots = await deps.readAdShots();
        const latestIndex = latestShots.findIndex((item) => item.shotId === shotId);
        if (latestIndex >= 0) {
          const latestShot = latestShots[latestIndex];
          const errorMessage = error instanceof Error ? error.message : String(error);
          const hasCompletedAnalysis = latestShot.analysisStatus === "completed"
            || (latestShot.analysisSummary && typeof latestShot.analysisSummary === "object" && Object.keys(latestShot.analysisSummary).length > 0)
            || Boolean(latestShot.transcriptZh || latestShot.visualSummary || latestShot.analysisCompletedAt);
          latestShots[latestIndex] = {
            ...latestShot,
            analysisStatus: hasCompletedAnalysis ? "completed" : "failed",
            analysisStage: hasCompletedAnalysis ? AD_SHOT_ANALYSIS_STAGE_META.completed : AD_SHOT_ANALYSIS_STAGE_META.failed,
            analysisError: errorMessage,
            analysisProgress: {
              stageKey: hasCompletedAnalysis ? "completed_with_warning" : "failed",
              stageLabel: hasCompletedAnalysis ? "分析完成（重跑失败）" : AD_SHOT_ANALYSIS_STAGE_META.failed,
              message: errorMessage,
              updatedAt: failedAt
            },
            analysisEvents: [
              ...(Array.isArray(latestShot.analysisEvents) ? latestShot.analysisEvents : []),
              buildAdShotAnalysisEvent("failed", errorMessage, failedAt)
            ].slice(-40),
            updatedAt: failedAt
          };
          await deps.writeAdShots(latestShots);
        }
        throw error;
      }
    })().finally(() => {
      if (runLocks.get(shotId) === runPromise) {
        runLocks.delete(shotId);
      }
    });

    runLocks.set(shotId, runPromise);
    if (options.wait === false) {
      runPromise.catch(() => {});
      return deps.readAdShotById(shotId);
    }
    return runPromise;
  }

  function buildAdShotAnalysisEvent(stageKey, message = "", at = deps.formatDate(new Date())) {
    const normalizedStageKey = normalizeText(stageKey) || "started";
    const stageLabel = AD_SHOT_ANALYSIS_STAGE_META[normalizedStageKey] || normalizedStageKey;
    return {
      stageKey: normalizedStageKey,
      stageLabel,
      message: truncateText(normalizeText(message), 600),
      at
    };
  }

  async function markAdShotAnalysisStage(shotId, stageKey, message = "") {
    const normalizedShotId = normalizeText(shotId);
    if (!normalizedShotId) {
      return null;
    }

    const previous = analysisLocks.get(normalizedShotId) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const at = deps.formatDate(new Date());
        const event = buildAdShotAnalysisEvent(stageKey, message, at);
        const shots = await deps.readAdShots();
        const index = shots.findIndex((item) => item.shotId === normalizedShotId);
        if (index < 0) {
          return null;
        }
        if (shots[index].analysisStatus !== "running") {
          return shots[index];
        }

        const history = Array.isArray(shots[index].analysisEvents) ? shots[index].analysisEvents.slice() : [];
        const last = history[history.length - 1];
        if (!last || last.stageKey !== event.stageKey || event.message) {
          history.push(event);
        }

        shots[index] = {
          ...shots[index],
          analysisStatus: "running",
          analysisStage: event.stageLabel,
          analysisProgress: {
            stageKey: event.stageKey,
            stageLabel: event.stageLabel,
            message: event.message,
            updatedAt: at
          },
          analysisEvents: history.slice(-40),
          updatedAt: at
        };
        await deps.writeAdShots(shots);
        return shots[index];
      });

    analysisLocks.set(normalizedShotId, next);
    try {
      return await next;
    } finally {
      if (analysisLocks.get(normalizedShotId) === next) {
        analysisLocks.delete(normalizedShotId);
      }
    }
  }

  async function recoverInterruptedAdShotAnalyses() {
    const shots = await deps.readAdShots();
    let changed = false;
    const recoveredAt = deps.formatDate(new Date());
    const shotIdsToResume = [];
    const recovered = shots.map((shot) => {
      const progressKey = normalizeText(shot.analysisProgress?.stageKey || shot.analysis_stage_key).toLowerCase();
      const shouldResume = shot.analysisStatus === "queued"
        || shot.analysisStatus === "running"
        || (shot.analysisStatus === "failed" && progressKey === "interrupted");
      if (!shouldResume) {
        return shot;
      }

      changed = true;
      shotIdsToResume.push(shot.shotId);
      const resumeMessage = shot.analysisStatus === "queued"
        ? "检测到服务重启前排队中的分析，已自动恢复队列。"
        : shot.analysisStatus === "running"
          ? "检测到服务重启前未完成的分析，已自动恢复。"
          : "检测到之前中断的分析，已自动重新开始。";
      const resumeEvent = buildAdShotAnalysisEvent("restart_requested", resumeMessage, recoveredAt);
      return {
        ...shot,
        analysisStatus: "running",
        analysisStage: AD_SHOT_ANALYSIS_STAGE_META.restart_requested,
        analysisError: "",
        analysisProgress: {
          stageKey: "restart_requested",
          stageLabel: AD_SHOT_ANALYSIS_STAGE_META.restart_requested,
          message: resumeMessage,
          updatedAt: recoveredAt
        },
        analysisEvents: [
          ...(Array.isArray(shot.analysisEvents) ? shot.analysisEvents : []),
          resumeEvent
        ].slice(-40),
        analysisResumedAt: recoveredAt,
        updatedAt: recoveredAt
      };
    });

    if (changed) {
      await deps.writeAdShots(recovered);
      for (const shotId of shotIdsToResume.filter(Boolean)) {
        setTimeout(() => {
          enqueueAdShotAnalysis(shotId, { resume: true }).catch((error) => {
            logger.error?.(`Ad Shot 自动恢复失败 ${shotId}:`, error);
          });
        }, 0);
      }
    }
  }

  async function scanAndRequeueAnomalousAdShotAnalyses(options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const staleMs = Number(options.staleMs) > 0 ? Number(options.staleMs) : DEFAULT_STALE_ANALYSIS_MS;
    const limit = Number(options.limit) > 0 ? Number(options.limit) : 20;
    const shots = await deps.readAdShots();
    const candidates = shots
      .filter((shot) => shouldRequeueAnomalousShot(shot, now, staleMs))
      .slice(0, limit);
    const queued = [];
    const skipped = [];
    for (const shot of candidates) {
      try {
        await enqueueAdShotAnalysis(shot.shotId, { resume: true });
        queued.push(shot.shotId);
      } catch (error) {
        skipped.push({
          shotId: shot.shotId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return {
      checkedAt: deps.formatDate(now),
      checkedCount: shots.length,
      candidateCount: candidates.length,
      queuedCount: queued.length,
      queuedShotIds: queued,
      skipped
    };
  }

  function shouldRequeueAnomalousShot(shot = {}, now = new Date(), staleMs = DEFAULT_STALE_ANALYSIS_MS) {
    if (!shot?.shotId || !canAnalyzeAdShot(shot)) return false;
    const status = normalizeText(shot.analysisStatus).toLowerCase();
    if (status === "failed") return true;
    if ((status === "queued" || status === "running") && isStaleAnalysisShot(shot, now, staleMs)) return true;
    if (isTikTokPhotoShot(shot) && isMissingPhotoAnalysis(shot)) return true;
    return false;
  }

  function isStaleAnalysisShot(shot = {}, now = new Date(), staleMs = DEFAULT_STALE_ANALYSIS_MS) {
    const lastAt = [
      shot.analysisProgress?.updatedAt,
      shot.updatedAt,
      shot.analysisStartedAt,
      shot.analysisQueuedAt
    ].map((value) => Date.parse(value || "")).filter(Number.isFinite).sort((a, b) => b - a)[0];
    return Number.isFinite(lastAt) ? now.getTime() - lastAt > staleMs : true;
  }

  function isTikTokPhotoShot(shot = {}) {
    return normalizeAdShotSourcePlatform(shot) === "tiktok"
      && (normalizeText(shot.mediaType || shot.media_type).toLowerCase() === "photo" || /\/photo\//i.test(shot.sourceUrl || ""));
  }

  function isMissingPhotoAnalysis(shot = {}) {
    const status = normalizeText(shot.analysisStatus).toLowerCase();
    if (status === "queued" || status === "running") return false;
    const imagePaths = [
      ...(Array.isArray(shot.imagePaths) ? shot.imagePaths : []),
      ...(Array.isArray(shot.media?.imagePaths) ? shot.media.imagePaths : []),
      ...(Array.isArray(shot.analysisArtifacts?.imagePaths) ? shot.analysisArtifacts.imagePaths : [])
    ].filter(Boolean);
    const hasAnalysis = status === "completed"
      && (Boolean(shot.analysisSummary && typeof shot.analysisSummary === "object" && Object.keys(shot.analysisSummary).length)
        || Boolean(shot.visualSummary)
        || imagePaths.length > 0);
    return !hasAnalysis;
  }

  return {
    analyzeAdShot,
    enqueueAdShotAnalysis,
    runAdShotAnalysisNow,
    recoverInterruptedAdShotAnalyses,
    scanAndRequeueAnomalousAdShotAnalyses,
    buildAdShotAnalysisEvent,
    markAdShotAnalysisStage
  };
}

function getMaxConcurrentWorkersForProviders(providers = []) {
  return providers.includes("agnes") ? 2 : 1;
}

function normalizeProviderList(providers = []) {
  const normalized = Array.isArray(providers)
    ? providers.map((provider) => normalizeProvider(provider)).filter(Boolean)
    : [];
  return normalized.length ? normalized : ["codex"];
}

function normalizeProvider(value) {
  const provider = normalizeText(value).toLowerCase();
  return ["codex", "agnes"].includes(provider) ? provider : "";
}

function providerLabel(provider) {
  return normalizeProvider(provider) === "agnes" ? "Agnes" : "Codex CLI";
}

function buildProviderFallbackMessage(fromProvider, toProvider, error) {
  const reason = normalizeText(error instanceof Error ? error.message : error);
  const reasonLabel = /超时|timeout/i.test(reason) ? "超时" : (reason ? "失败" : "不可用");
  return `${providerLabel(fromProvider)} ${reasonLabel}，切换 ${providerLabel(toProvider)} 继续生成素材拆解`;
}

function truncateText(value, maxLength) {
  const text = normalizeText(value);
  if (!maxLength || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
