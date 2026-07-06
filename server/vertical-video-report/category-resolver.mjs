import crypto from "node:crypto";

import {
  isReadingAdShot,
  isSocialAdShot
} from "../ad-shots/normalizers.mjs";
import {
  READING_ALIAS_ID,
  READING_APP_CATEGORY_LABEL
} from "./constants.mjs";

const BUILTIN_CATEGORIES = [
  {
    id: READING_ALIAS_ID,
    label: "阅读/听书",
    description: "读书、听书、书摘、阅读追踪、微学习相关短视频。",
    matcher: isReadingAdShot
  },
  {
    id: "social",
    label: "社交/交友",
    description: "社交、交友、匹配、聊天和关系场景相关短视频。",
    matcher: isSocialAdShot
  }
];

export function createCategoryResolver({ normalizeText } = {}) {
  if (typeof normalizeText !== "function") {
    throw new Error("createCategoryResolver 缺少依赖：normalizeText");
  }

  function buildCategories(shots = [], apps = []) {
    const buckets = new Map();
    const appIndex = buildAppIndex(apps);
    for (const definition of BUILTIN_CATEGORIES) {
      buckets.set(definition.id, { ...definition, shots: [] });
    }

    for (const shot of shots) {
      const matchedCategories = [
        ...resolveShotAppCategories(shot, appIndex).map(categoryFromAppCategory),
        BUILTIN_CATEGORIES.find((definition) => matchesBuiltInCategory(definition, shot))
      ].filter(Boolean);
      const categories = matchedCategories.length ? matchedCategories : [categoryFromShot(shot)];

      for (const category of categories) {
        if (!buckets.has(category.id)) {
          buckets.set(category.id, { ...category, shots: [] });
        }
        const bucket = buckets.get(category.id);
        const shotId = normalizeText(shot.shotId || shot.id || shot.sourceItemId || shot.sourceAdId || shot.sourceUrl);
        if (!bucket.shots.some((item) => normalizeText(item.shotId || item.id || item.sourceItemId || item.sourceAdId || item.sourceUrl) === shotId)) {
          bucket.shots.push(shot);
        }
      }
    }

    return mergeCategoryAliases(Array.from(buckets.values()).filter((category) => category.shots.length));
  }

  function findCategoryById(categories = [], categoryId = "") {
    const normalized = normalizeCategoryId(categoryId);
    if (normalized === READING_ALIAS_ID) {
      return categories.find((item) => item.id === appCategoryIdForLabel(READING_APP_CATEGORY_LABEL))
        || categories.find((item) => item.id === READING_ALIAS_ID)
        || null;
    }
    return categories.find((item) => item.id === normalized || (item.aliases || []).includes(normalized)) || null;
  }

  function mergeCategoryAliases(categories = []) {
    const readingAppCategoryId = appCategoryIdForLabel(READING_APP_CATEGORY_LABEL);
    const readingAppCategory = categories.find((category) => category.id === readingAppCategoryId);
    const inferredReading = categories.find((category) => category.id === READING_ALIAS_ID);
    if (readingAppCategory && inferredReading) {
      readingAppCategory.aliases = Array.from(new Set([...(readingAppCategory.aliases || []), READING_ALIAS_ID]));
      readingAppCategory.description = readingAppCategory.description + "（读书报告以 App 分类为准，reading 仅作为旧链接兼容入口。）";
      return categories.filter((category) => category.id !== READING_ALIAS_ID);
    }
    return categories;
  }

  function matchesBuiltInCategory(definition, shot) {
    if (definition.matcher(shot)) {
      return true;
    }
    const text = normalizeText([
      shot.title,
      shot.readableTitle,
      shot.highlight,
      shot.storySummary,
      shot.transcriptZh,
      shot.transcriptOriginal,
      shot.app?.name,
      shot.appDisplay,
      shot.appName,
      shot.brandName,
      shot.targetApp,
      shot.authorName
    ].filter(Boolean).join(" ")).toLowerCase();
    if (definition.id === READING_ALIAS_ID) {
      return /blinkist|befreed|headway|bookly|wiser|speechify|book|books|reading|audiobook|blinks|micro.?learning|doom.?scroll|brain.?boost|书摘|读书|听书|阅读/.test(text);
    }
    if (definition.id === "social") {
      return /bereal|dating|match|matches|chat|friends?|social|duet|社交|交友|匹配|聊天/.test(text);
    }
    return false;
  }

  function categoryFromShot(shot) {
    const label = normalizeText(shot.category || shot.industryLabel || shot.sourceDisplay || "未分类视频");
    return {
      id: "category-" + hashId(label).slice(0, 10),
      label,
      description: label + " 类已收录短视频。"
    };
  }

  function categoryFromAppCategory(label) {
    const normalizedLabel = normalizeText(label);
    if (!normalizedLabel) return null;
    return {
      id: appCategoryIdForLabel(normalizedLabel),
      label: normalizedLabel,
      description: normalizedLabel + " 类 App 已收录短视频复盘。",
      source: "app_category",
      appCategoryLabel: normalizedLabel
    };
  }

  function buildAppIndex(apps = []) {
    const byId = new Map();
    const byName = new Map();
    for (const app of apps) {
      const categories = normalizeStringArray([
        ...(Array.isArray(app.categories) ? app.categories : []),
        app.category
      ]);
      const normalized = { ...app, categories };
      const ids = normalizeStringArray([app.id, app.appId, app.trackId, app.bundleId]);
      ids.forEach((id) => byId.set(id, normalized));
      normalizeStringArray([app.name, app.fullName, app.appName]).forEach((name) => {
        byName.set(name.toLowerCase(), normalized);
        const normalizedName = normalizeAppName(name);
        if (normalizedName) byName.set(normalizedName, normalized);
      });
    }
    return { byId, byName };
  }

  function resolveShotAppCategories(shot, appIndex) {
    const candidates = normalizeStringArray([
      shot.appId,
      shot.app?.id,
      shot.app?.trackId,
      shot.app?.bundleId
    ]);
    for (const id of candidates) {
      const app = appIndex.byId.get(id);
      if (app?.categories?.length) return app.categories;
    }

    const names = normalizeStringArray([
      shot.app?.name,
      shot.app?.fullName,
      shot.appDisplay,
      shot.appName,
      shot.brandName,
      shot.targetApp
    ]).flatMap((item) => [item.toLowerCase(), normalizeAppName(item)]).filter(Boolean);
    for (const name of names) {
      const app = appIndex.byName.get(name);
      if (app?.categories?.length) return app.categories;
    }
    return normalizeStringArray(shot.appCategoriesSynced || shot.app_categories_synced || shot.appCategory || shot.app_category);
  }

  return {
    buildCategories,
    findCategoryById
  };
}

export function normalizeCategoryId(value) {
  return String(value || "").trim().toLowerCase();
}

export function hashId(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

export function appCategoryIdForLabel(label) {
  return "app-category-" + hashId(label).slice(0, 10);
}

export function normalizeAppName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}
