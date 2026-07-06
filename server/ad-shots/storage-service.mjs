import { promises as fs } from "node:fs";

export function createAdShotStorageService(deps = {}) {
  const requiredDeps = [
    "readJsonArrayFile",
    "writeJsonFile",
    "readProjects",
    "normalizeAdShotRecord",
    "normalizeText",
    "resolveProjectPublicPath",
    "files"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAdShotStorageService 缺少依赖：${dep}`);
    }
  }

  const files = deps.files || {};

  async function readAdShots() {
    const [rawShots, projects] = await Promise.all([
      deps.readJsonArrayFile(files.adShots),
      deps.readProjects()
    ]);
    const normalizedShots = rawShots.map((shot) => deps.normalizeAdShotRecord(shot, projects));
    return Promise.all(normalizedShots.map(hydrateAdShotFromLocalFiles));
  }

  async function readAdShotById(shotId) {
    const normalizedShotId = deps.normalizeText(shotId);
    if (!normalizedShotId) {
      throw new Error("缺少 Shot ID。");
    }

    const shots = await readAdShots();
    const shot = shots.find((item) => item.shotId === normalizedShotId || item.id === normalizedShotId);
    if (!shot) {
      throw new Error("没有找到这个 Ad Shot。");
    }
    return shot;
  }

  async function writeAdShots(shots) {
    const projects = await deps.readProjects();
    await deps.writeJsonFile(files.adShots, shots.map((shot) => deps.normalizeAdShotRecord(shot, projects)));
  }

  async function readAdShotCandidates() {
    const parsed = await deps.readJsonArrayFile(files.candidates);
    return parsed.map((item) => ({
      id: "",
      batchId: "",
      sourcePlatform: "tiktok_creative_center",
      sourceModule: "top_ads",
      sourceUrl: "",
      detailUrl: "",
      sourceAdId: "",
      title: "",
      brandName: "",
      cardText: "",
      posterUrl: "",
      videoUrl: "",
      status: "candidate",
      importedShotId: "",
      targetApp: "",
      filters: {},
      capturedAt: "",
      updatedAt: "",
      raw: {},
      ...item
    }));
  }

  async function writeAdShotCandidates(candidates) {
    await deps.writeJsonFile(files.candidates, candidates);
  }

  async function readAdShotSubscriptionsRaw() {
    return deps.readJsonArrayFile(files.subscriptions);
  }

  async function writeAdShotSubscriptionsRaw(subscriptions) {
    await deps.writeJsonFile(files.subscriptions, subscriptions);
  }

  async function readAdShotSubscriptionLogsRaw() {
    return deps.readJsonArrayFile(files.subscriptionLogs);
  }

  async function writeAdShotSubscriptionLogsRaw(logs) {
    await deps.writeJsonFile(files.subscriptionLogs, logs);
  }

  async function hydrateAdShotFromLocalFiles(shot) {
    const withMetadata = await hydrateAdShotFromMetadataFile(shot);
    return hydrateAdShotFromDetailFile(withMetadata);
  }

  async function hydrateAdShotFromMetadataFile(shot) {
    const existingTrack = deps.normalizeText(shot.musicTrack || shot.bgmTitle || shot.raw?.musicTrack || shot.raw?.track);
    const metadataPath = resolveMetadataPath(shot);
    if (existingTrack || !metadataPath) {
      return shot;
    }

    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
      const musicTrack = deps.normalizeText(metadata.track || metadata.musicTrack || metadata.music_title || metadata.title);
      const musicArtist = deps.normalizeText(metadata.artist || metadata.uploader || metadata.channel);
      const musicArtists = Array.isArray(metadata.artists)
        ? metadata.artists.map((item) => deps.normalizeText(item)).filter(Boolean)
        : [];
      if (!musicTrack && !musicArtist && !musicArtists.length) {
        return shot;
      }
      return {
        ...shot,
        musicTrack,
        musicArtist: musicArtist || musicArtists[0] || "",
        musicArtists,
        raw: {
          ...(shot.raw && typeof shot.raw === "object" ? shot.raw : {}),
          musicTrack,
          musicArtist: musicArtist || musicArtists[0] || "",
          musicArtists
        }
      };
    } catch {
      return shot;
    }
  }

  function resolveMetadataPath(shot) {
    const candidates = [
      shot.analysisMetadataPath,
      shot.analysis_metadata_path,
      shot.analysisArtifacts?.metadataPath,
      shot.media?.metadataPath
    ].map((item) => deps.normalizeText(item)).filter(Boolean);

    const publicVideoPath = deps.normalizeText(shot.videoPath || shot.media?.videoPath);
    if (publicVideoPath) {
      candidates.push(publicVideoPath.replace(/\/[^/]*$/, "/metadata.json"));
    }

    const shotId = deps.normalizeText(shot.shotId || shot.id);
    if (shotId) {
      candidates.push(`/data/ad-shots/${shotId}/analysis/metadata.json`);
    }

    for (const candidate of candidates) {
      try {
        return deps.resolveProjectPublicPath(candidate);
      } catch {
        // Try the next candidate.
      }
    }
    return "";
  }

  async function hydrateAdShotFromDetailFile(shot) {
    const existingLandingPage = deps.normalizeText(shot.landingPage || shot.landing_page || shot.raw?.landingPage);
    const detailPath = deps.normalizeText(shot.detailPath || shot.raw?.detailPath);
    if (existingLandingPage || !detailPath) {
      return shot;
    }

    try {
      const detailFilePath = deps.resolveProjectPublicPath(detailPath);
      const detail = JSON.parse(await fs.readFile(detailFilePath, "utf8"));
      const landingPage = deps.normalizeText(detail.landingPage || detail.landing_page || detail.raw?.landingPage);
      if (!landingPage) {
        return shot;
      }
      return {
        ...shot,
        landingPage,
        raw: {
          ...(shot.raw && typeof shot.raw === "object" ? shot.raw : {}),
          landingPage
        }
      };
    } catch {
      return shot;
    }
  }

  return {
    readAdShots,
    readAdShotById,
    writeAdShots,
    readAdShotCandidates,
    writeAdShotCandidates,
    readAdShotSubscriptionsRaw,
    writeAdShotSubscriptionsRaw,
    readAdShotSubscriptionLogsRaw,
    writeAdShotSubscriptionLogsRaw
  };
}
