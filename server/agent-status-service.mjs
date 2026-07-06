import { spawnSync } from "node:child_process";
import path from "node:path";

export function createAgentStatusService(deps = {}) {
  const projectRootDir = deps.projectRootDir;
  const storageRootDir = deps.storageRootDir || projectRootDir;
  const port = Number(deps.port) || 3000;
  const codexBin = deps.codexBin || "codex";
  const env = deps.env || process.env;
  if (!projectRootDir) {
    throw new Error("createAgentStatusService 缺少依赖：projectRootDir");
  }

  async function getAgentStatus() {
    const launchStatus = getLaunchAgentStatus();
    return {
      localServer: {
        running: true,
        url: `http://localhost:${port}/`,
        pid: process.pid
      },
      launchAgent: parseLaunchAgentStatus(launchStatus.stdout),
      cli: {
        node: checkCli(process.execPath, ["--version"]),
        python3: checkCli("python3", ["--version"]),
        ffmpeg: checkCli("ffmpeg", ["-version"]),
        ytDlp: checkCli("yt-dlp", ["--version"]),
        codex: checkCli(codexBin, ["--version"])
      },
      commands: {
        install: path.join(projectRootDir, "install-agent.command"),
        start: path.join(projectRootDir, "start-agent.command"),
        stop: path.join(projectRootDir, "stop-agent.command"),
        uninstall: path.join(projectRootDir, "uninstall-agent.command")
      },
      logs: {
        stdout: path.join(storageRootDir, "logs", "agent.out.log"),
        stderr: path.join(storageRootDir, "logs", "agent.err.log")
      },
      raw: {
        statusCode: launchStatus.status,
        stdout: launchStatus.stdout,
        stderr: launchStatus.stderr
      }
    };
  }

  function getLaunchAgentStatus() {
    const serviceTarget = `gui/${process.getuid()}/com.tt2text.agent`;
    const result = spawnSync("launchctl", ["print", serviceTarget], {
      cwd: projectRootDir,
      encoding: "utf8",
      env,
      timeout: 8000
    });
    const loaded = result.status === 0;
    const stdout = loaded ? `LaunchAgent: loaded\n${result.stdout || ""}` : "LaunchAgent: not loaded";
    return {
      status: result.status ?? 1,
      stdout: String(stdout).trim(),
      stderr: String(result.stderr || result.error?.message || "").trim()
    };
  }

  function checkCli(command, args) {
    const result = spawnSync(command, args, {
      cwd: projectRootDir,
      encoding: "utf8",
      env,
      timeout: 8000
    });
    const output = String(result.stdout || result.stderr || "").trim();
    return {
      available: result.status === 0,
      command,
      version: output.split(/\r?\n/)[0] || "",
      error: result.status === 0 ? "" : String(result.stderr || result.error?.message || "不可用").trim()
    };
  }

  function parseLaunchAgentStatus(stdout) {
    const loaded = /LaunchAgent:\s*loaded/i.test(stdout);
    const pidMatch = stdout.match(/pid\s*=\s*(\d+)/);
    return {
      loaded,
      pid: pidMatch ? Number(pidMatch[1]) : null,
      label: "com.tt2text.agent"
    };
  }

  return {
    getAgentStatus
  };
}
