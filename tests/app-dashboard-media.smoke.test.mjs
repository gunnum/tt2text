import assert from "node:assert/strict";
import test from "node:test";

import { createAppDashboardService } from "../server/app-dashboard-service.mjs";

test("app dashboard prefers App Store media over Sensor Tower screenshots", async () => {
  const service = createAppDashboardService({
    projectRootDir: process.cwd(),
    readApps: async () => [{
      id: "123",
      name: "Example App",
      media: {
        screenshots: [{
          source: "appstore",
          platform: "iphone",
          imageUrl: "https://example.com/appstore.jpg",
          thumbnailUrl: "https://example.com/appstore-thumb.jpg"
        }],
        previewVideos: [{
          videoUrl: "https://example.com/preview.mp4"
        }],
        refreshedAt: "2026-07-01 10:00"
      }
    }],
    readAppMetrics: async () => [{
      appId: "123",
      sourceUrl: "https://app.sensortower.com/overview/123",
      overview: {
        screenshots: [{
          source: "sensortower",
          imageUrl: "https://example.com/st.jpg",
          thumbnailUrl: "https://example.com/st-thumb.jpg"
        }]
      }
    }],
    readSensorTowerCsvImports: async () => [],
    readAppPaywalls: async () => [],
    normalizeText: (value) => String(value || "").trim()
  });

  const dashboard = await service.getAppDashboardSummary("123");

  assert.equal(dashboard.media.source, "appstore");
  assert.equal(dashboard.media.screenshots[0].imageUrl, "https://example.com/appstore.jpg");
  assert.equal(dashboard.media.previewVideos[0].videoUrl, "https://example.com/preview.mp4");
});
