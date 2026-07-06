import { escapeAttribute, escapeHtml, formatAppDisplayName, getSortTime, normalizeUrl } from "./core/format.js";
import { setStatus, showToast } from "./core/ui.js";

const appList = document.querySelector("#app-list");
const appEditToggle = document.querySelector("#app-edit-toggle");
const articleForm = document.querySelector("#article-form");
const articleSearchButton = document.querySelector("#article-search-button");
const articleSearchLimitSelect = document.querySelector("#article-search-limit");
const articleSearchStatus = document.querySelector("#article-search-status");
const selectedAppBadge = document.querySelector("#selected-app-badge");
const statusEl = document.querySelector("#status");
const articleList = document.querySelector("#article-list");
const toastEl = document.querySelector("#toast");

let apps = [];
let currentArticles = [];
let selectedAppId = "";
let isAppEditMode = false;

appEditToggle?.addEventListener("click", () => {
  isAppEditMode = !isAppEditMode;
  renderApps(selectedAppId);
});

  articleForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = articleForm.querySelector("button[type='submit']");
    const input = articleForm.querySelector("input[name='url']");
    const url = input.value.trim();

    if (!selectedAppId) {
      setStatus(statusEl, "请先选择这篇文章对应的 App。");
      return;
    }
    if (!url) {
      setStatus(statusEl, "请先输入文章链接。");
      return;
    }

    const duplicate = findDuplicateArticle(url);
    if (duplicate) {
      const message = `这篇文章已经录入过了：${duplicate.title || duplicate.createdAt}`;
      setStatus(statusEl, message);
      showToast(toastEl, message);
      return;
    }

    submitButton.disabled = true;
    setStatus(statusEl, "正在录入文章：抓取 HTML、提取正文和图片，并生成文章 bundle。");
    try {
      const response = await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, appId: selectedAppId })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "录入文章失败");
      }
      input.value = "";
      await loadArticles();
      setStatus(statusEl, "文章录入完成，已经加入文章列表。");
      showToast(toastEl, "文章录入完成");
    } catch (error) {
      setStatus(statusEl, `录入文章失败：${error.message}`);
      showToast(toastEl, `录入文章失败：${error.message}`);
    } finally {
      submitButton.disabled = false;
    }
  });

  articleSearchButton?.addEventListener("click", async () => {
    const app = apps.find((item) => item.id === selectedAppId);
    if (!app) {
      const message = "请先选择要搜索文章的 App。";
      setStatus(statusEl, message);
      if (articleSearchStatus) articleSearchStatus.textContent = message;
      return;
    }

    const limit = getArticleSearchLimit();
    articleSearchButton.disabled = true;
    articleSearchButton.textContent = "搜索录入中...";
    const pendingMessage = `正在全网搜索 ${formatAppDisplayName(app.name)} 相关文章，并尝试录入 ${limit} 条高质量候选。`;
    setStatus(statusEl, pendingMessage);
    if (articleSearchStatus) {
      articleSearchStatus.textContent = "正在搜索、去重、过滤低质页面，并逐条生成文章 bundle。";
    }

    try {
      const response = await fetch("/api/articles/search-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId: app.id, limit })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "全网搜索文章失败");
      }

      const importedCount = Array.isArray(payload.imported) ? payload.imported.length : 0;
      const failedCount = Array.isArray(payload.failed) ? payload.failed.length : 0;
      const skippedCount = Array.isArray(payload.skipped) ? payload.skipped.length : 0;
      const message = `文章搜索完成：搜索候选 ${payload.searched || 0} 条，录入 ${importedCount}/${payload.requested || limit} 条，跳过 ${skippedCount} 条，失败 ${failedCount} 条。`;
      setStatus(statusEl, message);
      if (articleSearchStatus) articleSearchStatus.textContent = message;
      showToast(toastEl, message);
      await loadArticles();
    } catch (error) {
      const message = `全网搜索文章失败：${error.message}`;
      setStatus(statusEl, message);
      if (articleSearchStatus) articleSearchStatus.textContent = message;
      showToast(toastEl, message);
    } finally {
      articleSearchButton.disabled = false;
      articleSearchButton.textContent = "搜索并录入";
    }
  });

  async function loadApps(nextSelectedAppId = selectedAppId) {
    const response = await fetch("/api/apps");
    apps = await response.json();
    renderApps(nextSelectedAppId);
  }

  function renderApps(nextSelectedAppId = "") {
    selectedAppId = apps.some((app) => app.id === nextSelectedAppId)
      ? nextSelectedAppId
      : apps[0]?.id || "";

    const selectedApp = apps.find((app) => app.id === selectedAppId);
    if (selectedAppBadge) {
      selectedAppBadge.textContent = selectedApp
        ? `当前 App：${formatAppDisplayName(selectedApp.name)}`
        : "当前 App：未选择";
    }

    appList.innerHTML = "";
    appList.classList.toggle("app-edit-mode", isAppEditMode);
    appEditToggle.textContent = isAppEditMode ? "完成" : "编辑";
    appEditToggle.classList.toggle("active", isAppEditMode);
    appEditToggle.disabled = apps.length === 0;

    if (!apps.length) {
      const empty = document.createElement("p");
      empty.className = "app-empty";
      empty.textContent = "还没有 App。请先回首页右上角添加 App。";
      appList.appendChild(empty);
      renderArticles(currentArticles);
      return;
    }

    apps.forEach((app) => {
      const isActive = app.id === selectedAppId;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "app-chip";
      chip.classList.toggle("active", isActive);
      chip.setAttribute("aria-pressed", String(isActive));
      chip.innerHTML = `
        <img src="${escapeAttribute(app.logoUrl)}" alt="" />
        <span>${escapeHtml(formatAppDisplayName(app.name))}</span>
        ${isActive ? '<span class="app-chip-check" aria-hidden="true">✓</span>' : ""}
        ${isAppEditMode ? `<span class="app-chip-delete" aria-label="删除 ${escapeAttribute(formatAppDisplayName(app.name))}">删除</span>` : ""}
      `;
      chip.addEventListener("click", async (event) => {
        if (event.target.closest(".app-chip-delete")) {
          event.stopPropagation();
          if (!isAppEditMode) return;
          await deleteAppFromLibrary(app);
          return;
        }
        renderApps(app.id);
        renderArticles(currentArticles);
        setStatus(statusEl, `已选择 App：${app.name}。`);
      });
      appList.appendChild(chip);
    });

    renderArticles(currentArticles);
  }

  async function deleteAppFromLibrary(app) {
    const displayName = formatAppDisplayName(app.name);
    const shouldDelete = window.confirm(`确定删除首页里的 App「${displayName}」吗？`);
    if (!shouldDelete) return;

    const deleteRelated = window.confirm(
      `是否同时删除「${displayName}」相关的视频、文章和 App 数据？\n\n点“确定”：全删干净。\n点“取消”：只删首页 App 信息，库里已有内容保留。`
    );

    try {
      const response = await fetch("/api/apps/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: app.id, deleteRelated })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "删除 App 失败");
      }
      if (selectedAppId === app.id) {
        selectedAppId = "";
      }
      isAppEditMode = false;
      await Promise.all([loadApps(), loadArticles()]);
      setStatus(statusEl, deleteRelated
        ? `已删除 ${displayName} 及相关内容。`
        : `已删除首页 App 信息：${displayName}，已有内容保留。`);
      showToast(toastEl, `已删除 ${displayName}`);
    } catch (error) {
      setStatus(statusEl, `删除 App 失败：${error.message}`);
      showToast(toastEl, `删除 App 失败：${error.message}`);
    }
  }

  async function loadArticles() {
    const response = await fetch("/api/articles");
    currentArticles = await response.json();
    renderArticles(currentArticles);
  }

  function renderArticles(items) {
    if (!articleList) return;
    articleList.innerHTML = "";
    const visibleItems = items
      .filter((item) => !selectedAppId || item.appId === selectedAppId || item.app?.id === selectedAppId)
      .sort((a, b) => getSortTime(b.createdAt) - getSortTime(a.createdAt));

    if (!visibleItems.length) {
      const empty = document.createElement("div");
      empty.className = "video-job-empty";
      empty.textContent = selectedAppId
        ? "这个 App 还没有文章记录。"
        : "还没有文章记录。";
      articleList.appendChild(empty);
      return;
    }

    visibleItems.forEach((item) => {
      const row = document.createElement("article");
      row.className = "article-record-card";
      row.innerHTML = `
        <div class="article-record-head">
          <div>
            <p class="article-record-app">${escapeHtml(formatAppDisplayName(item.app?.name || "未绑定"))}</p>
            <h3>${escapeHtml(item.title || "未命名文章")}</h3>
          </div>
          <span class="video-job-badge">${escapeHtml(item.createdAt || "")}</span>
        </div>
        <p class="article-record-meta">${escapeHtml(formatArticleMeta(item))}</p>
        <p class="article-record-copy">${escapeHtml(item.excerpt || normalizeArticleInsights(item.coreInsights).join("；") || "暂无摘要。")}</p>
        <div class="article-record-actions">
          <a class="video-job-action" href="${escapeAttribute(item.sourceUrl || "#")}" target="_blank" rel="noreferrer">原链接</a>
          <a class="video-job-action" href="/article-view.html?id=${encodeURIComponent(item.id)}">阅读页</a>
          ${item.cleanMarkdownPath ? `<a class="video-job-action" href="${escapeAttribute(item.cleanMarkdownPath)}" target="_blank" rel="noreferrer">Markdown</a>` : ""}
        </div>
      `;
      articleList.appendChild(row);
    });
  }

  function findDuplicateArticle(url) {
    const normalizedUrl = normalizeUrl(url);
    return currentArticles.find((item) => normalizeUrl(item.sourceUrl) === normalizedUrl) || null;
  }

  function getArticleSearchLimit() {
    const rawLimit = Number(articleSearchLimitSelect?.value) || 10;
    return Math.max(10, Math.min(100, Math.round(rawLimit / 10) * 10));
  }

  function normalizeArticleInsights(insights) {
    const validInsights = Array.isArray(insights)
      ? insights.map((insight) => insight?.point || insight).filter((insight) => String(insight || "").trim())
      : [];
    return validInsights.slice(0, 5);
  }

  function formatArticleMeta(item) {
    const parts = [item.sourceName, item.author].filter(Boolean);
    const primary = parts.length ? parts.join(" / ") : "未知来源";
    return item.publishedAt ? `${primary} · ${String(item.publishedAt).split("T")[0]}` : primary;
  }

Promise.all([loadApps(), loadArticles()]).then(() => {
  setStatus(statusEl, "文章录入页已接回真实列表。");
  if (articleSearchStatus) {
    articleSearchStatus.textContent = "可以直接录单篇文章，也可以按 App 做全网搜索导入。";
  }
}).catch((error) => {
  setStatus(statusEl, `初始化失败：${error.message}`);
});
