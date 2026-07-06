import { fetchJson } from "../core/http.js";
import { escapeAttribute, escapeHtml, formatAppDisplayName } from "../core/format.js";
import { bindTimedSubtitleOverlay, buildTimedSubtitleData, renderSpeechSubtitleOverlay } from "../core/video-subtitles.js";

const params = new URLSearchParams(window.location.search);
const sourceType = params.get("source") || params.get("type") || "normal";
const id = params.get("id");
const appId = params.get("appId");
const from = params.get("from") || (appId ? "app" : "ingest");
const detailEl = document.querySelector("#video-detail");
const breadcrumbEl = document.querySelector("#video-breadcrumb");

try {
  if (!id) throw new Error("缺少视频 id。");
  const [apps, results, adShots] = await Promise.all([
    fetchJson("/api/apps"),
    fetchJson("/api/results"),
    fetchJson("/api/ad-shots")
  ]);
  const app = apps.find((item) => item.id === appId) || null;
  const detail = isShotSource(sourceType)
    ? adaptAdShotDetail(findAdShot(adShots, id), app)
    : adaptNormalVideoDetail(results.find((item) => item.id === id), app);
  if (!detail) throw new Error("没有找到这个视频。");
  normalizeVisibleShotUrl(detail);
  document.title = `${detail.title} - 视频详情`;
  renderBreadcrumb(detail, app);
  detailEl.innerHTML = renderVideoDetail(detail);
  bindActions(detail);
  bindMediaFallback(detail);
} catch (error) {
  detailEl.innerHTML = `
    <section class="panel detail-card">
      <h2>读取失败</h2>
      <p>${escapeHtml(error.message)}</p>
    </section>
  `;
}

function adaptNormalVideoDetail(item, contextApp) {
  if (!item) return null;
  const app = contextApp || item.app || null;
  const visualSummary = normalizeTextValue(item.visualSummary);
  const transcriptZh = normalizeTextValue(item.transcriptZh);
  const transcriptEn = normalizeTextValue(item.transcriptEn);
  return {
    id: item.id,
    source: "normal",
    title: normalizeTextValue(item.title || item.sourceUrl) || "未命名视频",
    app,
    tags: ["普通视频", inferPlatformLabel(item.sourcePlatform || item.sourceUrl), item.relevance?.status].filter(Boolean),
    media: {
      videoPath: getNormalVideoPath(item),
      coverPath: item.firstFramePath || "",
      posterPath: item.firstFramePath || ""
    },
    actions: {
      sourceUrl: item.hyperlink || item.sourceUrl || "",
      appUrl: app?.id ? `/apps/app.html?id=${encodeURIComponent(app.id)}` : ""
    },
    metricsTitle: "素材互动",
    metrics: buildNormalMetrics(item.engagement),
    analysisStatus: item.analysisStatus || "",
    analysisItems: [
      {
        label: "视频剧情",
        body: visualSummary || transcriptZh || "暂无素材拆解。"
      },
      {
        label: "产品 feature",
        items: normalizeFeatureItems(item)
      },
      {
        label: "英文转写",
        body: transcriptEn
      }
    ].filter((entry) => entry.body || entry.items?.length),
    metaItems: [
      ["App", app?.name || ""],
      ["来源", inferPlatformLabel(item.sourcePlatform || item.sourceUrl)],
      ["媒体类型", item.mediaType || "video"],
      ["发布时间", item.publishedText || item.publishedAt || ""],
      ["录入时间", item.createdAt || ""],
      ["相关性", item.relevance?.status || ""]
    ],
    sourceItems: [
      ["语音字幕", transcriptZh || transcriptEn ? "音频转写 + 中文翻译" : "待生成"],
      ["画面总结", visualSummary ? "视觉理解" : "待生成"],
      ["评论洞察", Array.isArray(item.commentInsights) && item.commentInsights.length ? "已生成" : "待生成"]
    ],
    comments: normalizeComments(item.commentsRaw).slice(0, 40),
    raw: item
  };
}

function adaptAdShotDetail(shot, contextApp) {
  if (!shot) return null;
  const app = contextApp || shot.app || (shot.appName || shot.appDisplay ? { id: shot.appId || shot.app?.id || "", name: shot.appName || shot.appDisplay } : null);
  const analysis = getAdShotAnalysis(shot);
  const topAds = shot.topAds && typeof shot.topAds === "object" ? shot.topAds : {};
  const title = normalizeTextValue(
    analysis.cardTitle
    || shot.readableTitle
    || shot.highlight
    || shot.title
    || shot.brandName
    || shot.rawBrandName
  ) || "视频素材";
  return {
    id: shot.shotId || shot.id,
    source: "shot",
    title,
    app,
    tags: [normalizeTextValue(shot.category || shot.industryLabel), formatRegion(shot), shot.analysisStatus === "completed" ? "" : shot.analysisStatus].filter(Boolean),
    media: {
      videoPath: shot.videoPath || shot.media?.videoPath || "",
      coverPath: shot.analysisArtifacts?.firstFramePath || shot.firstFramePath || shot.media?.firstFramePath || shot.media?.posterPath || shot.posterPath || "",
      posterPath: shot.analysisArtifacts?.firstFramePath || shot.firstFramePath || shot.media?.firstFramePath || shot.media?.posterPath || shot.posterPath || ""
    },
    actions: {
      sourceUrl: shot.sourceUrl || "",
      appUrl: app?.id ? `/apps/app.html?id=${encodeURIComponent(app.id)}` : "",
      canDelete: true,
      canAnalyze: shot.analysisStatus !== "completed",
      analyzeLabel: ["queued", "running"].includes(shot.analysisStatus) ? "分析中" : "重新分析"
    },
    metricsTitle: hasDeliverySignals(shot) ? "素材互动与投放信号" : "素材互动",
    metrics: buildAdShotMetrics(shot),
    analysisStatus: shot.analysisStatus || "",
    analysisItems: [
      { label: "视频剧情", body: analysis.videoStory || shot.storySummary || shot.highlight },
      { label: "产品 feature", items: arrayOfText(analysis.productFeatures) },
      { label: "镜头结构", items: arrayOfText(analysis.storyboardFormula) },
      { label: "复用模板", body: analysis.reusableTemplate },
      { label: "画面文字", body: analysis.onScreenTextZh || shot.onScreenTextZh }
    ].filter((entry) => entry.body || entry.items?.length),
    metaItems: [
      ["App", app?.name || shot.appName || shot.appDisplay || ""],
      ["来源品牌", shot.rawBrandName || shot.brandName || ""],
      ["行业", topAds.industryLabel || shot.category || shot.industryLabel || ""],
      ["地区", formatRegion(shot)],
      ["投放目标", formatObjective(shot)],
      ["来源类型", topAds.sourceLabel || shot.sourceDisplay || ""],
      ["落地页", topAds.landingPage || shot.landingPage || ""],
      ["Ad caption", shot.adCaption || shot.title || ""],
      ["时长", shot.duration ? `${shot.duration}s` : ""],
      ["入库时间", shot.capturedAt || shot.createdAt || ""]
    ],
    sourceItems: [
      ["来源", formatShotSourceLabel(shot)],
      ["语音字幕", shot.transcriptZh || analysis.speechSubtitleZh ? "音频转写 + 中文翻译" : "待生成"],
      ["画面文字", Array.isArray(analysis.visualTextSegments) ? `OCR/视觉识别 ${analysis.visualTextSegments.length} 段` : "待识别"],
      ["素材拆解", shot.analysisStatus === "completed" ? "LLM 生成" : "待生成"]
    ],
    comments: [],
    raw: shot
  };
}

function renderVideoDetail(detail) {
  return `
    <section class="panel unified-video-layout">
      <aside class="unified-video-media">
        <div class="unified-video-stage">
          ${renderMedia(detail)}
        </div>
        <div class="unified-video-actions">
          ${detail.actions.sourceUrl ? `<a class="icon-action" href="${escapeAttribute(detail.actions.sourceUrl)}" target="_blank" rel="noreferrer" aria-label="原链接" title="原链接">🔗</a>` : ""}
          ${detail.actions.appUrl ? `<a class="icon-action" href="${escapeAttribute(detail.actions.appUrl)}" aria-label="App 详情" title="App 详情">A</a>` : ""}
          ${detail.actions.canAnalyze ? `<button id="analyze-video" class="icon-action" type="button" aria-label="${escapeAttribute(detail.actions.analyzeLabel || "分析")}" title="${escapeAttribute(detail.actions.analyzeLabel || "分析")}">↻</button>` : ""}
          ${detail.actions.canDelete ? `<button id="delete-video" class="icon-action danger" type="button" aria-label="删除" title="删除">🗑</button>` : ""}
        </div>
        ${renderMetrics(detail)}
      </aside>
      <div class="unified-video-side">
        <header class="panel unified-hero">
          <h1>${escapeHtml(detail.title)}</h1>
          <div class="unified-tags">${detail.tags.map((tag) => `<span class="unified-tag">${escapeHtml(tag)}</span>`).join("")}</div>
          ${renderStatus(detail)}
        </header>
        ${renderAnalysis(detail)}
        ${renderInfoCard("基础信息", detail.metaItems)}
        ${renderInfoCard("数据来源", detail.sourceItems)}
        ${renderComments(detail.comments)}
      </div>
    </section>
  `;
}

function renderMedia(detail) {
  if (detail.media.videoPath) {
    return `<video id="detail-video" controls playsinline preload="metadata" src="${escapeAttribute(detail.media.videoPath)}"${detail.media.posterPath ? ` poster="${escapeAttribute(detail.media.posterPath)}"` : ""}></video>${renderSpeechSubtitleOverlay(buildTimedSubtitleData(detail.raw || {}))}`;
  }
  if (detail.media.coverPath) {
    return `<img src="${escapeAttribute(detail.media.coverPath)}" alt="${escapeAttribute(detail.title + " 封面")}" />`;
  }
  return '<div class="unified-video-empty">Video</div>';
}

function bindMediaFallback(detail) {
  const video = document.querySelector("#detail-video");
  if (!video) return;
  bindTimedSubtitleOverlay(document.querySelector(".unified-video-stage"), buildTimedSubtitleData(detail.raw || {}), {
    duration: Number(detail.raw?.duration || 0)
  });
  video.addEventListener("error", () => {
    const stage = video.closest(".unified-video-stage");
    if (!stage) return;
    stage.innerHTML = detail.media.coverPath
      ? `<img src="${escapeAttribute(detail.media.coverPath)}" alt="${escapeAttribute(detail.title + " 封面")}" /><div class="unified-video-empty is-overlay">本地视频文件不可用</div>`
      : '<div class="unified-video-empty">本地视频文件不可用</div>';
  }, { once: true });
}

function getNormalVideoPath(item) {
  const explicit = normalizeTextValue(item.videoPath || item.video_path || item.localVideoPath || item.local_video_path);
  if (explicit) return explicit;
  const firstFramePath = normalizeTextValue(item.firstFramePath || item.first_frame_path);
  const match = firstFramePath.match(/^(.*\/jobs\/[^/]+)\/first-frame\.(?:jpg|jpeg|png|webp)$/i);
  return match ? `${match[1]}/video.mp4` : "";
}

function renderMetrics(detail) {
  const metrics = detail.metrics.filter((item) => item.value);
  if (!metrics.length) return "";
  return `
    <section class="panel detail-card">
      <h2>${escapeHtml(detail.metricsTitle)}</h2>
      <div class="metric-grid">
        ${metrics.map((item) => `
          <div class="metric-tile">
            <span>${escapeHtml(item.label)}</span>
            <b>${escapeHtml(item.value)}</b>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderStatus(detail) {
  if (!detail.analysisStatus || detail.analysisStatus === "completed") return "";
  const className = detail.analysisStatus === "failed" ? "failed" : detail.analysisStatus === "running" ? "running" : "";
  return `<span class="status-pill ${escapeAttribute(className)}">${escapeHtml(formatStatus(detail.analysisStatus))}</span>`;
}

function renderAnalysis(detail) {
  if (!detail.analysisItems.length) return "";
  return `
    <section class="panel detail-card">
      <h2>素材拆解</h2>
      <div class="analysis-stack">
        ${detail.analysisItems.map((item) => `
          <article class="analysis-item">
            <b>${escapeHtml(item.label)}</b>
            ${item.lead ? `<strong>${escapeHtml(item.lead)}</strong>` : ""}
            ${item.body ? `<p>${escapeHtml(stringifyText(item.body))}</p>` : ""}
            ${item.items?.length ? `<ol>${item.items.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>` : ""}
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderInfoCard(title, items) {
  const visibleItems = items.map(([label, value]) => [label, stringifyText(value)]).filter(([, value]) => value);
  if (!visibleItems.length) return "";
  return `
    <section class="panel detail-card">
      <h2>${escapeHtml(title)}</h2>
      <div class="detail-grid">
        ${visibleItems.map(([label, value]) => `
          <div class="detail-tile">
            <span>${escapeHtml(label)}</span>
            <b>${escapeHtml(value)}</b>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderComments(comments) {
  if (!comments.length) return "";
  return `
    <section class="panel detail-card">
      <h2>评论</h2>
      <ul class="comment-list">
        ${comments.map((comment) => `
          <li>
            ${comment.text ? `<p>${escapeHtml(comment.text)}</p>` : ""}
            ${renderCommentMedia(comment.media)}
            ${comment.meta ? `<small>${escapeHtml(comment.meta)}</small>` : ""}
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}

function renderCommentMedia(media = []) {
  if (!Array.isArray(media) || !media.length) return "";
  return `
    <div class="comment-media-grid">
      ${media.map((item) => {
        const imageUrl = item.localPath || item.sourceUrl;
        const analysis = item.analysis && typeof item.analysis === "object" ? item.analysis : {};
        const summary = analysis.summaryZh || analysis.userSignal || analysis.skippedReason || item.error || "";
        return imageUrl ? `
          <figure class="comment-media">
            <a href="${escapeAttribute(imageUrl)}" target="_blank" rel="noreferrer">
              <img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(item.alt || "评论图片")}" loading="lazy" />
            </a>
            ${summary ? `<figcaption>${escapeHtml(summary)}</figcaption>` : ""}
          </figure>
        ` : "";
      }).join("")}
    </div>
  `;
}

function renderBreadcrumb(detail, app) {
  const activeApp = app || detail.app;
  const crumbs = from === "shots"
    ? [
        ["首页", "/"],
        ["Shots", "/shots"],
        ["视频详情", ""]
      ]
    : from === "app" && activeApp?.id
    ? [
        ["首页", "/"],
        ["App", "/apps"],
        [formatAppDisplayName(activeApp.name || "App"), `/apps/app.html?id=${encodeURIComponent(activeApp.id)}`],
        ["视频", `/apps/app.html?id=${encodeURIComponent(activeApp.id)}#videos-panel`],
        ["视频详情", ""]
      ]
    : [
        ["首页", "/"],
        ["录入数据", "/ingest"],
        ["视频录入", "/ingest/video"],
        ["视频素材", "/shots"],
        ["视频详情", ""]
      ];
  breadcrumbEl.innerHTML = crumbs.map(([label, href], index) => {
    const isLast = index === crumbs.length - 1;
    const node = href && !isLast ? `<a href="${escapeAttribute(href)}">${escapeHtml(label)}</a>` : `<span>${escapeHtml(label)}</span>`;
    return index ? `<span aria-hidden="true">/</span>${node}` : node;
  }).join("");
}

function bindActions(detail) {
  document.querySelector("#delete-video")?.addEventListener("click", async () => {
    if (detail.source !== "shot" || !window.confirm("确认删除这条素材吗？")) return;
    const response = await fetch(`/api/ad-shots/${encodeURIComponent(detail.id)}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert(payload.error || "删除失败。");
      return;
    }
    window.location.href = "/ingest/video";
  });
  document.querySelector("#analyze-video")?.addEventListener("click", async () => {
    if (detail.source !== "shot") return;
    const button = document.querySelector("#analyze-video");
    button.disabled = true;
    const response = await fetch("/api/ad-shots/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shotId: detail.id })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      window.alert(payload.error || "分析启动失败。");
      button.disabled = false;
      return;
    }
    window.location.reload();
  });
}

function findAdShot(adShots, shotId) {
  return adShots.find((shot) => (shot.shotId || shot.id) === shotId);
}

function isShotSource(value) {
  return ["shot", "shots", "ad-shot", "ad_shot", "ttcc", "ads"].includes(String(value || "").toLowerCase());
}

function normalizeVisibleShotUrl(detail) {
  if (detail.source !== "shot" || String(sourceType || "").toLowerCase() !== "ttcc") return;
  const nextParams = new URLSearchParams(window.location.search);
  nextParams.set("source", "shot");
  window.history.replaceState(null, "", `${window.location.pathname}?${nextParams.toString()}${window.location.hash}`);
}

function formatShotSourceLabel(shot) {
  const platform = String(shot.sourcePlatform || shot.sourceDisplay || shot.sourceLabel || "").toLowerCase();
  if (hasDeliverySignals(shot)) return "广告素材库";
  if (platform.includes("tiktok")) return "TikTok";
  return "视频素材";
}

function hasDeliverySignals(shot = {}) {
  return Boolean(
    shot.topAds
    || shot.metrics?.source === "ttcc_top_ads"
    || shot.raw?.performance
    || shot.objectiveKey
    || shot.objectiveLabel
    || shot.landingPage
  );
}

function getAdShotAnalysis(shot) {
  return shot.analysisSummary && typeof shot.analysisSummary === "object"
    ? shot.analysisSummary
    : shot.analysis && typeof shot.analysis === "object"
      ? shot.analysis
      : {};
}

function buildNormalMetrics(engagement = {}) {
  return [
    { label: "播放", value: engagement.viewText || formatCount(engagement.viewCount) },
    { label: "点赞", value: engagement.likeText || formatCount(engagement.likeCount) },
    { label: "评论", value: engagement.commentText || formatCount(engagement.commentCount) },
    { label: "分享", value: engagement.shareText || formatCount(engagement.shareCount) }
  ];
}

function buildAdShotMetrics(shot) {
  const normalized = shot.metrics && typeof shot.metrics === "object" ? shot.metrics : {};
  const performance = shot.raw?.performance && typeof shot.raw.performance === "object" ? shot.raw.performance : {};
  const rawMetrics = shot.raw?.metrics && typeof shot.raw.metrics === "object" ? shot.raw.metrics : {};
  const rawLegacyMetrics = shot.rawMetrics && typeof shot.rawMetrics === "object" ? shot.rawMetrics : {};
  return [
    { label: "点赞", value: formatCount(normalized.likeCount ?? shot.likeCount ?? performance.like ?? rawMetrics.like ?? rawMetrics.likes ?? rawLegacyMetrics.like) },
    { label: "评论", value: formatCount(normalized.commentCount ?? shot.commentCount ?? performance.comment ?? rawMetrics.comment ?? rawMetrics.comments ?? rawLegacyMetrics.comment) },
    { label: "分享", value: formatCount(normalized.shareCount ?? shot.shareCount ?? performance.share ?? performance.forward ?? rawMetrics.share ?? rawMetrics.shares ?? rawMetrics.forward ?? rawLegacyMetrics.share ?? rawLegacyMetrics.forward) },
    { label: "播放", value: formatCount(normalized.viewCount ?? shot.viewCount ?? performance.view ?? rawMetrics.view ?? rawMetrics.views) },
    { label: "CTR 排名", value: normalizeTextValue(normalized.ctrRank) || formatCtrRank(shot.ctrLabel ?? shot.ctr ?? performance.ctr ?? rawMetrics.ctr, shot.raw?.percentile) },
    { label: "预算", value: normalizeTextValue(normalized.budget || shot.budgetLabel || shot.budget) || formatBudget(performance.cost ?? shot.cost ?? normalized.cost ?? rawMetrics.budget) }
  ];
}

function normalizeFeatureItems(item) {
  const analysis = item.analysis && typeof item.analysis === "object" ? item.analysis : {};
  return arrayOfText(analysis.productFeatures || item.productFeatures || item.materialAnalysis?.productFeatures);
}

function normalizeComments(value) {
  const items = Array.isArray(value?.items) ? value.items : [];
  return items.map((item) => {
    const text = normalizeTextValue(item?.text || item?.rawText);
    const media = Array.isArray(item?.media) ? item.media.filter((mediaItem) => mediaItem?.localPath || mediaItem?.sourceUrl) : [];
    return {
      text,
      media,
      meta: [item?.author, item?.timeText, item?.likeText].filter(Boolean).join(" / ")
    };
  }).filter((item) => item.text || item.media.length);
}

function arrayOfText(value) {
  if (!Array.isArray(value)) return [];
  return value.map(stringifyText).filter(Boolean);
}

function stringifyText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringifyText).filter(Boolean).join("；");
  if (typeof value === "object") {
    return normalizeTextValue(value.text || value.summary || value.point || value.value || JSON.stringify(value));
  }
  return String(value).trim();
}

function normalizeTextValue(value) {
  return String(value || "").trim();
}

function formatCount(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("zh-CN") : String(value);
}

function inferPlatformLabel(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("tiktok")) return "TikTok";
  if (text.includes("youtube") || text.includes("youtu.be")) return "YouTube";
  return text ? String(value) : "普通视频";
}

function formatRegion(shot) {
  const topAds = shot.topAds && typeof shot.topAds === "object" ? shot.topAds : {};
  const codes = Array.isArray(topAds.countryCode) && topAds.countryCode.length
    ? topAds.countryCode.filter(Boolean)
    : Array.isArray(shot.countryCode) ? shot.countryCode.filter(Boolean) : [];
  return normalizeTextValue(shot.regionLabel) || codes.join(" / ");
}

function formatObjective(shot) {
  const topAds = shot.topAds && typeof shot.topAds === "object" ? shot.topAds : {};
  const text = normalizeTextValue(topAds.objectiveLabel || shot.objectiveLabel || shot.objective || topAds.objectiveKey || shot.objectiveKey);
  if (text === "campaign_objective_traffic") return "引流 (Traffic)";
  if (text === "campaign_objective_conversion") return "转化 (Conversion)";
  if (text === "campaign_objective_app_install") return "应用安装";
  return text;
}

function formatCtrRank(value, fallbackPercentile = null) {
  const text = normalizeTextValue(value);
  if (!text) {
    const percentile = Number(fallbackPercentile);
    return Number.isFinite(percentile) && percentile > 0 ? `Top ${Math.round(percentile)}%` : "";
  }
  if (/^top\s*\d+/i.test(text)) return text.replace(/^top\s*/i, "Top ");
  const number = Number(text);
  if (!Number.isFinite(number) || number <= 0) return text;
  return `Top ${Math.round(number > 1 ? number : number * 100)}%`;
}

function formatBudget(value) {
  const text = normalizeTextValue(value);
  const key = text.toLowerCase();
  const labels = {
    "0": "低",
    "1": "中",
    "2": "高",
    low: "低",
    medium: "中",
    high: "高"
  };
  return labels[key] || text;
}

function formatStatus(status) {
  const map = {
    queued: "排队中",
    running: "分析中",
    failed: "分析异常"
  };
  return map[status] || status;
}
