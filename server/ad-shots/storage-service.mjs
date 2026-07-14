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
    const withDetail = await hydrateAdShotFromDetailFile(withMetadata);
    return hydrateAdShotMediaFromLocalFiles(withDetail);
  }

  async function hydrateAdShotMediaFromLocalFiles(shot) {
    const shotId = deps.normalizeText(shot.shotId || shot.id);
    const imagePaths = [
      ...(Array.isArray(shot.media?.imagePaths) ? shot.media.imagePaths : []),
      ...(Array.isArray(shot.imagePaths) ? shot.imagePaths : []),
      ...(Array.isArray(shot.image_paths) ? shot.image_paths : []),
      ...(Array.isArray(shot.analysisArtifacts?.imagePaths) ? shot.analysisArtifacts.imagePaths : [])
    ];
    const coverCandidates = [
      shot.analysisArtifacts?.firstFramePath,
      shot.media?.firstFramePath,
      shot.firstFramePath,
      shot.first_frame_path,
      shot.media?.posterPath,
      shot.posterPath,
      ...(Array.isArray(shot.analysisArtifacts?.visualFramePaths) ? shot.analysisArtifacts.visualFramePaths : []),
      ...(Array.isArray(shot.analysisArtifacts?.visualOcrFramePaths) ? shot.analysisArtifacts.visualOcrFramePaths : []),
      ...imagePaths,
      ...(shotId ? [
        `/data/ad-shots/${shotId}/analysis/first-frame.jpg`,
        `/data/ad-shots/${shotId}/analysis/visual-frames/frame-01-0.00s.jpg`,
        `/data/ad-shots/${shotId}/analysis/ocr-frames/ocr-frame-001-0.00s.jpg`
      ] : []),
      shot.media?.posterUrl,
      shot.coverUrl,
      shot.posterUrl,
      shot.imageUrl,
      shot.app?.logoUrl,
      shot.appLogoUrl,
      shot.logoUrl
    ];
    const videoCandidates = [
      shot.videoPath,
      shot.media?.videoPath,
      shot.analysisArtifacts?.videoPath,
      ...inferSiblingVideoPaths(coverCandidates),
      ...(shotId ? [
        `/data/ad-shots/${shotId}/video.mp4`,
        `/data/ad-shots/${shotId}/video.mkv`,
        `/data/ad-shots/${shotId}/video.webm`,
        `/data/ad-shots/${shotId}/video.mov`,
        `/data/ad-shots/${shotId}/analysis/video.mp4`
      ] : [])
    ];
    const [coverPath, videoPath] = await Promise.all([
      firstAvailableMediaPath(coverCandidates, { kind: "image" }),
      firstAvailableMediaPath(videoCandidates, { kind: "video" })
    ]);
    if (!coverPath && !videoPath) return shot;
    return {
      ...shot,
      ...(coverPath ? { posterPath: coverPath, firstFramePath: coverPath } : {}),
      ...(videoPath ? { videoPath } : {}),
      media: {
        ...(shot.media && typeof shot.media === "object" ? shot.media : {}),
        ...(coverPath ? { posterPath: coverPath, firstFramePath: coverPath } : {}),
        ...(videoPath ? { videoPath } : {})
      }
    };
  }

  async function firstAvailableMediaPath(candidates = [], options = {}) {
    const normalized = Array.from(new Set(candidates.map(deps.normalizeText).filter(Boolean)));
    for (const candidate of normalized) {
      if (/^https?:\/\//i.test(candidate)) return candidate;
      try {
        const filePath = deps.resolveProjectPublicPath(candidate);
        const stat = await fs.stat(filePath);
        if (stat.isFile() && await isUsableMediaFile(filePath, options.kind)) return candidate;
      } catch {
        // Try the next media candidate.
      }
    }
    return "";
  }

  async function isUsableMediaFile(filePath, kind = "") {
    if (kind !== "image") return true;
    const extension = String(filePath).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
    if (extension === "svg") return true;
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(16);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const header = buffer.subarray(0, bytesRead);
      return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
        || header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        || header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP"
        || header.subarray(0, 6).toString("ascii").startsWith("GIF8");
    } finally {
      await handle.close();
    }
  }

  function inferSiblingVideoPaths(candidates = []) {
    const extensions = ["mp4", "mkv", "webm", "mov"];
    const paths = [];
    for (const candidate of candidates.map(deps.normalizeText).filter(Boolean)) {
      if (!candidate.startsWith("/") || /^https?:\/\//i.test(candidate)) continue;
      const base = candidate.replace(/\/[^/]+$/, "");
      for (const extension of extensions) {
        paths.push(`${base}/video.${extension}`);
      }
    }
    return paths;
  }

  async function hydrateAdShotFromMetadataFile(shot) {
    const existingTrack = deps.normalizeText(shot.musicTrack || shot.bgmTitle || shot.raw?.musicTrack || shot.raw?.track);
    const metadataPath = resolveMetadataPath(shot);
    if (!metadataPath) {
      return shot;
    }

    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
      const musicTrack = deps.normalizeText(metadata.track || metadata.musicTrack || metadata.music_title || metadata.title);
      const musicArtist = deps.normalizeText(metadata.artist || metadata.uploader || metadata.channel);
      const musicArtists = Array.isArray(metadata.artists)
        ? metadata.artists.map((item) => deps.normalizeText(item)).filter(Boolean)
        : [];
      const metadataPerformance = normalizeMetadataPerformance(metadata);
      const hasMusicPatch = !existingTrack && (musicTrack || musicArtist || musicArtists.length);
      if (!hasMusicPatch && !Object.keys(metadataPerformance).length) {
        return shot;
      }
      const raw = shot.raw && typeof shot.raw === "object" ? shot.raw : {};
      const rawPerformance = raw.performance && typeof raw.performance === "object" ? raw.performance : {};
      const rawMetrics = raw.metrics && typeof raw.metrics === "object" ? raw.metrics : {};
      const performancePatch = {
        ...(Object.keys(metadataPerformance).length ? rawPerformance : {}),
        ...metadataPerformance
      };
      const metricsPatch = {
        ...(Object.keys(metadataPerformance).length ? rawMetrics : {}),
        ...(metadataPerformance.like !== undefined ? { like: metadataPerformance.like } : {}),
        ...(metadataPerformance.comment !== undefined ? { comment: metadataPerformance.comment } : {}),
        ...(metadataPerformance.save !== undefined ? { save: metadataPerformance.save } : {}),
        ...(metadataPerformance.share !== undefined ? { share: metadataPerformance.share, forward: metadataPerformance.share } : {}),
        ...(metadataPerformance.view !== undefined ? { view: metadataPerformance.view } : {})
      };
      const topLevelPatch = {
        ...(metadataPerformance.like !== undefined ? { like: metadataPerformance.like } : {}),
        ...(metadataPerformance.comment !== undefined ? { comment: metadataPerformance.comment } : {}),
        ...(metadataPerformance.save !== undefined ? { save: metadataPerformance.save } : {}),
        ...(metadataPerformance.share !== undefined ? { share: metadataPerformance.share, forward: metadataPerformance.share } : {}),
        ...(metadataPerformance.view !== undefined ? { view: metadataPerformance.view } : {})
      };
      return {
        ...shot,
        ...topLevelPatch,
        ...(hasMusicPatch ? { musicTrack, musicArtist: musicArtist || musicArtists[0] || "", musicArtists } : {}),
        raw: {
          ...raw,
          ...(hasMusicPatch ? { musicTrack, musicArtist: musicArtist || musicArtists[0] || "", musicArtists } : {}),
          ...(Object.keys(performancePatch).length ? { performance: performancePatch } : {}),
          ...(Object.keys(metricsPatch).length ? { metrics: metricsPatch } : {}),
          metadataEngagementSource: Object.keys(metadataPerformance).length ? "analysis_metadata" : raw.metadataEngagementSource
        }
      };
    } catch {
      return shot;
    }
  }

  function normalizeMetadataPerformance(metadata = {}) {
    const like = normalizeMetadataCount(metadata.like_count);
    const comment = normalizeMetadataCount(metadata.comment_count);
    const save = normalizeMetadataCount(metadata.save_count);
    const share = normalizeMetadataCount(metadata.repost_count ?? metadata.share_count);
    const view = normalizeMetadataCount(metadata.view_count);
    return {
      ...(like !== null ? { like } : {}),
      ...(comment !== null ? { comment } : {}),
      ...(save !== null ? { save } : {}),
      ...(share !== null ? { share } : {}),
      ...(view !== null ? { view } : {})
    };
  }

  function normalizeMetadataCount(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
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
