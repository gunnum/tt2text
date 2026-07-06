import { escapeAttribute, escapeHtml, formatNumber, shortenText } from "./formatters.js";

export function renderAllVideos(el, videos = []) {
  if (!el) return;
  el.innerHTML = `
    <span id="all"></span>
    <div class="section-head">
      <div>
        <p class="eyebrow">All Samples</p>
        <h2>完整样本表</h2>
      </div>
      <p class="helper-text">${escapeHtml(videos.length)} 条视频，按高互动权重排序。</p>
    </div>
    <div class="video-table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>视频</th>
            <th>互动</th>
            <th>账号</th>
            <th>脚本类型</th>
            <th>Hook</th>
            <th>预览</th>
          </tr>
        </thead>
        <tbody>
          ${videos.map((video, index) => renderVideoRow(video, index)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderVideoRow(video, index) {
  return `
    <tr>
      <td>${index + 1}</td>
      <td>${renderVideoLink(video)}<small>${escapeHtml(video.appName)} · ${escapeHtml(video.authorName)}</small></td>
      <td>赞 ${escapeHtml(formatNumber(video.metrics.likeCount))}<small>评 ${escapeHtml(formatNumber(video.metrics.commentCount))} / 分享 ${escapeHtml(formatNumber(video.metrics.shareCount))}${Number(video.metrics.viewCount || 0) > 0 ? ` / 播放 ${escapeHtml(formatNumber(video.metrics.viewCount))}` : ""}</small></td>
      <td>${escapeHtml(video.accountType)}</td>
      <td>${escapeHtml(video.scriptType)}<small>${escapeHtml(video.exposureLevel)}</small></td>
      <td>${escapeHtml(shortenText(video.hook || video.summary, 120))}</td>
      <td>${video.videoPath || video.posterPath ? `<button class="table-play-button" type="button" data-play-video="${escapeAttribute(video.id || "")}">播放</button>` : "无"}</td>
    </tr>
  `;
}

function renderVideoLink(video) {
  const href = video.shotUrl || video.sourceUrl || "";
  return href
    ? `<a href="${escapeAttribute(href)}" target="_blank" rel="noreferrer">${escapeHtml(video.title)}</a>`
    : escapeHtml(video.title);
}
