import assert from "node:assert/strict";
import test from "node:test";

import { createAppService, isLikelyAppStoreScreenshotImageUrl } from "../server/app-service.mjs";

function createService(initialApps = []) {
  let apps = structuredClone(initialApps);
  return {
    service: createAppService({
      readApps: async () => structuredClone(apps),
      writeApps: async (value) => { apps = structuredClone(value); },
      formatDate: () => "2026-06-28 16:00",
      normalizeAppNameForMatch: (value) => String(value || "").toLowerCase(),
      normalizeAppDisplayName: (value) => String(value || "").split(":")[0].trim()
    }),
    readApps: () => structuredClone(apps)
  };
}

const appStoreItem = {
  trackId: 123,
  trackName: "New App: Example",
  trackViewUrl: "https://apps.apple.com/us/app/id123",
  genres: ["Lifestyle"],
  screenshotUrls: ["https://is1-ssl.mzstatic.com/image/thumb/PurpleSource/v4/demo/1.png/392x696bb.jpg"],
  ipadScreenshotUrls: ["https://is1-ssl.mzstatic.com/image/thumb/PurpleSource/v4/demo/2.png/576x768bb.jpg"]
};

test("new App Store apps are saved as unclassified", async () => {
  const { service, readApps } = createService();
  const saved = await service.saveAppStoreItem(appStoreItem, "");

  assert.deepEqual(saved.categories, []);
  assert.equal(saved.category, "");
  assert.equal(saved.media.screenshots.length, 2);
  assert.equal(saved.media.screenshots[0].source, "appstore");
  assert.deepEqual(readApps()[0].categories, []);
});

test("refreshing an existing app preserves manual categories", async () => {
  const { service } = createService([{
    id: "123",
    name: "New App",
    categories: ["工具"],
    category: "工具",
    createdAt: "2026-06-20 10:00"
  }]);
  const saved = await service.saveAppStoreItem(appStoreItem, "");

  assert.deepEqual(saved.categories, ["工具"]);
  assert.equal(saved.category, "工具");
  assert.equal(saved.createdAt, "2026-06-20 10:00");
});

test("App Store media keeps screenshots and drops icons/placeholders", async () => {
  const { service } = createService();
  const saved = await service.saveAppStoreItem({
    ...appStoreItem,
    screenshotUrls: [
      "https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/demo/Store-Screenshot-01.jpg/392x696bb.jpg",
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/demo/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg",
      "https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/demo/Placeholder.mill/473x1024.jpg",
      "https://is1-ssl.mzstatic.com/image/thumb/Features221/v4/demo/feature.png/473x1024.jpg"
    ],
    ipadScreenshotUrls: []
  }, "");

  assert.equal(saved.media.screenshots.length, 1);
  assert.match(saved.media.screenshots[0].imageUrl, /Store-Screenshot-01/);
});

test("App Store screenshot detector requires screenshot-shaped assets", () => {
  assert.equal(isLikelyAppStoreScreenshotImageUrl("https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/demo/page1.png/392x696bb.jpg"), true);
  assert.equal(isLikelyAppStoreScreenshotImageUrl("https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/demo/Store-Screenshot-01.jpg/512x512bb.jpg"), false);
  assert.equal(isLikelyAppStoreScreenshotImageUrl("https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/demo/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg"), false);
  assert.equal(isLikelyAppStoreScreenshotImageUrl("https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/demo/Placeholder.mill/473x1024.jpg"), false);
  assert.equal(isLikelyAppStoreScreenshotImageUrl("https://is1-ssl.mzstatic.com/image/thumb/Features221/v4/demo/feature.png/473x1024.jpg"), false);
});
