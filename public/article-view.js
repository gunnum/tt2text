import { fetchJson } from "./js/core/http.js";
import { fetchText } from "./js/core/text.js";
import { escapeAttribute, escapeHtml } from "./js/core/format.js";

const params = new URLSearchParams(window.location.search);
const articleId = params.get("id");
const contentEl = document.querySelector("#reader-content");
const sourceEl = document.querySelector("#reader-source");
const rawLink = document.querySelector("#raw-link");

try {
  if (!articleId) {
    throw new Error("缺少文章 id。");
  }

  const articles = await fetchJson("/api/articles");
  const article = articles.find((item) => item.id === articleId);
  if (!article) {
    throw new Error("没有找到这篇文章。");
  }

  const markdownPath = article.cleanMarkdownPath;
  rawLink.href = markdownPath;
  sourceEl.textContent = [article.sourceName, article.author].filter(Boolean).join(" / ");

  const markdown = await fetchText(markdownPath);
  const basePath = markdownPath.split("/").slice(0, -1).join("/");
  document.title = `${article.title} - Article View`;
  contentEl.innerHTML = renderMarkdown(markdown, basePath);
} catch (error) {
  contentEl.textContent = `读取失败：${error.message}`;
}

function renderMarkdown(markdown, basePath) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    html.push(`<${list.type}>${list.items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${list.type}>`);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      flushParagraph();
      flushList();
      const alt = escapeHtml(image[1]);
      const src = resolveAssetPath(image[2], basePath);
      html.push(`<figure><img src="${escapeAttribute(src)}" alt="${alt}" /></figure>`);
      continue;
    }

    const italicOnly = line.match(/^_([^_]+)_$/);
    if (italicOnly && html.at(-1)?.startsWith("<figure>")) {
      html[html.length - 1] = html.at(-1).replace("</figure>", `<figcaption>${escapeHtml(italicOnly[1])}</figcaption></figure>`);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (line.startsWith("> ")) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${inlineMarkdown(line.slice(2))}</blockquote>`);
      continue;
    }

    const orderedItem = line.match(/^\d+\.\s+(.+)$/);
    const unorderedItem = line.match(/^-\s+(.+)$/);
    if (orderedItem || unorderedItem) {
      flushParagraph();
      const type = orderedItem ? "ol" : "ul";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(orderedItem?.[1] || unorderedItem?.[1]);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return html.join("\n");
}

function resolveAssetPath(src, basePath) {
  if (/^(https?:|data:|\/)/i.test(src)) {
    return src;
  }
  return `${basePath}/${src}`.replace(/\/{2,}/g, "/");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
