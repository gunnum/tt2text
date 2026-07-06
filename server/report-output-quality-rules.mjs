export const REPORT_OUTPUT_TEMPLATE_VERSION = 20;

export const REPORT_OUTPUT_QUALITY_CONTRACT_NAME = "module-report-source-pack-citations";

export const REPORT_OUTPUT_MODULE_IDS = [
  "anomaly_signal",
  "market_overview",
  "country_market_split",
  "category_competitors",
  "user_pain_points",
  "experience",
  "growth_signals",
  "paid_points",
  "user_reviews",
  "founder_company"
];

export const REQUIRED_OUTPUT_SECTIONS = [
  "## 正式正文",
  "## Source Pack 摘要",
  "## 证据台账"
];

export const GENERIC_JUDGMENT_PATTERNS = [
  /已有\s*6\s*类市场/,
  /已有\s*2770\s*条/,
  /已有\s*42\s*条\s*TT/,
  /本模块当前可围绕/
];

export const EVIDENCE_ID_PATTERN_SOURCE = "[ADVRCTXNSPK]";

export const MODULE_QUALITY_MARKERS = {
  anomaly_signal: ["### 数据状态", "### 数据结论"],
  market_overview: ["### 数据覆盖", "### 读数顺序"],
  country_market_split: ["### 国家分工", "### 付费强度"],
  category_competitors: ["### 榜单位置", "### 未入库竞品"],
  user_pain_points: ["### 官方痛点", "### 用户痛点", "### 痛点边界"],
  experience: ["### 体验材料", "### 体验文档结构", "### 体验写作骨架"],
  growth_signals: ["### Hook 类型", "### 演示动作", "### 受众反馈"],
  paid_points: ["### Paywall 主卖点", "### 付费权益结构", "### 高付费市场"],
  user_reviews: ["### 好评主题", "### 差评主题", "### 风险信号"],
  founder_company: ["### 公司背景", "### 创始人/融资线索", "### 创始人过往代表作", "### 引用边界"]
};

export const MODULE_DRILLDOWN_REQUIRED_PREFIXES = {
  anomaly_signal: ["A|R|C|V"],
  market_overview: ["A|R|C|V"],
  country_market_split: ["A|R|C|V"],
  category_competitors: ["A|R|C|V"],
  user_pain_points: ["S|P", "R|C|T"],
  experience: ["X"],
  growth_signals: ["V"],
  paid_points: ["P"],
  user_reviews: ["R|T"],
  founder_company: ["A"]
};

export const REQUIRED_MINDMAP_BRANCHES = [
  "样本边界",
  "证据地图",
  "信号下钻",
  "可写判断"
];

export function validateReportOutputQualityContract(moduleIds = REPORT_OUTPUT_MODULE_IDS) {
  const failures = [];
  const expectedIds = [...moduleIds];
  const markerIds = Object.keys(MODULE_QUALITY_MARKERS);
  const drilldownIds = Object.keys(MODULE_DRILLDOWN_REQUIRED_PREFIXES);
  if (JSON.stringify(markerIds) !== JSON.stringify(expectedIds)) {
    failures.push(`MODULE_QUALITY_MARKERS IDs mismatch: expected ${expectedIds.join(", ")}, got ${markerIds.join(", ")}`);
  }
  if (JSON.stringify(drilldownIds) !== JSON.stringify(expectedIds)) {
    failures.push(`MODULE_DRILLDOWN_REQUIRED_PREFIXES IDs mismatch: expected ${expectedIds.join(", ")}, got ${drilldownIds.join(", ")}`);
  }
  for (const moduleId of expectedIds) {
    if (!Array.isArray(MODULE_QUALITY_MARKERS[moduleId]) || !MODULE_QUALITY_MARKERS[moduleId].length) {
      failures.push(`${moduleId}: missing module quality markers`);
    }
    if (!Array.isArray(MODULE_DRILLDOWN_REQUIRED_PREFIXES[moduleId]) || !MODULE_DRILLDOWN_REQUIRED_PREFIXES[moduleId].length) {
      failures.push(`${moduleId}: missing drilldown evidence requirements`);
    }
  }
  for (const section of REQUIRED_OUTPUT_SECTIONS) {
    if (!REQUIRED_OUTPUT_SECTIONS.includes(section)) failures.push(`missing required output section: ${section}`);
  }
  return failures;
}

export function assertReportOutputQualityContract(moduleIds = REPORT_OUTPUT_MODULE_IDS) {
  const failures = validateReportOutputQualityContract(moduleIds);
  if (failures.length) {
    throw new Error(`Report output quality contract failed:\n- ${failures.join("\n- ")}`);
  }
}

export function buildReportOutputQualityContractSummary(moduleId) {
  return {
    name: REPORT_OUTPUT_QUALITY_CONTRACT_NAME,
    templateVersion: REPORT_OUTPUT_TEMPLATE_VERSION,
    requiredSectionCount: REQUIRED_OUTPUT_SECTIONS.length,
    requiredArtifacts: ["markdown", "reportMarkdown", "meta", "citations"],
    requiredSections: REQUIRED_OUTPUT_SECTIONS,
    requiredMindmapBranches: [],
    moduleQualityMarkers: MODULE_QUALITY_MARKERS[moduleId] || [],
    drilldownEvidencePrefixes: MODULE_DRILLDOWN_REQUIRED_PREFIXES[moduleId] || []
  };
}

export function validateReportOutputMetaContract(meta = {}, moduleId = "") {
  const failures = [];
  const expected = buildReportOutputQualityContractSummary(moduleId);
  const actual = meta.qualityContract;
  if (!actual || typeof actual !== "object") {
    return ["missing qualityContract"];
  }
  if (actual.name !== expected.name) failures.push(`qualityContract.name ${actual.name || "missing"} !== ${expected.name}`);
  if (Number(actual.templateVersion || 0) !== expected.templateVersion) {
    failures.push(`qualityContract.templateVersion ${actual.templateVersion || "missing"} !== ${expected.templateVersion}`);
  }
  if (Number(actual.requiredSectionCount || 0) !== expected.requiredSectionCount) {
    failures.push(`qualityContract.requiredSectionCount ${actual.requiredSectionCount || "missing"} !== ${expected.requiredSectionCount}`);
  }
  if (JSON.stringify(actual.requiredArtifacts || []) !== JSON.stringify(expected.requiredArtifacts)) {
    failures.push("qualityContract.requiredArtifacts mismatch");
  }
  if (JSON.stringify(actual.requiredMindmapBranches || []) !== JSON.stringify(expected.requiredMindmapBranches)) failures.push("qualityContract.requiredMindmapBranches mismatch");
  if (JSON.stringify(actual.moduleQualityMarkers || []) !== JSON.stringify(expected.moduleQualityMarkers)) {
    failures.push("qualityContract.moduleQualityMarkers mismatch");
  }
  if (JSON.stringify(actual.drilldownEvidencePrefixes || []) !== JSON.stringify(expected.drilldownEvidencePrefixes)) {
    failures.push("qualityContract.drilldownEvidencePrefixes mismatch");
  }
  return failures;
}
