import { spawn, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_AGNES_SCRIPT = "";
const DEFAULT_AGNES_MODEL = "agnes-2.0-flash";

export function createAgnesJsonService(deps = {}) {
  const projectRootDir = deps.projectRootDir;
  const env = deps.env || process.env;
  if (!projectRootDir) {
    throw new Error("createAgnesJsonService 缺少依赖：projectRootDir");
  }

  const pythonBin = deps.pythonBin || env.TT2TEXT_AGNES_PYTHON || "python3";
  const agnesScript = deps.agnesScript || env.TT2TEXT_AGNES_CALL_SCRIPT || DEFAULT_AGNES_SCRIPT;
  const defaultModel = deps.defaultModel || env.TT2TEXT_AGNES_ANALYSIS_MODEL || env.AGNES_MODEL || DEFAULT_AGNES_MODEL;

  function hasApiKey() {
    const envKey = normalizeText(env.AGNES_API_KEY || env.TT2TEXT_AGNES_API_KEY);
    if (envKey) return true;
    try {
      return Boolean(execFileSync("security", ["find-generic-password", "-a", "default", "-s", "agnes-ai", "-w"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim());
    } catch {
      return false;
    }
  }

  function isAvailable() {
    return Boolean(agnesScript) && hasApiKey();
  }

  async function runAgnesJsonTask(prompt, timeoutMs, options = {}) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt2text-agnes-"));
    const outputPath = path.join(tmpDir, "output.txt");
    let child;
    try {
      const content = await new Promise((resolve, reject) => {
        const model = normalizeText(options.model || defaultModel) || DEFAULT_AGNES_MODEL;
        child = spawn(pythonBin, [
          agnesScript,
          "chat",
          "--model",
          model,
          "--max-tokens",
          String(Number(options.maxTokens) || 2400),
          prompt
        ], {
          cwd: projectRootDir,
          env
        });

        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`Agnes 超时（>${Math.round(timeoutMs / 1000)} 秒）`));
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on("close", async (code) => {
          clearTimeout(timer);
          try {
            if (code !== 0) {
              reject(new Error((stderr || stdout || `Agnes exited ${code}`).trim()));
              return;
            }
            await fs.writeFile(outputPath, stdout, "utf8");
            resolve((await fs.readFile(outputPath, "utf8")).trim());
          } catch (error) {
            reject(error);
          }
        });
      });
      return content;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    isAvailable,
    runAgnesJsonTask
  };
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
