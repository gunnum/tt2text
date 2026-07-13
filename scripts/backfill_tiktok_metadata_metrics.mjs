#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const adShotsFile = path.join(projectRoot, "data", "ad-shots.json");
const adShotsDir = path.join(projectRoot, "data", "ad-shots");
const fields = ["view_count", "like_count", "comment_count", "repost_count", "save_count"];
const args = new Set(process.argv.slice(2));
const shouldWrite = args.has("--write");
const limitArg = [...args].find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;

const shots = JSON.parse(await fs.readFile(adShotsFile, "utf8"));
const candidates = [];

for (const shot of shots) {
  if (!shot?.shotId || !isTikTokVideoUrl(shot.sourceUrl)) continue;
  const metadataPath = path.join(adShotsDir, shot.shotId, "analysis", "metadata.json");
  const metadata = await readJsonIfExists(metadataPath);
  if (!metadata) continue;
  if (fields.every((field) => isFiniteCount(metadata[field]))) continue;
  candidates.push({ shot, metadataPath, metadata });
}

const selected = limit > 0 ? candidates.slice(0, limit) : candidates;
const results = [];

for (const item of selected) {
  const { shot, metadataPath, metadata } = item;
  try {
    const fetched = await fetchTikTokMetadata(shot.sourceUrl);
    const patch = Object.fromEntries(
      fields
        .map((field) => [field, normalizeCount(fetched[field])])
        .filter(([, value]) => value !== null)
    );
    const hasAll = fields.every((field) => isFiniteCount(patch[field]));
    if (shouldWrite && Object.keys(patch).length) {
      const merged = {
        ...metadata,
        ...patch,
        id: fetched.id || metadata.id || shot.sourceItemId || shot.sourceAdId || shot.videoId || "",
        webpage_url: fetched.webpage_url || shot.sourceUrl,
        original_url: fetched.original_url || fetched.webpage_url || shot.sourceUrl,
        metricsBackfilledAt: new Date().toISOString(),
        metricsBackfillSource: "yt-dlp"
      };
      await fs.writeFile(metadataPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
    }
    results.push({
      shotId: shot.shotId,
      sourceUrl: shot.sourceUrl,
      ok: hasAll,
      wrote: shouldWrite && Object.keys(patch).length > 0,
      patch
    });
  } catch (error) {
    results.push({
      shotId: shot.shotId,
      sourceUrl: shot.sourceUrl,
      ok: false,
      wrote: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

const summary = {
  mode: shouldWrite ? "write" : "dry-run",
  candidateCount: candidates.length,
  selectedCount: selected.length,
  successCount: results.filter((item) => item.ok).length,
  writeCount: results.filter((item) => item.wrote).length,
  failedCount: results.filter((item) => item.error).length,
  failed: results.filter((item) => item.error),
  examples: results.slice(0, 12)
};

console.log(JSON.stringify(summary, null, 2));

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isTikTokVideoUrl(value = "") {
  return /https?:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/video\/\d+/i.test(String(value || ""));
}

function isFiniteCount(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function normalizeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

async function fetchTikTokMetadata(url) {
  const raw = await run("yt-dlp", ["--skip-download", "--dump-json", "--no-warnings", url], { timeoutMs: 45_000 });
  return JSON.parse(raw);
}

function run(command, commandArgs, { timeoutMs = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(command + " timed out after " + timeoutMs + "ms"));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || command + " exited with code " + code));
      }
    });
  });
}
