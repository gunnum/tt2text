const DEBUG_LOG_KEY = "tt2textDebugLogs";
const DEBUG_LOG_LIMIT = 200;
const DEBUG_LOG_ENABLED_KEY = "tt2textDebugEnabled";
const DEBUG_LOG_SYNC_URL = "http://localhost:3000/api/plugin-debug-logs";

export async function setImportStatus(status) {
  await chrome.storage.local.set({ tt2textImportStatus: status });
}

export async function getImportStatus() {
  const payload = await chrome.storage.local.get("tt2textImportStatus");
  return payload.tt2textImportStatus || { state: "idle", message: "暂无采集任务。" };
}

export async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

export async function appendDebugLog(entry = {}) {
  const enabled = await isDebugLoggingEnabled();
  const item = {
    at: new Date().toISOString(),
    scope: String(entry.scope || "unknown"),
    event: String(entry.event || "log"),
    detail: entry.detail && typeof entry.detail === "object" ? entry.detail : {}
  };
  try {
    const payload = await chrome.storage.local.get(DEBUG_LOG_KEY);
    const list = Array.isArray(payload[DEBUG_LOG_KEY]) ? payload[DEBUG_LOG_KEY] : [];
    list.push(item);
    const next = list.slice(-DEBUG_LOG_LIMIT);
    await chrome.storage.local.set({ [DEBUG_LOG_KEY]: next });
  } catch {
    // Ignore storage failures; console output is still useful.
  }
  try {
    console.log("[TT2TEXT]", item.scope, item.event, item.detail);
  } catch {
    // Ignore console failures.
  }
  if (!enabled) {
    return;
  }
  try {
    await fetch(DEBUG_LOG_SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item)
    });
  } catch {
    // Ignore remote sync failures; local extension log still exists.
  }
}

export async function getDebugLogs() {
  const payload = await chrome.storage.local.get(DEBUG_LOG_KEY);
  return Array.isArray(payload[DEBUG_LOG_KEY]) ? payload[DEBUG_LOG_KEY] : [];
}

export async function clearDebugLogs() {
  await chrome.storage.local.set({ [DEBUG_LOG_KEY]: [] });
}

export async function isDebugLoggingEnabled() {
  const payload = await chrome.storage.local.get(DEBUG_LOG_ENABLED_KEY);
  return payload[DEBUG_LOG_ENABLED_KEY] === true;
}

export async function setDebugLoggingEnabled(enabled) {
  await chrome.storage.local.set({ [DEBUG_LOG_ENABLED_KEY]: Boolean(enabled) });
  return { enabled: Boolean(enabled) };
}

export function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
