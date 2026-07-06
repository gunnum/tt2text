export function createBootstrapService(deps = {}) {
  const requiredDeps = [
    "dirs",
    "files",
    "ensureDir",
    "ensureFile",
    "readVideoJobs",
    "writeVideoJobs",
    "processVideoQueue",
    "formatDate"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createBootstrapService 缺少依赖：${dep}`);
    }
  }

  async function bootstrapStorage({ defaultAdShotProjects, recoverInterruptedAdShotAnalyses } = {}) {
    if (typeof defaultAdShotProjects !== "function") {
      throw new Error("bootstrapStorage 缺少依赖：defaultAdShotProjects");
    }

    for (const dir of Object.values(deps.dirs)) {
      await deps.ensureDir(dir);
    }

    await deps.ensureFile(deps.files.results, "[]");
    await deps.ensureFile(deps.files.articles, "[]");
    await deps.ensureFile(deps.files.articleAppLinks, "[]");
    await deps.ensureFile(deps.files.apps, "[]");
    await deps.ensureFile(deps.files.appMetrics, "[]");
    await deps.ensureFile(deps.files.appPaywalls, "[]");
    await deps.ensureFile(deps.files.adShots, "[]");
    await deps.ensureFile(deps.files.adShotProjects, `${JSON.stringify(defaultAdShotProjects(), null, 2)}\n`);
    await deps.ensureFile(deps.files.adShotCandidates, "[]");
    await deps.ensureFile(deps.files.adShotSubscriptions, "[]");
    await deps.ensureFile(deps.files.adShotSubscriptionLogs, "[]");
    await deps.ensureFile(deps.files.pluginDebugLog, "");
    await deps.ensureFile(deps.files.sensorTowerCsv, "[]");
    await deps.ensureFile(deps.files.tiktokComments, "[]");
    await deps.ensureFile(deps.files.videoJobs, "[]");

    await recoverInterruptedVideoJobs();
    if (typeof recoverInterruptedAdShotAnalyses === "function") {
      await recoverInterruptedAdShotAnalyses();
    }
  }

  async function recoverInterruptedVideoJobs() {
    const jobs = await deps.readVideoJobs();
    let changed = false;
    const recovered = jobs.map((job) => {
      if (job.status !== "running") {
        return job;
      }
      changed = true;
      return {
        ...job,
        status: "queued",
        progress: 0,
        stage: "服务重启后重新排队",
        updatedAt: deps.formatDate(new Date())
      };
    });

    if (changed) {
      await deps.writeVideoJobs(recovered);
      deps.processVideoQueue();
    }
  }

  return {
    bootstrapStorage,
    recoverInterruptedVideoJobs
  };
}
