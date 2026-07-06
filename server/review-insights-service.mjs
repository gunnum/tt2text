export function createReviewInsightsService(deps = {}) {
  const requiredDeps = [
    "qiaomuBaseUrl"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createReviewInsightsService 缺少依赖：${dep}`);
    }
  }

  async function fetchQiaomuReviewInsights(appStoreId, options = {}) {
    const id = normalizeText(appStoreId);
    if (!id) {
      throw new Error("缺少 App Store ID。");
    }

    const max = clampInt(options.max, 100, 1000, 500);
    const qiaomuApp = options.app ? await ensureQiaomuApp(options.app) : null;
    const requests = options.lightweight
      ? await Promise.allSettled([
          requestQiaomuJson(`/api/apps/${encodeURIComponent(id)}/analysis`)
        ])
      : await Promise.allSettled([
          requestQiaomuJson(`/api/apps/${encodeURIComponent(id)}/ai-themes?max=${max}`),
          requestQiaomuJson(`/api/apps/${encodeURIComponent(id)}/ai-insights?max=${max}`),
          requestQiaomuJson(`/api/apps/${encodeURIComponent(id)}/analysis`),
          requestQiaomuJson(`/api/apps/${encodeURIComponent(id)}/ai-trends`)
        ]);
    const [themes, insights, analysis, trends] = options.lightweight
      ? [null, null, requests[0] ? readSettledValue(requests[0]) : null, null]
      : requests.map(readSettledValue);

    return {
      appStoreId: id,
      source: "qiaomu",
      qiaomuApp,
      qiaomuBaseUrl: deps.qiaomuBaseUrl,
      fetchedAt: new Date().toISOString(),
      themes: unwrapData(themes),
      insights: unwrapData(insights),
      analysis: unwrapData(analysis)?.analysis || unwrapData(analysis),
      trends: unwrapData(trends),
      errors: {
        themes: options.lightweight ? "" : readSettledError(requests[0]),
        insights: options.lightweight ? "" : readSettledError(requests[1]),
        analysis: options.lightweight ? readSettledError(requests[0]) : readSettledError(requests[2]),
        trends: options.lightweight ? "" : readSettledError(requests[3])
      }
    };
  }

  async function ensureQiaomuApp(app) {
    const id = normalizeText(app?.id);
    if (!id) {
      return null;
    }
    const appsPayload = await requestQiaomuJson("/api/apps");
    const apps = unwrapData(appsPayload)?.apps || [];
    const existing = Array.isArray(apps)
      ? apps.find((item) => normalizeText(item?.id) === id)
      : null;
    if (existing) {
      return existing;
    }

    const payload = {
      id,
      name: normalizeText(app?.fullName) || normalizeText(app?.name) || id,
      country: normalizeCountry(app?.country || app?.storeCountry || "us")
    };
    const created = await requestQiaomuJson("/api/apps", {
      method: "POST",
      body: payload
    });
    return unwrapData(created);
  }

  async function requestQiaomuJson(pathname, options = {}) {
    const url = new URL(pathname, deps.qiaomuBaseUrl);
    let response;
    try {
      response = await fetch(url, {
        method: options.method || "GET",
        headers: options.body ? { "Content-Type": "application/json" } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (error) {
      throw new Error(`无法连接 qiaomu 评论服务：${error instanceof Error ? error.message : "未知错误"}`);
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || payload?.success === false) {
      const message = payload?.error || payload?.message || `HTTP ${response.status}`;
      throw new Error(`qiaomu 评论服务请求失败：${message}`);
    }

    return payload;
  }

  function unwrapData(payload) {
    return payload && Object.prototype.hasOwnProperty.call(payload, "data")
      ? payload.data
      : payload;
  }

  function readSettledValue(result) {
    return result.status === "fulfilled" ? result.value : null;
  }

  function readSettledError(result) {
    return result.status === "rejected"
      ? result.reason instanceof Error ? result.reason.message : String(result.reason || "未知错误")
      : "";
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeCountry(value) {
    const text = normalizeText(value).toLowerCase();
    return /^[a-z]{2}$/.test(text) ? text : "us";
  }

  function clampInt(value, min, max, fallback) {
    const number = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, number));
  }

  return {
    fetchQiaomuReviewInsights,
    routeDeps: {
      fetchQiaomuReviewInsights
    }
  };
}
