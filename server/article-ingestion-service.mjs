import path from "node:path";
import { promises as fs } from "node:fs";

export function createArticleIngestionService(deps = {}) {
  const requiredDeps = [
    "findAppById",
    "readArticles",
    "writeArticles",
    "runArticleExtractor",
    "ensureDir",
    "createJobId",
    "formatDate",
    "normalizeToPublicPath",
    "pickResultAppFields",
    "truncateText",
    "articleBundlesDir"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createArticleIngestionService 缺少依赖：${dep}`);
    }
  }

  async function runArticleIngestion(articleUrl, appId) {
    const app = await deps.findAppById(appId);
    if (!app) {
      throw new Error("选择的 App 不存在，请先重新录入或刷新页面。");
    }

    const slug = deps.createJobId();
    const bundleDir = path.join(deps.articleBundlesDir, slug);
    await deps.ensureDir(bundleDir);
    await deps.runArticleExtractor(articleUrl, bundleDir);

    const manifest = JSON.parse(await fs.readFile(path.join(bundleDir, "manifest.json"), "utf8"));
    const coreInsights = buildArticleCoreInsights(manifest);
    await writeArticleBrief(bundleDir, manifest, coreInsights);
    const article = buildArticleRecord({
      id: slug,
      manifest,
      bundleDir,
      app,
      createdAt: deps.formatDate(new Date()),
      coreInsights,
      ownedBundle: true
    });

    const articles = await deps.readArticles();
    articles.unshift(article);
    await deps.writeArticles(articles);
    return article;
  }

  function buildArticleRecord({ id, manifest, bundleDir, app, createdAt, coreInsights, ownedBundle }) {
    const cover = Array.isArray(manifest.images) ? manifest.images[0] : null;
    const firstParagraph = Array.isArray(manifest.contentBlocks)
      ? manifest.contentBlocks.find((block) => block.type === "paragraph")?.text || ""
      : "";
    const bundlePath = deps.normalizeToPublicPath(bundleDir);

    return {
      id,
      sourceUrl: manifest.sourceUrl,
      title: manifest.title || "未命名文章",
      subtitle: manifest.subtitle || "",
      sourceName: manifest.sourceName || manifest.sourceDomain || "",
      sourceDomain: manifest.sourceDomain || "",
      author: manifest.author || "",
      publishedAt: manifest.publishedAt || "",
      createdAt,
      appId: app.id,
      app: deps.pickResultAppFields(app),
      bundlePath,
      manifestPath: `${bundlePath}/manifest.json`,
      cleanMarkdownPath: `${bundlePath}/clean.md`,
      briefMarkdownPath: `${bundlePath}/brief.md`,
      coverImagePath: cover?.localPath ? `${bundlePath}/${cover.localPath}` : "",
      imageCount: Array.isArray(manifest.images) ? manifest.images.length : 0,
      contentBlockCount: Array.isArray(manifest.contentBlocks) ? manifest.contentBlocks.length : 0,
      excerpt: manifest.subtitle || firstParagraph,
      coreInsights: coreInsights || buildArticleCoreInsights(manifest),
      ownedBundle
    };
  }

  async function writeArticleBrief(bundleDir, manifest, coreInsights) {
    const lines = [
      `# ${manifest.title || "未命名文章"} - 精简版`,
      "",
      `- Source: ${manifest.sourceName || manifest.sourceDomain || ""}`,
      `- URL: ${manifest.sourceUrl || ""}`,
      manifest.author ? `- Author: ${manifest.author}` : "",
      manifest.publishedAt ? `- Published: ${manifest.publishedAt}` : "",
      "",
      "## 核心观点",
      ...coreInsights.map((point, index) => `${index + 1}. ${point}`),
      "",
      "## 摘要",
      manifest.subtitle || coreInsights.join(" ")
    ].filter((line) => line !== "");

    await fs.writeFile(path.join(bundleDir, "brief.md"), lines.join("\n"), "utf8");
  }

  function buildArticleCoreInsights(manifest) {
    const blocks = Array.isArray(manifest.contentBlocks) ? manifest.contentBlocks : [];
    const sourceTexts = blocks
      .filter((block) => ["paragraph", "quote"].includes(block.type))
      .map((block) => String(block.text || "").trim())
      .filter((text) => text.length > 40);

    const fallbackTexts = [manifest.subtitle, manifest.title].filter(Boolean);
    const candidates = sourceTexts.length ? sourceTexts : fallbackTexts;
    const insights = candidates.slice(0, 5).map((text) => deps.truncateText(text, 120));

    while (insights.length < 5) {
      insights.push("暂无更多可提炼观点。");
    }
    return insights;
  }

  return {
    runArticleIngestion,
    buildArticleRecord,
    writeArticleBrief,
    buildArticleCoreInsights
  };
}
