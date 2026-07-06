import {
  buildAdShotDetailViewModel
} from "./detail-view-model.mjs";

export function renderAdShotHtml(shot, options = {}) {
  const normalizeText = typeof options.normalizeText === "function" ? options.normalizeText : defaultNormalizeText;
  const normalizeVisualTextSegments = typeof options.normalizeVisualTextSegments === "function"
    ? options.normalizeVisualTextSegments
    : defaultNormalizeVisualTextSegments;
  const normalizeToPublicPath = typeof options.normalizeToPublicPath === "function"
    ? options.normalizeToPublicPath
    : defaultNormalizeToPublicPath;
  const viewModel = buildAdShotDetailViewModel(shot, {
    normalizeText,
    normalizeVisualTextSegments,
    normalizeToPublicPath
  });
  const {
    title,
    analysis,
    isTikTokDetail,
    isPhotoShot,
    shotUrl,
    heroTitle,
    heroSummary,
    originalTitle,
    regionSummary,
    speechSubtitleSegments,
    visualTextSegments,
    positionedVisualTextSegments,
    hasSubtitleOverlay,
    showAnalyzeButton,
    analyzeButtonLabel,
    analysisStatusNotice,
    mediaImagePaths,
    heroTags,
    metaItems,
    performanceItems,
    insightItems,
    performanceTitle,
    performanceNote,
    sourceItems,
    analysisEvents,
    showAnalysisProgress,
    analysisProgressLabel,
    analysisProgressMessage,
    analysisProgressAt,
    interactiveTimeAnalysis
  } = viewModel;
  const performanceItemsHtml = performanceItems.map((item) => `
          <div class="performance-card">
            <span>${escapeHtml(item.label)}</span>
            <b>${escapeHtml(item.value)}</b>
          </div>`).join("");
  const insightItemsHtml = insightItems.map((item) => `
            <div class="analysis-item">
              <b>${escapeHtml(item.label)}</b>
              ${item.lead ? `<strong>${escapeHtml(item.lead)}</strong>` : ""}
              ${item.body ? `<span>${escapeHtml(item.body)}</span>` : ""}
              ${item.paragraphs.length ? item.paragraphs.map((line) => `<p class="analysis-paragraph">${escapeHtml(line)}</p>`).join("") : ""}
              ${item.items.length ? `<ol class="analysis-list">${item.items.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>` : ""}
            </div>`).join("");
  const mediaHtml = shot.videoPath
    ? `<div class="video-stage"><video id="shot-video" controls playsinline preload="metadata" src="${escapeAttribute(shot.videoPath)}"${shot.posterPath ? ` poster="${escapeAttribute(shot.posterPath)}"` : ""}></video>${hasSubtitleOverlay ? `${positionedVisualTextSegments.length ? `<div id="visual-position-layer" class="visual-position-layer" aria-label="画面文字原位中文覆盖" hidden><div id="visual-position-overlay" class="visual-position-overlay"><span id="visual-position-subtitle"></span></div></div>` : ""}${speechSubtitleSegments.length ? `<div class="subtitle-overlay" aria-label="视频中文字幕"><p id="speech-subtitle" class="subtitle-line">${escapeHtml(speechSubtitleSegments[0])}</p></div>` : ""}` : ""}</div>`
    : mediaImagePaths.length
      ? `<div class="photo-gallery ${mediaImagePaths.length > 1 ? "multiple" : "single"}">${mediaImagePaths.map((imagePath, index) => `<img src="${escapeAttribute(imagePath)}" alt="${escapeAttribute(`素材图片 ${index + 1}`)}" loading="lazy" />`).join("")}</div>`
      : `<section class="card media-empty">${escapeHtml(isTikTokDetail ? "暂未缓存视频，分析时会通过 TikTok 来源 URL 重试。" : "没有缓存视频。")}</section>`;
  const heroTagsHtml = heroTags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const videoCardActionsHtml = `
          <div class="video-card-actions">
            <button id="favorite-shot" class="video-card-action" type="button" aria-label="收藏" title="收藏">☆</button>
            ${shot.sourceUrl ? `<a class="video-card-action" href="${escapeAttribute(shot.sourceUrl)}" target="_blank" rel="noreferrer" aria-label="原链接" title="原链接">🔗</a>` : ""}
            <button id="delete-shot" class="video-card-action danger" type="button" aria-label="删除" title="删除">🗑</button>
          </div>`;
  const analysisStatusNoticeHtml = analysisStatusNotice ? `
          <div id="analyze-status" class="analysis-status-inline"><span class="status-pill ${escapeAttribute(analysisStatusNotice.className)}">${escapeHtml(analysisStatusNotice.label)}</span><span class="analysis-status-copy">${escapeHtml(analysisStatusNotice.detail)}</span></div>` : "";
  const analysisProgressEventsHtml = analysisEvents.slice(-6).reverse().map((event) => `
              <li>
                <b>${escapeHtml(event.stageLabel || event.stageKey || "阶段更新")}</b>
                ${event.message ? `<span>${escapeHtml(event.message)}</span>` : ""}
                ${event.at ? `<time>${escapeHtml(event.at)}</time>` : ""}
              </li>`).join("");
  const analysisProgressHtml = `
          <div id="analysis-progress" class="analysis-progress ${escapeAttribute(shot.analysisStatus || "")}" aria-live="polite"${showAnalysisProgress ? "" : " hidden"}>
            <div class="analysis-progress-head">
              <b id="analysis-progress-stage">${escapeHtml(analysisProgressLabel || "等待开始")}</b>
              <time id="analysis-progress-time">${escapeHtml(analysisProgressAt)}</time>
            </div>
            <p id="analysis-progress-message">${escapeHtml(analysisProgressMessage || "等待服务端写入真实阶段。")}</p>
            <ol id="analysis-progress-events" class="analysis-events">
              ${analysisProgressEventsHtml || "<li><b>等待开始</b><span>点击开始分析后，这里会显示真实阶段事件。</span></li>"}
            </ol>
          </div>`;
  const metaItemsHtml = metaItems.map((item) => `
            <div class="meta">
              ${item.note ? `<button class="meta-info" type="button" aria-label="${escapeAttribute(item.note)}" data-tip="${escapeAttribute(item.note)}">i</button>` : ""}
              <span class="meta-title">${escapeHtml(item.label)}</span>
              <b>${escapeHtml(item.value || "未采集到")}</b>
            </div>`).join("");
  const sourceItemsHtml = sourceItems.map((item) => `
            <div class="source-item">
              <span>${escapeHtml(item.label)}</span>
              <b>${escapeHtml(item.value)}</b>
            </div>`).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} - T2T Ad Shot</title>
  <style>
    :root { --ink:#1f1c18; --muted:#6c6257; --line:rgba(45,35,23,.14); --paper:rgba(255,251,245,.90); --panel:rgba(255,255,255,.78); --accent:#0e7c66; --soft:#eef4f1; --shadow:0 18px 60px rgba(54,41,18,.10); }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; color:var(--ink); background:linear-gradient(135deg,#e8f2ef 0%,#f4ead9 52%,#efe6da 100%); font-family:"SF Pro SC","PingFang SC","Noto Sans SC",Arial,sans-serif; }
    a { color:var(--accent); text-decoration:none; font-weight:900; }
    main { width:min(1280px,calc(100vw - 32px)); margin:24px auto 48px; }
    .top-nav { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
    .brand { display:flex; align-items:baseline; gap:10px; min-width:0; }
    .brand b { font-size:24px; line-height:1; }
    .brand span { color:var(--muted); font-size:14px; font-weight:900; white-space:nowrap; }
    .breadcrumb { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:0 0 16px; color:var(--muted); font-size:13px; font-weight:900; }
    .breadcrumb a { display:inline-flex; align-items:center; min-height:30px; padding:0 10px; border:1px solid rgba(13,111,91,.14); border-radius:999px; background:rgba(255,255,255,.58); color:#095b4b; }
    .breadcrumb span[aria-hidden="true"] { color:rgba(108,98,87,.68); }
    .pill, button { display:inline-flex; align-items:center; justify-content:center; min-height:38px; padding:0 14px; border:1px solid rgba(13,111,91,.18); border-radius:999px; background:rgba(255,255,255,.72); color:#095b4b; font:inherit; font-size:13px; font-weight:900; cursor:pointer; }
    header, .content, .card { border:1px solid rgba(255,255,255,.62); border-radius:26px; background:var(--paper); box-shadow:var(--shadow); backdrop-filter:blur(14px); }
    header { position:relative; padding:18px 20px; margin-bottom:12px; }
    .eyebrow { margin:0 0 8px; color:#095b4b; text-transform:uppercase; letter-spacing:.14em; font-size:12px; font-weight:900; }
    h1 { margin:0; font-size:clamp(24px,3vw,34px); line-height:1.18; letter-spacing:0; }
    .lead { margin:12px 0 0; color:var(--muted); line-height:1.7; overflow-wrap:anywhere; }
    .hero-summary { max-width:920px; color:#50473f; font-size:16px; line-height:1.72; }
    .hero-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }
    .hero-copy { display:grid; gap:10px; min-width:0; }
    .tags { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
    .tag { display:inline-flex; align-items:center; min-height:30px; padding:0 10px; border:1px solid rgba(13,111,91,.12); border-radius:999px; background:rgba(232,244,240,.82); color:#095b4b; font-size:12px; font-weight:900; }
    .tag.region-tag { cursor:help; }
    .content { display:grid; grid-template-columns:minmax(280px,420px) minmax(0,1fr); gap:16px; padding:18px; }
    .video-wrap { display:grid; gap:12px; align-content:start; }
    .video-stage { position:relative; overflow:hidden; border-radius:22px; background:#111; box-shadow:0 18px 45px rgba(31,28,24,.14); }
    video { display:block; width:100%; max-height:78vh; background:#111; }
    .photo-gallery { display:grid; gap:10px; overflow:hidden; border-radius:22px; background:#14120f; box-shadow:0 18px 45px rgba(31,28,24,.14); padding:10px; }
    .photo-gallery img { display:block; width:100%; border-radius:14px; background:#111; object-fit:contain; max-height:72vh; }
    .photo-gallery.multiple { max-height:78vh; overflow:auto; }
    .media-empty { color:var(--muted); line-height:1.7; }
    .visual-position-layer { position:absolute; inset:0; pointer-events:none; z-index:3; }
    .visual-position-overlay { position:absolute; display:flex; align-items:center; justify-content:center; min-width:88px; min-height:30px; padding:5px 9px; border-radius:10px; background:rgba(255,255,255,.92); color:#111; text-align:center; text-shadow:none; font-size:clamp(12px,3.6vw,18px); line-height:1.22; font-weight:900; box-shadow:0 8px 22px rgba(0,0,0,.18); backdrop-filter:blur(5px); overflow:hidden; }
    .visual-position-overlay.plain { min-width:0; min-height:0; padding:2px 4px; border-radius:4px; background:rgba(255,255,255,.92); color:#111; box-shadow:0 4px 12px rgba(0,0,0,.14); backdrop-filter:blur(5px); text-shadow:none; }
    .visual-position-overlay span { display:block; max-width:100%; overflow-wrap:anywhere; }
    .subtitle-overlay { position:absolute; left:12px; right:12px; bottom:74px; display:flex; justify-content:center; pointer-events:none; z-index:2; }
    .subtitle-line { margin:0; width:fit-content; max-width:min(92%,360px); padding:7px 10px; border-radius:12px; color:#fff; text-align:center; text-shadow:0 1px 3px rgba(0,0,0,.75); font-size:14px; line-height:1.45; font-weight:850; backdrop-filter:blur(8px); }
    .subtitle-line { background:rgba(0,0,0,.68); }
    .subtitle-line:empty { display:none; }
    .subtitle-note { margin:0; color:var(--muted); font-size:13px; line-height:1.6; }
    .side { display:grid; gap:12px; align-content:start; }
    .card { padding:16px; box-shadow:none; background:var(--panel); border-color:var(--line); }
    .card h2 { margin:0 0 10px; font-size:18px; }
    .analysis-status-inline { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:0 0 12px; }
    .analysis-status-copy { color:var(--muted); font-size:13px; line-height:1.55; }
    .section-title { display:flex; align-items:center; gap:8px; margin:0 0 10px; }
    .section-title h2 { margin:0; }
    .meta-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .performance-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .meta { position:relative; border:1px solid rgba(45,35,23,.10); border-radius:14px; background:rgba(255,251,245,.72); padding:10px 34px 10px 10px; }
    .performance-card { min-height:84px; border:1px solid rgba(45,35,23,.08); border-radius:12px; background:rgba(255,251,245,.86); padding:14px 16px; display:flex; flex-direction:column; justify-content:center; gap:8px; }
    .meta-title { display:flex; align-items:center; gap:6px; color:var(--muted); font-size:12px; font-weight:900; }
    .meta span { display:block; color:var(--muted); font-size:12px; font-weight:900; }
    .meta b { display:block; margin-top:3px; overflow-wrap:anywhere; }
    .performance-card span { display:block; color:#7c7368; font-size:13px; font-weight:850; }
    .performance-card b { display:block; color:#1f1c18; font-size:26px; line-height:1; font-weight:900; overflow-wrap:anywhere; }
    .meta-info { position:absolute; top:10px; right:10px; display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; min-height:18px; padding:0; flex:0 0 auto; border:1px solid rgba(13,111,91,.28); border-radius:999px; color:#095b4b; background:rgba(255,255,255,.72); font-size:12px; line-height:1; font-weight:900; cursor:help; font-family:Georgia,"Times New Roman",serif; font-style:italic; }
    .section-title .meta-info { position:relative; top:auto; right:auto; }
    .meta-info::after { content:attr(data-tip); position:absolute; right:0; bottom:calc(100% + 8px); width:min(300px,70vw); padding:9px 10px; border-radius:10px; background:#17201d; color:#f8fbf8; box-shadow:0 14px 35px rgba(31,28,24,.20); font-size:12px; font-weight:700; line-height:1.55; white-space:normal; opacity:0; pointer-events:none; z-index:8; transition:opacity .14s ease; }
    .meta-info::before { content:""; position:absolute; right:4px; bottom:calc(100% + 3px); border:5px solid transparent; border-top-color:#17201d; opacity:0; transition:opacity .14s ease; }
    .meta-info:hover::after, .meta-info:focus-visible::after, .meta-info:hover::before, .meta-info:focus-visible::before { opacity:1; }
    .analysis { display:grid; gap:10px; }
    .analysis-item { border:1px solid rgba(45,35,23,.10); border-radius:14px; background:rgba(255,251,245,.72); padding:12px; }
    .analysis-item b { display:block; margin-bottom:4px; }
    .analysis-item strong { display:block; color:#1f1c18; font-size:15px; line-height:1.55; margin-bottom:6px; }
    .analysis-item span { color:#5f554b; font-size:14px; line-height:1.65; }
    .analysis-paragraph { margin:8px 0 0; color:#5f554b; font-size:14px; line-height:1.7; }
    .analysis-paragraph:first-of-type { margin-top:4px; }
    .analysis-list { margin:8px 0 0; padding-left:21px; color:#5f554b; font-size:14px; line-height:1.68; }
    .analysis-list li + li { margin-top:5px; }
    .analysis-progress { margin:12px 0; border:1px solid rgba(31,92,153,.16); border-radius:16px; background:#f1f7fc; padding:12px; color:#274861; }
    .analysis-progress[hidden] { display:none; }
    .analysis-progress.queued { border-color:rgba(13,111,91,.16); background:#eef8f4; color:#165c50; }
    .analysis-progress.failed { border-color:rgba(139,43,29,.18); background:#fff0ec; color:#743024; }
    .analysis-progress-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .analysis-progress-head b { color:inherit; font-size:14px; }
    .analysis-progress-head time { color:rgba(39,72,97,.72); font-size:12px; font-weight:850; white-space:nowrap; }
    .analysis-progress.failed .analysis-progress-head time { color:rgba(116,48,36,.72); }
    .analysis-progress p { margin:8px 0 0; color:inherit; font-size:13px; line-height:1.55; overflow-wrap:anywhere; }
    .analysis-events { display:grid; gap:6px; margin:10px 0 0; padding:0; list-style:none; }
    .analysis-events li { display:grid; grid-template-columns:minmax(86px,120px) minmax(0,1fr) auto; gap:8px; align-items:start; border-top:1px solid rgba(31,92,153,.10); padding-top:6px; font-size:12px; line-height:1.45; }
    .analysis-progress.failed .analysis-events li { border-top-color:rgba(139,43,29,.10); }
    .analysis-events li:first-child { border-top:0; padding-top:0; }
    .analysis-events b { color:inherit; font-size:12px; }
    .analysis-events span { color:#536a78; overflow-wrap:anywhere; }
    .analysis-progress.failed .analysis-events span { color:#7c564d; }
    .analysis-events time { color:rgba(83,106,120,.76); white-space:nowrap; }
    .source-grid { display:grid; gap:10px; }
    .source-item { border:1px solid rgba(45,35,23,.10); border-radius:14px; background:rgba(255,251,245,.72); padding:12px; color:#51483f; font-size:14px; line-height:1.65; }
    .source-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .source-item span { display:block; color:var(--muted); font-size:12px; font-weight:900; }
    .source-item b { display:block; margin-top:4px; color:#1f1c18; overflow-wrap:anywhere; }
    .metric-panel { border:1px solid rgba(45,35,23,.10); border-radius:14px; background:rgba(255,251,245,.72); padding:12px; display:grid; gap:12px; }
    .metric-tabs { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
    .metric-tab { display:inline-flex; align-items:center; min-height:32px; padding:0 12px; border:1px solid rgba(13,111,91,.16); border-radius:999px; background:rgba(255,255,255,.76); color:#095b4b; font-size:13px; font-weight:900; cursor:pointer; }
    .metric-tab.active { background:#0e7c66; border-color:#0e7c66; color:#fff; }
    .metric-tab-copy { display:grid; gap:8px; }
    .metric-tab-copy p { margin:0; color:#5f554b; font-size:14px; line-height:1.65; overflow-wrap:anywhere; }
    .metric-tab-copy b { color:#1f1c18; }
    .metric-rank { display:flex; flex-wrap:wrap; gap:8px; align-items:center; color:#1f1c18; font-size:14px; font-weight:900; }
    .metric-rank .labelBlackKey { color:#111; }
    .metric-chart { position:relative; border:1px solid rgba(45,35,23,.08); border-radius:12px; background:#fff; padding:12px; }
    .metric-chart svg { display:block; width:100%; height:auto; }
    .metric-chart-line { fill:none; stroke:#0e7c66; stroke-width:2.5; }
    .metric-chart-grid { stroke:rgba(31,28,24,.10); stroke-width:1; }
    .metric-chart-point { fill:#0e7c66; }
    .metric-empty { color:var(--muted); font-size:13px; line-height:1.6; }
    .status-pill { display:inline-flex; align-items:center; min-height:28px; width:fit-content; padding:0 10px; border-radius:999px; background:#e7f4ec; color:#095b4b; font-size:12px; font-weight:900; }
    .status-pill.queued { background:#e7f4ec; color:#095b4b; }
    .status-pill.running { background:#e7f0f8; color:#1f5c99; }
    .status-pill.failed { background:#ffe9e4; color:#8b2b1d; }
    .video-card-actions { display:flex; justify-content:center; gap:10px; margin-top:2px; }
    .video-card-action { display:inline-flex; align-items:center; justify-content:center; width:38px; height:38px; border:1px solid rgba(13,111,91,.18); border-radius:999px; background:rgba(255,255,255,.78); color:#095b4b; box-shadow:0 10px 24px rgba(54,41,18,.08); font-size:16px; line-height:1; }
    .video-card-action:hover { background:rgba(232,244,240,.92); }
    .video-card-action.danger { border-color:rgba(139,43,29,.18); color:#8b2b1d; }
    .video-card-action.danger:hover { background:rgba(255,233,228,.92); }
    ul { margin:8px 0 0; padding-left:20px; color:#5f554b; font-size:14px; line-height:1.7; }
    details { margin-top:10px; }
    summary { cursor:pointer; color:#095b4b; font-weight:900; }
    pre { max-height:360px; overflow:auto; white-space:pre-wrap; word-break:break-word; border-radius:14px; background:#16221f; color:#dcefe8; padding:12px; font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    .actions { display:flex; flex-wrap:wrap; gap:10px; }
    @media (max-width:860px) { main { width:min(100vw - 22px,1280px); margin-top:16px; } .top-nav { align-items:flex-start; flex-direction:column; } header, .content { border-radius:22px; } header { padding:18px; } .content { grid-template-columns:1fr; padding:14px; } .meta-grid, .source-grid { grid-template-columns:1fr; } h1 { font-size:26px; } video { max-height:none; } .subtitle-overlay { bottom:68px; left:10px; right:10px; } .subtitle-line { font-size:13px; } .visual-position-overlay { font-size:clamp(12px,4.2vw,17px); } }
  </style>
</head>
<body>
  <main>
    <nav class="top-nav" aria-label="页面导航">
      <div class="brand">
        <b>视频录入</b>
        <span>视频素材</span>
      </div>
      <div class="actions">
        ${showAnalyzeButton ? `<button id="analyze-shot" type="button"${!["queued", "running"].includes(shot.analysisStatus) ? "" : " disabled"}>${escapeHtml(analyzeButtonLabel)}</button>` : ""}
      </div>
    </nav>
    <nav class="breadcrumb" aria-label="面包屑">
      <a href="/">资料库</a>
      <span aria-hidden="true">/</span>
      <a href="/ingest">录入数据</a>
      <span aria-hidden="true">/</span>
      <a href="/ingest/video">视频录入</a>
      <span aria-hidden="true">/</span>
      <a href="/shots">Shots</a>
      <span aria-hidden="true">/</span>
      <span>${escapeHtml(heroTitle)}</span>
    </nav>
    <section class="content">
      <div class="video-wrap">
        ${mediaHtml}
        ${videoCardActionsHtml}
        <section class="card">
          <div class="section-title"><h2>${escapeHtml(performanceTitle)}</h2><button class="meta-info" type="button" aria-label="${escapeAttribute(performanceNote)}" data-tip="${escapeAttribute(performanceNote)}">i</button></div>
          <div class="performance-grid">${performanceItemsHtml}</div>
        </section>
      </div>
      <div class="side">
        <header>
          <div class="hero-head">
            <div class="hero-copy">
              <h1>${escapeHtml(heroTitle)}</h1>
              <div class="tags">${renderHeroTags(heroTags, regionSummary)}</div>
            </div>
          </div>
        </header>
        <section class="card">
          <h2>素材拆解</h2>
          ${analysisStatusNoticeHtml}
          ${analysisProgressHtml}
          <div class="analysis">
            ${insightItemsHtml}
          </div>
        </section>
        <section class="card">
          <h2>基础信息</h2>
          <div class="meta-grid">${metaItemsHtml}</div>
        </section>
        <section class="card">
          <h2>数据来源</h2>
          <div class="source-grid">${sourceItemsHtml}</div>
        </section>
        ${interactiveTimeAnalysis ? `
        <section class="card">
          <h2>互动时间分析</h2>
          <div id="metric-analysis" class="metric-panel">
            <div class="metric-tabs">
              ${interactiveTimeAnalysis.tabs.map((tab, index) => `
                <button type="button" class="metric-tab${index === 0 ? " active" : ""}" data-metric-tab="${escapeAttribute(tab.key || tab.label)}">${escapeHtml(tab.label)}</button>`).join("")}
            </div>
            <div class="metric-tab-copy">
              <div class="metric-rank" id="metric-rank"></div>
              <p id="metric-info"></p>
              <div class="metric-chart" id="metric-chart"></div>
            </div>
          </div>
        </section>` : ""}
        <section class="card">
          <details>
            <summary>技术信息</summary>
            <p class="lead">${escapeHtml(shot.shotId)} · ${escapeHtml(shot.sourceAdId || "")}</p>
            <div class="actions">
              ${shot.detailPath ? `<a class="pill" href="${escapeAttribute(shot.detailPath)}" target="_blank" rel="noreferrer">原始 JSON</a>` : ""}
              ${shot.htmlPath ? `<a class="pill" href="${escapeAttribute(shot.htmlPath)}" target="_blank" rel="noreferrer">页面 HTML</a>` : ""}
            </div>
            <details>
              <summary>查看原始字段</summary>
              <pre>${escapeHtml(JSON.stringify(shot, null, 2))}</pre>
            </details>
          </details>
        </section>
      </div>
    </section>
  </main>
  <script>
    const subtitleSegments = ${jsonForInlineScript(speechSubtitleSegments)};
    const visualTextSegments = ${jsonForInlineScript(positionedVisualTextSegments)};
    const fallbackDuration = ${Number(shot.duration) || 0};
    const video = document.getElementById("shot-video");
    const speechSubtitle = document.getElementById("speech-subtitle");
    const visualPositionLayer = document.getElementById("visual-position-layer");
    const visualPositionOverlay = document.getElementById("visual-position-overlay");
    const visualPositionText = document.getElementById("visual-position-subtitle");
    const shotId = ${JSON.stringify(shot.shotId)};
    const interactiveTimeAnalysis = ${jsonForInlineScript(interactiveTimeAnalysis || null)};
    let analysisPollTimer = null;
    let analysisPolling = false;
    let analysisReloading = false;
    function currentVideoDuration() {
      return Number.isFinite(video?.duration) && video.duration > 0 ? video.duration : fallbackDuration;
    }
    function updateSpeechSubtitle() {
      if (!video || !speechSubtitle || !subtitleSegments.length) return;
      const duration = currentVideoDuration();
      const ratio = duration > 0 ? Math.min(.999, Math.max(0, video.currentTime / duration)) : 0;
      const index = Math.min(subtitleSegments.length - 1, Math.floor(ratio * subtitleSegments.length));
      speechSubtitle.textContent = subtitleSegments[index] || "";
    }
    function updateVisualSubtitle() {
      if (!video || !visualTextSegments.length) return;
      const currentTime = Math.max(0, video.currentTime || 0);
      const active = visualTextSegments.find((segment) => currentTime >= Number(segment.start) && currentTime <= Number(segment.end));
      if (!active) {
        hidePositionedVisualSubtitle();
        return;
      }
      if (hasVisualTextBBox(active)) {
        showPositionedVisualSubtitle(active);
        return;
      }
      hidePositionedVisualSubtitle();
    }
    function hasVisualTextBBox(segment) {
      const bbox = segment?.bbox;
      return Boolean(bbox && Number.isFinite(Number(bbox.x)) && Number.isFinite(Number(bbox.y)) && Number.isFinite(Number(bbox.w)) && Number.isFinite(Number(bbox.h)));
    }
    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }
    function showPositionedVisualSubtitle(segment) {
      if (!visualPositionLayer || !visualPositionOverlay || !visualPositionText) return;
      const contentRect = getVideoContentRect();
      if (!contentRect) {
        hidePositionedVisualSubtitle();
        return;
      }
      const bbox = segment.bbox;
      const overlayWidth = clamp(Math.max(Number(bbox.w), 0.26), 0.12, 0.94);
      const overlayHeight = clamp(Math.max(Number(bbox.h), 0.04), 0.035, 0.22);
      const centerX = Number(bbox.x) + Number(bbox.w) / 2;
      const centerY = Number(bbox.y) + Number(bbox.h) / 2;
      const left = clamp(centerX - overlayWidth / 2, 0.02, 0.98 - overlayWidth);
      const top = clamp(centerY - overlayHeight / 2, 0.02, 0.98 - overlayHeight);
      visualPositionOverlay.style.left = (contentRect.x + left * contentRect.width) + "px";
      visualPositionOverlay.style.top = (contentRect.y + top * contentRect.height) + "px";
      visualPositionOverlay.style.width = (overlayWidth * contentRect.width) + "px";
      visualPositionOverlay.style.minHeight = (overlayHeight * contentRect.height) + "px";
      visualPositionOverlay.classList.toggle("plain", segment.overlayMode === "plain");
      visualPositionText.textContent = segment.zh || "";
      visualPositionLayer.hidden = false;
    }
    function getVideoContentRect() {
      if (!video || !visualPositionLayer) return null;
      const stage = video.closest(".video-stage");
      const layerRect = (stage || visualPositionLayer).getBoundingClientRect();
      const videoRect = video.getBoundingClientRect();
      if (!layerRect.width || !layerRect.height || !videoRect.width || !videoRect.height) return null;
      const intrinsicWidth = Number(video.videoWidth) || 0;
      const intrinsicHeight = Number(video.videoHeight) || 0;
      let contentWidth = videoRect.width;
      let contentHeight = videoRect.height;
      let contentLeft = videoRect.left - layerRect.left;
      let contentTop = videoRect.top - layerRect.top;
      if (intrinsicWidth > 0 && intrinsicHeight > 0) {
        const intrinsicRatio = intrinsicWidth / intrinsicHeight;
        const elementRatio = videoRect.width / videoRect.height;
        if (elementRatio > intrinsicRatio) {
          contentWidth = videoRect.height * intrinsicRatio;
          contentLeft += (videoRect.width - contentWidth) / 2;
        } else if (elementRatio < intrinsicRatio) {
          contentHeight = videoRect.width / intrinsicRatio;
          contentTop += (videoRect.height - contentHeight) / 2;
        }
      }
      return {
        x: contentLeft,
        y: contentTop,
        width: contentWidth,
        height: contentHeight
      };
    }
    function hidePositionedVisualSubtitle() {
      if (!visualPositionLayer || !visualPositionText) return;
      visualPositionLayer.hidden = true;
      visualPositionText.textContent = "";
    }
    function updateTimedSubtitles() {
      updateSpeechSubtitle();
      updateVisualSubtitle();
    }
    video?.addEventListener("loadedmetadata", updateTimedSubtitles);
    video?.addEventListener("timeupdate", updateTimedSubtitles);
    video?.addEventListener("seeked", updateTimedSubtitles);
    video?.addEventListener("play", updateTimedSubtitles);
    window.addEventListener("resize", updateTimedSubtitles);
    updateSpeechSubtitle();
    updateVisualSubtitle();
    renderInteractiveMetricAnalysis();
    document.getElementById("favorite-shot")?.addEventListener("click", () => {
      const button = document.getElementById("favorite-shot");
      if (!button) return;
      const active = button.textContent === "★";
      button.textContent = active ? "☆" : "★";
    });
    document.getElementById("delete-shot")?.addEventListener("click", async () => {
      if (!window.confirm("确认删除这条素材吗？")) {
        return;
      }
      const button = document.getElementById("delete-shot");
      if (button) {
        button.disabled = true;
      }
      try {
        const response = await fetch("/api/ad-shots/" + encodeURIComponent(shotId), { method: "DELETE" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "删除失败。");
        }
        location.href = "/shots";
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "删除失败。");
        if (button) {
          button.disabled = false;
        }
      }
    });
    function renderAnalysisProgress(shot) {
      const box = document.getElementById("analysis-progress");
      if (!box || !shot) return;
      const status = shot.analysisStatus || "";
      const progress = shot.analysisProgress && typeof shot.analysisProgress === "object" ? shot.analysisProgress : {};
      const events = Array.isArray(shot.analysisEvents) ? shot.analysisEvents : [];
      const latestEvent = events[events.length - 1] || {};
      const visible = status === "queued" || status === "running" || status === "failed";
      box.hidden = !visible;
      box.classList.toggle("queued", status === "queued");
      box.classList.toggle("running", status === "running");
      box.classList.toggle("failed", status === "failed");
      document.getElementById("analysis-progress-stage").textContent = progress.stageLabel || latestEvent.stageLabel || shot.analysisStage || (status === "failed" ? "分析异常" : status === "queued" ? "排队中" : "分析中");
      document.getElementById("analysis-progress-time").textContent = progress.updatedAt || latestEvent.at || shot.updatedAt || "";
      document.getElementById("analysis-progress-message").textContent = progress.message || latestEvent.message || shot.analysisError || "等待服务端写入真实阶段。";
      const list = document.getElementById("analysis-progress-events");
      if (list) {
        list.replaceChildren();
        const recentEvents = events.slice(-6).reverse();
        if (!recentEvents.length) {
          const item = document.createElement("li");
          const label = document.createElement("b");
          const message = document.createElement("span");
          label.textContent = "等待开始";
          message.textContent = "请求已发出，等待服务端写入第一条真实阶段。";
          item.append(label, message);
          list.append(item);
        } else {
          for (const event of recentEvents) {
            const item = document.createElement("li");
            const label = document.createElement("b");
            const message = document.createElement("span");
            const at = document.createElement("time");
            label.textContent = event.stageLabel || event.stageKey || "阶段更新";
            message.textContent = event.message || "";
            at.textContent = event.at || "";
            item.append(label, message, at);
            list.append(item);
          }
        }
      }

      const statusLine = document.getElementById("analyze-status");
      if (statusLine && visible) {
        statusLine.textContent = status === "failed"
          ? "分析异常：" + (shot.analysisError || progress.message || "可以重新生成。")
          : status === "queued"
            ? "排队中：" + (progress.message || latestEvent.message || "等待开始处理")
            : "分析中：" + (progress.stageLabel || latestEvent.stageLabel || "等待阶段更新");
      }
    }
    function stopAnalysisPolling() {
      if (analysisPollTimer) {
        clearInterval(analysisPollTimer);
        analysisPollTimer = null;
      }
    }
    async function refreshAnalysisProgress() {
      if (analysisPolling || analysisReloading) return;
      analysisPolling = true;
      try {
        const response = await fetch("/api/ad-shots/" + encodeURIComponent(shotId));
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "进度刷新失败。");
        }
        renderAnalysisProgress(payload);
        const button = document.getElementById("analyze-shot");
        if (payload.analysisStatus === "completed") {
          stopAnalysisPolling();
          analysisReloading = true;
          location.reload();
          return;
        }
        if (payload.analysisStatus === "failed") {
          stopAnalysisPolling();
          if (button) {
            button.disabled = false;
            button.textContent = "重试分析";
          }
        }
      } catch (error) {
        const box = document.getElementById("analysis-progress");
        const message = document.getElementById("analysis-progress-message");
        if (box && message) {
          box.hidden = false;
          message.textContent = error instanceof Error ? error.message : "进度刷新失败。";
        }
      } finally {
        analysisPolling = false;
      }
    }
    function startAnalysisPolling() {
      if (!analysisPollTimer) {
        analysisPollTimer = setInterval(refreshAnalysisProgress, 2000);
      }
      refreshAnalysisProgress();
    }
    function renderInteractiveMetricAnalysis() {
      const panel = document.getElementById("metric-analysis");
      if (!panel || !interactiveTimeAnalysis?.tabs?.length) return;
      const rankEl = document.getElementById("metric-rank");
      const infoEl = document.getElementById("metric-info");
      const chartEl = document.getElementById("metric-chart");
      const tabs = Array.from(panel.querySelectorAll("[data-metric-tab]"));
      const byKey = new Map(interactiveTimeAnalysis.tabs.map((item) => [item.key || item.label, item]));
      const fallbackKey = interactiveTimeAnalysis.activeTab || interactiveTimeAnalysis.tabs[0].key || interactiveTimeAnalysis.tabs[0].label;
      function renderTab(key) {
        const item = byKey.get(key) || interactiveTimeAnalysis.tabs[0];
        tabs.forEach((node) => node.classList.toggle("active", node.getAttribute("data-metric-tab") === (item.key || item.label)));
        if (rankEl) {
          rankEl.innerHTML = '<span class="labelBlackKey">' + escapeHtml(item.label) + '</span><span>' + escapeHtml(item.rankText || "已采集") + '</span>';
        }
        if (infoEl) {
          infoEl.textContent = item.infoText || "已采集";
        }
        if (chartEl) {
          chartEl.innerHTML = renderMetricChartSvg(item.chart);
        }
      }
      tabs.forEach((node) => {
        node.addEventListener("click", () => renderTab(node.getAttribute("data-metric-tab") || fallbackKey));
      });
      renderTab(fallbackKey);
    }
    function renderMetricChartSvg(chart) {
      const series = chart?.series?.[0]?.data || [];
      if (!Array.isArray(series) || !series.length) {
        return '<div class="metric-empty">暂无图表数据</div>';
      }
      const values = series.map((value) => Number(Array.isArray(value) ? value[1] : value)).filter((value) => Number.isFinite(value));
      if (!values.length) {
        return '<div class="metric-empty">暂无图表数据</div>';
      }
      const width = 820;
      const height = 260;
      const pad = 28;
      const max = Math.max(...values);
      const min = Math.min(...values);
      const range = Math.max(1, max - min);
      const pts = values.map((value, index) => {
        const x = pad + (index * (width - pad * 2)) / Math.max(1, values.length - 1);
        const y = height - pad - ((value - min) / range) * (height - pad * 2);
        return { x, y };
      });
      const d = pts.map((pt, index) => (index ? 'L' : 'M') + pt.x.toFixed(1) + ',' + pt.y.toFixed(1)).join(' ');
      const grid = [0, 1, 2, 3].map((i) => {
        const y = pad + i * ((height - pad * 2) / 3);
        return '<line class="metric-chart-grid" x1="' + pad + '" y1="' + y + '" x2="' + (width - pad) + '" y2="' + y + '"></line>';
      }).join("");
      const points = pts.map((pt) => '<circle class="metric-chart-point" cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="4"></circle>').join("");
      return '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="互动时间分析图表"><g>' + grid + '</g><path class="metric-chart-line" d="' + d + '"></path>' + points + '</svg>';
    }
    if (["queued", "running"].includes(${JSON.stringify(shot.analysisStatus)})) {
      startAnalysisPolling();
    }
    document.getElementById("analyze-shot")?.addEventListener("click", () => {
      const button = document.getElementById("analyze-shot");
      let status = document.getElementById("analyze-status");
      if (!status) {
        status = document.createElement("p");
        status.id = "analyze-status";
        status.className = "lead";
        button.closest("main")?.querySelector(".side .card h2")?.after(status);
      }
      button.disabled = true;
      button.textContent = "分析中";
      renderAnalysisProgress({
        analysisStatus: "queued",
        analysisProgress: {
          stageLabel: "排队等待",
          message: "请求已发出，正在加入分析队列。",
          updatedAt: new Date().toLocaleString("zh-CN", { hour12: false })
        },
        analysisEvents: []
      });
      startAnalysisPolling();
      fetch("/api/ad-shots/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shotId })
      }).then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "分析失败。");
        }
        if (payload.analysisStatus === "completed") {
          analysisReloading = true;
          location.reload();
        } else {
          renderAnalysisProgress(payload);
          refreshAnalysisProgress();
        }
      }).catch((error) => {
        status.textContent = error instanceof Error ? error.message : "分析失败。";
        button.disabled = false;
        button.textContent = "重试分析";
        refreshAnalysisProgress();
      });
    });
  </script>
</body>
</html>`;
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

function jsonForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}


function defaultNormalizeVisualTextSegments(items) {
  return Array.isArray(items) ? items : [];
}

function defaultNormalizeToPublicPath(value) {
  return defaultNormalizeText(value);
}

function renderHeroTags(tags = [], regionSummary = {}) {
  return tags.map((tag) => {
    const isRegion = regionSummary?.shortLabel && tag === regionSummary.shortLabel && regionSummary.fullLabel;
    return `<span class="tag${isRegion ? " region-tag" : ""}"${isRegion ? ` title="${escapeAttribute(regionSummary.fullLabel)}"` : ""}>${escapeHtml(tag)}</span>`;
  }).join("");
}

function defaultNormalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
