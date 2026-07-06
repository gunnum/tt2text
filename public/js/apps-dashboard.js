import { fetchJson } from "./core/http.js";
import { collectAppDashboardData, renderAppDashboardCard } from "./core/dashboard.js";
import { setStatus, showToast } from "./core/ui.js";

const statusEl = document.querySelector("#status");
const appList = document.querySelector("#app-dashboard-list");
const toastEl = document.querySelector("#toast");

async function loadDashboard() {
  setStatus(statusEl, "正在加载 app dashboard...");
  const [apps, adShots, articles, metrics] = await Promise.all([
    fetchJson("/api/apps"),
    fetchJson("/api/ad-shots"),
    fetchJson("/api/articles"),
    fetchJson("/api/app-metrics")
  ]);

  renderApps(apps, { videos: [], adShots, articles, metrics });
  setStatus(statusEl, `已加载 ${apps.length} 个 App。`);
}

function renderApps(apps, dashboardRecords) {
  appList.innerHTML = "";
  if (!apps.length) {
    const empty = document.createElement("div");
    empty.className = "video-job-empty";
    empty.textContent = "还没有录入 App。";
    appList.appendChild(empty);
    return;
  }

  apps.forEach((app) => {
    const card = document.createElement("article");
    card.className = "app-dashboard-card";
    card.innerHTML = renderAppDashboardCard(app, collectAppDashboardData(app, dashboardRecords));
    appList.appendChild(card);
  });
}

loadDashboard().catch((error) => {
  setStatus(statusEl, `加载失败：${error.message}`);
  showToast(toastEl, `加载失败：${error.message}`);
});
