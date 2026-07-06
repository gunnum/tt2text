function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => {
          const text = normalizeText(item);
          return item != null && !(typeof item === "string" && !text);
        })
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableJson(item)])
    );
  }
  return value;
}

export function normalizeSensorTowerUrlForDedupe(value = "") {
  const sourceUrl = normalizeText(value);
  if (!sourceUrl) return "";
  try {
    const url = new URL(sourceUrl);
    const entries = Array.from(url.searchParams.entries())
      .map(([key, item]) => [normalizeText(key), normalizeText(item)])
      .filter(([key, item]) => key && item)
      .sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
    const search = new URLSearchParams(entries);
    return `${url.origin}${url.pathname}?${search.toString()}`;
  } catch {
    return sourceUrl;
  }
}

export function buildSensorTowerCsvDedupeKey(record = {}) {
  const filters = stableJson(record.filters || {});
  const dateRange = stableJson(record.dateRange || {});
  return [
    normalizeText(record.appId),
    normalizeText(record.dataType),
    normalizeSensorTowerUrlForDedupe(record.sourceUrl),
    JSON.stringify(filters),
    JSON.stringify(dateRange),
    normalizeText(record.metric),
    normalizeText(record.rowCount),
    normalizeText(record.chartId),
    normalizeText(record.contentHash)
  ].join("|");
}

export function dedupeSensorTowerCsvImports(records = []) {
  const byKey = new Map();
  const duplicates = [];
  for (const record of records) {
    const dedupeKey = buildSensorTowerCsvDedupeKey(record);
    const existing = byKey.get(dedupeKey);
    if (!existing) {
      byKey.set(dedupeKey, record);
      continue;
    }
    const existingAt = Date.parse(existing.importedAt || 0) || 0;
    const currentAt = Date.parse(record.importedAt || 0) || 0;
    if (currentAt >= existingAt) {
      duplicates.push(existing);
      byKey.set(dedupeKey, record);
    } else {
      duplicates.push(record);
    }
  }
  return {
    unique: Array.from(byKey.values()).sort((a, b) => (Date.parse(b.importedAt || 0) || 0) - (Date.parse(a.importedAt || 0) || 0)),
    duplicates
  };
}
