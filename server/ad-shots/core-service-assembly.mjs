import {
  json,
  sendHtml
} from "../http-utils.mjs";
import {
  renderAdShotHtml
} from "./detail-renderer.mjs";
import {
  normalizeAdShotRecord as normalizeAdShotRecordBase
} from "./normalizers.mjs";
import {
  createAdShotProjectService
} from "./project-service.mjs";
import {
  createAdShotServerAdapter
} from "./server-adapter.mjs";
import {
  createAdShotStorageService
} from "./storage-service.mjs";

export function createAdShotCoreServices(deps = {}) {
  const requiredDeps = [
    "paths",
    "readJsonArrayFile",
    "writeJsonFileAtomic",
    "analysisDeps",
    "normalizeStringArray",
    "normalizeText",
    "truncateText",
    "normalizeToPublicPath",
    "resolveProjectPublicPath",
    "slugifyId",
    "createJobId",
    "formatDate"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAdShotCoreServices 缺少依赖：${dep}`);
    }
  }

  const {
    paths,
    readJsonArrayFile,
    writeJsonFileAtomic,
    analysisDeps,
    normalizeStringArray,
    normalizeText,
    truncateText,
    normalizeToPublicPath,
    resolveProjectPublicPath,
    slugifyId,
    createJobId,
    formatDate
  } = deps;
  const {
    adShotsFile,
    adShotProjectsFile,
    adShotCandidatesFile,
    adShotSubscriptionsFile,
    adShotSubscriptionLogsFile
  } = paths;
  const {
    normalizeVisualTextSegments
  } = analysisDeps;

  let readAdShots;
  const adShotServerAdapter = createAdShotServerAdapter({
    readJsonArrayFile,
    writeJsonFileAtomic,
    adShotProjectsFile,
    normalizeAdShotRecordBase,
    normalizeVisualTextSegments,
    normalizeText,
    normalizeToPublicPath,
    readAdShots: (...args) => readAdShots(...args),
    json,
    sendHtml,
    renderAdShotHtml
  });
  const {
    readAdShotProjectsRaw,
    writeAdShotProjectsRaw,
    normalizeAdShotRecord,
    serveAdShotPage
  } = adShotServerAdapter;

  const adShotProjectService = createAdShotProjectService({
    readProjectsRaw: readAdShotProjectsRaw,
    writeProjectsRaw: writeAdShotProjectsRaw,
    readShots: (...args) => readAdShots(...args),
    writeShots: (...args) => writeAdShots(...args),
    readSubscriptionLogsRaw: (...args) => readAdShotSubscriptionLogsRaw(...args),
    normalizeAdShotRecord,
    normalizeStringArray,
    normalizeText,
    truncateText,
    slugifyId,
    createJobId,
    formatDate
  });
  const {
    assignAdShotProjects,
    defaultAdShotProjects,
    readAdShotProjects,
    readAdShotProjectsWithStats,
    saveAdShotProjects
  } = adShotProjectService;

  const adShotStorageService = createAdShotStorageService({
    readJsonArrayFile,
    writeJsonFile: writeJsonFileAtomic,
    readProjects: readAdShotProjects,
    normalizeAdShotRecord,
    normalizeText,
    resolveProjectPublicPath,
    files: {
      adShots: adShotsFile,
      candidates: adShotCandidatesFile,
      subscriptions: adShotSubscriptionsFile,
      subscriptionLogs: adShotSubscriptionLogsFile
    }
  });
  const {
    readAdShots: readAdShotsFromStorage,
    readAdShotById,
    writeAdShots,
    readAdShotCandidates,
    writeAdShotCandidates,
    readAdShotSubscriptionsRaw,
    writeAdShotSubscriptionsRaw,
    readAdShotSubscriptionLogsRaw,
    writeAdShotSubscriptionLogsRaw
  } = adShotStorageService;
  readAdShots = readAdShotsFromStorage;

  return {
    defaultAdShotProjects,
    normalizeAdShotRecord,
    serveAdShotPage,
    readAdShots,
    readAdShotById,
    writeAdShots,
    readAdShotCandidates,
    writeAdShotCandidates,
    readAdShotProjects,
    readAdShotProjectsWithStats,
    assignAdShotProjects,
    saveAdShotProjects,
    readAdShotSubscriptionsRaw,
    writeAdShotSubscriptionsRaw,
    readAdShotSubscriptionLogsRaw,
    writeAdShotSubscriptionLogsRaw
  };
}
