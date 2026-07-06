#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDataDir } from "./local-storage.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = resolveDataDir(process.env);
const schemaPath = path.join(rootDir, "db", "schema.sql");
const defaultDbPath = path.join(dataDir, "research.sqlite");
const dbPath = path.resolve(rootDir, process.argv[2] || defaultDbPath);

const tablesToClear = [
  "report_runs",
  "video_jobs",
  "articles",
  "tiktok_comments",
  "tiktok_results",
  "app_category_ranking_links",
  "category_ranking_snapshot_rows",
  "category_ranking_snapshots",
  "category_ranking_rows",
  "sensor_rows",
  "sensor_csv_imports",
  "app_metric_snapshots",
  "apps"
];

main();

function main() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath);
  }
  runSql(fs.readFileSync(schemaPath, "utf8"));

  const sql = [];
  sql.push("PRAGMA foreign_keys = OFF;");
  sql.push("BEGIN;");
  for (const table of tablesToClear) {
    sql.push(`DELETE FROM ${table};`);
  }

  const apps = readJsonArray("apps.json");
  const appMetrics = readJsonArray("app-metrics.json");
  const sensorImports = readJsonArray("sensortower-csv.json");
  const categorySnapshotState = buildCategoryRankingSnapshotState(sensorImports);
  const results = readJsonArray("results.json");
  const tiktokCommentImports = readJsonArray("tiktok-comments.json");
  const articles = readJsonArray("articles.json");
  const videoJobs = readJsonArray("video-jobs.json");

  for (const app of apps) {
    sql.push(insert("apps", {
      id: app.id,
      name: app.name,
      full_name: app.fullName,
      bundle_id: app.bundleId,
      seller_name: app.sellerName,
      logo_url: app.logoUrl,
      app_store_url: app.appStoreUrl,
      created_at: app.createdAt,
      raw_json: json(app)
    }));
  }

  for (const record of appMetrics) {
    sql.push(insert("app_metric_snapshots", {
      id: record.id,
      app_id: record.appId || record.app?.id,
      source: record.source,
      source_url: record.sourceUrl,
      page_title: record.pageTitle,
      app_name: record.appName,
      matched: bool(record.matched),
      match_source: record.matchSource,
      metrics_json: json(record.metrics || []),
      tables_json: json(record.tables || []),
      filters_json: json(record.filters || []),
      overview_json: json(record.overview || null),
      folder_path: record.folderPath,
      html_path: record.htmlPath,
      page_text: record.pageText,
      collected_at: record.collectedAt,
      raw_json: json(record)
    }));
  }

  const resultById = new Map(results.map((item) => [item.id, item]));
  for (const record of sensorImports) {
    const filters = record.filters || {};
    const os = normalize(filters.os);
    sql.push(insert("sensor_csv_imports", {
      id: record.id,
      app_id: record.appId || record.app?.id,
      source: record.source,
      source_url: record.sourceUrl,
      page_title: record.pageTitle,
      data_type: record.dataType,
      chart_id: record.chartId,
      chart_label: record.chartLabel,
      metric: record.metric,
      app_name: record.appName,
      app_developer: record.appDeveloper,
      matched: bool(record.matched),
      match_source: record.matchSource,
      csv_path: record.csvPath,
      parsed_path: record.parsedPath,
      folder_path: record.folderPath,
      archived_filename: record.archivedFilename,
      original_filename: record.originalFilename,
      original_source: record.originalSource,
      download_url: record.downloadUrl,
      total_bytes: num(record.totalBytes),
      row_count: num(record.rowCount),
      headers_json: json(record.headers || []),
      filters_json: json(filters),
      date_start: record.dateRange?.start,
      date_end: record.dateRange?.end,
      date_duration: record.dateRange?.duration,
      imported_at: record.importedAt,
      raw_json: json(record)
    }));

    const rows = readSensorRows(record);
    rows.forEach((row, index) => {
      const platformAppId = pick(row, "App ID");
      const appId = record.appId || record.app?.id || "";
      const feedbackPlatform = record.dataType === "reviews" ? feedbackPlatformFor(record, row) : "";
      sql.push(insert("sensor_rows", {
        id: `${record.id}:${index + 1}`,
        import_id: record.id,
        row_index: index + 1,
        app_id: appId,
        platform_app_id: platformAppId,
        app_name: pick(row, "App Name"),
        unified_id: pick(row, "Unified ID"),
        unified_name: pick(row, "Unified Name"),
        publisher_id: pick(row, "Publisher ID"),
        publisher_name: pick(row, "Publisher Name"),
        date: pick(row, "Date"),
        country_region: pick(row, "Country / Region") || pick(row, "Country/Region") || pick(row, "Country"),
        platform: pick(row, "Platform"),
        device: pick(row, "Device"),
        downloads: num(pick(row, "Downloads")),
        revenue_usd: num(pick(row, "Revenue ($)")),
        rpd_usd: num(pick(row, "RPD ($)")),
        mau: num(pick(row, "MAU") || pick(row, "MAU (Absolute)") || pick(row, "Monthly Active Users") || pick(row, "Active Users") || pick(row, "Users")),
        avg_time_spent_minutes_month: num(pick(row, "Avg Time Spent (Minutes / Month)")),
        total_time_spent_years: num(pick(row, "Total Time Spent (Years)")),
        avg_minutes_session: num(pick(row, "Avg Minutes / Session")),
        avg_session_count_month: num(pick(row, "Avg Session Count / Month")),
        total_session_count: num(pick(row, "Total Session Count")),
        title: pick(row, "Title"),
        content: pick(row, "Content"),
        username: pick(row, "Username"),
        tags: pick(row, "Tags"),
        rating: num(pick(row, "Rating")),
        sentiment: pick(row, "Sentiment"),
        version: pick(row, "Version"),
        feedback_source: record.dataType === "reviews" ? "sensortower" : "",
        feedback_platform: feedbackPlatform,
        feedback_type: record.dataType === "reviews" ? "review" : "",
        os,
        raw_json: json(row)
      }));
    });

    const categoryRows = Array.isArray(record.categoryRanking?.rows) ? record.categoryRanking.rows.slice(0, 25) : [];
    categoryRows.forEach((row, index) => {
      const ranking = record.categoryRanking || {};
      const filters = record.filters || {};
      sql.push(insert("category_ranking_rows", {
        id: `${record.id}:category:${index + 1}`,
        import_id: record.id,
        subject_app_id: record.appId || record.app?.id,
        row_index: index + 1,
        rank: int(row.rank) || index + 1,
        platform_app_id: row.appId,
        unified_id: row.unifiedId,
        app_name: row.appName,
        unified_name: row.unifiedName,
        publisher_name: row.publisherName,
        revenue_usd_90d: num(row.revenueUsd90d),
        monthly_revenue_usd: num(row.monthlyRevenueUsd),
        downloads_90d: num(row.downloads90d),
        dau: num(row.dau),
        country_codes: (ranking.countries || filters.countries || []).join(","),
        os: ranking.os || filters.os,
        devices: (ranking.devices || filters.devices || []).join(","),
        category_name: ranking.categoryName,
        metric: ranking.metric || record.metric,
        comparison_attribute: ranking.sort || filters.comparisonAttribute,
        date_start: ranking.dateRange?.start || record.dateRange?.start,
        date_end: ranking.dateRange?.end || record.dateRange?.end,
        date_duration: ranking.dateRange?.duration || record.dateRange?.duration,
        imported_at: ranking.importedAt || record.importedAt,
        raw_json: json(row)
      }));
    });
  }

  for (const snapshot of categorySnapshotState.snapshots) {
    const ranking = snapshot.record.categoryRanking || {};
    sql.push(insert("category_ranking_snapshots", {
      snapshot_key: snapshot.key,
      import_id: snapshot.record.id,
      custom_fields_filter_id: ranking.customFieldsFilterId || extractSearchParam(ranking.sourceUrl || snapshot.record.sourceUrl, "custom_fields_filter_id"),
      category_name: ranking.categoryName,
      metric: ranking.metric || snapshot.record.metric,
      comparison_attribute: ranking.sort || snapshot.record.filters?.comparisonAttribute,
      date_start: ranking.dateRange?.start || snapshot.record.dateRange?.start,
      date_end: ranking.dateRange?.end || snapshot.record.dateRange?.end,
      date_duration: ranking.dateRange?.duration || snapshot.record.dateRange?.duration,
      country_codes: (ranking.countries || snapshot.record.filters?.countries || []).join(","),
      os: ranking.os || snapshot.record.filters?.os,
      devices: (ranking.devices || snapshot.record.filters?.devices || []).join(","),
      source_url: ranking.sourceUrl || snapshot.record.sourceUrl,
      row_count: num(snapshot.record.rowCount),
      imported_at: ranking.importedAt || snapshot.record.importedAt,
      updated_at: ranking.snapshotUpdatedAt || ranking.importedAt || snapshot.record.importedAt,
      summary_json: json(ranking.summary || {}),
      raw_json: json(snapshot.record)
    }));

    const rows = Array.isArray(ranking.rows) ? ranking.rows.slice(0, 25) : [];
    rows.forEach((row, index) => {
      sql.push(insert("category_ranking_snapshot_rows", {
        id: `${snapshot.key}:row:${index + 1}`,
        snapshot_key: snapshot.key,
        import_id: snapshot.record.id,
        row_index: index + 1,
        rank: int(row.rank) || index + 1,
        platform_app_id: row.appId,
        unified_id: row.unifiedId,
        app_name: row.appName,
        unified_name: row.unifiedName,
        publisher_name: row.publisherName,
        revenue_usd_90d: num(row.revenueUsd90d),
        monthly_revenue_usd: num(row.monthlyRevenueUsd),
        downloads_90d: num(row.downloads90d),
        dau: num(row.dau),
        raw_json: json(row)
      }));
    });
  }

  for (const link of categorySnapshotState.links) {
    sql.push(insert("app_category_ranking_links", {
      id: `${link.appId}:${stableId(link.key)}`,
      app_id: link.appId,
      snapshot_key: link.key,
      custom_fields_filter_id: link.customFieldsFilterId,
      source: link.source,
      linked_at: link.linkedAt,
      latest_import_id: link.latestImportId,
      raw_json: json(link.raw)
    }));
  }

  for (const result of results) {
    const engagement = result.engagement || {};
    const relevance = result.relevance || {};
    const commentsRaw = result.commentsRaw || null;
    const sourceUrl = result.sourceUrl || result.hyperlink;
    sql.push(insert("tiktok_results", {
      id: result.id,
      app_id: result.appId || result.app?.id,
      source_url: result.sourceUrl,
      normalized_url: normalizeVideoUrl(sourceUrl),
      hyperlink: result.hyperlink,
      title: result.title,
      hashtags_json: json(extractHashtags(result.title)),
      media_type: result.mediaType,
      author: result.author || extractTikTokAuthor(sourceUrl),
      published_at: result.publishedAt,
      published_text: result.publishedText,
      transcript_origin: result.transcriptEn,
      transcript_en: result.transcriptEn,
      transcript_zh: result.transcriptZh,
      visual_summary: result.visualSummary,
      source_language: result.sourceLanguage,
      source_language_probability: num(result.sourceLanguageProbability),
      like_count: int(engagement.likeCount),
      comment_count: int(engagement.commentCount),
      share_count: int(engagement.shareCount),
      view_count: int(engagement.viewCount),
      relevance_status: relevance.status,
      relevance_is_relevant: bool(relevance.isRelevant),
      relevance_confidence: num(relevance.confidence),
      relevance_reason: relevance.reason,
      first_frame_path: result.firstFramePath,
      visual_frame_paths_json: json(result.visualFramePaths || []),
      comments_item_count: Array.isArray(commentsRaw?.items) ? commentsRaw.items.length : 0,
      created_at: result.createdAt,
      updated_at: result.updatedAt,
      raw_json: json(result)
    }));

    if (Array.isArray(commentsRaw?.items)) {
      appendTikTokComments(sql, commentsRaw, result);
    }
  }

  for (const record of tiktokCommentImports) {
    appendTikTokComments(sql, record, resultById.get(record.resultId) || null);
  }

  for (const article of articles) {
    sql.push(insert("articles", {
      id: article.id,
      app_id: article.appId || article.app?.id,
      source_url: article.sourceUrl,
      title: article.title,
      subtitle: article.subtitle,
      source_name: article.sourceName,
      source_domain: article.sourceDomain,
      author: article.author,
      published_at: article.publishedAt,
      created_at: article.createdAt,
      bundle_path: article.bundlePath,
      manifest_path: article.manifestPath,
      clean_markdown_path: article.cleanMarkdownPath,
      brief_markdown_path: article.briefMarkdownPath,
      cover_image_path: article.coverImagePath,
      image_count: int(article.imageCount),
      content_block_count: int(article.contentBlockCount),
      excerpt: article.excerpt,
      core_insights_json: json(article.coreInsights || []),
      owned_bundle: bool(article.ownedBundle),
      raw_json: json(article)
    }));
  }

  for (const job of videoJobs) {
    const resultId = resultById.has(job.resultId) ? job.resultId : "";
    sql.push(insert("video_jobs", {
      id: job.id,
      app_id: job.appId || job.app?.id,
      result_id: resultId,
      status: job.status,
      progress: num(job.progress),
      stage: job.stage,
      stage_key: job.stageKey,
      source_url: job.sourceUrl,
      normalized_url: job.normalizedUrl,
      title: job.title,
      preview_text: job.previewText,
      author: job.author,
      cover_url: job.coverUrl,
      duration: job.duration,
      error: job.error,
      retry_count: int(job.retryCount),
      job_dir: job.jobDir,
      first_frame_path: job.firstFramePath,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      started_at: job.startedAt,
      finished_at: job.finishedAt,
      raw_json: json(job)
    }));
  }

  sql.push("COMMIT;");
  sql.push("PRAGMA foreign_keys = ON;");
  runSql(sql.join("\n"));

  const counts = queryCounts();
  console.log(`SQLite synced: ${dbPath}`);
  for (const [table, count] of counts) {
    console.log(`${table}: ${count}`);
  }
}

function appendTikTokComments(sql, record, result) {
  const items = Array.isArray(record.items) ? record.items : [];
  items.forEach((item, index) => {
    const resultId = record.resultId || result?.id || "";
    const idSeed = `${resultId || normalizeVideoUrl(record.sourceUrl)}:${index + 1}:${item.id || item.text || ""}`;
    sql.push(insert("tiktok_comments", {
      id: stableId(idSeed),
      result_id: resultId,
      app_id: record.appId || result?.appId || result?.app?.id,
      source_url: record.sourceUrl || result?.sourceUrl,
      normalized_url: record.normalizedUrl || normalizeVideoUrl(record.sourceUrl || result?.sourceUrl),
      video_title: record.videoTitle || result?.title,
      author: item.author,
      text: item.text,
      raw_text: item.rawText,
      like_count: int(item.likeCount),
      like_text: item.likeText,
      time_text: item.timeText,
      reply_count: int(item.replyCount),
      reply_count_text: item.replyCountText,
      language: item.language,
      captured_at: record.capturedAt,
      imported_at: record.importedAt,
      updated_at: record.updatedAt,
      raw_json: json({ ...item, sourceRecordId: record.id || "", resultId })
    }));
  });
}

function readSensorRows(record) {
  const csvFile = resolvePublicPath(record.csvPath);
  if (csvFile && fs.existsSync(csvFile)) {
    const csvText = decodeCsvBuffer(fs.readFileSync(csvFile));
    return parseCsvObjects(csvText);
  }
  const parsedPath = resolvePublicPath(record.parsedPath);
  if (parsedPath && fs.existsSync(parsedPath)) {
    return readJsonFile(parsedPath).sampleRows || [];
  }
  return [];
}

function decodeCsvBuffer(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return swapUtf16Bytes(buffer.subarray(2)).toString("utf16le");
  }
  const utf8 = buffer.toString("utf8");
  if (utf8.includes("\u0000")) {
    return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  }
  return utf8.replace(/^\uFEFF/, "");
}

function swapUtf16Bytes(buffer) {
  const swapped = Buffer.alloc(buffer.length);
  for (let index = 0; index < buffer.length; index += 2) {
    swapped[index] = buffer[index + 1] || 0;
    swapped[index + 1] = buffer[index] || 0;
  }
  return swapped;
}

function parseCsvObjects(text) {
  const rows = parseCsvRows(text);
  const headers = rows[0] || [];
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header || `col_${index + 1}`, row[index] || ""])));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const source = String(text || "");
  const delimiter = detectCsvDelimiter(source);
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((cell) => cell !== "")) {
    rows.push(row);
  }
  return rows;
}

function detectCsvDelimiter(text) {
  const firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? "\t" : ",";
}

function feedbackPlatformFor(record, row) {
  const os = normalize(record.filters?.os);
  if (os === "ios") {
    return "app_store";
  }
  if (os === "android") {
    return "google_play";
  }
  const appId = normalize(pick(row, "App ID") || record.appId);
  if (/^\d+$/.test(appId)) {
    return "app_store";
  }
  if (/^[a-z][\w]*(\.[a-z][\w]*)+$/i.test(appId)) {
    return "google_play";
  }
  return os || "";
}

function readJsonArray(filename) {
  const fullPath = path.join(dataDir, filename);
  if (!fs.existsSync(fullPath)) {
    return [];
  }
  const parsed = readJsonFile(fullPath);
  return Array.isArray(parsed) ? parsed : [];
}

function readJsonFile(fullPath) {
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function buildCategoryRankingSnapshotState(sensorImports = []) {
  const latestByKey = new Map();
  const linksById = new Map();
  for (const record of sensorImports) {
    if (!(normalize(record.dataType) === "category_rankings" || record.categoryRanking)) {
      continue;
    }
    const key = categoryRankingSnapshotKey(record);
    if (!key) {
      continue;
    }
    const existing = latestByKey.get(key);
    if (!existing || dateSortValue(record.importedAt || record.categoryRanking?.importedAt) > dateSortValue(existing.record.importedAt || existing.record.categoryRanking?.importedAt)) {
      latestByKey.set(key, { key, record });
    }
    const appId = normalize(record.appId || record.app?.id);
    if (!appId) {
      continue;
    }
    const linkId = `${appId}:${key}`;
    const existingLink = linksById.get(linkId);
    const linkedAt = normalize(record.categoryRankingLink?.linkedAt || record.importedAt || record.categoryRanking?.importedAt);
    if (!existingLink || dateSortValue(linkedAt) > dateSortValue(existingLink.linkedAt)) {
      linksById.set(linkId, {
        appId,
        key,
        customFieldsFilterId: normalize(record.categoryRanking?.customFieldsFilterId || record.filters?.customFieldsFilterId || extractSearchParam(record.categoryRanking?.sourceUrl || record.sourceUrl, "custom_fields_filter_id")),
        source: normalize(record.categoryRankingLink?.source) || "captured",
        linkedAt,
        latestImportId: record.id,
        raw: record.categoryRankingLink || { appId, snapshotKey: key, source: "captured", linkedAt }
      });
    }
  }
  return {
    snapshots: Array.from(latestByKey.values()),
    links: Array.from(linksById.values())
  };
}

function categoryRankingSnapshotKey(record = {}) {
  const meta = record.categoryRanking && typeof record.categoryRanking === "object" ? record.categoryRanking : {};
  const filters = record.filters || {};
  if (meta.snapshotKey || record.categoryRankingSnapshotKey) {
    return normalize(meta.snapshotKey || record.categoryRankingSnapshotKey);
  }
  const customFieldsFilterId = normalize(meta.customFieldsFilterId || filters.customFieldsFilterId || extractSearchParam(meta.sourceUrl || record.sourceUrl, "custom_fields_filter_id"));
  const dateRange = meta.dateRange || record.dateRange || {};
  const parts = [
    customFieldsFilterId,
    normalize(meta.metric || record.metric || "revenue"),
    normalize(meta.sort || filters.comparisonAttribute || "absolute"),
    normalize(dateRange.start),
    normalize(dateRange.end),
    normalize(dateRange.duration),
    canonicalCountryKey(meta.countries || filters.countries || []),
    canonicalListKey(meta.devices || filters.devices || []),
    normalize(meta.os || filters.os || "unified")
  ];
  return parts[0] ? parts.join("|") : "";
}

function canonicalCountryKey(countries = []) {
  const values = asArray(countries).map((item) => normalize(item).toUpperCase()).filter(Boolean);
  if (!values.length) return "";
  if (values.includes("ALL") || values.length >= 50) return "all";
  return Array.from(new Set(values)).sort().join(",");
}

function canonicalListKey(values = []) {
  return Array.from(new Set(asArray(values).map((item) => normalize(item).toLowerCase()).filter(Boolean))).sort().join(",");
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function extractSearchParam(sourceUrl, name) {
  try {
    return new URL(sourceUrl).searchParams.get(name) || "";
  } catch {
    return "";
  }
}

function dateSortValue(value) {
  const text = normalize(value);
  if (!text) return 0;
  const parsed = Date.parse(text.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolvePublicPath(publicPath) {
  const value = normalize(publicPath);
  if (!value) {
    return "";
  }
  if (path.isAbsolute(value) && fs.existsSync(value)) {
    return value;
  }
  return path.join(rootDir, value.replace(/^\/+/, ""));
}

function queryCounts() {
  const output = execFileSync("sqlite3", [dbPath, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"], { encoding: "utf8" });
  return output.trim().split(/\n/).filter(Boolean).map((table) => {
    const count = execFileSync("sqlite3", [dbPath, `SELECT COUNT(*) FROM ${table};`], { encoding: "utf8" }).trim();
    return [table, count];
  });
}

function runSql(sql) {
  execFileSync("sqlite3", [dbPath], { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
}

function insert(table, values) {
  const entries = Object.entries(values);
  const columns = entries.map(([key]) => quoteIdentifier(key)).join(", ");
  const sqlValues = entries.map(([, value]) => sqlValue(value)).join(", ");
  return `INSERT OR REPLACE INTO ${quoteIdentifier(table)} (${columns}) VALUES (${sqlValues});`;
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function sqlValue(value) {
  if (value === null || value === undefined || value === "") {
    return "NULL";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function bool(value) {
  return value ? 1 : 0;
}

function int(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function num(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const normalized = String(value).replace(/[$,%]/g, "").replace(/,/g, "").trim();
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalize(value) {
  return String(value ?? "").trim();
}

function pick(row, key) {
  return normalize(row?.[key]);
}

function normalizeVideoUrl(url) {
  const text = normalize(url);
  if (!text) {
    return "";
  }
  try {
    const parsed = new URL(text);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return text;
  }
}

function extractTikTokAuthor(url) {
  const text = normalize(url);
  const match = text.match(/tiktok\.com\/@([^/?#]+)/i);
  return match ? `@${match[1]}` : "";
}

function extractHashtags(text) {
  const matches = String(text || "").match(/#[^\s#]+/gu) || [];
  return [...new Set(matches
    .map((item) => trimHashtag(item))
    .filter((item) => item.length > 1))];
}

function trimHashtag(value) {
  const trailing = new Set(["，", ",", "。", ".", "!", "！", "?", "？", ":", "：", ";", "；", ")", "）", "]", "】", "\"", "'", "”", "’"]);
  let text = String(value || "").trim();
  while (text && trailing.has(text[text.length - 1])) {
    text = text.slice(0, -1).trim();
  }
  return text;
}

function stableId(seed) {
  let hash = 5381;
  const text = normalize(seed);
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return `c_${Math.abs(hash >>> 0).toString(36)}`;
}
