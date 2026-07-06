import {
  createAdShotSubscriptionService
} from "./subscription-service.mjs";

export function createAdShotSubscriptionServices(deps = {}) {
  const requiredDeps = [
    "coreDeps",
    "normalizeText",
    "truncateText",
    "slugifyId",
    "createJobId",
    "formatDate"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAdShotSubscriptionServices 缺少依赖：${dep}`);
    }
  }

  const {
    coreDeps,
    normalizeText,
    truncateText,
    slugifyId,
    createJobId,
    formatDate
  } = deps;
  const {
    readAdShotProjects,
    readAdShotSubscriptionsRaw,
    writeAdShotSubscriptionsRaw,
    readAdShotSubscriptionLogsRaw,
    writeAdShotSubscriptionLogsRaw
  } = coreDeps;

  const adShotSubscriptionService = createAdShotSubscriptionService({
    readProjects: readAdShotProjects,
    readSubscriptionsRaw: readAdShotSubscriptionsRaw,
    writeSubscriptionsRaw: writeAdShotSubscriptionsRaw,
    readLogsRaw: readAdShotSubscriptionLogsRaw,
    writeLogsRaw: writeAdShotSubscriptionLogsRaw,
    createJobId,
    formatDate,
    normalizeText,
    truncateText,
    slugifyId
  });
  const {
    readAdShotSubscriptions,
    readAdShotSubscriptionLogs,
    saveAdShotSubscription,
    deleteAdShotSubscription,
    appendAdShotSubscriptionLog
  } = adShotSubscriptionService;

  return {
    routeDeps: {
      readAdShotSubscriptions,
      readAdShotSubscriptionLogs,
      saveAdShotSubscription,
      deleteAdShotSubscription,
      appendAdShotSubscriptionLog
    }
  };
}
