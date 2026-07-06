import { escapeHtml, fetchWithTimeout } from "./popup-utils.js";

const LOCAL_APPS_URL = "http://localhost:3000/api/apps";
const LAST_SELECTED_APP_KEY = "tt2textLastSelectedAppId";
const APP_LIST_CACHE_KEY = "tt2textCachedApps";

export async function refreshApps(ctx) {
  const response = await fetchWithTimeout(ctx, LOCAL_APPS_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const apps = await response.json();
  ctx.state.apps = Array.isArray(apps) ? apps : [];
  await chrome.storage.local.set({ [APP_LIST_CACHE_KEY]: ctx.state.apps }).catch(() => {});
  return ctx.state.apps;
}

export function renderAppPicker(ctx, options = {}) {
  const { el, state } = ctx;
  if (!el.appPickerEl || !el.appSelectEl) return;
  const {
    label = "关联 App",
    hint = "默认选中你上次手动选择的 App，你也可以改。",
    includeAutoOption = false
  } = options;
  el.appPickerEl.hidden = false;
  if (el.appPickerLabelEl) {
    el.appPickerLabelEl.textContent = label;
  }
  const apps = Array.isArray(state.apps) ? state.apps : [];
  const optionsHtml = [
    includeAutoOption ? '<option value="">自动识别</option>' : "",
    ...apps.map((app) => `<option value="${escapeHtml(app.id)}">${escapeHtml(app.name || app.fullName || app.id)}</option>`)
  ].join("");
  el.appSelectEl.innerHTML = optionsHtml;
  el.appSelectEl.disabled = apps.length === 0;
  if (el.appPickerHintEl) {
    el.appPickerHintEl.textContent = apps.length ? hint : "本地还没有 App。";
  }
}

export function hideAppPicker(ctx) {
  if (ctx.el.appPickerEl) {
    ctx.el.appPickerEl.hidden = true;
  }
}

export function selectAppById(ctx, appId, hint = "") {
  const normalizedId = String(appId || "").trim();
  if (ctx.el.appSelectEl) {
    ctx.el.appSelectEl.value = normalizedId;
  }
  if (hint && ctx.el.appPickerHintEl) {
    ctx.el.appPickerHintEl.textContent = hint;
  }
}

export function selectedApp(ctx) {
  const appId = String(ctx.el.appSelectEl?.value || "").trim();
  if (!appId) {
    return null;
  }
  return (ctx.state.apps || []).find((app) => app.id === appId) || null;
}

export async function restoreLastSelectedApp(ctx) {
  const payload = await chrome.storage.local.get(LAST_SELECTED_APP_KEY);
  const appId = String(payload?.[LAST_SELECTED_APP_KEY] || "").trim();
  if (!appId) {
    return "";
  }
  const exists = (ctx.state.apps || []).some((app) => app.id === appId);
  if (!exists) {
    return "";
  }
  selectAppById(ctx, appId, "默认选中你上次手动选择的 App，你也可以改。");
  return appId;
}

export async function persistLastSelectedApp(appId) {
  const normalizedId = String(appId || "").trim();
  if (!normalizedId) {
    return;
  }
  await chrome.storage.local.set({ [LAST_SELECTED_APP_KEY]: normalizedId });
}

export async function restoreCachedApps(ctx) {
  const payload = await chrome.storage.local.get(APP_LIST_CACHE_KEY).catch(() => null);
  const apps = Array.isArray(payload?.[APP_LIST_CACHE_KEY]) ? payload[APP_LIST_CACHE_KEY] : [];
  ctx.state.apps = apps;
  return apps;
}
