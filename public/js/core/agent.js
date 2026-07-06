export function formatCliName(name) {
  return ({
    node: "Node.js",
    python3: "Python",
    ffmpeg: "FFmpeg",
    ytDlp: "yt-dlp",
    codex: "Codex CLI"
  })[name] || name;
}
