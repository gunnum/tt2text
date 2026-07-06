import { promises as fs } from "node:fs";
import path from "node:path";

export function createAdShotDeleteService(deps = {}) {
  const requiredDeps = [
    "readAdShots",
    "writeAdShots",
    "readAdShotById",
    "normalizeText",
    "adShotAssetsDir"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAdShotDeleteService 缺少依赖：${dep}`);
    }
  }

  async function deleteAdShot(shotId) {
    const normalizedShotId = deps.normalizeText(shotId);
    if (!normalizedShotId) {
      throw new Error("缺少 Shot ID。");
    }

    const existing = await deps.readAdShotById(normalizedShotId);
    const shots = await deps.readAdShots();
    const nextShots = shots.filter((item) => item.shotId !== normalizedShotId && item.id !== normalizedShotId);
    if (nextShots.length === shots.length) {
      throw new Error("没有找到这个 Ad Shot。");
    }

    await deps.writeAdShots(nextShots);
    await fs.rm(path.join(deps.adShotAssetsDir, normalizedShotId), { recursive: true, force: true });

    return {
      ok: true,
      deleted: true,
      shotId: normalizedShotId,
      title: existing?.title || ""
    };
  }

  return {
    deleteAdShot
  };
}
