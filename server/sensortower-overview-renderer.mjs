export function renderSensorTowerOverviewHtml({ appName, app, sourceUrl, pageTitle, overview, pageText, collectedAt }) {
  const safeOverview = overview && typeof overview === "object" ? overview : {};
  const topCountriesByPlatform = safeOverview.topCountriesByPlatform && typeof safeOverview.topCountriesByPlatform === "object"
    ? safeOverview.topCountriesByPlatform
    : {};
  const iapRows = asArray(safeOverview.inAppPurchases).map((item) => `
      <tr>
        <td>${escapeHtml(item.title)}</td>
        <td>${escapeHtml(item.duration)}</td>
        <td>${escapeHtml(item.price)}</td>
      </tr>`).join("");
  const screenshotItems = asArray(safeOverview.screenshots).map((item) => `
      <a class="screenshot-link" href="${escapeAttribute(item.imageUrl || item.thumbnailUrl)}">
        <img src="${escapeAttribute(item.thumbnailUrl || item.imageUrl)}" alt="${escapeAttribute(item.alt || "App screenshot")}" />
      </a>`).join("");
  const cardItems = asArray(safeOverview.cards).map((card) => `<pre>${escapeHtml(card)}</pre>`).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(appName)} SensorTower Overview</title>
  <style>
    :root { color-scheme: light; --ink:#18212f; --muted:#637089; --line:#dbe3ee; --soft:#f5f8fc; --accent:#0c7f73; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif; color:var(--ink); background:#eef3f8; }
    main { max-width:1120px; margin:0 auto; padding:32px; }
    header { display:flex; gap:16px; align-items:center; padding:24px; border:1px solid var(--line); border-radius:24px; background:white; }
    .logo { width:64px; height:64px; border-radius:16px; object-fit:cover; background:var(--soft); }
    h1 { margin:0; font-size:28px; }
    h2 { margin:0 0 14px; font-size:18px; }
    a { color:var(--accent); text-decoration:none; }
    .muted { color:var(--muted); }
    .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; margin-top:18px; }
    .card { padding:20px; border:1px solid var(--line); border-radius:22px; background:white; }
    .wide { grid-column:1 / -1; }
    .label { color:var(--muted); font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
    .value { margin-top:8px; font-size:18px; font-weight:800; }
    .chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
    .chip { padding:7px 10px; border-radius:999px; background:#e8f4f2; color:#096f65; font-size:13px; font-weight:700; }
    table { width:100%; border-collapse:collapse; overflow:hidden; border-radius:16px; }
    th,td { padding:10px 12px; border-bottom:1px solid var(--line); text-align:left; font-size:14px; }
    th { color:var(--muted); background:var(--soft); }
    pre { white-space:pre-wrap; word-break:break-word; padding:14px; border-radius:16px; background:var(--soft); color:#314057; font-size:13px; line-height:1.55; }
    .description { white-space:pre-wrap; line-height:1.7; }
    .screenshots { display:flex; gap:12px; overflow-x:auto; padding-bottom:4px; }
    .screenshot-link { flex:0 0 160px; border:1px solid var(--line); border-radius:18px; overflow:hidden; background:var(--soft); }
    .screenshot-link img { display:block; width:100%; height:346px; object-fit:cover; object-position:top center; }
    @media (max-width:820px) { main { padding:18px; } .grid { grid-template-columns:1fr; } header { align-items:flex-start; } }
  </style>
</head>
<body>
  <main>
    <header>
      ${app?.logoUrl ? `<img class="logo" src="${escapeAttribute(app.logoUrl)}" alt="${escapeAttribute(appName)} logo" />` : `<div class="logo"></div>`}
      <div>
        <p class="label">SensorTower Overview Archive</p>
        <h1>${escapeHtml(appName)}</h1>
        <p class="muted">${escapeHtml(pageTitle)} · ${escapeHtml(collectedAt)}</p>
        <p><a href="${escapeAttribute(sourceUrl)}">打开原始 SensorTower 页面</a></p>
      </div>
    </header>

    <section class="grid">
      ${renderOverviewStat("类别", safeOverview.category)}
      ${renderOverviewStat("App IQ", safeOverview.appIq)}
      ${renderOverviewStat("全球发布", safeOverview.globalReleaseDate)}
      <section class="card">
        <p class="label">变现分析</p>
        ${renderChips(safeOverview.monetization)}
      </section>
      <section class="card">
        <p class="label">热门国家/地区</p>
        ${renderChips(safeOverview.topCountries)}
      </section>
      <section class="card">
        <p class="label">分平台热门国家</p>
        <p class="muted">iOS</p>${renderChips(topCountriesByPlatform.ios)}
        <p class="muted">Android</p>${renderChips(topCountriesByPlatform.android)}
      </section>

      <section class="card wide">
        <h2>应用内购商品</h2>
        <table>
          <thead><tr><th>标题</th><th>时长</th><th>价格</th></tr></thead>
          <tbody>${iapRows || `<tr><td colspan="3" class="muted">未采集到应用内购商品</td></tr>`}</tbody>
        </table>
      </section>

      <section class="card wide">
        <h2>截图&媒体</h2>
        <div class="screenshots">${screenshotItems || `<p class="muted">未采集到 iPhone 截图。</p>`}</div>
      </section>

      <section class="card wide">
        <h2>描述 / Feature</h2>
        ${renderChips(safeOverview.featureKeywords)}
        <p class="description">${escapeHtml(safeOverview.description || "未采集到描述。")}</p>
      </section>

      <section class="card wide">
        <h2>原始卡片摘录</h2>
        ${cardItems || `<p class="muted">无摘录。</p>`}
      </section>

      <section class="card wide">
        <h2>页面文本兜底</h2>
        <pre>${escapeHtml(pageText)}</pre>
      </section>
    </section>
  </main>
</body>
</html>`;
}

function renderOverviewStat(label, value) {
  return `<section class="card"><p class="label">${escapeHtml(label)}</p><p class="value">${escapeHtml(value || "未采集到")}</p></section>`;
}

function renderChips(items) {
  const values = asArray(items);
  return `<div class="chips">${values.length ? values.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("") : `<span class="muted">未采集到</span>`}</div>`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
