import { promises as fs } from "node:fs";
import path from "node:path";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".webm", ".mov"]);

export async function preserveAdShotVideo({ sourcePath = "", shotDir = "" } = {}) {
  const normalizedSourcePath = path.resolve(String(sourcePath || ""));
  const normalizedShotDir = path.resolve(String(shotDir || ""));
  if (!sourcePath || !shotDir) return "";

  const sourceStat = await fs.stat(normalizedSourcePath).catch(() => null);
  if (!sourceStat?.isFile()) return "";

  const sourceExtension = path.extname(normalizedSourcePath).toLowerCase();
  const extension = VIDEO_EXTENSIONS.has(sourceExtension) ? sourceExtension : ".mp4";
  const durablePath = path.join(normalizedShotDir, `video${extension}`);
  if (normalizedSourcePath === durablePath) return durablePath;

  await fs.mkdir(normalizedShotDir, { recursive: true });
  const temporaryPath = `${durablePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.copyFile(normalizedSourcePath, temporaryPath);
    await fs.rename(temporaryPath, durablePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
  return durablePath;
}
