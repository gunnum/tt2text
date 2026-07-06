import { escapeAttribute, escapeHtml } from "./format.js";

const routeLabels = new Map([
  ["apps", "App Dashboard"],
  ["ingest", "录入数据"],
  ["video", "视频录入"],
  ["article", "文章录入"],
  ["sensortower", "SensorTower 录入"],
  ["production", "输出分析"],
  ["reports", "分析输出"],
  ["shots", "Shots"],
  ["social-video", "社媒视频"],
  ["script", "脚本"],
  ["storyboard", "静态分镜"],
  ["agent", "Agent"],
  ["current", "当前状态"],
  ["system", "底层系统"],
  ["tiktok", "TikTok"],
  ["ttcc", "视频素材"],
  ["normal", "普通视频"],
  ["youtube", "YouTube"]
]);

const existing = document.querySelector(".breadcrumb");
const topNav = document.querySelector(".top-link-nav");
const pathname = window.location.pathname.replace(/\/$/, "") || "/";

if (topNav && pathname !== "/" && !existing) {
  topNav.insertAdjacentHTML("afterend", buildBreadcrumb(pathname));
}

function buildBreadcrumb(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  const crumbs = [{ href: "/", label: "首页" }];
  let href = "";
  for (const part of parts) {
    href += `/${part}`;
    crumbs.push({
      href,
      label: routeLabels.get(part) || decodeURIComponent(part)
    });
  }
  return `
    <nav class="breadcrumb" aria-label="面包屑">
      ${crumbs.map((crumb, index) => renderCrumb(crumb, index, crumbs.length)).join("")}
    </nav>
  `;
}

function renderCrumb(crumb, index, total) {
  const separator = index > 0 ? '<span aria-hidden="true">/</span>' : "";
  if (index === total - 1) {
    return `${separator}<span>${escapeHtml(crumb.label)}</span>`;
  }
  return `${separator}<a href="${escapeAttribute(crumb.href)}">${escapeHtml(crumb.label)}</a>`;
}
