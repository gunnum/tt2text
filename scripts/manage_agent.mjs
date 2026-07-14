#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(path.dirname(__filename));
const label = "com.tt2text.agent";
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const plistPath = path.join(launchAgentsDir, `${label}.plist`);
const logDir = path.join(os.homedir(), "Library", "Logs", "tt2text");
const storageRootDir = process.env.TT2TEXT_STORAGE_DIR
  ? path.resolve(expandHome(process.env.TT2TEXT_STORAGE_DIR))
  : projectRoot;
const nodePath = process.execPath;
const serverPath = path.join(projectRoot, "server.mjs");
const userDomain = `gui/${process.getuid()}`;
const serviceTarget = `${userDomain}/${label}`;

const command = process.argv[2] || "help";

try {
  if (command === "install") {
    await installAgent();
  } else if (command === "uninstall") {
    await uninstallAgent();
  } else if (command === "start") {
    await startAgent();
  } else if (command === "stop") {
    await stopAgent();
  } else if (command === "restart") {
    await restartAgent();
  } else if (command === "status") {
    await printStatus();
  } else if (command === "open") {
    openLocalPages();
  } else {
    printHelp();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function installAgent() {
  await fs.mkdir(launchAgentsDir, { recursive: true });
  await fs.mkdir(logDir, { recursive: true });
  await fs.mkdir(storageRootDir, { recursive: true });
  await fs.writeFile(plistPath, buildPlist(), "utf8");

  launchctl(["bootout", userDomain, plistPath], { allowFailure: true });
  launchctl(["bootstrap", userDomain, plistPath]);
  launchctl(["enable", serviceTarget], { allowFailure: true });
  launchctl(["kickstart", "-k", serviceTarget], { allowFailure: true });
  console.log(`Installed ${label}`);
  console.log(`Plist: ${plistPath}`);
  console.log("Local app: http://localhost:3000/");
}

async function uninstallAgent() {
  launchctl(["bootout", userDomain, plistPath], { allowFailure: true });
  await fs.rm(plistPath, { force: true });
  console.log(`Uninstalled ${label}`);
}

async function startAgent() {
  await ensureInstalled();
  launchctl(["bootstrap", userDomain, plistPath], { allowFailure: true });
  launchctl(["kickstart", "-k", serviceTarget]);
  console.log(`Started ${label}`);
}

async function stopAgent() {
  launchctl(["bootout", userDomain, plistPath], { allowFailure: true });
  console.log(`Stopped ${label}`);
}

async function restartAgent() {
  await stopAgent();
  await startAgent();
}

async function printStatus() {
  const response = await fetch("http://localhost:3000/api/apps").catch(() => null);
  console.log(response?.ok ? "Local app: running at http://localhost:3000/" : "Local app: not responding on http://localhost:3000/");

  const status = launchctl(["print", serviceTarget], { allowFailure: true });
  console.log(status.status === 0 ? "LaunchAgent: loaded" : "LaunchAgent: not loaded");
  if (status.stdout) {
    const pidLine = status.stdout.split("\n").find((line) => line.trim().startsWith("pid ="));
    if (pidLine) {
      console.log(pidLine.trim());
    }
  }
}

function openLocalPages() {
  spawnSync("open", ["-a", "Google Chrome", "http://localhost:3000/"], { stdio: "inherit" });
  spawnSync("open", ["-a", "Google Chrome", "chrome://extensions/"], { stdio: "inherit" });
}

async function ensureInstalled() {
  try {
    await fs.access(plistPath);
  } catch {
    await installAgent();
  }
}

function launchctl(args, options = {}) {
  const result = spawnSync("launchctl", args, { encoding: "utf8" });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `launchctl ${args.join(" ")} failed`);
  }
  return result;
}

function buildPlist() {
  const pathEnv = process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(serverPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(projectRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(pathEnv)}</string>
    <key>TT2TEXT_STORAGE_DIR</key>
    <string>${escapeXml(storageRootDir)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(logDir, "agent.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(logDir, "agent.err.log"))}</string>
</dict>
</plist>
`;
}

function expandHome(value) {
  const text = String(value || "").trim();
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;"
  })[char]);
}

function printHelp() {
  console.log(`Usage: node scripts/manage_agent.mjs <command>

Commands:
  install    Install and start the macOS LaunchAgent
  uninstall  Stop and remove the LaunchAgent
  start      Start the LaunchAgent
  stop       Stop the LaunchAgent
  restart    Restart the LaunchAgent
  status     Check local app and LaunchAgent status
  open       Open the local app and Chrome extensions page
`);
}
