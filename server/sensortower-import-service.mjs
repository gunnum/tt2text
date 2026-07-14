import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  buildSensorTowerCsvDedupeKey
} from "./sensortower-dedupe.mjs";

export function createSensorTowerImportService(deps = {}) {
  const requiredDeps = [
    "readApps",
    "readAppMetrics",
    "writeAppMetrics",
    "readCsvImports",
    "writeCsvImports",
    "addAppFromStoreId",
    "addAppFromStoreSearch",
    "pickResultAppFields",
    "matchAppByName",
    "extractAppStoreIdFromSensorTowerUrl",
    "parseSensorTowerUrl",
    "decodeCsvBuffer",
    "parseCsvPreview",
    "parseCsvRows",
    "serializeCsvRows",
    "normalizeSensorTowerOverview",
    "normalizeMetricItems",
    "normalizeTables",
    "sanitizeMetricRawPayload",
    "normalizeStringArray",
    "normalizeText",
    "truncateText",
    "createJobId",
    "formatDate",
    "ensureDir",
    "normalizeToPublicPath",
    "safePathSegment",
    "safeFilename",
    "renderSensorTowerOverviewHtml",
    "sensorTowerHumanDir"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createSensorTowerImportService 缺少依赖：${dep}`);
    }
  }

  async function importAppMetrics(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("缺少采集数据。");
    }

    const sourceUrl = deps.normalizeText(payload.url || payload.sourceUrl);
    if (!sourceUrl) {
      throw new Error("缺少 Sensor Tower 页面 URL。");
    }

    const extractedAppName = deps.normalizeText(payload.appName || payload.detectedAppName || payload.title || payload.pageTitle);
    let apps = await deps.readApps();
    const appStoreId = deps.extractAppStoreIdFromSensorTowerUrl(sourceUrl);
    let matchedApp = appStoreId ? apps.find((app) => app.id === appStoreId) : null;
    let appMatchSource = matchedApp ? "local" : "none";
    if (!matchedApp && appStoreId) {
      matchedApp = await deps.addAppFromStoreId(appStoreId);
      if (matchedApp) {
        appMatchSource = "sensortower-url";
      }
    }
    if (!matchedApp) {
      matchedApp = deps.matchAppByName(apps, extractedAppName);
      appMatchSource = matchedApp ? "local-name" : "none";
    }
    if (!matchedApp && extractedAppName) {
      matchedApp = await deps.addAppFromStoreSearch(extractedAppName);
      if (matchedApp) {
        appMatchSource = "appstore-search";
        apps = await deps.readApps();
        matchedApp = deps.matchAppByName(apps, matchedApp.name) || matchedApp;
      }
    }
    const collectedAt = deps.formatDate(new Date());
    const id = deps.createJobId();
    const overview = deps.normalizeSensorTowerOverview(payload.overview);
    const appName = extractedAppName || matchedApp?.name || "未识别 App";
    const archive = overview ? await writeSensorTowerOverviewArchive({
      id,
      appName,
      app: matchedApp,
      sourceUrl,
      pageTitle: deps.normalizeText(payload.title || payload.pageTitle),
      overview,
      pageText: deps.truncateText(deps.normalizeText(payload.pageText), 20000),
      collectedAt
    }) : { folderPath: "", htmlPath: "" };
    const record = {
      id,
      source: "sensortower",
      sourceUrl,
      pageTitle: deps.normalizeText(payload.title || payload.pageTitle),
      appName,
      appId: matchedApp?.id || "",
      app: matchedApp ? deps.pickResultAppFields(matchedApp) : null,
      matched: Boolean(matchedApp),
      matchSource: appMatchSource,
      metrics: deps.normalizeMetricItems(payload.metrics),
      tables: deps.normalizeTables(payload.tables),
      filters: deps.normalizeStringArray(payload.filters).slice(0, 40),
      overview,
      folderPath: archive.folderPath,
      htmlPath: archive.htmlPath,
      pageText: deps.truncateText(deps.normalizeText(payload.pageText), 20000),
      raw: deps.sanitizeMetricRawPayload(payload),
      collectedAt
    };

    const records = await deps.readAppMetrics();
    records.unshift(record);
    await deps.writeAppMetrics(records);
    return record;
  }

  async function importSensorTowerCsvFromPath(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("缺少 CSV 导入数据。");
    }
    const sourcePath = deps.normalizeText(payload.filename || payload.path);
    if (!sourcePath) {
      throw new Error("缺少 CSV 文件路径。");
    }

    const stat = await fs.stat(sourcePath).catch(() => null);
    if (!stat?.isFile()) {
      throw new Error(`CSV 文件不存在：${sourcePath}`);
    }

    return importSensorTowerCsvBuffer({
      buffer: await fs.readFile(sourcePath),
      originalFilename: path.basename(sourcePath),
      originalSource: sourcePath,
      page: payload.page,
      downloadUrl: deps.normalizeText(payload.downloadUrl),
      totalBytes: Number(payload.totalBytes) || stat.size
    });
  }

  async function importSensorTowerCsvFromContent(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("缺少 CSV 内容。");
    }
    const filename = deps.safeFilename(deps.normalizeText(payload.filename) || "sensortower.csv");
    const contentBase64 = deps.normalizeText(payload.contentBase64);
    const contentText = typeof payload.contentText === "string" ? payload.contentText : "";
    const buffer = contentBase64
      ? Buffer.from(contentBase64, "base64")
      : Buffer.from(contentText, "utf8");
    if (!buffer.length) {
      throw new Error("CSV 内容为空。");
    }
    return importSensorTowerCsvBuffer({
      buffer,
      originalFilename: filename,
      originalSource: "extension-content",
      page: payload.page,
      downloadUrl: deps.normalizeText(payload.downloadUrl),
      totalBytes: Number(payload.totalBytes) || buffer.length
    });
  }

  async function importSensorTowerCsvBuffer({ buffer, originalFilename, originalSource, page: rawPage, downloadUrl, totalBytes }) {
    const page = rawPage && typeof rawPage === "object" ? rawPage : {};
    const batchItem = page.batchItem && typeof page.batchItem === "object" ? page.batchItem : null;
    const sourceUrl = deps.normalizeText(page.url || page.sourceUrl);
    const urlMeta = deps.parseSensorTowerUrl(sourceUrl);
    let apps = await deps.readApps();
    let matchedApp = urlMeta.appStoreId ? apps.find((app) => app.id === urlMeta.appStoreId) : null;
    let matchSource = matchedApp ? "local-id" : "none";
    if (!matchedApp && urlMeta.appStoreId) {
      matchedApp = await deps.addAppFromStoreId(urlMeta.appStoreId);
      apps = await deps.readApps();
      matchedApp = apps.find((app) => app.id === urlMeta.appStoreId) || matchedApp;
      matchSource = matchedApp ? "sensortower-url" : "none";
    }
    if (!matchedApp) {
      const extractedAppName = deps.normalizeText(page.appName || page.detectedAppName || page.title || page.pageTitle);
      matchedApp = deps.matchAppByName(apps, extractedAppName);
      matchSource = matchedApp ? "local-name" : "none";
    }

    const id = deps.createJobId();
    const importedAt = deps.formatDate(new Date());
    const recordAppName = matchedApp?.name || deps.normalizeText(page.appName || page.detectedAppName) || urlMeta.appStoreId || "Unknown App";
    const csvText = deps.decodeCsvBuffer(buffer);
    const sourceRows = deps.parseCsvRows(csvText);
    const recordDataType = deps.normalizeText(page.dataType) || urlMeta.dataType;
    const isCategoryRanking = recordDataType === "category_rankings" || urlMeta.dataType === "category_rankings" || /\/market-analysis\/top-apps/i.test(sourceUrl);
    const categoryRankingRowLimit = isCategoryRanking ? getCategoryRankingRowLimit(urlMeta) : 0;
    const topRows = isCategoryRanking ? sourceRows.slice(0, categoryRankingRowLimit + 1) : sourceRows;
    const parsedCsvText = isCategoryRanking ? deps.serializeCsvRows(topRows[0] || [], topRows.slice(1)) : csvText;
    const parsed = deps.parseCsvPreview(parsedCsvText);
    const categoryRankingRows = isCategoryRanking ? csvRowsToObjects(topRows[0] || [], topRows.slice(1)) : [];
    const archivedFilename = deps.safeFilename(originalFilename || `${urlMeta.dataType || "sensortower"}-${id}.csv`);
    const categoryRanking = isCategoryRanking ? buildCategoryRankingMeta({
      rows: categoryRankingRows,
      rowLimit: categoryRankingRowLimit,
      sourceUrl,
      urlMeta,
      importedAt,
      appId: matchedApp?.id || urlMeta.appStoreId || "",
      appName: recordAppName
    }) : null;
    const contentHash = createHash("sha1").update(buffer).digest("hex");

    const provisionalRecord = {
      id,
      source: "sensortower",
      sourceUrl,
      pageTitle: deps.normalizeText(page.title || page.pageTitle),
      dataType: recordDataType,
      chartId: deps.normalizeText(batchItem?.id),
      chartLabel: deps.normalizeText(batchItem?.label),
      metric: urlMeta.metric,
      appId: matchedApp?.id || urlMeta.appStoreId || "",
      appName: recordAppName,
      appDeveloper: matchedApp?.developer || deps.normalizeText(page.appDeveloper || page.developer) || "",
      app: matchedApp ? deps.pickResultAppFields(matchedApp) : null,
      matched: Boolean(matchedApp),
      matchSource,
      archivedFilename,
      originalFilename: deps.normalizeText(originalFilename),
      originalSource: deps.normalizeText(originalSource),
      downloadUrl: deps.normalizeText(downloadUrl),
      totalBytes: Number(totalBytes) || buffer.length,
      contentHash,
      rowCount: parsed.rowCount,
      headers: parsed.headers,
      filters: urlMeta.filters,
      dateRange: urlMeta.dateRange,
      categoryRanking,
      categoryRankingSnapshotKey: categoryRanking?.snapshotKey || "",
      categoryRankingLink: categoryRanking ? {
        appId: matchedApp?.id || urlMeta.appStoreId || "",
        snapshotKey: categoryRanking.snapshotKey || "",
        source: "captured",
        linkedAt: importedAt
      } : null,
      importedAt
    };
    provisionalRecord.dedupeKey = buildSensorTowerCsvDedupeKey(provisionalRecord);

    const records = await deps.readCsvImports();
    const duplicate = await findDuplicateCsvImport(records, provisionalRecord, contentHash);
    if (duplicate) {
      return {
        ...duplicate,
        duplicate: true,
        skippedDuplicate: true
      };
    }

    const targetDir = path.join(deps.sensorTowerHumanDir, deps.safePathSegment(recordAppName), id);
    await deps.ensureDir(targetDir);
    const archivedCsvPath = path.join(targetDir, archivedFilename);
    await fs.writeFile(archivedCsvPath, isCategoryRanking ? deps.serializeCsvRows(topRows[0] || [], topRows.slice(1)) : buffer);
    const parsedPath = path.join(targetDir, "parsed-preview.json");
    await fs.writeFile(parsedPath, JSON.stringify(parsed, null, 2), "utf8");

    const record = {
      ...provisionalRecord,
      csvPath: deps.normalizeToPublicPath(archivedCsvPath),
      parsedPath: deps.normalizeToPublicPath(parsedPath),
      folderPath: deps.normalizeToPublicPath(targetDir)
    };
    records.unshift(record);
    await deps.writeCsvImports(records);
    return record;
  }

  async function findDuplicateCsvImport(records = [], record = {}, contentHash = "") {
    for (const item of records) {
      if (buildSensorTowerCsvDedupeKey(item) === record.dedupeKey) return item;
      const existingHash = deps.normalizeText(item.contentHash) || await readStoredCsvHash(item);
      if (existingHash && existingHash === contentHash && isSameCsvSemanticScope(item, record)) return item;
    }
    return null;
  }

  function isSameCsvSemanticScope(left = {}, right = {}) {
    if (deps.normalizeText(left.appId) !== deps.normalizeText(right.appId)) return false;
    if (deps.normalizeText(left.dataType) !== deps.normalizeText(right.dataType)) return false;
    if (deps.normalizeText(left.chartId) !== deps.normalizeText(right.chartId)) return false;
    if (deps.normalizeText(left.metric) !== deps.normalizeText(right.metric)) return false;
    if (buildSensorTowerCsvDedupeKey({ ...left, contentHash: "" }) === buildSensorTowerCsvDedupeKey({ ...right, contentHash: "" })) {
      return true;
    }
    return false;
  }

  async function readStoredCsvHash(record = {}) {
    const csvPath = deps.normalizeText(record.csvPath);
    if (!csvPath) return "";
    const localPath = resolveStoredPath(csvPath);
    try {
      const bytes = await fs.readFile(localPath);
      return createHash("sha1").update(bytes).digest("hex");
    } catch {
      return "";
    }
  }

  function resolveStoredPath(value = "") {
    const storedPath = deps.normalizeText(value);
    if (!storedPath) return "";
    if (path.isAbsolute(storedPath) && !storedPath.startsWith("/sensor/")) return storedPath;
    const storageRootDir = path.resolve(deps.sensorTowerHumanDir, "..");
    if (storedPath.startsWith("/")) return path.resolve(storageRootDir, `.${storedPath}`);
    return path.resolve(storageRootDir, storedPath);
  }

  function getCategoryRankingRowLimit(urlMeta = {}) {
    const pageSize = Number(urlMeta.filters?.pageSize);
    if (Number.isFinite(pageSize) && pageSize > 0) {
      return Math.min(Math.trunc(pageSize), 500);
    }
    return 25;
  }

  function csvRowsToObjects(headers = [], rows = []) {
    const safeHeaders = headers.map((header, index) => header || `col_${index + 1}`);
    return rows.map((row) => Object.fromEntries(safeHeaders.map((header, index) => [header, row[index] || ""])));
  }

  function buildCategoryRankingMeta({ rows: rawRows = [], rowLimit = 25, sourceUrl, urlMeta, importedAt, appId, appName }) {
    const rows = rawRows.slice(0, rowLimit).map((row, index) => normalizeCategoryRankingRow(row, index));
    const totalRevenue = rows.reduce((sum, row) => sum + row.revenueUsd90d, 0);
    const totalDownloads = rows.reduce((sum, row) => sum + row.downloads90d, 0);
    const totalDau = rows.reduce((sum, row) => sum + row.dau, 0);
    const categoryName = inferCategoryName(sourceUrl, urlMeta);
    const customFieldsFilterId = deps.normalizeText(urlMeta.filters?.customFieldsFilterId);
    const snapshotKey = buildCategoryRankingSnapshotKey({ sourceUrl, urlMeta });
    return {
      sourceUrl,
      snapshotKey,
      customFieldsFilterId,
      appId,
      appName,
      categoryName,
      rowLimit,
      metric: urlMeta.metric || "revenue",
      sort: "absolute",
      countries: urlMeta.filters?.countries || [],
      os: urlMeta.filters?.os || "unified",
      devices: urlMeta.filters?.devices || [],
      dateRange: urlMeta.dateRange || {},
      importedAt,
      snapshotUpdatedAt: importedAt,
      summary: {
        appCount: rows.length,
        totalRevenueUsd90d: totalRevenue,
        averageRevenueUsd90d: rows.length ? totalRevenue / rows.length : 0,
        averageMonthlyRevenueUsd: rows.length ? totalRevenue / rows.length / 3 : 0,
        totalDownloads90d: totalDownloads,
        averageDownloads90d: rows.length ? totalDownloads / rows.length : 0,
        averageDau: rows.length ? totalDau / rows.length : 0
      },
      rows
    };
  }

  function normalizeCategoryRankingRow(row = {}, index = 0) {
    const appName = pickAny(row, ["App Name", "Name", "App", "Unified Name", "Product"]);
    const rank = parseNumber(pickAny(row, ["Rank", "#", "Ranking"])) || index + 1;
    const revenueUsd90d = parseNumber(pickAny(row, ["Revenue (Absolute)", "Revenue ($)", "Revenue", "Revenue USD", "IAP Revenue ($)", "Net Revenue ($)"]));
    const downloads90d = parseNumber(pickAny(row, ["Downloads (Absolute)", "Downloads", "Download", "Units", "Installs"]));
    const dau = parseNumber(pickAny(row, ["DAU (Absolute)", "DAU", "Average DAU", "Avg DAU", "Active Users", "Users"]));
    return {
      rank,
      appId: pickAny(row, ["App ID", "Store ID", "iOS App ID", "Android App ID"]),
      unifiedId: pickAny(row, ["Unified ID", "Unified App ID"]),
      appName,
      unifiedName: pickAny(row, ["Unified Name"]) || appName,
      publisherName: pickAny(row, ["Unified Publisher Name", "Publisher Name", "Publisher", "Developer"]),
      revenueUsd90d,
      monthlyRevenueUsd: revenueUsd90d / 3,
      downloads90d,
      dau,
      platform: pickAny(row, ["Platform", "OS"]),
      raw: row
    };
  }

  function pickAny(row, keys) {
    for (const key of keys) {
      const exact = deps.normalizeText(row?.[key]);
      if (exact) return exact;
      const normalizedKey = normalizeColumnKey(key);
      const entry = Object.entries(row || {}).find(([candidate]) => normalizeColumnKey(candidate) === normalizedKey);
      const value = deps.normalizeText(entry?.[1]);
      if (value) return value;
    }
    return "";
  }

  function parseNumber(value) {
    const text = deps.normalizeText(value);
    if (!text) return 0;
    const match = text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (!match) return 0;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) return 0;
    const lower = text.toLowerCase();
    const multiplier = /\bb\b|十亿/.test(lower)
      ? 1_000_000_000
      : /\bm\b|百万/.test(lower)
        ? 1_000_000
        : /\bk\b|千/.test(lower)
          ? 1_000
          : /万/.test(lower)
            ? 10_000
            : 1;
    return number * multiplier;
  }

  function normalizeColumnKey(value) {
    return deps.normalizeText(value).replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "").toLowerCase();
  }

  function inferCategoryName(sourceUrl, urlMeta) {
    const filterId = deps.normalizeText(urlMeta.filters?.customFieldsFilterId);
    if (filterId) return `App IQ ${filterId}`;
    try {
      const parsed = new URL(sourceUrl);
      return deps.normalizeText(parsed.searchParams.get("category")) || "同品类应用";
    } catch {
      return "同品类应用";
    }
  }

  function buildCategoryRankingSnapshotKey({ sourceUrl, urlMeta }) {
    const filters = urlMeta.filters || {};
    const parts = [
      deps.normalizeText(filters.customFieldsFilterId),
      deps.normalizeText(urlMeta.metric || "revenue"),
      deps.normalizeText(filters.comparisonAttribute || "absolute"),
      deps.normalizeText(urlMeta.dateRange?.start),
      deps.normalizeText(urlMeta.dateRange?.end),
      deps.normalizeText(urlMeta.dateRange?.duration),
      canonicalCountryKey(filters.countries),
      canonicalListKey(filters.devices),
      deps.normalizeText(filters.os || "unified")
    ];
    if (parts[0]) {
      return parts.join("|");
    }
    try {
      const parsed = new URL(sourceUrl);
      return [
        deps.normalizeText(parsed.searchParams.get("category")) || "category",
        ...parts.slice(1)
      ].join("|");
    } catch {
      return parts.join("|");
    }
  }

  function canonicalCountryKey(countries = []) {
    const values = deps.normalizeStringArray(countries).map((item) => item.toUpperCase()).filter(Boolean);
    if (!values.length) return "";
    if (values.includes("ALL") || values.length >= 50) return "all";
    return Array.from(new Set(values)).sort().join(",");
  }

  function canonicalListKey(values = []) {
    return Array.from(new Set(deps.normalizeStringArray(values).map((item) => item.toLowerCase()).filter(Boolean))).sort().join(",");
  }

  async function writeSensorTowerOverviewArchive({ id, appName, app, sourceUrl, pageTitle, overview, pageText, collectedAt }) {
    const targetDir = path.join(deps.sensorTowerHumanDir, deps.safePathSegment(appName), "overview", id);
    await deps.ensureDir(targetDir);
    const htmlPath = path.join(targetDir, "overview.html");
    await fs.writeFile(htmlPath, deps.renderSensorTowerOverviewHtml({
      appName,
      app,
      sourceUrl,
      pageTitle,
      overview,
      pageText,
      collectedAt
    }), "utf8");
    await fs.writeFile(path.join(targetDir, "overview.json"), JSON.stringify({
      appName,
      app,
      sourceUrl,
      pageTitle,
      overview,
      pageText,
      collectedAt
    }, null, 2), "utf8");
    return {
      folderPath: deps.normalizeToPublicPath(targetDir),
      htmlPath: deps.normalizeToPublicPath(htmlPath)
    };
  }

  return {
    importAppMetrics,
    importSensorTowerCsvFromPath,
    importSensorTowerCsvFromContent
  };
}
