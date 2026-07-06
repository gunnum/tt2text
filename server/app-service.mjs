export function createAppService(deps = {}) {
  const requiredDeps = [
    "readApps",
    "writeApps",
    "formatDate",
    "normalizeAppNameForMatch",
    "normalizeAppDisplayName"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAppService 缺少依赖：${dep}`);
    }
  }

  async function addAppFromStoreUrl(appStoreUrl) {
    const appStoreId = extractAppStoreId(appStoreUrl);
    return addAppFromStoreId(appStoreId, appStoreUrl);
  }

  async function addAppFromStoreId(appStoreId, fallbackUrl = "") {
    const item = await lookupAppStoreItem(appStoreId);
    return saveAppStoreItem(item, fallbackUrl);
  }

  async function refreshAppStoreMediaForApp(appId) {
    const id = normalizeText(appId);
    if (!id) {
      throw new Error("缺少 App ID。");
    }
    const apps = await deps.readApps();
    const app = apps.find((item) => item.id === id);
    if (!app) {
      throw new Error("没有找到这个 App。");
    }
    const item = await lookupAppStoreItem(id);
    const pageMedia = await fetchAppStorePageMedia(item.trackViewUrl || app.appStoreUrl || "");
    return saveAppStoreItem({
      ...item,
      tt2textPageMedia: pageMedia
    }, app.appStoreUrl || item.trackViewUrl || "");
  }

  async function addAppFromStoreSearch(appName) {
    const query = normalizeText(appName);
    if (!query) {
      return null;
    }

    const searchUrl = new URL("https://itunes.apple.com/search");
    searchUrl.searchParams.set("term", query);
    searchUrl.searchParams.set("entity", "software");
    searchUrl.searchParams.set("limit", "8");
    searchUrl.searchParams.set("country", "us");

    const response = await fetch(searchUrl);
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const items = Array.isArray(payload?.results) ? payload.results : [];
    const item = chooseBestAppStoreSearchResult(items, query);
    if (!item) {
      return null;
    }

    return saveAppStoreItem(item, item.trackViewUrl || "");
  }

  function chooseBestAppStoreSearchResult(items, query) {
    const target = deps.normalizeAppNameForMatch(query);
    if (!target) {
      return null;
    }

    return items.find((item) => deps.normalizeAppNameForMatch(item.trackName) === target)
      || items.find((item) => {
        const candidate = deps.normalizeAppNameForMatch(item.trackName);
        return candidate && (candidate.includes(target) || target.includes(candidate));
      })
      || null;
  }

  async function saveAppStoreItem(item, fallbackUrl) {
    const apps = await deps.readApps();
    const now = deps.formatDate(new Date());
    const app = {
      id: String(item.trackId || ""),
      name: deps.normalizeAppDisplayName(item.trackName) || "未命名 App",
      fullName: item.trackName || "",
      logoUrl: preferLargeArtwork(item.artworkUrl512 || item.artworkUrl100 || ""),
      appStoreUrl: item.trackViewUrl || fallbackUrl,
      bundleId: item.bundleId || "",
      sellerName: item.sellerName || "",
      primaryGenreName: item.primaryGenreName || "",
      primaryGenreId: item.primaryGenreId ? String(item.primaryGenreId) : "",
      genres: Array.isArray(item.genres) ? item.genres : [],
      price: typeof item.price === "number" ? item.price : null,
      formattedPrice: item.formattedPrice || "",
      currency: item.currency || "",
      media: normalizeAppStoreMedia(item),
      createdAt: now
    };

    if (!app.id) {
      throw new Error("App Store 返回结果缺少 App ID。");
    }

    const existingIndex = apps.findIndex((saved) => saved.id === app.id);
    let savedApp;
    if (existingIndex >= 0) {
      const existing = apps[existingIndex];
      const categories = normalizeCategories([
        ...(Array.isArray(existing.categories) ? existing.categories : []),
        existing.category
      ]);
      savedApp = {
        ...existing,
        ...app,
        categories,
        category: categories[0] || "",
        createdAt: existing.createdAt || app.createdAt,
        updatedAt: now
      };
      apps[existingIndex] = savedApp;
    } else {
      savedApp = {
        ...app,
        categories: [],
        category: ""
      };
      apps.unshift(savedApp);
    }

    await deps.writeApps(apps);
    return savedApp;
  }

  async function findAppById(appId) {
    const apps = await deps.readApps();
    return apps.find((app) => app.id === appId) || null;
  }

  async function updateAppCategories(appId, categories = []) {
    const id = normalizeText(appId);
    if (!id) {
      throw new Error("缺少 App ID。");
    }

    const apps = await deps.readApps();
    const appIndex = apps.findIndex((app) => app.id === id);
    if (appIndex < 0) {
      throw new Error("没有找到这个 App。");
    }

    const normalizedCategories = normalizeCategories(categories);
    const updatedApp = {
      ...apps[appIndex],
      categories: normalizedCategories,
      category: normalizedCategories[0] || "",
      updatedAt: deps.formatDate(new Date())
    };
    apps[appIndex] = updatedApp;
    await deps.writeApps(apps);
    return updatedApp;
  }

  function extractAppStoreId(appStoreUrl) {
    const match = String(appStoreUrl || "").match(/\/id(\d+)(?:[/?#]|$)/)
      || String(appStoreUrl || "").match(/[?&]id=(\d+)(?:&|$)/);
    if (!match) {
      throw new Error("无法识别 App Store 链接里的 App ID。请粘贴形如 https://apps.apple.com/.../id123456789 的链接。");
    }
    return match[1];
  }

  function preferLargeArtwork(url) {
    if (!url) {
      return "";
    }
    return url.replace(/\/\d+x\d+bb\.(jpg|png|webp)$/i, "/512x512bb.$1");
  }

  function pickResultAppFields(app) {
    return {
      id: app.id,
      name: app.name,
      logoUrl: app.logoUrl,
      appStoreUrl: app.appStoreUrl
    };
  }

  async function lookupAppStoreItem(appStoreId) {
    const lookupUrl = `https://itunes.apple.com/lookup?id=${encodeURIComponent(appStoreId)}`;
    const response = await fetch(lookupUrl);
    if (!response.ok) {
      throw new Error(`无法读取 App Store 信息，状态码 ${response.status}`);
    }

    const payload = await response.json();
    const item = payload?.results?.[0];
    if (!item) {
      throw new Error("没有从 App Store 找到这个 App。");
    }
    return item;
  }

  async function fetchAppStorePageMedia(appStoreUrl) {
    if (!appStoreUrl) {
      return { screenshots: [], previewVideos: [] };
    }
    try {
      const response = await fetch(appStoreUrl, {
        headers: {
          "accept": "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0 tt2text-app-media/1.0"
        },
        signal: AbortSignal.timeout(6000)
      });
      if (!response.ok) {
        return { screenshots: [], previewVideos: [] };
      }
      const html = await response.text();
      return {
        screenshots: extractAppleScreenshotUrls(html),
        previewVideos: extractApplePreviewVideoUrls(html)
      };
    } catch {
      return { screenshots: [], previewVideos: [] };
    }
  }

  function normalizeAppStoreMedia(item) {
    const pageMedia = item.tt2textPageMedia && typeof item.tt2textPageMedia === "object"
      ? item.tt2textPageMedia
      : {};
    const iphoneScreenshots = normalizeScreenshotUrls([
      ...(Array.isArray(item.screenshotUrls) ? item.screenshotUrls : []),
      ...(Array.isArray(pageMedia.screenshots) ? pageMedia.screenshots : [])
    ], "iphone");
    const ipadScreenshots = normalizeScreenshotUrls(Array.isArray(item.ipadScreenshotUrls) ? item.ipadScreenshotUrls : [], "ipad");
    const previewVideos = normalizePreviewVideoUrls([
      ...(Array.isArray(item.previewVideos) ? item.previewVideos : []),
      ...(Array.isArray(item.appPreviewVideoUrls) ? item.appPreviewVideoUrls : []),
      ...(Array.isArray(pageMedia.previewVideos) ? pageMedia.previewVideos : [])
    ]);
    return {
      source: "appstore",
      screenshots: [...iphoneScreenshots, ...ipadScreenshots].slice(0, 30),
      previewVideos: previewVideos.slice(0, 12),
      refreshedAt: deps.formatDate(new Date())
    };
  }

  function normalizeScreenshotUrls(urls, platform) {
    const seen = new Set();
    return urls
      .map((url) => normalizeAppStoreImageUrl(url))
      .filter(Boolean)
      .filter((url) => {
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      })
      .map((url) => ({
        platform,
        imageUrl: url,
        thumbnailUrl: toAppStoreThumbnailUrl(url),
        alt: "App Store screenshot",
        source: "appstore"
      }));
  }

  function normalizePreviewVideoUrls(items) {
    const seen = new Set();
    return items
      .map((item) => typeof item === "string" ? { videoUrl: item } : item)
      .map((item) => ({
        videoUrl: normalizeMediaUrl(item?.videoUrl || item?.url || item?.src),
        posterUrl: normalizeAppStoreImageUrl(item?.posterUrl || item?.poster || item?.imageUrl || "")
      }))
      .filter((item) => item.videoUrl)
      .filter((item) => {
        if (seen.has(item.videoUrl)) return false;
        seen.add(item.videoUrl);
        return true;
      });
  }

  function extractAppleScreenshotUrls(html) {
    return extractUrlsFromText(html)
      .filter((url) => /mzstatic\.com\/image\/thumb\//i.test(url))
      .filter((url) => /\.(?:jpg|jpeg|png|webp)(?:[?#]|$)/i.test(url))
      .map(normalizeAppStoreImageUrl)
      .filter(Boolean);
  }

  function extractApplePreviewVideoUrls(html) {
    return extractUrlsFromText(html)
      .filter((url) => /mzstatic\.com/i.test(url))
      .filter((url) => /\.(?:m3u8|mp4)(?:[?#]|$)/i.test(url))
      .map((url) => ({ videoUrl: normalizeMediaUrl(url) }))
      .filter((item) => item.videoUrl);
  }

  function extractUrlsFromText(value) {
    const text = String(value || "")
      .replace(/\\u002F/gi, "/")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");
    const matches = text.match(/https?:\/\/[^"'<>\\\s)]+/gi) || [];
    return Array.from(new Set(matches.map((url) => url.replace(/[),.;]+$/, ""))));
  }

  function normalizeAppStoreImageUrl(value) {
    const url = normalizeMediaUrl(value);
    if (!url) return "";
    return url.replace(/\/(?:\d+x\d+|[0-9]+x[0-9]+bb|[0-9]+x[0-9]+sr|[0-9]+x[0-9]+-?)[^/]*\.(jpg|jpeg|png|webp)$/i, "/473x1024.jpg");
  }

  function toAppStoreThumbnailUrl(value) {
    return normalizeMediaUrl(value).replace(/\/(?:\d+x\d+|[0-9]+x[0-9]+bb|[0-9]+x[0-9]+sr|[0-9]+x[0-9]+-?)[^/]*\.(jpg|jpeg|png|webp)$/i, "/370x800.jpg");
  }

  function normalizeMediaUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      return url.toString();
    } catch {
      return "";
    }
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeCategories(value) {
    const list = Array.isArray(value) ? value : [value];
    return Array.from(new Set(list.map(normalizeText).filter(Boolean))).slice(0, 8);
  }

  return {
    addAppFromStoreUrl,
    addAppFromStoreId,
    addAppFromStoreSearch,
    chooseBestAppStoreSearchResult,
    saveAppStoreItem,
    findAppById,
    updateAppCategories,
    extractAppStoreId,
    preferLargeArtwork,
    pickResultAppFields,
    refreshAppStoreMediaForApp
  };
}
