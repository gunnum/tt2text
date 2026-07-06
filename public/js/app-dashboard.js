import { fetchJson } from "./core/http.js";
import { escapeAttribute, escapeHtml, formatAppDisplayName, getSortTime } from "./core/format.js";
import { showToast } from "./core/ui.js";
import { createAdShotVideoCard, createResultVideoCard } from "./core/video-card.js";
import { isAppRecordForApp } from "./core/dashboard.js";
import { bindUnifiedVideoPlayer, renderUnifiedVideoPlayer } from "./core/video-player.js";

const headerEl = document.querySelector("#app-header");
const subtitleEl = document.querySelector("#app-page-subtitle");
const breadcrumbEl = document.querySelector("#app-breadcrumb");
const videosEl = document.querySelector("#recent-videos");
const articlesEl = document.querySelector("#recent-articles");
const metricsEl = document.querySelector("#recent-metrics");
const intelEl = document.querySelector("#app-intel");
const toastEl = document.querySelector("#toast");
const tagDialog = document.querySelector("#tag-dialog");
const tagForm = document.querySelector("#tag-form");
const tagOptionList = document.querySelector("#tag-option-list");
const tagStatus = document.querySelector("#tag-status");
const newTagNameInput = document.querySelector("#new-tag-name");
const closeTagDialogButton = document.querySelector("#close-tag-dialog");
const competitorDialog = document.querySelector("#competitor-dialog");
const competitorDialogBody = document.querySelector("#competitor-dialog-body");
const closeCompetitorDialogButton = document.querySelector("#close-competitor-dialog");
const screenshotDialog = document.querySelector("#screenshot-dialog");
const screenshotDialogImage = document.querySelector("#screenshot-dialog-image");
const screenshotDialogCaption = document.querySelector("#screenshot-dialog-caption");
const screenshotDialogCounter = document.querySelector("#screenshot-dialog-counter");
const closeScreenshotDialogButton = document.querySelector("#close-screenshot-dialog");
const prevScreenshotButton = document.querySelector("#prev-screenshot");
const nextScreenshotButton = document.querySelector("#next-screenshot");
const shotPlayerDialogEl = document.querySelector("#shot-player-dialog");
const shotPlayerStageEl = document.querySelector("#shot-player-stage");
const shotPlayerTitleEl = document.querySelector("#shot-player-title");
const shotPlayerTitleLinkEl = document.querySelector("#shot-player-title-link");
const shotPlayerMetaEl = document.querySelector("#shot-player-meta");
const params = new URLSearchParams(window.location.search);
const appId = params.get("id");
let pageState = {
  app: null,
  apps: [],
  results: [],
  adShots: [],
  dashboard: null,
  paywallAutoFetchStarted: false,
  paywallLoading: false,
  paywallError: "",
  screenshotPreviewIndex: 0
};
let shotPlayerSubtitleCleanup = null;

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach((item) => {
      item.setAttribute("aria-selected", String(item === button));
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === button.getAttribute("aria-controls"));
    });
  });
});

closeTagDialogButton?.addEventListener("click", () => tagDialog?.close());
tagDialog?.addEventListener("click", (event) => {
  const card = tagDialog.querySelector(".tag-dialog-card");
  if (card && !card.contains(event.target)) {
    tagDialog.close();
  }
});
competitorDialog?.addEventListener("click", (event) => {
  const card = competitorDialog.querySelector(".side-dialog-card");
  if (card && !card.contains(event.target)) {
    competitorDialog.close();
  }
});
tagForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveAppTags();
});
closeCompetitorDialogButton?.addEventListener("click", () => competitorDialog?.close());
closeScreenshotDialogButton?.addEventListener("click", () => screenshotDialog?.close());
prevScreenshotButton?.addEventListener("click", () => showAdjacentScreenshot(-1));
nextScreenshotButton?.addEventListener("click", () => showAdjacentScreenshot(1));
screenshotDialog?.addEventListener("click", (event) => {
  const card = screenshotDialog.querySelector(".screenshot-dialog-card");
  if (card && !card.contains(event.target)) {
    screenshotDialog.close();
  }
});
screenshotDialog?.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    showAdjacentScreenshot(-1);
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    showAdjacentScreenshot(1);
  }
});
shotPlayerDialogEl?.addEventListener("click", (event) => {
  const panel = shotPlayerDialogEl.querySelector(".shot-player-panel");
  if (panel && !panel.contains(event.target)) closeShotPlayer();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && shotPlayerDialogEl?.open) closeShotPlayer();
});

async function loadDashboard() {
  if (!appId) throw new Error("缺少 app id。");
  const [apps, adShots, articles, metrics, dashboard] = await Promise.all([
    fetchJson("/api/apps"),
    fetchJson("/api/ad-shots"),
    fetchJson("/api/articles"),
    fetchJson("/api/app-metrics"),
    fetchJson(`/api/apps/dashboard?appId=${encodeURIComponent(appId)}`)
  ]);
  const app = apps.find((item) => item.id === appId);
  if (!app) throw new Error("没有找到这个 App。");
  pageState = { ...pageState, app, apps, results: [], adShots, dashboard };

  const appVideos = adShots
    .filter((item) => isAppRecordForApp(item, app))
    .map((item) => ({ type: "ttcc", item, sortTime: item.createdAt || item.updatedAt || item.capturedAt }))
    .sort((a, b) => getSortTime(b.sortTime) - getSortTime(a.sortTime));
  const appArticles = articles
    .filter((item) => isAppRecord(item, appId))
    .sort((a, b) => getSortTime(b.createdAt) - getSortTime(a.createdAt));
  const appMetrics = metrics
    .filter((item) => isAppRecord(item, appId))
    .sort((a, b) => getSortTime(b.collectedAt) - getSortTime(a.collectedAt));

  renderHeader(app, dashboard);
  renderIntel(dashboard);
  renderTabCounts({
    videos: appVideos.length,
    articles: appArticles.length,
    metrics: appMetrics.length
  });
  renderVideos(appVideos);
  renderList(articlesEl, appArticles, renderArticleCard, "这个 App 还没有文章记录。");
  renderList(metricsEl, appMetrics, renderMetricCard, "这个 App 还没有数据记录。");
  await ensurePaywallData();
}

function renderHeader(app, dashboard) {
  const appName = formatAppDisplayName(app.name);
  const sensorTowerUrl = dashboard?.sensorTower?.primaryUrl || dashboard?.overview?.sourceUrl || "";
  document.title = `${appName} - T2T`;
  if (subtitleEl) {
    subtitleEl.textContent = appName;
  }
  renderBreadcrumb(appName);
  const tags = resolveAppCategories(app);
  const socialAccounts = resolveSocialAccounts(app);
  headerEl.innerHTML = `
    <div class="app-detail-brand">
      ${app.logoUrl ? `<img src="${escapeAttribute(app.logoUrl)}" alt="" />` : '<div class="app-detail-logo-fallback">App</div>'}
      <div class="app-detail-meta">
        <h1>${escapeHtml(formatAppDisplayName(app.name))}</h1>
        <p class="helper-text">${escapeHtml(app.sellerName || app.developer || "暂无开发者信息")}</p>
        <div class="app-detail-tags">
          ${tags.length ? tags.map((tag) => `<span class="app-detail-tag">${escapeHtml(tag)}</span>`).join("") : '<span class="app-detail-tag">未分类</span>'}
          <button id="edit-app-tags" class="tag-edit-button" type="button">编辑类别</button>
        </div>
      </div>
    </div>
    <div class="app-detail-actions">
      ${socialAccounts.map(renderSocialActionCard).join("")}
      ${sensorTowerUrl ? `<a class="app-action-card" href="${escapeAttribute(sensorTowerUrl)}" target="_blank" rel="noreferrer">${renderSensorTowerIcon()}<span>Sensor Tower</span></a>` : ""}
      ${app.appStoreUrl ? `<a class="app-action-card" href="${escapeAttribute(app.appStoreUrl)}" target="_blank" rel="noreferrer">${renderAppStoreIcon()}<span>App Store</span></a>` : ""}
      <a class="app-action-card" href="/reports.html?appId=${encodeURIComponent(app.id)}" target="_blank" rel="noreferrer">${renderReportIcon()}<span>分析报告</span></a>
    </div>
  `;
  document.querySelector("#edit-app-tags")?.addEventListener("click", openTagDialog);
}

function renderSocialActionCard(account) {
  const platformLabel = getSocialPlatformLabel(account.platform);
  const name = account.name || formatSocialAccountName(account.url, account.platform) || platformLabel;
  return `
    <a class="app-action-card app-social-action-card" href="${escapeAttribute(account.url)}" target="_blank" rel="noreferrer" title="${escapeAttribute(platformLabel + ": " + name)}">
      ${renderSocialIcon(account.platform)}
      <span>${escapeHtml(name)}</span>
    </a>
  `;
}

function resolveSocialAccounts(app) {
  const rawAccounts = [];
  collectSocialAccounts(rawAccounts, app?.socialAccounts);
  collectSocialAccounts(rawAccounts, app?.socials);
  collectSocialAccounts(rawAccounts, app?.socialLinks);
  collectDirectSocialField(rawAccounts, "x", app?.xUrl || app?.xAccount || app?.twitterUrl || app?.twitter);
  collectDirectSocialField(rawAccounts, "tiktok", app?.tiktokUrl || app?.tiktok);
  collectDirectSocialField(rawAccounts, "youtube", app?.youtubeUrl || app?.youtube);
  collectDirectSocialField(rawAccounts, "instagram", app?.instagramUrl || app?.instagram || app?.insUrl || app?.ins);
  collectDirectSocialField(rawAccounts, "website", app?.websiteUrl || app?.officialWebsite || app?.homepageUrl || app?.website);

  const seen = new Set();
  return rawAccounts
    .map(normalizeSocialAccount)
    .filter(Boolean)
    .filter((account) => {
      const key = account.url || `${account.platform}:${account.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function collectSocialAccounts(target, value) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((item) => target.push(item));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([platform, account]) => {
      if (typeof account === "object" && account) {
        target.push({ platform, ...account });
      } else {
        target.push({ platform, url: account });
      }
    });
  }
}

function collectDirectSocialField(target, platform, value) {
  if (!value) return;
  if (typeof value === "object" && !Array.isArray(value)) {
    target.push({ platform, ...value });
  } else {
    target.push({ platform, url: value });
  }
}

function normalizeSocialAccount(value) {
  if (!value) return null;
  const source = typeof value === "string" ? { url: value } : value;
  const rawUrl = String(source.url || source.href || source.link || "").trim();
  const handle = String(source.handle || source.username || source.account || "").trim();
  const platform = normalizeSocialPlatform(source.platform || source.type || inferSocialPlatform(rawUrl));
  const url = normalizeSocialUrl(rawUrl || handle, platform);
  if (!url) return null;
  const name = String(source.name || source.label || handle || formatSocialAccountName(url, platform) || getSocialPlatformLabel(platform)).trim();
  return { platform, url, name };
}

function normalizeSocialPlatform(value) {
  const platform = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (["twitter", "x"].includes(platform)) return "x";
  if (["tiktok", "douyin"].includes(platform)) return "tiktok";
  if (["youtube", "yt"].includes(platform)) return "youtube";
  if (["instagram", "insta", "ins", "ig"].includes(platform)) return "instagram";
  if (["website", "web", "homepage", "site", "officialwebsite"].includes(platform)) return "website";
  return platform || "link";
}

function inferSocialPlatform(url) {
  const host = safeUrlHost(url);
  if (/twitter\.com|x\.com/.test(host)) return "x";
  if (/tiktok\.com/.test(host)) return "tiktok";
  if (/youtube\.com|youtu\.be/.test(host)) return "youtube";
  if (/instagram\.com/.test(host)) return "instagram";
  if (host) return "website";
  return "link";
}

function normalizeSocialUrl(value, platform) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const handle = raw.replace(/^@/, "");
  if (!handle) return "";
  if (platform === "x") return `https://x.com/${encodeURIComponent(handle)}`;
  if (platform === "tiktok") return `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
  if (platform === "youtube") return raw.startsWith("@") ? `https://www.youtube.com/${raw}` : `https://www.youtube.com/@${encodeURIComponent(handle)}`;
  if (platform === "instagram") return `https://www.instagram.com/${encodeURIComponent(handle)}`;
  if (platform === "website") return raw.includes(".") ? `https://${raw}` : raw;
  return raw;
}

function formatSocialAccountName(url, platform) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (!path) return "";
    if (platform === "youtube" && path.startsWith("@")) return path;
    if (platform === "tiktok" && path.startsWith("@")) return path;
    return `@${decodeURIComponent(path).replace(/^@/, "")}`;
  } catch {
    return "";
  }
}

function safeUrlHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function getSocialPlatformLabel(platform) {
  const labels = {
    x: "X",
    tiktok: "TikTok",
    youtube: "YouTube",
    instagram: "Instagram",
    website: "Website",
    link: "Social"
  };
  return labels[platform] || platform;
}

function renderSocialIcon(platform) {
  if (platform === "x") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.3 4h2.6l-5.7 6.5L21 20h-5.4l-4.2-5.5L6.5 20H3.9l6.1-7L3.5 4h5.5l3.8 5 4.5-5Zm-.9 14.3h1.4L8.2 5.6H6.7l9.7 12.7Z"/></svg>';
  }
  if (platform === "tiktok") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.6 3c.3 2.3 1.6 3.8 4 4.1v3c-1.4 0-2.7-.4-4-1.2v5.8c0 3.4-2.2 5.8-5.5 5.8-2.8 0-5-1.9-5-4.7 0-3 2.4-5.1 5.5-4.8v3.1c-1.4-.3-2.4.4-2.4 1.6 0 1.1.8 1.8 1.9 1.8 1.4 0 2.2-.9 2.2-2.6V3h3.3Z"/></svg>';
  }
  if (platform === "youtube") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.4 7.2a3 3 0 0 0-2.1-2.1C17.4 4.6 12 4.6 12 4.6s-5.4 0-7.3.5a3 3 0 0 0-2.1 2.1A31 31 0 0 0 2.1 12c0 1.7.2 3.4.5 4.8a3 3 0 0 0 2.1 2.1c1.9.5 7.3.5 7.3.5s5.4 0 7.3-.5a3 3 0 0 0 2.1-2.1c.3-1.4.5-3.1.5-4.8s-.2-3.4-.5-4.8ZM10 15.4V8.6l5.8 3.4L10 15.4Z"/></svg>';
  }
  if (platform === "instagram") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Zm0 2.2A2.8 2.8 0 0 0 5.2 8v8A2.8 2.8 0 0 0 8 18.8h8a2.8 2.8 0 0 0 2.8-2.8V8A2.8 2.8 0 0 0 16 5.2H8Zm4 3.3a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm0 2.1a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Zm4-2.6a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/></svg>';
  }
  if (platform === "website") {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/></svg>';
}

function renderIntel(dashboard) {
  if (!intelEl) return;
  const stats = dashboard?.dataPanel?.stats || [];
  const screenshots = dashboard?.media?.screenshots || [];
  const previewVideos = dashboard?.media?.previewVideos || [];
  const paywall = dashboard?.paywall || null;
  const competitors = dashboard?.competitors || { preview: [], items: [] };
  const revenueCountries = dashboard?.dataPanel?.countries?.revenueHot || [];
  const activeCountries = dashboard?.dataPanel?.countries?.activeHot || [];
  const paywallStatus = pageState.paywallLoading
    ? "正在查找 paywall 截图..."
    : pageState.paywallError
      ? `Paywall 查找失败：${pageState.paywallError}`
      : describePaywallStatus(paywall);
  const paywallEmptyText = pageState.paywallLoading
    ? "正在查找 paywall 截图。"
    : pageState.paywallError
      ? "查找失败，稍后可以重新点击刷新。"
      : describePaywallEmptyText(paywall);
  intelEl.innerHTML = `
    <section class="intel-top">
      <section class="app-intel-panel">
        <div>
          <p class="section-kicker">Data</p>
          <h2>数据面板</h2>
        </div>
        <div class="metric-grid">
          ${stats.length ? stats.slice(0, 8).map((item) => renderMetricTile(item, competitors)).join("") : '<div class="video-job-empty">还没有可汇总的数据。</div>'}
        </div>
        <div class="country-grid">
          <div class="country-group">
            <p class="helper-text">收入热门国家</p>
            ${renderChipList(revenueCountries, "暂无")}
          </div>
          <div class="country-group">
            <p class="helper-text">活跃热门国家</p>
            ${renderChipList(activeCountries, "暂无")}
          </div>
        </div>
      </section>
    </section>
    <section class="intel-middle">
      <section class="app-intel-panel">
        <div class="media-grid">
          <section class="media-section features">
            <div class="section-head">
              <div>
                <p class="section-kicker">Media</p>
                <h3>Feature 图</h3>
              </div>
            </div>
            <div class="screenshot-strip">
              ${screenshots.length ? screenshots.map((item, index) => renderScreenshotCard(item, index)).join("") : '<div class="video-job-empty">下次刷新 App Store media 或采集 ST Overview 后会显示截图。</div>'}
            </div>
            ${previewVideos.length ? `<div class="preview-video-strip">${previewVideos.map(renderPreviewVideoCard).join("")}</div>` : ""}
          </section>
          <section class="media-section">
            <div class="section-head">
              <div>
                <p class="section-kicker">Paywall</p>
                <h3>Paywall</h3>
              </div>
              <button id="refresh-paywalls" class="section-icon-button" type="button" aria-label="检查 Paywall 更新"${pageState.paywallLoading ? " disabled" : ""}>
                ${renderRefreshIcon()}
              </button>
            </div>
            <p class="paywall-status">${escapeHtml(paywallStatus)}</p>
            <div class="paywall-strip">
              ${paywall?.matches?.length ? paywall.matches.map(renderPaywallCard).join("") : `<div class="video-job-empty">${escapeHtml(paywallEmptyText)}</div>`}
            </div>
          </section>
        </div>
      </section>
    </section>
  `;
  document.querySelector("#refresh-paywalls")?.addEventListener("click", () => findPaywalls({ refresh: true, announce: true, mode: "check" }));
  document.querySelector("#open-competitor-dialog")?.addEventListener("click", openCompetitorDialog);
  document.querySelectorAll("[data-screenshot-index]").forEach((button) => {
    button.addEventListener("click", () => openScreenshotPreview(Number(button.dataset.screenshotIndex || 0)));
  });
}

function renderMetricTile(item, competitors) {
  if (item.label === "收入排名") {
    return renderRankTile(item, competitors);
  }
  return `
    <div class="metric-tile">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.scope || item.updatedAt || "")}</small>
    </div>
  `;
}

function renderChipList(items, emptyText) {
  const values = Array.from(new Set((items || []).filter(Boolean)));
  return `<div class="mini-chip-list">${values.length ? values.map((item) => `<span class="mini-chip">${escapeHtml(item)}</span>`).join("") : `<span class="helper-text">${escapeHtml(emptyText)}</span>`}</div>`;
}

function renderScreenshotCard(item, index) {
  const imageUrl = item.imageUrl || item.thumbnailUrl;
  return `
    <button class="screenshot-card" type="button" data-screenshot-index="${index}" aria-label="放大查看 Feature 图 ${index + 1}">
      <img src="${escapeAttribute(item.thumbnailUrl || imageUrl)}" alt="${escapeAttribute(item.alt || "App screenshot")}" loading="lazy" />
    </button>
  `;
}

function renderPaywallCard(item) {
  return `
    <a class="paywall-card" href="${escapeAttribute(item.pageUrl || item.imageUrl)}" target="_blank" rel="noreferrer">
      <img src="${escapeAttribute(item.imageUrl)}" alt="${escapeAttribute(item.appName || "Paywall")}" loading="lazy" />
      <span>${escapeHtml(item.collectedAt ? formatShortDate(item.collectedAt) : (item.appName || "Paywall"))}</span>
    </a>
  `;
}

function renderPreviewVideoCard(item) {
  return `
    <a class="preview-video-card" href="${escapeAttribute(item.videoUrl)}" target="_blank" rel="noreferrer">
      <video src="${escapeAttribute(item.videoUrl)}"${item.posterUrl ? ` poster="${escapeAttribute(item.posterUrl)}"` : ""} preload="metadata" muted playsinline></video>
    </a>
  `;
}

function renderRankTile(item, competitors) {
  const items = competitors?.preview || [];
  const logos = items.slice(0, 6).map(renderCompetitorLogo).join("");
  return `
    <div class="metric-tile rank-tile">
      <div class="tile-head">
        <div>
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
          <small>${escapeHtml(item.scope || item.updatedAt || "")}</small>
        </div>
        <button id="open-competitor-dialog" class="tile-icon-button" type="button" aria-label="查看收入排行榜详情">
          ${renderDetailIcon()}
        </button>
      </div>
      <div class="rank-logo-row">${logos || '<span class="helper-text">等待同类榜单数据</span>'}</div>
    </div>
  `;
}

function renderCompetitorLogo(item) {
  const logoUrl = item.logoUrl || "";
  if (!logoUrl) {
    const fallback = buildLogoFallback(item.appName || "");
    return `<div class="rank-logo rank-logo-fallback" style="--logo-bg:${escapeAttribute(fallback.background)}" title="${escapeAttribute(item.appName || "")}">${escapeHtml(fallback.label)}</div>`;
  }
  return `<img class="rank-logo" src="${escapeAttribute(logoUrl)}" alt="${escapeAttribute(item.appName || "App")}" title="${escapeAttribute(item.appName || "")}" loading="lazy" />`;
}

function buildLogoFallback(name) {
  const text = String(name || "").trim();
  const label = (text.match(/[A-Za-z0-9\u4e00-\u9fa5]/)?.[0] || "?").toUpperCase();
  const hues = [142, 196, 28, 12, 252, 332];
  const hash = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const hue = hues[hash % hues.length];
  return {
    label,
    background: `hsl(${hue} 70% 92%)`
  };
}

function renderCompetitorRow(item) {
  return `
    <div class="competitor-row">
      <span>#${escapeHtml(item.rank || "")}</span>
      <div>
        <strong>${escapeHtml(item.appName || "Unknown App")}</strong>
        <div class="helper-text">${escapeHtml(item.publisherName || "")}</div>
      </div>
      <span>${escapeHtml(formatCompactMoney(item.revenueUsd90d) || "--")}</span>
    </div>
    <div class="competitor-summary-meta">
      ${item.downloads90d ? `<span class="mini-chip">下载 ${escapeHtml(formatCompactCount(item.downloads90d))}</span>` : ""}
      ${item.dau ? `<span class="mini-chip">DAU ${escapeHtml(formatCompactCount(item.dau))}</span>` : ""}
    </div>
  `;
}

function formatCompactMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  if (number >= 1_000_000) return `$${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `$${Math.round(number / 1_000)}K`;
  return `$${Math.round(number)}`;
}

function formatCompactCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${Math.round(number / 1_000)}K`;
  return `${Math.round(number)}`;
}

async function findPaywalls({ refresh = true, announce = true, mode = "refetch" } = {}) {
  pageState.paywallLoading = true;
  pageState.paywallError = "";
  renderIntel(pageState.dashboard);
  try {
    const record = await fetchJson("/api/apps/paywalls/find", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, refresh })
    });
    pageState.dashboard = {
      ...pageState.dashboard,
      paywall: record
    };
    if (announce) {
      showToast(toastEl, describePaywallToast(record, mode));
    }
  } catch (error) {
    pageState.paywallError = error.message || String(error);
    if (announce) {
      showToast(toastEl, `Paywall 查找失败：${error.message}`);
    }
  } finally {
    pageState.paywallLoading = false;
    renderIntel(pageState.dashboard);
  }
}

async function ensurePaywallData() {
  const paywall = pageState.dashboard?.paywall || null;
  if (pageState.paywallAutoFetchStarted || paywall?.matches?.length) {
    return;
  }
  pageState.paywallAutoFetchStarted = true;
  await findPaywalls({ refresh: false, announce: false, mode: "refetch" });
}

function openCompetitorDialog() {
  const competitors = pageState.dashboard?.competitors || { items: [] };
  const items = competitors.items || [];
  const header = competitors.categoryName
    ? `<div><p class="helper-text">细分类别</p><strong>${escapeHtml(competitors.categoryName)}</strong></div>`
    : "";
  competitorDialogBody.innerHTML = items.length
    ? `${header}${items.map(renderCompetitorRow).join("")}`
    : '<div class="video-job-empty">还没有可展示的竞品。</div>';
  competitorDialog?.showModal();
}

function openScreenshotPreview(index) {
  const screenshots = getPreviewScreenshots();
  if (!screenshots.length || !screenshotDialog) return;
  pageState.screenshotPreviewIndex = clampIndex(index, screenshots.length);
  renderScreenshotPreview();
  screenshotDialog.showModal();
}

function showAdjacentScreenshot(delta) {
  if (!screenshotDialog?.open) return;
  const screenshots = getPreviewScreenshots();
  if (!screenshots.length) return;
  pageState.screenshotPreviewIndex = clampIndex(pageState.screenshotPreviewIndex + delta, screenshots.length);
  renderScreenshotPreview();
}

function renderScreenshotPreview() {
  const screenshots = getPreviewScreenshots();
  if (!screenshots.length || !screenshotDialogImage) return;
  const index = clampIndex(pageState.screenshotPreviewIndex, screenshots.length);
  pageState.screenshotPreviewIndex = index;
  const item = screenshots[index];
  const imageUrl = item.imageUrl || item.thumbnailUrl || "";
  screenshotDialogImage.src = imageUrl;
  screenshotDialogImage.alt = item.alt || `Feature 图 ${index + 1}`;
  if (screenshotDialogCaption) {
    screenshotDialogCaption.textContent = item.alt || item.title || imageUrl || "Feature 图";
  }
  if (screenshotDialogCounter) {
    screenshotDialogCounter.textContent = `${index + 1} / ${screenshots.length}`;
  }
  if (prevScreenshotButton) {
    prevScreenshotButton.disabled = screenshots.length <= 1;
  }
  if (nextScreenshotButton) {
    nextScreenshotButton.disabled = screenshots.length <= 1;
  }
}

function getPreviewScreenshots() {
  return (pageState.dashboard?.media?.screenshots || []).filter((item) => item?.imageUrl || item?.thumbnailUrl);
}

function clampIndex(index, length) {
  if (!length) return 0;
  const normalized = Number.isFinite(index) ? index : 0;
  return ((normalized % length) + length) % length;
}

function describePaywallStatus(paywall) {
  if (!paywall) {
    return "进入页面后会自动查找 paywall 截图。";
  }
  const lookupStatus = resolvePaywallLookupStatus(paywall);
  if (lookupStatus === "failed") {
    return `爬取失败，上次爬取时间：${formatPaywallCheckedAt(paywall)}`;
  }
  if (lookupStatus === "unlisted") {
    return "Paywall 网站未收录该 App。";
  }
  if (paywall.matched && !paywall.refreshStatus) {
    return `已找到 ${paywall.matches?.length || 0} 张 paywall 截图，最近同步时间 ${paywall.fetchedAt || ""}`.trim();
  }
  if (paywall.refreshStatus === "updated") {
    return `已更新到最新 paywall，最近检查时间 ${paywall.checkedAt || paywall.fetchedAt || ""}`.trim();
  }
  if (paywall.refreshStatus === "current") {
    return `当前已是最新 paywall，最近检查时间 ${paywall.checkedAt || paywall.fetchedAt || ""}`.trim();
  }
  if (paywall.matched) {
    return `已找到 ${paywall.matches?.length || 0} 张 paywall 截图，最近同步时间 ${paywall.fetchedAt || ""}`.trim();
  }
  return "Paywall 网站未收录该 App。";
}

function describePaywallToast(record, mode) {
  const lookupStatus = resolvePaywallLookupStatus(record);
  if (lookupStatus === "failed") {
    return `爬取失败，上次爬取时间：${formatPaywallCheckedAt(record)}`;
  }
  if (lookupStatus === "unlisted") {
    return "Paywall 网站未收录该 App。";
  }
  if (!record?.matched) {
    return "Paywall 网站未收录该 App。";
  }
  if (!record.refreshStatus) {
    return `找到 ${record.matches.length} 张 paywall 截图。`;
  }
  if (mode === "check") {
    if (record.refreshStatus === "updated") {
      return `发现更新，已同步 ${record.matches.length} 张 paywall 截图。`;
    }
    if (record.refreshStatus === "current") {
      return "当前已是最新 paywall。";
    }
  }
  return `找到 ${record.matches.length} 张 paywall 截图。`;
}

function describePaywallEmptyText(paywall) {
  const lookupStatus = resolvePaywallLookupStatus(paywall);
  if (lookupStatus === "failed") {
    return `爬取失败，上次爬取时间：${formatPaywallCheckedAt(paywall)}`;
  }
  if (lookupStatus === "unlisted") {
    return "Paywall 网站未收录该 App。";
  }
  return "Paywall 网站未收录该 App。";
}

function resolvePaywallLookupStatus(paywall) {
  if (!paywall) {
    return "";
  }
  if (paywall.lookupStatus) {
    return paywall.lookupStatus;
  }
  if (paywall.crawlStatus) {
    return paywall.crawlStatus;
  }
  if (paywall.refreshStatus === "failed") {
    return "failed";
  }
  if (paywall.matched || paywall.matches?.length) {
    return "matched";
  }
  if (Array.isArray(paywall.errors) && paywall.errors.length) {
    return "failed";
  }
  if (paywall.refreshStatus === "missing") {
    return "unlisted";
  }
  return "";
}

function formatPaywallCheckedAt(paywall) {
  return paywall?.checkedAt || paywall?.fetchedAt || "未知";
}

function renderRefreshIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  `;
}

function renderDetailIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  `;
}

function renderSensorTowerIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 20h16" />
      <path d="M6 20V9l6-4 6 4v11" />
      <path d="M9 20v-7h6v7" />
      <path d="M10 9h4" />
    </svg>
  `;
}

function renderAppStoreIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="m8 16 4-8 4 8" />
      <path d="M9.5 13h5" />
    </svg>
  `;
}

function renderReportIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </svg>
  `;
}

function formatShortDate(value) {
  const match = String(value || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value || "");
  return `${match[2]}/${match[3]}/${match[1]}`;
}

function renderBreadcrumb(appName) {
  if (!breadcrumbEl) return;
  breadcrumbEl.innerHTML = `
    <a href="/">首页</a>
    <span aria-hidden="true">/</span>
    <span>${escapeHtml(appName)}</span>
  `;
}

function renderVideos(items) {
  videosEl.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "video-job-empty";
    empty.textContent = "这个 App 还没有视频记录。";
    videosEl.appendChild(empty);
    return;
  }
  items.forEach((entry) => {
    videosEl.appendChild(entry.type === "ttcc"
      ? createAdShotVideoCard(entry.item, { from: "app", appId })
      : createResultVideoCard(entry.item, { from: "app", appId }));
  });
  bindAppVideoPlayerTriggers();
}

function bindAppVideoPlayerTriggers() {
  videosEl?.querySelectorAll(".video-job-trigger").forEach((button) => {
    button.addEventListener("click", () => {
      const shotId = button.dataset.shotId || "";
      const shot = pageState.adShots.find((item) => String(item.shotId || item.id || "") === shotId) || null;
      openShotPlayer({
        shotId,
        title: button.dataset.title || "视频预览",
        videoPath: button.dataset.videoPath || "",
        posterPath: button.dataset.posterPath || "",
        detailUrl: button.dataset.shotUrl || "",
        shot
      });
    });
  });
}

function openShotPlayer({ shotId = "", title = "", videoPath = "", posterPath = "", detailUrl = "", shot = null } = {}) {
  if (!shotPlayerDialogEl || !shotPlayerStageEl) return;
  if (typeof shotPlayerSubtitleCleanup === "function") {
    shotPlayerSubtitleCleanup();
    shotPlayerSubtitleCleanup = null;
  }
  if (shotPlayerTitleEl) {
    shotPlayerTitleEl.textContent = title || "视频预览";
  }
  if (shotPlayerTitleLinkEl) {
    if (detailUrl) {
      shotPlayerTitleLinkEl.href = detailUrl;
      shotPlayerTitleLinkEl.classList.remove("is-disabled");
      shotPlayerTitleLinkEl.setAttribute("aria-label", "打开详情：" + (title || "视频预览"));
    } else {
      shotPlayerTitleLinkEl.href = "#";
      shotPlayerTitleLinkEl.classList.add("is-disabled");
      shotPlayerTitleLinkEl.removeAttribute("aria-label");
    }
  }
  if (shotPlayerMetaEl) {
    shotPlayerMetaEl.textContent = shotId || detailUrl || "";
  }
  shotPlayerStageEl.innerHTML = renderUnifiedVideoPlayer({
    videoPath,
    posterPath,
    coverPath: posterPath,
    title,
    item: shot || {},
    emptyLabel: "当前素材没有可播放视频。"
  });
  if (videoPath) {
    shotPlayerSubtitleCleanup = bindUnifiedVideoPlayer(shotPlayerStageEl, {
      item: shot || {},
      duration: Number(shot?.duration || shot?.media?.duration || 0)
    });
  }
  if (typeof shotPlayerDialogEl.showModal === "function") {
    shotPlayerDialogEl.showModal();
  } else {
    shotPlayerDialogEl.setAttribute("open", "");
  }
}

function closeShotPlayer() {
  if (typeof shotPlayerSubtitleCleanup === "function") {
    shotPlayerSubtitleCleanup();
    shotPlayerSubtitleCleanup = null;
  }
  const media = shotPlayerStageEl?.querySelector("video");
  if (media) {
    media.pause();
    media.removeAttribute("src");
    media.load();
  }
  if (shotPlayerStageEl) {
    shotPlayerStageEl.innerHTML = "";
  }
  shotPlayerDialogEl?.close?.();
  shotPlayerDialogEl?.removeAttribute("open");
}

function renderTabCounts(counts) {
  setTabLabel("videos-tab", "视频", counts.videos);
  setTabLabel("articles-tab", "文章", counts.articles);
  setTabLabel("metrics-tab", "数据", counts.metrics);
}

function setTabLabel(id, label, count) {
  const button = document.querySelector(`#${id}`);
  if (!button) return;
  const numericCount = Number(count) || 0;
  button.textContent = numericCount > 0 ? `${label} ${numericCount}` : label;
}

function renderArticleCard(item) {
  return `
    <article class="record-card">
      <h3>${escapeHtml(item.title || "未命名文章")}</h3>
      <p>${escapeHtml(item.excerpt || "暂无摘要。")}</p>
      <div class="record-actions">
        <span class="video-job-badge">${escapeHtml(item.createdAt || "")}</span>
        <a class="video-job-action" href="/article-view.html?id=${encodeURIComponent(item.id)}">阅读页</a>
      </div>
    </article>
  `;
}

function renderMetricCard(item) {
  return `
    <article class="record-card">
      <h3>${escapeHtml(item.collectedAt || "SensorTower 记录")}</h3>
      <p>${escapeHtml(item.pageTitle || "暂无标题")}</p>
      <div class="record-actions">
        ${item.htmlPath ? `<a class="video-job-action" href="${escapeAttribute(item.htmlPath)}" target="_blank" rel="noreferrer">归档</a>` : ""}
      </div>
    </article>
  `;
}

function renderList(target, items, renderItem, emptyText) {
  target.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "video-job-empty";
    empty.textContent = emptyText;
    target.appendChild(empty);
    return;
  }
  target.innerHTML = items.map(renderItem).join("");
}

function isAppRecord(item, id) {
  return item?.appId === id || item?.app?.id === id;
}

function openTagDialog() {
  renderTagOptions();
  tagStatus.textContent = "";
  newTagNameInput.value = "";
  tagDialog.showModal();
}

function renderTagOptions() {
  const activeCategories = new Set(resolveAppCategories(pageState.app));
  const categories = Array.from(new Set(pageState.apps.flatMap(resolveAppCategories)))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  tagOptionList.innerHTML = categories.length ? categories.map((category) => `
    <label class="tag-option">
      <input type="checkbox" name="category" value="${escapeAttribute(category)}" ${activeCategories.has(category) ? "checked" : ""} />
      <span>${escapeHtml(category)}</span>
    </label>
  `).join("") : '<p class="helper-text">还没有已有类别，可以直接新建。</p>';
}

async function saveAppTags() {
  const submitButton = tagForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  tagStatus.textContent = "正在保存类别...";
  try {
    const categories = new Set(Array.from(tagOptionList.querySelectorAll("input[name='category']:checked")).map((input) => input.value));
    const newName = newTagNameInput.value.trim();
    if (newName) {
      categories.add(newName);
    }

    const updatedApp = await fetchJson("/api/apps/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: appId, categories: Array.from(categories) })
    });
    pageState.app = updatedApp;
    pageState.apps = pageState.apps.map((app) => app.id === updatedApp.id ? updatedApp : app);
    renderHeader(pageState.app);
    tagStatus.textContent = "类别已保存。";
    tagDialog.close();
  } catch (error) {
    tagStatus.textContent = error instanceof Error ? error.message : "保存失败。";
  } finally {
    submitButton.disabled = false;
  }
}

function resolveAppCategories(app) {
  const rawCategories = [
    ...(Array.isArray(app?.categories) ? app.categories : []),
    app?.category
  ];
  return Array.from(new Set(rawCategories.map((item) => String(item || "").trim()).filter(Boolean)));
}

loadDashboard().catch((error) => {
  if (videosEl) {
    videosEl.innerHTML = `<div class="video-job-empty">加载失败：${escapeHtml(error.message)}</div>`;
  }
  showToast(toastEl, `加载失败：${error.message}`);
});
