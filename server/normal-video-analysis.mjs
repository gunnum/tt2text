import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildMaterialAnalysis,
  normalizeMaterialAnalysis
} from "./material-analysis.mjs";

export function createNormalVideoAnalysisService(deps = {}) {
  const requiredDeps = [
    "runJsonTask",
    "normalizeVisualTextSegments",
    "mergeVisualTextSegmentsWithOcr",
    "normalizeText",
    "truncateText",
    "normalizeToPublicPath",
    "formatDate",
    "ensureDir",
    "runVisualOcrExtraction"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createNormalVideoAnalysisService 缺少依赖：${dep}`);
    }
  }

  const timeoutMs = Number(deps.timeoutMs) || 90_000;

  function normalizeVideoSemanticPayload(payload = {}, fallback = {}) {
    const duration = Number(payload.duration || fallback.duration) || null;
    const visualTextSegments = deps.normalizeVisualTextSegments(payload.visual_text_segments || payload.visualTextSegments, duration);
    return {
      title: normalizeText(payload.title || fallback.title),
      webpage_url: normalizeText(payload.webpage_url || payload.webpageUrl || fallback.sourceUrl),
      transcript_en: normalizeText(payload.transcript_en || payload.transcriptEn),
      translation_zh: normalizeText(payload.translation_zh || payload.transcriptZh || payload.translationZh),
      source_language: normalizeText(payload.source_language || payload.sourceLanguage),
      source_language_probability: payload.source_language_probability ?? payload.sourceLanguageProbability ?? null,
      first_frame_path: normalizeText(payload.first_frame_path || payload.firstFramePath),
      visual_summary: normalizeText(payload.visual_summary || payload.visualSummary || payload.translation_zh || payload.translationZh),
      visual_text_segments: visualTextSegments,
      visual_frame_paths: Array.isArray(payload.visual_frame_paths || payload.visualFramePaths)
        ? (payload.visual_frame_paths || payload.visualFramePaths).map(deps.normalizeToPublicPath)
        : [],
      duration
    };
  }

  async function buildNormalVideoVisualTextAnalysis({ resultId, jobDir, semantic = {}, duration = null } = {}) {
    const semanticSegments = deps.normalizeVisualTextSegments(semantic.visual_text_segments || semantic.visualTextSegments, duration);
    const videoFile = await findJobVideoFile(jobDir);
    if (!videoFile) {
      return {
        visualTextSegments: semanticSegments,
        ocr: {
          ok: false,
          error: "没有找到本地视频文件，无法执行 OCR 定位。",
          visualTextSegmentCount: 0,
          framePaths: [],
          outputPath: ""
        }
      };
    }

    const ocrDir = path.join(jobDir, "visual-ocr");
    await deps.ensureDir(ocrDir);
    const visualOcr = await deps.runVisualOcrExtraction(videoFile, ocrDir);
    const ocrSegments = deps.normalizeVisualTextSegments(visualOcr?.visual_text_segments || visualOcr?.visualTextSegments, duration);
    const visualTextSegments = deps.mergeVisualTextSegmentsWithOcr({
      duration,
      ocrSegments,
      semanticSegments
    });
    return {
      visualTextSegments,
      ocr: {
        ok: Boolean(visualOcr?.ok),
        error: visualOcr?.ok ? "" : deps.truncateText(normalizeText(visualOcr?.error), 600),
        visualTextSegmentCount: ocrSegments.length,
        outputPath: visualOcr?.output_path ? deps.normalizeToPublicPath(visualOcr.output_path) : "",
        framePaths: Array.isArray(visualOcr?.frame_paths)
          ? visualOcr.frame_paths.map(deps.normalizeToPublicPath)
          : [],
        resultId: normalizeText(resultId)
      }
    };
  }

  async function buildNormalVideoMaterialAnalysis({
    job = {},
    app = null,
    semantic = {},
    previousAnalysis = null,
    analysisOptions = {}
  } = {}) {
    const generatedAt = deps.formatDate(new Date());
    const appName = normalizeText(app?.name || app?.fullName || job.app?.name || "");
    const shotLike = {
      title: normalizeText(semantic.title || job.title || job.previewText),
      brandName: appName,
      appName,
      appDisplay: appName,
      sourcePlatform: "tiktok",
      sourceLabel: "TikTok 详情页",
      sourceUrl: normalizeText(job.sourceUrl || semantic.webpage_url),
      duration: Number(semantic.duration || job.duration) || null,
      transcriptZh: semantic.translation_zh || "",
      visualSummary: semantic.visual_summary || "",
      visualTextSegments: semantic.visual_text_segments || semantic.visualTextSegments || []
    };

    try {
      const structured = await buildAdShotAnalysis(shotLike, semantic, analysisOptions);
      return normalizeNormalVideoMaterialAnalysis(structured, {
        generatedAt,
        source: "normal_tiktok_video",
        previousAnalysis
      });
    } catch (error) {
      return normalizeNormalVideoMaterialAnalysis({
        videoStory: semantic.visual_summary || semantic.translation_zh || "",
        script: semantic.translation_zh || semantic.transcript_en || semantic.visual_summary || "",
        productFeatures: [],
        storyboardFormula: [],
        visualTextSegments: semantic.visual_text_segments || semantic.visualTextSegments || [],
        structureError: error instanceof Error ? error.message : String(error)
      }, {
        generatedAt,
        source: "normal_tiktok_video",
        previousAnalysis
      });
    }
  }

  function normalizeNormalVideoMaterialAnalysis(analysis = {}, context = {}) {
    return normalizeMaterialAnalysis(analysis, context, {
      normalizeVisualTextSegments: deps.normalizeVisualTextSegments,
      now: () => deps.formatDate(new Date())
    });
  }

  async function findJobVideoFile(jobDir) {
    try {
      const entries = await fs.readdir(jobDir, { withFileTypes: true });
      const candidates = entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(jobDir, entry.name))
        .filter((filePath) => [".mp4", ".mkv", ".webm", ".mov"].includes(path.extname(filePath).toLowerCase()));
      return candidates[0] || "";
    } catch {
      return "";
    }
  }

  async function buildAdShotAnalysis(shot, semantic = {}, analysisOptions = {}) {
    return buildMaterialAnalysis({
      shot,
      semantic,
      runJsonTask: deps.runJsonTask,
      timeoutMs,
      normalizeVisualTextSegments: deps.normalizeVisualTextSegments,
      jsonTaskOptions: analysisOptions
    });
  }

  function normalizeText(value) {
    return deps.normalizeText(value);
  }

  return {
    normalizeVideoSemanticPayload,
    buildNormalVideoVisualTextAnalysis,
    buildNormalVideoMaterialAnalysis,
    normalizeNormalVideoMaterialAnalysis,
    findJobVideoFile,
    buildAdShotAnalysis
  };
}
