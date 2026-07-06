import { LOCAL_AD_SHOTS_URL, escapeHtml, extractTikTokVideoId, extractTopAdsId, fetchWithTimeout } from "./popup-utils.js";

export function clearAdShotStatus(ctx) {
  const { adShotStatusEl, openLocalShotEl } = ctx.el;
  if (adShotStatusEl) {
    adShotStatusEl.hidden = true;
    adShotStatusEl.className = "ad-shot-status";
    adShotStatusEl.innerHTML = "";
  }
  if (openLocalShotEl) {
    openLocalShotEl.hidden = true;
    openLocalShotEl.removeAttribute("href");
  }
}

export function renderAdShotPendingStatus(ctx, sourceAdId, label = "广告") {
  const { adShotStatusEl, openLocalShotEl } = ctx.el;
  if (!adShotStatusEl) return;
  adShotStatusEl.hidden = false;
  adShotStatusEl.className = "ad-shot-status pending";
  adShotStatusEl.innerHTML = `<b>正在检查当前${escapeHtml(label)}是否已入库</b><span>${escapeHtml(label)} ID：${escapeHtml(sourceAdId)}</span>`;
  if (openLocalShotEl) {
    openLocalShotEl.hidden = true;
    openLocalShotEl.removeAttribute("href");
  }
}

export function renderAdShotNotImportedStatus(ctx, sourceAdId, label = "广告") {
  const { adShotStatusEl, openLocalShotEl, collectButton } = ctx.el;
  if (!adShotStatusEl) return;
  adShotStatusEl.hidden = false;
  adShotStatusEl.className = "ad-shot-status pending";
  adShotStatusEl.innerHTML = `<b>当前${escapeHtml(label)}尚未入库</b><span>${escapeHtml(label)} ID：${escapeHtml(sourceAdId)}</span>`;
  if (openLocalShotEl) {
    openLocalShotEl.hidden = true;
    openLocalShotEl.removeAttribute("href");
  }
  collectButton.textContent = label === "视频" ? "采集视频&评论" : "采集当前广告视频";
}

export function renderAdShotCheckFailedStatus(ctx, sourceAdId, error, label = "广告") {
  const { adShotStatusEl, openLocalShotEl } = ctx.el;
  if (!adShotStatusEl) return;
  adShotStatusEl.hidden = false;
  adShotStatusEl.className = "ad-shot-status pending";
  adShotStatusEl.innerHTML = `<b>无法确认是否已入库</b><span>${escapeHtml(label)} ID：${escapeHtml(sourceAdId)}</span><span>${escapeHtml(error?.message || "本地服务不可用")}</span>`;
  if (openLocalShotEl) {
    openLocalShotEl.hidden = true;
    openLocalShotEl.removeAttribute("href");
  }
}

export function renderAdShotImportedStatus(ctx, shot = {}) {
  const { adShotStatusEl, openLocalShotEl, detectedAppEl, detectedDeveloperEl, collectButton } = ctx.el;
  if (!adShotStatusEl) return;
  const shotId = shot.shotId || shot.id || "";
  const catalogApp = findCatalogApp(ctx, shot);
  const appName = catalogApp?.name || shot.app?.name || shot.appDisplay || shot.appName || shot.brandName || "未识别 App";
  const appCategory = resolveAppCategoryLabel(catalogApp || shot.app || shot);
  const sourceLabel = isTikTokDetailShot(shot) ? "视频" : "广告";
  const collectedAt = formatCollectedAt(resolveLastSuccessfulCollectionAt(shot));
  const commentsRaw = shot.commentsRaw && typeof shot.commentsRaw === "object" ? shot.commentsRaw : null;
  const commentCount = Number(commentsRaw?.itemCount || (Array.isArray(commentsRaw?.items) ? commentsRaw.items.length : 0)) || 0;
  const commentMediaCount = Array.isArray(commentsRaw?.items)
    ? commentsRaw.items.reduce((total, item) => total + (Array.isArray(item?.media) ? item.media.length : 0), 0)
    : Number(commentsRaw?.mediaCount || 0) || 0;
  const commentsAt = formatCollectedAt(commentsRaw?.capturedAt || commentsRaw?.updatedAt || commentsRaw?.importedAt || "");
  const commentLine = commentsRaw
    ? `<span class="ad-shot-time">评论采集：${escapeHtml(commentsAt || "时间未记录")} · ${escapeHtml(String(commentCount))} 条${commentMediaCount ? ` · 图片 ${escapeHtml(String(commentMediaCount))} 张` : ""}</span>`
    : `<span class="ad-shot-time">评论采集：暂无记录</span>`;
  adShotStatusEl.hidden = false;
  adShotStatusEl.className = "ad-shot-status";
  adShotStatusEl.innerHTML = `<b>当前${escapeHtml(sourceLabel)}已入库</b><span>${escapeHtml(appName)} · ${escapeHtml(appCategory)}</span><span class="ad-shot-time">上次成功采集：${escapeHtml(collectedAt || "时间未记录")}</span>${commentLine}<span>${escapeHtml(shotId || "未记录 Shot ID")}</span>`;
  detectedAppEl.textContent = appName;
  detectedDeveloperEl.textContent = shotId ? `已入库：${shotId}` : "已入库";
  collectButton.textContent = sourceLabel === "视频" ? "重新采集视频&评论" : "重新采集当前广告";
  if (openLocalShotEl && shotId) {
    openLocalShotEl.hidden = false;
    openLocalShotEl.href = new URL(shot.shotUrl || `/shots/${shotId}`, "http://localhost:3000").href;
  }
}

function findCatalogApp(ctx, shot = {}) {
  const appId = String(shot.appId || shot.app?.id || "").trim();
  if (!appId || !Array.isArray(ctx.state?.apps)) return null;
  return ctx.state.apps.find((app) => String(app?.id || "").trim() === appId) || null;
}

export function resolveAppCategoryLabel(app = {}) {
  const categories = [
    ...(Array.isArray(app.categories) ? app.categories : []),
    app.category
  ].map((item) => String(item || "").trim()).filter(Boolean);
  return Array.from(new Set(categories)).join(" / ") || "未分类";
}

export function formatCollectedAt(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
  }
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return text;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(parsed).replaceAll("/", "-");
}

function resolveLastSuccessfulCollectionAt(shot = {}) {
  const candidates = [
    shot.lastCollectedAt,
    shot.lastImportedAt,
    shot.importedAt,
    shot.savedAt,
    shot.createdAt,
    shot.capturedAt
  ].map((value) => String(value || "").trim()).filter(Boolean);
  if (!candidates.length) {
    return "";
  }
  const dated = candidates
    .map((value) => ({ value, time: Date.parse(String(value).replace(" ", "T")) }))
    .filter((item) => Number.isFinite(item.time))
    .sort((a, b) => b.time - a.time);
  return dated[0]?.value || candidates[0];
}

export async function refreshCurrentAdShotStatus(ctx, url) {
  const sourceAdId = extractTopAdsId(url);
  if (!sourceAdId) {
    clearAdShotStatus(ctx);
    return;
  }
  const startedAt = Date.now();
  renderAdShotPendingStatus(ctx, sourceAdId);
  try {
    const response = await fetchWithTimeout(
      ctx,
      `${LOCAL_AD_SHOTS_URL}?sourceUrl=${encodeURIComponent(url)}&sourceAdId=${encodeURIComponent(sourceAdId)}&sourceKind=topads&compact=1`,
      {},
      3000
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const shot = resolveMatchedShot(await response.json(), { sourceAdId, sourceKind: "topads" });
    if (shot) {
      void ctx.debugLog("popup", "adshot-status:found", { sourceAdId, ms: Date.now() - startedAt, shotId: shot.shotId || shot.id || "" });
      renderAdShotImportedStatus(ctx, shot);
      return;
    }
    void ctx.debugLog("popup", "adshot-status:not-found", { sourceAdId, ms: Date.now() - startedAt });
    renderAdShotNotImportedStatus(ctx, sourceAdId);
  } catch (error) {
    void ctx.debugLog("popup", "adshot-status:error", { sourceAdId, error: error?.message || String(error), ms: Date.now() - startedAt });
    renderAdShotCheckFailedStatus(ctx, sourceAdId, error);
  }
}

export async function refreshCurrentTikTokShotStatus(ctx, url) {
  const sourceAdId = extractTikTokVideoId(url);
  if (!sourceAdId) {
    clearAdShotStatus(ctx);
    return;
  }
  const startedAt = Date.now();
  renderAdShotPendingStatus(ctx, sourceAdId, "视频");
  try {
    const response = await fetchWithTimeout(
      ctx,
      `${LOCAL_AD_SHOTS_URL}?sourceUrl=${encodeURIComponent(url)}&sourceAdId=${encodeURIComponent(sourceAdId)}&sourceKind=tiktok&compact=1`,
      {},
      3000
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const shot = resolveMatchedShot(await response.json(), { sourceAdId, sourceKind: "tiktok" });
    if (shot) {
      void ctx.debugLog("popup", "tiktok-shot-status:found", { sourceAdId, ms: Date.now() - startedAt, shotId: shot.shotId || shot.id || "" });
      renderAdShotImportedStatus(ctx, shot);
      return;
    }
    void ctx.debugLog("popup", "tiktok-shot-status:not-found", { sourceAdId, ms: Date.now() - startedAt });
    renderAdShotNotImportedStatus(ctx, sourceAdId, "视频");
  } catch (error) {
    void ctx.debugLog("popup", "tiktok-shot-status:error", { sourceAdId, error: error?.message || String(error), ms: Date.now() - startedAt });
    renderAdShotCheckFailedStatus(ctx, sourceAdId, error, "视频");
  }
}

function resolveMatchedShot(payload, { sourceAdId, sourceKind }) {
  const match = (item) => isResolvedShotMatch(item, { sourceAdId, sourceKind });
  if (Array.isArray(payload)) {
    return payload.find(match) || null;
  }
  return match(payload) ? payload : null;
}

function isResolvedShotMatch(shot, { sourceAdId, sourceKind }) {
  if (!shot || typeof shot !== "object" || Array.isArray(shot)) {
    return false;
  }
  const shotSourceAdId = String(shot.sourceAdId || shot.source_ad_id || "").trim();
  if (!shotSourceAdId || shotSourceAdId !== String(sourceAdId || "").trim()) {
    return false;
  }
  if (sourceKind === "tiktok") {
    return isTikTokDetailShot(shot);
  }
  if (sourceKind === "topads") {
    return !isTikTokDetailShot(shot);
  }
  return true;
}

export function isTikTokDetailShot(shot = {}) {
  const raw = String(
    shot.sourcePlatform
    || shot.source_platform
    || shot.platform
    || shot.captureContext
    || shot.capture_context
    || shot.sourceLabel
    || shot.source_label
    || shot.source
    || ""
  ).trim().toLowerCase();
  const key = raw.replace(/[-\s]+/g, "_");
  const label = String(shot.sourceDisplay || shot.sourceLabel || shot.source_label || shot.source || "").trim().toLowerCase();
  return [
    "tiktok",
    "tiktok_detail",
    "tiktok_video",
    "tiktok_video_detail",
    "tiktok_photo",
    "tiktok_photo_detail"
  ].includes(key) || /tiktok.*详情/.test(label);
}
