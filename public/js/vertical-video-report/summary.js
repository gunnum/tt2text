import { escapeHtml, formatNumber, renderMetric } from "./formatters.js";

export function renderAnalysisNote(el, analysis = {}) {
  if (!el) return;
  el.innerHTML = `
    <span>上次分析：${escapeHtml(analysis.lastAnalyzedAt ? new Date(analysis.lastAnalyzedAt).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "未分析")}</span>
    <span>新增 ${escapeHtml(analysis.addedSinceLastAnalysis || 0)} 条</span>
    <span>删除 ${escapeHtml(analysis.removedSinceLastAnalysis || 0)} 条</span>
    <span>${analysis.isStale ? "素材已变化" : "素材快照一致"}</span>
  `;
}

export function renderSummary(el, summary = {}) {
  if (!el) return;
  el.innerHTML = `
    <span id="overview"></span>
    <div class="section-head">
      <div>
        <p class="eyebrow">Overview</p>
        <h2>数据概览</h2>
      </div>
      <p class="helper-text">高互动排序采用 点赞 + 评论 x 5 + 分享 x 8；播放量只展示，不参与排序。</p>
    </div>
    <div class="metric-grid">
      ${renderMetric("库内视频总量", summary.totalLibraryVideoCount || 0)}
      ${renderMetric("本垂类样本", summary.videoCount || 0)}
      ${renderMetric("覆盖 App", summary.appCount || 0)}
      ${renderMetric("最高高互动权重", formatNumber(summary.topInteractionScore || 0))}
    </div>
  `;
}
