const SCENE_ROLES = new Set([
  "hook",
  "problem",
  "context",
  "product_entry",
  "feature_demo",
  "proof",
  "result",
  "cta"
]);

export function normalizeStoryboardScenes({
  scenes = [],
  storyboardFormula = [],
  keyMoments = [],
  duration = null,
  framePaths = [],
  posterPath = ""
} = {}) {
  const normalizedDuration = finitePositive(duration);
  const rawScenes = Array.isArray(scenes) && scenes.length
    ? scenes
    : buildLegacyScenes(storyboardFormula, keyMoments, normalizedDuration);
  const count = Math.min(12, rawScenes.length);
  return rawScenes.slice(0, count).map((rawScene, index) => {
    const scene = typeof rawScene === "string" ? { scene: rawScene } : (rawScene || {});
    const text = cleanSceneText(scene.scene || scene.visual || scene.description || scene.text || scene.moment);
    const explicitRange = readSceneRange(scene, scene.ignoreFallbackMomentTime ? "" : keyMoments[index]);
    const fallbackRange = evenSceneRange(index, count, normalizedDuration);
    const start = clampTime(explicitRange?.start ?? fallbackRange.start, normalizedDuration);
    let end = clampTime(explicitRange?.end ?? fallbackRange.end, normalizedDuration);
    if (!(end > start)) {
      end = normalizedDuration
        ? Math.min(normalizedDuration, start + Math.max(0.5, normalizedDuration / Math.max(1, count)))
        : start + 3;
    }
    const preferredFrameTime = finiteNumber(scene.frameTime ?? scene.frame_time);
    const frameTime = clampBetween(
      preferredFrameTime ?? (start + Math.min(Math.max((end - start) * 0.3, 0.2), Math.max(0.2, end - start - 0.1))),
      start,
      end
    );
    return {
      id: `scene-${index + 1}`,
      start: roundTime(start),
      end: roundTime(end),
      scene: text,
      role: normalizeSceneRole(scene.role, text, index, count),
      whyItWorks: normalizeText(scene.whyItWorks || scene.why_it_works || scene.why),
      frameTime: roundTime(frameTime),
      framePath: selectNearestFramePath(framePaths, frameTime) || normalizeText(scene.framePath || scene.frame_path) || normalizeText(posterPath),
      estimatedTime: !explicitRange
    };
  }).filter((scene) => scene.scene && scene.end > scene.start);
}

export function storyboardScenesToFormula(scenes = []) {
  return (Array.isArray(scenes) ? scenes : []).map((scene, index) => `分镜 ${index + 1}：${cleanSceneText(scene?.scene)}`).filter(Boolean);
}

export function storyboardScenesToKeyMoments(scenes = []) {
  return (Array.isArray(scenes) ? scenes : []).map((scene) => {
    const range = `${formatTime(scene?.start)}s-${formatTime(scene?.end)}s`;
    return `${range}：${cleanSceneText(scene?.scene)}`;
  }).filter(Boolean);
}

function buildLegacyScenes(storyboardFormula, keyMoments, duration) {
  const formula = normalizeStringArray(storyboardFormula);
  const moments = normalizeStringArray(keyMoments);
  const source = formula.length ? formula : moments;
  const ranges = formula.length ? deriveLegacyRanges(moments, duration, source.length) : null;
  return source.map((scene, index) => ({
    scene,
    ...(ranges?.[index] ? ranges[index] : { ignoreFallbackMomentTime: true })
  }));
}

function deriveLegacyRanges(moments, duration, count) {
  if (moments.length !== count || !count) return null;
  const timestamps = moments.map(readTimestamp);
  if (timestamps.some((item) => !item)) return null;
  const startsAreStrict = timestamps.every((item, index) => index === 0 || item.start > timestamps[index - 1].start);
  if (!startsAreStrict) return null;
  return timestamps.map((item, index) => {
    const nextStart = timestamps[index + 1]?.start;
    let end = item.end;
    if (!(end > item.start) || (nextStart !== undefined && end > nextStart)) {
      end = nextStart;
    }
    if (!(end > item.start)) {
      end = duration && duration > item.start ? duration : item.start + 3;
    }
    return { start: item.start, end };
  });
}

function readTimestamp(value) {
  const text = normalizeText(value);
  const range = parseRange(text);
  if (range) return range;
  const match = text.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:s|秒)(?:\s|[：:])/i);
  if (!match) return null;
  const start = Number(match[1]);
  return Number.isFinite(start) ? { start, end: null } : null;
}

function readSceneRange(scene, fallbackMoment = "") {
  const start = finiteNumber(scene.start ?? scene.startTime ?? scene.start_time);
  const end = finiteNumber(scene.end ?? scene.endTime ?? scene.end_time);
  if (start !== null && end !== null && end > start) return { start, end };
  return parseRange(scene.moment || scene.time || scene.duration || fallbackMoment || scene.scene);
}

function parseRange(value) {
  const text = normalizeText(value);
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-~—至到]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

function evenSceneRange(index, count, duration) {
  if (duration) {
    return {
      start: duration * index / Math.max(1, count),
      end: duration * (index + 1) / Math.max(1, count)
    };
  }
  return { start: index * 3, end: (index + 1) * 3 };
}

function normalizeSceneRole(value, text, index, count) {
  const role = normalizeText(value).toLowerCase();
  if (SCENE_ROLES.has(role)) return role;
  if (index === 0) return /问题|痛点|困扰|成瘾|焦虑/.test(text) ? "problem" : "hook";
  if (index === count - 1 && /下载|立即|开始|试试|行动|cta|收尾/i.test(text)) return "cta";
  if (/功能|界面|页面|点击|打开|扫描|播放|记录|列表|app/i.test(text)) return "feature_demo";
  if (/结果|完成|证明|对比|数据/.test(text)) return "proof";
  return "context";
}

function selectNearestFramePath(framePaths, frameTime) {
  const candidates = (Array.isArray(framePaths) ? framePaths : [])
    .map((path) => ({ path: normalizeText(path), second: frameSecond(path) }))
    .filter((item) => item.path && item.second !== null);
  if (!candidates.length) return "";
  candidates.sort((left, right) => Math.abs(left.second - frameTime) - Math.abs(right.second - frameTime));
  return candidates[0].path;
}

function frameSecond(value) {
  const match = normalizeText(value).match(/frame-\d+-(\d+(?:\.\d+)?)s\.[a-z0-9]+(?:\?.*)?$/i);
  return match ? Number(match[1]) : null;
}

function cleanSceneText(value) {
  return normalizeText(value)
    .replace(/^分镜\s*\d+\s*[：:]\s*/i, "")
    .replace(/^镜头\s*\d+\s*[：:]\s*/i, "");
}

function normalizeStringArray(value) {
  if (typeof value === "string") return [normalizeText(value)].filter(Boolean);
  return (Array.isArray(value) ? value : []).map(normalizeText).filter(Boolean);
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampTime(value, duration) {
  const number = Math.max(0, finiteNumber(value) ?? 0);
  return duration ? Math.min(duration, number) : number;
}

function clampBetween(value, start, end) {
  return Math.min(Math.max(value, start), Math.max(start, end - 0.01));
}

function roundTime(value) {
  return Number(Number(value || 0).toFixed(2));
}

function formatTime(value) {
  const number = roundTime(value);
  return Number.isInteger(number) ? String(number) : String(number);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
