import { bindUnifiedVideoPlayer, renderUnifiedVideoPlayer } from "../core/video-player.js";

export function createVideoDialogController({ dialogEl, stageEl, titleEl, metaEl, closeEl, findVideo } = {}) {
  let cleanup = null;

  function bindReportVideoButtons() {
    document.querySelectorAll("[data-play-video]").forEach((button) => {
      button.addEventListener("click", () => {
        const video = findVideo?.(button.dataset.playVideo || "");
        if (video) openReportVideo(video);
      });
    });
  }

  function openReportVideo(video) {
    if (!dialogEl || !stageEl) return;
    cleanup?.();
    cleanup = null;
    if (titleEl) titleEl.textContent = video.title || "视频预览";
    if (metaEl) metaEl.textContent = [video.appName, video.authorName, video.accountType, video.scriptType].filter(Boolean).join(" · ");
    stageEl.innerHTML = renderUnifiedVideoPlayer({
      videoPath: video.videoPath || "",
      posterPath: video.posterPath || "",
      coverPath: video.posterPath || "",
      title: video.title || "",
      item: video,
      videoClassName: "report-dialog-video",
      imageClassName: "report-dialog-cover",
      emptyLabel: "当前素材没有可播放视频。"
    });
    cleanup = bindUnifiedVideoPlayer(stageEl, { item: video });
    if (typeof dialogEl.showModal === "function") dialogEl.showModal();
    else dialogEl.setAttribute("open", "");
  }

  function closeReportVideo() {
    cleanup?.();
    cleanup = null;
    if (stageEl) stageEl.innerHTML = "";
    dialogEl?.close?.();
    dialogEl?.removeAttribute("open");
  }

  closeEl?.addEventListener("click", closeReportVideo);
  dialogEl?.addEventListener("click", (event) => {
    const panel = dialogEl.querySelector(".report-video-panel");
    if (panel && !panel.contains(event.target)) closeReportVideo();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialogEl?.open) closeReportVideo();
  });

  return {
    bindReportVideoButtons,
    openReportVideo,
    closeReportVideo
  };
}
