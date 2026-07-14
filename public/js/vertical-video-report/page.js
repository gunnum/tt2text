import { fetchJson } from "../core/http.js";
import { getAdShotCoverPaths } from "../core/video-card.js";
import { escapeHtml } from "./formatters.js";
import { setStatus, showToast } from "../core/ui.js";
import { buildAppLogoIndex, renderDistributions } from "./distributions.js";
import { bindCopyIdButtons, renderHighlightCards } from "./highlight-cards.js";
import { renderAllVideos } from "./sample-table.js";
import { renderAnalysisNote, renderSummary } from "./summary.js";
import { createVideoDialogController } from "./video-dialog.js";
import {
  bindScriptCopyButtons,
  normalizeStrategy,
  renderCreatorContentVideoTypes,
  renderVideoTypes,
  resetVideoScriptPromptIndex
} from "./video-types.js";

export function initVerticalVideoReportPage() {
  const params = new URLSearchParams(window.location.search);
  const categoryId = params.get("category") || "reading";

  const els = {
    breadcrumb: document.querySelector("#breadcrumb"),
    title: document.querySelector("#page-title"),
    description: document.querySelector("#page-description"),
    status: document.querySelector("#status"),
    analysisNote: document.querySelector("#analysis-note"),
    summary: document.querySelector("#summary"),
    distributions: document.querySelector("#distributions"),
    strategyLessons: document.querySelector("#strategy-lessons"),
    strategyVideoTypes: document.querySelector("#strategy-video-types"),
    strategyContentAccount: document.querySelector("#strategy-content-account"),
    allVideos: document.querySelector("#all-videos"),
    toast: document.querySelector("#toast"),
    videoDialog: document.querySelector("#report-video-dialog"),
    videoStage: document.querySelector("#report-video-stage"),
    videoTitle: document.querySelector("#report-video-title"),
    videoMeta: document.querySelector("#report-video-meta"),
    videoClose: document.querySelector("#report-video-close")
  };

  let report = null;
  let appLogoIndex = new Map();

  const videoDialog = createVideoDialogController({
    dialogEl: els.videoDialog,
    stageEl: els.videoStage,
    titleEl: els.videoTitle,
    metaEl: els.videoMeta,
    closeEl: els.videoClose,
    findVideo: findReportVideo
  });

  async function loadReport() {
    setPageStatus("正在加载垂类视频报告...");
    const [detail, apps, adShots] = await Promise.all([
      fetchJson(`/api/report-output/video-categories/${encodeURIComponent(categoryId)}`),
      fetchJson("/api/apps").catch(() => []),
      fetchJson("/api/ad-shots").catch(() => [])
    ]);
    appLogoIndex = buildAppLogoIndex(apps);
    report = enrichReportVideosForPlayer(detail, adShots);
    renderReport(report);
    setPageStatus("已刷新");
  }

  function renderReport(detail) {
    resetVideoScriptPromptIndex();
    const strategy = normalizeStrategy(detail);
    document.title = `${detail.category.label} 垂类视频推广分析 - T2T`;
    if (els.title) els.title.textContent = `${detail.category.label} 垂类视频推广分析`;
    if (els.description) els.description.textContent = "基于当前已收录短视频，按互动强度拆解脚本结构、账号类型和可借鉴经验，并输出 App 账号、网红&内容号的内容生产建议。";
    renderBreadcrumb(detail.category);
    renderAnalysisNote(els.analysisNote, detail.analysis);
    renderSummary(els.summary, detail.summary);
    renderDistributions(els.distributions, detail.distributions, appLogoIndex);
    renderHighlightCards(els.strategyLessons, {
      highlights: detail.strategy?.highlightBreakdowns?.items || [],
      meta: detail.strategy?.highlightBreakdownMeta || detail.strategy?.highlightBreakdowns || {}
    });
    renderVideoTypes(els.strategyVideoTypes, strategy.appAccountVideoTypes || []);
    renderCreatorContentVideoTypes(els.strategyContentAccount, strategy.creatorContentVideoTypes || []);
    renderAllVideos(els.allVideos, detail.videos || []);
    bindScriptCopyButtons({ toastEl: els.toast });
    bindCopyIdButtons({ toastEl: els.toast });
    videoDialog.bindReportVideoButtons();
  }

  function renderBreadcrumb(category) {
    if (!els.breadcrumb) return;
    els.breadcrumb.innerHTML = `
      <a href="/">首页</a>
      <span aria-hidden="true">/</span>
      <a href="/reports">分析输出</a>
      <span aria-hidden="true">/</span>
      <span>${escapeHtml(category.label || "垂类视频")}</span>
    `;
  }

  function findReportVideo(videoId) {
    const id = String(videoId || "");
    const allVideos = report?.videos || [];
    const highlights = report?.strategy?.highlightBreakdowns?.items || [];
    return highlights.find((item) => item.id === id) || allVideos.find((item) => item.id === id) || null;
  }

  function setPageStatus(message) {
    setStatus(els.status, message);
  }

  function enrichReportVideosForPlayer(detail, adShots = []) {
    if (!detail || !Array.isArray(adShots) || !adShots.length) return detail;
    const shotIndex = new Map();
    adShots.forEach((shot) => {
      [shot?.shotId, shot?.id, shot?.sourceItemId, shot?.sourceAdId]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .forEach((id) => shotIndex.set(id, shot));
    });
    const enrichVideo = (video = {}) => {
      const shot = shotIndex.get(String(video.id || "").trim());
      return shot ? mergePlayerFields(video, shot) : video;
    };
    const next = {
      ...detail,
      videos: Array.isArray(detail.videos) ? detail.videos.map(enrichVideo) : detail.videos
    };
    const highlightBreakdowns = detail.strategy?.highlightBreakdowns;
    if (highlightBreakdowns && Array.isArray(highlightBreakdowns.items)) {
      next.strategy = {
        ...(detail.strategy || {}),
        highlightBreakdowns: {
          ...highlightBreakdowns,
          items: highlightBreakdowns.items.map(enrichVideo)
        }
      };
    }
    return next;
  }

  function mergePlayerFields(video = {}, shot = {}) {
    const analysis = shot.analysis && typeof shot.analysis === "object" ? shot.analysis : {};
    const musicTrack = firstText(shot.musicTrack, shot.bgmTitle, shot.musicTitle, shot.soundTitle, shot.raw?.musicTrack, shot.raw?.bgmTitle, shot.raw?.track, analysis.musicTrack, analysis.bgmTitle, analysis.musicTitle, analysis.soundTitle);
    const musicArtist = firstText(shot.musicArtist, shot.soundArtist, shot.artist, shot.raw?.musicArtist, shot.raw?.artist, analysis.musicArtist, analysis.soundArtist);
    const transcriptZh = firstText(shot.transcriptZh, shot.translation_zh, analysis.speechSubtitleZh, analysis.subtitleZh);
    const audioKind = firstText(shot.audioKind, shot.audioType, shot.audio_kind, shot.audio_type, analysis.audioKind, analysis.audioType)
      || (musicTrack && !transcriptZh ? "bgm_only" : "");
    const coverPaths = uniquePaths([
      ...(Array.isArray(video.coverPaths) ? video.coverPaths : []),
      ...(Array.isArray(video.framePaths) ? video.framePaths : []),
      ...getAdShotCoverPaths(shot),
      video.posterPath
    ]);
    return {
      ...video,
      coverPaths,
      posterPath: coverPaths[0] || video.posterPath || "",
      appLogoUrl: video.appLogoUrl || firstText(shot.app?.logoUrl, shot.appLogoUrl, shot.logoUrl),
      authorName: video.authorName || firstText(shot.authorName, shot.raw?.author, shot.brandName),
      authorAvatarUrl: video.authorAvatarUrl || firstText(shot.authorAvatarUrl, shot.authorAvatar, shot.avatarUrl, shot.profileImageUrl, shot.raw?.authorAvatarUrl, shot.raw?.authorAvatar, shot.raw?.avatarUrl, shot.raw?.profileImageUrl, shot.raw?.author?.avatarUrl, shot.raw?.author?.avatarThumb, shot.raw?.authorStats?.avatarUrl),
      accountAvatarUrl: video.accountAvatarUrl || firstText(shot.accountAvatarUrl, shot.raw?.accountAvatarUrl),
      followerCount: video.followerCount ?? firstNumeric(shot.followerCount, shot.followers, shot.fansCount, shot.authorFollowerCount, shot.authorFollowers, shot.raw?.followerCount, shot.raw?.followers, shot.raw?.fansCount, shot.raw?.authorFollowerCount, shot.raw?.authorFollowers, shot.raw?.author?.followerCount, shot.raw?.author?.followers, shot.raw?.authorStats?.followerCount, shot.raw?.authorStats?.followers),
      transcriptZh: video.transcriptZh || transcriptZh,
      speechSubtitleZh: video.speechSubtitleZh || firstText(analysis.speechSubtitleZh, analysis.subtitleZh),
      visualTextSegments: Array.isArray(video.visualTextSegments) && video.visualTextSegments.length
        ? video.visualTextSegments
        : normalizePlayerVisualTextSegments(shot.visualTextSegments || analysis.visualTextSegments),
      bgmTitle: video.bgmTitle || musicTrack,
      musicTrack: video.musicTrack || musicTrack,
      musicTitle: video.musicTitle || musicTrack,
      soundTitle: video.soundTitle || musicTrack,
      musicArtist: video.musicArtist || musicArtist,
      audioKind: video.audioKind || audioKind,
      audioType: video.audioType || audioKind,
      isBgmOnly: video.isBgmOnly ?? Boolean(musicTrack && !transcriptZh)
    };
  }

  function normalizePlayerVisualTextSegments(value) {
    return (Array.isArray(value) ? value : [])
      .map((segment) => ({
        ...segment,
        bbox: normalizePlayerBbox(segment?.bbox || segment?.box || segment?.rect)
      }))
      .filter((segment) => segment.zh || segment.original || segment.text);
  }

  function normalizePlayerBbox(value) {
    if (!value || typeof value !== "object") return undefined;
    const x = Number(value.x ?? value.left);
    const y = Number(value.y ?? value.top);
    const w = Number(value.w ?? value.width);
    const h = Number(value.h ?? value.height);
    return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : undefined;
  }

  function firstText(...values) {
    return values.map((value) => String(value || "").trim()).find(Boolean) || "";
  }

  function firstNumeric(...values) {
    return values.find((value) => Number.isFinite(Number(value)) && Number(value) >= 0);
  }

  function uniquePaths(values = []) {
    return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
  }

  loadReport().catch((error) => {
    setPageStatus(`加载失败：${error.message}`);
    showToast(els.toast, `加载失败：${error.message}`);
  });
}
