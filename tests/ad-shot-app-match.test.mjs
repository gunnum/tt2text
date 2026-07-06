import test from "node:test";
import assert from "node:assert/strict";

import { createAdShotAppMatchService } from "../server/ad-shots/app-match-service.mjs";

function createService({ apps = [], createdApp = null } = {}) {
  const storedApps = [...apps];
  return createAdShotAppMatchService({
    readApps: async () => storedApps,
    matchAppByName: (items, candidate) => {
      const normalizedCandidate = normalize(candidate);
      return items.find((app) => (
        normalize(app.name) === normalizedCandidate || normalize(app.fullName || "") === normalizedCandidate
      )) || null;
    },
    addAppFromStoreSearch: async (query) => {
      if (!createdApp) {
        return null;
      }
      const app = {
        ...createdApp,
        name: createdApp.name || query
      };
      storedApps.push(app);
      return app;
    },
    pickResultAppFields: (app) => ({
      id: app.id,
      name: app.name,
      appStoreUrl: app.appStoreUrl || "",
      logoUrl: app.logoUrl || ""
    }),
    normalizeAppDisplayName: (value) => String(value || "").split(/\s*[:：]\s*|\s+[–—-]\s+|,\s+/)[0].trim(),
    normalizeText: (value) => String(value || "").trim(),
    uniqueStrings: (items) => [...new Set((Array.isArray(items) ? items : []).filter(Boolean))]
  });
}

function normalize(value) {
  return String(value || "").replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "").toLowerCase();
}

test("ad shot app match prefers brand name over title", async () => {
  const service = createService({
    apps: [
      { id: "wiser-1", name: "Wiser", fullName: "Wiser: Bite-Sized Learning" },
      { id: "other-1", name: "POV" }
    ]
  });

  const result = await service.resolveAdShotAppMatch({
    brandName: "Wiser: Learning English without studying",
    title: "POV: improve your english by listening to audiobook"
  });

  assert.equal(result.status, "matched");
  assert.equal(result.appId, "wiser-1");
  assert.equal(result.query, "Wiser");
  assert.equal(result.evidence[0].source, "brand-name");
});

test("ad shot app match falls back to landing page brand", async () => {
  const service = createService({
    apps: [
      { id: "amo-1", name: "amo" }
    ]
  });

  const result = await service.resolveAdShotAppMatch({
    brandName: "",
    appName: "未指定",
    title: "Ma che davero?! #scuola#spotify#musica#amici",
    landingPage: "https://get.amo.co/bump?utm_source=tiktok"
  });

  assert.equal(result.status, "matched");
  assert.equal(result.appId, "amo-1");
  assert.equal(result.query, "amo");
  assert.equal(result.evidence[0].source, "landing-page");
});

test("ad shot app match strips landing page acquisition prefix", async () => {
  const service = createService({
    apps: [
      { id: "amar-1", name: "amar" }
    ]
  });

  const result = await service.resolveAdShotAppMatch({
    brandName: "",
    appName: "未指定",
    title: "دردشة فيديو حية",
    landingPage: "https://matchamar.vercel.app?utm_source=tiktokweb"
  });

  assert.equal(result.status, "matched");
  assert.equal(result.appId, "amar-1");
  assert.equal(result.query, "amar");
  assert.equal(result.evidence[0].source, "landing-page");
});

test("ad shot app match extracts brand-like token from title without fuzzy sentence match", async () => {
  const service = createService({
    createdApp: { id: "blackgentry-1", name: "BlackGentry" }
  });

  const result = await service.resolveAdShotAppMatch({
    brandName: "",
    appName: "未指定",
    title: "Get more matches on BlackGentry. We have the best singles.",
    landingPage: "https://blackgentryapp.com/getapptiktok/"
  });

  assert.equal(result.status, "matched");
  assert.equal(result.appId, "blackgentry-1");
  assert.equal(result.query, "blackgentry");
});

test("ad shot app match leaves empty when no reliable signal exists", async () => {
  const service = createService({
    apps: [
      { id: "pov-1", name: "POV" }
    ]
  });

  const result = await service.resolveAdShotAppMatch({
    brandName: "",
    appName: "未指定",
    title: "POV: we matched on duet this morning",
    landingPage: ""
  });

  assert.equal(result.status, "unmatched");
  assert.equal(result.appId, "");
});
