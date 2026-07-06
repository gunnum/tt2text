const ANALYSIS_STEP_DEFINITIONS = [
  {
    index: 1,
    label: "排队等待",
    stageKeys: ["queued", "restart_requested"]
  },
  {
    index: 2,
    label: "准备素材",
    stageKeys: ["started", "semantic_start", "semantic_download", "semantic_detect_language"]
  },
  {
    index: 3,
    label: "抽取音频并执行转写",
    stageKeys: ["semantic_transcribe"]
  },
  {
    index: 4,
    label: "画面理解",
    stageKeys: ["semantic_visual"]
  },
  {
    index: 5,
    label: "字幕翻译与语义整理",
    stageKeys: ["semantic_translate", "semantic_finalize", "semantic_completed"]
  },
  {
    index: 6,
    label: "画面文字定位",
    stageKeys: ["ocr_start", "ocr_completed", "ocr_failed", "merge_visual_text"]
  },
  {
    index: 7,
    label: "生成素材拆解",
    stageKeys: ["llm_start", "llm_completed", "llm_warning"]
  },
  {
    index: 8,
    label: "写入分析结果",
    stageKeys: ["saving", "completed", "completed_with_warning", "failed", "interrupted"]
  }
];

const ANALYSIS_STEP_TOTAL = ANALYSIS_STEP_DEFINITIONS.length;

const ANALYSIS_STEP_LOOKUP = new Map(
  ANALYSIS_STEP_DEFINITIONS.flatMap((step) => step.stageKeys.map((stageKey) => [stageKey, step]))
);

export function getAnalysisProgressInfo(input = {}) {
  const status = normalizeValue(input.status || input.analysisStatus);
  const stageKey = normalizeValue(input.stageKey || input.analysisStageKey || input?.analysisProgress?.stageKey);
  const fallbackLabel = String(
    input.stageLabel || input.analysisStage || input?.analysisProgress?.stageLabel || input.message || ""
  ).trim();
  const matchedStep = ANALYSIS_STEP_LOOKUP.get(stageKey)
    || (status === "queued" ? ANALYSIS_STEP_DEFINITIONS[0] : null)
    || (status === "running" ? ANALYSIS_STEP_DEFINITIONS[1] : null);
  const index = matchedStep?.index || (status === "queued" ? 1 : status === "running" ? 2 : ANALYSIS_STEP_TOTAL);
  const label = matchedStep?.label || fallbackLabel || formatStatusLabel(status);
  return {
    index,
    total: ANALYSIS_STEP_TOTAL,
    label,
    shortText: `${index}/${ANALYSIS_STEP_TOTAL}`,
    fullText: `${index}/${ANALYSIS_STEP_TOTAL} · ${label}`,
    percent: Math.round((index / ANALYSIS_STEP_TOTAL) * 100)
  };
}

function formatStatusLabel(status) {
  if (status === "queued") return "排队等待";
  if (status === "running") return "分析中";
  if (status === "failed") return "分析失败";
  if (status === "completed") return "分析完成";
  return "处理中";
}

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}
