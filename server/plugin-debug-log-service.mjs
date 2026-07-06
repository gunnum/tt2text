import { promises as fs } from "node:fs";

export function createPluginDebugLogService(deps = {}) {
  const requiredDeps = [
    "pluginDebugLogFile",
    "formatDate"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createPluginDebugLogService 缺少依赖：${dep}`);
    }
  }

  async function appendPluginDebugLog(entry = {}) {
    const payload = {
      at: entry.at || new Date().toISOString(),
      receivedAt: deps.formatDate(new Date()),
      scope: String(entry.scope || "unknown"),
      event: String(entry.event || "log"),
      detail: entry.detail && typeof entry.detail === "object" ? entry.detail : {}
    };
    await fs.appendFile(deps.pluginDebugLogFile, `${JSON.stringify(payload, null, 0)}\n`, "utf8");
    return { ok: true };
  }

  async function readPluginDebugLogs() {
    const raw = await fs.readFile(deps.pluginDebugLogFile, "utf8").catch(() => "");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-400);
  }

  async function clearPluginDebugLogs() {
    await fs.writeFile(deps.pluginDebugLogFile, "", "utf8");
    return { ok: true, cleared: true };
  }

  return {
    appendPluginDebugLog,
    readPluginDebugLogs,
    clearPluginDebugLogs
  };
}
