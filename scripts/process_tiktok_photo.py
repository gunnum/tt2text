#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent
CODEX_BIN = os.environ.get("TT2TEXT_CODEX_BIN", "codex")
CODEX_TIMEOUT = int(os.environ.get("TT2TEXT_CODEX_TIMEOUT", "900"))
PROGRESS_PREFIX = "__TT2TEXT_PROGRESS__"


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: process_tiktok_photo.py <photo_url> <job_dir> <preview_json>", file=sys.stderr)
        return 1

    photo_url = sys.argv[1]
    job_dir = Path(sys.argv[2]).resolve()
    preview = json.loads(sys.argv[3] or "{}")
    job_dir.mkdir(parents=True, exist_ok=True)

    try:
        emit_progress("download", "读取图集信息")
        metadata = read_metadata(photo_url, job_dir)
        image_paths = collect_images(metadata, preview, job_dir)
        if not image_paths:
            raise RuntimeError("未能获取图集图片或封面。")
        first_frame_path = job_dir / "first-frame.jpg"
        first_frame_path.write_bytes(image_paths[0].read_bytes())
        emit_progress("transcribe", "调用视觉模型理解图集")
        summary = summarize_images(photo_url, metadata, preview, image_paths)
    except Exception as error:
        print(f"图集处理失败：{error}", file=sys.stderr)
        return 1

    payload = {
        "media_type": "photo",
        "title": derive_title(metadata, preview, "TikTok 图集"),
        "webpage_url": metadata.get("webpage_url") or photo_url,
        "engagement": extract_engagement(metadata, preview),
        "published_at": extract_published_at(metadata) or preview.get("publishedAt") or "",
        "published_text": extract_published_at(metadata) or preview.get("publishedText") or "",
        "transcript_en": summary,
        "translation_zh": summary,
        "source_language": "visual",
        "source_language_probability": 1,
        "first_frame_path": str(first_frame_path),
        "image_paths": [str(path) for path in image_paths],
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def emit_progress(stage_key: str, message: str) -> None:
    print(f"{PROGRESS_PREFIX}{json.dumps({'stageKey': stage_key, 'message': message}, ensure_ascii=False)}", flush=True)


def read_metadata(url: str, job_dir: Path) -> dict:
    metadata_path = job_dir / "metadata.json"
    probe = subprocess.run(
        ["yt-dlp", "--skip-download", "--print-json", "--no-progress", url],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    if probe.returncode != 0:
        metadata_path.write_text(json.dumps({"webpage_url": url}, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"webpage_url": url}
    lines = [line.strip() for line in probe.stdout.splitlines() if line.strip().startswith("{")]
    metadata = json.loads(lines[-1]) if lines else {"webpage_url": url}
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return metadata


def collect_images(metadata: dict, preview: dict, job_dir: Path) -> list[Path]:
    image_dir = job_dir / "images"
    image_dir.mkdir(parents=True, exist_ok=True)
    urls = []
    urls.extend(extract_image_urls(metadata))
    urls.extend(extract_image_urls(preview.get("image_urls") or preview.get("imageUrls") or preview.get("imageUrlsJson") or []))
    for key in ["coverUrl", "thumbnailUrl", "posterUrl"]:
        if preview.get(key):
            urls.append(preview[key])
    deduped = []
    for url in urls:
        if url and url not in deduped and not str(url).startswith("data:"):
            deduped.append(url)
    paths = []
    for index, url in enumerate(deduped[:12], start=1):
        path = image_dir / f"image-{index:02d}.jpg"
        if download_image(url, path):
            paths.append(path)
    return paths


def extract_image_urls(value) -> list[str]:
    urls = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {"url", "src", "thumbnail", "webpage_url"} and looks_like_image_url(item):
                urls.append(item)
            else:
                urls.extend(extract_image_urls(item))
    elif isinstance(value, list):
        for item in value:
            urls.extend(extract_image_urls(item))
    elif looks_like_image_url(value):
        urls.append(value)
    return urls


def looks_like_image_url(value) -> bool:
    text = str(value or "")
    return text.startswith("http") and re.search(r"(image|photo|p\d+-sign|tos-|tiktokcdn|\.jpg|\.jpeg|\.png|\.webp)", text, re.I)


def download_image(url: str, path: Path) -> bool:
    try:
        request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urlopen(request, timeout=30) as response:
            data = response.read()
            content_type = response.headers.get("content-type", "")
        if len(data) < 512:
            return False
        if not is_image_response(data, content_type):
            return False
        path.write_bytes(data)
        return True
    except Exception:
        return False


def is_image_response(data: bytes, content_type: str = "") -> bool:
    lowered = str(content_type or "").lower()
    if lowered.startswith("image/"):
        return True
    return data.startswith(b"\xff\xd8\xff") or data.startswith(b"\x89PNG\r\n\x1a\n") or data.startswith(b"RIFF") and data[8:12] == b"WEBP"


def summarize_images(photo_url: str, metadata: dict, preview: dict, image_paths: list[Path]) -> str:
    output_path = image_paths[0].parent.parent / "visual-summary.txt"
    prompt = "\n".join([
        "你在分析一个 TikTok 图集推广素材。请不要只做 OCR，要结合图片画面、截图里的 app、榜单/推荐关系、字幕和上下文，输出中文结构化总结。",
        "要求：",
        "1. 逐张说明：每张图可见文字、画面元素、可能展示的 app 或功能。",
        "2. 整体总结：这个图集在推广什么、核心卖点是什么、用户场景是什么。",
        "3. 如果包含多个 app 推荐，请列出 app 名和推荐理由；无法确定就标注不确定。",
        "4. 保留可见英文/其他语言原文关键短句，并给中文解释。",
        "5. 不要编造看不见的信息。",
        "",
        f"TikTok URL: {photo_url}",
        f"标题/文案: {preview.get('text') or metadata.get('description') or metadata.get('title') or ''}",
    ])
    command = [
        CODEX_BIN,
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--output-last-message",
        str(output_path),
    ]
    for path in image_paths:
        command.extend(["--image", str(path)])
    command.append(prompt)
    subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True, timeout=CODEX_TIMEOUT)
    return output_path.read_text(encoding="utf-8").strip()


def derive_title(metadata: dict, preview: dict, fallback: str) -> str:
    return normalize_text(preview.get("text")) or normalize_text(metadata.get("description")) or normalize_text(metadata.get("title")) or fallback


def extract_engagement(metadata: dict, preview: dict) -> dict:
    preview_engagement = preview.get("engagement") if isinstance(preview.get("engagement"), dict) else {}
    return {
        "likeCount": preview_engagement.get("likeCount") or metadata.get("like_count"),
        "likeText": preview_engagement.get("likeText") or "",
        "commentCount": preview_engagement.get("commentCount") or metadata.get("comment_count"),
        "commentText": preview_engagement.get("commentText") or "",
        "shareCount": metadata.get("repost_count") or metadata.get("share_count"),
        "viewCount": metadata.get("view_count"),
        "source": "tiktok-search+yt-dlp",
    }


def extract_published_at(metadata: dict) -> str:
    timestamp = metadata.get("timestamp") or metadata.get("release_timestamp")
    if timestamp:
        try:
            import datetime
            return datetime.datetime.fromtimestamp(float(timestamp)).strftime("%Y-%m-%d")
        except Exception:
            pass
    upload_date = normalize_text(metadata.get("upload_date"))
    if re.match(r"^\d{8}$", upload_date):
        return f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:8]}"
    return ""


def normalize_text(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


if __name__ == "__main__":
    raise SystemExit(main())
