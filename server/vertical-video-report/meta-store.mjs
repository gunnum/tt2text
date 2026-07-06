import { promises as fs } from "node:fs";
import path from "node:path";

import {
  READING_ALIAS_ID,
  READING_APP_CATEGORY_LABEL,
  SNAPSHOT_KEEP_LIMIT
} from "./constants.mjs";
import {
  appCategoryIdForLabel,
  normalizeCategoryId
} from "./category-resolver.mjs";

export function createVerticalVideoMetaStore({ projectRootDir, reportsDir } = {}) {
  const rootReportsDir = reportsDir || (projectRootDir ? path.join(projectRootDir, "reports") : "");
  if (!rootReportsDir) {
    throw new Error("createVerticalVideoMetaStore 缺少依赖：reportsDir");
  }

  const reportDir = path.join(rootReportsDir, "vertical-video-reports");

  async function readCategoryMeta(categoryId) {
    try {
      return JSON.parse(await fs.readFile(categoryMetaPath(categoryId), "utf8"));
    } catch {
      const normalized = normalizeCategoryId(categoryId);
      if (normalized === READING_ALIAS_ID) {
        try {
          return JSON.parse(await fs.readFile(categoryMetaPath(appCategoryIdForLabel(READING_APP_CATEGORY_LABEL)), "utf8"));
        } catch {}
      }
      return null;
    }
  }

  async function writeCategoryMeta(categoryId, meta) {
    await fs.mkdir(reportDir, { recursive: true });
    await writeSnapshot(categoryId, meta);
    await fs.writeFile(categoryMetaPath(categoryId), JSON.stringify(meta, null, 2) + "\n", "utf8");
  }

  async function writeSnapshot(categoryId, meta) {
    const snapshotDir = path.join(reportDir, normalizeCategoryId(categoryId), "snapshots");
    await fs.mkdir(snapshotDir, { recursive: true });
    const stamp = new Date(meta.analyzedAt || Date.now()).toISOString().replace(/[:.]/g, "-");
    const snapshotPath = path.join(snapshotDir, stamp + ".meta.json");
    await fs.writeFile(snapshotPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
    await pruneSnapshots(snapshotDir);
  }

  async function pruneSnapshots(snapshotDir) {
    const entries = await fs.readdir(snapshotDir, { withFileTypes: true }).catch(() => []);
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".meta.json"))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    await Promise.all(files.slice(SNAPSHOT_KEEP_LIMIT).map((name) => fs.rm(path.join(snapshotDir, name), { force: true })));
  }

  function categoryMetaPath(categoryId) {
    return path.join(reportDir, normalizeCategoryId(categoryId) + ".meta.json");
  }

  return {
    reportDir,
    readCategoryMeta,
    writeCategoryMeta,
    writeSnapshot,
    pruneSnapshots,
    categoryMetaPath
  };
}
