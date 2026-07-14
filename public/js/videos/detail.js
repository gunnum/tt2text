import { fetchJson } from "../core/http.js";
import { escapeAttribute, escapeHtml, formatAppDisplayName } from "../core/format.js";
import { bindUnifiedVideoPlayer, renderUnifiedVideoPlayer } from "../core/video-player.js";
import { getAnalysisProgressInfo } from "../core/analysis-progress.js";
import { getAdShotCoverPaths, getAdShotVideoPath, getEffectiveAdShotAnalysisStatus } from "../core/video-card.js";

const params = new URLSearchParams(window.location.search);
const sourceType = params.get("source") || params.get("type") || "normal";
const isAdShotSource = sourceType === "ttcc" || sourceType === "shot";
const id = params.get("id");
const appId = params.get("appId");
const from = params.get("from") || (appId ? "app" : "ingest");
const autoRefetchKey = id ? `tt2text:auto-refetch:${id}` : "";
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
  const detail = isAdShotSource
    ? adaptAdShotDetail(findAdShot(adShots, id), app)
    : adaptNormalVideoDetail(results.find((item) => item.id === id), app);
  if (!detail) throw new Error("没有找到这个视频。");
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
      ["语音字幕", formatAudioSourceLabel(item)],
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
  const title = normalizeTextValue(
    analysis.cardTitle
    || shot.readableTitle
    || shot.highlight
    || shot.title
    || shot.brandName
    || shot.rawBrandName
  ) || "TTCC 视频";
  const analysisStatus = getEffectiveAdShotAnalysisStatus(shot);
  const analysisStatusTag = analysisStatus && analysisStatus !== "completed" ? formatStatus(analysisStatus) : "";
  const isAnalysisPending = ["queued", "running"].includes(analysisStatus);
  const analysisProgressInfo = getAnalysisProgressInfo({
    status: analysisStatus,
    stageKey: shot.analysisProgress?.stageKey,
    stageLabel: shot.analysisProgress?.stageLabel || shot.analysisStage,
    message: shot.analysisProgress?.message
  });
  const coverPaths = getAdShotCoverPaths(shot).map(normalizeTextValue).filter(Boolean);
  const coverPath = coverPaths[0] || "";
  const explicitVideoPath = normalizeTextValue(shot.videoPath || shot.media?.videoPath || shot.analysisArtifacts?.videoPath);
  const videoPath = explicitVideoPath || (analysisStatus === "queued" ? "" : getAdShotVideoPath(shot));
  const hasMissingLocalVideo = !isAnalysisPending && !hasPlayableLocalVideo(shot);
  return {
    id: shot.shotId || shot.id,
    source: "ttcc",
    title,
    app,
    tags: [normalizeTextValue(shot.category || shot.industryLabel), formatRegion(shot), analysisStatusTag].filter(Boolean),
    media: {
      videoPath,
      coverPath,
      posterPath: coverPath,
      coverPaths,
      notice: isAnalysisPending
        ? {
            title: videoPath ? "分析仍在进行" : "分析中，视频生成后可播放",
            progress: {
              status: analysisStatus,
              stageKey: shot.analysisProgress?.stageKey,
              stageLabel: shot.analysisProgress?.stageLabel || shot.analysisStage,
              message: shot.analysisProgress?.message
            },
            body: normalizeTextValue(shot.analysisProgress?.message || shot.analysisStage)
              || (videoPath ? "视频已可预览，素材拆解还在生成。" : "正在下载/转写/生成素材拆解，完成后刷新页面即可播放本地视频。")
          }
        : null
    },
    actions: {
      sourceUrl: shot.sourceUrl || "",
      appUrl: app?.id ? `/apps/app.html?id=${encodeURIComponent(app.id)}` : "",
      canDelete: true,
      canAnalyze: analysisStatus !== "completed" || hasMissingLocalVideo,
      analyzeLabel: ["queued", "running"].includes(analysisStatus) ? "分析中" : "重新分析"
    },
    metricsTitle: shot.sourcePlatform === "tiktok" ? "素材互动" : "广告投放效果",
    metrics: buildAdShotMetrics(shot),
    analysisStatus,
    analysisItems: [
      { label: "视频剧情", body: analysis.videoStory || shot.storySummary || shot.highlight },
      { label: "产品 feature", items: arrayOfText(analysis.productFeatures) },
      { label: "镜头结构", items: formatStoryboardScenes(analysis) },
      { label: "复用模板", body: analysis.reusableTemplate },
      { label: "画面文字", body: analysis.onScreenTextZh || shot.onScreenTextZh }
    ].filter((entry) => entry.body || entry.items?.length),
    metaItems: [
      ["App", app?.name || shot.appName || shot.appDisplay || ""],
      ["来源品牌", shot.rawBrandName || shot.brandName || ""],
      ["行业", shot.category || shot.industryLabel || ""],
      ["地区", formatRegion(shot)],
      ["投放目标", formatObjective(shot)],
      ["Landing Page", shot.landingPage || ""],
      ["Ad caption", shot.adCaption || shot.title || ""],
      ["时长", shot.duration ? `${shot.duration}s` : ""],
      ["入库时间", shot.capturedAt || shot.createdAt || ""]
    ],
    sourceItems: [
      ["来源", "TikTok Creative Center"],
      ["语音字幕", formatAudioSourceLabel(shot, analysis)],
      ["画面文字", Array.isArray(analysis.visualTextSegments) ? `OCR/视觉识别 ${analysis.visualTextSegments.length} 段` : "待识别"],
      ["素材拆解", analysisStatus === "completed" ? "LLM 生成" : "待生成"],
      ...(isAnalysisPending ? [["当前进度", analysisProgressInfo.fullText]] : [])
    ],
    comments: [],
    raw: shot
  };
}

function formatStoryboardScenes(analysis = {}) {
  const scenes = Array.isArray(analysis.storyboardScenes) ? analysis.storyboardScenes : [];
  if (!scenes.length) return arrayOfText(analysis.storyboardFormula);
  return scenes.map((scene, index) => {
    const start = Number(scene?.start);
    const end = Number(scene?.end);
    const range = Number.isFinite(start) && Number.isFinite(end) && end > start
      ? `${formatSceneSecond(start)}-${formatSceneSecond(end)}s`
      : `分镜 ${index + 1}`;
    const role = normalizeTextValue(scene?.role);
    const text = normalizeTextValue(scene?.scene);
    return [range, role, text].filter(Boolean).join(" · ");
  }).filter(Boolean);
}

function formatSceneSecond(value) {
  const number = Number(Number(value || 0).toFixed(2));
  return Number.isInteger(number) ? String(number) : String(number);
}

function formatAudioSourceLabel(item = {}, analysis = {}) {
  if (isBgmOnlyAudio(item, analysis)) {
    const musicName = formatMusicName(
      firstText(item.musicTrack, item.bgmTitle, item.musicTitle, item.raw?.musicTrack, item.raw?.track, analysis.musicTrack, analysis.bgmTitle),
      firstText(item.musicArtist, item.raw?.musicArtist, item.raw?.artist, analysis.musicArtist)
    );
    return musicName ? `BGM：${musicName}` : "BGM";
  }
  return item.transcriptZh || analysis.speechSubtitleZh ? "音频转写 + 中文翻译" : "待生成";
}

function isBgmOnlyAudio(item = {}, analysis = {}) {
  const kind = normalizeTextValue(
    item.audioKind
    || item.audioType
    || item.audio_kind
    || item.audio_type
    || item.raw?.audioKind
    || item.raw?.audioType
    || analysis.audioKind
    || analysis.audioType
  ).toLowerCase();
  return ["bgm", "music", "music_only", "bgm_only", "background_music", "no_speech"].includes(kind)
    || item.isBgmOnly === true
    || item.bgmOnly === true
    || analysis.isBgmOnly === true
    || analysis.bgmOnly === true;
}

function formatMusicName(title, artist) {
  const cleanTitle = normalizeTextValue(title);
  const cleanArtist = normalizeTextValue(artist);
  if (!cleanTitle && !cleanArtist) return "";
  if (!cleanTitle) return cleanArtist;
  if (!cleanArtist || cleanTitle.toLowerCase().includes(cleanArtist.toLowerCase())) return cleanTitle;
  return `${cleanTitle} - ${cleanArtist}`;
}

function firstText(...items) {
  for (const item of items) {
    const text = normalizeTextValue(item);
    if (text) return text;
  }
  return "";
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
  return renderUnifiedVideoPlayer({
    videoPath: detail.media.videoPath,
    posterPath: detail.media.posterPath,
    coverPath: detail.media.coverPath,
    coverPaths: detail.media.coverPaths,
    title: detail.title,
    notice: detail.media.notice,
    item: detail.raw || {},
    videoId: "detail-video"
  });
}

function bindMediaFallback(detail) {
  const video = document.querySelector("#detail-video");
  if (!video) {
    bindCoverImageFallback(detail);
    return;
  }
  bindUnifiedVideoPlayer(document.querySelector(".unified-video-stage"), {
    item: detail.raw || {},
    duration: Number(detail.raw?.duration || 0),
    bindVideoErrorFallback: false
  });
  video.addEventListener("error", () => {
    const stage = video.closest(".unified-video-stage");
    if (!stage) return;
    const pendingProgress = getAnalysisProgressInfo({
      status: detail.analysisStatus,
      stageKey: detail.raw?.analysisProgress?.stageKey,
      stageLabel: detail.raw?.analysisProgress?.stageLabel || detail.raw?.analysisStage,
      message: detail.raw?.analysisProgress?.message
    });
    const fallbackNotice = {
      title: ["queued", "running"].includes(detail.analysisStatus)
        ? "分析中，视频生成后可播放"
        : "本地视频文件不可用",
      progress: ["queued", "running"].includes(detail.analysisStatus)
        ? {
            status: detail.analysisStatus,
            stageKey: detail.raw?.analysisProgress?.stageKey,
            stageLabel: detail.raw?.analysisProgress?.stageLabel || detail.raw?.analysisStage,
            message: detail.raw?.analysisProgress?.message
          }
        : null,
      body: ["queued", "running"].includes(detail.analysisStatus)
        ? (detail.raw?.analysisProgress?.message || pendingProgress.label || "正在下载/转写/生成素材拆解，完成后刷新页面即可播放本地视频。")
        : "这通常是采集记录已写入，但本地 video.mp4 尚未生成或下载失败。系统会自动尝试重新获取，也可以手动点重新分析。"
    };
    const fallbackCoverPath = normalizeTextValue(detail.media.coverPaths?.[0] || detail.media.coverPath || detail.media.posterPath);
    const fallbackDetail = {
      ...detail,
      media: {
        ...detail.media,
        coverPath: fallbackCoverPath,
        posterPath: fallbackCoverPath
      }
    };
    stage.innerHTML = fallbackCoverPath
      ? renderUnifiedVideoPlayer({
          coverPath: fallbackDetail.media.coverPath,
          posterPath: fallbackDetail.media.posterPath,
          coverPaths: fallbackDetail.media.coverPaths,
          title: fallbackDetail.title,
          notice: fallbackNotice,
          item: fallbackDetail.raw || {}
        })
      : '<div class="video-player-empty"><b>' + escapeHtml(fallbackNotice.title) + '</b><span>' + escapeHtml(fallbackNotice.body) + '</span></div>';
    bindCoverImageFallback(fallbackDetail);
    maybeAutoRefetchMissingVideo(detail);
  }, { once: true });
}

function bindCoverImageFallback(detail) {
  const image = document.querySelector(".unified-video-stage img");
  if (!image) return;
  const coverPaths = (detail.media.coverPaths || [])
    .map(normalizeTextValue)
    .filter(Boolean);
  if (coverPaths.length <= 1) return;
  let index = Math.max(0, coverPaths.indexOf(image.getAttribute("src") || ""));
  image.addEventListener("error", () => {
    index += 1;
    const nextCoverPath = coverPaths[index] || "";
    if (nextCoverPath) {
      image.src = nextCoverPath;
      return;
    }
    const stage = image.closest(".unified-video-stage");
    if (stage) {
      stage.innerHTML = `<div class="video-player-empty">${escapeHtml(["queued", "running"].includes(detail.analysisStatus) ? "分析中，等待生成视频首帧。" : "当前素材没有可用封面。")}</div>`;
    }
  });
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
            <p>${escapeHtml(comment.text)}</p>
            ${comment.meta ? `<small>${escapeHtml(comment.meta)}</small>` : ""}
          </li>
        `).join("")}
      </ul>
    </section>
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
        ...(detail.source === "ttcc" ? [["TTCC 素材库", "/ingest/video/tiktok/ttcc"]] : []),
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
    if (detail.source !== "ttcc" || !window.confirm("确认删除这条素材吗？")) return;
    const response = await fetch(`/api/ad-shots/${encodeURIComponent(detail.id)}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert(payload.error || "删除失败。");
      return;
    }
    window.location.href = "/ingest/video";
  });
  document.querySelector("#analyze-video")?.addEventListener("click", async () => {
    if (detail.source !== "ttcc") return;
    const button = document.querySelector("#analyze-video");
    button.disabled = true;
    const response = await requestAdShotAnalyze(detail.id);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      window.alert(payload.error || "分析启动失败。");
      button.disabled = false;
      return;
    }
    window.location.reload();
  });
}

function hasPlayableLocalVideo(shot) {
  return Boolean(
    normalizeTextValue(shot.videoPath || shot.media?.videoPath)
    && normalizeTextValue(shot.posterPath || shot.media?.posterPath || shot.media?.firstFramePath)
  );
}

async function requestAdShotAnalyze(shotId) {
  return fetch("/api/ad-shots/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shotId })
  });
}

function maybeAutoRefetchMissingVideo(detail) {
  if (detail.source !== "ttcc") return;
  if (!detail?.id || !detail?.raw?.sourceUrl) return;
  if (!["completed", "failed", ""].includes(detail.analysisStatus || "")) return;
  if (!autoRefetchKey) return;
  const lastTriggeredAt = Number(sessionStorage.getItem(autoRefetchKey) || 0);
  const now = Date.now();
  if (Number.isFinite(lastTriggeredAt) && now - lastTriggeredAt < 2 * 60 * 1000) return;
  sessionStorage.setItem(autoRefetchKey, String(now));
  startAutoRefetch(detail);
}

async function startAutoRefetch(detail) {
  const stage = document.querySelector(".unified-video-stage");
  if (!stage) return;
  const waitingNotice = {
    title: "本地视频缺失，正在自动重新获取",
    progress: {
      status: "queued",
      stageKey: "queued",
      stageLabel: "排队等待",
      message: "已自动发起重新获取，本地视频恢复后会自动刷新。"
    },
    body: "系统正在用原始 TikTok 链接重新抓取本地视频并重建分析。"
  };
  stage.innerHTML = renderUnifiedVideoPlayer({
    coverPath: normalizeTextValue(
      detail.raw?.analysisArtifacts?.visualFramePaths?.[0]
      || detail.raw?.analysisArtifacts?.firstFramePath
      || detail.raw?.media?.firstFramePath
      || detail.media.coverPath
      || detail.media.posterPath
    ),
    posterPath: normalizeTextValue(
      detail.raw?.analysisArtifacts?.visualFramePaths?.[0]
      || detail.raw?.analysisArtifacts?.firstFramePath
      || detail.raw?.media?.firstFramePath
      || detail.media.coverPath
      || detail.media.posterPath
    ),
    title: detail.title,
    notice: waitingNotice,
    item: detail.raw || {}
  });
  const response = await requestAdShotAnalyze(detail.id);
  if (!response.ok) {
    sessionStorage.removeItem(autoRefetchKey);
    return;
  }
  pollAdShotUntilPlayable(detail.id);
}

function pollAdShotUntilPlayable(shotId) {
  const poll = async () => {
    try {
      const payload = await fetchJson(`/api/ad-shots/${encodeURIComponent(shotId)}`);
      const status = normalizeTextValue(payload?.analysisStatus);
      const hasVideo = hasPlayableLocalVideo(payload);
      if (hasVideo && status === "completed") {
        sessionStorage.removeItem(autoRefetchKey);
        window.location.reload();
        return;
      }
      if (status === "failed") {
        sessionStorage.removeItem(autoRefetchKey);
        window.location.reload();
        return;
      }
    } catch {
      sessionStorage.removeItem(autoRefetchKey);
      return;
    }
    window.setTimeout(poll, 4000);
  };
  window.setTimeout(poll, 1500);
}

function findAdShot(adShots, shotId) {
  return adShots.find((shot) => (shot.shotId || shot.id) === shotId);
}

function getAdShotAnalysis(shot) {
  const stored = shot.analysisSummary && typeof shot.analysisSummary === "object" ? shot.analysisSummary : {};
  const normalized = shot.analysis && typeof shot.analysis === "object" ? shot.analysis : {};
  return {
    ...stored,
    ...normalized,
    storyboardScenes: Array.isArray(normalized.storyboardScenes) && normalized.storyboardScenes.length
      ? normalized.storyboardScenes
      : stored.storyboardScenes
  };
}

function buildNormalMetrics(engagement = {}) {
  return [
    { label: "点赞", value: engagement.likeText || formatCount(engagement.likeCount) },
    { label: "评论", value: engagement.commentText || formatCount(engagement.commentCount) },
    { label: "收藏", value: engagement.saveText || formatCount(engagement.saveCount) },
    { label: "分享", value: engagement.shareText || formatCount(engagement.shareCount) }
  ];
}

function buildAdShotMetrics(shot) {
  const metrics = shot.raw?.metrics && typeof shot.raw.metrics === "object" ? shot.raw.metrics : {};
  const normalized = shot.metrics && typeof shot.metrics === "object" ? shot.metrics : {};
  return [
    { label: "点赞", value: formatCount(normalized.likeCount ?? shot.likeCount ?? metrics.like ?? metrics.likes) },
    { label: "评论", value: formatCount(normalized.commentCount ?? shot.commentCount ?? metrics.comment ?? metrics.comments) },
    { label: "收藏", value: formatCount(normalized.saveCount ?? shot.saveCount ?? metrics.save ?? metrics.collect ?? metrics.favorite) },
    { label: "转发", value: formatCount(normalized.shareCount ?? shot.shareCount ?? metrics.share ?? metrics.shares) },
    { label: "CTR", value: normalizeTextValue(shot.ctrLabel || shot.ctr || metrics.ctr) },
    { label: "预算", value: normalizeTextValue(shot.budgetLabel || shot.budget || metrics.budget) }
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
    return {
      text,
      meta: [item?.author, item?.timeText, item?.likeText].filter(Boolean).join(" / ")
    };
  }).filter((item) => item.text);
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
  const codes = Array.isArray(shot.countryCode) ? shot.countryCode.filter(Boolean) : [];
  return normalizeTextValue(shot.regionLabel) || codes.join(" / ");
}

function formatObjective(shot) {
  const text = normalizeTextValue(shot.objectiveLabel || shot.objective || shot.objectiveKey);
  if (text === "campaign_objective_traffic") return "引流 (Traffic)";
  return text;
}

function formatStatus(status) {
  const map = {
    pending: "待分析",
    queued: "排队中",
    running: "分析中",
    failed: "分析异常"
  };
  return map[status] || status;
}
