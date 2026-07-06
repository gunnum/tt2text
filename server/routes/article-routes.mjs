import {
  createRouteHandlerFactory,
  exactPath,
  sendJson,
  withRequiredString,
  withRouteBody,
  withStringIdList
} from "./route-utils.mjs";

export const articleRouteDeps = [
  "readArticles",
  "findDuplicateArticle",
  "runArticleIngestion",
  "searchAndImportArticles",
  "deleteArticles"
];

export const createArticleRoutes = createRouteHandlerFactory("createArticleRoutes", articleRouteDeps, (deps) => {
  const {
    readArticles,
    findDuplicateArticle,
    runArticleIngestion,
    searchAndImportArticles,
    deleteArticles
  } = deps;

  return [
    {
      method: "GET",
      match: exactPath("/api/articles"),
      handle: async ({ res }) => sendJson(res, 200, await readArticles())
    },
    {
      method: "POST",
      match: exactPath("/api/articles"),
      handle: withRouteBody(
        withRequiredString(
          "url",
          "缺少文章链接。",
          withRequiredString("appId", "请先选择对应 App。", async ({ res, articleUrl, appId }) => {
            const duplicate = await findDuplicateArticle(articleUrl);
            if (duplicate) {
              return sendJson(res, 409, {
                error: "这篇文章已经录入过了。",
                duplicate
              });
            }

            const article = await runArticleIngestion(articleUrl, appId);
            return sendJson(res, 200, article);
          }),
          { trim: true, as: "articleUrl" }
        )
      )
    },
    {
      method: "POST",
      match: exactPath("/api/articles/search-import"),
      handle: withRouteBody(
        withRequiredString("appId", "请先选择对应 App。", async ({ res, body }) => {
          const payload = await searchAndImportArticles(body);
          return sendJson(res, 200, payload);
        })
      )
    },
    {
      method: "POST",
      match: exactPath("/api/articles/delete"),
      handle: withRouteBody(
        withStringIdList(async ({ res, ids }) => {
          const payload = await deleteArticles(ids);
          return sendJson(res, 200, payload);
        })
      )
    }
  ];
});
