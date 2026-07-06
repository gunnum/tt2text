import {
  INTERACTION_SCORE_WEIGHTS
} from "./constants.mjs";

export function calculateInteractionScore(metrics = {}) {
  return numericCount(metrics.likeCount) * INTERACTION_SCORE_WEIGHTS.like
    + numericCount(metrics.commentCount) * INTERACTION_SCORE_WEIGHTS.comment
    + numericCount(metrics.shareCount) * INTERACTION_SCORE_WEIGHTS.share;
}

export function compareReportVideos(a, b) {
  return b.interactionScore - a.interactionScore
    || Date.parse(b.capturedAt || "") - Date.parse(a.capturedAt || "")
    || a.title.localeCompare(b.title, "zh-CN");
}

export function numericCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function interactionScoreFormulaText() {
  return `点赞 + 评论 x ${INTERACTION_SCORE_WEIGHTS.comment} + 分享 x ${INTERACTION_SCORE_WEIGHTS.share}`;
}
