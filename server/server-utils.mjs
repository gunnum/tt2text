import path from "node:path";

export function createServerUtils({ projectRootDir, storageRootDir, publicDir } = {}) {
  if (!projectRootDir) {
    throw new Error("createServerUtils 缺少依赖：projectRootDir");
  }
  const storageRoot = storageRootDir || projectRootDir;
  const publicRoot = publicDir || path.join(projectRootDir, "public");

  function uniqueStrings(items) {
    return Array.from(new Set(items.map((item) => normalizeText(item)).filter(Boolean)));
  }

  function normalizeStringArray(items) {
    if (typeof items === "string") {
      return [truncateText(normalizeText(items), 180)].filter(Boolean);
    }
    if (!Array.isArray(items)) {
      return [];
    }
    return items.map((item) => truncateText(normalizeText(item), 180)).filter(Boolean);
  }

  function truncateText(value, maxLength) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength - 1)}…`;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function createJobId() {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0")
    ].join("");
    const rand = Math.random().toString(36).slice(2, 8);
    return `${stamp}-${rand}`;
  }

  function normalizeToPublicPath(fullPath) {
    const text = normalizeText(fullPath);
    if (!text) {
      return "";
    }
    if (/^(?:https?:|data:|blob:)/i.test(text)) {
      return text;
    }
    if (/^\/(?:data|sensor|reports|public)\//.test(text)) {
      return text;
    }
    const storageRelative = path.relative(storageRoot, text);
    if (storageRelative && !storageRelative.startsWith("..") && !path.isAbsolute(storageRelative)) {
      return `/${storageRelative.split(path.sep).join("/")}`;
    }
    const publicRelative = path.relative(publicRoot, text);
    if (publicRelative && !publicRelative.startsWith("..") && !path.isAbsolute(publicRelative)) {
      return `/public/${publicRelative.split(path.sep).join("/")}`;
    }
    const relative = path.relative(projectRootDir, text);
    return `/${relative.split(path.sep).join("/")}`;
  }

  function resolveProjectPublicPath(publicPath) {
    const text = normalizeText(publicPath);
    if (!text.startsWith("/")) {
      throw new Error("只能解析项目内公开路径。");
    }
    const fullPath = resolvePublicPathToFile(text);
    if (!isInsideAnyRoot(fullPath, [projectRootDir, storageRoot])) {
      throw new Error("公开路径越界。");
    }
    return fullPath;
  }

  function resolvePublicPathToFile(publicPath) {
    const text = normalizeText(publicPath);
    if (text.startsWith("/data/") || text === "/data") {
      return path.resolve(storageRoot, `.${text}`);
    }
    if (text.startsWith("/reports/") || text === "/reports") {
      return path.resolve(storageRoot, `.${text}`);
    }
    if (text.startsWith("/sensor/") || text === "/sensor") {
      return path.resolve(storageRoot, `.${text}`);
    }
    if (text.startsWith("/public/") || text === "/public") {
      return path.resolve(publicRoot, text.replace(/^\/public\/?/, ""));
    }
    return path.resolve(projectRootDir, `.${text}`);
  }

  function isInsideAnyRoot(fullPath, roots) {
    return roots.filter(Boolean).some((root) => {
      const relative = path.relative(root, fullPath);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    });
  }

  function safePathSegment(value) {
    return normalizeText(value)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Unknown App";
  }

  function safeFilename(value) {
    const cleaned = normalizeText(value)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    return cleaned || "sensortower.csv";
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

  function normalizeVideoUrl(value) {
    return normalizeSourceUrl(value);
  }

  function normalizeSourceUrl(value) {
    try {
      const parsed = new URL(value);
      parsed.hash = "";
      for (const key of [...parsed.searchParams.keys()]) {
        if (["t", "q", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].includes(key)) {
          parsed.searchParams.delete(key);
        }
      }
      parsed.searchParams.sort();
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return String(value || "").trim().replace(/\/$/, "");
    }
  }

  function slugifyId(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48);
  }

  return {
    uniqueStrings,
    normalizeStringArray,
    truncateText,
    normalizeText,
    createJobId,
    normalizeToPublicPath,
    resolveProjectPublicPath,
    resolvePublicPathToFile,
    safePathSegment,
    safeFilename,
    formatChinaDate,
    normalizeVideoUrl,
    normalizeSourceUrl,
    slugifyId
  };
}
