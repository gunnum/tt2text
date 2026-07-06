#!/usr/bin/env node
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.dirname(__dirname);

const sourceUrl = process.argv[2];
const targetDirArg = process.argv[3];

if (!sourceUrl || !targetDirArg) {
  console.error("usage: extract_article_bundle.mjs <url> <target_dir>");
  process.exit(1);
}

const targetDir = path.isAbsolute(targetDirArg) ? targetDirArg : path.join(ROOT, targetDirArg);
const assetsDir = path.join(targetDir, "assets");
const ocrDir = path.join(targetDir, "ocr");

await fs.mkdir(targetDir, { recursive: true });
await fs.mkdir(assetsDir, { recursive: true });
await fs.mkdir(ocrDir, { recursive: true });

const html = await fetchText(sourceUrl);
await fs.writeFile(path.join(targetDir, "raw.html"), html, "utf8");

const metadata = extractMetadata(html, sourceUrl);
const extraction = extractMainContent(html, metadata);
const manifest = buildManifest(metadata, extraction, sourceUrl);

await fs.writeFile(path.join(targetDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
await writeCleanMarkdown(targetDir, manifest, extraction);
await downloadImages(sourceUrl, targetDir, manifest.images);
await writeOcrPlaceholders(targetDir, manifest.images);
await writeManifest(targetDir, manifest);

console.log(
  JSON.stringify(
    {
      title: manifest.title,
      blocks: manifest.contentBlocks.length,
      images: manifest.images.length,
      sourceName: manifest.sourceName,
    },
    null,
    2,
  ),
);

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`fetch failed: ${response.status} ${response.statusText}`);
  return await response.text();
}

function extractMetadata(html, sourceUrl) {
  const graph = extractJsonLdGraph(html);
  const article = graph.find((item) => item?.["@type"] === "Article") || {};
  const page = graph.find((item) => item?.["@type"] === "WebPage") || {};
  const org = graph.find((item) => item?.["@type"] === "Organization") || {};

  const title =
    article.headline ||
    metaContent(html, "og:title") ||
    extractTagText(html, "title") ||
    extractTagText(html, "h1") ||
    page.name ||
    "";

  const subtitle =
    metaContent(html, "description") ||
    metaContent(html, "og:description") ||
    extractFirstTagText(html, ["h2", "p"], /standfirst|subtitle|deck/i) ||
    "";

  const primaryImageUrl =
    metaContent(html, "og:image") ||
    extractFirstFigureImageUrl(html) ||
    "";

  return {
    sourceUrl,
    sourceName: metaContent(html, "og:site_name") || org.name || new URL(sourceUrl).hostname.replace(/^www\./, ""),
    sourceDomain: new URL(sourceUrl).hostname,
    title: cleanText(title),
    subtitle: cleanText(subtitle),
    author:
      extractContributorName(html) ||
      article.author?.name ||
      metaContent(html, "author") ||
      "",
    publishedAt:
      article.datePublished ||
      metaContent(html, "article:published_time") ||
      extractTimeDatetime(html) ||
      "",
    modifiedAt: article.dateModified || metaContent(html, "article:modified_time") || "",
    language:
      article.inLanguage ||
      page.inLanguage ||
      html.match(/<html[^>]*lang=["']([^"']+)/i)?.[1] ||
      "en",
    keywords: parseKeywords(metaContent(html, "keywords")),
    section: parseKeywords(metaContent(html, "article:section")),
    wordCount: article.wordCount ? Number(article.wordCount) : null,
    primaryImageUrl,
    primaryImageCaption: extractFirstFigureCaption(html) || "",
  };
}

function extractMainContent(html, metadata) {
  const articleHtml = extractElementByTagAndClass(html, "article", /(^|\s)main-article(\s|$)/i) || extractElementByTag(html, "article") || html;
  const bodyStart = articleHtml.search(/<div class="article-body wrapper">/i);
  const bodyHtml = bodyStart >= 0 ? extractBalancedElement(articleHtml, bodyStart, "div") : articleHtml;

  const contentBlocks = [];
  const images = [];
  const seenImages = new Set();
  let order = 0;

  const primary = metadata.primaryImageUrl ? makeImageRecord(metadata.primaryImageUrl, "img001", metadata.title || "Image", metadata.primaryImageCaption || "") : null;
  globalThis.__articleImageCounter = primary ? 2 : 1;
  if (primary) {
    images.push(primary);
    contentBlocks.push({
      id: `b${String(++order).padStart(3, "0")}`,
      type: "image",
      imageId: primary.id,
      text: primary.alt || primary.caption || "Cover image",
      sourceUrl: primary.sourceUrl,
      localPath: primary.localPath,
      alt: primary.alt,
      caption: primary.caption,
    });
    seenImages.add(primary.sourceUrl);
  }

  const tagRe =
    /<figure\b[\s\S]*?<\/figure>|<(h1|h2|h3|h4|h5|h6|p|blockquote|li)\b[^>]*>[\s\S]*?<\/\1>|<img\b[^>]*\/?>/gi;
  for (const match of bodyHtml.matchAll(tagRe)) {
    const tag = match[0];
    if (isNoiseBlock(tag)) continue;

    const lower = tag.toLowerCase();
    if (lower.startsWith("<figure")) {
      const image = extractFigureImage(tag, metadata);
      if (image && !seenImages.has(image.sourceUrl)) {
        seenImages.add(image.sourceUrl);
        images.push(image);
        contentBlocks.push({
          id: `b${String(++order).padStart(3, "0")}`,
          type: "image",
          imageId: image.id,
          text: image.alt || image.caption || "Image",
          sourceUrl: image.sourceUrl,
          localPath: image.localPath,
          alt: image.alt,
          caption: image.caption,
        });
      }
      continue;
    }

    if (lower.startsWith("<img")) {
      const image = extractImageFromTag(tag, metadata);
      if (image && !seenImages.has(image.sourceUrl)) {
        seenImages.add(image.sourceUrl);
        images.push(image);
        contentBlocks.push({
          id: `b${String(++order).padStart(3, "0")}`,
          type: "image",
          imageId: image.id,
          text: image.alt || image.caption || "Image",
          sourceUrl: image.sourceUrl,
          localPath: image.localPath,
          alt: image.alt,
          caption: image.caption,
        });
      }
      continue;
    }

    const text = cleanText(tag);
    if (!text) continue;
    if (isNoiseText(text)) break;
    if (/^related stories$/i.test(text)) break;
    if (/^trending$/i.test(text)) break;

    const type = classifyTag(tag);
    contentBlocks.push({
      id: `b${String(++order).padStart(3, "0")}`,
      type,
      text,
    });
  }

  const contentHash = createHash("sha256")
    .update(contentBlocks.map((block) => `${block.type}:${block.text || block.sourceUrl || ""}`).join("\n\n"))
    .digest("hex");

  return { contentBlocks, images, contentHash };
}

function buildManifest(metadata, extraction, sourceUrl) {
  return {
    schemaVersion: "tt2text.articleBundle.v1",
    kind: "article",
    sourceUrl,
    sourceName: metadata.sourceName,
    sourceDomain: metadata.sourceDomain,
    title: metadata.title,
    subtitle: metadata.subtitle,
    author: metadata.author,
    publishedAt: metadata.publishedAt,
    modifiedAt: metadata.modifiedAt,
    language: metadata.language,
    keywords: metadata.keywords,
    section: metadata.section,
    wordCount: metadata.wordCount,
    fetchedAt: nowShanghai(),
    files: {
      rawHtml: "raw.html",
      cleanMarkdown: "clean.md",
    },
    images: extraction.images,
    contentBlocks: extraction.contentBlocks,
    extractionNotes: [
      "Auto-extracted from article HTML.",
      "Images include the cover and inline content images where available.",
      "Filtered obvious navigation, related-story, newsletter, and ad blocks.",
    ],
    contentHash: extraction.contentHash,
  };
}

async function writeCleanMarkdown(targetDir, manifest, extraction) {
  const lines = [];
  lines.push(`# ${manifest.title}`);
  if (manifest.subtitle) {
    lines.push("");
    lines.push(`> ${manifest.subtitle}`);
  }
  lines.push("");
  lines.push(`- Source: ${manifest.sourceName}`);
  lines.push(`- URL: ${manifest.sourceUrl}`);
  if (manifest.author) lines.push(`- Author: ${manifest.author}`);
  if (manifest.publishedAt) lines.push(`- Published: ${manifest.publishedAt}`);
  lines.push("");

  for (const block of extraction.contentBlocks) {
    if (block.type === "image") {
      lines.push(`![${block.alt || block.text}](${block.localPath || ""})`);
      if (block.caption) lines.push(`_${block.caption}_`);
      lines.push("");
      continue;
    }
    if (block.type === "caption") {
      lines.push(`_${block.text}_`);
      lines.push("");
      continue;
    }
    if (block.type === "heading1") lines.push(`# ${block.text}`);
    else if (block.type === "heading2") lines.push(`## ${block.text}`);
    else if (block.type === "heading3") lines.push(`### ${block.text}`);
    else if (block.type === "heading4") lines.push(`#### ${block.text}`);
    else if (block.type === "quote") lines.push(`> ${block.text}`);
    else if (block.type === "listItem") lines.push(`- ${block.text}`);
    else lines.push(block.text);
    lines.push("");
  }
  await fs.writeFile(path.join(targetDir, "clean.md"), lines.join("\n"), "utf8");
}

async function downloadImages(sourceUrl, targetDir, images) {
  for (const image of images) {
    const outPath = path.join(targetDir, image.localPath);
    if (await exists(outPath)) {
      const bytes = await fs.readFile(outPath);
      image.bytes = bytes.length;
      image.sha256 = createHash("sha256").update(bytes).digest("hex");
      continue;
    }
    try {
      const response = await fetch(image.sourceUrl, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
          accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          referer: sourceUrl,
        },
      });
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(outPath, bytes);
      image.bytes = bytes.length;
      image.sha256 = createHash("sha256").update(bytes).digest("hex");
    } catch {
      // keep bundle usable even if one image fails
    }
  }
}

async function writeOcrPlaceholders(targetDir, images) {
  for (const image of images) {
    const ocrPath = path.join(targetDir, image.ocrPath || `ocr/${image.id}.json`);
    if (await exists(ocrPath)) continue;
    await fs.writeFile(
      ocrPath,
      JSON.stringify(
        {
          imageId: image.id,
          status: "not_run",
          text: "",
          note: "Placeholder for OCR or image caption extraction.",
        },
        null,
        2,
      ),
      "utf8",
    );
  }
}

async function writeManifest(targetDir, manifest) {
  await fs.writeFile(path.join(targetDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

function extractJsonLdGraph(html) {
  const matches = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of matches) {
    const text = match[1].trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.["@graph"]) return parsed["@graph"];
      if (parsed?.["@type"]) return [parsed];
    } catch {
      // ignore broken json-ld
    }
  }
  return [];
}

function metaContent(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1]);
  }
  return "";
}

function extractElementByTag(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>`, "i");
  const open = html.match(re);
  if (!open) return "";
  const start = open.index ?? 0;
  return extractBalancedElement(html, start, tag);
}

function extractElementByTagAndClass(html, tag, classPattern) {
  const openRe = new RegExp(`<${tag}\\b[^>]*class=["'][^"']*${classPattern.source.replace(/^\/|\/[gimsuy]*$/g, "")}[^"']*["'][^>]*>`, "i");
  const open = html.match(openRe);
  if (!open) return "";
  const start = open.index ?? 0;
  return extractBalancedElement(html, start, tag);
}

function extractBalancedElement(html, startIndex, tag) {
  const openTag = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const closeTag = new RegExp(`</${tag}>`, "gi");
  openTag.lastIndex = startIndex;
  closeTag.lastIndex = startIndex;
  let depth = 0;
  let cursor = startIndex;
  while (cursor < html.length) {
    openTag.lastIndex = cursor;
    closeTag.lastIndex = cursor;
    const open = openTag.exec(html);
    const close = closeTag.exec(html);
    if (!close) return html.slice(startIndex);
    if (open && open.index < close.index) {
      depth += 1;
      cursor = openTag.lastIndex;
      continue;
    }
    depth -= 1;
    cursor = closeTag.lastIndex;
    if (depth === 0) {
      return html.slice(startIndex, cursor);
    }
  }
  return html.slice(startIndex);
}

function extractFirstFigureImageUrl(html) {
  const figure = html.match(/<figure\b[\s\S]*?<\/figure>/i);
  if (!figure) return "";
  return extractImgUrl(figure[0]);
}

function extractFirstFigureCaption(html) {
  const figure = html.match(/<figure\b[\s\S]*?<\/figure>/i);
  if (!figure) return "";
  const match = figure[0].match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
  return match ? cleanText(match[0]) : "";
}

function extractFigureImage(tag, metadata) {
  const imgTags = [...tag.matchAll(/<img\b[\s\S]*?>/gi)].map((match) => match[0]);
  const contentImg = imgTags.find((imgTag) => isUsableImageUrl(extractImgUrl(imgTag)));
  const sourceUrl = [extractImgUrl(tag), contentImg ? extractImgUrl(contentImg) : ""].find(isUsableImageUrl) || "";
  if (!sourceUrl) return null;
  const alt = (contentImg && extractAttr(contentImg, "alt")) || extractAttr(tag, "alt") || metadata.title || "Image";
  const caption = extractFigureCaption(tag);
  return makeImageRecord(sourceUrl, nextImageId(), alt, caption);
}

function extractImageFromTag(tag, metadata) {
  const sourceUrl = extractImgUrl(tag);
  if (!isUsableImageUrl(sourceUrl)) return null;
  const alt = extractAttr(tag, "alt") || metadata.title || "Image";
  return makeImageRecord(sourceUrl, nextImageId(), alt, "");
}

function extractFigureCaption(tag) {
  const match = tag.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
  return match ? cleanText(match[0]) : "";
}

function extractImgUrl(tag) {
  return (
    extractAttr(tag, "data-src") ||
    extractAttr(tag, "src") ||
    extractSrcsetLargest(tag) ||
    ""
  );
}

function isUsableImageUrl(value) {
  return Boolean(value && !value.startsWith("data:") && /^https?:\/\//i.test(value));
}

function extractSrcsetLargest(tag) {
  const match = tag.match(/srcset=["']([^"']+)["']/i);
  if (!match) return "";
  const entries = match[1]
    .split(",")
    .map((part) => part.trim())
    .map((part) => {
      const [url, size] = part.split(/\s+/);
      const width = Number((size || "").replace(/w$/, "")) || 0;
      return { url, width };
    })
    .filter((item) => item.url);
  entries.sort((a, b) => b.width - a.width);
  return entries[0]?.url || "";
}

function extractAttr(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`${escaped}=["']([^"']*)["']`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function extractTagText(html, tag) {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? cleanText(match[0]) : "";
}

function extractFirstTagText(html, tags, classPattern) {
  for (const tag of tags) {
    const re = new RegExp(`<${tag}\\b[^>]*class=["'][^"']*${classPattern.source.replace(/^\/|\/[gimsuy]*$/g, "")}[^"']*["'][^>]*>([\\s\\S]*?)</${tag}>`, "i");
    const match = html.match(re);
    if (match) return cleanText(match[0]);
  }
  return "";
}

function extractContributorName(html) {
  const match = html.match(/class=["'][^"']*contributor-name[^"']*["'][^>]*>\s*([^<\n\r]+)\s*</i);
  return match ? cleanText(match[1]) : "";
}

function extractTimeDatetime(html) {
  const match = html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i);
  return match ? match[1] : "";
}

function parseKeywords(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => cleanText(part))
    .filter(Boolean);
}

function cleanText(value = "") {
  return decodeEntities(
    String(value)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " "),
  );
}

function decodeEntities(value = "") {
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "—")
    .replace(/&hellip;/g, "…")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8217;/g, "’")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseText(text) {
  return [
    /^related stories$/i,
    /^trending$/i,
    /^sign up for/i,
    /^newsletter/i,
    /^about your privacy$/i,
    /^save article$/i,
    /^read more$/i,
    /^share article$/i,
    /^advertisement$/i,
    /^follow us/i,
    /^comments?$/i,
    /^escape the algorithm!/i,
    /^get must-see stories direct to your inbox every weekday\.$/i,
    /^privacy policy$/i,
    /^thank you\. you have been subscribed$/i,
  ].some((rule) => rule.test(text));
}

function isNoiseBlock(tag) {
  return /class=["'][^"']*(nav|menu|footer|newsletter|advert|ad-|related|split-list|split-rail|breadcrumb|sidebar|promo)[^"']*["']/i.test(tag);
}

function classifyTag(tag) {
  const lower = tag.toLowerCase();
  if (lower.startsWith("<h1")) return "heading1";
  if (lower.startsWith("<h2")) return "heading2";
  if (lower.startsWith("<h3")) return "heading3";
  if (lower.startsWith("<h4")) return "heading4";
  if (lower.startsWith("<blockquote")) return "quote";
  if (lower.startsWith("<li")) return "listItem";
  return "paragraph";
}

function makeImageRecord(sourceUrl, id, alt, caption) {
  const fileExt = guessImageExt(sourceUrl);
  return {
    id,
    role: id === "img001" ? "primary" : "inline",
    sourceUrl,
    localPath: `assets/${id}.${fileExt}`,
    alt: alt || "Image",
    caption: caption || "",
    width: null,
    height: null,
    contentBlockAfter: null,
    ocrPath: `ocr/${id}.json`,
  };
}

function nextImageId() {
  if (!globalThis.__articleImageCounter) globalThis.__articleImageCounter = 1;
  const id = `img${String(globalThis.__articleImageCounter).padStart(3, "0")}`;
  globalThis.__articleImageCounter += 1;
  return id;
}

function guessImageExt(url) {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".webp")) return "webp";
  if (lower.endsWith(".gif")) return "gif";
  return "jpg";
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function nowShanghai() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date())
    .replace(/\//g, "-");
}
