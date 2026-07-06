import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export function createCodexJsonService(deps = {}) {
  const codexBin = deps.codexBin || "codex";
  const projectRootDir = deps.projectRootDir;
  const env = deps.env || process.env;
  if (!projectRootDir) {
    throw new Error("createCodexJsonService 缺少依赖：projectRootDir");
  }

  async function runCodexJsonTask(prompt, timeoutMs) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tt2text-codex-"));
    const outputPath = path.join(tmpDir, "output.json");
    let child;
    try {
      const content = await new Promise((resolve, reject) => {
        child = spawn(codexBin, [
          "exec",
          "--ephemeral",
          "--skip-git-repo-check",
          "--output-last-message",
          outputPath,
          "-"
        ], {
          cwd: projectRootDir,
          env
        });

        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`Codex CLI 超时（>${Math.round(timeoutMs / 1000)} 秒）`));
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
              reject(new Error((stderr || stdout || `Codex CLI exited ${code}`).trim()));
              return;
            }
            resolve((await fs.readFile(outputPath, "utf8")).trim());
          } catch (error) {
            reject(error);
          }
        });
        child.stdin.end(prompt);
      });
      return content;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  function extractJsonObject(content) {
    const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    if (text.startsWith("{") && text.endsWith("}")) {
      return text;
    }
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("找不到 JSON 对象。");
    }
    return match[0];
  }

  return {
    runCodexJsonTask,
    extractJsonObject
  };
}
