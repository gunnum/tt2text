import { escapeHtml } from "./format.js";

export function buildTimedSubtitleData(item = {}) {
  const analysis = getAnalysisBundle(item);
  const bgmLabel = buildBgmOverlayLabel(item, analysis);
  const audioOverlayKind = bgmLabel ? "bgm" : "speech";
  const speechSubtitle = bgmLabel ? "" : normalizeChineseSubtitle(item.transcriptZh || analysis.speechSubtitleZh || analysis.subtitleZh);
  const visualTextSegments = normalizeVisualTextSegments(item.visualTextSegments || analysis.visualTextSegments);
  const positionedVisualTextSegments = visualTextSegments.filter((segment) => hasVisualTextBBox(segment) && segment.zh);
  const subtitleSegments = buildSubtitleSegments(
    bgmLabel || speechSubtitle || buildFallbackSubtitleFromVisualTextSegments(visualTextSegments)
  );
  return {
    audioOverlayKind,
    audioOverlayLabel: bgmLabel,
    audioToggleLabel: bgmLabel ? "BGM" : "声音 CC",
    speechSubtitle,
    subtitleSegments,
    visualTextSegments,
    positionedVisualTextSegments,
    hasSubtitleOverlay: subtitleSegments.length > 0
  };
}

export function renderSpeechSubtitleOverlay(subtitleData = {}) {
  if (!subtitleData?.hasSubtitleOverlay || !subtitleData.subtitleSegments?.length) {
    return "";
  }
  return `<div class="speech-subtitle-overlay" aria-label="视频中文字幕"><p class="speech-subtitle-line" data-speech-subtitle>${escapeHtml(subtitleData.subtitleSegments[0])}</p></div>`;
}

export function bindTimedSubtitleOverlay(root, subtitleData = {}, options = {}) {
  const video = root?.querySelector?.(options.videoSelector || "video");
  const subtitleEl = root?.querySelector?.(options.subtitleSelector || "[data-speech-subtitle]");
  const subtitleSegments = Array.isArray(subtitleData?.subtitleSegments) ? subtitleData.subtitleSegments : [];
  const fallbackDuration = Number(options.duration) || 0;
  if (!video || !subtitleEl || !subtitleSegments.length) {
    return () => {};
  }

  const currentVideoDuration = () => Number.isFinite(video.duration) && video.duration > 0 ? video.duration : fallbackDuration;
  const update = () => {
    const duration = currentVideoDuration();
    const ratio = duration > 0 ? Math.min(0.999, Math.max(0, video.currentTime / duration)) : 0;
    const index = Math.min(subtitleSegments.length - 1, Math.floor(ratio * subtitleSegments.length));
    subtitleEl.textContent = subtitleSegments[index] || "";
  };

  video.addEventListener("loadedmetadata", update);
  video.addEventListener("timeupdate", update);
  video.addEventListener("seeked", update);
  video.addEventListener("play", update);
  update();

  return () => {
    video.removeEventListener("loadedmetadata", update);
    video.removeEventListener("timeupdate", update);
    video.removeEventListener("seeked", update);
    video.removeEventListener("play", update);
  };
}

function getAnalysisBundle(item = {}) {
  if (item.analysisSummary && typeof item.analysisSummary === "object") return item.analysisSummary;
  if (item.analysis && typeof item.analysis === "object") return item.analysis;
  return {};
}

function buildBgmOverlayLabel(item = {}, analysis = {}) {
  if (!isBgmOnlyAudio(item, analysis)) return "";
  const title = firstText(
    item.bgmTitle,
    item.musicTrack,
    item.musicTitle,
    item.soundTitle,
    item.track,
    item.raw?.bgmTitle,
    item.raw?.musicTrack,
    item.raw?.musicTitle,
    item.raw?.soundTitle,
    item.raw?.track,
    analysis.bgmTitle,
    analysis.musicTrack,
    analysis.musicTitle,
    analysis.soundTitle
  );
  const artist = firstText(
    item.musicArtist,
    item.soundArtist,
    item.artist,
    item.raw?.musicArtist,
    item.raw?.soundArtist,
    item.raw?.artist,
    analysis.musicArtist,
    analysis.soundArtist,
    Array.isArray(item.musicArtists) ? item.musicArtists[0] : "",
    Array.isArray(item.raw?.musicArtists) ? item.raw.musicArtists[0] : ""
  );
  const musicName = formatMusicName(title, artist) || "背景音乐";
  return `BGM：${musicName}`;
}

function isBgmOnlyAudio(item = {}, analysis = {}) {
  const kind = normalizeText(
    item.audioKind
    || item.audioType
    || item.audio_kind
    || item.audio_type
    || item.soundKind
    || item.soundType
    || item.raw?.audioKind
    || item.raw?.audioType
    || analysis.audioKind
    || analysis.audioType
  ).toLowerCase();
  if (["bgm", "music", "music_only", "bgm_only", "background_music", "no_speech"].includes(kind)) return true;
  if (item.isBgmOnly === true || item.bgmOnly === true || analysis.isBgmOnly === true || analysis.bgmOnly === true) return true;
  return false;
}

function formatMusicName(title, artist) {
  const cleanTitle = normalizeText(title);
  const cleanArtist = normalizeText(artist);
  if (!cleanTitle && !cleanArtist) return "";
  if (!cleanTitle) return cleanArtist;
  if (!cleanArtist || cleanTitle.toLowerCase().includes(cleanArtist.toLowerCase())) return cleanTitle;
  return `${cleanTitle} - ${cleanArtist}`;
}

function firstText(...items) {
  for (const item of items) {
    const text = normalizeText(item);
    if (text) return text;
  }
  return "";
}

function buildSubtitleSegments(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const sentenceParts = normalized
    .split(/(?<=[。！？!?])\s*/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
  const parts = sentenceParts.length ? sentenceParts : [normalized];
  const segments = [];
  for (const part of parts) {
    if (part.length <= 44) {
      segments.push(part);
      continue;
    }
    const clauses = part
      .split(/(?<=[，,；;：:])\s*/)
      .map((item) => normalizeText(item))
      .filter(Boolean);
    if (clauses.length <= 1) {
      segments.push(...splitTextByLength(part, 36));
      continue;
    }
    let current = "";
    for (const clause of clauses) {
      if (!current || `${current}${clause}`.length <= 44) {
        current = `${current}${clause}`;
        continue;
      }
      segments.push(current);
      current = clause;
    }
    if (current) {
      segments.push(current);
    }
  }
  return segments.map((item) => truncateText(item, 58)).filter(Boolean).slice(0, 12);
}

function buildFallbackSubtitleFromVisualTextSegments(segments = []) {
  const lines = segments
    .map((segment) => normalizeText(segment?.zh))
    .filter((text) => text && !/品牌名|品牌 logo|logo|水印/i.test(text));
  return Array.from(new Set(lines)).join("。");
}

function normalizeChineseSubtitle(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return /[\u3400-\u9fff]/.test(text) ? text : "";
}

function normalizeVisualTextSegments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item && typeof item === "object" ? item : null)
    .filter(Boolean)
    .map((item) => {
      const normalized = {
        start: Number(item.start) || 0,
        end: Number(item.end) || 0,
        zh: normalizeText(item.zh),
        original: normalizeText(item.original)
      };
      const bbox = normalizeVisualTextBBox(item.bbox || item.boundingBox || item.rect || item.box);
      if (bbox) {
        normalized.bbox = bbox;
        normalized.overlayMode = ["plain", "plate"].includes(item.overlayMode || item.overlay_mode)
          ? (item.overlayMode || item.overlay_mode)
          : "plate";
        if (item.bboxTrusted === true || item.bbox_trusted === true || item.bboxReviewed === true || item.bbox_reviewed === true) {
          normalized.bboxTrusted = true;
        }
        const bboxSource = normalizeText(item.bboxSource || item.bbox_source || item.positionSource || item.position_source);
        if (bboxSource) {
          normalized.bboxSource = bboxSource;
        }
      }
      return normalized;
    })
    .filter((item) => item.zh);
}

function hasVisualTextBBox(segment) {
  const bbox = segment?.bbox;
  return Boolean(bbox && Number.isFinite(Number(bbox.x)) && Number.isFinite(Number(bbox.y)) && Number.isFinite(Number(bbox.w)) && Number.isFinite(Number(bbox.h)));
}

function normalizeVisualTextBBox(value) {
  let raw = null;
  if (Array.isArray(value) && value.length >= 4) {
    raw = {
      x: value[0],
      y: value[1],
      w: value[2],
      h: value[3]
    };
  } else if (value && typeof value === "object") {
    raw = {
      x: value.x ?? value.left,
      y: value.y ?? value.top,
      w: value.w ?? value.width,
      h: value.h ?? value.height
    };
  }
  if (!raw) return null;
  const numbers = ["x", "y", "w", "h"].map((key) => Number(raw[key]));
  if (numbers.some((item) => !Number.isFinite(item))) return null;
  const shouldTreatAsPercent = numbers.some((item) => item > 1) && numbers.every((item) => item >= 0 && item <= 100);
  const [xRaw, yRaw, wRaw, hRaw] = shouldTreatAsPercent ? numbers.map((item) => item / 100) : numbers;
  const x = clampNumber(xRaw, 0, 0.98);
  const y = clampNumber(yRaw, 0, 0.98);
  const w = clampNumber(wRaw, 0.02, 1 - x);
  const h = clampNumber(hRaw, 0.02, 1 - y);
  if (w <= 0 || h <= 0) return null;
  return {
    x: Number(x.toFixed(4)),
    y: Number(y.toFixed(4)),
    w: Number(w.toFixed(4)),
    h: Number(h.toFixed(4))
  };
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function splitTextByLength(text, maxLength) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const parts = [];
  for (let index = 0; index < normalized.length; index += maxLength) {
    parts.push(normalized.slice(index, index + maxLength));
  }
  return parts;
}

function truncateText(text, maxLength) {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
