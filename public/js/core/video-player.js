import { escapeAttribute, escapeHtml } from "./format.js";
import { buildTimedSubtitleData } from "./video-subtitles.js";
import { getAnalysisProgressInfo } from "./analysis-progress.js";

const PLAYER_PREF_KEYS = {
  speech: "tt2text.player.speechCcEnabled",
  visual: "tt2text.player.visualCcEnabled"
};

export function renderUnifiedVideoPlayer(options = {}) {
  const {
    videoPath = "",
    posterPath = "",
    coverPath = "",
    coverPaths = [],
    title = "",
    emptyLabel = "当前素材没有可播放视频。",
    notice = null,
    item = null,
    videoId = "",
    videoClassName = "",
    imageClassName = "",
    includeVisualTextOverlay = true
  } = options;

  const subtitleData = buildTimedSubtitleData(item || {});
  const fallbackCoverPaths = uniquePaths([coverPath, posterPath, ...coverPaths, ...(Array.isArray(item?.coverPaths) ? item.coverPaths : []), ...(Array.isArray(item?.framePaths) ? item.framePaths : [])]);
  const fallbackCoverPath = fallbackCoverPaths[0] || "";
  const fallbackPathsAttribute = fallbackCoverPaths.length
    ? ` data-cover-paths="${escapeAttribute(JSON.stringify(fallbackCoverPaths))}"`
    : "";
  const hasVisualOverlay = includeVisualTextOverlay && subtitleData.positionedVisualTextSegments.length > 0;
  const hasSpeechOverlay = subtitleData.subtitleSegments.length > 0;
  const hasAnyOverlay = hasVisualOverlay || hasSpeechOverlay;

  const noticeHtml = notice ? renderVideoPlayerNotice(notice, { compact: Boolean(videoPath) }) : "";

  if (videoPath) {
    return `
      <video${videoId ? ` id="${escapeAttribute(videoId)}"` : ""} class="${escapeAttribute(videoClassName)}" controls playsinline preload="metadata" src="${escapeAttribute(videoPath)}"${fallbackCoverPath ? ` poster="${escapeAttribute(fallbackCoverPath)}"` : ""}${fallbackPathsAttribute}></video>
      ${hasAnyOverlay ? renderVideoPlayerCaptionToggles({ hasSpeechOverlay, hasVisualOverlay, speechLabel: subtitleData.audioToggleLabel }) : ""}
      ${hasVisualOverlay ? renderVisualTextOverlay() : ""}
      ${hasSpeechOverlay ? renderSpeechSubtitleOverlay(subtitleData) : ""}
      ${noticeHtml}
    `;
  }

  if (notice) {
    const cover = fallbackCoverPath
      ? `<img class="${escapeAttribute(imageClassName)}" src="${escapeAttribute(fallbackCoverPath)}" alt="${escapeAttribute(title + " 封面")}"${fallbackPathsAttribute} />`
      : '<div class="video-player-empty">Video</div>';
    return cover + noticeHtml;
  }

  if (fallbackCoverPath) {
    return `<img class="${escapeAttribute(imageClassName)}" src="${escapeAttribute(fallbackCoverPath)}" alt="${escapeAttribute(title + " 封面")}"${fallbackPathsAttribute} />`;
  }

  return `<div class="video-player-empty">${escapeHtml(emptyLabel)}</div>`;
}

export function bindUnifiedVideoPlayer(root, options = {}) {
  const {
    item = null,
    duration = 0,
    videoSelector = "video",
    subtitleSelector = "[data-speech-subtitle]",
    visualLayerSelector = "[data-visual-text-layer]",
    visualOverlaySelector = "[data-visual-text-overlay]",
    visualTextSelector = "[data-visual-text-content]",
    speechToggleSelector = "[data-player-toggle='speech']",
    visualToggleSelector = "[data-player-toggle='visual']",
    bindVideoErrorFallback = true
  } = options;
  const subtitleData = buildTimedSubtitleData(item || {});
  const video = root?.querySelector?.(videoSelector);
  const subtitleEl = root?.querySelector?.(subtitleSelector);
  const visualLayer = root?.querySelector?.(visualLayerSelector);
  const visualOverlay = root?.querySelector?.(visualOverlaySelector);
  const visualTextEl = root?.querySelector?.(visualTextSelector);
  const speechToggleEl = root?.querySelector?.(speechToggleSelector);
  const visualToggleEl = root?.querySelector?.(visualToggleSelector);
  const subtitleSegments = Array.isArray(subtitleData.subtitleSegments) ? subtitleData.subtitleSegments : [];
  const speechToggleLabel = subtitleData.audioToggleLabel || "声音 CC";
  const visualTextSegments = Array.isArray(subtitleData.positionedVisualTextSegments) ? subtitleData.positionedVisualTextSegments : [];
  const fallbackDuration = Number(duration) || 0;
  let speechEnabled = loadCaptionPreference("speech");
  let visualEnabled = loadCaptionPreference("visual");

  if (!video) {
    return bindPlayerCoverFallback(root);
  }

  const handleVideoError = () => {
    const coverPaths = readCoverPaths(video);
    if (!root || !coverPaths.length) return;
    root.innerHTML = `<img src="${escapeAttribute(coverPaths[0])}" alt="视频封面" data-cover-paths="${escapeAttribute(JSON.stringify(coverPaths))}" />`;
    bindPlayerCoverFallback(root);
  };

  const currentVideoDuration = () => Number.isFinite(video.duration) && video.duration > 0 ? video.duration : fallbackDuration;

  const updateSpeechSubtitle = () => {
    if (!subtitleEl || !subtitleSegments.length) return;
    subtitleEl.parentElement.hidden = !speechEnabled;
    if (!speechEnabled) {
      subtitleEl.textContent = "";
      return;
    }
    const durationValue = currentVideoDuration();
    const ratio = durationValue > 0 ? Math.min(0.999, Math.max(0, video.currentTime / durationValue)) : 0;
    const index = Math.min(subtitleSegments.length - 1, Math.floor(ratio * subtitleSegments.length));
    subtitleEl.textContent = subtitleSegments[index] || "";
  };

  const hideVisualSubtitle = () => {
    if (!visualLayer || !visualTextEl) return;
    visualLayer.hidden = true;
    visualTextEl.textContent = "";
  };

  const getVideoContentRect = () => {
    if (!visualLayer) return null;
    const stage = video.closest(".video-stage, .unified-video-stage, .shot-player-stage");
    const layerRect = (stage || visualLayer).getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();
    if (!layerRect.width || !layerRect.height || !videoRect.width || !videoRect.height) return null;
    const intrinsicWidth = Number(video.videoWidth) || 0;
    const intrinsicHeight = Number(video.videoHeight) || 0;
    let contentWidth = videoRect.width;
    let contentHeight = videoRect.height;
    let contentLeft = videoRect.left - layerRect.left;
    let contentTop = videoRect.top - layerRect.top;
    if (intrinsicWidth > 0 && intrinsicHeight > 0) {
      const intrinsicRatio = intrinsicWidth / intrinsicHeight;
      const elementRatio = videoRect.width / videoRect.height;
      if (elementRatio > intrinsicRatio) {
        contentWidth = videoRect.height * intrinsicRatio;
        contentLeft += (videoRect.width - contentWidth) / 2;
      } else if (elementRatio < intrinsicRatio) {
        contentHeight = videoRect.width / intrinsicRatio;
        contentTop += (videoRect.height - contentHeight) / 2;
      }
    }
    return {
      x: contentLeft,
      y: contentTop,
      width: contentWidth,
      height: contentHeight
    };
  };

  const updateVisualSubtitle = () => {
    if (!visualLayer || !visualOverlay || !visualTextEl || !visualTextSegments.length) return;
    if (!visualEnabled) {
      hideVisualSubtitle();
      return;
    }
    const currentTime = Math.max(0, video.currentTime || 0);
    const active = visualTextSegments.find((segment) => currentTime >= Number(segment.start) && currentTime <= Number(segment.end));
    if (!active || !hasVisualTextBBox(active)) {
      hideVisualSubtitle();
      return;
    }
    const contentRect = getVideoContentRect();
    if (!contentRect) {
      hideVisualSubtitle();
      return;
    }
    const bbox = active.bbox;
    const overlayWidth = clamp(Math.max(Number(bbox.w), 0.26), 0.12, 0.94);
    const overlayHeight = clamp(Math.max(Number(bbox.h), 0.04), 0.035, 0.22);
    const centerX = Number(bbox.x) + Number(bbox.w) / 2;
    const centerY = Number(bbox.y) + Number(bbox.h) / 2;
    const left = clamp(centerX - overlayWidth / 2, 0.02, 0.98 - overlayWidth);
    const top = clamp(centerY - overlayHeight / 2, 0.02, 0.98 - overlayHeight);
    visualOverlay.style.left = `${contentRect.x + left * contentRect.width}px`;
    visualOverlay.style.top = `${contentRect.y + top * contentRect.height}px`;
    visualOverlay.style.width = `${overlayWidth * contentRect.width}px`;
    visualOverlay.style.minHeight = `${overlayHeight * contentRect.height}px`;
    visualOverlay.classList.toggle("plain", active.overlayMode === "plain");
    visualTextEl.textContent = active.zh || "";
    visualLayer.hidden = false;
  };

  const updateToggleButton = (button, enabled, label) => {
    if (!button) return;
    button.dataset.enabled = enabled ? "true" : "false";
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
    button.setAttribute("title", `${label}${enabled ? "已开启" : "已关闭"}`);
  };

  const updateToggleButtons = () => {
    updateToggleButton(speechToggleEl, speechEnabled, speechToggleLabel);
    updateToggleButton(visualToggleEl, visualEnabled, "画面 CC");
  };

  const updateAll = () => {
    updateToggleButtons();
    updateSpeechSubtitle();
    updateVisualSubtitle();
  };

  const handleSpeechToggle = () => {
    speechEnabled = !speechEnabled;
    saveCaptionPreference("speech", speechEnabled);
    updateAll();
  };

  const handleVisualToggle = () => {
    visualEnabled = !visualEnabled;
    saveCaptionPreference("visual", visualEnabled);
    updateAll();
  };

  speechToggleEl?.addEventListener("click", handleSpeechToggle);
  visualToggleEl?.addEventListener("click", handleVisualToggle);
  video.addEventListener("loadedmetadata", updateAll);
  video.addEventListener("timeupdate", updateAll);
  video.addEventListener("seeked", updateAll);
  video.addEventListener("play", updateAll);
  if (bindVideoErrorFallback) {
    video.addEventListener("error", handleVideoError, { once: true });
  }
  window.addEventListener("resize", updateVisualSubtitle);
  updateAll();

  return () => {
    speechToggleEl?.removeEventListener("click", handleSpeechToggle);
    visualToggleEl?.removeEventListener("click", handleVisualToggle);
    video.removeEventListener("loadedmetadata", updateAll);
    video.removeEventListener("timeupdate", updateAll);
    video.removeEventListener("seeked", updateAll);
    video.removeEventListener("play", updateAll);
    if (bindVideoErrorFallback) {
      video.removeEventListener("error", handleVideoError);
    }
    window.removeEventListener("resize", updateVisualSubtitle);
  };
}

function bindPlayerCoverFallback(root) {
  const image = root?.querySelector?.("img[data-cover-paths]");
  if (!image) return () => {};
  const coverPaths = readCoverPaths(image);
  let index = Math.max(0, coverPaths.indexOf(image.getAttribute("src") || ""));
  const handleError = () => {
    index += 1;
    const nextPath = coverPaths[index] || "";
    if (nextPath) {
      image.src = nextPath;
      return;
    }
    image.remove();
    if (root && !root.querySelector(".video-player-empty")) {
      root.insertAdjacentHTML("afterbegin", '<div class="video-player-empty">当前素材没有可用封面。</div>');
    }
  };
  image.addEventListener("error", handleError);
  return () => image.removeEventListener("error", handleError);
}

function readCoverPaths(element) {
  try {
    return uniquePaths(JSON.parse(element?.dataset?.coverPaths || "[]"));
  } catch {
    return [];
  }
}

function uniquePaths(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean)));
}

export function renderVideoPlayerNotice(notice = {}, options = {}) {
  const title = String(notice.title || "").trim() || "视频处理中";
  const body = String(notice.body || "").trim();
  const progress = notice.progress && typeof notice.progress === "object"
    ? getAnalysisProgressInfo(notice.progress)
    : null;
  const className = options.compact || notice.compact ? "video-player-notice compact" : "video-player-notice";
  return `
    <div class="${className}">
      <b>${escapeHtml(title)}</b>
      ${progress ? `<small class="video-player-notice-progress">${escapeHtml(progress.fullText)}</small>` : ""}
      ${body ? `<span>${escapeHtml(body)}</span>` : ""}
    </div>
  `;
}

export function renderSpeechSubtitleOverlay(subtitleData = {}) {
  if (!subtitleData?.subtitleSegments?.length) {
    return "";
  }
  return `<div class="speech-subtitle-overlay" aria-label="视频中文字幕"><p class="speech-subtitle-line" data-speech-subtitle>${escapeHtml(subtitleData.subtitleSegments[0])}</p></div>`;
}

export function renderVideoPlayerCaptionToggles(options = {}) {
  const {
    hasSpeechOverlay = false,
    hasVisualOverlay = false,
    speechLabel = "声音 CC"
  } = options;
  return `
    <div class="video-player-caption-toggles" aria-label="字幕显示控制">
      ${hasSpeechOverlay ? `<button class="video-player-caption-toggle" type="button" data-player-toggle="speech" aria-pressed="true">${escapeHtml(speechLabel || "声音 CC")}</button>` : ""}
      ${hasVisualOverlay ? `<button class="video-player-caption-toggle" type="button" data-player-toggle="visual" aria-pressed="true">画面 CC</button>` : ""}
    </div>
  `;
}

export function renderVisualTextOverlay() {
  return `
    <div class="visual-text-layer" data-visual-text-layer aria-label="画面文字原位中文覆盖" hidden>
      <div class="visual-text-overlay" data-visual-text-overlay>
        <span data-visual-text-content></span>
      </div>
    </div>
  `;
}

export function buildVideoPlayerStyles() {
  return `
    .video-player-caption-toggles { position:absolute; top:12px; right:12px; z-index:5; display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
    .video-player-caption-toggle { min-width:74px; min-height:30px; padding:0 10px; border:1px solid rgba(255,255,255,.22); border-radius:999px; background:rgba(15,17,21,.72); color:rgba(255,255,255,.92); font:inherit; font-size:12px; font-weight:900; line-height:1; cursor:pointer; backdrop-filter:blur(10px); transition:background 160ms ease,border-color 160ms ease,color 160ms ease,opacity 160ms ease; }
    .video-player-caption-toggle[data-enabled="false"] { background:rgba(15,17,21,.42); border-color:rgba(255,255,255,.12); color:rgba(255,255,255,.58); }
    .speech-subtitle-overlay { position:absolute; left:12px; right:12px; bottom:72px; display:flex; justify-content:center; pointer-events:none; z-index:2; }
    .speech-subtitle-line { margin:0; width:fit-content; max-width:min(92%,360px); padding:7px 10px; border-radius:12px; background:rgba(0,0,0,.68); color:#fff; text-align:center; text-shadow:0 1px 3px rgba(0,0,0,.75); font-size:14px; line-height:1.45; font-weight:850; backdrop-filter:blur(8px); }
    .speech-subtitle-line:empty { display:none; }
    .visual-text-layer { position:absolute; inset:0; pointer-events:none; z-index:3; }
    .visual-text-overlay { position:absolute; display:flex; align-items:center; justify-content:center; min-width:88px; min-height:30px; padding:5px 9px; border-radius:10px; background:rgba(255,255,255,.92); color:#111; text-align:center; text-shadow:none; font-size:clamp(12px,3.6vw,18px); line-height:1.22; font-weight:900; box-shadow:0 8px 22px rgba(0,0,0,.18); backdrop-filter:blur(5px); overflow:hidden; }
    .visual-text-overlay.plain { min-width:0; min-height:0; padding:2px 4px; border-radius:4px; background:rgba(255,255,255,.92); color:#111; box-shadow:0 4px 12px rgba(0,0,0,.14); backdrop-filter:blur(5px); text-shadow:none; }
    .visual-text-overlay span { display:block; max-width:100%; overflow-wrap:anywhere; }
    .video-player-empty { display:grid; place-items:center; min-height:520px; color:rgba(255,255,255,.74); font-weight:900; }
    .video-player-notice { position:absolute; inset:auto 16px 16px; z-index:4; min-height:0; padding:14px 16px; border-radius:16px; background:rgba(0,0,0,.72); text-align:center; backdrop-filter:blur(10px); display:grid; gap:6px; color:rgba(255,255,255,.92); }
    .video-player-notice b { display:block; justify-self:center; width:100%; font-size:16px; line-height:1.35; text-align:center; }
    .video-player-notice-progress { display:block; justify-self:center; width:100%; color:rgba(255,255,255,.82); font-size:12px; line-height:1.45; font-weight:900; letter-spacing:0; text-align:center; }
    .video-player-notice span { display:block; justify-self:center; width:100%; max-width:300px; color:rgba(255,255,255,.76); font-size:12px; line-height:1.55; font-weight:700; text-align:center; }
    .video-player-notice.compact { inset:12px auto auto 12px; width:min(300px, calc(100% - 24px)); padding:10px 12px; text-align:left; pointer-events:none; }
    .video-player-notice.compact b,
    .video-player-notice.compact .video-player-notice-progress,
    .video-player-notice.compact span { justify-self:start; text-align:left; }
    .video-player-notice.compact b { font-size:13px; }
    .video-player-notice.compact span { max-width:none; font-size:11px; line-height:1.45; }
    @media (max-width: 900px) {
      .video-player-caption-toggles { top:10px; right:10px; gap:6px; }
      .video-player-caption-toggle { min-width:68px; min-height:28px; padding:0 9px; font-size:11px; }
      .speech-subtitle-overlay { bottom:66px; left:10px; right:10px; }
      .speech-subtitle-line { font-size:13px; }
    }
  `;
}

function hasVisualTextBBox(segment) {
  const bbox = segment?.bbox;
  return Boolean(bbox && Number.isFinite(Number(bbox.x)) && Number.isFinite(Number(bbox.y)) && Number.isFinite(Number(bbox.w)) && Number.isFinite(Number(bbox.h)));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function loadCaptionPreference(type) {
  try {
    return window.localStorage.getItem(PLAYER_PREF_KEYS[type]) !== "false";
  } catch {
    return true;
  }
}

function saveCaptionPreference(type, enabled) {
  try {
    window.localStorage.setItem(PLAYER_PREF_KEYS[type], enabled ? "true" : "false");
  } catch {}
}
