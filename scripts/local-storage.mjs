import os from "node:os";
import path from "node:path";

export function resolveStorageRoot(env = process.env) {
  const explicit = env.TT2TEXT_STORAGE_DIR || env.TT2TEXT_DATA_ROOT || env.TT2TEXT_HOME;
  if (explicit) {
    return path.resolve(expandHome(explicit));
  }
  if (env.TT2TEXT_DATA_DIR) {
    return path.resolve(expandHome(env.TT2TEXT_DATA_DIR), "..");
  }
  return path.join(os.homedir(), "Library", "Application Support", "TT2Text");
}

export function resolveDataDir(env = process.env) {
  return env.TT2TEXT_DATA_DIR
    ? path.resolve(expandHome(env.TT2TEXT_DATA_DIR))
    : path.join(resolveStorageRoot(env), "data");
}

export function resolveReportsDir(env = process.env) {
  return path.join(resolveStorageRoot(env), "reports");
}

export function resolveLocalTmpDir(env = process.env) {
  return path.join(resolveStorageRoot(env), ".tmp");
}

function expandHome(value) {
  const text = String(value || "").trim();
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}
