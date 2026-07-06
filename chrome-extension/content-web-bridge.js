window.addEventListener("message", async (event) => {
  const allowedTypes = new Set([
    "TT2TEXT_IMPORT_TIKTOK_SEARCH",
    "TT2TEXT_IMPORT_TIKTOK_COMMENTS_BATCH",
    "TT2TEXT_CLEAR_TIKTOK_STATUS"
  ]);
  if (event.source !== window || event.data?.source !== "tt2text-web" || !allowedTypes.has(event.data?.type)) {
    return;
  }

  const requestId = event.data.requestId;
  try {
    const response = await chrome.runtime.sendMessage({
      type: event.data.type,
      payload: event.data.payload
    });
    window.postMessage({
      source: "tt2text-extension",
      requestId,
      ok: Boolean(response?.ok),
      payload: response?.payload,
      error: response?.error || ""
    }, window.location.origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    window.postMessage({
      source: "tt2text-extension",
      requestId,
      ok: false,
      error: /Extension context invalidated/i.test(message)
        ? "Chrome 插件刚刚重新加载，当前 TT2Text 页面仍连接着旧插件上下文。请刷新 http://localhost:3000/ 后重试批量录入。"
        : message
    }, window.location.origin);
  }
});
