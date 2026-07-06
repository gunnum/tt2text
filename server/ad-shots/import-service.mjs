import { promises as fs } from "node:fs";
import path from "node:path";
import {
  normalizeAdShotSourcePlatform
} from "./normalizers.mjs";

export function createAdShotImportService(deps = {}) {
  const requiredDeps = [
    "readAdShots",
    "writeAdShots",
    "readAdShotProjects",
    "readAdShotCandidates",
    "writeAdShotCandidates",
    "readApps",
    "pickResultAppFields",
    "resolveAdShotAppMatch",
    "ensureDir",
    "createJobId",
    "normalizeAdShotRecord",
    "normalizeVisualTextSegments",
    "normalizeToPublicPath",
    "normalizeTikTokEngagement",
    "normalizeStringArray",
    "normalizeText",
    "formatDate",
    "adShotAssetsDir",
    "projectRootDir"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAdShotImportService 缺少依赖：${dep}`);
    }
  }

  async function importAdShot(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("缺少 Ad Shot 导入数据。");
    }

    const sourcePlatform = normalizeAdShotSourcePlatform(payload);
    const isTikTokDetail = sourcePlatform === "tiktok";
    let sourceUrl = normalizeText(payload.source_url || payload.sourceUrl || payload.url || payload.page?.url);
    const providedSourceAdId = normalizeText(payload.source_ad_id || payload.sourceAdId || payload.ad_id || payload.adId);
    const pageHtml = typeof payload.page_html === "string"
      ? payload.page_html
      : typeof payload.pageHtml === "string"
        ? payload.pageHtml
        : "";
    const providedVideoUrl = normalizeText(payload.video_url || payload.videoUrl);
    const videoLocalPath = normalizeText(payload.video_local_path || payload.videoLocalPath);
    const canImportFromProvidedMedia = Boolean(providedSourceAdId && (providedVideoUrl || videoLocalPath));
    if (!sourceUrl && !pageHtml && !canImportFromProvidedMedia) {
      throw new Error("缺少 Top Ads 详情页 URL、插件采集的页面 HTML 或候选媒体信息。");
    }
    if (!isTikTokDetail && sourceUrl && !/ads\.tiktok\.com\/business\/creativecenter\/topads\//i.test(sourceUrl) && !pageHtml) {
      throw new Error("当前最小闭环只支持 TikTok Creative Center Top Ads 详情页。");
    }
    if (isTikTokDetail && sourceUrl && !/tiktok\.com\/@[^/]+\/(?:video|photo)\/\d+/i.test(sourceUrl) && !canImportFromProvidedMedia) {
      throw new Error("当前普通 TikTok 入库只支持视频/图集详情页。");
    }

    const projects = await deps.readAdShotProjects();
    const validProjectIds = new Set(projects.map((project) => project.id));
    const requestedProjectIds = deps.normalizeStringArray(payload.projectIds || payload.project_ids || payload.projectId || payload.project_id)
      .filter((projectId) => validProjectIds.has(projectId));
    const requestedProject = requestedProjectIds.length
      ? projects.find((project) => project.id === requestedProjectIds[0])
      : null;
    const targetApp = normalizeText(payload.target_app || payload.targetApp) || "未指定";
    const requestedAppCategory = normalizeText(payload.appCategory || payload.app_category || payload.categoryName || payload.category);
    const existingRecords = await deps.readAdShots();
    const shouldFetchDetailPage = !isTikTokDetail && !pageHtml && sourceUrl && !canImportFromProvidedMedia;
    const html = pageHtml || (shouldFetchDetailPage ? await fetchText(sourceUrl) : "");
    const detail = isTikTokDetail
      ? buildTikTokDetailFromPayload(payload, sourceUrl, providedSourceAdId)
      : html
        ? extractTopAdsDetailFromHtml(html)
        : buildTopAdsDetailFromPayload(payload, sourceUrl, providedSourceAdId);
    const sourceAdId = normalizeText(detail.id || (isTikTokDetail ? extractTikTokVideoIdFromUrl(sourceUrl) : extractTopAdsIdFromUrl(sourceUrl)) || providedSourceAdId);
    if (!sourceAdId) {
      throw new Error(isTikTokDetail ? "无法识别 TikTok 视频 ID。" : "无法识别 Top Ads 广告 ID。");
    }
    sourceUrl = isTikTokDetail
      ? buildTikTokDetailSourceUrl({ sourceUrl, canonicalUrl: detail.canonicalUrl, sourceAdId })
      : buildTopAdsSourceUrl({ sourceUrl, canonicalUrl: detail.canonicalUrl, sourceAdId });

    const duplicateIndex = existingRecords.findIndex((item) =>
      item.sourceAdId === sourceAdId
      && normalizeAdShotSourcePlatform(item) === sourcePlatform
    );
    const duplicate = duplicateIndex >= 0 ? existingRecords[duplicateIndex] : null;
    if (duplicate) {
      const lastCollectedAt = deps.formatDate(new Date());
      const refreshedInteractiveTimeAnalysis = normalizeInteractiveTimeAnalysis(
        payload.interactiveTimeAnalysis
        || payload.interactive_time_analysis
        || detail.interactiveTimeAnalysis
        || detail.interactive_time_analysis
      );
      const refreshedLandingPage = resolveLandingPage({ detail, payload });
      const refreshedImageUrls = deps.normalizeStringArray(
        detail.imageUrls
        || detail.image_urls
        || payload.imageUrls
        || payload.image_urls
        || payload.raw?.imageUrls
        || payload.raw?.image_urls
      );
      const refreshedAdCaption = normalizeText(
        payload.adCaption
        || payload.ad_caption
        || detail.adCaption
        || detail.adTitle
        || detail.title
      );
      const duplicateShotDir = path.join(deps.adShotAssetsDir, duplicate.shotId || "");
      const refreshedPosterUrl = normalizeText(
        payload.poster_url
        || payload.posterUrl
        || payload.coverUrl
        || payload.cover
        || payload.imageUrl
        || detail.cover
        || detail.videoInfo?.cover
        || refreshedImageUrls[0]
      );
      const refreshedPosterPath = duplicate.shotId && refreshedPosterUrl
        ? await downloadAdShotAsset(refreshedPosterUrl, path.join(duplicateShotDir, "poster.jpg"), { referer: sourceUrl }).catch(() => "")
        : "";
      const refreshedImagePaths = [];
      if (duplicate.shotId && refreshedImageUrls.length) {
        for (let index = 0; index < refreshedImageUrls.length; index += 1) {
          const imageUrl = refreshedImageUrls[index];
          const targetPath = path.join(duplicateShotDir, `image-${String(index + 1).padStart(2, "0")}.jpg`);
          const downloadedPath = await downloadAdShotAsset(imageUrl, targetPath, { referer: sourceUrl }).catch(() => "");
          if (downloadedPath) {
            refreshedImagePaths.push(deps.normalizeToPublicPath(downloadedPath));
          }
        }
      }
      existingRecords[duplicateIndex] = deps.normalizeAdShotRecord({
        ...duplicate,
        projectIds: requestedProjectIds.length ? requestedProjectIds : duplicate.projectIds,
        targetApp,
        appCategoriesSynced: [],
        landingPage: refreshedLandingPage || duplicate.landingPage,
        adCaption: refreshedAdCaption || duplicate.adCaption,
        posterPath: refreshedPosterPath ? deps.normalizeToPublicPath(refreshedPosterPath) : duplicate.posterPath,
        imagePaths: refreshedImagePaths.length ? refreshedImagePaths : duplicate.imagePaths,
        lastCollectedAt,
        updatedAt: lastCollectedAt,
        raw: {
          ...(duplicate.raw && typeof duplicate.raw === "object" ? duplicate.raw : {}),
          ...(requestedAppCategory ? { appCategory: requestedAppCategory } : {}),
          appCategoriesSynced: [],
          ...(refreshedLandingPage ? { landingPage: refreshedLandingPage } : {}),
          ...(refreshedImageUrls.length ? { imageUrls: refreshedImageUrls } : {}),
          ...(refreshedAdCaption ? { adCaption: refreshedAdCaption } : {}),
          ...(refreshedInteractiveTimeAnalysis ? { interactiveTimeAnalysis: refreshedInteractiveTimeAnalysis } : {})
        }
      }, projects);
      await deps.writeAdShots(existingRecords);
      await markAdShotCandidateImported({
        candidateId: normalizeText(payload.candidate_id || payload.candidateId),
        sourceAdId,
        shotId: duplicate.shotId
      });
      return {
        ...(duplicateIndex >= 0 ? existingRecords[duplicateIndex] : duplicate),
        duplicate: true
      };
    }

    const shotId = `shot_${deps.createJobId()}`;
    const shotDir = path.join(deps.adShotAssetsDir, shotId);
    await deps.ensureDir(shotDir);

    const videoInfo = detail.videoInfo && typeof detail.videoInfo === "object" ? detail.videoInfo : {};
    const videoUrl = providedVideoUrl || pickTopAdsVideoUrl(videoInfo);
    if (!videoUrl && !videoLocalPath && !isTikTokDetail) {
      throw new Error("详情页没有解析到可缓存的视频 URL，也没有收到插件传来的本地视频路径。");
    }

    const posterUrl = normalizeText(payload.poster_url || payload.posterUrl || videoInfo.cover || videoInfo.coverUrl || videoInfo.poster || detail.cover);
    const posterLocalPath = normalizeText(payload.poster_local_path || payload.posterLocalPath);
    const videoPath = videoLocalPath
      ? await copyAdShotLocalAsset(videoLocalPath, path.join(shotDir, `video${path.extname(videoLocalPath) || ".mp4"}`))
      : videoUrl
        ? await downloadAdShotAsset(videoUrl, path.join(shotDir, "video.mp4"), { referer: sourceUrl }).catch((error) => {
            if (isTikTokDetail) {
              deps.logger?.warn?.(`普通 TikTok 素材即时缓存视频失败，后续分析会通过来源 URL 重试：${error instanceof Error ? error.message : String(error)}`);
              return "";
            }
            throw error;
          })
        : "";
    const posterPath = posterLocalPath
      ? await copyAdShotLocalAsset(posterLocalPath, path.join(shotDir, `poster${path.extname(posterLocalPath) || ".jpg"}`)).catch(() => "")
      : posterUrl
        ? await downloadAdShotAsset(posterUrl, path.join(shotDir, "poster.jpg"), { referer: sourceUrl }).catch(() => "")
        : "";
    const capturePackagePath = payload.capture_package_path || payload.capturePackagePath
      ? await copyAdShotLocalAsset(normalizeText(payload.capture_package_path || payload.capturePackagePath), path.join(shotDir, "capture-package.json")).catch(() => "")
      : "";
    const requestedAppId = normalizeText(payload.appId || payload.app_id);
    const requestedApp = requestedAppId
      ? (await deps.readApps()).find((app) => app.id === requestedAppId) || null
      : null;
    const appMatch = requestedApp
      ? {
          appId: requestedApp.id,
          app: deps.pickResultAppFields(requestedApp),
          status: "matched",
          source: "manual-selection",
          query: requestedApp.name,
          error: "",
          evidence: [{ source: "manual-selection", query: requestedApp.name }]
        }
      : await deps.resolveAdShotAppMatch({
          brandName: detail.brandName,
          appName: detail.appName || detail.advertiser,
          title: detail.adTitle || detail.title || videoInfo.title,
          landingPage: resolveLandingPage({ detail, payload })
        });
    const landingPage = resolveLandingPage({ detail, payload });
    const adCaption = normalizeText(
      payload.adCaption
      || payload.ad_caption
      || detail.adCaption
      || detail.adTitle
      || detail.title
      || videoInfo.title
    );
    const interactiveTimeAnalysis = normalizeInteractiveTimeAnalysis(
      payload.interactiveTimeAnalysis
      || payload.interactive_time_analysis
      || detail.interactiveTimeAnalysis
      || detail.interactive_time_analysis
    );
    await fs.writeFile(path.join(shotDir, "source.html"), html || "<!-- Imported from Creative Center candidate media without page HTML. -->", "utf8");
    await fs.writeFile(path.join(shotDir, "raw-detail.json"), JSON.stringify(detail, null, 2), "utf8");

    const capturedAt = deps.formatDate(new Date());
    const duration = Number(videoInfo.duration || detail.duration) || null;
    const record = {
      shotId,
      sourcePlatform,
      sourceAdId,
      sourceUrl,
      targetApp,
      projectIds: requestedProjectIds,
      captureContext: normalizeText(payload.capture_context || payload.captureContext) || (isTikTokDetail ? "tiktok_detail" : "topads_detail"),
      title: normalizeText(detail.adTitle || detail.title || videoInfo.title),
      brandName: normalizeText(detail.brandName),
      appId: appMatch.appId,
      app: appMatch.app,
      appMatchStatus: appMatch.status,
      appMatchSource: appMatch.source,
      appMatchQuery: appMatch.query,
      appCategoriesSynced: [],
      countryCode: Array.isArray(detail.countryCode) ? detail.countryCode : deps.normalizeStringArray(detail.countryCode),
      industryKey: normalizeText(detail.industryKey),
      objectiveKey: normalizeText(detail.objectiveKey),
      landingPage,
      adCaption,
      authorName: normalizeText(detail.author || payload.author || payload.username),
      authorAvatarUrl: normalizeText(detail.authorAvatarUrl || payload.authorAvatarUrl || payload.author_avatar_url || payload.authorAvatar || payload.avatarUrl || payload.profileImageUrl),
      followerCount: firstNumeric(detail.followerCount, payload.followerCount, payload.follower_count, payload.followers, payload.fansCount, payload.authorFollowerCount, payload.authorFollowers),
      sourceLabel: normalizeText(detail.source) || (isTikTokDetail ? "TikTok 详情页" : ""),
      sourceKey: normalizeText(detail.sourceKey),
      mediaType: isTikTokDetail && /\/photo\//i.test(sourceUrl) ? "photo" : "video",
      videoId: normalizeText(videoInfo.vid || videoInfo.id),
      duration,
      width: Number(videoInfo.width) || null,
      height: Number(videoInfo.height) || null,
      videoPath: videoPath ? deps.normalizeToPublicPath(videoPath) : "",
      posterPath: posterPath ? deps.normalizeToPublicPath(posterPath) : "",
      capturePackagePath: capturePackagePath ? deps.normalizeToPublicPath(capturePackagePath) : "",
      detailPath: deps.normalizeToPublicPath(path.join(shotDir, "raw-detail.json")),
      htmlPath: deps.normalizeToPublicPath(path.join(shotDir, "source.html")),
      shotUrl: `/shots/${shotId}`,
      lastCollectedAt: capturedAt,
      analysisStatus: "pending",
      analysisSummary: {
        cardTitle: "",
        cardSummary: "",
        script: "等待接入视频转语义工作流。",
        hook: "等待分析。",
        productMechanism: "等待分析。",
        reusableTemplate: "等待分析。",
        onScreenTextOriginal: "",
        onScreenTextZh: "",
        visualTextSegments: []
      },
      onScreenTextOriginal: normalizeText(payload.onScreenTextOriginal || payload.on_screen_text_original),
      onScreenTextZh: normalizeText(payload.onScreenTextZh || payload.on_screen_text_zh),
      visualTextSegments: deps.normalizeVisualTextSegments(payload.visualTextSegments || payload.visual_text_segments, duration),
      raw: {
        metrics: detail.metrics || null,
        percentile: detail.percentile || null,
        appMatchError: appMatch.error || "",
        appMatchEvidence: appMatch.evidence || [],
        appCategory: requestedAppCategory,
        appCategoriesSynced: [],
        sourceUrl,
        landingPage,
        adCaption,
        interactiveTimeAnalysis,
        author: normalizeText(detail.author || payload.author),
        authorAvatarUrl: normalizeText(detail.authorAvatarUrl || payload.authorAvatarUrl || payload.author_avatar_url || payload.authorAvatar || payload.avatarUrl || payload.profileImageUrl),
        followerCount: firstNumeric(detail.followerCount, payload.followerCount, payload.follower_count, payload.followers, payload.fansCount, payload.authorFollowerCount, payload.authorFollowers),
        authorStats: detail.authorStats || payload.authorStats || payload.author_stats || null,
        publishedText: normalizeText(detail.publishedText || payload.publishedText),
        performance: {
          like: detail.like ?? null,
          comment: detail.comment ?? null,
          share: detail.share ?? detail.forward ?? null,
          view: detail.view ?? null,
          ctr: detail.ctr ?? null,
          cost: detail.cost ?? null
        }
      },
      capturedAt
    };

    existingRecords.unshift(record);
    await deps.writeAdShots(existingRecords);
    await markAdShotCandidateImported({
      candidateId: normalizeText(payload.candidate_id || payload.candidateId),
      sourceAdId,
      shotId
    });
    return record;
  }

  function buildTopAdsDetailFromPayload(payload, sourceUrl, sourceAdId) {
    const posterUrl = normalizeText(payload.poster_url || payload.posterUrl || payload.coverUrl || payload.cover || payload.imageUrl);
    const videoUrl = normalizeText(payload.video_url || payload.videoUrl);
    return {
      id: sourceAdId || extractTopAdsIdFromUrl(sourceUrl),
      canonicalUrl: sourceUrl,
      adTitle: normalizeText(payload.title || payload.adTitle || payload.ad_title),
      brandName: normalizeText(payload.brandName || payload.brand_name || payload.brand || payload.advertiser),
      countryCode: deps.normalizeStringArray(payload.countryCode || payload.country_code),
      industryKey: normalizeText(payload.industryKey || payload.industry_key),
      objectiveKey: normalizeText(payload.objectiveKey || payload.objective_key),
      source: normalizeText(payload.sourceLabel || payload.source_label || payload.source),
      sourceKey: normalizeText(payload.sourceKey || payload.source_key),
      duration: Number(payload.duration) || null,
      videoInfo: {
        vid: normalizeText(payload.videoId || payload.video_id),
        duration: Number(payload.duration) || null,
        width: Number(payload.width) || null,
        height: Number(payload.height) || null,
        cover: posterUrl,
        videoUrl: videoUrl ? { "720P": videoUrl } : {}
      },
      metrics: payload.metrics || payload.raw?.metrics || null,
      percentile: payload.percentile ?? payload.raw?.percentile ?? null,
      like: payload.like ?? payload.raw?.like ?? null,
      comment: payload.comment ?? payload.raw?.comment ?? null,
      share: payload.share ?? payload.forward ?? payload.raw?.share ?? payload.raw?.forward ?? null,
      ctr: payload.ctr ?? payload.raw?.ctr ?? null,
      cost: payload.cost ?? payload.raw?.cost ?? null,
      rawCandidate: payload.raw || null
    };
  }

  function buildTikTokDetailFromPayload(payload, sourceUrl, sourceAdId) {
    const posterUrl = normalizeText(payload.poster_url || payload.posterUrl || payload.coverUrl || payload.cover || payload.imageUrl);
    const videoUrl = normalizeText(payload.video_url || payload.videoUrl);
    const imageUrls = deps.normalizeStringArray(payload.image_urls || payload.imageUrls || payload.images || payload.image_urls_json);
    const engagement = deps.normalizeTikTokEngagement(payload.engagement || payload.raw?.engagement || payload);
    const title = normalizeText(payload.title || payload.caption || payload.description || payload.adTitle);
    const author = normalizeText(payload.author || payload.username || extractTikTokAuthor(sourceUrl));
    const authorAvatarUrl = normalizeText(payload.authorAvatarUrl || payload.author_avatar_url || payload.authorAvatar || payload.avatarUrl || payload.profileImageUrl || payload.avatar_url);
    const followerCount = firstNumeric(payload.followerCount, payload.follower_count, payload.followers, payload.fansCount, payload.authorFollowerCount, payload.authorFollowers);
    const canonicalUrl = normalizeText(payload.canonicalUrl || payload.canonical_url || sourceUrl);
    return {
      id: sourceAdId || extractTikTokVideoIdFromUrl(sourceUrl),
      canonicalUrl,
      adTitle: title,
      title,
      brandName: normalizeText(payload.brandName || payload.brand_name || payload.brand || payload.appName),
      author,
      authorAvatarUrl,
      followerCount,
      authorStats: payload.authorStats || payload.author_stats || null,
      appName: normalizeText(payload.appName || payload.app_name || payload.brandName || payload.brand_name),
      countryCode: deps.normalizeStringArray(payload.countryCode || payload.country_code),
      industryKey: normalizeText(payload.industryKey || payload.industry_key),
      objectiveKey: "",
      source: "TikTok 详情页",
      sourceKey: "tiktok_detail",
      duration: Number(payload.duration) || null,
      publishedText: normalizeText(payload.publishedText || payload.publishText || payload.createdText),
      videoInfo: {
        vid: normalizeText(payload.videoId || payload.video_id || sourceAdId || extractTikTokVideoIdFromUrl(sourceUrl)),
        duration: Number(payload.duration) || null,
        width: Number(payload.width) || null,
        height: Number(payload.height) || null,
        cover: posterUrl,
        videoUrl: videoUrl ? { "720P": videoUrl } : {}
      },
      imageUrls,
      metrics: {
        like: engagement.likeCount,
        comment: engagement.commentCount,
        share: engagement.shareCount,
        view: engagement.viewCount
      },
      percentile: null,
      like: engagement.likeCount,
      comment: engagement.commentCount,
      share: engagement.shareCount,
      forward: engagement.shareCount,
      view: engagement.viewCount,
      ctr: null,
      cost: null,
      rawCandidate: payload.raw || null
    };
  }

  function firstNumeric(...values) {
    const value = values.find((item) => Number.isFinite(Number(item)) && Number(item) >= 0);
    return value === undefined ? undefined : Number(value);
  }

  async function markAdShotCandidateImported({ candidateId, sourceAdId, shotId }) {
    if (!candidateId && !sourceAdId) {
      return;
    }
    const candidates = await deps.readAdShotCandidates();
    let changed = false;
    const updatedAt = deps.formatDate(new Date());
    const updated = candidates.map((candidate) => {
      const matchesCandidate = candidateId && candidate.id === candidateId;
      const matchesAdId = sourceAdId && candidate.sourceAdId === sourceAdId;
      if (!matchesCandidate && !matchesAdId) {
        return candidate;
      }
      changed = true;
      return {
        ...candidate,
        status: "imported",
        importedShotId: shotId,
        updatedAt
      };
    });
    if (changed) {
      await deps.writeAdShotCandidates(updated);
    }
  }

  async function copyAdShotLocalAsset(sourcePath, outputPath) {
    const fullSourcePath = path.resolve(sourcePath);
    const relative = path.relative(deps.projectRootDir, fullSourcePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("本地媒体路径必须位于当前 T2T 项目目录内。");
    }

    const stat = await fs.stat(fullSourcePath).catch(() => null);
    if (!stat?.isFile()) {
      throw new Error(`本地媒体文件不存在：${sourcePath}`);
    }

    await fs.copyFile(fullSourcePath, outputPath);
    return outputPath;
  }

  return {
    importAdShot
  };

  function normalizeText(value) {
    return deps.normalizeText(value);
  }

  function resolveLandingPage({ detail, payload }) {
    return normalizeText(
      detail?.landingPage
      || detail?.landing_page
      || detail?.raw?.landingPage
      || detail?.raw?.landing_page
      || payload?.landingPage
      || payload?.landing_page
      || payload?.raw?.landingPage
      || payload?.raw?.landing_page
    );
  }
}

export function normalizeTopAdsDetailUrl(value) {
  const text = normalizeModuleText(value);
  if (!text) {
    return "";
  }
  try {
    const url = new URL(text, "https://ads.tiktok.com");
    return url.href;
  } catch {
    return text;
  }
}

export function extractTopAdsIdFromUrl(value) {
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/\/topads\/([^/]+)/i);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

export function extractTikTokVideoIdFromUrl(value) {
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/\/(?:video|photo)\/(\d+)/i);
    return match ? match[1] : "";
  } catch {
    const match = String(value || "").match(/\/(?:video|photo)\/(\d+)/i);
    return match ? match[1] : "";
  }
}

export function buildTopAdsSourceUrl({ sourceUrl, canonicalUrl, sourceAdId }) {
  const canonical = normalizeModuleText(canonicalUrl);
  if (/ads\.tiktok\.com\/business\/creativecenter\/topads\/[^/]+\/pc\/en/i.test(canonical)) {
    return canonical;
  }
  const adId = normalizeModuleText(sourceAdId) || extractTopAdsIdFromUrl(canonical) || extractTopAdsIdFromUrl(sourceUrl);
  if (adId) {
    const period = (() => {
      for (const value of [canonical, sourceUrl]) {
        try {
          const parsed = new URL(value);
          return parsed.searchParams.get("period") || "";
        } catch {
          // Keep trying the next URL.
        }
      }
      return "";
    })();
    const url = new URL(`https://ads.tiktok.com/business/creativecenter/topads/${adId}/pc/en`);
    if (period) {
      url.searchParams.set("period", period);
    }
    return url.href;
  }
  return normalizeModuleText(sourceUrl) || canonical;
}

export function buildTikTokDetailSourceUrl({ sourceUrl, canonicalUrl, sourceAdId }) {
  for (const value of [canonicalUrl, sourceUrl]) {
    const text = normalizeModuleText(value);
    if (/tiktok\.com\/@[^/]+\/(?:video|photo)\/\d+/i.test(text)) {
      return normalizeSourceUrl(text);
    }
  }
  const author = extractTikTokAuthor(sourceUrl || canonicalUrl);
  const videoId = normalizeModuleText(sourceAdId);
  if (author && videoId) {
    return `https://www.tiktok.com/@${author}/video/${videoId}`;
  }
  return normalizeSourceUrl(sourceUrl || canonicalUrl);
}

function extractTopAdsDetailFromHtml(html) {
  const match = String(html || "").match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) {
    throw new Error("详情页没有找到 __NEXT_DATA__。");
  }
  const data = JSON.parse(decodeHtmlEntities(match[1]));
  const pageData = data?.props?.pageProps?.data;
  const detail = pageData?.baseDetail || pageData?.detail || null;
  if (!detail || typeof detail !== "object") {
    throw new Error("__NEXT_DATA__ 中没有找到 baseDetail。");
  }
  return {
    ...detail,
    metrics: pageData?.metrics ?? detail.metrics ?? null,
    percentile: pageData?.percentile ?? detail.percentile ?? null,
    canonicalUrl: pageData?.canonicalUrl || ""
  };
}

function pickTopAdsVideoUrl(videoInfo) {
  const urls = videoInfo?.videoUrl;
  if (typeof urls === "string") {
    return urls;
  }
  if (urls && typeof urls === "object") {
    return normalizeModuleText(urls["720P"] || urls["540P"] || urls.origin || Object.values(urls).find(Boolean));
  }
  return normalizeModuleText(videoInfo?.url || videoInfo?.playAddr);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  if (!response.ok) {
    throw new Error(`页面请求失败：HTTP ${response.status}`);
  }
  return response.text();
}

async function downloadAdShotAsset(url, outputPath, options = {}) {
  const referer = normalizeModuleText(options.referer) || "https://ads.tiktok.com/";
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      "Referer": referer
    }
  });
  if (!response.ok) {
    throw new Error(`媒体下载失败：HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) {
    throw new Error("媒体下载为空。");
  }
  await fs.writeFile(outputPath, buffer);
  return outputPath;
}

function extractTikTokAuthor(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/@([^/]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  } catch {
    const match = String(url || "").match(/\/@([^/]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }
}

function normalizeSourceUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (["t", "q", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].includes(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.searchParams.sort();
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").trim().replace(/\/$/, "");
  }
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&#x22;/gi, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/");
}

function normalizeModuleText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeInteractiveTimeAnalysis(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const tabs = Array.isArray(value.tabs)
    ? value.tabs.map((tab) => normalizeInteractiveMetricTab(tab)).filter(Boolean)
    : [];
  if (!tabs.length) {
    return null;
  }
  return {
    captureMode: normalizeModuleText(value.captureMode || value.capture_mode) || "ui_tab_rotation",
    capturedAt: normalizeModuleText(value.capturedAt || value.captured_at),
    activeTab: normalizeModuleText(value.activeTab || value.active_tab),
    tabOrder: Array.isArray(value.tabOrder)
      ? value.tabOrder.map((item) => normalizeModuleText(item)).filter(Boolean)
      : tabs.map((tab) => tab.label),
    tabs
  };
}

function normalizeInteractiveMetricTab(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const label = normalizeModuleText(value.label);
  if (!label) {
    return null;
  }
  return {
    key: normalizeModuleText(value.key) || label.toLowerCase(),
    label,
    activeLabel: normalizeModuleText(value.activeLabel || value.active_label) || label,
    infoText: normalizeModuleText(value.infoText || value.info_text),
    rankText: normalizeModuleText(value.rankText || value.rank_text),
    highlightSeconds: Array.isArray(value.highlightSeconds)
      ? value.highlightSeconds.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item >= 0)
      : [],
    chart: normalizeInteractiveMetricChart(value.chart)
  };
}

function normalizeInteractiveMetricChart(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const series = Array.isArray(value.series)
    ? value.series.map((item) => ({
        name: normalizeModuleText(item?.name),
        type: normalizeModuleText(item?.type),
        data: Array.isArray(item?.data) ? item.data : []
      }))
    : [];
  const xAxis = Array.isArray(value.xAxis) ? value.xAxis : [];
  const yAxis = Array.isArray(value.yAxis) ? value.yAxis : [];
  if (!series.length && !xAxis.length && !yAxis.length) {
    return null;
  }
  return { series, xAxis, yAxis };
}
