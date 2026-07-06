import {
  createArticleIngestionService
} from "./article-ingestion-service.mjs";
import {
  createArticleRunnerService
} from "./article-runner-service.mjs";
import {
  createArticleSearchService
} from "./article-search-service.mjs";

export function createArticleServices(deps = {}) {
  const requiredDeps = [
    "runtimeConfig",
    "appDeps",
    "readArticles",
    "writeArticles",
    "ensureDir",
    "createJobId",
    "formatDate",
    "normalizeToPublicPath",
    "truncateText",
    "normalizeText",
    "normalizeSourceUrl"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createArticleServices 缺少依赖：${dep}`);
    }
  }

  const {
    runtimeConfig,
    appDeps,
    readArticles,
    writeArticles,
    ensureDir,
    createJobId,
    formatDate,
    normalizeToPublicPath,
    truncateText,
    normalizeText,
    normalizeSourceUrl,
    env = process.env
  } = deps;
  const requiredAppDeps = [
    "findAppById",
    "pickResultAppFields"
  ];
  for (const dep of requiredAppDeps) {
    if (!appDeps[dep]) {
      throw new Error(`createArticleServices.appDeps 缺少依赖：${dep}`);
    }
  }
  const {
    findAppById,
    pickResultAppFields
  } = appDeps;
  const {
    projectRootDir,
    articleBundlesDir,
    articleRunner
  } = runtimeConfig.paths;

  const articleRunnerService = createArticleRunnerService({
    articleRunner,
    projectRootDir,
    env
  });
  const { runArticleExtractor } = articleRunnerService;

  const articleIngestionService = createArticleIngestionService({
    findAppById,
    readArticles,
    writeArticles,
    runArticleExtractor,
    ensureDir,
    createJobId,
    formatDate,
    normalizeToPublicPath,
    pickResultAppFields,
    truncateText,
    articleBundlesDir
  });
  const { runArticleIngestion } = articleIngestionService;

  const articleSearchService = createArticleSearchService({
    findAppById,
    readArticles,
    runArticleIngestion,
    pickResultAppFields,
    normalizeText,
    normalizeSourceUrl
  });
  const { searchAndImportArticles } = articleSearchService;

  return {
    routeDeps: {
      readArticles,
      runArticleIngestion,
      searchAndImportArticles
    }
  };
}
