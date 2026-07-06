import { promises as fs } from "node:fs";

export function createJsonFileService(deps = {}) {
  const logger = deps.logger || console;
  let atomicWriteCounter = 0;
  const writeLocks = new Map();

  async function readJsonArrayFile(filePath) {
    const raw = await fs.readFile(filePath, "utf8");
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error("JSON root is not an array");
      }
      return parsed;
    } catch (error) {
      const recovered = recoverJsonArray(raw);
      if (!recovered) {
        throw error;
      }
      await backupCorruptJson(filePath);
      await writeJsonFileAtomic(filePath, recovered);
      logger.warn?.(`Recovered corrupt JSON array file: ${filePath}`);
      return recovered;
    }
  }

  async function writeJsonFileAtomic(filePath, value) {
    const previousWrite = writeLocks.get(filePath) || Promise.resolve();
    const nextWrite = previousWrite.then(async () => {
      atomicWriteCounter = (atomicWriteCounter + 1) % Number.MAX_SAFE_INTEGER;
      const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteCounter}.tmp`;
      await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await fs.rename(tmpPath, filePath);
    });
    const guardedWrite = nextWrite.catch(() => {});
    writeLocks.set(filePath, guardedWrite);
    try {
      await nextWrite;
    } finally {
      if (writeLocks.get(filePath) === guardedWrite) {
        writeLocks.delete(filePath);
      }
    }
  }

  function recoverJsonArray(raw) {
    for (let end = raw.length; end > 0; end -= 1) {
      const slice = raw.slice(0, end).trimEnd();
      try {
        const parsed = JSON.parse(slice);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // Keep scanning backward until the last valid JSON array boundary.
      }
    }
    return null;
  }

  async function backupCorruptJson(filePath) {
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    await fs.copyFile(filePath, `${filePath}.corrupt-${stamp}`);
  }

  return {
    readJsonArrayFile,
    writeJsonFileAtomic
  };
}
