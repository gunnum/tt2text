export function createSensorTowerService(deps = {}) {
  const requiredDeps = [
    "normalizeText",
    "truncateText",
    "normalizeStringArray"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createSensorTowerService 缺少依赖：${dep}`);
    }
  }

  function parseSensorTowerUrl(sourceUrl) {
    const fallback = {
      appStoreId: "",
      bundleId: "",
      dataType: "unknown_metric",
      metric: "",
      dateRange: {},
      filters: {}
    };
    try {
      const parsed = new URL(sourceUrl);
      const pathText = parsed.pathname.toLowerCase();
      const activeUserMeasure = parsed.searchParams.get("active_user_measure") || "";
      const metric = parsed.searchParams.get("metric") || activeUserMeasure || parsed.searchParams.get("measure") || "";
      const isTopApps = pathText.includes("/market-analysis/top-apps");
      const dataType = isTopApps
        ? "category_rankings"
        : pathText.includes("reviews")
        ? "reviews"
        : pathText.includes("active-users")
          ? "active_users"
        : /download/i.test(metric) || pathText.includes("download")
          ? "downloads"
          : /revenue|sales/i.test(metric) || pathText.includes("revenue")
            ? "revenue"
            : /active|usage|retention|session/i.test(metric) || pathText.includes("usage")
              ? "active_usage"
              : pathText.includes("rank")
                ? "rankings"
                : "unknown_metric";
      return {
        appStoreId: parsed.searchParams.get("sia") || parsed.searchParams.get("ssia") || "",
        bundleId: parsed.searchParams.get("saa") || parsed.searchParams.get("ssaa") || "",
        dataType,
        metric,
        dateRange: {
          start: parsed.searchParams.get("start_date") || "",
          end: parsed.searchParams.get("end_date") || "",
          duration: parsed.searchParams.get("duration") || ""
        },
        filters: {
          countries: parsed.searchParams.getAll("country"),
          ratings: parsed.searchParams.getAll("rating"),
          sentiments: parsed.searchParams.getAll("sentiment"),
          languages: parsed.searchParams.getAll("language"),
          os: parsed.searchParams.get("os") || "",
          devices: parsed.searchParams.getAll("device"),
          comparisonAttribute: parsed.searchParams.get("comparison_attribute") || "",
          customFieldsFilterId: parsed.searchParams.get("custom_fields_filter_id") || "",
          customFieldsFilterMode: parsed.searchParams.get("custom_fields_filter_mode") || "",
          page: parsed.searchParams.get("page") || "",
          pageSize: parsed.searchParams.get("page_size") || "",
          duration: parsed.searchParams.get("duration") || "",
          granularity: parsed.searchParams.get("granularity") || "",
          activeUserMeasure,
          period: parsed.searchParams.get("period") || ""
        }
      };
    } catch {
      return fallback;
    }
  }

  function decodeCsvBuffer(buffer) {
    if (!Buffer.isBuffer(buffer)) {
      return String(buffer || "");
    }
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return buffer.subarray(2).toString("utf16le");
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      return decodeUtf16Be(buffer.subarray(2));
    }
    const sample = buffer.subarray(0, Math.min(buffer.length, 4000));
    const nulOdd = sample.filter((byte, index) => index % 2 === 1 && byte === 0).length;
    const nulEven = sample.filter((byte, index) => index % 2 === 0 && byte === 0).length;
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

  function parseCsvPreview(csvText) {
    const rows = parseCsvRows(csvText);
    const headers = rows[0] || [];
    const bodyRows = rows.slice(1);
    return {
      headers,
      rowCount: bodyRows.length,
      sampleRows: bodyRows.slice(0, 25).map((row) => Object.fromEntries(headers.map((header, index) => [header || `col_${index + 1}`, row[index] || ""])))
    };
  }

  function serializeCsvRows(headers = [], rows = []) {
    const safeHeaders = headers.map((header, index) => header || `col_${index + 1}`);
    return [
      safeHeaders,
      ...rows
    ].map((row) => safeHeaders.map((_, index) => escapeCsvCell(Array.isArray(row) ? row[index] : row?.[safeHeaders[index]])).join(",")).join("\n") + "\n";
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

  function escapeCsvCell(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
  }

  function extractAppStoreIdFromSensorTowerUrl(sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const candidate = [...segments].reverse().find((segment) => /^\d{8,12}$/.test(segment));
      return candidate || "";
    } catch {
      return "";
    }
  }

  function matchAppByName(apps, appName) {
    const target = normalizeAppNameForMatch(appName);
    if (!target) {
      return null;
    }

    return apps.find((app) => normalizeAppNameForMatch(app.name) === target)
      || apps.find((app) => {
        const candidate = normalizeAppNameForMatch(app.name);
        return candidate && (target.includes(candidate) || candidate.includes(target));
      })
      || null;
  }

  function normalizeAppNameForMatch(value) {
    return normalizeAppDisplayName(value)
      .replace(/\b(app|ios|android|sensor tower|sensortower)\b/gi, "")
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "")
      .toLowerCase()
      .trim();
  }

  function normalizeAppDisplayName(value) {
    const text = String(value || "").trim();
    const displayName = text
      .split(/\s*[:：]\s*|\s+[–—-]\s+|,\s+/)[0]
      .trim();
    return displayName || text;
  }

  function normalizeMetricItems(items) {
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .map((item) => ({
        label: truncateText(normalizeText(item?.label), 120),
        value: truncateText(normalizeText(item?.value), 160)
      }))
      .filter((item) => item.label || item.value)
      .slice(0, 80);
  }

  function normalizeTables(tables) {
    if (!Array.isArray(tables)) {
      return [];
    }

    return tables
      .map((table) => ({
        caption: truncateText(normalizeText(table?.caption), 120),
        headers: normalizeStringArray(table?.headers).slice(0, 20),
        rows: Array.isArray(table?.rows)
          ? table.rows
              .map((row) => normalizeStringArray(row).slice(0, 20))
              .filter((row) => row.length)
              .slice(0, 40)
          : []
      }))
      .filter((table) => table.caption || table.headers.length || table.rows.length)
      .slice(0, 12);
  }

  function normalizeSensorTowerOverview(overview) {
    if (!overview || typeof overview !== "object") {
      return null;
    }
    return {
      category: truncateText(normalizeText(overview.category), 120),
      appIq: truncateText(normalizeText(overview.appIq), 120),
      monetization: normalizeStringArray(overview.monetization).slice(0, 20),
      topCountries: normalizeStringArray(overview.topCountries).slice(0, 40),
      topCountriesByPlatform: {
        ios: normalizeStringArray(overview.topCountriesByPlatform?.ios).slice(0, 40),
        android: normalizeStringArray(overview.topCountriesByPlatform?.android).slice(0, 40)
      },
      globalReleaseDate: truncateText(normalizeText(overview.globalReleaseDate), 40),
      inAppPurchases: Array.isArray(overview.inAppPurchases)
        ? overview.inAppPurchases.map((item) => ({
            title: truncateText(normalizeText(item?.title), 160),
            duration: truncateText(normalizeText(item?.duration), 80),
            price: truncateText(normalizeText(item?.price), 40)
          })).filter((item) => item.title || item.price).slice(0, 80)
        : [],
      screenshots: Array.isArray(overview.screenshots)
        ? overview.screenshots.map((item) => ({
            platform: truncateText(normalizeText(item?.platform), 40),
            thumbnailUrl: truncateText(normalizeText(item?.thumbnailUrl), 600),
            imageUrl: truncateText(normalizeText(item?.imageUrl), 600),
            alt: truncateText(normalizeText(item?.alt), 160)
          })).filter((item) => item.imageUrl || item.thumbnailUrl).slice(0, 30)
        : [],
      description: truncateText(normalizeText(overview.description), 20000),
      featureKeywords: normalizeStringArray(overview.featureKeywords).slice(0, 80),
      cards: normalizeStringArray(overview.cards).slice(0, 60)
    };
  }

  function sanitizeMetricRawPayload(payload) {
    return {
      appName: normalizeText(payload.appName || payload.detectedAppName),
      title: normalizeText(payload.title || payload.pageTitle),
      url: normalizeText(payload.url || payload.sourceUrl),
      capturedAt: normalizeText(payload.capturedAt),
      appIqLink: normalizeAppIqLink(payload.appIqLink),
      appStoreIds: payload.appStoreIds && typeof payload.appStoreIds === "object" ? {
        androidPackageId: normalizeText(payload.appStoreIds.androidPackageId),
        iosAppId: normalizeText(payload.appStoreIds.iosAppId)
      } : null,
      overview: normalizeSensorTowerOverview(payload.overview),
      visibleTextSample: truncateText(normalizeText(payload.pageText), 5000)
    };
  }

  function normalizeAppIqLink(value) {
    if (!value || typeof value !== "object") return null;
    return {
      label: normalizeText(value.label),
      href: normalizeText(value.href),
      customFieldsFilterId: normalizeText(value.customFieldsFilterId),
      source: normalizeText(value.source)
    };
  }

  function normalizeText(value) {
    return deps.normalizeText(value);
  }

  function truncateText(value, maxLength) {
    return deps.truncateText(value, maxLength);
  }

  function normalizeStringArray(items) {
    return deps.normalizeStringArray(items);
  }

  return {
    parseSensorTowerUrl,
    decodeCsvBuffer,
    parseCsvPreview,
    parseCsvRows,
    serializeCsvRows,
    detectCsvDelimiter,
    extractAppStoreIdFromSensorTowerUrl,
    matchAppByName,
    normalizeAppNameForMatch,
    normalizeAppDisplayName,
    normalizeMetricItems,
    normalizeTables,
    normalizeSensorTowerOverview,
    sanitizeMetricRawPayload
  };
}
