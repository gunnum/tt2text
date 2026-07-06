import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function createTikTokService(deps = {}) {
  const requiredDeps = [
    "readResults",
    "writeResults",
    "readComments",
    "writeComments",
    "createJobId",
    "formatDate",
    "normalizeText",
    "normalizeVideoUrl"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createTikTokService 缺少依赖：${dep}`);
    }
  }

  const hasAdShotStorage = typeof deps.readAdShots === "function" && typeof deps.writeAdShots === "function";
  const tiktokCommentsMediaDir = deps.runtimeConfig?.paths?.tiktokCommentsMediaDir || "";
  const normalizeToPublicPath = typeof deps.normalizeToPublicPath === "function"
    ? deps.normalizeToPublicPath
    : (value) => value;
  const ensureDir = typeof deps.ensureDir === "function"
    ? deps.ensureDir
    : async (dir) => fs.mkdir(dir, { recursive: true });

  async function importTikTokComments(body = {}) {
    const sourceUrl = normalizeText(body.sourceUrl || body.url || "");
    if (!sourceUrl) {
      throw new Error("缺少 TikTok 视频链接。");
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const normalizedRawItems = rawItems.map(normalizeTikTokComment).filter(hasTikTokCommentContent);
    const normalizedUrl = deps.normalizeVideoUrl(sourceUrl);
    const results = await deps.readResults();
    const resultIndex = results.findIndex((item) => {
      return [item.sourceUrl, item.hyperlink]
        .filter(Boolean)
        .some((value) => deps.normalizeVideoUrl(value) === normalizedUrl);
    });
    const result = resultIndex >= 0 ? results[resultIndex] : null;
    const adShotMatch = hasAdShotStorage ? await findMatchingAdShot(normalizedUrl) : null;
    const importedAt = deps.formatDate(new Date());
    const recordId = existingCommentRecordId(await deps.readComments(), normalizedUrl) || deps.createJobId();
    const itemsWithMedia = await persistTikTokCommentMedia({
      items: normalizedRawItems,
      recordId,
      sourceUrl,
      importedAt
    });
    const items = dedupeTikTokComments(itemsWithMedia);
    const commentsRaw = {
      schema: "tt2text.tiktok_comments.v1",
      source: "tiktok",
      sourceUrl,
      normalizedUrl,
      resultId: result?.id || adShotMatch?.shotId || normalizeText(body.resultId || ""),
      appId: result?.appId || adShotMatch?.appId || normalizeText(body.appId || ""),
      videoTitle: result?.title || adShotMatch?.title || normalizeText(body.videoTitle || ""),
      capturedAt: importedAt,
      requestedExpandCount: Number(body.requestedExpandCount || 0),
      actualExpandCount: Number(body.actualExpandCount || 0),
      itemCount: items.length,
      items
    };

    const records = await deps.readComments();
    const existingIndex = records.findIndex((record) => deps.normalizeVideoUrl(record.sourceUrl) === normalizedUrl);
    const record = {
      id: existingIndex >= 0 ? records[existingIndex].id : recordId,
      ...commentsRaw,
      importedAt,
      updatedAt: importedAt
    };
    if (existingIndex >= 0) {
      records[existingIndex] = record;
    } else {
      records.unshift(record);
    }
    await deps.writeComments(records);

    if (resultIndex >= 0) {
      results[resultIndex] = {
        ...results[resultIndex],
        commentsRaw,
        commentInsights: [],
        updatedAt: importedAt
      };
      await deps.writeResults(results);
    }
    if (adShotMatch) {
      await attachCommentsToAdShot(adShotMatch.shotId, commentsRaw, importedAt);
    }

    return {
      ...record,
      matchedResultId: result?.id || "",
      matchedAdShotId: adShotMatch?.shotId || "",
      matched: Boolean(result || adShotMatch)
    };
  }

  async function findMatchingAdShot(normalizedUrl) {
    const shots = await deps.readAdShots();
    return shots.find((item) => {
      return [
        item.sourceUrl,
        item.canonicalUrl,
        item.raw?.sourceUrl
      ]
        .filter(Boolean)
        .some((value) => deps.normalizeVideoUrl(value) === normalizedUrl);
    }) || null;
  }

  async function attachCommentsToAdShot(shotId, commentsRaw, importedAt) {
    const shots = await deps.readAdShots();
    const index = shots.findIndex((item) => item.shotId === shotId);
    if (index < 0) {
      return;
    }
    shots[index] = {
      ...shots[index],
      commentsRaw,
      commentInsights: [],
      updatedAt: importedAt
    };
    await deps.writeAdShots(shots);
  }

  function normalizeTikTokComment(item = {}) {
    const text = normalizeText(item.text || item.comment || "");
    const author = normalizeText(item.author || item.username || "");
    const media = normalizeCommentMedia(item.media || item.images || item.imageUrls);
    return {
      id: normalizeText(item.id || `${author}:${text}`).slice(0, 180),
      author,
      text,
      likeText: normalizeText(item.likeText || ""),
      likeCount: normalizeNullableCount(item.likeCount ?? item.likes ?? item.likeText),
      timeText: normalizeText(item.timeText || item.createdText || ""),
      replyCountText: normalizeText(item.replyCountText || ""),
      replyCount: normalizeNullableCount(item.replyCount ?? item.replyCountText),
      language: normalizeText(item.language || ""),
      rawText: normalizeText(item.rawText || text).slice(0, 1000),
      media,
      hasMedia: media.length > 0
    };
  }

  function dedupeTikTokComments(items) {
    const seen = new Set();
    const deduped = [];
    for (const item of items) {
      const mediaKey = Array.isArray(item.media)
        ? item.media.map((media) => media.localPath || media.sourceUrl).filter(Boolean).join("|")
        : "";
      const key = `${item.author.toLowerCase()}::${item.text.toLowerCase()}::${mediaKey}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(item);
    }
    return deduped;
  }

  function hasTikTokCommentContent(item) {
    return Boolean(item?.text || item?.rawText || item?.media?.length);
  }

  function existingCommentRecordId(records, normalizedUrl) {
    const record = Array.isArray(records)
      ? records.find((item) => deps.normalizeVideoUrl(item.sourceUrl) === normalizedUrl)
      : null;
    return record?.id || "";
  }

  function normalizeCommentMedia(value) {
    const rawItems = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? [value]
        : [];
    const seen = new Set();
    return rawItems.map((item) => {
      const source = typeof item === "string" ? { sourceUrl: item } : item || {};
      const type = normalizeText(source.type || "image").toLowerCase();
      const sourceUrl = normalizeText(source.sourceUrl || source.url || source.src || source.imageUrl || "");
      const dataUrl = normalizeText(source.dataUrl || source.dataURL || "");
      if (type !== "image" || (!sourceUrl && !dataUrl)) {
        return null;
      }
      const key = sourceUrl || dataUrl.slice(0, 120);
      if (seen.has(key)) {
        return null;
      }
      seen.add(key);
      return {
        type: "image",
        sourceUrl,
        dataUrl,
        alt: normalizeText(source.alt || ""),
        width: normalizeNullableCount(source.width),
        height: normalizeNullableCount(source.height),
        localPath: normalizeText(source.localPath || ""),
        analysisStatus: normalizeText(source.analysisStatus || ""),
        analysis: source.analysis && typeof source.analysis === "object" ? source.analysis : null
      };
    }).filter(Boolean).slice(0, 6);
  }

  async function persistTikTokCommentMedia({ items, recordId, sourceUrl, importedAt }) {
    if (!tiktokCommentsMediaDir) {
      return items;
    }
    const recordDir = path.join(tiktokCommentsMediaDir, safeSegment(recordId));
    await ensureDir(recordDir);
    const output = [];
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex];
      if (!item.media?.length) {
        output.push(item);
        continue;
      }
      const media = [];
      for (let mediaIndex = 0; mediaIndex < item.media.length; mediaIndex += 1) {
        const mediaItem = item.media[mediaIndex];
        const persisted = await persistOneCommentImage({
          mediaItem,
          recordDir,
          itemIndex,
          mediaIndex,
          sourceUrl,
          comment: item,
          importedAt
        });
        media.push(persisted);
      }
      output.push({
        ...item,
        media,
        hasMedia: media.length > 0
      });
    }
    return output;
  }

  async function persistOneCommentImage({ mediaItem, recordDir, itemIndex, mediaIndex, sourceUrl, comment, importedAt }) {
    const base = {
      ...mediaItem,
      dataUrl: undefined,
      analysisStatus: mediaItem.analysisStatus || "pending",
      capturedAt: importedAt
    };
    try {
      const downloaded = await readCommentImageBytes(mediaItem);
      if (!downloaded?.bytes?.length) {
        throw new Error("未能读取评论图片。");
      }
      const ext = imageExtension(mediaItem.sourceUrl, downloaded.contentType, downloaded.bytes);
      const filename = `comment-${String(itemIndex + 1).padStart(3, "0")}-image-${String(mediaIndex + 1).padStart(2, "0")}${ext}`;
      const fullPath = path.join(recordDir, filename);
      await fs.writeFile(fullPath, downloaded.bytes);
      const localPath = normalizeToPublicPath(fullPath);
      const analysis = await analyzeCommentImage({
        localPath,
        fullPath,
        sourceUrl,
        comment,
        mediaItem,
        importedAt
      });
      return {
        ...base,
        localPath,
        bytes: downloaded.bytes.length,
        contentType: downloaded.contentType || "",
        analysisStatus: analysis.status,
        analysis
      };
    } catch (error) {
      return {
        ...base,
        analysisStatus: "failed",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async function readCommentImageBytes(mediaItem) {
    if (mediaItem.dataUrl) {
      const parsed = parseDataUrl(mediaItem.dataUrl);
      if (parsed) {
        return parsed;
      }
    }
    if (!mediaItem.sourceUrl) {
      return null;
    }
    const response = await fetch(mediaItem.sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 TT2Text/1.0",
        "Referer": "https://www.tiktok.com/"
      }
    });
    if (!response.ok) {
      throw new Error(`下载评论图片失败：HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      bytes,
      contentType: response.headers.get("content-type") || ""
    };
  }

  function parseDataUrl(dataUrl) {
    const match = String(dataUrl || "").match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i);
    if (!match) {
      return null;
    }
    return {
      bytes: Buffer.from(match[2], "base64"),
      contentType: match[1] || ""
    };
  }

  async function analyzeCommentImage({ fullPath, localPath, sourceUrl, comment, mediaItem, importedAt }) {
    const apiKey = await readAgnesApiKey();
    if (!apiKey) {
      return {
        status: "skipped",
        skippedReason: "AGNES_API_KEY 或 TT2TEXT_AGNES_API_KEY 未配置。",
        analyzedAt: importedAt
      };
    }
    const baseUrl = normalizeText(process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.com/v1").replace(/\/+$/, "");
    const model = normalizeText(process.env.TT2TEXT_COMMENT_VISION_MODEL || process.env.TT2TEXT_AGNES_VISION_MODEL || "agnes-1.5-flash");
    try {
      const payload = await requestCommentImageVision({
        baseUrl,
        apiKey,
        model,
        imageDataUrl: await imageDataUrl(fullPath),
        sourceUrl,
        comment,
        mediaItem
      });
      return {
        status: "completed",
        model,
        analyzedAt: deps.formatDate(new Date()),
        localPath,
        ...payload
      };
    } catch (error) {
      return {
        status: "failed",
        model,
        analyzedAt: deps.formatDate(new Date()),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async function readAgnesApiKey() {
    const envKey = normalizeText(process.env.AGNES_API_KEY || process.env.TT2TEXT_AGNES_API_KEY);
    if (envKey) {
      return envKey;
    }
    try {
      const { stdout } = await execFileAsync("security", ["find-generic-password", "-a", "default", "-s", "agnes-ai", "-w"], {
        timeout: 3000
      });
      return normalizeText(stdout);
    } catch {
      return "";
    }
  }

  async function requestCommentImageVision({ baseUrl, apiKey, model, imageDataUrl, sourceUrl, comment, mediaItem }) {
    const prompt = [
      "你是 TikTok 评论区图片反馈分析助手。请只返回严格 JSON。",
      "目标：判断这张评论图片作为真实用户反馈有什么意义，而不是泛泛描述图片。",
      `视频链接：${sourceUrl || ""}`,
      `评论作者：${comment.author || ""}`,
      `评论文字：${comment.text || comment.rawText || ""}`,
      `图片 alt：${mediaItem.alt || ""}`,
      "返回 JSON 字段：summaryZh, feedbackType, sentiment, userSignal, productContext, evidence, ocrText, adInsight, riskNotes。",
      "feedbackType 可取：usage_proof, result_showcase, bug_report, meme_reaction, comparison, question, other。",
      "sentiment 可取：positive, neutral, negative, mixed, unclear。"
    ].join("\n");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "你是严谨的多模态用户反馈分析助手，只返回严格 JSON，不输出代码块。" },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageDataUrl } }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 1400,
        response_format: { type: "json_object" }
      })
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    }
    return parseAiJson(body?.choices?.[0]?.message?.content || "");
  }

  async function imageDataUrl(fullPath) {
    const bytes = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  }

  function parseAiJson(value) {
    const text = normalizeText(value);
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return { raw: text };
      try {
        return JSON.parse(match[0]);
      } catch {
        return { raw: text };
      }
    }
  }

  function imageExtension(url, contentType, bytes) {
    const content = normalizeText(contentType).toLowerCase();
    if (content.includes("png")) return ".png";
    if (content.includes("webp")) return ".webp";
    if (content.includes("jpeg") || content.includes("jpg")) return ".jpg";
    const ext = path.extname(URLSafePath(url)).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return ext === ".jpeg" ? ".jpg" : ext;
    if (bytes?.[0] === 0x89 && bytes?.[1] === 0x50) return ".png";
    if (bytes?.slice(0, 4).toString("ascii") === "RIFF") return ".webp";
    return ".jpg";
  }

  function URLSafePath(url) {
    try {
      return new URL(url).pathname;
    } catch {
      return String(url || "");
    }
  }

  function safeSegment(value) {
    return normalizeText(value)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 100) || "comments";
  }

  function normalizeTikTokEngagement(source = {}) {
    const likeCount = normalizeNullableCount(source.likeCount ?? source.likes ?? source.diggCount ?? source.heartCount);
    const commentCount = normalizeNullableCount(source.commentCount ?? source.comments ?? source.replyCount ?? source.replies);
    const shareCount = normalizeNullableCount(source.shareCount ?? source.shares);
    const viewCount = normalizeNullableCount(source.viewCount ?? source.views ?? source.playCount);
    return {
      likeCount,
      likeText: normalizeText(source.likeText || source.likesText || source.diggText || ""),
      commentCount,
      commentText: normalizeText(source.commentText || source.commentsText || source.replyText || ""),
      shareCount,
      shareText: normalizeText(source.shareText || source.sharesText || ""),
      viewCount,
      viewText: normalizeText(source.viewText || source.viewsText || source.playText || ""),
      source: normalizeText(source.source || "tiktok-search")
    };
  }

  function mergeTikTokEngagement(primary = {}, fallback = {}) {
    const normalizedPrimary = normalizeTikTokEngagement(primary);
    const normalizedFallback = normalizeTikTokEngagement(fallback);
    return {
      likeCount: normalizedPrimary.likeCount ?? normalizedFallback.likeCount,
      likeText: normalizedPrimary.likeText || normalizedFallback.likeText,
      commentCount: normalizedPrimary.commentCount ?? normalizedFallback.commentCount,
      commentText: normalizedPrimary.commentText || normalizedFallback.commentText,
      shareCount: normalizedPrimary.shareCount ?? normalizedFallback.shareCount,
      shareText: normalizedPrimary.shareText || normalizedFallback.shareText,
      viewCount: normalizedPrimary.viewCount ?? normalizedFallback.viewCount,
      viewText: normalizedPrimary.viewText || normalizedFallback.viewText,
      source: normalizedPrimary.source || normalizedFallback.source || "tiktok-search"
    };
  }

  function normalizeNullableCount(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
    }
    const text = normalizeText(value).replace(/,/g, "");
    const match = text.match(/^(\d+(?:\.\d+)?)([KMB万千])?$/i);
    if (!match) {
      return null;
    }
    const number = Number(match[1]);
    if (!Number.isFinite(number)) {
      return null;
    }
    const unit = match[2]?.toLowerCase() || "";
    const multiplier = unit === "k"
      ? 1_000
      : unit === "m"
        ? 1_000_000
        : unit === "b"
          ? 1_000_000_000
          : unit === "万"
            ? 10_000
            : unit === "千"
              ? 1_000
              : 1;
    return Math.max(0, Math.round(number * multiplier));
  }

  function normalizePublishedDate(value) {
    const text = normalizeText(value);
    if (!text) {
      return "";
    }
    const ymd = text.match(/^(20\d{2})-?(\d{2})-?(\d{2})$/);
    if (ymd) {
      return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
    }
    const ym = text.match(/^(20\d{2})-?(\d{2})$/);
    if (ym) {
      return `${ym[1]}-${ym[2]}-01`;
    }
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return "";
  }

  function extractTikTokAuthor(url) {
    const match = String(url || "").match(/tiktok\.com\/@([^/]+)/i);
    return match ? match[1] : "";
  }

  function normalizeText(value) {
    return deps.normalizeText(value);
  }

  return {
    importTikTokComments,
    normalizeTikTokComment,
    dedupeTikTokComments,
    normalizeTikTokEngagement,
    mergeTikTokEngagement,
    normalizeNullableCount,
    normalizePublishedDate,
    extractTikTokAuthor
  };
}
