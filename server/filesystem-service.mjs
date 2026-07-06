import { promises as fs } from "node:fs";

export function createFilesystemService() {
  async function ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
  }

  async function ensureFile(filePath, initialContent) {
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, initialContent, "utf8");
    }
  }

  return {
    ensureDir,
    ensureFile
  };
}
