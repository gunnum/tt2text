import { escapeAttribute, escapeHtml, formatNumber } from "./formatters.js";
import { showToast } from "../core/ui.js";

export function renderHighlightCards(el, { highlights = [], meta = {} } = {}) {
  if (!el) return;
  el.innerHTML = `
    <span id="lessons"></span>
    <div class="section-head">
      <div>
        <p class="eyebrow">Highlights</p>
        <h2>高互动视频分析</h2>
      </div>
      <p class="helper-text">最多取 15 条高互动视频；单列卡片展示视频封面、互动数据、浓缩剧情和镜头节奏时间轴。</p>
    </div>
    <div class="highlight-relation-note">
      <b>怎么读这张卡：</b>
      <span>剧情简介 = 一句话讲完整视频；镜头节奏 = 按时间段看视频怎么推进，带 Hook 标签的段落就是负责抓停用户的开头。</span>
    </div>
    <p class="helper-text">${escapeHtml(formatHighlightProviderNote(meta))}</p>
    <div class="highlight-grid">
      ${highlights.length ? highlights.map(renderHighlightBreakdownCard).join("") : '<div class="video-job-empty">还没有缓存高互动视频分析。</div>'}
    </div>
  `;
  bindImageFallbacks(el);
}

export function bindCopyIdButtons({ toastEl } = {}) {
  document.querySelectorAll("[data-copy-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.copyId || "";
      if (!id) {
        showToast(toastEl, "没有可复制的视频 ID。");
        return;
      }
      try {
        await navigator.clipboard.writeText(id);
        showToast(toastEl, `已复制视频 ID：${id}`);
      } catch {
        showToast(toastEl, "复制失败，请手动复制卡片 ID。");
      }
    });
  });
}

function formatHighlightProviderNote(meta = {}) {
  if (meta.provider === "local-codex") return `已为 ${meta.count || 0} 条视频补充垂类点评；分镜事实来自视频详情分析。`;
  if (meta.error) return `垂类点评生成失败，当前保留视频详情中的基础分镜：${meta.error}`;
  return "当前展示视频详情中的基础分镜，暂无额外垂类点评。";
}

function renderHighlightBreakdownCard(item = {}) {
  const scenes = Array.isArray(item.highlightScenes) ? item.highlightScenes : [];
  const metrics = item.metrics || {};
  return `
    <article class="highlight-card" data-video-id="${escapeAttribute(item.id || "")}">
      <div class="highlight-card-titlebar">
        <div>
          <h3>${renderHighlightTitle(item)}</h3>
          ${renderAppSubtitle(item)}
        </div>
        <button class="copy-id-button" type="button" data-copy-id="${escapeAttribute(item.id || "")}" title="复制视频 ID">复制 ID</button>
      </div>
      <div class="highlight-card-body">
        <div class="highlight-media-group">
          ${renderVideoThumbButton(item)}
          <div class="metrics-line compact">
            <span>赞 ${escapeHtml(formatNumber(metrics.likeCount))}</span>
            <span>评论 ${escapeHtml(formatNumber(metrics.commentCount))}</span>
            <span>收藏 ${escapeHtml(formatNumber(metrics.saveCount))}</span>
            <span>分享 ${escapeHtml(formatNumber(metrics.shareCount))}</span>
          </div>
          ${renderAccountCard(item)}
        </div>
        <div class="highlight-story-group">
          <p class="highlight-win"><b>剧情简介</b><br />${escapeHtml(condenseStorySummary(item))}</p>
          <div class="highlight-scenes">
            <div class="highlight-scenes-head">
              <b>镜头节奏</b>
              <small>按时间段看完整剧情如何推进。</small>
            </div>
            ${scenes.length ? scenes.map((scene, index) => renderHighlightScene(scene, index, item)).join("") : "<section><p>这条视频还没有完成基础分镜分析。</p></section>"}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderHighlightScene(scene = {}, index = 0, item = {}) {
  const framePath = scene.framePath || getFramePathForScene(item, index);
  const fallbackPaths = getCoverPaths(item, [framePath]);
  const isHook = isHookScene(scene, index, item);
  return `
    <section>
      ${framePath ? `
        <button class="highlight-scene-frame" type="button" data-play-video="${escapeAttribute(item.id || "")}" aria-label="播放 ${escapeAttribute(item.title || "视频")}">
          <img src="${escapeAttribute(framePath)}" alt="${escapeAttribute(`分镜 ${index + 1} 截图`)}" loading="lazy" data-fallback-src-list="${escapeAttribute(JSON.stringify(fallbackPaths))}" />
        </button>
      ` : ""}
      <div class="highlight-scene-copy">
        <div class="highlight-scene-title">
          <b>${escapeHtml(formatSceneMoment(scene, index))}</b>
          ${isHook ? '<span class="highlight-hook-tag">Hook</span>' : ""}
        </div>
        <p>${escapeHtml(condenseSceneText(scene.scene || scene.why || item.storySummary || ""))}</p>
        ${scene.why || isHook ? `<small><b>垂类判断：</b>${escapeHtml(scene.why || formatHookNote(scene, item))}</small>` : ""}
        ${scene.learn ? `<small><b>可复用：</b>${escapeHtml(scene.learn)}</small>` : ""}
      </div>
    </section>
  `;
}

function condenseStorySummary(item = {}) {
  const text = normalizeSpace(item.storySummary || item.summary || "");
  const title = normalizeSpace(item.title || "");
  return shortenSentence(text || title || "这条视频需要回看后补充一句话剧情。", 96);
}

function formatSceneMoment(scene = {}, index = 0) {
  const start = Number(scene.start);
  const end = Number(scene.end);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return `${formatSecond(start)}-${formatSecond(end)}s${index === 0 ? " 抓停开场" : ""}`;
  }
  const raw = normalizeSpace(scene.moment || "");
  if (/0-?3|开头|hook/i.test(raw)) return "0-3s 抓停开场";
  if (/中段|证明|产品|功能/i.test(raw)) return index === 1 ? "3-18s 场景/产品证明" : raw;
  if (/结尾|CTA|行动|收尾/i.test(raw)) return raw;
  const fallback = ["0-3s 抓停开场", "3-18s 场景/产品证明", "18s+ 结果承诺/CTA"];
  return raw || fallback[index] || `片段 ${index + 1}`;
}

function formatSecond(value) {
  const number = Number(Number(value || 0).toFixed(2));
  return Number.isInteger(number) ? String(number) : String(number);
}

function isHookScene(scene = {}, index = 0, item = {}) {
  const text = normalizeSpace([scene.moment, scene.scene, item.hook].filter(Boolean).join(" "));
  return index === 0 || /0-?3|开头|hook|抓停|痛点|反差/i.test(text);
}

function formatHookNote(scene = {}, item = {}) {
  const hook = (Array.isArray(item.hooks) ? item.hooks : []).find((entry) => entry?.grab);
  return shortenSentence(scene.why || hook?.grab || "用具体人物、场景、动作或结果让用户继续看。", 90);
}

function condenseSceneText(value = "") {
  const text = normalizeSpace(value)
    .replace(/^镜头\s*\d+[:：]\s*/i, "")
    .replace(/^画面\/段落[:：]\s*/, "");
  return shortenSentence(text, 72);
}

function shortenSentence(value = "", maxLength = 80) {
  const text = normalizeSpace(value);
  if (text.length <= maxLength) return text;
  const chunks = text.split(/[。！？.!?]/).map((item) => item.trim()).filter(Boolean);
  const first = chunks.find((item) => item.length >= 8) || text;
  return first.length <= maxLength ? `${first}。` : `${first.slice(0, maxLength - 1)}…`;
}

function normalizeSpace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getFramePathForScene(item = {}, index = 0) {
  const frames = Array.isArray(item.framePaths) ? item.framePaths.filter(Boolean) : [];
  return frames[index] || frames[0] || inferVisualFramePath(item.id, index) || item.posterPath || "";
}

function inferVisualFramePath(videoId, index = 0) {
  const id = String(videoId || "").trim();
  if (!id) return "";
  const frameNumber = String(Math.max(1, index + 1)).padStart(2, "0");
  const second = Math.max(0, index);
  return `/data/ad-shots/${encodeURIComponent(id)}/analysis/visual-frames/frame-${frameNumber}-${second}.00s.jpg`;
}

function bindImageFallbacks(root = document) {
  root.querySelectorAll("img[data-fallback-src-list]").forEach((image) => {
    let paths = [];
    try {
      paths = JSON.parse(image.dataset.fallbackSrcList || "[]");
    } catch {}
    let index = Math.max(0, paths.indexOf(image.getAttribute("src") || ""));
    image.addEventListener("error", () => {
      index += 1;
      const nextPath = paths[index] || "";
      if (nextPath) image.src = nextPath;
      else image.remove();
    });
  });
}

function renderAppSubtitle(item = {}) {
  const appName = item.appName || "未标注 App";
  return `
    <p class="highlight-app-subtitle">
      ${item.appLogoUrl ? `<img src="${escapeAttribute(item.appLogoUrl)}" alt="" loading="lazy" />` : '<span class="highlight-app-logo-fallback">App</span>'}
      <span>${escapeHtml(appName)}</span>
    </p>
  `;
}

function renderAccountCard(item = {}) {
  const accountName = item.authorName || "未知账号";
  const avatarUrl = item.authorAvatarUrl || item.authorAvatar || item.accountAvatarUrl || item.profileImageUrl || "";
  const followerCount = firstNonEmpty(item.followerCount, item.followers, item.fansCount, item.authorFollowerCount, item.authorFollowers);
  return `
    <div class="highlight-account-card">
      ${avatarUrl ? `<img class="highlight-account-avatar" src="${escapeAttribute(avatarUrl)}" alt="" loading="lazy" />` : '<div class="highlight-account-avatar is-empty">号</div>'}
      <div class="highlight-account-main">
        <b>${escapeHtml(accountName)}</b>
        <span>${escapeHtml(item.accountType || "账号类型未识别")}</span>
      </div>
      <div class="highlight-account-stat">
        <small>粉丝</small>
        <b>${escapeHtml(followerCount ? formatNumber(followerCount) : "未采集")}</b>
      </div>
    </div>
  `;
}

function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function renderHighlightTitle(item = {}) {
  const title = escapeHtml(item.title || "未命名视频");
  if (!item.shotUrl) return title;
  return `<a href="${escapeAttribute(item.shotUrl)}" target="_blank" rel="noreferrer">${title}</a>`;
}

function renderVideoThumbButton(item = {}) {
  const coverPaths = getCoverPaths(item);
  const coverPath = coverPaths[0] || "";
  const canPlay = Boolean(item.videoPath || coverPath);
  if (!canPlay) {
    return item.shotUrl ? `<a class="video-thumb-link" href="${escapeAttribute(item.shotUrl)}" target="_blank" rel="noreferrer">打开详情</a>` : '<div class="video-thumb-empty">暂无封面</div>';
  }
  return `
    <button class="video-thumb-button" type="button" data-play-video="${escapeAttribute(item.id || "")}" aria-label="播放 ${escapeAttribute(item.title || "视频")}">
      ${coverPath ? `<img src="${escapeAttribute(coverPath)}" alt="" loading="lazy" data-fallback-src-list="${escapeAttribute(JSON.stringify(coverPaths))}" />` : "<span>播放</span>"}
    </button>
  `;
}

function getCoverPaths(item = {}, preferred = []) {
  return Array.from(new Set([
    ...preferred,
    ...(Array.isArray(item.coverPaths) ? item.coverPaths : []),
    ...(Array.isArray(item.framePaths) ? item.framePaths : []),
    inferVisualFramePath(item.id, 0),
    item.posterPath
  ].map((value) => String(value || "").trim()).filter(Boolean)));
}
