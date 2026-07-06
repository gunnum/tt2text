import { escapeAttribute, escapeHtml, shortenText } from "./formatters.js";
import { showToast } from "../core/ui.js";

let videoScriptPromptIndex = new Map();

export function normalizeStrategy(detail = {}) {
  const strategy = detail.strategy || {};
  const categoryLabel = detail.category?.label || "垂类";
  const isReadingLike = /读书|阅读|听书|书|learning|book/i.test(categoryLabel);
  return {
    ...strategy,
    appAccountVideoTypes: hasItems(strategy.appAccountVideoTypes)
      ? strategy.appAccountVideoTypes
      : buildFallbackAppAccountVideoTypes(categoryLabel, isReadingLike),
    creatorContentVideoTypes: hasItems(strategy.creatorContentVideoTypes)
      ? strategy.creatorContentVideoTypes
      : buildFallbackCreatorContentVideoTypes(categoryLabel, isReadingLike)
  };
}

export function resetVideoScriptPromptIndex() {
  videoScriptPromptIndex = new Map();
}

export function renderVideoTypes(el, items = []) {
  if (!el) return;
  el.innerHTML = `
    <span id="video-types"></span>
    <div class="section-head">
      <div>
        <p class="eyebrow">Video Types</p>
        <h2>App 账号适合做的视频类型</h2>
      </div>
      <p class="helper-text">App 账号更适合承担产品证明、功能路径和转化承接，不需要每条都做成泛知识内容。</p>
    </div>
    <div class="video-type-grid">
      ${items.map((item, index) => renderVideoTypeCard(item, index, "app")).join("")}
    </div>
  `;
}

export function renderCreatorContentVideoTypes(el, items = []) {
  if (!el) return;
  if (!Array.isArray(items)) items = [];
  el.innerHTML = `
    <span id="content-account"></span>
    <div class="section-head">
      <div>
        <p class="eyebrow">Creator & Content</p>
        <h2>网红&内容号适合做的视频类型</h2>
      </div>
      <p class="helper-text">网红和内容号优先建立真实语境、观点信任和收藏动机，再把 App 作为自然承接。</p>
    </div>
    <div class="video-type-grid">
      ${items.map((item, index) => renderVideoTypeCard(item, index, "creator")).join("")}
    </div>
  `;
}

export function bindScriptCopyButtons({ toastEl } = {}) {
  document.querySelectorAll(".copy-video-script").forEach((button) => {
    button.addEventListener("click", async () => {
      const scriptId = button.dataset.scriptId || "";
      const text = videoScriptPromptIndex.get(scriptId) || "";
      if (!text) {
        showToast(toastEl, "没有可复制的脚本生成 Prompt。");
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        showToast(toastEl, "脚本生成 Prompt 已复制。");
      } catch {
        showToast(toastEl, "复制失败，请手动选中文本复制。");
      }
    });
  });
}

function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function renderVideoTypeCard(item = {}, index = 0, group = "app") {
  const scenes = Array.isArray(item.scenes) ? item.scenes : [];
  const scriptId = `${group}-${index}`;
  const fullScript = buildFullScriptText(item);
  videoScriptPromptIndex.set(scriptId, fullScript);
  return `
    <article class="video-type-card">
      <div class="video-type-card-head">
        <h3>${index + 1}. ${escapeHtml(item.title || "未命名视频类型")}</h3>
        <button class="video-job-action secondary copy-video-script" type="button" data-script-id="${escapeAttribute(scriptId)}">复制脚本生成 Prompt</button>
      </div>
      <p><b>适合账号：</b>${escapeHtml(item.account || "未标注账号")}</p>
      <p><b>主题：</b>${escapeHtml(item.topic || item.title || "")}</p>
      <p><b>BGM：</b>${escapeHtml(item.bgm || "轻节奏背景音乐，音量低于人声")}</p>
      <p><b>脚本概括：</b>${escapeHtml(shortenText(item.scriptSummary || item.script || "", 120))}</p>
      <p><b>画面概括：</b>${escapeHtml(shortenText(item.visualSummary || item.visual || "", 120))}</p>
      ${scenes.length ? renderScenePreview(scenes) : ""}
      <div class="badge-row">${(item.badges || []).map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`).join("")}</div>
    </article>
  `;
}

function renderScenePreview(scenes = []) {
  return `
    <div class="scene-preview">
      ${scenes.slice(0, 3).map((scene) => `
        <p><b>${escapeHtml(scene.time || "分镜")}</b>${escapeHtml(scene.visual || "")}${scene.line ? `｜${escapeHtml(scene.line)}` : ""}</p>
      `).join("")}
    </div>
  `;
}

function buildFullScriptText(item = {}) {
  if (item.videoScriptPrompt) return item.videoScriptPrompt;
  if (item.fullScript) return item.fullScript;
  const scenes = Array.isArray(item.scenes) ? item.scenes : [];
  return [
    "你是短视频广告脚本策划，请基于下面的素材方向，生成一条可以直接进入生产环节的竖屏短视频脚本。",
    "",
    "【基础信息】",
    `- 视频类型：${item.title || "未命名视频类型"}`,
    `- 适合账号类型：${item.account || "未标注账号"}`,
    `- 主题：${item.topic || item.title || ""}`,
    `- 适用 BGM 类型：${item.bgm || "轻节奏背景音乐，音量低于人声"}`,
    `- 核心钩子方向：${item.script || item.scriptSummary || ""}`,
    `- 画面风格方向：${item.visual || item.visualSummary || ""}`,
    "",
    "【分镜方向】",
    ...(scenes.length ? scenes.map((scene, index) => `${index + 1}. ${scene.time || ""}\n   分镜画面方向：${scene.visual || ""}\n   台词/字幕方向：${scene.line || ""}`) : ["1. 0-5s\n   分镜画面方向：大字标题 + 真实场景\n   台词/字幕方向：用一个具体痛点开场。"]),
    "",
    "【请输出】",
    "1. 视频标题（≤18字）",
    "2. 适合账号类型",
    "3. 目标用户/使用场景",
    "4. BGM 建议",
    "5. 完整分镜表：时间段、画面描述、镜头/素材、屏幕文字、口播/台词",
    "6. 结尾 CTA",
    "7. 拍摄与剪辑备注"
  ].join("\n");
}

function buildFallbackAppAccountVideoTypes(categoryLabel, isReadingLike) {
  if (!isReadingLike) {
    return [{ title: `${categoryLabel}产品路径证明`, script: `先说出一个高频 ${categoryLabel} 场景，再展示 App 内完成这个动作的路径和结果。`, account: "官方 App 号", visual: "真实界面录屏、关键按钮、结果反馈和转化入口。", badges: ["功能证明", "强 App 露出"] }];
  }
  return [
    { title: "产品路径证明", script: "通勤前打开一本书，先听 3 分钟摘要；坐下后切回文字，把关键观点保存下来。", account: "官方 App 号", visual: "真实 App 录屏：书籍详情、章节结构、播放条、阅读页、收藏或进度反馈。", badges: ["功能证明", "强 App 露出", "转化承接"] },
    { title: "替代刷屏任务", script: "今天别把睡前 10 分钟交给短视频，打开一个 10 分钟学习任务，听完一本书的核心观点。", account: "官方 App 号", visual: "刷短视频场景对比 App 内每日任务、完成状态、下一本推荐。", badges: ["强痛点", "可投放", "任务感"] },
    { title: "主题书单挑战", script: "7 天让表达更清楚：Day 1《How to Talk to Anyone》，Day 2《Crucial Conversations》……", account: "官方 App 号", visual: "App 内书架、每日计划、书籍卡片和完成进度串起来。", badges: ["书库驱动", "系列化", "易收藏"] },
    { title: "具体人群功能演示", script: "如果你读不完长书，先别硬啃原文；用摘要、音频和章节结构抓住这本书的主线。", account: "官方 App 号", visual: "围绕读不完、通勤、注意力不集中等场景展示对应功能路径。", badges: ["人群明确", "UI 证明", "中后期投放"] }
  ];
}

function buildFallbackCreatorContentVideoTypes(categoryLabel, isReadingLike) {
  if (!isReadingLike) {
    return [{ title: `${categoryLabel}真实场景口播`, script: `从一个真实生活场景切入，说出用户为什么会遇到这个问题，再给一个低门槛动作。`, account: "网红&内容号", visual: "生活场景、字幕大字、少量产品或结果画面，弱转化。", badges: ["内容信任", "轻产品露出"] }];
  }
  return [
    { title: "一本书解决一个具体困惑", script: "为什么你知道该改变，却总是坚持不到第三天？《Atomic Habits》给的答案不是更努力，而是先改环境。", account: "网红&内容号", visual: "标题大字 + 静态生活画面 + 书封面 + 字幕声波，先推荐观点和书。", badges: ["不硬广", "适合日更", "可接书库封面"] },
    { title: "观点反常识短视频", script: "你以为拖延是懒，其实很多时候是任务太模糊。先把行动缩小到 2 分钟。", account: "网红&内容号", visual: "文字帧为主，配少量静态生活画面和书封面；产品只在主页或评论承接。", badges: ["低制作成本", "建立账号心智", "适合 A/B 测试"] },
    { title: "生活方式轻挂载", script: "我最近把早上刷手机的 10 分钟换成听一本书的摘要，最明显的变化是开会时更容易说出重点。", account: "网红号", visual: "晨间、通勤、咖啡、笔记等真实场景，不必重 UI；结尾轻露工具或书单。", badges: ["信任感", "弱产品露出", "适合 UGC"] },
    { title: "评论领书单", script: "如果你最近想提升表达，评论 keyword，我把这 5 本书的顺序发你。", account: "内容号", visual: "书单卡片、评论关键词、收藏提示，重点放在互动和选题验证。", badges: ["评论钩子", "需求验证", "易收藏"] }
  ];
}
