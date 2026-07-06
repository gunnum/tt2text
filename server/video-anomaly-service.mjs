export function createVideoAnomalyService(deps = {}) {
  const requiredDeps = [
    "readVideoJobs",
    "writeVideoJobs",
    "readResults",
    "enqueueVideoConversion",
    "processVideoQueue",
    "buildStageHistoryEntry",
    "normalizeVideoUrl",
    "normalizeText",
    "formatDate",
    "stageMeta"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createVideoAnomalyService 缺少依赖：${dep}`);
    }
  }

  async function scanAndRequeueAnomalousNormalVideos(options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const staleMs = Number(options.staleMs) > 0 ? Number(options.staleMs) : 2 * 60 * 60 * 1000;
    const limit = Number(options.limit) > 0 ? Number(options.limit) : 20;
    const [jobs, results] = await Promise.all([deps.readVideoJobs(), deps.readResults()]);
    const activeUrls = new Set(jobs
      .filter((job) => ["queued", "running"].includes(job.status))
      .map((job) => deps.normalizeVideoUrl(job.sourceUrl))
      .filter(Boolean));
    const requeueJobIds = [];
    const nowText = deps.formatDate(now);
    const updatedJobs = jobs.map((job) => {
      if (requeueJobIds.length >= limit || !shouldRequeueVideoJob(job, now, staleMs)) {
        return job;
      }
      requeueJobIds.push(job.id);
      activeUrls.add(deps.normalizeVideoUrl(job.sourceUrl));
      return {
        ...job,
        status: "queued",
        progress: deps.stageMeta.queued.progress,
        stage: deps.stageMeta.queued.label,
        stageKey: "queued",
        stageHistory: [...(Array.isArray(job.stageHistory) ? job.stageHistory : []), deps.buildStageHistoryEntry("queued", "每日异常检查重排队")],
        error: "",
        resultId: "",
        retryCount: Number(job.retryCount || 0) + 1,
        startedAt: "",
        finishedAt: "",
        updatedAt: nowText
      };
    });

    if (requeueJobIds.length) {
      await deps.writeVideoJobs(updatedJobs);
    }

    const enqueuedResultIds = [];
    const skipped = [];
    const resultCandidates = results.filter((result) => {
      if (requeueJobIds.length + enqueuedResultIds.length >= limit) return false;
      if (!shouldReanalyzeNormalVideoResult(result)) return false;
      const normalizedUrl = deps.normalizeVideoUrl(result.sourceUrl || result.hyperlink);
      if (!normalizedUrl || activeUrls.has(normalizedUrl)) return false;
      return true;
    });

    for (const result of resultCandidates) {
      try {
        const url = result.sourceUrl || result.hyperlink;
        const appId = result.appId || result.app?.id;
        const job = await deps.enqueueVideoConversion(url, appId, {
          mediaType: result.mediaType,
          text: result.title || result.publishedText || "",
          title: result.title || "",
          coverUrl: result.firstFramePath || "",
          author: result.author || "",
          duration: result.duration || "",
          engagement: result.engagement || {},
          publishedAt: result.publishedAt || "",
          publishedText: result.publishedText || ""
        });
        activeUrls.add(deps.normalizeVideoUrl(url));
        enqueuedResultIds.push(result.id || job.id);
      } catch (error) {
        skipped.push({
          resultId: result.id || "",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (requeueJobIds.length) {
      deps.processVideoQueue();
    }

    return {
      checkedAt: nowText,
      checkedJobCount: jobs.length,
      checkedResultCount: results.length,
      requeuedJobCount: requeueJobIds.length,
      enqueuedResultCount: enqueuedResultIds.length,
      queuedCount: requeueJobIds.length + enqueuedResultIds.length,
      requeuedJobIds,
      enqueuedResultIds,
      skipped
    };
  }

  function shouldRequeueVideoJob(job = {}, now = new Date(), staleMs = 2 * 60 * 60 * 1000) {
    if (!job?.id || !job.sourceUrl || !job.appId) return false;
    if (job.status === "failed") return true;
    if (!["queued", "running"].includes(job.status)) return false;
    const lastAt = [
      job.updatedAt,
      job.startedAt,
      job.createdAt
    ].map((value) => Date.parse(value || "")).filter(Number.isFinite).sort((a, b) => b - a)[0];
    return Number.isFinite(lastAt) ? now.getTime() - lastAt > staleMs : true;
  }

  function shouldReanalyzeNormalVideoResult(result = {}) {
    const sourceUrl = deps.normalizeText(result.sourceUrl || result.hyperlink);
    const appId = deps.normalizeText(result.appId || result.app?.id);
    if (!sourceUrl || !appId) return false;
    const materialAnalysis = result.materialAnalysis && typeof result.materialAnalysis === "object" ? result.materialAnalysis : null;
    const hasMaterialAnalysis = Boolean(materialAnalysis && Object.keys(materialAnalysis).length);
    const mediaType = deps.normalizeText(result.mediaType).toLowerCase();
    const imagePaths = Array.isArray(result.imagePaths) ? result.imagePaths.filter(Boolean) : [];
    if (mediaType === "photo") {
      return !hasMaterialAnalysis || (!imagePaths.length && !deps.normalizeText(result.visualSummary));
    }
    return !hasMaterialAnalysis;
  }

  return {
    scanAndRequeueAnomalousNormalVideos
  };
}
