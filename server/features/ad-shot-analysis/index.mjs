import { createHash } from "node:crypto";

export { buildBaseAnalysisPrompt, buildBaseAnalysisRepairPrompt } from "./prompts/base-analysis-prompt.mjs";
export {
  normalizeStoryboardScenes,
  storyboardScenesToFormula,
  storyboardScenesToKeyMoments
} from "./shared/storyboard.mjs";

export const AD_SHOT_ANALYSIS_SCHEMA = "tt2text.material_analysis.v2";

export function buildBaseAnalysisHash(analysis = {}) {
  const material = {
    schema: analysis.schema || AD_SHOT_ANALYSIS_SCHEMA,
    cardTitle: normalizeText(analysis.cardTitle),
    cardSummary: normalizeText(analysis.cardSummary),
    videoStory: normalizeText(analysis.videoStory),
    script: normalizeText(analysis.script),
    hook: normalizeText(analysis.hook),
    productFeatures: normalizeArray(analysis.productFeatures),
    productMechanism: normalizeText(analysis.productMechanism),
    creativeStrategy: normalizeCreativeStrategy(analysis.creativeStrategy),
    storyboardScenes: (Array.isArray(analysis.storyboardScenes) ? analysis.storyboardScenes : []).map((scene) => ({
      id: normalizeText(scene?.id),
      start: finiteNumber(scene?.start),
      end: finiteNumber(scene?.end),
      scene: normalizeText(scene?.scene),
      role: normalizeText(scene?.role),
      whyItWorks: normalizeText(scene?.whyItWorks),
      frameTime: finiteNumber(scene?.frameTime)
    }))
  };
  return createHash("sha1").update(JSON.stringify(material)).digest("hex");
}

export function evaluateBaseAnalysisQuality(analysis = {}) {
  const issues = [];
  const scenes = Array.isArray(analysis.storyboardScenes) ? analysis.storyboardScenes : [];
  if (!normalizeText(analysis.videoStory || analysis.cardSummary)) {
    issues.push({ code: "missing_story", severity: "critical", message: "缺少可核验的视频剧情。" });
  }
  if (!normalizeText(analysis.script)) {
    issues.push({ code: "missing_script", severity: "warning", message: "缺少可读脚本。" });
  }
  if (!normalizeText(analysis.hook)) {
    issues.push({ code: "missing_hook", severity: "warning", message: "缺少明确 Hook。" });
  }
  if (!scenes.length) {
    issues.push({ code: "missing_storyboard", severity: "critical", message: "缺少结构化分镜。" });
  }
  if (scenes.some((scene) => !Number.isFinite(Number(scene.start)) || !Number.isFinite(Number(scene.end)) || Number(scene.end) <= Number(scene.start))) {
    issues.push({ code: "invalid_scene_time", severity: "critical", message: "存在无效的分镜时间范围。" });
  }
  if (scenes.some((scene, index) => index > 0 && Number(scene.start) < Number(scenes[index - 1].end) - 0.05)) {
    issues.push({ code: "overlapping_scene_time", severity: "critical", message: "分镜时间存在倒序或明显重叠。" });
  }

  const penalty = issues.reduce((total, issue) => total + (issue.severity === "critical" ? 35 : 10), 0);
  const score = Math.max(0, 100 - penalty);
  const passed = !issues.some((issue) => issue.severity === "critical") && score >= 70;
  return {
    status: passed ? "passed" : "needs_review",
    score,
    issues
  };
}

function normalizeCreativeStrategy(value = {}) {
  if (!value || typeof value !== "object") return {};
  return {
    creativePattern: normalizeText(value.creativePattern),
    appExposureLevel: normalizeText(value.appExposureLevel),
    hookMechanism: normalizeText(value.hookMechanism),
    creativeMechanism: normalizeText(value.creativeMechanism)
  };
}

function normalizeArray(value) {
  return (Array.isArray(value) ? value : []).map(normalizeText).filter(Boolean);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
