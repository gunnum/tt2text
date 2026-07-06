import { fetchJson } from "./core/http.js";
import { escapeHtml, formatAppDisplayName } from "./core/format.js";
import { setStatus, showToast } from "./core/ui.js";

const statusEl = document.querySelector("#status");
const breadcrumbEl = document.querySelector("#report-breadcrumb");
const summaryEl = document.querySelector("#app-summary");
const categoryRankingCardEl = document.querySelector("#category-ranking-card");
const externalOutputEl = document.querySelector("#external-output");
const moduleListEl = document.querySelector("#module-list");
const markdownViewerEl = document.querySelector("#markdown-viewer");
const markdownTitleEl = document.querySelector("#markdown-title");
const markdownContentEl = document.querySelector("#markdown-content");
const draftContentEl = document.querySelector("#draft-content");
const renderedContentEl = document.querySelector("#module-rendered-content");
const moduleOutputActionsEl = document.querySelector("#module-output-actions");
const mindmapContentEl = document.querySelector("#mindmap-content");
const copyMarkdownBtn = document.querySelector("#copy-markdown");
const copyMindmapBtn = document.querySelector("#copy-mindmap");
const outputTabButtons = Array.from(document.querySelectorAll("[data-output-tab]"));
const outputPanels = Array.from(document.querySelectorAll("[data-output-panel]"));
const toastEl = document.querySelector("#toast");
const reportParams = new URLSearchParams(window.location.search);
const initialAppId = reportParams.get("appId") || "";

let selectedAppId = "";
let selectedMarkdown = "";
let selectedMindmap = "";
let selectedModuleId = "";
let generatingAll = false;
const HIDDEN_CITATION_PREFIXES = new Set(["D", "K"]);
const VISIBLE_CITATION_TYPES = new Set(["文章", "商店评论", "TT 评论", "TT 素材", "商店截图", "Paywall", "主题聚类", "体验文档"]);

async function loadPage() {
  showStatus("正在加载分析输出模块...");
  if (!initialAppId) {
    await renderEmptyState();
    hideStatus();
    return;
  }
  await selectApp(initialAppId);
  hideStatus();
}

async function selectApp(appId) {
  selectedAppId = appId;
  showStatus("正在加载 App 模块...");
  const detail = await fetchJson(`/api/report-output/${encodeURIComponent(appId)}`);
  renderApp(detail);
  hideStatus();
}

function hideStatus() {
  if (statusEl) {
    statusEl.hidden = true;
  }
}

function showStatus(message) {
  setStatus(statusEl, message);
  if (statusEl) {
    statusEl.hidden = false;
  }
}

function renderApp(detail) {
  selectedMarkdown = "";
  selectedMindmap = "";
  selectedModuleId = "";
  markdownViewerEl.hidden = false;
  const appName = formatAppDisplayName(detail.app.name);
  renderBreadcrumb(detail.app, appName);
  summaryEl.innerHTML = `
    <div class="section-head">
      <div>
        <p class="eyebrow">Module Outputs</p>
        <h2>${escapeHtml(appName)}</h2>
      </div>
      <div class="module-actions">
        <button id="generate-all-modules" class="video-job-action" type="button"${generatingAll ? " disabled" : ""}>${generatingAll ? "生成中..." : "补齐 / 更新模块"}</button>
        <button id="force-generate-all-modules" class="video-job-action secondary" type="button"${generatingAll ? " disabled" : ""}>强制重生成全部</button>
        <a class="video-job-action secondary" href="/apps/app.html?id=${encodeURIComponent(detail.app.id)}">App Dashboard</a>
      </div>
    </div>
  `;
  document.querySelector("#generate-all-modules")?.addEventListener("click", () => generateAllModules({ force: false }));
  document.querySelector("#force-generate-all-modules")?.addEventListener("click", () => generateAllModules({ force: true }));
  renderExternalOutput(null);
  renderCategoryRankingCard(detail.app, null);
  moduleListEl.innerHTML = "";
  const modules = detail.modules || [];
  modules.forEach((module) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `module-tab${module.status !== "ready" ? " needs-input" : ""}${module.needsUpdate ? " needs-input" : ""}`;
    tab.dataset.moduleId = module.id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "false");
    tab.innerHTML = `${module.status !== "ready" ? renderWarningIcon() : ""}<span>${escapeHtml(module.title)}</span>`;
    tab.addEventListener("click", () => focusModule(module, modules));
    moduleListEl.appendChild(tab);
  });
  const initialModule = modules.find((module) => module.generationStatus === "done") || modules[0];
  if (initialModule) {
    focusModule(initialModule, modules);
  } else {
    renderEmptyModuleOutput();
  }
}

function renderCategoryRankingCard(app, ranking) {
  if (!categoryRankingCardEl) return;
  if (!ranking?.rows?.length) {
    categoryRankingCardEl.innerHTML = "";
    return;
  }
  const dateRange = formatDateRange(ranking.dateRange);
  categoryRankingCardEl.innerHTML = `
    <a class="ranking-card" href="/reports/category-ranking.html?appId=${encodeURIComponent(app.id)}">
      <div class="ranking-card-head">
        <div>
          <p class="eyebrow">Category Ranking</p>
          <h3>同类型应用排行</h3>
          <p>${escapeHtml(ranking.categoryName || "同品类应用")} · ${escapeHtml(dateRange || "未知时间段")} · ${escapeHtml((ranking.countries || []).join(" + ") || "未标注国家")}</p>
        </div>
        <div class="ranking-card-value">${escapeHtml(formatMoney(ranking.summary?.averageRevenueUsd90d || 0))}</div>
      </div>
      <div class="ranking-card-grid">
        <div class="ranking-mini"><b>${escapeHtml(formatMoney(ranking.summary?.averageMonthlyRevenueUsd || 0))}</b><span>月均收入</span></div>
        <div class="ranking-mini"><b>${escapeHtml(String(ranking.summary?.appCount || 0))}</b><span>Top App 数</span></div>
        <div class="ranking-mini"><b>${escapeHtml(formatNumber(ranking.summary?.averageDownloads90d || 0))}</b><span>90天均下载</span></div>
      </div>
      <p>外露值为 Top ${escapeHtml(String(ranking.summary?.appCount || 25))} 近 90 天平均收入；月均收入按 90 天收入 / 3 换算。</p>
    </a>
  `;
}

async function generateModule(moduleId) {
  if (!selectedAppId) return;
  showStatus("正在生成模块 Markdown...");
  if (statusEl) statusEl.hidden = false;
  try {
    const module = await fetchJson(`/api/report-output/${encodeURIComponent(selectedAppId)}/modules/${encodeURIComponent(moduleId)}/generate`, {
      method: "POST"
    });
    showToast(toastEl, "模块 Markdown 已生成。");
    const detail = await fetchJson(`/api/report-output/${encodeURIComponent(selectedAppId)}`);
    renderApp(detail);
    const refreshedModule = (detail.modules || []).find((item) => item.id === module.id) || module;
    focusModule(refreshedModule, detail.modules || []);
  } catch (error) {
    showToast(toastEl, `生成失败：${error.message}`);
    showStatus(`生成失败：${error.message}`);
    return;
  }
  hideStatus();
}

async function generateAllModules({ force = false } = {}) {
  if (!selectedAppId || generatingAll) return;
  generatingAll = true;
  showStatus(force
    ? "正在强制重生成全部可用模块，Agnes 分析可能需要一两分钟..."
    : "正在补齐未生成或材料已变化的模块，最新 Agnes 洞察会跳过...");
  if (statusEl) statusEl.hidden = false;
  try {
    const result = await fetchJson(`/api/report-output/${encodeURIComponent(selectedAppId)}/modules/generate-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force })
    });
    showToast(toastEl, `已生成 ${result.generatedCount || 0} 个模块，跳过 ${result.skippedCount || 0} 个${result.failedCount ? `，失败 ${result.failedCount} 个` : ""}。`);
    const detail = await fetchJson(`/api/report-output/${encodeURIComponent(selectedAppId)}`);
    renderApp(detail);
  } catch (error) {
    showToast(toastEl, `批量生成失败：${error.message}`);
    showStatus(`批量生成失败：${error.message}`);
    return;
  } finally {
    generatingAll = false;
  }
  hideStatus();
}

function renderExternalOutput(qiaomuOutput) {
  if (!externalOutputEl) return;
  if (!qiaomuOutput) {
    externalOutputEl.innerHTML = "";
    return;
  }
  const available = Boolean(qiaomuOutput.available);
  const summary = available
    ? "打开 qiaomu 原 HTML 评论分析页。"
    : `qiaomu 暂不可用：${qiaomuOutput.error || "未返回可用洞察"}。`;
  const action = qiaomuOutput.url
    ? `<a class="video-job-action" href="${escapeHtml(qiaomuOutput.url)}" target="_blank" rel="noreferrer">打开 HTML</a>`
    : "";
  externalOutputEl.innerHTML = `
    <article class="external-output${available ? "" : " unavailable"}">
      <div>
        <p class="eyebrow">External HTML Output</p>
        <h3>${escapeHtml(qiaomuOutput.label || "qiaomu 评论分析")}</h3>
        <p>${escapeHtml(summary)}</p>
      </div>
      ${action}
    </article>
  `;
}

function formatDateRange(range = {}) {
  const start = range.start || range.startDate || range.start_date || "";
  const end = range.end || range.endDate || range.end_date || "";
  return start || end ? `${start || "未知"} 至 ${end || "未知"}` : "";
}

function formatMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "$0";
  if (number >= 1_000_000_000) return `$${(number / 1_000_000_000).toFixed(1)}B`;
  if (number >= 1_000_000) return `$${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `$${(number / 1_000).toFixed(1)}K`;
  return `$${Math.round(number).toLocaleString()}`;
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "0";
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(1)}B`;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
  return Math.round(number).toLocaleString();
}

function renderModuleStatus(module) {
  if (module.status !== "ready") {
    return '<span class="module-status blocked">待补材料</span>';
  }
  if (module.needsUpdate) {
    return '<span class="module-status stale">需更新</span>';
  }
  if (module.generationStatus === "done") {
    return '<span class="module-status done">已生成</span>';
  }
  return '<span class="module-status ready">可生成</span>';
}

function renderQualityLine(module) {
  if (module.generationStatus !== "done") return "";
  if (module.qualityStatus === "passed") {
    return '<p class="module-quality passed">质量通过</p>';
  }
  const issues = (module.qualityIssues || []).slice(0, 2).join("；");
  return `<p class="module-quality failed">需修：${escapeHtml(issues || "结构验收未通过")}</p>`;
}

function renderWarningIcon() {
  return `
    <svg class="module-tab-warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m12 3 10 18H2L12 3Z" />
      <path d="M12 9v5" />
      <path d="M12 17h.01" />
    </svg>
  `;
}

function focusModule(module, modules = []) {
  selectedModuleId = module?.id || "";
  moduleListEl.querySelectorAll(".module-tab").forEach((tab) => {
    tab.setAttribute("aria-selected", tab.dataset.moduleId === selectedModuleId ? "true" : "false");
  });
  if (!module) {
    renderEmptyModuleOutput();
    return;
  }
  if (module.status !== "ready") {
    showBlockedModule(module);
    return;
  }
  if (module.generationStatus !== "done") {
    showPendingModule(module);
    return;
  }
  showMarkdown(module, { scroll: false });
}

function renderEmptyModuleOutput() {
  markdownTitleEl.textContent = "模块产出";
  selectedMarkdown = "";
  selectedMindmap = "";
  setMarkdownBuffer("");
  if (moduleOutputActionsEl) moduleOutputActionsEl.innerHTML = "";
  if (renderedContentEl) renderedContentEl.innerHTML = '<div class="module-blocked-note"><h3>还没有可查看的分析模块</h3><p>选择左侧 App 后，这里会显示对应模块正文。</p></div>';
  activateOutputTab("rendered");
  markdownViewerEl.hidden = false;
}

function showBlockedModule(module) {
  selectedMarkdown = "";
  selectedMindmap = "";
  markdownTitleEl.textContent = module.title || "待补材料";
  setMarkdownBuffer("");
  if (moduleOutputActionsEl) moduleOutputActionsEl.innerHTML = "";
  const missing = module.missingSummary ? `<p>${escapeHtml(module.missingSummary)}</p>` : "";
  if (renderedContentEl) {
    renderedContentEl.innerHTML = `
      <div class="module-blocked-note">
        <h3>这个模块还缺材料</h3>
        ${missing}
        <p>需要通过 Codex 上传或采集对应材料后，再回来生成这部分分析。</p>
      </div>
    `;
  }
  activateOutputTab("rendered");
  markdownViewerEl.hidden = false;
}

function showPendingModule(module) {
  selectedMarkdown = "";
  selectedMindmap = "";
  markdownTitleEl.textContent = module.title || "待生成";
  setMarkdownBuffer("");
  if (moduleOutputActionsEl) {
    moduleOutputActionsEl.innerHTML = `<button class="video-job-action" type="button" data-action="generate-current">开始分析</button>`;
    moduleOutputActionsEl.querySelector('[data-action="generate-current"]')?.addEventListener("click", () => generateModule(module.id));
  }
  if (renderedContentEl) {
    renderedContentEl.innerHTML = `
      <div class="module-blocked-note">
        <h3>这个模块还没有生成正文</h3>
        <p>点击右上角“开始分析”后，会基于当前本地材料生成正式正文。</p>
      </div>
    `;
  }
  activateOutputTab("rendered");
  markdownViewerEl.hidden = false;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value || "";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function showMarkdown(module, { scroll = true } = {}) {
  const draftMarkdown = module.markdown || "";
  selectedMarkdown = module.reportMarkdown || extractReportDraftMarkdown(draftMarkdown) || draftMarkdown;
  selectedMindmap = extractMermaidMindmap(draftMarkdown);
  markdownTitleEl.textContent = module.title;
  setMarkdownBuffer(selectedMarkdown);
  if (moduleOutputActionsEl) {
    moduleOutputActionsEl.innerHTML = `
      <button class="video-job-action secondary" type="button" data-action="generate-current">${module.needsUpdate ? "更新分析" : "重新生成"}</button>
      <button class="video-job-action secondary" type="button" data-action="copy-current-markdown">复制 Markdown</button>
    `;
    moduleOutputActionsEl.querySelector('[data-action="generate-current"]')?.addEventListener("click", () => generateModule(module.id));
    moduleOutputActionsEl.querySelector('[data-action="copy-current-markdown"]')?.addEventListener("click", copySelectedMarkdown);
  }
  if (draftContentEl) draftContentEl.value = draftMarkdown;
  if (renderedContentEl) {
    renderedContentEl.innerHTML = module.id === "user_reviews"
      ? renderUserReviewsVisual(module)
      : renderReportMarkdown(selectedMarkdown, module.citations || []);
  }
  if (mindmapContentEl) mindmapContentEl.value = selectedMindmap;
  activateOutputTab("rendered");
  markdownViewerEl.hidden = false;
  if (scroll) markdownViewerEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setMarkdownBuffer(value) {
  if (markdownContentEl) {
    markdownContentEl.value = value;
  }
}

function renderUserReviewsVisual(module = {}) {
  const visual = module.reviewVisual || {};
  const rating = visual.ratingBreakdown || {};
  const sections = visual.sections || {};
  const renderedMarkdown = renderReportMarkdown(selectedMarkdown, module.citations || []);
  const reportBody = replaceReviewSectionsWithVisualEvidence(renderedMarkdown, visual);
  return `
    <section class="review-visual">
      <article class="review-report">${reportBody}</article>
      <aside class="review-side">
        ${renderReviewOverview(rating)}
        ${renderReviewThemes(visual.themes || [])}
      </aside>
    </section>
  `;
}

function replaceReviewSectionsWithVisualEvidence(html = "", visual = {}) {
  let output = html;
  const sections = visual.sections || {};
  output = replaceSectionEvidence(output, "用户最认可什么", "positive", sections.positive || [], visual.detailedPositiveCount);
  output = replaceSectionEvidence(output, "用户最常抱怨什么", "negative", sections.negative || []);
  output = replaceSectionEvidence(output, "需要额外留意的风险", "risk", sections.risk || []);
  return output;
}

function replaceSectionEvidence(html = "", heading, kind, examples = [], detailedPositiveCount = 0) {
  if (!examples.length) return html;
  const escapedHeading = escapeRegExp(`<h2>${heading}</h2>`);
  const pattern = new RegExp(`(${escapedHeading}[\\s\\S]*?<ul>)([\\s\\S]*?)(</ul>)`);
  return html.replace(pattern, (_, start, listBody, end) => {
    const items = [...listBody.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
    const conclusion = items[0] ? `<li>${items[0]}</li>` : "";
    const argument = buildReviewArgument(kind, items[1] || "", examples, detailedPositiveCount);
    return `${start}${conclusion}<li>${argument}</li>${renderReviewEvidenceList(examples)}${end}`;
  });
}

function buildReviewArgument(kind, fallbackHtml, examples = [], detailedPositiveCount = 0) {
  if (kind === "positive") {
    const countText = detailedPositiveCount ? `字数较长、阅读感受更真实的评论有 ${detailedPositiveCount} 条。` : "";
    return `${countText}相比 good / nice app 这类短评，更值得写进报告的是那些说明“为什么好用”的评价：它们主要指向拍照记录省时间、饮食计划个性化、以及帮助用户持续管理体重和训练。`;
  }
  if (kind === "negative") {
    return "低星评论里，功能 Bug、AI 识别不准、数据同步和手动修正是最集中的问题。它们不是单纯情绪差评，而是会影响记录准确性、数据连续性和用户对 AI 结果的信任。";
  }
  if (kind === "risk") {
    return "风险点集中在两个环节：一是用户完成较长 onboarding 后才遇到订阅要求，二是付费后仍遇到同步、扫描、识别不准等核心体验问题。";
  }
  return fallbackHtml;
}

function renderReviewEvidenceList(examples = []) {
  return `
    <li class="review-evidence">
      <span>相关评价：</span>
      <ol>
        ${examples.map((item) => `
          <li>${escapeHtml(item.summary || "这条评论提供了具体使用反馈。")}${renderReviewInfoIcon(item)}</li>
        `).join("")}
      </ol>
    </li>
  `;
}

function renderReviewInfoIcon(item = {}) {
  const rating = item.rating ? `${item.rating} 星` : "未标注星级";
  const body = [rating, item.country ? `国家/地区：${item.country}` : "", item.text || ""].filter(Boolean).join("\n");
  return `<span class="info-ref" tabindex="0" aria-label="查看原文">i<span class="review-popover">${escapeHtml(body)}</span></span>`;
}

function renderReviewOverview(rating = {}) {
  const total = Number(rating.total || 0) || 1;
  const byRating = rating.byRating || {};
  return `
    <section class="review-panel">
      <h3>评论概览</h3>
      <div class="review-metrics">
        <div class="review-metric"><b>${escapeHtml(rating.total || 0)}</b><span>评论总量</span></div>
        <div class="review-metric"><b>${escapeHtml(rating.highStar || 0)}</b><span>高星 4-5 星</span></div>
        <div class="review-metric"><b>${escapeHtml(rating.neutral || 0)}</b><span>中立 3 星</span></div>
        <div class="review-metric"><b>${escapeHtml(rating.lowStar || 0)}</b><span>低星 1-2 星</span></div>
      </div>
      ${[5, 4, 3, 2, 1].map((star) => {
        const count = Number(byRating[star] || 0);
        return `<div class="rating-row"><span>${star} 星</span><div class="rating-bar"><i style="width:${Math.round(count / total * 100)}%"></i></div><span>${count}</span></div>`;
      }).join("")}
    </section>
  `;
}

function renderReviewThemes(themes = []) {
  if (!themes.length) return "";
  const max = Math.max(1, ...themes.map((item) => Number(item.count || 0)));
  return `
    <section class="review-panel">
      <h3>主题分布</h3>
      ${themes.map((theme) => `
        <article class="review-theme">
          <div class="review-theme-top"><span>${escapeHtml(theme.title || "未命名主题")}</span><span class="review-theme-count">${escapeHtml(theme.count || 0)} 条</span></div>
          <div class="rating-bar"><i style="width:${Math.round(Number(theme.count || 0) / max * 100)}%"></i></div>
          ${(theme.examples || []).slice(0, 2).map((example) => `<p>${escapeHtml(example)}</p>`).join("")}
        </article>
      `).join("")}
    </section>
  `;
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function activateOutputTab(tabName) {
  outputTabButtons.forEach((button) => {
    const active = button.dataset.outputTab === tabName;
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  outputPanels.forEach((panel) => {
    panel.hidden = panel.dataset.outputPanel !== tabName;
  });
}

function extractMermaidMindmap(markdown = "") {
  const match = String(markdown).match(/```mermaid\s*([\s\S]*?)```/i);
  return (match?.[1] || "").trim();
}

function extractReportDraftMarkdown(markdown = "") {
  const aiMatch = String(markdown).match(/## 10\. AI 结构化洞察\s*([\s\S]*?)(?=\n## 11\.|\n##\s+\d+\.|$)/);
  const aiSection = aiMatch?.[1] || "";
  const draftMatch = aiSection.match(/### 报告正文\s*([\s\S]*?)(?=\n###\s+结构化数据结论|\n###\s+摘要|\n###\s+|$)/);
  return (draftMatch?.[1] || "").trim();
}

function renderReportMarkdown(markdown = "", citations = []) {
  const citationMap = buildCitationMap(citations);
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let listItems = [];
  let tableRows = [];
  let codeLines = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineReportMarkdown(paragraph.join(" "), citationMap)}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    html.push(`<ul>${listItems.map((item) => `<li>${inlineReportMarkdown(item, citationMap)}</li>`).join("")}</ul>`);
    listItems = [];
  };
  const flushTable = () => {
    if (!tableRows.length) return;
    const rows = tableRows.map(parseMarkdownTableRow).filter((row) => row.length);
    if (rows.length) {
      const header = rows[0];
      const bodyRows = rows.slice(1).filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell.trim())));
      html.push([
        "<table>",
        `<thead><tr>${header.map((cell) => `<th>${inlineReportMarkdown(cell, citationMap)}</th>`).join("")}</tr></thead>`,
        `<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${inlineReportMarkdown(cell, citationMap)}</td>`).join("")}</tr>`).join("")}</tbody>`,
        "</table>"
      ].join(""));
    }
    tableRows = [];
  };
  const flushCode = () => {
    if (!codeLines.length) return;
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
  };
  const flushBlocks = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    if (/^```/.test(line.trim())) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushBlocks();
        inCode = true;
      }
      return;
    }
    if (inCode) {
      codeLines.push(rawLine);
      return;
    }
    if (!line.trim()) {
      flushBlocks();
      return;
    }
    if (/^\|.*\|$/.test(line.trim())) {
      flushParagraph();
      flushList();
      tableRows.push(line);
      return;
    }
    flushTable();
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineReportMarkdown(heading[2], citationMap)}</h${level}>`);
      return;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      listItems.push(bullet[1]);
      return;
    }
    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${inlineReportMarkdown(quote[1], citationMap)}</blockquote>`);
      return;
    }
    paragraph.push(line.trim());
  });
  flushBlocks();
  flushCode();
  return html.join("\n") || '<p class="helper">暂无可渲染内容。</p>';
}

function buildCitationMap(citations = []) {
  let index = 0;
  return new Map((citations || [])
    .filter((item) => item?.id && isVisibleCitation(item))
    .map((item) => {
      index += 1;
      return [String(item.id).toUpperCase(), { ...item, displayIndex: index }];
    }));
}

function isVisibleCitation(citation = {}) {
  const id = String(citation.id || "").toUpperCase();
  if (HIDDEN_CITATION_PREFIXES.has(id.slice(0, 1))) return false;
  const type = String(citation.type || "").trim();
  return !type || VISIBLE_CITATION_TYPES.has(type);
}

function parseMarkdownTableRow(line = "") {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function inlineReportMarkdown(value = "", citationMap = new Map()) {
  const placeholders = [];
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/_([^_]+)_/g, "<em>$1</em>");
  text = text.replace(/\b([ADKRPSTCVX]\d+)\b/g, (id) => {
    if (HIDDEN_CITATION_PREFIXES.has(id.slice(0, 1).toUpperCase())) return "";
    const citation = citationMap.get(id.toUpperCase());
    if (!citation) return id;
    const marker = renderCitationRef(citation);
    const token = `@@CITATION_${placeholders.length}@@`;
    placeholders.push([token, marker]);
    return token;
  });
  placeholders.forEach(([token, marker]) => {
    text = text.replace(token, marker);
  });
  return text;
}

function renderCitationRef(citation = {}) {
  const id = escapeHtml(citation.id || "");
  const href = citation.sourceUrl ? ` href="${escapeHtml(citation.sourceUrl)}" target="_blank" rel="noreferrer"` : "";
  const title = escapeHtml(citation.title || citation.sourceName || "来源");
  const source = escapeHtml([citation.type, citation.sourceName || citation.sourceDomain, citation.publishedAt].filter(Boolean).join(" · "));
  const excerpt = escapeHtml(citation.excerpt || citation.use || "");
  const bilingual = renderCitationBilingual(citation);
  const display = escapeHtml(citation.displayIndex || id);
  const aria = `查看来源 ${id}`;
  const marker = href
    ? `<a${href} aria-label="${escapeHtml(aria)}">${display}</a>`
    : `<span role="note" aria-label="${escapeHtml(aria)}">${display}</span>`;
  return `<sup class="citation-ref" data-source-id="${id}">${marker}<span class="citation-card"><strong>${title}</strong>${source ? `<small>${source}</small>` : ""}${bilingual || (excerpt ? `<p>${excerpt}</p>` : "")}</span></sup>`;
}

function renderCitationBilingual(citation = {}) {
  const original = citation.originalText || citation.original || citation.rawText || "";
  const zh = citation.zhText || citation.textZh || citation.translationZh || "";
  const en = citation.enText || citation.textEn || citation.translationEn || "";
  const fallback = citation.excerpt || citation.use || "";
  const rows = [];
  if (zh) rows.push(["CN", zh]);
  if (en) rows.push(["EN", en]);
  if (!rows.length && fallback) {
    rows.push([containsChinese(fallback) ? "CN" : "EN", fallback]);
  }
  if (original && !rows.some(([, value]) => value === original)) rows.push(["原文", original]);
  if (!rows.length) return "";
  return `<div class="citation-bilingual">${rows.slice(0, 3).map(([label, value]) => `<p><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></p>`).join("")}</div>`;
}

function containsChinese(value = "") {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

async function renderEmptyState() {
  if (breadcrumbEl) {
    breadcrumbEl.innerHTML = `
      <a href="/">首页</a>
      <span aria-hidden="true">/</span>
      <span>分析输出</span>
    `;
  }
  const index = await fetchJson("/api/report-output/video-categories");
  summaryEl.innerHTML = `
    <div class="section-head">
      <div>
        <p class="eyebrow">Video Category Reports</p>
        <h2>按垂类查看短视频推广分析</h2>
      </div>
      <span class="report-status-pill">${escapeHtml(String(index.totalVideoCount || 0))} 条素材</span>
    </div>
    <div class="video-category-grid">
      ${(index.categories || []).map(renderVideoCategoryCard).join("") || '<div class="video-job-empty">还没有可复盘的视频垂类。</div>'}
    </div>
  `;
  if (externalOutputEl) externalOutputEl.innerHTML = "";
  if (categoryRankingCardEl) categoryRankingCardEl.innerHTML = "";
  moduleListEl.innerHTML = "";
  markdownViewerEl.hidden = true;
}

function renderVideoCategoryCard(category = {}) {
  const lastAnalyzedAt = category.lastAnalyzedAt ? formatDateTime(category.lastAnalyzedAt) : "未分析";
  return `
    <a class="video-category-card" href="/reports/vertical-video.html?category=${encodeURIComponent(category.id)}">
      <div>
        <p class="eyebrow">Vertical Video</p>
        <h3>${escapeHtml(category.label || "未命名")}垂类视频推广分析</h3>
        <p>${escapeHtml(category.description || "已收录短视频推广分析。")}</p>
      </div>
      <div class="video-category-meta">
        <span><b>${escapeHtml(category.videoCount || 0)}</b>视频</span>
        <span><b>${escapeHtml(category.appCount || 0)}</b>App</span>
        <span><b>${escapeHtml(formatNumber(category.topInteractionScore || 0))}</b>最高互动分</span>
      </div>
      <div class="analysis-delta">
        <span>上次分析：${escapeHtml(lastAnalyzedAt)}</span>
        <span>新增 ${escapeHtml(category.addedSinceLastAnalysis || 0)}</span>
        <span>删除 ${escapeHtml(category.removedSinceLastAnalysis || 0)}</span>
      </div>
    </a>
  `;
}

function renderBreadcrumb(app = {}, appName = "") {
  if (!breadcrumbEl) return;
  breadcrumbEl.innerHTML = `
    <a href="/">首页</a>
    <span aria-hidden="true">/</span>
    <a href="/apps/app.html?id=${encodeURIComponent(app.id || selectedAppId)}">${escapeHtml(appName || app.name || "App")}</a>
    <span aria-hidden="true">/</span>
    <span>分析输出</span>
  `;
}

async function copySelectedMarkdown() {
  if (!selectedMarkdown) {
    showToast(toastEl, "还没有可复制的 Markdown。");
    return;
  }
  await navigator.clipboard.writeText(selectedMarkdown);
  showToast(toastEl, "Markdown 已复制。");
}

copyMarkdownBtn?.addEventListener("click", copySelectedMarkdown);

copyMindmapBtn?.addEventListener("click", async () => {
  if (!selectedMindmap) {
    showToast(toastEl, "还没有可复制的脑图。");
    return;
  }
  await navigator.clipboard.writeText(selectedMindmap);
  showToast(toastEl, "脑图已复制。");
});

outputTabButtons.forEach((button) => {
  button.addEventListener("click", () => activateOutputTab(button.dataset.outputTab));
});

document.addEventListener("click", (event) => {
  const icon = event.target.closest(".info-ref");
  document.querySelectorAll(".info-ref.open").forEach((item) => {
    if (item !== icon) item.classList.remove("open");
  });
  if (icon) icon.classList.toggle("open");
});

loadPage().catch((error) => {
  showStatus(`加载失败：${error.message}`);
  showToast(toastEl, `加载失败：${error.message}`);
});
