import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

export function createVideoRunnerService(deps = {}) {
  const requiredDeps = [
    "projectRootDir",
    "pythonRunner",
    "visualOcrRunner",
    "photoRunner",
    "videoConversionTimeoutMs",
    "visualOcrTimeoutMs",
    "ocrPythonBin",
    "normalizeText",
    "truncateText"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createVideoRunnerService 缺少依赖：${dep}`);
    }
  }

  const progressPrefix = deps.progressPrefix || "__TT2TEXT_PROGRESS__";

  function runPythonConversion(videoUrl, jobDir, onProgress, options = {}) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      if (options.alwaysVisual) {
        env.TT2TEXT_ALWAYS_VISUAL = "1";
      }
      if (options.visualFrameInterval) {
        env.TT2TEXT_VISUAL_FRAME_INTERVAL = String(options.visualFrameInterval);
      }
      if (options.maxVisualFrames) {
        env.TT2TEXT_MAX_VISUAL_FRAMES = String(options.maxVisualFrames);
      }

      const child = spawn("python3", [deps.pythonRunner, videoUrl, jobDir], {
        cwd: deps.projectRootDir,
        env
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const progressWrites = [];
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill("SIGKILL");
        reject(new Error(`转写超时（>${Math.floor(deps.videoConversionTimeoutMs / 60000)} 分钟），任务已终止，可点击重试。`));
      }, deps.videoConversionTimeoutMs);

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        stdout += text;
        if (typeof onProgress === "function") {
          const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          for (const line of lines) {
            if (!line.startsWith(progressPrefix)) {
              continue;
            }
            try {
              const payload = JSON.parse(line.slice(progressPrefix.length));
              progressWrites.push(Promise.resolve(onProgress(payload)).catch(() => {}));
            } catch {
              // Ignore malformed progress lines and keep the job moving.
            }
          }
        }
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("close", async (code) => {
        clearTimeout(timeout);
        if (settled) {
          return;
        }
        settled = true;
        await Promise.allSettled(progressWrites);
        if (code !== 0) {
          reject(new Error(stderr.trim() || stdout.trim() || `转写失败，退出码 ${code}`));
          return;
        }

        try {
          resolve(parseLastJsonLine(stdout));
        } catch {
          reject(new Error(`无法解析转写结果: ${stdout}`));
        }
      });
    });
  }

  function runVisualOcrExtraction(videoPath, jobDir) {
    return new Promise((resolve) => {
      const child = spawn(deps.ocrPythonBin, [deps.visualOcrRunner, videoPath, jobDir], {
        cwd: deps.projectRootDir,
        env: process.env
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill("SIGKILL");
        resolve({
          ok: false,
          visual_text_segments: [],
          error: `OCR 定位超时（>${Math.floor(deps.visualOcrTimeoutMs / 60000)} 分钟）`
        });
      }, deps.visualOcrTimeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        if (settled) {
          return;
        }
        settled = true;
        resolve({
          ok: false,
          visual_text_segments: [],
          error: error instanceof Error ? error.message : String(error)
        });
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (settled) {
          return;
        }
        settled = true;
        if (code !== 0) {
          resolve({
            ok: false,
            visual_text_segments: [],
            error: deps.normalizeText(stderr || stdout || `OCR 定位失败，退出码 ${code}`)
          });
          return;
        }
        try {
          resolve({
            ok: true,
            ...parseLastJsonLine(stdout)
          });
        } catch {
          resolve({
            ok: false,
            visual_text_segments: [],
            error: `无法解析 OCR 定位结果：${deps.truncateText(stdout, 800)}`
          });
        }
      });
    });
  }

  function runVisualOnlyConversion(videoUrl, jobDir, onProgress) {
    return new Promise((resolve, reject) => {
      const child = spawn("python3", [deps.pythonRunner, "--visual-only", videoUrl, jobDir], {
        cwd: deps.projectRootDir,
        env: process.env
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill("SIGKILL");
        reject(new Error(`视觉理解超时（>${Math.floor(deps.videoConversionTimeoutMs / 60000)} 分钟），任务已终止。`));
      }, deps.videoConversionTimeoutMs);

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        stdout += text;
        if (typeof onProgress === "function") {
          const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          for (const line of lines) {
            if (!line.startsWith(progressPrefix)) {
              continue;
            }
            try {
              onProgress(JSON.parse(line.slice(progressPrefix.length)));
            } catch {
              // Ignore malformed progress lines.
            }
          }
        }
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        if (settled) {
          return;
        }
        settled = true;
        if (code !== 0) {
          reject(new Error(stderr.trim() || stdout.trim() || `视觉理解失败，退出码 ${code}`));
          return;
        }

        try {
          resolve(parseLastJsonLine(stdout));
        } catch {
          reject(new Error(`无法解析视觉理解结果: ${stdout}`));
        }
      });
    });
  }

  async function runPhotoConversion(photoUrl, jobDir, preview = {}, onProgress) {
    const previewPath = path.join(jobDir, "preview.json");
    await fs.writeFile(previewPath, JSON.stringify(preview, null, 2), "utf8");
    return new Promise((resolve, reject) => {
      const child = spawn("python3", [deps.photoRunner, photoUrl, jobDir, JSON.stringify(preview)], {
        cwd: deps.projectRootDir,
        env: process.env
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill("SIGKILL");
        reject(new Error(`图集处理超时（>${Math.floor(deps.videoConversionTimeoutMs / 60000)} 分钟），任务已终止，可点击重试。`));
      }, deps.videoConversionTimeoutMs);

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        stdout += text;
        if (typeof onProgress === "function") {
          const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          for (const line of lines) {
            if (!line.startsWith(progressPrefix)) {
              continue;
            }
            try {
              onProgress(JSON.parse(line.slice(progressPrefix.length)));
            } catch {
              // Ignore malformed progress lines.
            }
          }
        }
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        if (settled) {
          return;
        }
        settled = true;
        if (code !== 0) {
          reject(new Error(stderr.trim() || stdout.trim() || `图集处理失败，退出码 ${code}`));
          return;
        }
        try {
          resolve(parseLastJsonLine(stdout));
        } catch {
          reject(new Error(`无法解析图集处理结果: ${stdout}`));
        }
      });
    });
  }

  return {
    runPythonConversion,
    runVisualOcrExtraction,
    runVisualOnlyConversion,
    runPhotoConversion
  };
}

function parseLastJsonLine(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonLine = [...lines].reverse().find((line) => line.startsWith("{") && line.endsWith("}"));
  if (!jsonLine) {
    throw new Error("missing json payload");
  }
  return JSON.parse(jsonLine);
}
