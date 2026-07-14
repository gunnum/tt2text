import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createVerticalVideoReportService } from "../server/vertical-video-report-service.mjs";
import { appCategoryIdForLabel } from "../server/vertical-video-report/category-resolver.mjs";
import { createHighlightAnalysis } from "../server/vertical-video-report/highlight-analysis.mjs";
import { calculateInteractionScore } from "../server/vertical-video-report/interaction-score.mjs";

test("vertical video report groups reading videos and tracks reanalysis delta", async () => {
  const projectRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt2text-vertical-video-"));
  const shots = [
    shot({ id: "shot-1", app: "Headway: Daily Micro Learning", title: "Replace scrolling addiction with microlearning", like: 100, comment: 2, share: 3, authorAvatarUrl: "https://example.test/avatar.png", followerCount: 12345 }),
    shot({ id: "shot-2", app: "Blinkist", title: "short blinks for short attention span", like: 20, comment: 1, share: 0, category: "全部行业" }),
    shot({ id: "shot-3", app: "BeReal", title: "time to BeReal with friends", like: 300, comment: 4, share: 1, category: "全部行业" }),
    shot({ id: "shot-5", app: "Forum", title: "book club community learning discussion", like: 500, comment: 1, share: 1, category: "全部行业" })
  ];
  let codexPrompt = "";

  try {
    const service = createVerticalVideoReportService(createDeps(projectRootDir, () => shots, {
      runCodexJsonTask: async (prompt) => {
        codexPrompt = prompt;
        return JSON.stringify({
          items: [{
            id: "shot-1",
            overallVerticalInsight: "把刷屏坏习惯转成可执行的微学习替代动作。",
            hookInsight: "把坏习惯命名成可替代对象。",
            performanceHypotheses: ["高分享可能和替代刷屏的明确行动有关。"],
            sceneInsights: [
              { sceneId: "scene-1", verticalWhyItWorks: "痛点具体且有反差。", transferableLesson: "开头先打中坏习惯。" },
              { sceneId: "scene-2", verticalWhyItWorks: "用产品动作承接承诺。", transferableLesson: "展示可见的使用路径。" }
            ]
          }]
        });
      }
    }));
    const index = await service.buildVerticalVideoCategoryIndex();
    const reading = index.categories.find((item) => item.id === "app-category-e1bd09c4bb");
    assert.equal(index.categories.some((item) => item.id === "reading"), false);
    assert.equal(reading.label, "读书");
    assert.equal(reading.source, "app_category");
    assert.equal(reading.videoCount, 2);
    assert.equal(reading.status, "new");

    const analyzed = await service.analyzeVerticalVideoCategory("reading");
    assert.equal(analyzed.analysis.hasPreviousAnalysis, true);
    assert.equal(analyzed.analysis.addedSinceLastAnalysis, 0);
    assert.equal(analyzed.summary.topInteractionScore, 116);
    assert.equal(calculateInteractionScore({ likeCount: 1, commentCount: 2, shareCount: 3 }), 17);
    assert.equal(
      analyzed.distributions.apps.find((item) => item.label === "Headway: Daily Micro Learning")?.logoUrl,
      "https://example.test/headway.png"
    );
    assert.equal(analyzed.modulePrompts, undefined);
    assert.equal(analyzed.strategy.executionPrd, undefined);
    assert.ok(Array.isArray(analyzed.strategy.appAccountVideoTypes));
    assert.ok(Array.isArray(analyzed.strategy.creatorContentVideoTypes));
    assert.match(analyzed.strategy.appAccountVideoTypes[0].account, /官方 App 号/);
    assert.match(analyzed.strategy.creatorContentVideoTypes[0].account, /网红&内容号/);
    assert.match(analyzed.strategy.appAccountVideoTypes[0].videoScriptPrompt, /短视频广告脚本策划/);
    assert.match(analyzed.strategy.appAccountVideoTypes[0].videoScriptPrompt, /完整分镜表/);
    assert.match(analyzed.strategy.appAccountVideoTypes[0].videoScriptPrompt, /适用 BGM 类型/);
    assert.ok(Array.isArray(analyzed.strategy.appAccountVideoTypes[0].scenes));
    assert.ok(analyzed.strategy.appAccountVideoTypes[0].scenes[0].visual);
    assert.match(analyzed.strategy.creatorContentVideoTypes[0].videoScriptPrompt, /适合账号类型/);
    assert.match(codexPrompt, /垂类短视频研究员/);
    assert.match(codexPrompt, /sceneInsights/);
    assert.equal(analyzed.strategy.highlightBreakdowns.provider, "local-codex");
    assert.equal(analyzed.strategy.highlightBreakdowns.highlightSchemaVersion, 3);
    assert.equal(analyzed.strategy.highlightBreakdowns.items[0].id, "shot-1");
    assert.equal(analyzed.strategy.highlightBreakdowns.items[0].authorAvatarUrl, "https://example.test/avatar.png");
    assert.equal(analyzed.strategy.highlightBreakdowns.items[0].followerCount, 12345);
    assert.match(analyzed.strategy.highlightBreakdowns.items[0].storySummary, /microlearning/i);
    assert.match(analyzed.strategy.highlightBreakdowns.items[0].hooks[0].grab, /坏习惯/);
    assert.deepEqual(Object.keys(analyzed.strategy.highlightBreakdowns.items[0].hooks[0]).sort(), ["grab", "text"]);
    assert.equal(analyzed.strategy.highlightBreakdowns.items[0].highlightScenes.length, 2);
    assert.equal(analyzed.strategy.highlightBreakdowns.items[0].highlightScenes[1].scene, "展示产品如何承接开头承诺。");
    assert.equal(analyzed.strategy.lessons.pitfalls.length, 0);
    assert.equal(JSON.stringify(analyzed.strategy).includes("tierSummary"), false);
    assert.doesNotMatch(JSON.stringify(analyzed.strategy), /Spickor/i);
    const snapshotDir = path.join(projectRootDir, "reports", "vertical-video-reports", "app-category-e1bd09c4bb", "snapshots");
    assert.equal(fs.readdirSync(snapshotDir).filter((name) => name.endsWith(".meta.json")).length, 1);

    shots.push(shot({ id: "shot-4", app: "Bookly", title: "Book tracker progress stats", like: 8, comment: 0, share: 0 }));
    const changed = await service.buildVerticalVideoCategoryReport("reading");
    assert.equal(changed.summary.videoCount, 3);
    assert.equal(changed.analysis.addedSinceLastAnalysis, 1);
    assert.equal(changed.analysis.removedSinceLastAnalysis, 0);
    assert.equal(changed.analysis.isStale, true);

    for (let index = 0; index < 6; index += 1) {
      await service.analyzeVerticalVideoCategory("reading");
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(fs.readdirSync(snapshotDir).filter((name) => name.endsWith(".meta.json")).length, 5);
  } finally {
    fs.rmSync(projectRootDir, { recursive: true, force: true });
  }
});

test("highlight analysis keeps max 15 videos and maps legacy comments onto base scenes", () => {
  const analysis = createHighlightAnalysis({ normalizeText, truncateText });
  const videos = Array.from({ length: 20 }, (_, index) => ({
    id: "video-" + index,
    title: "Video " + index,
    appName: "Headway",
    authorName: "creator",
    accountType: "红人/内容号",
    scriptType: "替代刷屏/微学习",
    exposureLevel: "中 App 露出",
    interactionScore: 100 - index,
    metrics: { likeCount: 100 - index, commentCount: 0, shareCount: 0 },
    hook: "Stop scrolling and learn instead",
    summary: "把刷屏替换成微学习。",
    script: "Stop scrolling and learn instead.",
    productFeatures: [],
    hasBaseAnalysis: true,
    storyboardScenes: [{ id: "scene-1", start: 0, end: 3, scene: "开头提出刷屏问题。", role: "hook", frameTime: 1, framePath: "/frame-1.jpg" }]
  }));
  assert.equal(analysis.pickHighlightVideos(videos).length, 15);

  const normalized = analysis.normalizeHighlightItem({
    id: "legacy",
    title: "Legacy #ad",
    overallWin: "旧剧情总结",
    hookOriginal: "旧 Hook",
    hookMechanism: "旧抓人机制",
    highlightScenes: Array.from({ length: 8 }, (_, index) => ({
      moment: "S" + index,
      scene: "画面 " + index,
      why: "原因 " + index,
      learn: "迁移 " + index
    })),
    video: {
      id: "legacy",
      title: "Legacy #ad",
      hook: "旧 Hook",
      storyboardScenes: Array.from({ length: 8 }, (_, index) => ({
        id: `scene-${index + 1}`,
        start: index * 2,
        end: index * 2 + 2,
        scene: `基础分镜 ${index}`,
        role: index === 0 ? "hook" : "context",
        frameTime: index * 2 + 0.5,
        framePath: `/frame-${index}.jpg`
      }))
    }
  });
  assert.equal(normalized.highlightScenes.length, 8);
  assert.equal(normalized.highlightScenes[6].scene, "基础分镜 6");
  assert.equal(normalized.highlightScenes[6].why, "原因 6");
  assert.deepEqual(normalized.hooks, [{ text: "旧 Hook", grab: "旧抓人机制" }]);
  assert.equal(Object.hasOwn(normalized, "hookOriginal"), false);
  assert.equal(Object.hasOwn(normalized, "overallWin"), false);

  const musicFallback = analysis.fallbackHighlightBreakdowns([{
    id: "music-fallback",
    title: "See what friends are listening to",
    scriptType: "好友动态/社交连接",
    exposureLevel: "中 App 露出",
    summary: "先展示好友正在听的歌曲，再进入互动。",
    hook: "朋友现在正在听什么",
    storyboardScenes: [{ id: "scene-1", start: 0, end: 3, scene: "好友歌曲动态直接出现。", role: "hook", frameTime: 1 }]
  }]);
  assert.match(musicFallback[0].highlightScenes[0].why, /朋友|关系/);
  assert.match(musicFallback[0].hooks[0].grab, /好友关系|同频匹配/);
});

test("music category uses a music-social analysis profile without reading taxonomy leakage", async () => {
  const projectRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt2text-vertical-music-"));
  const shots = [
    shot({ id: "music-1", app: "Airbuds Widget", title: "See what friends are listening to right now", like: 120, comment: 8, share: 11, category: "音乐" }),
    shot({ id: "music-2", app: "stats.fm", title: "My top artists and listening stats this fall", like: 80, comment: 3, share: 7, category: "音乐" }),
    shot({ id: "music-3", app: "TouchTunes", title: "Who queued this song at the pool hall", like: 70, comment: 6, share: 4, category: "音乐" }),
    shot({ id: "music-4", app: "Airbuds Widget", title: "My chaotic music taste is my whole personality", like: 60, comment: 10, share: 2, category: "音乐" })
  ];
  let highlightPrompt = "";

  try {
    const service = createVerticalVideoReportService(createDeps(projectRootDir, () => shots, {
      readApps: async () => [
        { name: "Airbuds Widget", categories: ["音乐"] },
        { name: "stats.fm", categories: ["音乐"] },
        { name: "TouchTunes", categories: ["音乐"] }
      ],
      runCodexJsonTask: async (prompt) => {
        highlightPrompt = prompt;
        return JSON.stringify({
          items: [{
            id: "music-1",
            hookInsight: "把好奇心直接落到好友关系。",
            overallVerticalInsight: "好友听歌动态把音乐内容变成社交入口。",
            sceneInsights: [
              { sceneId: "scene-1", verticalWhyItWorks: "社交结果先于功能解释。", transferableLesson: "先给关系结果，再展示产品动作。" },
              { sceneId: "scene-2", verticalWhyItWorks: "产品动作承接好友动态。", transferableLesson: "用真实界面证明互动路径。" }
            ]
          }]
        });
      }
    }));
    const musicId = appCategoryIdForLabel("音乐");
    const analyzed = await service.analyzeVerticalVideoCategory(musicId);
    const serialized = JSON.stringify(analyzed);

    assert.equal(analyzed.category.analysisProfileId, "music-social");
    assert.deepEqual(
      new Set(analyzed.videos.map((item) => item.scriptType)),
      new Set(["好友动态/社交连接", "听歌数据/回顾", "场景点歌/播放控制", "音乐身份/品味表达"])
    );
    assert.match(highlightPrompt, /音乐品味、好友关系、实时听歌动态/);
    assert.doesNotMatch(serialized, /读书管理|主题书单|替代刷屏|微学习|书架|阅读计划|书籍摘要/);
    assert.match(analyzed.strategy.appAccountVideoTypes[0].title, /好友实时听歌动态/);
    assert.match(analyzed.strategy.creatorContentVideoTypes[0].title, /音乐人格/);
  } finally {
    fs.rmSync(projectRootDir, { recursive: true, force: true });
  }
});

function createDeps(projectRootDir, readShots, overrides = {}) {
  return {
    projectRootDir,
    readAdShots: async () => readShots(),
    readApps: async () => [
      {
        name: "Headway",
        fullName: "Headway - Daily Micro Learning",
        logoUrl: "https://example.test/headway.png",
        categories: ["读书"]
      },
      {
        name: "Blinkist",
        logoUrl: "https://example.test/blinkist.png",
        categories: ["读书"]
      },
      {
        name: "Bookly",
        categories: ["读书"]
      },
      {
        name: "Forum",
        categories: ["社区"]
      }
    ],
    normalizeText,
    truncateText,
    ...overrides
  };
}

function shot({ id, app, title, like = 0, comment = 0, share = 0, category = "阅读/听书", authorAvatarUrl = "", followerCount = undefined }) {
  return {
    shotId: id,
    category,
    appDisplay: app,
    appName: app,
    brandName: app,
    title,
    readableTitle: title,
    storySummary: title,
    sourceDisplay: "TikTok 详情页",
    sourcePlatform: "tiktok",
    authorAvatarUrl,
    followerCount,
    shotUrl: `/shots/${id}`,
    createdAt: "2026-06-28T12:00:00.000Z",
    metrics: {
      likeCount: like,
      commentCount: comment,
      shareCount: share,
      viewCount: 0
    },
    analysis: {
      cardTitle: title,
      cardSummary: title,
      videoStory: title,
      script: title,
      hook: title,
      productFeatures: [`${app} feature`],
      storyboardScenes: [
        { id: "scene-1", start: 0, end: 3, scene: title, role: "hook", frameTime: 1 },
        { id: "scene-2", start: 3, end: 6, scene: "展示产品如何承接开头承诺。", role: "feature_demo", frameTime: 4 }
      ]
    }
  };
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value, maxLength = 220) {
  const text = normalizeText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
