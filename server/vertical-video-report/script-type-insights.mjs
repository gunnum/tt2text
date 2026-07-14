import { getVerticalVideoScriptTypeSummary } from "./analysis-profiles.mjs";

export function enrichScriptTypeCount(item = {}, profile = null) {
  return {
    ...item,
    summary: scriptTypeSummary(item.label, profile)
  };
}

export function scriptTypeSummary(label = "", profile = null) {
  return getVerticalVideoScriptTypeSummary(profile || undefined, label);
}
