#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataDir } from "./local-storage.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.dirname(__dirname);
const dataDir = resolveDataDir(process.env);
const resultsFile = path.join(dataDir, "results.json");
const codexBin = process.env.TT2TEXT_CODEX_BIN || "codex";
const maxFrames = Number(process.env.TT2TEXT_VISUAL_MAX_FRAMES || 16);
const minFrames = Number(process.env.TT2TEXT_VISUAL_MIN_FRAMES || 4);
const frameIntervalSeconds = Number(process.env.TT2TEXT_VISUAL_FRAME_INTERVAL || 5);

const args = parseArgs(process.argv.slice(2));

const results = JSON.parse(await fs.readFile(resultsFile, "utf8"));
const targets = results.filter((item) => shouldSummarizeVisual(item, args.force));
const selectedTargets = args.limit ? targets.slice(0, args.limit) : targets;

if (args.dryRun) {
  console.log(JSON.stringify({
    total: results.length,
    matched: targets.length,
    selected: selectedTargets.length,
    items: selectedTargets.map((item) => ({
      id: item.id,
      title: item.title,
      transcriptEnLength: String(item.transcriptEn || "").trim().length,
      transcriptZh: item.transcriptZh || "",
      sourceUrl: item.sourceUrl
    }))
  }, null, 2));
  process.exit(0);
}

let updated = 0;
for (const item of selectedTargets) {
  const videoPath = findVideoPath(item);
  if (!videoPath) {
    console.warn(`skip ${item.id}: video file not found`);
    continue;
  }

  console.log(`visual summary ${item.id}: ${item.title || item.sourceUrl}`);
  const frames = extractFrames(videoPath, item.id);
  if (!frames.length) {
    console.warn(`skip ${item.id}: no frames extracted`);
    continue;
  }

  const summary = runVisualSummary({ item, frames });
  item.visualSummary = {
    summaryZh: summary.summary_zh,
    observedText: summary.observed_text || [],
    appScreens: summary.app_screens || [],
    userReaction: summary.user_reaction || "",
    contentType: summary.content_type || "",
    frames: frames.map((frame) => path.relative(rootDir, frame)),
    generatedAt: formatChinaDate(new Date())
  };
  item.transcriptZh = `视觉摘要：${summary.summary_zh}`;
  item.sourceLanguage = item.sourceLanguage || "visual";
  updated += 1;

  await fs.writeFile(resultsFile, `${JSON.stringify(results, null, 2)}\n`, "utf8");
}

console.log(`updated ${updated}/${selectedTargets.length} visual summaries`);

function shouldSummarizeVisual(item, force) {
  if (force) {
    return true;
  }
  if (item.visualSummary?.summaryZh) {
    return false;
  }
  const transcriptEn = String(item.transcriptEn || "").trim();
  const transcriptZh = String(item.transcriptZh || "").trim();
  const title = String(item.title || "").trim();
  const strongTrigger = !transcriptEn
    || transcriptEn.length < 80
    || !transcriptZh
    || transcriptZh === "暂无中文翻译。"
    || transcriptZh === "未检测到可转写的音频。";
  if (strongTrigger) {
    return true;
  }

  const weakSpeech = transcriptEn.length < 160 || transcriptZh.length < 80;
  const visualTitle = /\b(this app|omg|no way|reaction|soulmate|sketch|compatibility|replying to)\b/i.test(title)
    || /[!?]{2,}|😭|😱|😳|💖|💕/.test(title);
  return weakSpeech && visualTitle;
}

function findVideoPath(item) {
  const candidates = [];
  if (item.firstFramePath) {
    const jobDir = path.dirname(publicPathToLocal(item.firstFramePath));
    candidates.push(path.join(jobDir, "video.mp4"));
    candidates.push(path.join(jobDir, "video.webm"));
    candidates.push(path.join(jobDir, "video.mov"));
  }
  candidates.push(path.join(dataDir, "jobs", item.id, "video.mp4"));
  return candidates.find((candidate) => fileExists(candidate)) || "";
}

function publicPathToLocal(value) {
  const clean = String(value || "").replace(/^\/+/, "");
  return path.join(rootDir, clean);
}

function fileExists(filePath) {
  try {
    return Boolean(filePath) && requireStat(filePath).isFile();
  } catch {
    return false;
  }
}

function requireStat(filePath) {
  return spawnSync("test", ["-f", filePath]).status === 0
    ? { isFile: () => true }
    : { isFile: () => false };
}

function extractFrames(videoPath, id) {
  const duration = getDuration(videoPath);
  if (!duration || duration <= 0) {
    return [];
  }
  const timestamps = buildFrameTimestamps(duration);
  const frameDir = path.join(path.dirname(videoPath), "visual-frames");
  spawnSync("rm", ["-rf", frameDir]);
  spawnSync("mkdir", ["-p", frameDir]);

  const frames = [];
  timestamps.forEach((timestamp, index) => {
    const framePath = path.join(frameDir, `frame-${String(index + 1).padStart(2, "0")}.jpg`);
    const result = spawnSync("ffmpeg", [
      "-y",
      "-ss",
      String(timestamp),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      framePath
    ], { encoding: "utf8" });
    if (result.status === 0 && fileExists(framePath)) {
      frames.push(framePath);
    } else {
      console.warn(`failed to extract frame ${id} @ ${timestamp}s: ${result.stderr || result.stdout || result.status}`);
    }
  });
  return frames;
}

function getDuration(videoPath) {
  const result = spawnSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath
  ], { encoding: "utf8" });
  return Number.parseFloat(result.stdout);
}

function buildFrameTimestamps(duration) {
  const count = duration < 20
    ? minFrames
    : Math.max(minFrames, Math.min(maxFrames, Math.ceil(duration / frameIntervalSeconds)));
  if (count <= 1) {
    return [Math.max(0, duration / 2)];
  }
  return Array.from({ length: count }, (_, index) => {
    const ratio = (index + 0.5) / count;
    return Math.max(0, Math.min(duration - 0.2, duration * ratio));
  });
}

function runVisualSummary({ item, frames }) {
  const outputPath = path.join(path.dirname(frames[0]), "visual-summary.json");
  const prompt = [
    "你是一个 App 调研分析助手。请根据这些按时间顺序抽取的视频帧，理解这个 TikTok 视频在表达什么。",
    "这个视频可能没有台词，核心信息可能来自画面文字、App 截图、贴纸文字、用户表情和反应。",
    "",
    `视频标题：${item.title || ""}`,
    `原链接：${item.sourceUrl || item.hyperlink || ""}`,
    "",
    "请输出 JSON，不要 markdown，不要解释，格式严格为：",
    "{\"summary_zh\":\"...\",\"observed_text\":[\"...\"],\"app_screens\":[\"...\"],\"user_reaction\":\"...\",\"content_type\":\"...\"}",
    "",
    "summary_zh 要用中文，概括视频表达的核心信息、卖点、用户反应和与 App 的关系。"
  ].join("\n");

  const command = [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--output-last-message",
    outputPath,
    ...frames.flatMap((frame) => ["--image", frame]),
    "-"
  ];
  const result = spawnSync(codexBin, command, {
    input: prompt,
    encoding: "utf8",
    cwd: rootDir,
    timeout: 240_000
  });
  if (result.status !== 0) {
    throw new Error(`Codex 视觉摘要失败：${result.stderr || result.stdout || result.status}`);
  }
  const content = requireRead(outputPath).trim();
  return JSON.parse(extractJsonObject(content));
}

function requireRead(filePath) {
  return spawnSync("cat", [filePath], { encoding: "utf8" }).stdout;
}

function extractJsonObject(content) {
  const text = content.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
  if (text.startsWith("{") && text.endsWith("}")) {
    return text;
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`找不到 JSON 输出：${content}`);
  }
  return match[0];
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    force: false,
    limit: 0
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--limit") {
      parsed.limit = Number(argv[index + 1] || 0);
      index += 1;
    }
  }
  return parsed;
}

function formatChinaDate(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date).replace(/\//g, "-");
}
