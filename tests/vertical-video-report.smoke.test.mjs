import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createVerticalVideoReportService } from "../server/vertical-video-report-service.mjs";
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
            storySummary: "开头直接把刷屏替换成微学习，用户一秒知道收益。",
            hooks: [{ text: "Replace scrolling addiction with microlearning", grab: "把坏习惯命名成可替代对象。" }],
            highlightScenes: [{ moment: "0-3s", scene: "用 replace scrolling addiction 做大字钩子。", why: "痛点具体且有反差。", learn: "开头先打中坏习惯。" }]
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
    assert.match(codexPrompt, /短视频广告拆解专家/);
    assert.equal(analyzed.strategy.highlightBreakdowns.provider, "local-codex");
    assert.equal(analyzed.strategy.highlightBreakdowns.highlightSchemaVersion, 2);
    assert.equal(analyzed.strategy.highlightBreakdowns.items[0].id, "shot-1");
    assert.equal(analyzed.strategy.highlightBreakdowns.items[0].authorAvatarUrl, "https://example.test/avatar.png");
    assert.equal(analyzed.strategy.highlightBreakdowns.items[0].followerCount, 12345);
    assert.match(analyzed.strategy.highlightBreakdowns.items[0].storySummary, /微学习/);
    assert.match(analyzed.strategy.highlightBreakdowns.items[0].hooks[0].grab, /坏习惯/);
    assert.deepEqual(Object.keys(analyzed.strategy.highlightBreakdowns.items[0].hooks[0]).sort(), ["grab", "text"]);
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

test("highlight analysis keeps max 15 videos, max 5 scenes, and normalizes legacy hook fields", () => {
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
    productFeatures: []
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
    }))
  });
  assert.equal(normalized.highlightScenes.length, 5);
  assert.deepEqual(normalized.hooks, [{ text: "旧 Hook", grab: "旧抓人机制" }]);
  assert.equal(Object.hasOwn(normalized, "hookOriginal"), false);
  assert.equal(Object.hasOwn(normalized, "overallWin"), false);
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
      script: title,
      productFeatures: [`${app} feature`]
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
