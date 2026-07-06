import assert from "node:assert/strict";
import test from "node:test";

import { formatCollectedAt, renderAdShotImportedStatus, resolveAppCategoryLabel } from "../chrome-extension/popup-shot-status.js";

test("formatCollectedAt keeps local collection timestamps concise", () => {
  assert.equal(formatCollectedAt("2026-06-28 13:55"), "2026-06-28 13:55");
  assert.equal(formatCollectedAt("2026-06-28T13:55:42"), "2026-06-28 13:55");
  assert.equal(formatCollectedAt(""), "");
});

test("renderAdShotImportedStatus shows the last successful collection time", () => {
  const elements = {
    adShotStatusEl: { hidden: true, className: "", innerHTML: "" },
    openLocalShotEl: {
      hidden: true,
      href: "",
      removeAttribute() {}
    },
    detectedAppEl: { textContent: "" },
    detectedDeveloperEl: { textContent: "" },
    collectButton: { textContent: "" }
  };

  renderAdShotImportedStatus({ el: elements }, {
    shotId: "shot_bookly",
    sourcePlatform: "tiktok",
    appName: "Bookly",
    capturedAt: "2026-06-28 13:55",
    shotUrl: "/shots/shot_bookly"
  });

  assert.equal(elements.adShotStatusEl.hidden, false);
  assert.match(elements.adShotStatusEl.innerHTML, /当前视频已入库/);
  assert.match(elements.adShotStatusEl.innerHTML, /Bookly · 未分类/);
  assert.match(elements.adShotStatusEl.innerHTML, /上次成功采集：2026-06-28 13:55/);
  assert.equal(elements.collectButton.textContent, "重新采集视频&评论");
  assert.equal(elements.openLocalShotEl.hidden, false);
});

test("renderAdShotImportedStatus prefers the most recent successful collection timestamp", () => {
  const elements = {
    adShotStatusEl: { hidden: true, className: "", innerHTML: "" },
    openLocalShotEl: {
      hidden: true,
      href: "",
      removeAttribute() {}
    },
    detectedAppEl: { textContent: "" },
    detectedDeveloperEl: { textContent: "" },
    collectButton: { textContent: "" }
  };

  renderAdShotImportedStatus({ el: elements }, {
    shotId: "shot_bereal",
    sourcePlatform: "tiktok",
    appName: "BeReal",
    capturedAt: "2026-06-17 14:30",
    lastCollectedAt: "2026-07-01 18:15",
    commentsRaw: {
      capturedAt: "2026-07-01 18:15",
      itemCount: 100,
      items: [{ media: [{ localPath: "/data/example.jpg" }] }]
    }
  });

  assert.match(elements.adShotStatusEl.innerHTML, /上次成功采集：2026-07-01 18:15/);
  assert.match(elements.adShotStatusEl.innerHTML, /评论采集：2026-07-01 18:15 · 100 条 · 图片 1 张/);
});

test("resolveAppCategoryLabel only uses manual app categories", () => {
  assert.equal(resolveAppCategoryLabel({ categories: [], category: "" }), "未分类");
  assert.equal(resolveAppCategoryLabel({ categories: ["读书"], category: "读书" }), "读书");
});
