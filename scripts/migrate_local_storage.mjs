#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(path.dirname(__filename));
const storageRoot = resolveStorageRoot();
const mode = process.argv.includes("--move") ? "move" : "copy";
const dryRun = process.argv.includes("--dry-run");

const entries = [
  "data",
  "reports",
  "sensor",
  "output"
];

await fs.mkdir(storageRoot, { recursive: true });

const actions = [];
for (const entry of entries) {
  const source = path.join(projectRoot, entry);
  const target = path.join(storageRoot, entry);
  const stat = await fs.stat(source).catch(() => null);
  if (!stat) continue;
  actions.push({ entry, source, target });
}

if (!actions.length) {
  console.log("No local storage directories found in the project root.");
  console.log(`Storage root: ${storageRoot}`);
  process.exit(0);
}

for (const action of actions) {
  console.log(`${mode === "move" ? "Move" : "Copy"} ${action.source} -> ${action.target}`);
  if (dryRun) continue;
  await fs.mkdir(path.dirname(action.target), { recursive: true });
  if (mode === "move") {
    await moveDirectory(action.source, action.target);
  } else {
    copyDirectory(action.source, action.target);
  }
}

console.log("");
console.log(`Done. TT2TEXT_STORAGE_DIR=${storageRoot}`);
if (mode === "copy") {
  console.log("Copy mode kept the original project-root directories. Re-run with --move after verifying the app.");
}

function resolveStorageRoot() {
  const explicit = valueAfter("--storage") || process.env.TT2TEXT_STORAGE_DIR || process.env.TT2TEXT_DATA_ROOT || process.env.TT2TEXT_HOME;
  if (explicit) return path.resolve(expandHome(explicit));
  if (process.env.TT2TEXT_DATA_DIR) return path.resolve(expandHome(process.env.TT2TEXT_DATA_DIR), "..");
  return path.join(os.homedir(), "Library", "Application Support", "TT2Text");
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function expandHome(value) {
  const text = String(value || "").trim();
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}

async function moveDirectory(source, target) {
  await fs.rm(target, { recursive: true, force: true });
  try {
    await fs.rename(source, target);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    copyDirectory(source, target);
    await fs.rm(source, { recursive: true, force: true });
  }
}

function copyDirectory(source, target) {
  const result = spawnSync("ditto", [source, target], { stdio: "inherit" });
  if (result.status === 0) return;
  const fallback = spawnSync("cp", ["-R", `${source}/.`, target], { stdio: "inherit" });
  if (fallback.status !== 0) {
    throw new Error(`Failed to copy ${source} -> ${target}`);
  }
}
