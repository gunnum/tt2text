import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMaterialAnalysis,
  normalizeMaterialAnalysis
} from "../server/material-analysis.mjs";

test("base material analysis repairs invalid output and derives stable storyboard fields", async () => {
  const prompts = [];
  const responses = [
    JSON.stringify({ cardTitle: "不完整结果" }),
    JSON.stringify({
      cardTitle: "扫描纸质书并朗读",
      cardSummary: "视频先提出不想读书的问题，再展示扫描和朗读功能。",
      videoStory: "先展示纸质书，随后打开 App 扫描页面并播放识别出的文字。",
      script: "不想自己读书时，可以扫描页面并直接收听。",
      hook: "不想继续自己读书",
      productFeatures: ["扫描纸质书页", "文字转语音朗读"],
      productMechanism: "扫描把纸质内容转成可播放文本。",
      creativeStrategy: {
        creativePattern: "pain_point_demo",
        appExposureLevel: "strong",
        hookMechanism: "用明确的人群痛点开场",
        creativeMechanism: "从阅读痛点推进到扫描和朗读结果"
      },
      storyboardScenes: [
        { start: 0, end: 2.5, scene: "展示纸质书并提出不想阅读的问题。", role: "hook", whyItWorks: "问题具体。", frameTime: 1 },
        { start: 2.5, end: 7, scene: "打开 App 扫描书页并播放识别文字。", role: "feature_demo", whyItWorks: "直接证明功能路径。", frameTime: 4.2 }
      ],
      reusableTemplate: "具体痛点开场，再用完整产品路径证明结果。"
    })
  ];

  const result = await buildMaterialAnalysis({
    shot: { title: "Speechify demo", brandName: "Speechify", duration: 7 },
    semantic: {
      translation_zh: "不想读书时，可以扫描页面并直接收听。",
      visual_summary: "纸质书切到扫描和朗读界面。",
      visual_frame_paths: [
        "/data/ad-shots/test/analysis/visual-frames/frame-01-0.00s.jpg",
        "/data/ad-shots/test/analysis/visual-frames/frame-02-1.00s.jpg",
        "/data/ad-shots/test/analysis/visual-frames/frame-05-4.00s.jpg"
      ]
    },
    runJsonTask: async (prompt) => {
      prompts.push(prompt);
      return responses.shift();
    }
  });

  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /storyboardScenes 是唯一分镜事实源/);
  assert.match(prompts[1], /第 2 轮修复/);
  assert.equal(result.qualityStatus, "passed");
  assert.equal(result.analysisAttempts.length, 2);
  assert.equal(result.storyboardScenes.length, 2);
  assert.equal(result.storyboardScenes[0].id, "scene-1");
  assert.equal(result.storyboardScenes[1].framePath, "/data/ad-shots/test/analysis/visual-frames/frame-05-4.00s.jpg");
  assert.deepEqual(result.storyboardFormula, [
    "分镜 1：展示纸质书并提出不想阅读的问题。",
    "分镜 2：打开 App 扫描书页并播放识别文字。"
  ]);
  assert.match(result.baseAnalysisHash, /^[a-f0-9]{40}$/);
});

test("legacy storyboard strings normalize into the shared scene contract", () => {
  const result = normalizeMaterialAnalysis({
    cardSummary: "先提出问题，再展示产品结果。",
    videoStory: "先提出问题，再展示产品结果。",
    script: "完整脚本",
    hook: "明确问题",
    storyboardFormula: ["分镜 1：提出问题", "分镜 2：展示结果"],
    keyMoments: ["0-3s：提出问题", "3-8s：展示结果"]
  }, {
    duration: 8,
    framePaths: [
      "/frames/frame-01-0.00s.jpg",
      "/frames/frame-04-3.00s.jpg",
      "/frames/frame-06-5.00s.jpg"
    ]
  });

  assert.equal(result.storyboardScenes.length, 2);
  assert.deepEqual(result.storyboardScenes.map((scene) => [scene.start, scene.end]), [[0, 3], [3, 8]]);
  assert.equal(result.storyboardScenes[1].framePath, "/frames/frame-06-5.00s.jpg");
  assert.equal(result.qualityStatus, "passed");
});

test("overlapping legacy key moments fall back to monotonic estimated scene ranges", () => {
  const result = normalizeMaterialAnalysis({
    cardSummary: "完整剧情",
    videoStory: "完整剧情",
    script: "完整脚本",
    hook: "开头",
    storyboardFormula: ["分镜 1：开头", "分镜 2：在 10 到 15 分钟空闲时展示产品", "分镜 3：结果"],
    keyMoments: ["0s：开头", "0s-1s：产品列表", "2s-5s：结果"]
  }, { duration: 9 });

  assert.deepEqual(result.storyboardScenes.map((scene) => [scene.start, scene.end]), [[0, 3], [3, 6], [6, 9]]);
  assert.equal(result.storyboardScenes.every((scene) => scene.estimatedTime), true);
  assert.equal(result.qualityStatus, "passed");
});
