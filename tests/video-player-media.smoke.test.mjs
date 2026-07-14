import assert from "node:assert/strict";
import test from "node:test";

import { renderUnifiedVideoPlayer } from "../public/js/core/video-player.js";

test("video player preserves every fallback cover candidate", () => {
  const html = renderUnifiedVideoPlayer({
    videoPath: "/missing/video.mp4",
    coverPath: "/missing/first-frame.jpg",
    coverPaths: [
      "/missing/first-frame.jpg",
      "/data/ad-shots/example/analysis/visual-frames/frame-01-0.00s.jpg"
    ]
  });

  assert.match(html, /data-cover-paths=/);
  assert.match(html, /\/data\/ad-shots\/example\/analysis\/visual-frames\/frame-01-0\.00s\.jpg/);
});
