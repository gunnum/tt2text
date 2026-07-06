import { promises as fs } from "node:fs";
import path from "node:path";

export function createAppDashboardService(deps = {}) {
  const requiredDeps = [
    "projectRootDir",
    "readApps",
    "readAppMetrics",
    "readSensorTowerCsvImports",
    "readAppPaywalls",
    "normalizeText"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAppDashboardService 缺少依赖：${dep}`);
    }
  }

  async function getAppDashboardSummary(appId) {
    const id = normalizeText(appId);
    if (!id) {
      throw new Error("缺少 App ID。");
    }
    const [apps, metrics, csvImports, paywalls] = await Promise.all([
      deps.readApps(),
      deps.readAppMetrics(),
      deps.readSensorTowerCsvImports(),
      deps.readAppPaywalls()
    ]);
    const app = apps.find((item) => normalizeText(item.id) === id);
    if (!app) {
      throw new Error("没有找到这个 App。");
    }
    const appMetrics = metrics.filter((item) => isAppRecord(item, id));
    const overviewRecord = appMetrics.find((item) => item.overview && /overview/i.test(item.sourceUrl || ""))
      || appMetrics.find((item) => item.overview)
      || null;
    const appCsvImports = csvImports.filter((item) => isAppRecord(item, id));
    const latestByChart = pickLatestByChart(appCsvImports);
    const sensorTowerLinks = buildSensorTowerLinks({ app, overviewRecord, csvImports: appCsvImports });
    const categoryRanking = appCsvImports.find((item) => item.categoryRanking?.rows?.length)?.categoryRanking || null;
    const appStoreScreenshots = Array.isArray(app.media?.screenshots)
      ? app.media.screenshots.filter((item) => item?.imageUrl || item?.thumbnailUrl)
      : [];
    const overviewScreenshots = overviewRecord?.overview?.screenshots || [];
    return {
      app,
      sensorTower: sensorTowerLinks,
      overview: overviewRecord ? {
        id: overviewRecord.id,
        collectedAt: overviewRecord.collectedAt,
        sourceUrl: overviewRecord.sourceUrl,
        htmlPath: overviewRecord.htmlPath,
        category: overviewRecord.overview?.category || "",
        appIq: overviewRecord.overview?.appIq || "",
        monetization: overviewRecord.overview?.monetization || [],
        topCountries: overviewRecord.overview?.topCountries || [],
        topCountriesByPlatform: overviewRecord.overview?.topCountriesByPlatform || { ios: [], android: [] },
        globalReleaseDate: overviewRecord.overview?.globalReleaseDate || "",
        inAppPurchases: overviewRecord.overview?.inAppPurchases || [],
        screenshots: overviewRecord.overview?.screenshots || [],
        summaryCards: {}
      } : null,
      dataPanel: await buildDataPanel({ latestByChart, overview: overviewRecord?.overview || null, categoryRanking, app, appId: id, resolvePublicPathToFile: deps.resolvePublicPathToFile }),
      media: {
        source: appStoreScreenshots.length ? "appstore" : (overviewScreenshots.length ? "sensortower" : ""),
        screenshots: appStoreScreenshots.length ? appStoreScreenshots : overviewScreenshots,
        previewVideos: Array.isArray(app.media?.previewVideos) ? app.media.previewVideos : [],
        refreshedAt: app.media?.refreshedAt || ""
      },
      paywall: paywalls.find((item) => normalizeText(item.appId) === id) || null,
      competitors: buildCompetitorSuggestions(categoryRanking, id, app, overviewRecord?.overview || null, apps),
      imports: Object.fromEntries(Object.entries(latestByChart).map(([key, item]) => [key, summarizeImport(item)]))
    };
  }

  function normalizeText(value) {
    return deps.normalizeText(value);
  }

  return {
    getAppDashboardSummary
  };
}

function isAppRecord(item, appId) {
  return String(item?.appId || item?.app?.id || "").trim() === appId;
}

function pickLatestByChart(items) {
  const sorted = [...items].sort((a, b) => dateValue(b.importedAt) - dateValue(a.importedAt));
  const result = {};
  for (const item of sorted) {
    const key = item.chartId || item.dataType || "unknown";
    if (!result[key]) {
      result[key] = item;
    }
  }
  return result;
}

function buildSensorTowerLinks({ app, overviewRecord, csvImports }) {
  const links = [];
  if (app?.sensorTowerUrl) {
    links.push(sensorTowerLink("manual", "Sensor Tower", app.sensorTowerUrl, app.updatedAt || app.createdAt));
  }
  if (overviewRecord?.sourceUrl) {
    links.push(sensorTowerLink("overview", "Overview", overviewRecord.sourceUrl, overviewRecord.collectedAt));
  }
  for (const item of [...(csvImports || [])].sort((a, b) => dateValue(b.importedAt) - dateValue(a.importedAt))) {
    if (!item?.sourceUrl) continue;
    links.push(sensorTowerLink(item.dataType || "metric", item.chartLabel || item.dataType || "Metric", item.sourceUrl, item.importedAt));
  }
  const uniqueLinks = [];
  const seen = new Set();
  for (const link of links) {
    const key = link.url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueLinks.push(link);
  }
  return {
    primaryUrl: uniqueLinks[0]?.url || "",
    primaryLabel: uniqueLinks[0]?.label || "",
    links: uniqueLinks.slice(0, 6)
  };
}

function sensorTowerLink(type, label, url, updatedAt) {
  return {
    type: String(type || ""),
    label: String(label || "Sensor Tower"),
    url: String(url || ""),
    updatedAt: String(updatedAt || "")
  };
}

async function buildDataPanel({ latestByChart, overview, categoryRanking, app, appId, projectRootDir }) {
  const latestRevenue = latestByChart.revenue;
  const latestDownloads = latestByChart.downloads || latestByChart.downloads_mau;
  const latestMau = latestByChart.active_users_mau || latestByChart.active_users;
  const latestReviews = latestByChart.reviews;
  const [downloadsSummary, revenueSummary, mauSummary, engagementSummary] = await Promise.all([
    summarizeMetricCsv(latestDownloads, projectRootDir),
    summarizeMetricCsv(latestRevenue, projectRootDir),
    summarizeMetricCsv(latestMau, projectRootDir),
    summarizeMetricCsv(latestByChart.engagement, projectRootDir)
  ]);
  const ranking = summarizeCategoryRank(categoryRanking, appId, app, overview);
  const totalDownloads = downloadsSummary.downloads || revenueSummary.downloads || 0;
  const totalRevenue = revenueSummary.revenue || downloadsSummary.revenue || 0;
  const rpd = totalDownloads > 0 && totalRevenue > 0 ? totalRevenue / totalDownloads : 0;
  const latestMauValue = mauSummary.latestMau || 0;
  const timeSpent = engagementSummary.latestAvgTimeSpent || 0;
  const topCountries = overview?.topCountries || [];
  const iosCountries = overview?.topCountriesByPlatform?.ios || [];
  const androidCountries = overview?.topCountriesByPlatform?.android || [];
  const competitorRows = categoryRanking?.rows || [];
  return {
    stats: [
      dataStat("下载量", formatCompactNumber(totalDownloads), "P12M 总量", latestDownloads),
      dataStat("收入", formatMoney(totalRevenue), "P12M 总收入", latestRevenue),
      dataStat("MAU", formatCompactNumber(latestMauValue), `${mauSummary.latestDate || "最新月"} MAU`, latestMau),
      dataStat("评论", formatCompactNumber(latestReviews?.rowCount || 0), latestReviews?.dateRange?.duration || "采集口径", latestReviews),
      dataStat("RPD", formatMoney(rpd, { maximumFractionDigits: 2 }), "P12M 收入/下载", latestRevenue || latestDownloads),
      dataStat("使用时长", timeSpent ? `${formatNumber(timeSpent, 1)} 分钟/月` : "", `${engagementSummary.latestDate || "最新月"} 人均月使用时长`, latestByChart.engagement),
      dataStat("收入排名", ranking ? `#${ranking.rank} ${ranking.categoryName || ""}`.trim() : "", ranking ? `${ranking.dateRange || "榜单"} · 90天收入` : "", null)
    ].filter((item) => item.value),
    countries: {
      revenueHot: uniqueTopItems(topCountries, 3),
      activeHot: uniqueTopItems([...iosCountries, ...androidCountries, ...topCountries], 3)
    },
    category: {
      appIq: overview?.appIq || "",
      category: overview?.category || "",
      competitorCount: competitorRows.length
    }
  };
}

function dataStat(label, value, scope, source) {
  return {
    label,
    value,
    scope,
    updatedAt: source?.importedAt || "",
    sourceId: source?.id || "",
    chartId: source?.chartId || ""
  };
}

function buildCompetitorSuggestions(categoryRanking, appId, app, overview, apps) {
  const rows = categoryRanking?.rows || [];
  const appNames = [app?.name, app?.fullName].map(normalizeName).filter(Boolean);
  let index = rows.findIndex((row) => String(row.appId || "") === String(appId));
  if (index < 0) {
    index = rows.findIndex((row) => {
      const candidate = normalizeName(row.appName || row.unifiedName);
      return candidate && appNames.some((name) => name === candidate || name.includes(candidate) || candidate.includes(name));
    });
  }
  const previewRows = index >= 0 ? rows.slice(Math.max(0, index - 5), index + 6) : rows.slice(0, 11);
  const fullLimit = Math.min(50, Number(categoryRanking?.rowLimit || rows.length || 50) || 50);
  const fullRows = rows.slice(0, fullLimit);
  const categoryName = readableCategoryName(categoryRanking?.categoryName || "", overview);
  return {
    categoryName,
    currentRank: index >= 0 ? rows[index]?.rank || "" : "",
    preview: previewRows
    .map((row) => buildCompetitorItem(row, apps))
    .slice(0, 11),
    items: fullRows
    .map((row) => buildCompetitorItem(row, apps))
    .slice(0, fullLimit)
  };
}

function buildCompetitorItem(row, apps) {
  return {
    rank: row.rank,
    appId: row.appId,
    appName: row.appName || row.unifiedName,
    publisherName: row.publisherName,
    logoUrl: findCompetitorLogoUrl(row, apps),
    revenueUsd90d: row.revenueUsd90d,
    downloads90d: row.downloads90d,
    dau: row.dau
  };
}

function summarizeImport(item) {
  if (!item) return null;
  return {
    id: item.id,
    dataType: item.dataType,
    chartId: item.chartId,
    chartLabel: item.chartLabel,
    rowCount: item.rowCount,
    importedAt: item.importedAt,
    dateRange: item.dateRange,
    csvPath: item.csvPath
  };
}

function dateValue(value) {
  return Date.parse(String(value || "").replace(" ", "T")) || 0;
}

async function summarizeMetricCsv(record, resolvePublicPathToFile) {
  if (!record?.csvPath) {
    return {};
  }
  const rows = await readCsvObjects(record, resolvePublicPathToFile);
  const summary = {
    downloads: 0,
    revenue: 0,
    latestMau: 0,
    latestAvgTimeSpent: 0,
    latestDate: ""
  };
  const latestDate = rows.reduce((max, row) => {
    const date = pick(row, ["Date"]);
    return date && date > max ? date : max;
  }, "");
  summary.latestDate = latestDate;

  let timeSpentSum = 0;
  let timeSpentCount = 0;
  for (const row of rows) {
    summary.downloads += parseNumber(pick(row, ["Downloads", "Downloads (Absolute)"]));
    summary.revenue += parseNumber(pick(row, ["Revenue ($)", "Revenue (Absolute)", "Revenue"]));
    const date = pick(row, ["Date"]);
    if (date === latestDate) {
      summary.latestMau += parseNumber(pick(row, ["MAU", "MAU (Absolute)", "Monthly Active Users", "Active Users", "Users"]));
      const timeSpent = parseNumber(pick(row, ["Avg Time Spent (Minutes / Month)"]));
      if (timeSpent > 0) {
        timeSpentSum += timeSpent;
        timeSpentCount += 1;
      }
    }
  }
  summary.latestAvgTimeSpent = timeSpentCount ? timeSpentSum / timeSpentCount : 0;
  return summary;
}

async function readCsvObjects(record, resolvePublicPathToFile) {
  const publicPath = String(record.csvPath || "");
  const filePath = typeof resolvePublicPathToFile === "function"
    ? resolvePublicPathToFile(publicPath)
    : path.resolve(`.${publicPath}`);
  const buffer = await fs.readFile(filePath).catch(() => null);
  if (!buffer?.length) return [];
  const text = decodeCsvBuffer(buffer);
  const rows = parseCsvRows(text);
  const headers = rows[0] || [];
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header || `col_${index + 1}`, row[index] || ""])));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const delimiter = detectCsvDelimiter(text);
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function detectCsvDelimiter(text) {
  const firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
  return (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? "\t" : ",";
}

function summarizeCategoryRank(categoryRanking, appId, app, overview) {
  const appNames = [app?.name, app?.fullName].map(normalizeName).filter(Boolean);
  const row = (categoryRanking?.rows || []).find((item) => String(item.appId || "") === String(appId))
    || (categoryRanking?.rows || []).find((item) => {
      const candidate = normalizeName(item.appName || item.unifiedName);
      return candidate && appNames.some((name) => name === candidate || name.includes(candidate) || candidate.includes(name));
    });
  if (!row) return null;
  const range = categoryRanking.dateRange || {};
  return {
    rank: row.rank,
    categoryName: readableCategoryName(row.categoryName || categoryRanking.categoryName || "", overview),
    dateRange: [range.start, range.end].filter(Boolean).join("~") || categoryRanking.importedAt || ""
  };
}

function readableCategoryName(value, overview) {
  const text = String(value || "").trim();
  if (text && !/^App IQ\s+[a-f0-9]{12,}$/i.test(text)) {
    return text;
  }
  return String(overview?.appIq || overview?.category || "").trim();
}

function pick(row, keys) {
  for (const key of keys) {
    if (row?.[key] != null && row[key] !== "") return row[key];
  }
  return "";
}

function parseNumber(value) {
  const text = String(value || "").replace(/,/g, "").trim();
  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) || 0 : 0;
}

function decodeCsvBuffer(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return decodeUtf16Be(buffer.subarray(2));
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 4000));
  let nulOdd = 0;
  let nulEven = 0;
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] === 0) {
      if (index % 2 === 0) nulEven += 1;
      else nulOdd += 1;
    }
  }
  if (nulOdd > sample.length / 8) {
    return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (nulEven > sample.length / 8) {
    return decodeUtf16Be(buffer).replace(/^\uFEFF/, "");
  }
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

function decodeUtf16Be(buffer) {
  const swapped = Buffer.allocUnsafe(buffer.length);
  for (let index = 0; index < buffer.length; index += 2) {
    swapped[index] = buffer[index + 1] || 0;
    swapped[index + 1] = buffer[index] || 0;
  }
  return swapped.toString("utf16le");
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .replace(/\b(app|ios|android|mobile)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatCompactNumber(value) {
  const number = Number(value) || 0;
  if (!number) return "";
  if (number >= 1_000_000) return `${formatNumber(number / 1_000_000, 1)}M`;
  if (number >= 1_000) return `${formatNumber(number / 1_000, 0)}K`;
  return formatNumber(number, 0);
}

function formatMoney(value, options = {}) {
  const number = Number(value) || 0;
  if (!number) return "";
  if (number >= 1_000_000) return `$${formatNumber(number / 1_000_000, 1)}M`;
  if (number >= 1_000) return `$${formatNumber(number / 1_000, 0)}K`;
  return `$${formatNumber(number, options.maximumFractionDigits ?? 0)}`;
}

function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(Number(value) || 0);
}

function uniqueTopItems(items, limit) {
  return Array.from(new Set((items || []).filter(Boolean))).slice(0, limit);
}

function findCompetitorLogoUrl(row, apps) {
  const appId = String(row?.appId || "").trim();
  if (appId) {
    const byId = (apps || []).find((item) => String(item?.id || "").trim() === appId);
    if (byId?.logoUrl) return byId.logoUrl;
  }
  const candidateName = normalizeName(row?.appName || row?.unifiedName);
  if (!candidateName) return "";
  const byName = (apps || []).find((item) => {
    const names = [item?.name, item?.fullName].map(normalizeName).filter(Boolean);
    return names.some((name) => name === candidateName || name.includes(candidateName) || candidateName.includes(name));
  });
  return byName?.logoUrl || "";
}
