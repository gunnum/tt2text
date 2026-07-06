import {
  extractTikTokVideoId,
  getTikTokSearchQuery,
  isSensorTowerOverviewUrl,
  isTopAdsDetailUrl,
  shortenUrl
} from "./popup-utils.js";
import { hideAppPicker, refreshApps, renderAppPicker, restoreCachedApps, restoreLastSelectedApp } from "./popup-apps.js";
import { refreshCurrentTikTokShotStatus, renderAdShotPendingStatus } from "./popup-shot-status.js";

export async function initSensorTowerMode(ctx) {
  const { state, el } = ctx;
  state.currentMode = "sensortower";
  hideCommentCollectButton(ctx);
  hideAppPicker(ctx);
  el.previewLabelEl.textContent = "识别 App";
  el.collectButton.textContent = isSensorTowerOverviewUrl(state.activeTab?.url || "") ? "采集 Overview 画像" : "导出 CSV 并入库";
  el.collectButton.disabled = false;
  el.batchCollectButton.hidden = false;
  el.batchCollectButton.disabled = false;
  deferPopupHydration(() => hydrateSensorTowerMode(ctx));
}

export function initTikTokMode(ctx, url) {
  const { state, el } = ctx;
  state.currentMode = "tiktok";
  hideCommentCollectButton(ctx);
  hideAppPicker(ctx);
  state.currentTikTokQuery = getTikTokSearchQuery(url);
  el.previewLabelEl.textContent = "搜索词 / 匹配 App";
  el.detectedAppEl.textContent = state.currentTikTokQuery || "未识别搜索词";
  el.detectedDeveloperEl.textContent = "";
  el.collectButton.textContent = "采集当前搜索页";
  el.collectButton.disabled = !state.currentTikTokQuery;
  el.batchCollectButton.hidden = true;
  el.batchCollectButton.disabled = true;
  el.testScrollButton.hidden = false;
  el.testScrollButton.disabled = !state.currentTikTokQuery;
}

export async function initTikTokVideoMode(ctx, url) {
  const { state, el } = ctx;
  state.currentMode = "tiktok-video";
  hideAppPicker(ctx);
  el.previewLabelEl.textContent = "当前视频";
  el.detectedAppEl.textContent = shortenUrl(url);
  el.detectedDeveloperEl.textContent = "默认使用上次入库的 App，采集时由后端查重。";
  el.collectButton.textContent = "采集视频&评论";
  el.collectButton.disabled = false;
  renderAdShotPendingStatus(ctx, extractTikTokVideoId(url), "视频");
  if (el.commentCollectButton) {
    el.commentCollectButton.hidden = false;
    el.commentCollectButton.disabled = false;
    el.commentCollectButton.textContent = "采集已加载评论";
  }
  el.batchCollectButton.hidden = true;
  el.batchCollectButton.disabled = true;
  el.testScrollButton.hidden = true;
  el.testScrollButton.disabled = true;
  deferPopupHydration(() => hydrateTikTokVideoMode(ctx, url));
}

export async function initCreativeCenterMode(ctx, url) {
  const { state, el } = ctx;
  state.currentMode = "creative-center";
  hideCommentCollectButton(ctx);
  el.previewLabelEl.textContent = "当前 Creative Center 页面";
  const isDetail = isTopAdsDetailUrl(url);
  el.detectedAppEl.textContent = isDetail ? "Top Ads 详情页" : "Top Ads 搜索结果页";
  el.detectedDeveloperEl.textContent = shortenUrl(url);
  el.collectButton.textContent = isDetail ? "采集当前广告视频" : "采集可见素材";
  el.collectButton.disabled = false;
  el.batchCollectButton.hidden = true;
  el.batchCollectButton.disabled = true;
  el.testScrollButton.hidden = true;
  el.testScrollButton.disabled = true;
  if (isDetail) {
    renderAppPicker(ctx, {
      hint: "默认选中上次入库使用的 App，你也可以手动改。"
    });
  } else {
    hideAppPicker(ctx);
  }
  deferPopupHydration(() => hydrateCreativeCenterMode(ctx, url, isDetail));
}

export function initUnsupportedMode(ctx, message = "当前不是 Sensor Tower 页面，也不是 TikTok 搜索页。") {
  const { state, el } = ctx;
  state.currentMode = "unsupported";
  hideCommentCollectButton(ctx);
  hideAppPicker(ctx);
  el.previewLabelEl.textContent = "当前页面";
  el.detectedAppEl.textContent = "无法采集";
  el.detectedDeveloperEl.textContent = message;
  el.collectButton.textContent = "暂不可用";
  el.collectButton.disabled = true;
  el.batchCollectButton.hidden = true;
  el.batchCollectButton.disabled = true;
  el.testScrollButton.hidden = true;
  el.testScrollButton.disabled = true;
}

export function hideCommentCollectButton(ctx) {
  if (!ctx.el.commentCollectButton) return;
  ctx.el.commentCollectButton.hidden = true;
  ctx.el.commentCollectButton.disabled = true;
}

function deferPopupHydration(task) {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      void task();
    }, 0);
  });
}

async function hydrateTikTokVideoMode(ctx, url) {
  void ctx.debugLog("popup", "hydrate:tiktok-video:start");
  void refreshCurrentTikTokShotStatus(ctx, url);
  try {
    await restoreCachedApps(ctx);
    renderAppPicker(ctx, {
      hint: "默认选中上次入库使用的 App，你也可以手动改。"
    });
    await restoreLastSelectedApp(ctx);
    await refreshApps(ctx);
    renderAppPicker(ctx, {
      hint: "默认选中上次入库使用的 App，你也可以手动改。"
    });
    await restoreLastSelectedApp(ctx);
  } catch (error) {
    void ctx.debugLog("popup", "hydrate:tiktok-video:apps-error", { error: error?.message || String(error) });
  }
  void ctx.debugLog("popup", "hydrate:tiktok-video:done");
}

async function hydrateSensorTowerMode(ctx) {
  try {
    const {
      collectCurrentSensorTowerPage,
      refreshSensorTowerLatestStatus,
      renderDetectedApp
    } = await import("./popup-actions.js");
    ctx.state.lastPayload = await collectCurrentSensorTowerPage(ctx);
    renderDetectedApp(ctx, ctx.state.lastPayload);
    void refreshSensorTowerLatestStatus(ctx, ctx.state.lastPayload);
  } catch (error) {
    void ctx.debugLog("popup", "hydrate:sensortower:error", { error: error?.message || String(error) });
    ctx.el.detectedDeveloperEl.textContent = error?.message || String(error);
  }
}

async function hydrateCreativeCenterMode(ctx, url, isDetail) {
  void ctx.debugLog("popup", "hydrate:creative-center:start", { isDetail });
  try {
    if (isDetail) {
      await restoreCachedApps(ctx);
      renderAppPicker(ctx, {
        hint: "默认选中上次入库使用的 App，你也可以手动改。"
      });
      await restoreLastSelectedApp(ctx);
      await refreshApps(ctx);
      renderAppPicker(ctx, {
        hint: "默认选中上次入库使用的 App，你也可以手动改。"
      });
      await restoreLastSelectedApp(ctx);
    }
  } catch (error) {
    void ctx.debugLog("popup", "hydrate:creative-center:apps-error", { error: error?.message || String(error), isDetail });
  }
  void ctx.debugLog("popup", "hydrate:creative-center:done", { isDetail });
}
