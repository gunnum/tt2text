import { escapeAttribute, escapeHtml } from "./formatters.js";

export function renderDistributions(el, distributions = {}, appLogoIndex = new Map()) {
  if (!el) return;
  el.innerHTML = `
    <div class="section-head">
      <div>
        <p class="eyebrow">Distribution</p>
        <h2>样本分布</h2>
      </div>
      <p class="helper-text">按 App、账号类型和脚本类型快速查看当前收录结构。</p>
    </div>
    <div class="distribution-grid">
      ${renderDistributionGroup("App 分布", distributions.apps || [], "apps", appLogoIndex)}
      ${renderDistributionGroup("账号类型", distributions.accountTypes || [], "default", appLogoIndex)}
      ${renderDistributionGroup("脚本类型", distributions.scriptTypes || [], "scriptTypes", appLogoIndex)}
    </div>
  `;
}

export function buildAppLogoIndex(apps = []) {
  const index = new Map();
  for (const app of Array.isArray(apps) ? apps : []) {
    const logoUrl = app.logoUrl || app.artworkUrl || app.iconUrl || "";
    if (!logoUrl) continue;
    [app.name, app.fullName, app.appName]
      .map(normalizeAppName)
      .filter(Boolean)
      .forEach((name) => index.set(name, logoUrl));
  }
  return index;
}

function renderDistributionGroup(title, items, kind = "default", appLogoIndex = new Map()) {
  return `
    <section class="distribution-card">
      <h3>${escapeHtml(title)}</h3>
      <div class="distribution-items">
        ${items.length ? items.map((item) => kind === "apps" ? renderAppDistributionItem(item, appLogoIndex) : kind === "scriptTypes" ? renderScriptTypeDistributionItem(item) : renderDistributionItem(item)).join("") : '<div class="distribution-item"><span class="distribution-label">暂无</span><b class="distribution-count">0</b></div>'}
      </div>
    </section>
  `;
}

function renderAppDistributionItem(item = {}, appLogoIndex = new Map()) {
  const label = item.label || "未标注 App";
  const logo = resolveAppLogoUrl(label, item.logoUrl, appLogoIndex);
  const fallback = (label.match(/[A-Za-z0-9\u4e00-\u9fa5]/)?.[0] || "?").toUpperCase();
  return `
    <article class="distribution-item distribution-app">
      ${logo ? `<img class="distribution-app-logo" src="${escapeAttribute(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<span class="distribution-app-logo distribution-app-fallback">${escapeHtml(fallback)}</span>`}
      <span class="distribution-label">${escapeHtml(label)}</span>
      <b class="distribution-count">${escapeHtml(item.count || 0)}</b>
    </article>
  `;
}

function resolveAppLogoUrl(label, explicitUrl = "", appLogoIndex = new Map()) {
  const logoUrl = explicitUrl || appLogoIndex.get(normalizeAppName(label)) || "";
  return typeof logoUrl === "string" ? logoUrl.trim() : "";
}

function normalizeAppName(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderDistributionItem(item = {}) {
  return `
    <article class="distribution-item">
      <span class="distribution-label">${escapeHtml(item.label || "未标注")}</span>
      <b class="distribution-count">${escapeHtml(item.count || 0)}</b>
    </article>
  `;
}

function renderScriptTypeDistributionItem(item = {}) {
  return `
    <article class="distribution-item distribution-script">
      <div>
        <span class="distribution-label">${escapeHtml(item.label || "未标注")}</span>
        ${item.summary ? `<small>${escapeHtml(item.summary)}</small>` : ""}
      </div>
      <b class="distribution-count">${escapeHtml(item.count || 0)}</b>
    </article>
  `;
}
