export function createAdShotSubscriptionService(deps = {}) {
  const requiredDeps = [
    "readProjects",
    "readSubscriptionsRaw",
    "writeSubscriptionsRaw",
    "readLogsRaw",
    "writeLogsRaw",
    "createJobId",
    "formatDate",
    "normalizeText"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAdShotSubscriptionService 缺少依赖：${dep}`);
    }
  }

  const truncateText = typeof deps.truncateText === "function" ? deps.truncateText : defaultTruncateText;
  const slugifyId = typeof deps.slugifyId === "function" ? deps.slugifyId : defaultSlugifyId;

  async function readAdShotSubscriptions() {
    const [projects, subscriptions, logs] = await Promise.all([
      deps.readProjects(),
      deps.readSubscriptionsRaw(),
      readAdShotSubscriptionLogs()
    ]);
    return normalizeAdShotSubscriptions(subscriptions, projects, logs);
  }

  async function readAdShotSubscriptionLogs() {
    const parsed = await deps.readLogsRaw();
    return normalizeAdShotSubscriptionLogs(parsed);
  }

  async function saveAdShotSubscription(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("缺少订阅规则。");
    }

    const [projects, subscriptions] = await Promise.all([
      deps.readProjects(),
      deps.readSubscriptionsRaw()
    ]);
    const now = deps.formatDate(new Date());
    const id = normalizeText(payload.id) || `sub_${deps.createJobId()}`;
    const existing = subscriptions.find((item) => item.id === id);
    const record = buildAdShotSubscriptionStorageRecord({
      ...existing,
      ...payload,
      id,
      savedAt: normalizeText(existing?.savedAt || existing?.createdAt || payload.savedAt || payload.createdAt) || now,
      createdAt: normalizeText(existing?.createdAt || existing?.savedAt || payload.createdAt || payload.savedAt) || now,
      updatedAt: now
    }, projects);
    const index = subscriptions.findIndex((item) => item.id === id);
    if (index >= 0) {
      subscriptions[index] = record;
    } else {
      subscriptions.unshift(record);
    }
    await deps.writeSubscriptionsRaw(subscriptions);
    return (await readAdShotSubscriptions()).find((item) => item.id === id) || record;
  }

  async function deleteAdShotSubscription(id) {
    const subscriptionId = normalizeText(id);
    if (!subscriptionId) {
      throw new Error("缺少订阅规则 ID。");
    }

    const subscriptions = await deps.readSubscriptionsRaw();
    const index = subscriptions.findIndex((item) => item.id === subscriptionId);
    if (index < 0) {
      throw new Error("没有找到这个订阅规则。");
    }

    const [deleted] = subscriptions.splice(index, 1);
    await deps.writeSubscriptionsRaw(subscriptions);
    return { ok: true, deletedId: subscriptionId, deleted };
  }

  async function appendAdShotSubscriptionLog(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("缺少订阅运行日志。");
    }

    const projects = await deps.readProjects();
    const projectId = normalizeText(payload.projectId || payload.project_id) || projects[0]?.id || "";
    const project = projects.find((item) => item.id === projectId);
    const now = deps.formatDate(new Date());
    const record = {
      id: normalizeText(payload.id) || `log_${deps.createJobId()}`,
      subscriptionId: normalizeText(payload.subscriptionId || payload.subscription_id),
      subscriptionName: normalizeText(payload.subscriptionName || payload.subscription_name || payload.ruleName),
      projectId,
      projectName: project?.name || normalizeText(payload.projectName || payload.project_name),
      status: normalizeAdShotRunStatus(payload.status),
      startedAt: normalizeText(payload.startedAt || payload.started_at) || now,
      endedAt: normalizeText(payload.endedAt || payload.ended_at || payload.finishedAt || payload.finished_at),
      finishedAt: normalizeText(payload.finishedAt || payload.finished_at || payload.endedAt || payload.ended_at),
      filters: payload.filters && typeof payload.filters === "object" ? payload.filters : {},
      sourceUrl: normalizeText(payload.sourceUrl || payload.source_url),
      discoveredCount: Number(payload.discoveredCount ?? payload.discovered_count ?? payload.foundCount ?? payload.found_count) || 0,
      foundCount: Number(payload.foundCount ?? payload.found_count ?? payload.discoveredCount ?? payload.discovered_count) || 0,
      importedCount: Number(payload.importedCount ?? payload.imported_count) || 0,
      duplicateCount: Number(payload.duplicateCount ?? payload.duplicate_count) || 0,
      failedCount: Number(payload.failedCount ?? payload.failed_count) || 0,
      error: truncateText(normalizeText(payload.error || payload.errorMessage || payload.failureReason || payload.failure_reason), 1000),
      createdAt: now
    };

    const logs = await readAdShotSubscriptionLogs();
    logs.unshift(record);
    await deps.writeLogsRaw(logs.slice(0, 500));
    return record;
  }

  function normalizeAdShotSubscriptions(subscriptions, projects = [], logs = []) {
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const logsBySubscription = new Map();
    for (const log of logs) {
      const subscriptionId = normalizeText(log.subscriptionId || log.subscription_id);
      if (!subscriptionId) {
        continue;
      }
      if (!logsBySubscription.has(subscriptionId)) {
        logsBySubscription.set(subscriptionId, log);
      }
    }

    return (Array.isArray(subscriptions) ? subscriptions : [])
      .map((item) => normalizeAdShotSubscription(item, projects, projectById, logsBySubscription))
      .sort((a, b) => normalizeText(b.updatedAt || b.savedAt).localeCompare(normalizeText(a.updatedAt || a.savedAt)));
  }

  function normalizeAdShotSubscription(item, projects = [], projectById = new Map(), logsBySubscription = new Map()) {
    const now = deps.formatDate(new Date());
    const rawRule = item?.rawRule && typeof item.rawRule === "object" ? item.rawRule : {};
    const rawFilters = item?.filters && typeof item.filters === "object"
      ? item.filters
      : rawRule.filters && typeof rawRule.filters === "object"
        ? rawRule.filters
        : {};
    const rawSampling = item?.sampling && typeof item.sampling === "object"
      ? item.sampling
      : rawRule.sampling && typeof rawRule.sampling === "object"
        ? rawRule.sampling
        : {};
    const rawAnalysis = item?.analysis && typeof item.analysis === "object"
      ? item.analysis
      : rawRule.analysis && typeof rawRule.analysis === "object"
        ? rawRule.analysis
        : {};
    const projectId = normalizeText(item?.projectId || item?.project_id || rawRule.projectId || rawRule.project_id)
      || projects[0]?.id
      || "";
    const project = projectById.get(projectId);
    const id = normalizeText(item?.id) || `sub_${slugifyId(item?.name) || deps.createJobId()}`;
    const status = normalizeAdShotSubscriptionStatus(item?.status ?? item?.enabled ?? rawRule.status ?? rawRule.enabled);
    const schedule = normalizeText(item?.schedule || rawRule.schedule || rawSampling.schedule || "每天手动触发/待接入自动任务");
    const dailyLimit = Number(item?.dailyLimit ?? item?.daily_limit ?? rawSampling.dailyLimit ?? rawSampling.daily_limit ?? rawSampling.limit) || 20;
    const perRunLimit = Number(item?.perRunLimit ?? item?.per_run_limit ?? rawSampling.perRunLimit ?? rawSampling.per_run_limit) || dailyLimit;
    const lastLog = logsBySubscription.get(id) || null;
    const normalized = {
      id,
      type: "ad_shots_subscription",
      name: normalizeText(item?.name || rawRule.name) || "Ad Shots 订阅项",
      description: truncateText(normalizeText(item?.description || rawRule.description), 1000),
      projectId,
      projectName: project?.name || normalizeText(item?.projectName || item?.project_name || rawRule.projectName || rawRule.project_name),
      status,
      enabled: status === "active",
      sourcePlatform: normalizeText(item?.sourcePlatform || item?.source_platform || rawRule.sourcePlatform || rawRule.source_platform) || "tiktok_creative_center",
      sourceModule: normalizeText(item?.sourceModule || item?.source_module || rawRule.sourceModule || rawRule.source_module) || "top_ads",
      schedule,
      frequency: normalizeText(item?.frequency || rawRule.frequency || rawSampling.frequency),
      filters: rawFilters,
      sampling: {
        ...rawSampling,
        daily_limit: dailyLimit,
        per_run_limit: perRunLimit
      },
      analysis: rawAnalysis,
      sourceUrl: normalizeText(item?.sourceUrl || item?.source_url || rawRule.sourceUrl || rawRule.source_url),
      rawRule: {
        ...rawRule,
        projectId,
        status,
        filters: rawFilters,
        sampling: {
          ...rawSampling,
          daily_limit: dailyLimit,
          per_run_limit: perRunLimit
        }
      },
      savedAt: normalizeText(item?.savedAt || item?.createdAt || rawRule.savedAt) || now,
      createdAt: normalizeText(item?.createdAt || item?.savedAt || rawRule.createdAt) || now,
      updatedAt: normalizeText(item?.updatedAt || rawRule.updatedAt) || now,
      lastRunAt: normalizeText(lastLog?.startedAt || item?.lastRunAt || item?.last_run_at),
      nextRunAt: normalizeText(item?.nextRunAt || item?.next_run_at),
      lastStatus: normalizeAdShotRunStatus(lastLog?.status || item?.lastStatus || item?.last_status),
      lastError: normalizeText(lastLog?.error || item?.lastError || item?.last_error),
      lastCounts: {
        discovered: Number(lastLog?.discoveredCount ?? lastLog?.foundCount) || 0,
        imported: Number(lastLog?.importedCount) || 0,
        duplicate: Number(lastLog?.duplicateCount) || 0,
        failed: Number(lastLog?.failedCount) || 0
      }
    };
    normalized.copyJson = buildAdShotSubscriptionCopyJson(normalized);
    return normalized;
  }

  function buildAdShotSubscriptionStorageRecord(payload, projects = []) {
    const now = deps.formatDate(new Date());
    const projectIds = new Set(projects.map((project) => project.id));
    const fallbackProjectId = projects[0]?.id || "";
    const rawSampling = payload.sampling && typeof payload.sampling === "object" ? payload.sampling : {};
    const rawAnalysis = payload.analysis && typeof payload.analysis === "object" ? payload.analysis : {};
    const filters = payload.filters && typeof payload.filters === "object" ? payload.filters : {};
    const projectId = projectIds.has(normalizeText(payload.projectId || payload.project_id))
      ? normalizeText(payload.projectId || payload.project_id)
      : fallbackProjectId;
    const status = normalizeAdShotSubscriptionStatus(payload.status ?? payload.enabled);
    const dailyLimit = Number(payload.dailyLimit ?? payload.daily_limit ?? rawSampling.dailyLimit ?? rawSampling.daily_limit ?? rawSampling.limit) || 20;
    const perRunLimit = Number(payload.perRunLimit ?? payload.per_run_limit ?? rawSampling.perRunLimit ?? rawSampling.per_run_limit) || dailyLimit;
    return {
      id: normalizeText(payload.id) || `sub_${deps.createJobId()}`,
      type: "ad_shots_subscription",
      name: truncateText(normalizeText(payload.name), 140) || "Ad Shots 订阅项",
      description: truncateText(normalizeText(payload.description), 1000),
      projectId,
      status,
      enabled: status === "active",
      sourcePlatform: normalizeText(payload.source_platform || payload.sourcePlatform) || "tiktok_creative_center",
      sourceModule: normalizeText(payload.source_module || payload.sourceModule) || "top_ads",
      schedule: normalizeText(payload.schedule || rawSampling.schedule || "每天手动触发/待接入自动任务"),
      frequency: normalizeText(payload.frequency || rawSampling.frequency),
      sourceUrl: normalizeText(payload.sourceUrl || payload.source_url),
      filters,
      sampling: {
        ...rawSampling,
        daily_limit: dailyLimit,
        per_run_limit: perRunLimit
      },
      analysis: rawAnalysis,
      rawRule: {
        name: truncateText(normalizeText(payload.name), 140) || "Ad Shots 订阅项",
        description: truncateText(normalizeText(payload.description), 1000),
        projectId,
        status,
        sourcePlatform: normalizeText(payload.source_platform || payload.sourcePlatform) || "tiktok_creative_center",
        sourceModule: normalizeText(payload.source_module || payload.sourceModule) || "top_ads",
        schedule: normalizeText(payload.schedule || rawSampling.schedule || "每天手动触发/待接入自动任务"),
        filters,
        sampling: {
          ...rawSampling,
          daily_limit: dailyLimit,
          per_run_limit: perRunLimit
        },
        analysis: rawAnalysis
      },
      savedAt: normalizeText(payload.savedAt || payload.createdAt) || now,
      createdAt: normalizeText(payload.createdAt || payload.savedAt) || now,
      updatedAt: normalizeText(payload.updatedAt) || now
    };
  }

  function normalizeText(value) {
    return deps.normalizeText(value);
  }

  return {
    readAdShotSubscriptions,
    readAdShotSubscriptionLogs,
    saveAdShotSubscription,
    deleteAdShotSubscription,
    appendAdShotSubscriptionLog
  };
}

export function normalizeAdShotSubscriptionLogs(logs = [], normalizeText = defaultNormalizeText) {
  return (Array.isArray(logs) ? logs : []).map((item) => ({
    id: "",
    subscriptionId: "",
    subscriptionName: "",
    projectId: "",
    projectName: "",
    status: "completed",
    startedAt: "",
    endedAt: "",
    finishedAt: "",
    filters: {},
    sourceUrl: "",
    discoveredCount: 0,
    foundCount: 0,
    importedCount: 0,
    duplicateCount: 0,
    failedCount: 0,
    error: "",
    createdAt: "",
    ...item,
    endedAt: normalizeText(item.endedAt || item.finishedAt || item.ended_at || item.finished_at),
    finishedAt: normalizeText(item.finishedAt || item.endedAt || item.finished_at || item.ended_at),
    discoveredCount: Number(item.discoveredCount ?? item.discovered_count ?? item.foundCount ?? item.found_count) || 0,
    foundCount: Number(item.foundCount ?? item.found_count ?? item.discoveredCount ?? item.discovered_count) || 0,
    importedCount: Number(item.importedCount ?? item.imported_count) || 0,
    duplicateCount: Number(item.duplicateCount ?? item.duplicate_count) || 0,
    failedCount: Number(item.failedCount ?? item.failed_count) || 0,
    error: normalizeText(item.error || item.errorMessage || item.failureReason || item.failure_reason)
  })).sort((a, b) => normalizeText(b.startedAt || b.createdAt).localeCompare(normalizeText(a.startedAt || a.createdAt)));
}

export function normalizeAdShotSubscriptionStatus(value, normalizeText = defaultNormalizeText) {
  if (value === false) {
    return "paused";
  }
  const text = normalizeText(value).toLowerCase();
  if (["paused", "pause", "inactive", "disabled", "停用", "暂停"].includes(text)) {
    return "paused";
  }
  if (["archived", "归档"].includes(text)) {
    return "archived";
  }
  return "active";
}

export function normalizeAdShotRunStatus(value, normalizeText = defaultNormalizeText) {
  const text = normalizeText(value).toLowerCase();
  if (["failed", "fail", "error", "失败"].includes(text)) {
    return "failed";
  }
  if (["partial", "partial_success", "partially_completed", "部分成功"].includes(text)) {
    return "partial";
  }
  if (["running", "in_progress", "运行中"].includes(text)) {
    return "running";
  }
  return "completed";
}

function buildAdShotSubscriptionCopyJson(subscription) {
  return {
    id: subscription.id,
    name: subscription.name,
    description: subscription.description,
    projectId: subscription.projectId,
    sourcePlatform: subscription.sourcePlatform,
    sourceModule: subscription.sourceModule,
    status: subscription.status,
    schedule: subscription.schedule,
    filters: subscription.filters,
    sampling: subscription.sampling,
    analysis: subscription.analysis
  };
}

function defaultTruncateText(value, maxLength) {
  const text = defaultNormalizeText(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function defaultSlugifyId(value) {
  return defaultNormalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function defaultNormalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
