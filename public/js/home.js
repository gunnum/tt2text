import { fetchJson } from "./core/http.js";
import { escapeAttribute, escapeHtml, formatAppDisplayName } from "./core/format.js";
import { collectAppDashboardData, renderAppDashboardCard } from "./core/dashboard.js";

const dialog = document.querySelector("#app-dialog");
const openButton = document.querySelector("#open-app-dialog");
const closeButton = document.querySelector("#close-app-dialog");
const form = document.querySelector("#home-app-form");
const statusEl = document.querySelector("#home-app-status");
const appList = document.querySelector("#app-dashboard-list");
const categoryFilter = document.querySelector("#category-filter");
const APP_CATEGORY_OPTIONS = ["dating社交", "熟人社交", "社区", "读书", "工具"];
let currentDashboard = { apps: [], records: {} };

openButton?.addEventListener("click", () => {
  dialog?.showModal();
  form?.querySelector("input")?.focus();
});

closeButton?.addEventListener("click", () => {
  dialog?.close();
});

dialog?.addEventListener("click", (event) => {
  const card = dialog.querySelector(".app-dialog-card");
  if (card && !card.contains(event.target)) {
    dialog.close();
  }
});

categoryFilter?.addEventListener("change", (event) => {
  if (!event.target?.matches?.("input[name='category-filter']")) return;
  syncCategoryFilterSelection(event.target);
  renderApps(currentDashboard.apps, currentDashboard.records);
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = form.querySelector("input[name='appStoreUrl']");
  const button = form.querySelector("button[type='submit']");
  const url = input.value.trim();
  if (!url) return;

  button.disabled = true;
  statusEl.textContent = "正在读取 App Store 信息。";
  try {
    const response = await fetch("/api/apps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "添加 App 失败");
    }
    statusEl.textContent = `已添加 ${formatAppDisplayName(payload.name)}。`;
    window.location.href = `/apps/app.html?id=${encodeURIComponent(payload.id)}`;
  } catch (error) {
    statusEl.textContent = `添加失败：${error.message}`;
  } finally {
    button.disabled = false;
  }
});

async function loadDashboard() {
  if (!appList) return;
  const [apps, adShots, articles, metrics] = await Promise.all([
    fetchJson("/api/apps"),
    fetchJson("/api/ad-shots"),
    fetchJson("/api/articles"),
    fetchJson("/api/app-metrics")
  ]);

  currentDashboard = { apps, records: { videos: [], adShots, articles, metrics } };
  renderCategoryFilter(apps, currentDashboard.records);
  renderApps(currentDashboard.apps, currentDashboard.records);
}

function renderApps(apps, dashboardRecords) {
  appList.innerHTML = "";
  const visibleApps = apps.filter((app) => matchesCategoryFilter(app, dashboardRecords));
  if (!visibleApps.length) {
    const empty = document.createElement("div");
    empty.className = "video-job-empty";
    empty.textContent = apps.length ? "当前类别筛选下没有 App。" : "还没有录入 App。";
    appList.appendChild(empty);
    return;
  }

  visibleApps.forEach((app) => {
    const card = document.createElement("article");
    card.className = "app-dashboard-card";
    card.innerHTML = renderAppDashboardCard(app, collectAppDashboardData(app, dashboardRecords), {
      tags: resolveAppCategories(app)
    });
    appList.appendChild(card);
  });
}

function renderCategoryFilter(apps) {
  if (!categoryFilter) return;
  const selected = getSelectedCategoryFilters();
  const appCategories = new Set(apps.flatMap(resolveAppCategories));
  const extraCategories = Array.from(appCategories)
    .filter((category) => !APP_CATEGORY_OPTIONS.includes(category))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const categoryOptions = [...APP_CATEGORY_OPTIONS, ...extraCategories];
  const hasUnassigned = apps.some((app) => !resolveAppCategories(app).length);
  const validValues = new Set(["all", "unassigned", ...categoryOptions]);
  const hasValidSelected = Array.from(selected).some((value) => validValues.has(value));
  const normalizedSelected = hasValidSelected ? selected : new Set(["all"]);
  categoryFilter.innerHTML = [
    '<legend class="sr-only">类别</legend>',
    renderCategoryFilterOption("all", "全部", normalizedSelected.has("all")),
    ...categoryOptions.map((category) => renderCategoryFilterOption(category, category, normalizedSelected.has(category))),
    ...(hasUnassigned ? [renderCategoryFilterOption("unassigned", "未分类", normalizedSelected.has("unassigned"))] : [])
  ].join("");
  categoryFilter.querySelectorAll("input[name='category-filter']").forEach((input) => {
    input.checked = normalizedSelected.has(input.value) && validValues.has(input.value);
  });
}

function matchesCategoryFilter(app) {
  const filters = getSelectedCategoryFilters();
  if (!filters.size || filters.has("all")) return true;
  const categories = resolveAppCategories(app);
  if (filters.has("unassigned") && categories.length === 0) return true;
  return categories.some((category) => filters.has(category));
}

function syncCategoryFilterSelection(changedInput) {
  if (!categoryFilter) return;
  const inputs = Array.from(categoryFilter.querySelectorAll("input[name='category-filter']"));
  const allInput = inputs.find((input) => input.value === "all");
  if (!allInput) return;

  if (changedInput.value === "all" && changedInput.checked) {
    inputs.forEach((input) => {
      input.checked = input === allInput;
    });
    return;
  }

  if (changedInput.value !== "all" && changedInput.checked) {
    allInput.checked = false;
  }

  const hasSpecificSelection = inputs.some((input) => input.value !== "all" && input.checked);
  if (!hasSpecificSelection) {
    allInput.checked = true;
  }
}

function renderCategoryFilterOption(value, label, checked) {
  return `
    <label class="category-filter-option">
      <input type="checkbox" name="category-filter" value="${escapeAttribute(value)}" ${checked ? "checked" : ""} />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function getSelectedCategoryFilters() {
  if (!categoryFilter) return new Set();
  const values = Array.from(categoryFilter.querySelectorAll("input[name='category-filter']:checked"))
    .map((input) => input.value);
  return new Set(values.length ? values : ["all"]);
}

function resolveAppCategories(app) {
  const rawCategories = [
    ...(Array.isArray(app.categories) ? app.categories : []),
    app.category
  ];
  return Array.from(new Set(rawCategories.map((item) => String(item || "").trim()).filter(Boolean)));
}

loadDashboard().catch((error) => {
  if (appList) {
    appList.innerHTML = `<div class="video-job-empty">加载失败：${escapeHtml(error.message)}</div>`;
  }
});
