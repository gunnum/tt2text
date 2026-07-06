import { normalizeText, setBadge, setImportStatus, sleep } from "./background-common.js";
import { collectTikTokVideoComments, showTikTokOverlay } from "./background-tiktok-comments.js";

const LOCAL_BATCH_URL = "http://localhost:3000/api/convert/batch";
const LOCAL_TIKTOK_COMMENTS_URL = "http://localhost:3000/api/tiktok-comments/import";

export function canHandleTikTokMessage(message) {
  return [
    "TT2TEXT_IMPORT_TIKTOK_SEARCH",
    "TT2TEXT_IMPORT_TIKTOK_COMMENTS",
    "TT2TEXT_IMPORT_TIKTOK_COMMENTS_BATCH",
    "TT2TEXT_TEST_TIKTOK_SCROLL",
    "TT2TEXT_CLEAR_TIKTOK_STATUS"
  ].includes(message?.type);
}

export async function handleTikTokMessage(message) {
  if (message?.type === "TT2TEXT_TEST_TIKTOK_SCROLL") {
    return testTikTokScroll(message.payload);
  }
  if (message?.type === "TT2TEXT_CLEAR_TIKTOK_STATUS") {
    return clearTikTokImportStatus(message.payload);
  }
  if (message?.type === "TT2TEXT_IMPORT_TIKTOK_COMMENTS") {
    return importTikTokComments(message.payload);
  }
  if (message?.type === "TT2TEXT_IMPORT_TIKTOK_COMMENTS_BATCH") {
    return importTikTokCommentsBatch(message.payload);
  }
  return importTikTokSearch(message.payload);
}

async function importTikTokComments(payload = {}) {
  const tabId = Number(payload.tabId);
  if (!tabId) {
    throw new Error("缺少 TikTok 视频页面 tab。");
  }

  await setBadge("CMT", "#0d6f5b");
  await showTikTokOverlay(tabId, {
    state: "running",
    title: "正在读取已加载评论",
    message: "会遍历评论区，并写入已加载的评论和可见回复。"
  });
  const collected = await collectTikTokVideoComments(tabId, 0);
  const response = await fetch(LOCAL_TIKTOK_COMMENTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(collected)
  });
  const saved = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(saved.error || `TikTok 评论入库失败：HTTP ${response.status}`);
  }
  await setBadge("OK", "#0d6f5b");
  setTimeout(() => setBadge("", "#0d6f5b"), 3000);
  await showTikTokOverlay(tabId, {
    state: "done",
    title: "评论采集完成",
    message: `已写入当前已加载的 ${saved.itemCount || collected.items.length} 条评论，${saved.matched ? "已绑定到视频记录" : "未匹配到本地视频记录"}。`
  });
  return saved;
}

async function importTikTokCommentsBatch(payload = {}) {
  const appId = normalizeText(payload.appId);
  const limit = Math.max(1, Math.min(300, Number(payload.limit) || 120));
  const expandCount = 0;
  const onlyMissing = payload.onlyMissing !== false;
  const providedItems = Array.isArray(payload.items) ? payload.items : [];
  let results = providedItems;
  if (!results.length) {
    const resultsResponse = await fetch("http://localhost:3000/api/results");
    if (!resultsResponse.ok) {
      throw new Error(`读取本地视频结果失败：HTTP ${resultsResponse.status}`);
    }
    results = await resultsResponse.json();
  }
  const targets = (Array.isArray(results) ? results : [])
    .filter((item) => !appId || item.appId === appId || item.app?.id === appId)
    .filter((item) => !onlyMissing || !item.commentsRaw?.items?.length)
    .filter((item) => item.hyperlink || item.sourceUrl)
    .slice(0, limit);

  if (!targets.length) {
    return { total: 0, success: 0, failed: 0, failures: [] };
  }

  await setBadge("CMT", "#0d6f5b");
  const failures = [];
  let success = 0;
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: targets[0].hyperlink || targets[0].sourceUrl, active: true });
    if (tab?.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
    }

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const url = target.hyperlink || target.sourceUrl;
      try {
        await chrome.tabs.update(tab.id, { url, active: true });
        await waitForTabComplete(tab.id);
        await sleep(2200);
        await showTikTokOverlay(tab.id, {
          state: "running",
          title: "批量采集评论",
          message: `正在采集 ${index + 1}/${targets.length}：${target.title || url}`
        }).catch(() => {});
        const collected = await collectTikTokVideoComments(tab.id, expandCount);
        const response = await fetch(LOCAL_TIKTOK_COMMENTS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...collected,
            resultId: target.id,
            appId: target.appId,
            videoTitle: target.title,
            sourceUrl: url
          })
        });
        const saved = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(saved.error || `HTTP ${response.status}`);
        }
        success += 1;
        await setImportStatus({
          state: "running",
          appId,
          tabId: tab.id,
          message: `TikTok 评论补采 ${index + 1}/${targets.length}，成功 ${success} 条。`,
          collected: success,
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        failures.push({
          id: target.id,
          url,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      await sleep(900);
    }
  } finally {
    await setBadge(failures.length ? "WARN" : "OK", failures.length ? "#b98122" : "#0d6f5b");
    setTimeout(() => setBadge("", "#0d6f5b"), 5000);
  }

  return {
    total: targets.length,
    success,
    failed: failures.length,
    failures
  };
}

async function importTikTokSearch(payload = {}) {
  const query = normalizeText(payload.query);
  const appId = normalizeText(payload.appId);
  const appQuery = normalizeText(payload.appQuery || query);
  const limit = Math.max(1, Math.min(200, Number(payload.limit) || 60));
  if (!query) {
    throw new Error("缺少 TikTok 搜索词。");
  }

  const resolvedAppId = appId || await resolveAppId(appQuery);
  if (!resolvedAppId) {
    throw new Error(appQuery ? `没有找到匹配的 App：${appQuery}` : "缺少 App 信息。");
  }

  let tab = null;
  try {
    tab = await openTikTokSearchTab(query, payload.tabId);
    await setImportStatus({
      state: "running",
      query,
      appId: resolvedAppId,
      tabId: tab.id,
      message: `正在打开 TikTok 搜索页：${query}`,
      collected: 0,
      updatedAt: new Date().toISOString()
    });
    await setBadge("RUN", "#0d6f5b");
    await waitForTabComplete(tab.id);
    await sleep(1800);
    const items = await collectTikTokSearchResults(tab.id, limit, query);
    if (!items.length) {
      throw new Error("没有从 TikTok 搜索页采集到视频结果，可能页面需要重试或登录态失效。");
    }

    if (payload.previewOnly) {
      await setImportStatus({
        state: "waiting_confirmation",
        query,
        appId: resolvedAppId,
        tabId: tab.id,
        message: `已采集 ${items.length} 条，等待在 TT2Text 页面手动确认`,
        collected: items.length,
        updatedAt: new Date().toISOString()
      });
      await setBadge("ASK", "#b98122");
      await showTikTokOverlay(tab.id, {
        state: "waiting_confirmation",
        title: "TT2Text 等待确认",
        message: `已采集 ${items.length} 条候选视频。请回到 TT2Text 页面勾选真正相关的视频，再进入转换队列。`
      });
      return {
        app: { id: resolvedAppId },
        items,
        search: {
          query,
          appId: resolvedAppId,
          collected: items.length,
          url: tab.url || buildTikTokSearchUrl(query)
        }
      };
    }

    await setImportStatus({
      state: "running",
      query,
      appId: resolvedAppId,
      tabId: tab.id,
      message: `已采集 ${items.length} 条，正在写入本地系统`,
      collected: items.length,
      updatedAt: new Date().toISOString()
    });

    const response = await fetch(LOCAL_BATCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: resolvedAppId, items, limit })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `本地批量录入失败：HTTP ${response.status}`);
    }
    const donePayload = {
      ...result,
      search: {
        query,
        appId: resolvedAppId,
        collected: items.length,
        url: tab.url || buildTikTokSearchUrl(query)
      }
    };
    await setImportStatus({
      state: "done",
      query,
      appId: resolvedAppId,
      tabId: tab.id,
      message: formatImportDoneMessage(result.totals || {}, items.length),
      collected: items.length,
      totals: result.totals || {},
      updatedAt: new Date().toISOString()
    });
    await setBadge("OK", "#0d6f5b");
    setTimeout(() => setBadge("", "#0d6f5b"), 4000);
    await showTikTokOverlay(tab.id, {
      state: "done",
      title: "TT2Text 采集完成",
      message: formatImportDoneMessage(result.totals || {}, items.length)
    });
    return donePayload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setImportStatus({
      state: "error",
      query,
      appId: resolvedAppId,
      tabId: tab?.id || null,
      message,
      updatedAt: new Date().toISOString()
    });
    await setBadge("ERR", "#b6452f");
    if (tab?.id) {
      await showTikTokOverlay(tab.id, {
        state: "error",
        title: "TT2Text 采集失败",
        message
      }).catch(() => {});
    }
    throw error;
  }
}

async function testTikTokScroll(payload = {}) {
  const tabId = Number(payload.tabId);
  if (!tabId) {
    throw new Error("缺少 TikTok 页面 tab。");
  }
  const query = normalizeText(payload.query || "");
  const items = await collectTikTokSearchResults(tabId, 60, query);
  return {
    collected: items.length,
    sample: items.slice(0, 5).map((item) => item.url)
  };
}

async function clearTikTokImportStatus(payload = {}) {
  await setImportStatus({
    state: "done",
    query: normalizeText(payload.query || ""),
    appId: normalizeText(payload.appId || ""),
    message: normalizeText(payload.message || "已确认候选视频并写入本地队列。"),
    updatedAt: new Date().toISOString()
  });
  await setBadge("", "#0d6f5b");
  return { cleared: true };
}

async function openTikTokSearchTab(query, tabId) {
  const url = buildTikTokSearchUrl(query);
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url && tab.url.includes("tiktok.com/search")) {
        return tab;
      }
    } catch {
      // Fall through to opening a fresh search tab.
    }
  }
  const tab = await chrome.tabs.create({ url, active: true });
  if (tab?.windowId !== undefined) {
    await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
  }
  return tab;
}

function buildTikTokSearchUrl(query) {
  const url = new URL("https://www.tiktok.com/search");
  url.searchParams.set("q", query);
  return url.toString();
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(done, 20000);

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

async function collectTikTokSearchResults(tabId, limit, query) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["tiktok-search-collector.js"]
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [limit, query],
    func: async (targetLimit, searchQuery) => {
      if (!window.TT2TextTikTokCollector?.collect) {
        throw new Error("TikTok 采集脚本没有成功注入。请刷新页面后重试。");
      }
      return window.TT2TextTikTokCollector.collect({ limit: targetLimit, query: searchQuery });
    }
  });

  if (result?.diagnostics) {
    console.log("TT2Text TikTok collector diagnostics", result.diagnostics);
  }
  return Array.isArray(result?.items) ? result.items : [];
}


function formatImportDoneMessage(totals, collected) {
  return `采集 ${collected} 条；排队 ${totals.queued || 0} 条，重复 ${totals.skipped_duplicate || 0} 条。未确认的候选不会进入工作流。`;
}

async function resolveAppId(appQuery) {
  const query = normalizeText(appQuery);
  if (!query) {
    return "";
  }

  const response = await fetch("http://localhost:3000/api/apps");
  if (!response.ok) {
    return "";
  }

  const apps = await response.json().catch(() => []);
  const target = normalizeAppNameForMatch(query);
  const matched = Array.isArray(apps)
    ? apps.find((app) => normalizeAppNameForMatch(app.name) === target)
      || apps.find((app) => {
        const candidate = normalizeAppNameForMatch(app.name);
        return candidate && (candidate.includes(target) || target.includes(candidate));
      })
      || apps.find((app) => /amata/i.test(app.name))
    : null;
  return matched?.id || "";
}

function normalizeAppNameForMatch(value) {
  return String(value || "")
    .split(":")[0]
    .replace(/\b(app|ios|android)\b/gi, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "")
    .toLowerCase()
    .trim();
}
