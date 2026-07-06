import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { resolveDataDir, resolveStorageRoot } from "./local-storage.mjs";

import {
  dedupeSensorTowerCsvImports,
  buildSensorTowerCsvDedupeKey
} from "../server/sensortower-dedupe.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRootDir = path.resolve(__dirname, "..");
const storageRootDir = resolveStorageRoot(process.env);
const dataDir = resolveDataDir(process.env);
const filePath = path.join(dataDir, "sensortower-csv.json");

function readJsonArray(targetPath) {
  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

function resolveStoredPath(value = "") {
  const storedPath = String(value || "").trim();
  if (!storedPath) return "";
  if (path.isAbsolute(storedPath) && !storedPath.startsWith("/sensor/")) return storedPath;
  if (storedPath.startsWith("/")) return path.resolve(storageRootDir, `.${storedPath}`);
  return path.resolve(storageRootDir, storedPath);
}

const records = readJsonArray(filePath);
function readStoredCsvHash(record = {}) {
  const csvPath = resolveStoredPath(record.csvPath || "");
  if (!csvPath || !fs.existsSync(csvPath)) return "";
  return createHash("sha1").update(fs.readFileSync(csvPath)).digest("hex");
}

for (const item of records) {
  item.dedupeKey = buildSensorTowerCsvDedupeKey(item);
  item.contentHash = item.contentHash || readStoredCsvHash(item);
}

const metadataDeduped = dedupeSensorTowerCsvImports(records).unique;
const unique = [];
const duplicates = [];
const seenHashes = new Set();
for (const record of metadataDeduped) {
  if (record.contentHash && seenHashes.has(record.contentHash)) {
    duplicates.push(record);
    continue;
  }
  if (record.contentHash) seenHashes.add(record.contentHash);
  unique.push(record);
}

const duplicateIds = new Set(duplicates.map((item) => item.id));
const keptByKey = new Map(unique.map((item) => [buildSensorTowerCsvDedupeKey(item), item.id]));

fs.writeFileSync(filePath, `${JSON.stringify(unique, null, 2)}\n`, "utf8");

let removedFolders = 0;
for (const record of duplicates) {
  const dedupeKey = buildSensorTowerCsvDedupeKey(record);
  if (keptByKey.get(dedupeKey) === record.id) continue;
  const folderPath = resolveStoredPath(record.folderPath || "");
  if (folderPath && fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
    removedFolders += 1;
  }
}

console.log(JSON.stringify({
  totalBefore: records.length,
  totalAfter: unique.length,
  removedRecords: duplicates.length,
  removedFolders,
  duplicateIds: Array.from(duplicateIds).slice(0, 20)
}, null, 2));
