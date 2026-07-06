export function normalizeVisualTextSegments(items, duration = null) {
  if (!Array.isArray(items)) {
    return [];
  }

  const maxDuration = Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : null;
  return items
    .map((item) => {
      const start = Math.max(0, Number(item?.start ?? item?.startTime ?? item?.from ?? item?.begin) || 0);
      let end = Number(item?.end ?? item?.endTime ?? item?.to ?? item?.until);
      if (!Number.isFinite(end) || end <= start) {
        end = start + 2.5;
      }
      const cappedEnd = maxDuration ? Math.min(maxDuration, end) : end;
      const normalizedEnd = cappedEnd > start ? cappedEnd : (maxDuration ? Math.min(maxDuration, start + 1) : start + 1);
      const original = truncateText(normalizeText(item?.original || item?.source || item?.text || item?.onScreenTextOriginal), 240);
      const zh = truncateText(normalizeText(item?.zh || item?.translationZh || item?.translation_zh || item?.translation || item?.onScreenTextZh), 240);
      if (!original && !zh) {
        return null;
      }
      const normalized = {
        start: Number(start.toFixed(2)),
        end: Number(normalizedEnd.toFixed(2)),
        original,
        zh
      };
      const bbox = normalizeVisualTextBBox(item?.bbox || item?.boundingBox || item?.rect || item?.box);
      if (bbox) {
        normalized.bbox = bbox;
        normalized.overlayMode = ["plain", "plate"].includes(item?.overlayMode || item?.overlay_mode)
          ? (item.overlayMode || item.overlay_mode)
          : "plate";
        const bboxSource = normalizeText(item?.bboxSource || item?.bbox_source || item?.positionSource || item?.position_source);
        if (bboxSource) {
          normalized.bboxSource = bboxSource;
        }
        const bboxConfidence = Number(item?.bboxConfidence ?? item?.bbox_confidence ?? item?.positionConfidence ?? item?.position_confidence);
        if (Number.isFinite(bboxConfidence)) {
          normalized.bboxConfidence = Number(clampNumber(bboxConfidence, 0, 1).toFixed(4));
        }
        if (item?.bboxTrusted === true || item?.bbox_trusted === true || item?.bboxReviewed === true || item?.bbox_reviewed === true) {
          normalized.bboxTrusted = true;
        }
      }
      const textKey = normalizeText(item?.textKey || item?.text_key || item?.key);
      if (textKey) {
        normalized.textKey = textKey;
      }
      return normalized;
    })
    .filter(Boolean)
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .slice(0, 40);
}

export function mergeVisualTextSegmentsWithOcr({ duration = null, ocrSegments = [], semanticSegments = [], structuredSegments = [], fallbackSegments = [] } = {}) {
  const semantic = firstNonEmptyVisualTextSegments(duration, semanticSegments, structuredSegments, fallbackSegments);
  const ocr = normalizeVisualTextSegments(ocrSegments, duration)
    .filter((segment) => segment.bbox && isTrustedVisualTextBBox(segment));
  if (!ocr.length) {
    return semantic;
  }

  if (!semantic.length) {
    return ocr;
  }

  const usedOcr = new Set();
  const merged = [];
  const remainingSemantic = [];
  semantic.forEach((segment) => {
    const matches = findVisualTextOcrMatchesForSemantic(segment, ocr, usedOcr);
    if (!matches.length) {
      remainingSemantic.push(segment);
      return;
    }
    matches.forEach((match) => usedOcr.add(match.index));
    const matchedSegments = matches.map((match) => match.segment);
    merged.push({
      ...segment,
      start: Number((Number(segment.start) || Math.min(...matchedSegments.map((item) => Number(item.start) || 0))).toFixed(2)),
      end: Number((Number(segment.end) || Math.max(...matchedSegments.map((item) => Number(item.end) || 0))).toFixed(2)),
      original: segment.original || matchedSegments.map((item) => item.original).filter(Boolean).join(" "),
      zh: segment.zh || "",
      bbox: mergeVisualTextBBoxes(matchedSegments.map((item) => item.bbox)),
      overlayMode: segment.overlayMode || "plate",
      bboxSource: "rapidocr",
      bboxConfidence: averageVisualTextConfidence(matchedSegments),
      bboxTrusted: true
    });
  });

  return [...merged, ...remainingSemantic]
    .filter((segment) => segment.original || segment.zh)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .slice(0, 40);
}

export function firstNonEmptyVisualTextSegments(duration, ...sources) {
  return firstNonEmptyVisualTextSegmentsWithNormalizer(normalizeVisualTextSegments, duration, ...sources);
}

export function firstNonEmptyVisualTextSegmentsWithNormalizer(normalizeSegments, duration, ...sources) {
  const normalize = typeof normalizeSegments === "function" ? normalizeSegments : normalizeVisualTextSegments;
  for (const source of sources) {
    const segments = normalize(source, duration);
    if (segments.length) {
      return segments;
    }
  }
  return [];
}

export function isTrustedVisualTextBBox(segment) {
  if (!segment?.bbox) {
    return false;
  }
  if (segment.bboxTrusted === true || segment.bbox_trusted === true || segment.bboxReviewed === true || segment.bbox_reviewed === true) {
    return true;
  }
  const source = normalizeText(segment.bboxSource || segment.bbox_source || segment.positionSource || segment.position_source).toLowerCase();
  return [
    "manual",
    "human",
    "reviewed",
    "ocr",
    "rapidocr",
    "rapid-videocr",
    "rapid_videocr",
    "rapidvideocr",
    "vse",
    "video-subtitle-extractor",
    "videocr",
    "paddleocr"
  ].includes(source);
}

export function normalizeVisualTextBBox(value) {
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
  if (!raw) {
    return null;
  }

  const numbers = ["x", "y", "w", "h"].map((key) => Number(raw[key]));
  if (numbers.some((item) => !Number.isFinite(item))) {
    return null;
  }
  const shouldTreatAsPercent = numbers.some((item) => item > 1) && numbers.every((item) => item >= 0 && item <= 100);
  const [xRaw, yRaw, wRaw, hRaw] = shouldTreatAsPercent ? numbers.map((item) => item / 100) : numbers;
  const x = clampNumber(xRaw, 0, 0.98);
  const y = clampNumber(yRaw, 0, 0.98);
  const w = clampNumber(wRaw, 0.02, 1 - x);
  const h = clampNumber(hRaw, 0.02, 1 - y);
  if (w <= 0 || h <= 0) {
    return null;
  }
  return {
    x: Number(x.toFixed(4)),
    y: Number(y.toFixed(4)),
    w: Number(w.toFixed(4)),
    h: Number(h.toFixed(4))
  };
}

export function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function findVisualTextOcrMatchesForSemantic(semanticSegment, ocrSegments, usedOcr) {
  const semanticKey = visualTextKey(semanticSegment.original || semanticSegment.zh);
  const candidates = [];
  ocrSegments.forEach((ocrSegment, index) => {
    if (usedOcr.has(index)) {
      return;
    }
    const timeScore = visualTextTimeOverlapScore(ocrSegment, semanticSegment);
    if (timeScore < 0.16) {
      return;
    }
    const ocrKey = visualTextKey(ocrSegment.original);
    const textScore = visualTextMatchScore(ocrKey, semanticKey);
    const hasTextKeys = Boolean(ocrKey && semanticKey);
    const strongTextMatch = hasTextKeys && isStrongVisualTextMatch(ocrKey, semanticKey, textScore);
    const score = timeScore * 0.48 + textScore * 0.52;
    if (hasTextKeys && !strongTextMatch && textScore < 0.32) {
      return;
    }
    if (!hasTextKeys && score < 0.62) {
      return;
    }
    if (!strongTextMatch && score < 0.5) {
      return;
    }
    candidates.push({ segment: ocrSegment, index, score, textScore, timeScore, strongTextMatch });
  });
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => candidate.strongTextMatch || candidate.score >= 0.5)
    .sort((a, b) => a.segment.start - b.segment.start || a.segment.bbox.y - b.segment.bbox.y || a.segment.bbox.x - b.segment.bbox.x)
    .slice(0, 4);
}

function visualTextMatchScore(ocrKey, semanticKey) {
  if (!ocrKey || !semanticKey) {
    return 0;
  }
  let score = visualTextSimilarity(ocrKey, semanticKey);
  if (ocrKey.length >= 8 && semanticKey.includes(ocrKey)) {
    score = Math.max(score, 0.92);
  } else if (semanticKey.length >= 8 && ocrKey.includes(semanticKey)) {
    score = Math.max(score, 0.86);
  }
  return score;
}

function isStrongVisualTextMatch(ocrKey, semanticKey, score) {
  if (score >= 0.72) {
    return true;
  }
  if (ocrKey.length >= 8 && semanticKey.includes(ocrKey)) {
    return true;
  }
  return semanticKey.length >= 8 && ocrKey.includes(semanticKey);
}

function mergeVisualTextBBoxes(boxes) {
  const normalized = boxes.map(normalizeVisualTextBBox).filter(Boolean);
  if (!normalized.length) {
    return null;
  }
  const left = Math.min(...normalized.map((box) => box.x));
  const top = Math.min(...normalized.map((box) => box.y));
  const right = Math.max(...normalized.map((box) => box.x + box.w));
  const bottom = Math.max(...normalized.map((box) => box.y + box.h));
  return normalizeVisualTextBBox({
    x: left,
    y: top,
    w: right - left,
    h: bottom - top
  });
}

function averageVisualTextConfidence(segments) {
  const values = segments
    .map((segment) => Number(segment.bboxConfidence ?? segment.bbox_confidence))
    .filter((value) => Number.isFinite(value));
  if (!values.length) {
    return undefined;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function visualTextTimeOverlapScore(a, b) {
  const start = Math.max(Number(a?.start) || 0, Number(b?.start) || 0);
  const end = Math.min(Number(a?.end) || 0, Number(b?.end) || 0);
  const overlap = Math.max(0, end - start);
  const span = Math.max((Number(a?.end) || 0) - (Number(a?.start) || 0), (Number(b?.end) || 0) - (Number(b?.start) || 0), 0.1);
  return clampNumber(overlap / span, 0, 1);
}

function visualTextSimilarity(a, b) {
  const left = visualTextKey(a);
  const right = visualTextKey(b);
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  const leftBigrams = new Set(buildCharacterBigrams(left));
  const rightBigrams = new Set(buildCharacterBigrams(right));
  if (!leftBigrams.size || !rightBigrams.size) {
    return left.includes(right) || right.includes(left) ? 0.72 : 0;
  }
  let intersection = 0;
  for (const item of leftBigrams) {
    if (rightBigrams.has(item)) {
      intersection += 1;
    }
  }
  const union = leftBigrams.size + rightBigrams.size - intersection;
  return union ? intersection / union : 0;
}

function visualTextKey(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function buildCharacterBigrams(value) {
  if (value.length <= 2) {
    return [value];
  }
  const grams = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.push(value.slice(index, index + 2));
  }
  return grams;
}

function truncateText(value, maxLength) {
  const text = normalizeText(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
