export function createVideoJobService(deps = {}) {
  const requiredDeps = [
    "readVideoJobs",
    "writeVideoJobs",
    "readResults",
    "normalizeVideoUrl",
    "formatDate",
    "stageMeta",
    "processVideoQueue"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createVideoJobService 缺少依赖：${dep}`);
    }
  }

  async function readVideoJobsForApi() {
    const [jobs, results] = await Promise.all([deps.readVideoJobs(), deps.readResults()]);
    const resultsById = new Map(results.map((item) => [item.id, item]));
    const resultsByUrl = new Map();
    for (const result of results) {
      for (const url of [result.sourceUrl, result.hyperlink].filter(Boolean)) {
        resultsByUrl.set(deps.normalizeVideoUrl(url), result);
      }
    }

    return jobs.map((job) => {
      const result = resultsById.get(job.resultId)
        || resultsById.get(job.id)
        || resultsByUrl.get(deps.normalizeVideoUrl(job.sourceUrl));
      if (!result) {
        return job;
      }
      return {
        ...job,
        title: job.title || result.title || "",
        resultId: job.resultId || result.id || "",
        firstFramePath: job.firstFramePath || result.firstFramePath || "",
        coverUrl: job.coverUrl || result.firstFramePath || "",
        hyperlink: job.hyperlink || result.hyperlink || ""
      };
    });
  }

  function buildStageHistoryEntry(stageKey, message = "") {
    return {
      stageKey,
      label: deps.stageMeta[stageKey]?.label || stageKey,
      message,
      at: deps.formatDate(new Date())
    };
  }

  async function markVideoJobStage(jobId, stageKey, message = "") {
    const meta = deps.stageMeta[stageKey];
    if (!meta) {
      return updateVideoJob(jobId, {});
    }

    const jobs = await deps.readVideoJobs();
    const index = jobs.findIndex((item) => item.id === jobId);
    if (index < 0) {
      return null;
    }

    const history = Array.isArray(jobs[index].stageHistory) ? jobs[index].stageHistory.slice() : [];
    const last = history[history.length - 1];
    if (!last || last.stageKey !== stageKey || message) {
      history.push(buildStageHistoryEntry(stageKey, message));
    }

    jobs[index] = {
      ...jobs[index],
      progress: meta.progress,
      stage: message ? `${meta.label} · ${message}` : meta.label,
      stageKey,
      stageHistory: history,
      updatedAt: deps.formatDate(new Date())
    };
    await deps.writeVideoJobs(jobs);
    return jobs[index];
  }

  async function updateVideoJob(jobId, patch) {
    const jobs = await deps.readVideoJobs();
    const index = jobs.findIndex((item) => item.id === jobId);
    if (index < 0) {
      return null;
    }

    jobs[index] = {
      ...jobs[index],
      ...patch,
      updatedAt: deps.formatDate(new Date())
    };
    await deps.writeVideoJobs(jobs);
    return jobs[index];
  }

  async function retryVideoJob(jobId) {
    const jobs = await deps.readVideoJobs();
    const index = jobs.findIndex((item) => item.id === jobId);
    if (index < 0) {
      throw new Error("没有找到这个任务。");
    }

    const current = jobs[index];
    if (!["failed", "completed"].includes(current.status)) {
      throw new Error("只有失败或已完成的任务才能手动重试。");
    }

    jobs[index] = {
      ...current,
      status: "queued",
      progress: deps.stageMeta.queued.progress,
      stage: deps.stageMeta.queued.label,
      stageKey: "queued",
      stageHistory: [...(Array.isArray(current.stageHistory) ? current.stageHistory : []), buildStageHistoryEntry("queued", "手动重试")],
      error: "",
      title: current.title || "",
      resultId: "",
      retryCount: Number(current.retryCount || 0) + 1,
      startedAt: "",
      finishedAt: "",
      updatedAt: deps.formatDate(new Date())
    };

    await deps.writeVideoJobs(jobs);
    deps.processVideoQueue();
    return jobs[index];
  }

  async function retryFailedVideoJobs() {
    const jobs = await deps.readVideoJobs();
    const now = deps.formatDate(new Date());
    let retried = 0;
    const updatedJobs = jobs.map((job) => {
      if (job.status !== "failed") {
        return job;
      }
      retried += 1;
      return {
        ...job,
        status: "queued",
        progress: deps.stageMeta.queued.progress,
        stage: deps.stageMeta.queued.label,
        stageKey: "queued",
        stageHistory: [...(Array.isArray(job.stageHistory) ? job.stageHistory : []), buildStageHistoryEntry("queued", "批量重试")],
        error: "",
        resultId: "",
        retryCount: Number(job.retryCount || 0) + 1,
        startedAt: "",
        finishedAt: "",
        updatedAt: now
      };
    });

    if (retried > 0) {
      await deps.writeVideoJobs(updatedJobs);
      deps.processVideoQueue();
    }
    return { retried };
  }

  async function ignoreFailedVideoJobs() {
    const jobs = await deps.readVideoJobs();
    const ignoredJobs = jobs.filter((job) => job.status === "failed");
    if (!ignoredJobs.length) {
      return { ignored: 0, ids: [] };
    }
    await deps.writeVideoJobs(jobs.filter((job) => job.status !== "failed"));
    return {
      ignored: ignoredJobs.length,
      ids: ignoredJobs.map((job) => job.id)
    };
  }

  return {
    readVideoJobsForApi,
    buildStageHistoryEntry,
    markVideoJobStage,
    updateVideoJob,
    retryVideoJob,
    retryFailedVideoJobs,
    ignoreFailedVideoJobs
  };
}
