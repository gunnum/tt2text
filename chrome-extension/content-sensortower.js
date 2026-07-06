function collectSensorTowerPage() {
  const pageText = normalizeText(document.body?.innerText || "");
  const title = normalizeText(document.title || "");
  const selectedApp = detectSelectedSensorTowerApp();
  const appIqLink = detectAppIqLink();
  const appStoreIds = detectSensorTowerAppStoreIds();
  const headings = Array.from(document.querySelectorAll("h1, h2, [data-testid*='title' i], [class*='title' i]"))
    .map((node) => normalizeText(node.innerText || node.textContent || ""))
    .filter(Boolean);

  return {
    appName: selectedApp.name || detectAppName({ title, headings, pageText }),
    appDeveloper: selectedApp.developer || "",
    appEntityLabel: selectedApp.label || "",
    appStoreIds,
    appIqLink,
    title,
    url: location.href,
    capturedAt: new Date().toISOString(),
    filters: collectFilters(),
    metrics: collectMetrics(),
    tables: collectTables(),
    pageText: pageText.slice(0, 60000)
  };
}

function detectSensorTowerAppStoreIds() {
  const hrefs = Array.from(document.querySelectorAll("a[href]"))
    .map((node) => node.getAttribute("href") || "")
    .filter(Boolean);
  const html = document.documentElement?.innerHTML || "";
  return {
    androidPackageId: extractAndroidPackageId([...hrefs, location.href, html]),
    iosAppId: extractIosAppId([...hrefs, location.href, html])
  };
}

function extractAndroidPackageId(values) {
  const joined = values.map((value) => safeDecodeURIComponent(value)).join(" ");
  const paramMatch = joined.match(/(?:^|[?&\s"'\\])(?:saa|ssaa|android[_-]?(?:app[_-]?)?(?:id|package)|package[_-]?name|bundle[_-]?id)["'\\\s:=?&]*([a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,})/i);
  if (paramMatch) {
    return cleanAndroidPackageId(paramMatch[1]);
  }
  const playMatch = joined.match(/play\.google\.com\/store\/apps\/details[^"'<> ]*?[?&]id=([a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,})/i);
  if (playMatch) {
    return cleanAndroidPackageId(playMatch[1]);
  }
  const sensorMatch = joined.match(/\bcom\.[a-z0-9_]+(?:\.[a-z0-9_]+){1,}\b/i);
  return sensorMatch ? cleanAndroidPackageId(sensorMatch[0]) : "";
}

function cleanAndroidPackageId(value) {
  return String(value || "")
    .replace(/\\u002e/gi, ".")
    .replace(/[^\w.].*$/, "")
    .trim();
}

function extractIosAppId(values) {
  const joined = values.map((value) => safeDecodeURIComponent(value)).join(" ");
  const paramMatch = joined.match(/(?:^|[?&\s"'\\])(?:sia|ssia|ios[_-]?(?:app[_-]?)?id)["'\\\s:=?&]*(\d{8,12})/i);
  if (paramMatch) {
    return paramMatch[1];
  }
  const storeMatch = joined.match(/apps\.apple\.com\/[^"'<> ]*\/id(\d{8,12})/i);
  return storeMatch?.[1] || "";
}

function detectAppIqLink() {
  const candidates = Array.from(document.querySelectorAll("a[href]"))
    .map((node) => buildAppIqCandidate(node))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
  const appIq = candidates[0];
  if (appIq) {
    return appIq.value;
  }
  return detectAppIqLinkFromHtml();
}

function buildAppIqCandidate(node) {
  const rawHref = node.getAttribute("href") || "";
  const label = normalizeText([
    node.innerText || node.textContent || "",
    node.getAttribute("aria-label") || "",
    node.getAttribute("title") || ""
  ].join(" "));
  if (!/custom_fields_filter_id|\/market-analysis\/top-apps/i.test(rawHref + " " + label)) {
    return null;
  }
  try {
    const url = new URL(rawHref, location.href);
    const customFieldsFilterId = url.searchParams.get("custom_fields_filter_id") || extractCustomFieldsFilterId(rawHref);
    let score = 0;
    if (customFieldsFilterId) score += 100;
    if (/\/market-analysis\/top-apps/i.test(url.pathname)) score += 50;
    if (/app\s*iq/i.test(label)) score += 40;
    if (/nutrition|diet|health|fitness|category|类别|品类/i.test(label)) score += 20;
    if (isVisibleElement(node)) score += 10;
    return {
      score,
      value: {
        label: label || "App IQ",
        href: url.toString(),
        customFieldsFilterId,
        source: "anchor"
      }
    };
  } catch {
    return null;
  }
}

function detectAppIqLinkFromHtml() {
  const html = document.documentElement?.innerHTML || "";
  const customFieldsFilterId = extractCustomFieldsFilterId(html);
  if (!customFieldsFilterId) {
    return null;
  }
  const url = new URL("/market-analysis/top-apps", location.origin);
  url.searchParams.set("custom_fields_filter_id", customFieldsFilterId);
  return {
    label: "App IQ",
    href: url.toString(),
    customFieldsFilterId,
    source: "html"
  };
}

function extractCustomFieldsFilterId(value) {
  const text = String(value || "");
  const decoded = safeDecodeURIComponent(text);
  const match = decoded.match(/custom_fields_filter_id["'\\\s:=?&%]*([a-f0-9]{24})/i)
    || text.match(/custom_fields_filter_id(?:%3D|=|\\u003d|\\x3d)([a-f0-9]{24})/i);
  return match?.[1] || "";
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return String(value || "");
  }
}

function collectSensorTowerOverview() {
  const base = collectSensorTowerPage();
  const lines = getVisibleTextLines();
  const cards = collectOverviewCards();
  return {
    ...base,
    dataType: "overview",
    overview: {
      category: extractValueAfterLabel(lines, ["类别", "Category"]),
      appIq: extractValueAfterLabel(lines, ["App IQ"]),
      monetization: splitListValue(extractValueAfterLabel(lines, ["变现分析", "Monetization"])),
      topCountries: extractTopCountries(lines),
      topCountriesByPlatform: extractTopCountriesByPlatform(lines, cards),
      globalReleaseDate: extractInlineDate(lines, ["全球发布", "Global Release"]),
      inAppPurchases: extractInAppPurchases(lines, cards),
      screenshots: extractIphoneScreenshots(),
      description: extractDescription(lines),
      featureKeywords: extractFeatureKeywords(lines),
      cards
    }
  };
}

async function collectSensorTowerOverviewWithMedia() {
  const initial = collectSensorTowerOverview();
  if (initial.overview?.screenshots?.length) {
    return initial;
  }
  await revealOverviewMedia();
  return collectSensorTowerOverview();
}

async function revealOverviewMedia() {
  const originalX = window.scrollX;
  const originalY = window.scrollY;
  const maxY = Math.max(
    document.body?.scrollHeight || 0,
    document.documentElement?.scrollHeight || 0
  );
  const viewport = Math.max(window.innerHeight || 800, 600);
  const steps = [];
  for (let y = 0; y <= maxY; y += Math.round(viewport * 0.8)) {
    steps.push(y);
  }
  steps.push(maxY);

  for (const y of Array.from(new Set(steps))) {
    window.scrollTo({ top: y, left: 0, behavior: "instant" });
    await sleep(450);
    if (extractIphoneScreenshots().length) {
      break;
    }
  }
  await sleep(300);
  window.scrollTo({ top: originalY, left: originalX, behavior: "instant" });
}

function detectSelectedSensorTowerApp() {
  const roots = Array.from(document.querySelectorAll([
    '[data-test*="SelectEntityButton"]',
    '[class*="SelectEntityButton"][role="button"]',
    '[class*="SelectEntityButton"][data-test]'
  ].join(","))).filter(isVisibleElement);

  for (const root of roots) {
    const names = root.querySelector('[class*="SelectEntityButton-module__names"]')
      || root.querySelector('[class*="SelectEntityButton"][class*="names"]');
    const nameLines = Array.from((names || root).querySelectorAll("p"))
      .filter(isVisibleElement)
      .map(readElementLabel)
      .map(normalizeText)
      .filter(Boolean);

    const name = cleanAppCandidate(nameLines[0] || "");
    if (!name) {
      continue;
    }
    const developer = cleanDeveloperCandidate(nameLines.find((value) => cleanAppCandidate(value) !== name) || "");
    return {
      name,
      developer,
      label: nameLines.join(" / ") || normalizeText(root.innerText || root.textContent || "")
    };
  }

  return { name: "", developer: "", label: "" };
}

function detectAppName({ title, headings, pageText }) {
  const candidates = [
    ...headings,
    title.replace(/\s*[-|]\s*Sensor Tower.*$/i, ""),
    ...extractNameCandidates(pageText)
  ];

  return candidates
    .map(cleanAppCandidate)
    .find((candidate) => candidate && candidate.length >= 2 && candidate.length <= 80) || "";
}

function extractNameCandidates(text) {
  const lines = text.split(/\n+/).map(normalizeText).filter(Boolean);
  const appIndex = lines.findIndex((line) => /^(app|应用|apps)$/i.test(line));
  if (appIndex >= 0) {
    return lines.slice(appIndex + 1, appIndex + 4);
  }
  return lines.slice(0, 8);
}

function cleanAppCandidate(value) {
  return normalizeText(value)
    .replace(/\s*[-|]\s*(Sensor Tower|Overview|Store Intelligence|App Intelligence).*$/i, "")
    .replace(/^(App|应用)\s*[:：]\s*/i, "")
    .split(/\s+-\s+/)[0]
    .split("：")[0]
    .split(":")[0]
    .trim();
}

function cleanDeveloperCandidate(value) {
  return normalizeText(value)
    .replace(/^(developer|dev|开发者)\s*[:：]\s*/i, "")
    .trim();
}

function readElementLabel(node) {
  return node.getAttribute?.("aria-label")
    || node.getAttribute?.("title")
    || node.getAttribute?.("label")
    || node.innerText
    || node.textContent
    || "";
}

function isLikelyAppName(value) {
  const text = normalizeText(value);
  return text.length >= 2 && text.length <= 80 && !isLikelyUiLabel(text);
}

function isLikelyUiLabel(value) {
  return /^(报告|评论|完成|添加应用|app store|google play|sensor tower|应用分析|市场分析|商店营销|所有评分|任意情绪|最近|国家|地区)$/i.test(normalizeText(value));
}

function isVisibleElement(node) {
  const rect = node.getBoundingClientRect?.();
  const style = window.getComputedStyle?.(node);
  return Boolean(rect && rect.width > 0 && rect.height > 0 && style?.visibility !== "hidden" && style?.display !== "none");
}

function collectFilters() {
  return Array.from(document.querySelectorAll("button, [role='button'], select"))
    .map((node) => normalizeText(node.innerText || node.textContent || node.value || ""))
    .filter((text) => text && text.length <= 80)
    .slice(0, 80);
}

function collectMetrics() {
  const nodes = Array.from(document.querySelectorAll("[aria-label], [data-testid], [class*='metric' i], [class*='stat' i], [class*='kpi' i]"));
  const metrics = [];

  for (const node of nodes) {
    const text = normalizeText(node.innerText || node.textContent || "");
    if (!text || text.length > 240 || !/[0-9$%]/.test(text)) {
      continue;
    }
    const parts = text.split(/\n+/).map(normalizeText).filter(Boolean);
    if (parts.length >= 2) {
      metrics.push({ label: parts[0], value: parts.slice(1).join(" ") });
    } else {
      metrics.push({ label: node.getAttribute("aria-label") || "Metric", value: text });
    }
  }

  return dedupeMetrics(metrics).slice(0, 80);
}

function collectTables() {
  return Array.from(document.querySelectorAll("table")).map((table) => {
    const headers = Array.from(table.querySelectorAll("thead th, tr:first-child th"))
      .map((cell) => normalizeText(cell.innerText || cell.textContent || ""))
      .filter(Boolean);
    const rows = Array.from(table.querySelectorAll("tbody tr, tr"))
      .slice(headers.length ? 0 : 1)
      .map((row) => Array.from(row.querySelectorAll("th, td"))
        .map((cell) => normalizeText(cell.innerText || cell.textContent || ""))
        .filter(Boolean))
      .filter((row) => row.length);
    return {
      caption: normalizeText(table.caption?.innerText || ""),
      headers,
      rows: rows.slice(0, 40)
    };
  }).filter((table) => table.headers.length || table.rows.length).slice(0, 12);
}

function dedupeMetrics(metrics) {
  const seen = new Set();
  return metrics.filter((item) => {
    const key = `${item.label}::${item.value}`.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "TT2TEXT_CLICK_SENSOR_TOWER_CSV_EXPORT") {
    clickSensorTowerCsvExport(message.captureId)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "TT2TEXT_COLLECT_SENSOR_TOWER_OVERVIEW") {
    collectSensorTowerOverviewWithMedia()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type !== "TT2TEXT_COLLECT_SENSOR_TOWER") {
    return false;
  }

  try {
    sendResponse({ ok: true, payload: collectSensorTowerPage() });
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
  return true;
});

async function clickSensorTowerCsvExport(captureId) {
  const before = collectSensorTowerPage();
  const noData = detectNoDownloadableData();
  if (noData) {
    return {
      ...before,
      dataType: detectSensorTowerDataType(location.href, document.title, document.body?.innerText || ""),
      exportTriggeredAt: new Date().toISOString(),
      noData: true,
      noDataReason: noData.reason,
      exportDebug: {
        clickedControls: [],
        visibleExportControls: collectVisibleExportControlLabels(),
        noDataText: noData.text
      },
      capturedCsv: null
    };
  }
  const exportControl = await waitForSensorTowerExportControl(20000);
  if (!exportControl) {
    throw new Error("没有找到 Sensor Tower 导出按钮。请确认当前页面右上角能看到 Export/CSV。");
  }
  if (isDisabledControl(exportControl)) {
    return {
      ...before,
      dataType: detectSensorTowerDataType(location.href, document.title, document.body?.innerText || ""),
      exportTriggeredAt: new Date().toISOString(),
      noData: true,
      noDataReason: "导出 CSV 按钮不可用，当前筛选条件下可能没有可下载数据。",
      exportDebug: {
        clickedControls: [],
        visibleExportControls: collectVisibleExportControlLabels(),
        disabledExportControl: readControlDebugLabel(exportControl)
      },
      capturedCsv: null
    };
  }

  const csvCapture = installCsvBlobCapture(captureId);
  const clickedControls = [];
  clickedControls.push(readControlDebugLabel(exportControl));
  exportControl.click();
  await sleep(900);

  const csvControl = await waitForSensorTowerCsvControl(8000);
  if (csvControl && csvControl !== exportControl) {
    clickedControls.push(readControlDebugLabel(csvControl));
    csvControl.click();
  } else if (isTopAppsPage()) {
    const fallback = await clickLikelyTopAppsDownloadControl(exportControl, clickedControls);
    if (!fallback) {
      throw new Error("已打开同品类排行导出菜单，但没有找到 CSV 下载选项。");
    }
  }

  const capturedCsv = await csvCapture.wait(isTopAppsPage() ? 24000 : 12000).catch(() => null);

  return {
    ...before,
    dataType: detectSensorTowerDataType(location.href, document.title, document.body?.innerText || ""),
    exportTriggeredAt: new Date().toISOString(),
    exportDebug: {
      clickedControls,
      visibleExportControls: collectVisibleExportControlLabels()
    },
    capturedCsv
  };
}

async function waitForSensorTowerExportControl(timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const control = findSensorTowerExportControl();
    if (control) {
      return control;
    }
    await sleep(500);
  }
  return null;
}

async function waitForSensorTowerCsvControl(timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const control = findSensorTowerCsvControl();
    if (control) {
      return control;
    }
    await sleep(250);
  }
  return null;
}

async function clickLikelyTopAppsDownloadControl(exportControl, clickedControls) {
  const attempts = [
    () => findSensorTowerCsvControl(),
    () => findControlByText(/download\s+csv|csv\s+download|export\s+csv|csv|下载\s*csv|导出\s*csv/i, { menuOnly: true }),
    () => findControlByText(/download|export|下载|导出/i, { menuOnly: true }),
    () => findControlByText(/download|export|下载|导出/i, { exclude: exportControl })
  ];
  for (const findControl of attempts) {
    const control = findControl();
    if (!control || control === exportControl || !isVisibleElement(control)) {
      continue;
    }
    clickedControls.push(readControlDebugLabel(control));
    control.click();
    await sleep(1200);
    return true;
  }
  return false;
}

function installCsvBlobCapture(captureId) {
  const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
  const originalClick = HTMLAnchorElement.prototype.click;
  const captures = [];
  let resolved = false;
  let resolveCapture;
  const done = new Promise((resolve) => {
    resolveCapture = resolve;
  });
  const onPageMessage = (event) => {
    if (event.source !== window || event.data?.source !== "tt2text-sensortower-csv-capture") {
      return;
    }
    if (captureId && event.data.captureId !== captureId) {
      return;
    }
    pushCapture(event.data.payload || {});
  };
  window.addEventListener("message", onPageMessage);

  URL.createObjectURL = function patchedCreateObjectURL(object) {
    const objectUrl = originalCreateObjectUrl(object);
    if (object instanceof Blob && looksLikeCsvBlob(object)) {
      readCsvBlob(object, objectUrl, "").then(pushCapture).catch(() => {});
    }
    return objectUrl;
  };

  HTMLAnchorElement.prototype.click = function patchedAnchorClick() {
    const href = this.href || "";
    const filename = this.download || "";
    const last = captures[captures.length - 1];
    if ((last?.contentBase64 || last?.contentText) && (!last.filename || filename)) {
      last.filename = filename || last.filename;
      pushCapture(last);
      return undefined;
    } else if (href.startsWith("blob:")) {
      fetch(href)
        .then((response) => response.blob())
        .then((blob) => readCsvBlob(blob, href, filename))
        .then(pushCapture)
        .catch(() => pushCapture({ objectUrl: href, filename, pendingBlobUrlOnly: true }));
      return undefined;
    }
    return originalClick.apply(this, arguments);
  };

  function pushCapture(payload) {
    const item = { ...payload };
    captures.push(item);
    if (!resolved && (item.contentBase64 || item.contentText)) {
      resolved = true;
      cleanup();
      resolveCapture(item);
    }
  }

  function cleanup() {
    window.removeEventListener("message", onPageMessage);
    URL.createObjectURL = originalCreateObjectUrl;
    HTMLAnchorElement.prototype.click = originalClick;
  }

  return {
    wait(timeoutMs) {
      return Promise.race([
        done,
        sleep(timeoutMs).then(() => {
          cleanup();
          return null;
        })
      ]);
    }
  };
}

async function readCsvBlob(blob, objectUrl, filename = "") {
  const buffer = await blob.arrayBuffer();
  return {
    filename: filename || "sensortower.csv",
    mime: blob.type || "",
    objectUrl,
    totalBytes: blob.size || buffer.byteLength,
    contentBase64: arrayBufferToBase64(buffer)
  };
}

function looksLikeCsvBlob(blob) {
  const type = String(blob?.type || "").toLowerCase();
  return !type || type.includes("csv") || type.includes("text") || type.includes("octet-stream") || type.includes("excel");
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function getVisibleTextLines() {
  return (document.body?.innerText || "")
    .split(/\n+/)
    .map(normalizeText)
    .filter(Boolean);
}

function collectOverviewCards() {
  return Array.from(document.querySelectorAll("section, article, [class*='Card'], [class*='card'], [class*='Panel'], [class*='panel']"))
    .filter(isVisibleElement)
    .map((node) => normalizeText(node.innerText || node.textContent || ""))
    .filter((text) => text.length >= 8 && text.length <= 5000)
    .slice(0, 40);
}

function extractValueAfterLabel(lines, labels) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const label of labels) {
      const exact = new RegExp(`^${escapeRegExp(label)}$`, "i");
      const inline = new RegExp(`^${escapeRegExp(label)}\\s*[:：]?\\s*(.+)$`, "i");
      if (exact.test(line)) {
        return lines[index + 1] || "";
      }
      const match = line.match(inline);
      if (match?.[1]) {
        return normalizeText(match[1]);
      }
    }
  }
  return "";
}

function extractInlineDate(lines, labels) {
  const source = extractValueAfterLabel(lines, labels) || lines.find((line) => labels.some((label) => line.includes(label))) || "";
  return source.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/)?.[0] || "";
}

function extractTopCountries(lines) {
  const value = extractValueAfterLabel(lines, ["热门国家/地区", "热门国家", "Top Countries", "Top Countries/Regions"]);
  return splitListValue(value).map((item) => item.replace(/^[^\p{L}\p{N}]+/u, "").trim()).filter(Boolean);
}

function extractTopCountriesByPlatform(lines, cards) {
  return {
    ios: extractPlatformTopCountries("ios", lines, cards),
    android: extractPlatformTopCountries("android", lines, cards)
  };
}

function extractPlatformTopCountries(platform, lines, cards) {
  const pattern = platform === "ios" ? /app store|ios|iphone|ipad/i : /google play|android/i;
  const sources = [
    ...cards.filter((card) => pattern.test(card)),
    lines.join("\n")
  ];
  for (const source of sources) {
    const sourceLines = source.split(/\n+/).map(normalizeText).filter(Boolean);
    const labelIndex = sourceLines.findIndex((line) => /热门国家\/地区|热门国家|Top Countries|Top Countries\/Regions/i.test(line));
    if (labelIndex >= 0) {
      const value = sourceLines.slice(labelIndex + 1, labelIndex + 4).join(" ");
      const countries = splitListValue(value).map((item) => item.replace(/^[^\p{L}\p{N}]+/u, "").trim()).filter(Boolean);
      if (countries.length) {
        return countries.slice(0, 20);
      }
    }
  }
  return [];
}

function splitListValue(value) {
  return normalizeText(value)
    .split(/[,，、|/]+|\s{2,}/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function extractInAppPurchases(lines, cards) {
  const source = cards.find((card) => /应用内购|in-app purchases?/i.test(card)) || "";
  const sourceLines = source ? source.split(/\s{2,}|\n+/).map(normalizeText).filter(Boolean) : lines;
  const rows = [];
  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index];
    const priceMatch = line.match(/\$\s?\d+(?:\.\d{2})?/);
    if (!priceMatch) {
      continue;
    }
    const beforePrice = normalizeText(line.slice(0, priceMatch.index));
    const title = beforePrice.replace(/(一次性|月度|年度|weekly|monthly|yearly|one-time)$/i, "").trim()
      || sourceLines[index - 2]
      || sourceLines[index - 1]
      || "";
    const duration = beforePrice.match(/(一次性|月度|年度|weekly|monthly|yearly|one-time)/i)?.[0]
      || sourceLines[index - 1]
      || "";
    rows.push({
      title: normalizeText(title),
      duration: normalizeText(duration),
      price: priceMatch[0].replace(/\s+/g, "")
    });
  }
  return rows.slice(0, 40);
}

function extractIphoneScreenshots() {
  const candidates = [
    ...Array.from(document.querySelectorAll("img[src], img[srcset], source[srcset], [style*='mzstatic' i]"))
      .flatMap((node) => imageCandidatesFromNode(node)),
    ...imageCandidatesFromHtml()
  ]
    .map(normalizeAppleScreenshotUrl)
    .filter(Boolean)
    .filter((item) => isLikelyIphoneScreenshotUrl(item.imageUrl))
    .map((item) => ({
      ...item,
      platform: inferScreenshotPlatform(item.sourceNode)
    }))
    .filter((item) => item.platform !== "ipad");
  const byImage = new Map();
  for (const item of candidates) {
    if (!byImage.has(item.imageUrl)) {
      byImage.set(item.imageUrl, {
        platform: "iphone",
        thumbnailUrl: item.thumbnailUrl,
        imageUrl: item.imageUrl,
        alt: item.alt
      });
    }
  }
  return [...byImage.values()].slice(0, 12);
}

function imageCandidatesFromNode(node) {
  const values = [];
  const src = node.getAttribute("src") || "";
  if (src) values.push(src);
  const srcset = node.getAttribute("srcset") || "";
  if (srcset) {
    values.push(...srcset.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean));
  }
  const style = node.getAttribute("style") || "";
  if (style) {
    values.push(...extractUrlsFromText(style));
  }
  const alt = node.getAttribute("alt") || node.closest("[aria-label]")?.getAttribute("aria-label") || "";
  return values.map((value) => ({ url: value, alt: normalizeText(alt), sourceNode: node }));
}

function imageCandidatesFromHtml() {
  const html = document.documentElement?.innerHTML || "";
  return extractUrlsFromText(html).map((url) => ({ url, alt: "", sourceNode: null }));
}

function extractUrlsFromText(value) {
  const text = String(value || "")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
  const matches = text.match(/https?:\/\/is\d*-ssl\.mzstatic\.com\/image\/thumb\/[^"'<>\\\s)]+/gi) || [];
  return matches.map((url) => url.replace(/[),.;]+$/, ""));
}

function normalizeAppleScreenshotUrl(candidate) {
  try {
    const url = new URL(candidate.url, location.href);
    const text = url.toString();
    if (!/mzstatic\.com\/image\/thumb\//i.test(text)) {
      return null;
    }
    const normalized = text.replace(/\/(?:\d+x\d+|[0-9]+x[0-9]+bb|[0-9]+x[0-9]+sr|[0-9]+x[0-9]+-?)[^/]*\.(jpg|jpeg|png|webp)$/i, "/473x1024.jpg");
    const thumb = text.replace(/\/(?:\d+x\d+|[0-9]+x[0-9]+bb|[0-9]+x[0-9]+sr|[0-9]+x[0-9]+-?)[^/]*\.(jpg|jpeg|png|webp)$/i, "/370x800.jpg");
    return {
      imageUrl: normalized,
      thumbnailUrl: thumb,
      alt: candidate.alt,
      sourceNode: candidate.sourceNode
    };
  } catch {
    return null;
  }
}

function isLikelyIphoneScreenshotUrl(url) {
  const text = String(url || "");
  if (!/mzstatic\.com\/image\/thumb\//i.test(text)) return false;
  if (/\/(?:512x512|100x100|60x60)[^/]*\.(?:jpg|jpeg|png|webp)$/i.test(text)) return false;
  if (/AppIcon|icon|artwork/i.test(text)) return false;
  if (/\/PurpleSource[^/]*\/v\d+\/.+\/\d+\.png\//i.test(text)) return true;
  return /\/(?:\d+\.png|[a-f0-9-]{16,}\.png)\//i.test(text) && /\/473x1024\.jpg$/i.test(text);
}

function inferScreenshotPlatform(node) {
  const context = normalizeText([
    node?.getAttribute?.("alt") || "",
    node?.closest?.("[aria-label]")?.getAttribute("aria-label") || "",
    node?.closest?.("section, article, [class*='card' i], [class*='panel' i]")?.innerText || ""
  ].join(" "));
  if (/ipad/i.test(context)) return "ipad";
  return "iphone";
}

function extractDescription(lines) {
  const start = lines.findIndex((line) => /^(描述|说明|Description|About)$/i.test(line));
  if (start < 0) {
    return "";
  }
  const stopLabels = /^(版本|评分|排名|应用内购|热门|截图|发行商|隐私|数据安全|相似应用|Version|Ratings|Rank|In-App|Screenshots)$/i;
  const parts = [];
  for (let index = start + 1; index < lines.length && parts.length < 80; index += 1) {
    if (stopLabels.test(lines[index])) {
      break;
    }
    parts.push(lines[index]);
  }
  return truncateText(parts.join("\n"), 12000);
}

function extractFeatureKeywords(lines) {
  const description = extractDescription(lines);
  const source = description || lines.join(" ");
  return Array.from(new Set(source
    .split(/[。.!?；;,\n]+/)
    .map(normalizeText)
    .filter((item) => item.length >= 8 && item.length <= 120)
    .filter((item) => /match|chat|friend|date|dating|language|global|voice|video|ai|社交|聊天|朋友|匹配|约会|语言|全球|视频|语音|翻译/i.test(item))
  )).slice(0, 30);
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSensorTowerExportControl() {
  const controls = getClickableControls();
  return controls.find((node) => {
    const text = readControlDebugLabel(node);
    return /csv/i.test(text) && /(export|download|导出|下载|csv)/i.test(text);
  }) || controls.find((node) => {
    const text = readControlDebugLabel(node);
    return /(export|download|导出|下载)/i.test(text);
  }) || (isTopAppsPage() ? controls.find((node) => {
    const text = readControlDebugLabel(node);
    return /share|download|export|csv|下载|导出/i.test(text)
      || node.querySelector?.("svg,[class*='download' i],[class*='export' i],[data-testid*='download' i],[data-testid*='export' i]");
  }) : null);
}

function detectNoDownloadableData() {
  const pageText = normalizeText(document.body?.innerText || "");
  const noDataPatterns = [
    /选定的筛选条件下无数据可用/i,
    /没有足够的[^。.!?\n]*数据/i,
    /没有足够的数据/i,
    /无数据可用/i,
    /no data available/i,
    /not enough data/i,
    /insufficient data/i,
    /no .*data/i
  ];
  const matched = noDataPatterns.find((pattern) => pattern.test(pageText));
  if (matched) {
    const lines = pageText.split(/\s{2,}|\n+/).map(normalizeText).filter(Boolean);
    const line = lines.find((item) => noDataPatterns.some((pattern) => pattern.test(item))) || "";
    return {
      reason: "当前筛选条件下无数据可下载。",
      text: line || matched.source
    };
  }
  return null;
}

function getClickableControls() {
  return Array.from(document.querySelectorAll([
    "button",
    "a",
    "[role='button']",
    "[role='menuitem']",
    "[aria-label]",
    "[title]",
    "[data-testid]",
    "[data-test]"
  ].join(","))).filter(isVisibleElement);
}

function isDisabledControl(node) {
  const label = readControlDebugLabel(node);
  return node.disabled === true
    || node.getAttribute?.("disabled") != null
    || node.getAttribute?.("aria-disabled") === "true"
    || /\bdisabled\b|Mui-disabled|is-disabled|--disabled/i.test(label);
}

function readControlDebugLabel(node) {
  return normalizeText([
    node.innerText,
    node.textContent,
    node.getAttribute?.("aria-label"),
    node.getAttribute?.("title"),
    node.getAttribute?.("download"),
    node.getAttribute?.("data-testid"),
    node.getAttribute?.("data-test"),
    node.className && typeof node.className === "string" ? node.className : ""
  ].filter(Boolean).join(" "));
}

function findControlByText(pattern, options = {}) {
  const controls = getClickableControls();
  return controls.find((node) => {
    if (options.exclude && node === options.exclude) {
      return false;
    }
    if (options.menuOnly && !isMenuLikeControl(node)) {
      return false;
    }
    return pattern.test(readControlDebugLabel(node));
  });
}

function findSensorTowerCsvControl() {
  return getClickableControls().find((node) => {
    const text = readControlDebugLabel(node);
    return /csv/i.test(text) && (!isTopAppsPage() || isMenuLikeControl(node) || /download|export|下载|导出/i.test(text));
  });
}

function isMenuLikeControl(node) {
  const role = node.getAttribute?.("role") || "";
  return /menuitem|option/i.test(role)
    || Boolean(node.closest?.("[role='menu'],[role='listbox'],[class*='menu' i],[class*='popover' i],[class*='dropdown' i],[class*='tooltip' i]"));
}

function collectVisibleExportControlLabels() {
  return getClickableControls()
    .map(readControlDebugLabel)
    .filter((label) => /csv|download|export|share|下载|导出/i.test(label))
    .slice(0, 30);
}

function isTopAppsPage() {
  return /\/market-analysis\/top-apps/i.test(location.pathname);
}

function detectSensorTowerDataType(url, title, pageText) {
  const source = `${url || ""} ${title || ""} ${pageText || ""}`.toLowerCase();
  if (/\/market-analysis\/top-apps/.test(source)) return "category_rankings";
  if (/reviews/.test(source)) return "reviews";
  if (/active-users/.test(source)) return "active_users";
  if (/download/.test(source)) return "downloads";
  if (/revenue|sales/.test(source)) return "revenue";
  if (/active|usage|engagement|retention|session/.test(source)) return "active_usage";
  if (/rank/.test(source)) return "rankings";
  return "unknown_metric";
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
