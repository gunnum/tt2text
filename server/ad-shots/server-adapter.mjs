export function createAdShotServerAdapter(deps = {}) {
  const requiredDeps = [
    "readJsonArrayFile",
    "writeJsonFileAtomic",
    "adShotProjectsFile",
    "normalizeAdShotRecordBase",
    "normalizeVisualTextSegments",
    "normalizeText",
    "normalizeToPublicPath",
    "readAdShots",
    "json",
    "sendHtml",
    "renderAdShotHtml"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAdShotServerAdapter 缺少依赖：${dep}`);
    }
  }

  async function readAdShotProjectsRaw() {
    return deps.readJsonArrayFile(deps.adShotProjectsFile);
  }

  async function writeAdShotProjectsRaw(projects) {
    await deps.writeJsonFileAtomic(deps.adShotProjectsFile, projects);
  }

  function normalizeAdShotRecord(shot, projects = []) {
    return deps.normalizeAdShotRecordBase(shot, projects, {
      normalizeVisualTextSegments: deps.normalizeVisualTextSegments
    });
  }

  async function serveAdShotPage(res, shotId) {
    const normalizedShotId = deps.normalizeText(shotId);
    if (!normalizedShotId) {
      return deps.json(res, 404, { error: "缺少 Shot ID。" });
    }

    const shots = await deps.readAdShots();
    const shot = shots.find((item) => item.shotId === normalizedShotId);
    if (!shot) {
      return deps.json(res, 404, { error: "Shot not found" });
    }

    res.writeHead(302, {
      Location: `/videos/detail.html?source=shot&id=${encodeURIComponent(normalizedShotId)}`
    });
    res.end();
    return true;
  }

  return {
    readAdShotProjectsRaw,
    writeAdShotProjectsRaw,
    normalizeAdShotRecord,
    serveAdShotPage
  };
}
