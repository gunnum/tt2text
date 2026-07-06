import { escapeAttribute, escapeHtml, formatAppDisplayName, sortByTime } from "./format.js";

export function isAppRecord(item, appId) {
  return item?.appId === appId || item?.app?.id === appId;
}

export function isAppRecordForApp(item, app) {
  if (!app) return false;
  if (isAppRecord(item, app.id)) return true;
  const itemNames = [item?.app?.name, item?.app?.fullName, item?.appName, item?.appDisplay, item?.brandName, item?.targetApp, item?.rawBrandName]
    .map(normalizeLookupName)
    .filter(Boolean);
  const appNames = [app.name, app.fullName, app.appName]
    .map(normalizeLookupName)
    .filter(Boolean);
  return itemNames.some((itemName) => appNames.some((appName) => itemName === appName || itemName.includes(appName) || appName.includes(itemName)));
}

export function collectAppDashboardData(app, { videos = [], adShots = [], articles = [], metrics = [] } = {}) {
  const normalVideos = videos.filter((item) => isAppRecordForApp(item, app));
  const ttccVideos = adShots.filter((item) => isAppRecordForApp(item, app));
  const appVideos = [
    ...normalVideos.map((item) => ({ type: "normal", item, sortTime: item.createdAt })),
    ...ttccVideos.map((item) => ({ type: "ttcc", item, sortTime: item.createdAt || item.updatedAt || item.capturedAt }))
  ];
  const appArticles = articles.filter((item) => isAppRecord(item, app.id));
  const appMetrics = metrics.filter((item) => isAppRecord(item, app.id));

  return {
    appVideos,
    appArticles,
    appMetrics,
    latestVideo: sortByTime(appVideos, "sortTime")[0],
    latestArticle: sortByTime(appArticles, "createdAt")[0],
    latestMetric: sortByTime(appMetrics, "collectedAt")[0]
  };
}

function normalizeLookupName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderAppDashboardCard(app, data, options = {}) {
  const latestVideo = data.latestVideo?.item;
  const tags = Array.isArray(options.tags) ? options.tags.filter(Boolean) : [];
  const detailHref = `/apps/app.html?id=${encodeURIComponent(app.id)}`;
  return `
    <div class="app-dashboard-head">
      <div class="app-dashboard-brand">
        <a class="app-dashboard-logo-link" href="${escapeAttribute(detailHref)}" aria-label="打开 ${escapeAttribute(formatAppDisplayName(app.name))} Dashboard">
          ${app.logoUrl ? `<img src="${escapeAttribute(app.logoUrl)}" alt="" />` : '<div class="app-dashboard-logo-fallback">App</div>'}
        </a>
        <div>
          <h2>${escapeHtml(formatAppDisplayName(app.name))}</h2>
        </div>
      </div>
      <div class="app-dashboard-head-actions">
        ${tags.length ? `<div class="app-dashboard-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      </div>
    </div>
    <a class="app-dashboard-body-link" href="${escapeAttribute(detailHref)}" aria-label="打开 ${escapeAttribute(formatAppDisplayName(app.name))} Dashboard">
      <div class="app-dashboard-stats">
        <div><span>视频</span><strong>${data.appVideos.length}</strong></div>
        <div><span>文章</span><strong>${data.appArticles.length}</strong></div>
        <div><span>数据</span><strong>${data.appMetrics.length}</strong></div>
      </div>
      <div class="app-dashboard-notes">
        <p class="app-dashboard-video-line"><strong>最近视频：</strong><span>${escapeHtml(formatLatestVideoTitle(latestVideo))}</span></p>
        <p class="app-dashboard-note-line"><strong>最近文章：</strong><span>${escapeHtml(data.latestArticle?.title || "暂无")}</span></p>
        <p class="app-dashboard-note-line"><strong>最近数据：</strong><span>${escapeHtml(formatLatestMetricTime(data.latestMetric))}</span></p>
      </div>
    </a>
  `;
}

function formatLatestVideoTitle(item) {
  return item?.title
    || item?.readableTitle
    || item?.analysis?.cardTitle
    || item?.highlight
    || item?.brandName
    || item?.rawBrandName
    || "暂无";
}

function formatLatestMetricTime(item) {
  return item?.collectedAt || item?.createdAt || item?.updatedAt || "暂无";
}
