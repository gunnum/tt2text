import {
  extractTopAdsIdFromUrl,
  normalizeTopAdsDetailUrl
} from "./import-service.mjs";

export function createAdShotCandidateService(deps = {}) {
  const requiredDeps = [
    "readAdShots",
    "readAdShotProjects",
    "readAdShotCandidates",
    "writeAdShotCandidates",
    "createJobId",
    "normalizeStringArray",
    "normalizeText",
    "formatDate"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAdShotCandidateService 缺少依赖：${dep}`);
    }
  }

  async function importAdShotCandidates(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("缺少 Ad Shot 候选数据。");
    }

    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    if (!rawItems.length) {
      throw new Error("没有采集到可见素材。请确认当前是 TikTok Creative Center Top Ads 结果页，并且页面里有素材卡片。");
    }

    const batchId = normalizeText(payload.batch_id || payload.batchId) || `batch_${deps.createJobId()}`;
    const capturedAt = deps.formatDate(new Date());
    const sourceUrl = normalizeText(payload.source_url || payload.sourceUrl || payload.url);
    const targetApp = normalizeText(payload.target_app || payload.targetApp) || "未指定";
    const projects = await deps.readAdShotProjects();
    const validProjectIds = new Set(projects.map((project) => project.id));
    const projectIds = deps.normalizeStringArray(payload.projectIds || payload.project_ids || payload.projectId || payload.project_id)
      .filter((projectId) => validProjectIds.has(projectId));
    const filters = payload.filters && typeof payload.filters === "object" ? payload.filters : {};
    const existingShots = await deps.readAdShots();
    const existingShotByAdId = new Map(existingShots.map((shot) => [normalizeText(shot.sourceAdId), shot]).filter(([id]) => id));
    const candidates = await deps.readAdShotCandidates();
    const indexByKey = new Map();
    candidates.forEach((candidate, index) => {
      for (const key of buildAdShotCandidateKeys(candidate)) {
        indexByKey.set(key, index);
      }
    });

    const saved = [];
    let created = 0;
    let updated = 0;
    for (const rawItem of rawItems) {
      const candidate = normalizeAdShotCandidate(rawItem, {
        batchId,
        sourceUrl,
        targetApp,
        projectIds,
        filters,
        capturedAt,
        existingShotByAdId
      });
      if (!candidate.sourceAdId && !candidate.detailUrl && !candidate.cardText) {
        continue;
      }

      const key = buildAdShotCandidateKeys(candidate).find((item) => indexByKey.has(item));
      if (key) {
        const index = indexByKey.get(key);
        candidates[index] = {
          ...candidates[index],
          ...candidate,
          id: candidates[index].id || candidate.id,
          capturedAt: candidates[index].capturedAt || candidate.capturedAt,
          updatedAt: capturedAt
        };
        saved.push(candidates[index]);
        updated += 1;
        continue;
      }

      const insertIndex = candidates.length;
      candidates.push(candidate);
      for (const candidateKey of buildAdShotCandidateKeys(candidate)) {
        indexByKey.set(candidateKey, insertIndex);
      }
      saved.push(candidate);
      created += 1;
    }

    const orderedCandidates = candidates.sort((a, b) => normalizeText(b.updatedAt || b.capturedAt).localeCompare(normalizeText(a.updatedAt || a.capturedAt)));
    await deps.writeAdShotCandidates(orderedCandidates);
    return {
      type: "ad_shot_candidate_batch",
      batchId,
      sourceUrl,
      targetApp,
      projectIds,
      itemCount: rawItems.length,
      savedCount: saved.length,
      created,
      updated,
      candidates: saved,
      capturedAt
    };
  }

  function normalizeAdShotCandidate(rawItem, context) {
    const detailUrl = normalizeTopAdsDetailUrl(rawItem.detailUrl || rawItem.detail_url || rawItem.href || rawItem.url);
    const sourceAdId = normalizeText(rawItem.sourceAdId || rawItem.source_ad_id || rawItem.adId || extractTopAdsIdFromUrl(detailUrl));
    const importedShot = sourceAdId ? context.existingShotByAdId.get(sourceAdId) : null;
    const cardText = truncateText(normalizeText(rawItem.cardText || rawItem.text || rawItem.rawText), 2000);
    return {
      id: normalizeText(rawItem.id) || `cand_${sourceAdId || deps.createJobId()}`,
      batchId: context.batchId,
      sourcePlatform: "tiktok_creative_center",
      sourceModule: "top_ads",
      sourceUrl: normalizeText(rawItem.sourceUrl || rawItem.source_url) || context.sourceUrl,
      detailUrl,
      sourceAdId,
      title: truncateText(normalizeText(rawItem.title || rawItem.adTitle), 300),
      brandName: truncateText(normalizeText(rawItem.brandName || rawItem.brand || rawItem.advertiser), 200),
      cardText,
      posterUrl: normalizeText(rawItem.posterUrl || rawItem.poster_url || rawItem.coverUrl || rawItem.cover || rawItem.imageUrl),
      videoUrl: normalizeText(rawItem.videoUrl || rawItem.video_url || rawItem.videoSrc),
      status: importedShot ? "imported" : "candidate",
      importedShotId: importedShot?.shotId || "",
      targetApp: context.targetApp,
      projectIds: context.projectIds || [],
      filters: context.filters,
      capturedAt: context.capturedAt,
      updatedAt: context.capturedAt,
      raw: sanitizeAdShotCandidateRaw(rawItem)
    };
  }

  function sanitizeAdShotCandidateRaw(rawItem) {
    if (!rawItem || typeof rawItem !== "object") {
      return {};
    }
    return {
      source: normalizeText(rawItem.source || ""),
      rank: rawItem.rank ?? null,
      metricsText: truncateText(normalizeText(rawItem.metricsText || ""), 1000),
      rawText: truncateText(normalizeText(rawItem.rawText || rawItem.text || ""), 3000)
    };
  }

  function truncateText(value, maxLength) {
    const text = normalizeText(value);
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength - 1)}…`;
  }

  function normalizeText(value) {
    return deps.normalizeText(value);
  }

  return {
    importAdShotCandidates
  };
}

function buildAdShotCandidateKeys(candidate) {
  return [
    candidate.sourceAdId ? `ad:${candidate.sourceAdId}` : "",
    candidate.detailUrl ? `detail:${candidate.detailUrl}` : "",
    candidate.videoUrl ? `video:${candidate.videoUrl}` : "",
    candidate.cardText ? `text:${candidate.cardText.slice(0, 120)}` : ""
  ].filter(Boolean);
}
