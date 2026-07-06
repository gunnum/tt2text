export function requestChromeExtension(type, payload, options = {}) {
  return new Promise((resolve, reject) => {
    const requestId = `tt2text-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(options.timeoutMessage || "没有收到 Chrome 插件响应。"));
    }, options.timeoutMs || 20000);

    function cleanup() {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    }

    function onMessage(event) {
      if (event.source !== window || event.data?.source !== "tt2text-extension" || event.data?.requestId !== requestId) {
        return;
      }
      cleanup();
      if (event.data.ok) {
        resolve(event.data.payload);
      } else {
        reject(new Error(event.data.error || "Chrome 插件调用失败。"));
      }
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ source: "tt2text-web", type, requestId, payload }, window.location.origin);
  });
}

export function formatChromeExtensionError(message) {
  const text = String(message || "");
  if (/Extension context invalidated/i.test(text)) {
    return "Chrome 插件刚重新加载，当前页面还连着旧上下文。刷新页面后重试。";
  }
  return text || "Chrome 插件调用失败。";
}
