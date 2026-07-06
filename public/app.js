// Legacy compatibility shim.
// The old all-in-one homepage controller now lives in /legacy/app-legacy.js.
// Keep this path so any manual or cached references do not hard-fail.
window.console?.warn?.("[legacy] /app.js has moved to /legacy/app-legacy.js and is kept only as a compatibility shim.");

const legacyScript = document.createElement("script");
legacyScript.src = "/legacy/app-legacy.js";
document.head.appendChild(legacyScript);
