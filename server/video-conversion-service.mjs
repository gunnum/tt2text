import path from "node:path";

export function createVideoConversionService(deps = {}) {
  const requiredDeps = [
    "findAppById",
    "pickResultAppFields",
    "createJobId",
    "normalizeVideoUrl",
    "normalizeText",
    "truncateText",
    "normalizeTikTokEngagement",
    "normalizePublishedDate",
    "extractTikTokAuthor",
    "formatDate",
    "normalizeToPublicPath",
    "jobsDir",
    "stageMeta",
    "readVideoJobs",
    "writeVideoJobs",
    "readResults",
    "writeResults",
    "buildStageHistoryEntry",
    "updateVideoJob",
    "markVideoJobStage",
    "runPhotoConversion",
    "runPythonConversion",
    "runVisualOnlyConversion",
    "ensureDir",
    "normalizeVideoSemanticPayload",
    "buildNormalVideoVisualTextAnalysis",
    "buildNormalVideoMaterialAnalysis",
    "findJobVideoFile",
    "mergeTikTokEngagement",
    "assessVideoRelevance",
    "appendConversionErrorLog"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createVideoConversionService 缺少依赖：${dep}`);
    }
  }

  let queueRunning = false;

  async function enqueueVideoConversion(videoUrl, appId, preview = {}) {
    const app = await deps.findAppById(appId);
    if (!app) {
      throw new Error("选择的 App 不存在，请先重新录入或刷新页面。");
    }

    const slug = deps.createJobId();
    const job = {
      id: slug,
      sourceUrl: videoUrl,
      normalizedUrl: deps.normalizeVideoUrl(videoUrl),
      appId: app.id,
      app: deps.pickResultAppFields(app),
      status: "queued",
      progress: 0,
      stage: deps.stageMeta.queued.label,
      stageKey: "queued",
      stageHistory: [deps.buildStageHistoryEntry("queued")],
      title: "",
      mediaType: deps.normalizeText(preview.mediaType) || "video",
      previewText: deps.truncateText(deps.normalizeText(preview.text || preview.caption || preview.title || ""), 500),
      coverUrl: deps.normalizeText(preview.coverUrl || preview.thumbnailUrl || preview.posterUrl || ""),
      author: deps.normalizeText(preview.author || ""),
      duration: deps.normalizeText(preview.duration || ""),
      engagement: deps.normalizeTikTokEngagement(preview.engagement || preview),
      publishedAt: deps.normalizePublishedDate(preview.publishedAt || preview.uploadDate || ""),
      publishedText: deps.normalizeText(preview.publishedText || preview.publishText || preview.uploadDate || ""),
      resultId: "",
      error: "",
      retryCount: 0,
      jobDir: deps.normalizeToPublicPath(path.join(deps.jobsDir, slug)),
      createdAt: deps.formatDate(new Date()),
      updatedAt: deps.formatDate(new Date()),
      startedAt: "",
      finishedAt: ""
    };

    const jobs = await deps.readVideoJobs();
    jobs.unshift(job);
    await deps.writeVideoJobs(jobs);
    processVideoQueue();
    return job;
  }

  async function enqueueVideoBatch(payload) {
    const app = await deps.findAppById(payload.appId);
    if (!app) {
      throw new Error("选择的 App 不存在，请先重新录入或刷新页面。");
    }

    const limit = Math.max(1, Math.min(200, Number(payload.limit) || 60));
    const rawItems = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.urls) ? payload.urls : [];
    const candidates = rawItems
      .map(normalizeVideoCandidate)
      .filter((item) => isSupportedTikTokCandidateUrl(item.url))
      .slice(0, limit);

    const existing = await buildExistingVideoUrlSet();
    const summary = [];
    for (const item of candidates) {
      const normalizedUrl = deps.normalizeVideoUrl(item.url);

      if (existing.has(normalizedUrl)) {
        summary.push({ status: "skipped_duplicate", url: item.url, reason: "已存在或正在队列中" });
        continue;
      }

      const job = await enqueueVideoConversion(item.url, app.id, item);
      existing.add(normalizedUrl);
      summary.push({ status: "queued", url: item.url, jobId: job.id, reason: "已通过人工确认，相关性将在转写后由 LLM 复核" });
    }

    return {
      app: deps.pickResultAppFields(app),
      inputCount: rawItems.length,
      candidateCount: candidates.length,
      summary,
      totals: summarizeBatch(summary)
    };
  }

  async function buildExistingVideoUrlSet() {
    const [results, jobs] = await Promise.all([deps.readResults(), deps.readVideoJobs()]);
    const existing = new Set();
    for (const result of results) {
      for (const url of [result.sourceUrl, result.hyperlink].filter(Boolean)) {
        existing.add(deps.normalizeVideoUrl(url));
      }
    }
    for (const job of jobs) {
      if (["queued", "running"].includes(job.status)) {
        existing.add(deps.normalizeVideoUrl(job.sourceUrl));
      }
    }
    return existing;
  }

  function normalizeVideoCandidate(item) {
    if (typeof item === "string") {
      return { url: item.trim(), mediaType: getTikTokCandidateMediaType(item), text: "", author: "", coverUrl: "", duration: "" };
    }

    const url = String(item?.url || item?.href || "").trim();
    return {
      url,
      mediaType: deps.normalizeText(item?.mediaType) || getTikTokCandidateMediaType(url),
      text: deps.normalizeText([item?.text, item?.caption, item?.title, item?.description, item?.anchorText]
        .filter(Boolean)
        .join(" ")),
      author: deps.normalizeText(item?.author || item?.username || deps.extractTikTokAuthor(url)),
      coverUrl: deps.normalizeText(item?.coverUrl || item?.thumbnailUrl || item?.posterUrl || ""),
      duration: deps.normalizeText(item?.duration || ""),
      engagement: deps.normalizeTikTokEngagement(item?.engagement || item),
      publishedAt: deps.normalizePublishedDate(item?.publishedAt || item?.uploadDate || ""),
      publishedText: deps.normalizeText(item?.publishedText || item?.publishText || item?.uploadDate || "")
    };
  }

  function isSupportedTikTokCandidateUrl(url) {
    const value = String(url || "");
    return value.includes("tiktok.com/") && (value.includes("/video/") || value.includes("/photo/"));
  }

  function getTikTokCandidateMediaType(url) {
    return String(url || "").includes("/photo/") ? "photo" : "video";
  }

  function summarizeBatch(items) {
    return items.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});
  }

  function processVideoQueue() {
    if (queueRunning) {
      return;
    }

    queueRunning = true;
    setTimeout(async () => {
      try {
        while (true) {
          const jobs = await deps.readVideoJobs();
          const job = [...jobs].reverse().find((item) => item.status === "queued");
          if (!job) {
            break;
          }
          await runQueuedVideoJob(job.id);
        }
      } finally {
        queueRunning = false;
      }
    }, 0);
  }

  async function runQueuedVideoJob(jobId) {
    let job = await deps.updateVideoJob(jobId, {
      status: "running",
      startedAt: deps.formatDate(new Date()),
      error: ""
    });
    if (!job) {
      return;
    }

    const jobDir = path.join(deps.jobsDir, job.id);
    await deps.ensureDir(jobDir);

    try {
      job = await deps.markVideoJobStage(job.id, "download");
      const payload = job.mediaType === "photo"
        ? await deps.runPhotoConversion(job.sourceUrl, jobDir, job, async (progressEvent) => {
            if (progressEvent?.stageKey) {
              await deps.markVideoJobStage(job.id, progressEvent.stageKey, progressEvent.message || "");
            }
          })
        : await deps.runPythonConversion(job.sourceUrl, jobDir, async (progressEvent) => {
            if (progressEvent?.stageKey) {
              await deps.markVideoJobStage(job.id, progressEvent.stageKey, progressEvent.message || "");
            }
          });
      const app = await deps.findAppById(job.appId);
      if (!app) {
        throw new Error("任务绑定的 App 不存在。");
      }

      await deps.markVideoJobStage(job.id, "finalize");
      const createdAt = deps.formatDate(new Date());
      const semantic = deps.normalizeVideoSemanticPayload(payload, {
        sourceUrl: job.sourceUrl,
        title: payload.title,
        duration: job.duration
      });
      const visualTextAnalysis = await deps.buildNormalVideoVisualTextAnalysis({
        resultId: job.id,
        jobDir,
        semantic,
        duration: Number(job.duration) || null
      });
      const semanticForAnalysis = {
        ...semantic,
        visual_text_segments: visualTextAnalysis.visualTextSegments
      };
      const materialAnalysis = await deps.buildNormalVideoMaterialAnalysis({
        job,
        app,
        semantic: semanticForAnalysis
      });
      const result = {
        id: job.id,
        sourceUrl: job.sourceUrl,
        title: payload.title,
        mediaType: payload.media_type || job.mediaType || "video",
        videoPath: deps.normalizeToPublicPath(path.join(jobDir, "video.mp4")),
        firstFramePath: deps.normalizeToPublicPath(payload.first_frame_path),
        hyperlink: payload.webpage_url || job.sourceUrl,
        duration: Number(semantic.duration || job.duration) || null,
        createdAt,
        appId: app.id,
        app: deps.pickResultAppFields(app),
        transcriptEn: payload.transcript_en || "",
        transcriptZh: payload.translation_zh,
        sourceLanguage: payload.source_language || "",
        sourceLanguageProbability: payload.source_language_probability ?? null,
        visualSummary: semantic.visual_summary || "",
        visualFramePaths: semantic.visual_frame_paths,
        visualTextSegments: visualTextAnalysis.visualTextSegments,
        visualTextOcr: visualTextAnalysis.ocr,
        materialAnalysis,
        engagement: deps.mergeTikTokEngagement(job.engagement, payload.engagement),
        publishedAt: deps.normalizePublishedDate(job.publishedAt || payload.published_at || ""),
        publishedText: deps.normalizeText(job.publishedText || payload.published_text || payload.published_at || ""),
        imagePaths: Array.isArray(payload.image_paths) ? payload.image_paths.map(deps.normalizeToPublicPath) : [],
        relevance: await deps.assessVideoRelevance({
          app,
          title: payload.title,
          sourceUrl: job.sourceUrl,
          transcriptEn: payload.transcript_en || "",
          transcriptZh: payload.translation_zh || ""
        })
      };

      const results = await deps.readResults();
      const normalizedSourceUrl = deps.normalizeVideoUrl(result.sourceUrl);
      const keptResults = results.filter((item) => {
        if (item.id === result.id) {
          return false;
        }
        return ![item.sourceUrl, item.hyperlink]
          .filter(Boolean)
          .some((url) => deps.normalizeVideoUrl(url) === normalizedSourceUrl);
      });
      keptResults.unshift(result);
      await deps.writeResults(keptResults);
      await deps.markVideoJobStage(job.id, "completed");
      await deps.updateVideoJob(job.id, {
        status: "completed",
        title: result.title,
        resultId: result.id,
        firstFramePath: result.firstFramePath,
        hyperlink: result.hyperlink,
        sourceLanguage: result.sourceLanguage,
        sourceLanguageProbability: result.sourceLanguageProbability,
        finishedAt: deps.formatDate(new Date())
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.updateVideoJob(job.id, {
        status: "failed",
        progress: 100,
        stage: "转换失败",
        stageKey: "failed",
        error: message,
        finishedAt: deps.formatDate(new Date())
      });
      await deps.appendConversionErrorLog({
        id: job.id,
        sourceUrl: job.sourceUrl,
        appId: job.appId,
        jobDir,
        error: message
      });
    }
  }

  async function refreshResultVisualUnderstanding(resultId) {
    const results = await deps.readResults();
    const index = results.findIndex((item) => item.id === resultId);
    if (index < 0) {
      throw new Error("没有找到这条视频记录。");
    }

    const result = results[index];
    if (result.mediaType === "photo") {
      throw new Error("图集已经走图片理解流程，不需要使用视频抽帧理解。");
    }

    const jobDir = path.join(deps.jobsDir, result.id);
    const videoFile = await deps.findJobVideoFile(jobDir);
    if (!videoFile) {
      throw new Error("没有找到这条记录对应的本地视频文件，无法抽帧理解。");
    }

    const payload = await deps.runVisualOnlyConversion(result.hyperlink || result.sourceUrl, jobDir);
    const semantic = deps.normalizeVideoSemanticPayload({
      ...payload,
      title: result.title,
      transcript_en: result.transcriptEn || "",
      translation_zh: payload.translation_zh || result.transcriptZh || "",
      source_language: payload.source_language || result.sourceLanguage || "visual",
      source_language_probability: payload.source_language_probability ?? result.sourceLanguageProbability ?? 1
    }, {
      sourceUrl: result.sourceUrl,
      title: result.title
    });
    const visualTextAnalysis = await deps.buildNormalVideoVisualTextAnalysis({
      resultId: result.id,
      jobDir,
      semantic,
      duration: Number(result.duration) || null
    });
    const app = result.app || await deps.findAppById(result.appId);
    const materialAnalysis = await deps.buildNormalVideoMaterialAnalysis({
      job: {
        id: result.id,
        sourceUrl: result.sourceUrl,
        title: result.title,
        previewText: result.title,
        duration: result.duration || ""
      },
      app,
      semantic: {
        ...semantic,
        visual_text_segments: visualTextAnalysis.visualTextSegments
      },
      previousAnalysis: result.materialAnalysis
    });
    const updated = {
      ...result,
      transcriptZh: semantic.translation_zh || result.transcriptZh || "",
      sourceLanguage: semantic.source_language || result.sourceLanguage || "visual",
      sourceLanguageProbability: semantic.source_language_probability ?? result.sourceLanguageProbability ?? 1,
      visualSummary: semantic.visual_summary || semantic.translation_zh || result.visualSummary || "",
      visualFramePaths: semantic.visual_frame_paths,
      visualTextSegments: visualTextAnalysis.visualTextSegments,
      visualTextOcr: visualTextAnalysis.ocr,
      materialAnalysis,
      updatedAt: deps.formatDate(new Date())
    };
    results[index] = updated;
    await deps.writeResults(results);
    return updated;
  }

  return {
    enqueueVideoConversion,
    enqueueVideoBatch,
    processVideoQueue,
    runQueuedVideoJob,
    refreshResultVisualUnderstanding
  };
}
