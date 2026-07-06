import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSensorTowerCsvDedupeKey,
  dedupeSensorTowerCsvImports
} from "../server/sensortower-dedupe.mjs";

test("Sensor Tower CSV dedupe key ignores query param order and blank filter noise", () => {
  const base = {
    appId: "6480417616",
    dataType: "reviews",
    sourceUrl: "https://app.sensortower.com/store-marketing/reviews?b=2&a=1",
    filters: {
      countries: ["US"],
      activeUserMeasure: "",
      period: ""
    },
    dateRange: { start: "2026-03-26", end: "2026-06-23", duration: "P90D" },
    rowCount: 1434,
    metric: "ratingCount",
    chartId: "reviews"
  };
  const variant = {
    ...base,
    sourceUrl: "https://app.sensortower.com/store-marketing/reviews?a=1&b=2",
    filters: {
      countries: ["US"]
    }
  };
  assert.equal(buildSensorTowerCsvDedupeKey(base), buildSensorTowerCsvDedupeKey(variant));
});

test("Sensor Tower CSV dedupe keeps the latest import per dedupe key", () => {
  const older = {
    id: "old",
    appId: "6480417616",
    dataType: "reviews",
    sourceUrl: "https://app.sensortower.com/store-marketing/reviews?a=1&b=2",
    filters: { countries: ["US"] },
    dateRange: { start: "2026-03-26", end: "2026-06-23", duration: "P90D" },
    rowCount: 1434,
    metric: "ratingCount",
    chartId: "reviews",
    importedAt: "2026-06-23T10:00:00.000Z"
  };
  const newer = {
    ...older,
    id: "new",
    importedAt: "2026-06-23T11:00:00.000Z"
  };
  const other = {
    ...older,
    id: "other",
    appId: "another-app"
  };
  const { unique, duplicates } = dedupeSensorTowerCsvImports([older, newer, other]);
  assert.deepEqual(unique.map((item) => item.id), ["new", "other"]);
  assert.deepEqual(duplicates.map((item) => item.id), ["old"]);
});
