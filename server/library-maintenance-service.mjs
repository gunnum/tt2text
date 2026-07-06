import { promises as fs } from "node:fs";
import path from "node:path";

export function createLibraryMaintenanceService(deps = {}) {
  const requiredDeps = [
    "readResults",
    "writeResults",
    "readArticles",
    "writeArticles",
    "readAppMetrics",
    "writeAppMetrics",
    "readApps",
    "writeApps",
    "readVideoJobs",
    "writeVideoJobs",
    "normalizeVideoUrl",
    "normalizeSourceUrl",
    "jobsDir",
    "projectRootDir"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createLibraryMaintenanceService 缺少依赖：${dep}`);
    }
  }

  async function deleteResults(ids) {
    const allResults = await deps.readResults();
    const idSet = new Set(ids);
    const kept = allResults.filter((item) => !idSet.has(item.id));
    const removed = allResults.filter((item) => idSet.has(item.id));

    await deps.writeResults(kept);

    await Promise.all(
      removed.map(async (item) => {
        const jobDir = path.join(deps.jobsDir, item.id);
        try {
          await fs.rm(jobDir, { recursive: true, force: true });
        } catch (error) {
          console.error(`failed to remove job dir ${jobDir}`, error);
        }
      })
    );

    return { deletedIds: removed.map((item) => item.id) };
  }

  async function setResultFavorite(id, favorite) {
    const results = await deps.readResults();
    const index = results.findIndex((item) => item.id === id);
    if (index < 0) {
      throw new Error("RESULT_NOT_FOUND");
    }

    const current = results[index];
    const nextFavorite = typeof favorite === "boolean" ? favorite : !current.isFavorite;
    const updated = {
      ...current,
      isFavorite: nextFavorite
    };
    results[index] = updated;
    await deps.writeResults(results);
    return updated;
  }

  async function deleteArticles(ids) {
    const allArticles = await deps.readArticles();
    const idSet = new Set(ids);
    const kept = allArticles.filter((item) => !idSet.has(item.id));
    const removed = allArticles.filter((item) => idSet.has(item.id));

    await deps.writeArticles(kept);

    await Promise.all(
      removed.map(async (item) => {
        if (item.ownedBundle === false) {
          return;
        }
        const bundleDir = path.join(deps.projectRootDir, String(item.bundlePath || "").replace(/^\//, ""));
        try {
          await fs.rm(bundleDir, { recursive: true, force: true });
        } catch (error) {
          console.error(`failed to remove article bundle ${bundleDir}`, error);
        }
      })
    );

    return { deletedIds: removed.map((item) => item.id) };
  }

  async function deleteAppMetrics(ids) {
    const allMetrics = await deps.readAppMetrics();
    const idSet = new Set(ids);
    const kept = allMetrics.filter((item) => !idSet.has(item.id));
    const removed = allMetrics.filter((item) => idSet.has(item.id));

    await deps.writeAppMetrics(kept);
    return { deletedIds: removed.map((item) => item.id) };
  }

  async function deleteApp(appId, deleteRelated) {
    const apps = await deps.readApps();
    const app = apps.find((item) => item.id === appId) || null;
    if (!app) {
      throw new Error("这个 App 不存在或已经被删除。");
    }

    await deps.writeApps(apps.filter((item) => item.id !== appId));

    const payload = {
      deletedAppId: appId,
      deletedRelated: Boolean(deleteRelated),
      deletedResults: [],
      deletedArticles: [],
      deletedMetrics: [],
      deletedJobs: []
    };

    if (!deleteRelated) {
      return payload;
    }

    const results = await deps.readResults();
    const resultIds = results.filter((item) => item.appId === appId).map((item) => item.id);
    if (resultIds.length) {
      const resultPayload = await deleteResults(resultIds);
      payload.deletedResults = resultPayload.deletedIds;
    }

    const articles = await deps.readArticles();
    const articleIds = articles.filter((item) => item.appId === appId).map((item) => item.id);
    if (articleIds.length) {
      const articlePayload = await deleteArticles(articleIds);
      payload.deletedArticles = articlePayload.deletedIds;
    }

    const metrics = await deps.readAppMetrics();
    const metricIds = metrics.filter((item) => item.appId === appId).map((item) => item.id);
    if (metricIds.length) {
      const metricPayload = await deleteAppMetrics(metricIds);
      payload.deletedMetrics = metricPayload.deletedIds;
    }

    const jobs = await deps.readVideoJobs();
    const keptJobs = jobs.filter((item) => item.appId !== appId);
    payload.deletedJobs = jobs.filter((item) => item.appId === appId).map((item) => item.id);
    if (payload.deletedJobs.length) {
      await deps.writeVideoJobs(keptJobs);
    }

    return payload;
  }

  async function findDuplicateResult(videoUrl) {
    const normalizedUrl = deps.normalizeVideoUrl(videoUrl);
    const results = await deps.readResults();
    return results.find((item) => {
      return [item.sourceUrl, item.hyperlink]
        .filter(Boolean)
        .some((existingUrl) => deps.normalizeVideoUrl(existingUrl) === normalizedUrl);
    }) || null;
  }

  async function findDuplicateArticle(articleUrl) {
    const normalizedUrl = deps.normalizeSourceUrl(articleUrl);
    const articles = await deps.readArticles();
    return articles.find((item) => deps.normalizeSourceUrl(item.sourceUrl) === normalizedUrl) || null;
  }

  return {
    deleteResults,
    setResultFavorite,
    deleteArticles,
    deleteAppMetrics,
    deleteApp,
    findDuplicateResult,
    findDuplicateArticle
  };
}
