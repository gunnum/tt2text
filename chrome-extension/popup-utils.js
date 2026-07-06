export const LOCAL_AD_SHOTS_URL = "http://localhost:3000/api/ad-shots";
export const LOCAL_AD_SHOT_PROJECTS_URL = "http://localhost:3000/api/ad-shot-projects";
export const POPUP_FETCH_TIMEOUT_MS = 5000;

export function isTikTokSearchUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "www.tiktok.com" && parsed.pathname === "/search";
  } catch {
    return false;
  }
}

export function isTikTokVideoUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "www.tiktok.com" && /\/@[^/]+\/(?:video|photo)\/\d+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function isSensorTowerOverviewUrl(url) {
  try {
    return new URL(url).pathname.startsWith("/overview/");
  } catch {
    return false;
  }
}

export function isCreativeCenterUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "ads.tiktok.com" && parsed.pathname.includes("/business/creativecenter/");
  } catch {
    return false;
  }
}

export function isTopAdsDetailUrl(url) {
  try {
    return /\/business\/creativecenter\/topads\/[^/]+/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function extractTopAdsId(url) {
  try {
    return new URL(url).pathname.match(/\/business\/creativecenter\/topads\/([^/]+)/i)?.[1] || "";
  } catch {
    return "";
  }
}

export function extractTikTokVideoId(url) {
  try {
    return new URL(url).pathname.match(/\/(?:video|photo)\/(\d+)/i)?.[1] || "";
  } catch {
    return String(url || "").match(/\/(?:video|photo)\/(\d+)/i)?.[1] || "";
  }
}

export function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

export function getTikTokSearchQuery(url) {
  try {
    return new URL(url).searchParams.get("q")?.trim() || "";
  } catch {
    return "";
  }
}

export function shortenUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean).slice(0, 3).join("/");
  } catch {
    return String(url || "").slice(0, 80);
  }
}

export async function fetchWithTimeout(ctx, url, options = {}, timeoutMs = POPUP_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    void ctx.debugLog("popup", "fetch:error", {
      url,
      method: options?.method || "GET",
      ms: Date.now() - startedAt,
      error: error?.name === "AbortError" ? "timeout" : (error?.message || String(error))
    });
    if (error?.name === "AbortError") {
      throw new Error("本地服务响应超时");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
