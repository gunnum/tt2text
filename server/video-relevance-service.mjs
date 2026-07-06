export function createVideoRelevanceService(deps = {}) {
  const requiredDeps = [
    "runJsonTask",
    "normalizeText",
    "truncateText",
    "formatDate"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createVideoRelevanceService 缺少依赖：${dep}`);
    }
  }

  const timeoutMs = Number(deps.timeoutMs) || 90_000;

  async function assessVideoRelevance({ app, title, sourceUrl, transcriptEn, transcriptZh } = {}) {
    const fallback = {
      status: "unknown",
      isRelevant: null,
      confidence: 0,
      reason: "相关性尚未判断。",
      checkedAt: deps.formatDate(new Date())
    };

    const sourceText = deps.normalizeText([
      `App: ${app?.name || ""}`,
      `Video URL: ${sourceUrl || ""}`,
      `Title: ${title || ""}`,
      `Original transcript: ${deps.truncateText(transcriptEn, 6000)}`,
      `Chinese transcript: ${deps.truncateText(transcriptZh, 6000)}`
    ].join("\n"));

    if (!sourceText || (!transcriptEn && !transcriptZh && !title)) {
      return fallback;
    }

    const prompt = [
      "You are classifying whether a TikTok/YouTube video is useful research material for the specified mobile app.",
      "Use the video title and transcript. Be strict: the primary target is app-specific research, not generic topic collection.",
      "Return JSON only in this exact shape:",
      "{\"status\":\"relevant|irrelevant|uncertain\",\"isRelevant\":true,\"confidence\":0.0,\"reason\":\"short Chinese reason\"}",
      "",
      "Classification guide:",
      "- relevant: directly about the exact app, its official/creator marketing, or a clearly same-core-function competitor/use case with concrete insight.",
      "- irrelevant: unrelated person/name/meme/music/content, generic platform chatter, or broad category content without a concrete connection to the app's core function.",
      "- uncertain: there are weak signals but not enough evidence after title/transcript.",
      "",
      "Do not mark content relevant just because it mentions a parent company, a broad platform, a generic category word, or a similar name.",
      "",
      sourceText
    ].join("\n");

    try {
      const content = await deps.runJsonTask(prompt, timeoutMs);
      const payload = JSON.parse(extractJsonObject(content));
      return normalizeRelevancePayload(payload);
    } catch (error) {
      return {
        ...fallback,
        reason: `相关性判断失败：${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  function normalizeRelevancePayload(payload) {
    const status = ["relevant", "irrelevant", "uncertain"].includes(payload?.status)
      ? payload.status
      : payload?.isRelevant === true
        ? "relevant"
        : payload?.isRelevant === false
          ? "irrelevant"
          : "uncertain";
    return {
      status,
      isRelevant: status === "relevant" ? true : status === "irrelevant" ? false : null,
      confidence: Math.max(0, Math.min(1, Number(payload?.confidence) || 0)),
      reason: deps.truncateText(deps.normalizeText(payload?.reason), 240) || "LLM 未提供原因。",
      checkedAt: deps.formatDate(new Date())
    };
  }

  function extractJsonObject(content) {
    const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    if (text.startsWith("{") && text.endsWith("}")) {
      return text;
    }
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("找不到 JSON 对象。");
    }
    return match[0];
  }

  return {
    assessVideoRelevance
  };
}
