import { normalizeText, setBadge, setImportStatus, sleep } from "./background-common.js";
import { collectTikTokVideoComments, showTikTokOverlay } from "./background-tiktok-comments.js";

const LOCAL_AD_SHOT_IMPORT_URL = "http://localhost:3000/api/ad-shots/import";
const LOCAL_AD_SHOT_CANDIDATES_URL = "http://localhost:3000/api/ad-shot-candidates/import";
const LOCAL_AD_SHOT_ANALYZE_URL = "http://localhost:3000/api/ad-shots/analyze";
const LOCAL_AD_SHOT_MATCH_APP_URL = "http://localhost:3000/api/ad-shots/match-app";
const LOCAL_TIKTOK_COMMENTS_URL = "http://localhost:3000/api/tiktok-comments/import";

export function canHandleAdShotsMessage(message) {
  return [
    "TT2TEXT_IMPORT_AD_SHOTS_CURRENT_TAB",
    "TT2TEXT_IMPORT_TIKTOK_DETAIL_SHOT",
    "TT2TEXT_IMPORT_TIKTOK_DETAIL_SHOT_WITH_COMMENTS",
    "TT2TEXT_SUGGEST_AD_SHOT_APP"
  ].includes(message?.type);
}

export async function handleAdShotsMessage(message) {
  if (message?.type === "TT2TEXT_SUGGEST_AD_SHOT_APP") {
    return suggestAdShotApp(message.payload);
  }
  if (message?.type === "TT2TEXT_IMPORT_TIKTOK_DETAIL_SHOT") {
    return importTikTokDetailShot(message.payload);
  }
  if (message?.type === "TT2TEXT_IMPORT_TIKTOK_DETAIL_SHOT_WITH_COMMENTS") {
    return importTikTokDetailShotWithComments(message.payload);
  }
  return importAdShotsFromCreativeCenter(message.payload);
}

async function importAdShotsFromCreativeCenter(payload = {}) {
  const tab = await resolveCreativeCenterTab(payload.tabId);
  await setImportStatus({
    state: "running",
    message: "正在采集 TikTok Creative Center 当前页面...",
    tabId: tab.id,
    updatedAt: new Date().toISOString()
  });
  await setBadge("ADS", "#0d6f5b");
  await waitForTabComplete(tab.id);
  await sleep(500);

  const captured = await collectCreativeCenterPage(tab.id, payload);
  const projectIds = normalizeProjectIds(payload.projectIds || payload.project_ids || payload.projectId || payload.project_id);
  if (captured.pageType === "detail") {
    const imported = await postJson(LOCAL_AD_SHOT_IMPORT_URL, {
      ...captured.detail,
      target_app: normalizeText(payload.targetApp || payload.target_app) || "未指定",
      appId: normalizeText(payload.appId || payload.app_id),
      projectIds,
      capture_context: "topads_detail"
    });
    const analyzed = await enqueueImportedShotAnalysis(imported);
    await setImportStatus({
      state: "done",
      message: formatDetailImportStatusMessage({
        imported,
        analyzed,
        label: "Ad Shot"
      }),
      tabId: tab.id,
      updatedAt: new Date().toISOString()
    });
    await setBadge("OK", "#0d6f5b");
    setTimeout(() => setBadge("", "#0d6f5b"), 3500);
    return {
      mode: "detail",
      shot: analyzed || imported,
      sourceUrl: captured.sourceUrl
    };
  }

  const saved = await postJson(LOCAL_AD_SHOT_CANDIDATES_URL, {
    source_url: captured.sourceUrl,
    target_app: normalizeText(payload.targetApp || payload.target_app) || "未指定",
    appId: normalizeText(payload.appId || payload.app_id),
    projectIds,
    filters: {
      ...captured.filters,
      ...(payload.filters && typeof payload.filters === "object" ? payload.filters : {})
    },
    items: captured.items
  });
  await setImportStatus({
    state: "done",
    message: `Ad Shot 候选已保存：新增 ${saved.created || 0} 条，更新 ${saved.updated || 0} 条。`,
    tabId: tab.id,
    updatedAt: new Date().toISOString()
  });
  await setBadge("OK", "#0d6f5b");
  setTimeout(() => setBadge("", "#0d6f5b"), 3500);
  return {
    mode: "results",
    ...saved
  };
}

async function importTikTokDetailShot(payload = {}) {
  const tab = await resolveTikTokDetailTab(payload.tabId);
  await setImportStatus({
    state: "running",
    message: "正在采集当前 TikTok 视频并写入素材库...",
    tabId: tab.id,
    updatedAt: new Date().toISOString()
  });
  await setBadge("TT", "#0d6f5b");
  await waitForTabComplete(tab.id);
  await sleep(500);

  const captured = await collectTikTokDetailPage(tab.id);
  const projectIds = normalizeProjectIds(payload.projectIds || payload.project_ids || payload.projectId || payload.project_id);
  const imported = await postJson(LOCAL_AD_SHOT_IMPORT_URL, {
    ...captured.detail,
    sourcePlatform: "tiktok",
    source_platform: "tiktok",
    capture_context: "tiktok_detail",
    target_app: normalizeText(payload.targetApp || payload.target_app) || "未指定",
    appId: normalizeText(payload.appId || payload.app_id),
    projectIds
  });
  const analyzed = await enqueueImportedShotAnalysis(imported);
  await setImportStatus({
    state: "done",
    message: formatDetailImportStatusMessage({
      imported,
      analyzed,
      label: "TikTok 素材"
    }),
    tabId: tab.id,
    updatedAt: new Date().toISOString()
  });
  await setBadge("OK", "#0d6f5b");
  setTimeout(() => setBadge("", "#0d6f5b"), 3500);
  return {
    mode: "detail",
    shot: analyzed || imported,
    sourceUrl: captured.sourceUrl
  };
}

async function importTikTokDetailShotWithComments(payload = {}) {
  const tabId = Number(payload.tabId);
  let importPayload = {};
  let shot = {};
  let comments = null;
  let importError = "";
  let commentError = "";

  try {
    importPayload = await importTikTokDetailShot(payload);
    shot = importPayload.shot || {};
  } catch (error) {
    importError = error instanceof Error ? error.message : String(error);
  }

  try {
    comments = await collectAndImportTikTokComments(tabId, {
      ...payload,
      shot
    });
    if (shot && Object.keys(shot).length) {
      shot = {
        ...shot,
        commentsRaw: comments
      };
    }
  } catch (error) {
    commentError = error instanceof Error ? error.message : String(error);
  }

  if (importError && commentError) {
    throw new Error(`${importError}；评论采集失败：${commentError}`);
  }

  const mediaCount = countCommentMedia(comments);
  const message = [
    importError ? `素材入库失败：${importError}` : (shot?.duplicate ? "视频已存在，已跳过重复入库" : "视频已入库"),
    commentError ? `当前已加载评论采集失败：${commentError}` : `当前已加载评论 ${comments?.itemCount || 0} 条${mediaCount ? `，图片 ${mediaCount} 张` : ""}`
  ].join("；");

  await setImportStatus({
    state: importError || commentError ? "warning" : "done",
    message,
    tabId,
    shotId: shot?.shotId || shot?.id || "",
    payload: {
      mode: "detail",
      ...importPayload,
      shot,
      comments,
      importError,
      commentError
    },
    updatedAt: new Date().toISOString()
  });

  return {
    mode: "detail",
    ...importPayload,
    shot,
    comments,
    importError,
    commentError,
    message
  };
}

async function collectAndImportTikTokComments(tabId, payload = {}) {
  if (!tabId) {
    throw new Error("缺少 TikTok 视频页面 tab。");
  }
  const shot = payload.shot && typeof payload.shot === "object" ? payload.shot : {};
  await setBadge("CMT", "#0d6f5b");
  await showTikTokOverlay(tabId, {
    state: "running",
    title: "正在读取已加载评论",
    message: "视频已交给后台采集；关闭插件面板不会中断评论入库。"
  }).catch(() => {});

  const collected = await collectTikTokVideoComments(tabId, 0);
  const response = await fetch(LOCAL_TIKTOK_COMMENTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...collected,
      resultId: normalizeText(shot.shotId || shot.id || collected.resultId),
      appId: normalizeText(shot.appId || shot.app?.id || payload.appId || collected.appId),
      videoTitle: normalizeText(shot.title || payload.title || collected.videoTitle),
      sourceUrl: normalizeText(shot.sourceUrl || collected.sourceUrl)
    })
  });
  const saved = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(saved.error || `TikTok 评论入库失败：HTTP ${response.status}`);
  }
  await showTikTokOverlay(tabId, {
    state: "done",
    title: "评论采集完成",
    message: `已写入当前已加载的 ${saved.itemCount || collected.items.length} 条评论，${saved.matched ? "已绑定到视频记录" : "未匹配到本地视频记录"}。`
  }).catch(() => {});
  return saved;
}

function countCommentMedia(comments = {}) {
  const items = Array.isArray(comments.items) ? comments.items : [];
  return items.reduce((total, item) => total + (Array.isArray(item?.media) ? item.media.length : 0), 0);
}

async function enqueueImportedShotAnalysis(imported) {
  const shotId = normalizeText(imported?.shotId);
  if (!shotId) {
    return imported;
  }
  return postJson(LOCAL_AD_SHOT_ANALYZE_URL, { shotId });
}

function formatDetailImportStatusMessage({ imported, analyzed, label }) {
  const shotId = normalizeText(imported?.shotId || analyzed?.shotId);
  const queued = ["queued", "running", "completed"].includes(normalizeText(analyzed?.analysisStatus));
  if (imported?.duplicate) {
    return queued
      ? `${label} 已存在并已加入分析流程：${shotId}`
      : `${label} 已存在：${shotId}`;
  }
  return queued
    ? `${label} 已入库并加入分析队列：${shotId}`
    : `${label} 已入库：${shotId}`;
}

function normalizeProjectIds(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => normalizeText(item)).filter(Boolean);
}

async function suggestAdShotApp(payload = {}) {
  const mode = normalizeText(payload.mode || payload.pageType || payload.sourceType);
  if (mode === "tiktok-detail") {
    const tab = await resolveTikTokDetailTab(payload.tabId);
    await waitForTabComplete(tab.id);
    await sleep(250);
    const captured = await collectTikTokDetailPage(tab.id);
    const matchPayload = {
      brandName: normalizeText(captured.detail.brandName || captured.detail.brand_name),
      appName: normalizeText(captured.detail.appName || captured.detail.app_name),
      title: normalizeText(captured.detail.title || captured.detail.description || captured.detail.caption),
      landingPage: normalizeText(captured.detail.landingPage || captured.detail.landing_page)
    };
    return {
      mode,
      matchPayload,
      matched: await postJson(LOCAL_AD_SHOT_MATCH_APP_URL, matchPayload)
    };
  }

  if (mode === "topads-detail") {
    const tab = await resolveCreativeCenterTab(payload.tabId);
    await waitForTabComplete(tab.id);
    await sleep(250);
    const captured = await collectCreativeCenterPage(tab.id, { limit: 1 });
    if (captured.pageType !== "detail") {
      return {
        mode,
        matchPayload: {},
        matched: {
          appId: "",
          app: null,
          status: "unmatched",
          source: "none",
          query: "",
          error: "",
          evidence: []
        }
      };
    }
    const detail = captured.detail || {};
    const matchPayload = {
      brandName: normalizeText(detail.brandName || detail.brand_name),
      appName: normalizeText(detail.appName || detail.app_name || detail.advertiser),
      title: normalizeText(detail.adTitle || detail.title),
      landingPage: normalizeText(detail.landingPage || detail.landing_page || detail.raw?.landingPage || detail.raw?.landing_page)
    };
    return {
      mode,
      matchPayload,
      matched: await postJson(LOCAL_AD_SHOT_MATCH_APP_URL, matchPayload)
    };
  }

  return {
    mode,
    matchPayload: {},
    matched: {
      appId: "",
      app: null,
      status: "unmatched",
      source: "none",
      query: "",
      error: "",
      evidence: []
    }
  };
}

async function resolveCreativeCenterTab(tabId) {
  if (!tabId) {
    throw new Error("请在 Creative Center 页面打开 T2T 插件 popup 后采集，不能从网页端猜测要采集哪个标签页。");
  }

  const tab = await chrome.tabs.get(Number(tabId));
  if (isCreativeCenterUrl(tab?.url || "")) {
    return tab;
  }
  throw new Error("当前标签页不是 TikTok Creative Center。请切到 Top Ads 详情页或结果页后再点 T2T 插件。");
}

async function resolveTikTokDetailTab(tabId) {
  if (!tabId) {
    throw new Error("请在 TikTok 视频详情页打开 T2T 插件 popup 后采集。");
  }

  const tab = await chrome.tabs.get(Number(tabId));
  if (isTikTokDetailUrl(tab?.url || "")) {
    return tab;
  }
  throw new Error("当前标签页不是 TikTok 视频/图集详情页。请切到普通 TikTok 详情页后再点 T2T 插件。");
}

function isCreativeCenterUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "ads.tiktok.com" && parsed.pathname.includes("/business/creativecenter/");
  } catch {
    return false;
  }
}

function isTikTokDetailUrl(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)tiktok\.com$/i.test(parsed.hostname) && /\/@[^/]+\/(?:video|photo)\/\d+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function collectCreativeCenterPage(tabId, payload = {}) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [Number(payload.limit) || 80],
    func: async (limit) => {
      const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const sourceUrl = location.href;
      const topAdsMatch = location.pathname.match(/\/topads\/([^/]+)/i);
      const pageType = topAdsMatch ? "detail" : "results";
      const filters = Object.fromEntries(new URL(location.href).searchParams.entries());

      function parseNextData() {
        const script = document.querySelector("script#__NEXT_DATA__");
        if (!script?.textContent) {
          return null;
        }
        try {
          return JSON.parse(script.textContent);
        } catch {
          return null;
        }
      }

      async function getDetailFromNextData() {
        const data = parseNextData();
        const pageData = data?.props?.pageProps?.data;
        const detail = pageData?.baseDetail || pageData?.detail || {};
        const videoInfo = detail.videoInfo || {};
        const videoUrls = videoInfo.videoUrl || {};
        const videoUrl = typeof videoUrls === "string"
          ? videoUrls
          : videoUrls["720P"] || videoUrls["540P"] || videoUrls.origin || "";
        return {
          source_url: sourceUrl,
          source_ad_id: detail.id || topAdsMatch?.[1] || "",
          title: detail.adTitle || detail.title || "",
          brandName: detail.brandName || "",
          poster_url: videoInfo.cover || detail.cover || "",
          video_url: videoUrl,
          page_html: document.documentElement.outerHTML,
          interactive_time_analysis: pageType === "detail" ? await collectInteractiveTimeAnalysis() : null
        };
      }

      async function collectInteractiveTimeAnalysis() {
        const container = document.querySelector("[class*='metricTabs']")?.parentElement || document.querySelector("[class*='metricTabs']");
        const tabLabels = Array.from(container?.querySelectorAll("[class*='tabText']") || [])
          .map((node) => normalizeText(node.textContent))
          .filter(Boolean);
        const orderedLabels = ["CTR", "CVR", "Clicks", "Conversion", "Remain"].filter((label) => tabLabels.includes(label));
        const fallbackLabels = tabLabels.length ? tabLabels : ["CTR", "CVR", "Clicks", "Conversion", "Remain"];
        const labels = orderedLabels.length ? orderedLabels : fallbackLabels;
        const results = [];
        for (const label of labels) {
          const tabButton = Array.from(container?.querySelectorAll("[class*='tabText']") || [])
            .find((node) => normalizeText(node.textContent) === label)
            ?.closest("div");
          if (tabButton) {
            tabButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
            await waitForActiveTab(label);
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
          results.push(readActiveMetricTab(label));
        }
        return {
          sourceUrl,
          capturedAt: new Date().toISOString(),
          tabs: results,
          tabOrder: labels,
          activeTab: labels[0] || "",
          captureMode: "ui_tab_rotation"
        };
      }

      function readActiveMetricTab(expectedLabel) {
        const metricContainer = document.querySelector("[class*='metricTabs']")?.parentElement || document.querySelector("[class*='metricTabs']");
        const activeLabel = Array.from(metricContainer?.querySelectorAll("[class*='tabText']") || [])
          .map((node) => normalizeText(node.textContent))
          .find((label) => label && isActiveTabNode(label)) || expectedLabel;
        const infoText = normalizeText(document.querySelector("[class*='metricInfo']")?.innerText || document.querySelector("[class*='metricInfo']")?.textContent || "");
        const rankText = normalizeText(document.querySelector("[class*='metricRank']")?.innerText || document.querySelector("[class*='metricRank']")?.textContent || "");
        const chartEl = document.querySelector("#asset-detail-keyframe-chart");
        const chartInstance = window.echarts?.getInstanceByDom?.(chartEl) || null;
        const chartOption = chartInstance?.getOption?.() || null;
        return {
          key: metricKeyFromLabel(expectedLabel),
          label: expectedLabel,
          activeLabel,
          infoText,
          rankText,
          highlightSeconds: extractHighlightSeconds(infoText),
          chart: chartOption
            ? {
                series: Array.isArray(chartOption.series)
                  ? chartOption.series.map((series) => ({
                      name: series.name || "",
                      type: series.type || "",
                      data: Array.isArray(series.data) ? series.data : []
                    }))
                  : [],
                xAxis: Array.isArray(chartOption.xAxis) ? chartOption.xAxis.map((axis) => axis.data || []) : [],
                yAxis: Array.isArray(chartOption.yAxis) ? chartOption.yAxis.map((axis) => ({
                  min: axis.min ?? null,
                  max: axis.max ?? null
                })) : []
              }
            : null
        };
      }

      function isActiveTabNode(label) {
        const node = Array.from(document.querySelectorAll("[class*='tabText']"))
          .find((item) => normalizeText(item.textContent) === label);
        return Boolean(node && /active/i.test(node.className));
      }

      function metricKeyFromLabel(label) {
        const normalized = normalizeText(label).toLowerCase();
        return {
          ctr: "ctr",
          cvr: "cvr",
          clicks: "clickNumber",
          conversion: "conversionNumber",
          remain: "remain"
        }[normalized] || normalized;
      }

      function extractHighlightSeconds(text) {
        return Array.from(new Set(
          Array.from(String(text || "").matchAll(/(\d+)(?=\s*(?:秒|seconds?))/gi), (match) => Number(match[1]))
            .filter((value) => Number.isFinite(value) && value > 0)
        ));
      }

      function waitForActiveTab(label, timeout = 8000) {
        return new Promise((resolve) => {
          const started = Date.now();
          const timer = setInterval(() => {
            const active = Array.from(document.querySelectorAll("[class*='tabText']"))
              .find((node) => /active/i.test(node.className));
            if (active && normalizeText(active.textContent) === label) {
              clearInterval(timer);
              resolve(true);
              return;
            }
            if (Date.now() - started >= timeout) {
              clearInterval(timer);
              resolve(false);
            }
          }, 200);
        });
      }

      function closestCard(anchor) {
        let node = anchor;
        for (let depth = 0; node && depth < 8; depth += 1) {
          const text = normalizeText(node.innerText || node.textContent || "");
          const rect = node.getBoundingClientRect?.();
          if (rect && rect.width >= 140 && rect.height >= 120 && text.length >= 8) {
            return node;
          }
          node = node.parentElement;
        }
        return anchor;
      }

      function collectResultItems() {
        const anchors = Array.from(document.querySelectorAll("a[href*='/business/creativecenter/topads/']"));
        const seen = new Set();
        const items = [];
        for (const anchor of anchors) {
          const detailUrl = new URL(anchor.getAttribute("href") || anchor.href, location.origin).href;
          const sourceAdId = detailUrl.match(/\/topads\/([^/]+)/i)?.[1] || "";
          if (!sourceAdId || seen.has(sourceAdId)) {
            continue;
          }
          seen.add(sourceAdId);
          const card = closestCard(anchor);
          const text = normalizeText(card.innerText || card.textContent || anchor.textContent || "");
          const poster = card.querySelector?.("img[src]")?.src || "";
          const video = card.querySelector?.("video")?.currentSrc || card.querySelector?.("video")?.src || "";
          const lines = text.split(/\n+/).map(normalizeText).filter(Boolean);
          items.push({
            sourceAdId,
            detailUrl,
            title: lines.find((line) => line.length >= 4 && line.length <= 160) || "",
            cardText: text,
            posterUrl: poster,
            videoUrl: video,
            rawText: text
          });
          if (items.length >= limit) {
            break;
          }
        }
        return items;
      }

      if (pageType === "detail") {
        return {
          pageType,
          sourceUrl,
          detail: await getDetailFromNextData()
        };
      }
      return {
        pageType,
        sourceUrl,
        filters,
        items: collectResultItems()
      };
    }
  });

  if (!result) {
    throw new Error("Creative Center 页面采集脚本没有返回数据。");
  }
  if (result.pageType === "results" && !Array.isArray(result.items)) {
    result.items = [];
  }
  return result;
}

async function collectTikTokDetailPage(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const sourceUrl = location.href;
      const canonicalUrl = document.querySelector("link[rel='canonical']")?.href || sourceUrl;
      const sourceAdId = (location.pathname.match(/\/(?:video|photo)\/(\d+)/i) || canonicalUrl.match(/\/(?:video|photo)\/(\d+)/i) || [])[1] || "";
      const author = location.pathname.match(/\/@([^/]+)/)?.[1] || "";
      const meta = (selector) => normalizeText(document.querySelector(selector)?.content);
      const ogTitle = meta("meta[property='og:title']");
      const ogDescription = meta("meta[property='og:description']");
      const description = normalizeText(
        document.querySelector("[data-e2e='browse-video-desc']")?.innerText
        || document.querySelector("[data-e2e='video-desc']")?.innerText
        || document.querySelector("h1")?.innerText
        || ogDescription
      );
      const title = normalizeText(description || ogTitle || document.title).replace(/\s+\|\s+TikTok.*$/i, "");
      const video = document.querySelector("video");
      const isPhotoDetail = /\/photo\//i.test(location.pathname);
      const accountInfo = readAccountInfo(author);
      const posterUrl = meta("meta[property='og:image']")
        || video?.poster
        || document.querySelector("img[src*='tiktokcdn']")?.src
        || "";
      const rawVideoUrl = video?.currentSrc || video?.src || "";
      const videoUrl = /^https?:\/\//i.test(rawVideoUrl) ? rawVideoUrl : "";
      const imageUrls = collectPhotoImageUrls();

      function readCount(selectors) {
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          const text = normalizeText(element?.innerText || element?.textContent);
          if (text) {
            return text;
          }
        }
        return "";
      }

      function readAccountInfo(authorName) {
        const normalizedAuthor = normalizeText(authorName).replace(/^@/, "").toLowerCase();
        const fromJson = readAccountInfoFromJson(normalizedAuthor);
        const avatarUrl = fromJson.avatarUrl || readAvatarFromDom(normalizedAuthor);
        const followerCount = firstNumber(
          fromJson.followerCount,
          parseCompactCount(readCount([
            "[data-e2e='followers-count']",
            "[data-e2e='browse-user-follower-count']",
            "strong[title*='Follower']",
            "strong[title*='follower']"
          ]))
        );
        return {
          avatarUrl,
          followerCount,
          stats: {
            ...(fromJson.stats || {}),
            ...(Number.isFinite(followerCount) ? { followerCount } : {})
          }
        };
      }

      function readAvatarFromDom(normalizedAuthor) {
        const candidates = Array.from(document.querySelectorAll("img[src], img[srcset]"));
        for (const image of candidates) {
          const src = image.currentSrc || image.src || String(image.getAttribute("srcset") || "").split(",")[0]?.trim().split(/\s+/)[0] || "";
          if (!/^https?:\/\//i.test(src)) continue;
          const alt = normalizeText(image.alt || image.getAttribute("aria-label") || "").toLowerCase();
          const className = normalizeText(image.className || "").toLowerCase();
          const looksLikeAvatar = /avatar|avt|profile|user/.test(src + " " + alt + " " + className) || (normalizedAuthor && alt.includes(normalizedAuthor));
          if (looksLikeAvatar && !/emoji|sticker|music|icon/.test(src)) {
            return src.replace(/&amp;/g, "&");
          }
        }
        return "";
      }

      function readAccountInfoFromJson(normalizedAuthor) {
        const dataObjects = [];
        for (const script of document.querySelectorAll("script[type='application/json'], script#__UNIVERSAL_DATA_FOR_REHYDRATION__, script#SIGI_STATE")) {
          const text = script.textContent || "";
          if (!text.trim()) continue;
          try {
            dataObjects.push(JSON.parse(text));
          } catch {
            // Ignore non-JSON script blocks.
          }
        }
        const result = { avatarUrl: "", followerCount: undefined, stats: null };
        const seen = new Set();
        const stack = dataObjects.slice();
        let visited = 0;
        while (stack.length && visited < 5000) {
          const value = stack.pop();
          if (!value || typeof value !== "object" || seen.has(value)) continue;
          seen.add(value);
          visited += 1;
          considerAccountObject(value, result, normalizedAuthor);
          if (result.avatarUrl && Number.isFinite(result.followerCount)) break;
          for (const child of Object.values(value)) {
            if (child && typeof child === "object") stack.push(child);
          }
        }
        return result;
      }

      function considerAccountObject(value, result, normalizedAuthor) {
        const user = value.author && typeof value.author === "object" ? value.author : value.user && typeof value.user === "object" ? value.user : value;
        const uniqueId = normalizeText(user.uniqueId || user.unique_id || user.id || user.uid || user.nickname).replace(/^@/, "").toLowerCase();
        const matchesAuthor = !normalizedAuthor || uniqueId === normalizedAuthor || uniqueId.includes(normalizedAuthor) || normalizedAuthor.includes(uniqueId);
        if (!matchesAuthor && !(value.authorStats || value.stats || user.stats)) return;
        if (!result.avatarUrl) {
          result.avatarUrl = normalizeText(user.avatarThumb || user.avatarMedium || user.avatarLarger || user.avatarUrl || user.avatar_url);
        }
        const stats = value.authorStats || value.stats || user.stats || {};
        const followerCount = firstNumber(stats.followerCount, stats.follower_count, stats.followers, user.followerCount, user.followers);
        if (Number.isFinite(followerCount)) {
          result.followerCount = followerCount;
        }
        if (!result.stats && (Object.keys(stats).length || Number.isFinite(followerCount))) {
          result.stats = stats;
        }
      }

      function firstNumber(...values) {
        for (const value of values) {
          const number = typeof value === "string" ? parseCompactCount(value) : Number(value);
          if (Number.isFinite(number) && number >= 0) return number;
        }
        return undefined;
      }

      function parseCompactCount(value) {
        const text = normalizeText(value).replace(/,/g, "");
        if (!text) return undefined;
        const match = text.match(/([\d.]+)\s*([KMB万亿]?)/i);
        if (!match) return undefined;
        const base = Number(match[1]);
        if (!Number.isFinite(base)) return undefined;
        const unit = match[2].toLowerCase();
        if (unit === "k") return Math.round(base * 1000);
        if (unit === "m") return Math.round(base * 1000000);
        if (unit === "b") return Math.round(base * 1000000000);
        if (unit === "万") return Math.round(base * 10000);
        if (unit === "亿") return Math.round(base * 100000000);
        return Math.round(base);
      }

      return {
        sourceUrl,
        detail: {
          source_url: sourceUrl,
          canonical_url: canonicalUrl,
          source_ad_id: sourceAdId,
          title,
          description,
          caption: description,
          author,
          username: author,
          authorAvatarUrl: accountInfo.avatarUrl,
          followerCount: accountInfo.followerCount,
          authorStats: accountInfo.stats,
          poster_url: posterUrl,
          video_url: videoUrl,
          image_urls: imageUrls,
          imageUrls,
          media_type: isPhotoDetail ? "photo" : "video",
          sourcePlatform: "tiktok",
          capture_context: "tiktok_detail",
          engagement: {
            likeCount: readCount(["[data-e2e='like-count']", "[data-e2e='browse-like-count']"]),
            commentCount: readCount(["[data-e2e='comment-count']", "[data-e2e='browse-comment-count']"]),
            shareCount: readCount(["[data-e2e='share-count']", "[data-e2e='browse-share-count']"]),
            viewCount: readCount(["[data-e2e='video-views']", "[data-e2e='browse-video-views']"])
          }
        }
      };

      function collectPhotoImageUrls() {
        const urls = new Set();
        const add = (value) => {
          const text = String(value || "").trim();
          if (!/^https?:\/\//i.test(text)) return;
          if (!/(tiktokcdn|tos-|p\d+-sign|\.jpe?g|\.png|\.webp)/i.test(text)) return;
          if (/avatar|avt|cropcenter:720:720/i.test(text)) return;
          urls.add(text.replace(/&amp;/g, "&"));
        };
        add(meta("meta[property='og:image']"));
        document.querySelectorAll("img[src], source[srcset], img[srcset]").forEach((element) => {
          add(element.getAttribute("src"));
          String(element.getAttribute("srcset") || "").split(",").forEach((part) => add(part.trim().split(/\s+/)[0]));
        });
        for (const script of document.querySelectorAll("script[type='application/json'], script#__UNIVERSAL_DATA_FOR_REHYDRATION__, script#SIGI_STATE")) {
          const text = script.textContent || "";
          const matches = text.match(/https?:\\?\/\\?\/[^"'\\\s<>]+/g) || [];
          matches.forEach((match) => add(match.replace(/\\u002F/g, "/").replace(/\\\//g, "/")));
        }
        return Array.from(urls).slice(0, 20);
      }
    }
  });

  if (!result?.detail?.source_ad_id) {
    throw new Error("TikTok 详情页采集脚本没有识别到视频 ID。");
  }
  return result;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `本地接口失败：HTTP ${response.status}`);
  }
  return body;
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(done, 15000);
    function done() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        done();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || tab?.status === "complete") {
        done();
      }
    });
  });
}
