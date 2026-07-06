#!/usr/bin/env python3
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import venv
import base64
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent.parent
STORAGE_ROOT = Path(
    os.environ.get("TT2TEXT_STORAGE_DIR")
    or os.environ.get("TT2TEXT_DATA_ROOT")
    or os.environ.get("TT2TEXT_HOME")
    or (Path.home() / "Library" / "Application Support" / "TT2Text")
).expanduser()
TOOLS_DIR = STORAGE_ROOT / ".tools"
VENV_DIR = TOOLS_DIR / "venv"
DOWNLOAD_NAME = "video"
WHISPER_CACHE_DIR = TOOLS_DIR / "whisper-cache"
WHISPER_MODEL_SIZE = os.environ.get("TT2TEXT_WHISPER_MODEL", "small")
CODEX_BIN = os.environ.get("TT2TEXT_CODEX_BIN", "codex")
CODEX_TRANSLATION_TIMEOUT = int(os.environ.get("TT2TEXT_CODEX_TIMEOUT", "900"))
AGNES_CALL_SCRIPT = os.environ.get("TT2TEXT_AGNES_CALL_SCRIPT", "")
AGNES_TRANSLATION_MODEL = os.environ.get("TT2TEXT_AGNES_TRANSLATION_MODEL", "agnes-2.0-flash")
VISION_PROVIDER = os.environ.get("TT2TEXT_VISION_PROVIDER", "agnes").strip().lower()
AGNES_VISION_MODEL = os.environ.get("TT2TEXT_AGNES_VISION_MODEL", "agnes-1.5-flash")
AGNES_BASE_URL = os.environ.get("AGNES_BASE_URL", "https://apihub.agnes-ai.com/v1").rstrip("/")
PROGRESS_PREFIX = "__TT2TEXT_PROGRESS__"
FRAME_INTERVAL_SECONDS = int(os.environ.get("TT2TEXT_VISUAL_FRAME_INTERVAL", "5"))
MAX_VISUAL_FRAMES = int(os.environ.get("TT2TEXT_MAX_VISUAL_FRAMES", "12"))


def main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "--visual-only":
        return visual_only_main()

    if len(sys.argv) != 3:
        print("usage: transcribe_translate.py <video_url> <job_dir>", file=sys.stderr)
        return 1

    video_url = sys.argv[1]
    job_dir = Path(sys.argv[2]).resolve()
    job_dir.mkdir(parents=True, exist_ok=True)

    try:
        ensure_venv()
        emit_progress("download", "准备读取视频信息")
        metadata = download_video(video_url, job_dir)
        video_path = locate_video(job_dir)
        audio_path = job_dir / "audio.wav"
        frame_path = job_dir / "first-frame.jpg"
        visual_summary = ""
        visual_frame_paths = []
        visual_text_segments = []
        if has_audio_stream(video_path):
            emit_progress("detect_language", "自动识别语言")
            emit_progress("transcribe", "抽取音频并执行转写")
            transcript_payload = transcribe_video(video_path, audio_path)
        else:
            emit_progress("transcribe", "未检测到音频轨道")
            transcript_payload = {
                "text": "",
                "language": "none",
                "language_probability": 1.0,
            }

        if should_run_visual_understanding(transcript_payload["text"], video_path):
            emit_progress("visual", "抽帧并调用视觉模型理解视频")
            visual_frame_paths = extract_visual_frames(video_path, job_dir)
            if visual_frame_paths:
                visual_payload = summarize_video_frames(video_url, metadata, transcript_payload, visual_frame_paths)
                visual_summary = visual_payload["summary_zh"]
                visual_text_segments = visual_payload["visual_text_segments"]

        emit_progress("translate", "调用翻译模型")
        if normalize_text(transcript_payload["text"]):
            translation = translate_to_chinese(
                transcript_payload["text"],
                transcript_payload["language"],
                transcript_payload["language_probability"],
            )
        else:
            translation = visual_summary
        emit_progress("finalize", "抽取首帧")
        capture_first_frame(video_path, frame_path)
    except Exception as error:
        print(f"转换失败：{error}", file=sys.stderr)
        return 1

    payload = {
        "title": derive_video_title(metadata, video_path.stem),
        "webpage_url": metadata.get("webpage_url") or video_url,
        "engagement": extract_engagement(metadata),
        "published_at": extract_published_at(metadata),
        "published_text": extract_published_text(metadata),
        "transcript_en": transcript_payload["text"],
        "translation_zh": translation,
        "source_language": transcript_payload["language"],
        "source_language_probability": transcript_payload["language_probability"],
        "first_frame_path": str(frame_path),
        "visual_summary": visual_summary,
        "visual_text_segments": visual_text_segments,
        "visual_frame_paths": [str(path) for path in visual_frame_paths],
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def visual_only_main() -> int:
    if len(sys.argv) != 4:
        print("usage: transcribe_translate.py --visual-only <video_url> <job_dir>", file=sys.stderr)
        return 1

    video_url = sys.argv[2]
    job_dir = Path(sys.argv[3]).resolve()

    try:
        metadata_path = job_dir / "metadata.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.exists() else {"webpage_url": video_url}
        video_path = locate_video(job_dir)
        emit_progress("visual", "抽帧并调用视觉模型理解视频")
        visual_frame_paths = extract_visual_frames(video_path, job_dir)
        if not visual_frame_paths:
            raise RuntimeError("没有抽取到可用于视觉理解的视频帧。")
        transcript_payload = {
            "text": "",
            "language": "visual",
            "language_probability": 1.0,
        }
        visual_payload = summarize_video_frames(video_url, metadata, transcript_payload, visual_frame_paths)
        visual_summary = visual_payload["summary_zh"]
        visual_text_segments = visual_payload["visual_text_segments"]
    except Exception as error:
        print(f"视觉理解失败：{error}", file=sys.stderr)
        return 1

    payload = {
        "webpage_url": metadata.get("webpage_url") or video_url,
        "translation_zh": visual_summary,
        "source_language": "visual",
        "source_language_probability": 1.0,
        "visual_summary": visual_summary,
        "visual_text_segments": visual_text_segments,
        "visual_frame_paths": [str(path) for path in visual_frame_paths],
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def emit_progress(stage_key: str, message: str) -> None:
    print(f"{PROGRESS_PREFIX}{json.dumps({'stageKey': stage_key, 'message': message}, ensure_ascii=False)}", flush=True)


def ensure_venv() -> None:
    python_bin = venv_bin("python")
    if not python_bin.exists():
        TOOLS_DIR.mkdir(parents=True, exist_ok=True)
        builder = venv.EnvBuilder(with_pip=True)
        builder.create(VENV_DIR)

    check_and_install("faster-whisper")


def check_and_install(package_name: str) -> None:
    python_bin = venv_bin("python")
    probe = subprocess.run(
        [str(python_bin), "-c", f"import importlib.util; print(bool(importlib.util.find_spec('{package_name.replace('-', '_')}')))"],
        capture_output=True,
        text=True,
        check=True,
    )
    if "True" in probe.stdout:
        return

    subprocess.run(
        [str(venv_bin("pip")), "install", package_name],
        check=True,
        cwd=ROOT,
    )


def download_video(video_url: str, job_dir: Path) -> dict:
    local_video = resolve_local_video_source(video_url)
    if local_video:
        return prepare_local_video(local_video, job_dir)

    metadata_path = job_dir / "metadata.json"
    output_template = str(job_dir / f"{DOWNLOAD_NAME}.%(ext)s")
    metadata_probe = subprocess.run(
        [
            "yt-dlp",
            "-o",
            output_template,
            "--write-info-json",
            "--skip-download",
            "--print-json",
            "--no-progress",
            video_url,
        ],
        capture_output=True,
        text=True,
    )
    if metadata_probe.returncode != 0:
        cached_video = next((path for path in job_dir.iterdir() if path.is_file() and path.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}), None)
        if metadata_path.exists() and cached_video:
            return json.loads(metadata_path.read_text(encoding="utf-8"))
        raise RuntimeError(f"yt-dlp 读取视频信息失败：{format_process_error(metadata_probe)}")

    cleanup_previous_download(job_dir)
    download_video_with_audio_preference(video_url, job_dir, output_template)

    info_files = sorted(job_dir.glob("*.info.json"))
    if info_files:
        metadata = json.loads(info_files[0].read_text(encoding="utf-8"))
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        return metadata

    lines = [line.strip() for line in metadata_probe.stdout.splitlines() if line.strip().startswith("{")]
    if lines:
        metadata = json.loads(lines[-1])
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        return metadata

    return {}


def resolve_local_video_source(video_url: str) -> Path | None:
    value = normalize_text(video_url)
    if not value:
        return None

    parsed = urlparse(value)
    if parsed.scheme == "file":
        candidate = Path(unquote(parsed.path)).expanduser()
    elif parsed.scheme:
        return None
    else:
        candidate = Path(value).expanduser()

    if not candidate.is_absolute():
        candidate = (ROOT / candidate).resolve()
    else:
        candidate = candidate.resolve()

    if candidate.is_file() and candidate.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}:
        return candidate
    return None


def prepare_local_video(source_path: Path, job_dir: Path) -> dict:
    metadata_path = job_dir / "metadata.json"
    cleanup_previous_download(job_dir)
    target_path = job_dir / f"{DOWNLOAD_NAME}{source_path.suffix.lower() or '.mp4'}"
    if source_path.resolve() != target_path.resolve():
        shutil.copy2(source_path, target_path)

    metadata = {
        "title": source_path.stem,
        "description": "",
        "webpage_url": str(source_path),
        "webpage_url_domain": "local-file",
        "extractor_key": "LocalFile",
    }
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return metadata


def download_video_with_audio_preference(video_url: str, job_dir: Path, output_template: str) -> None:
    attempts = [
        {
            "format": "best[vcodec!=none][acodec!=none]/best",
            "sort": ["vcodec:h264", "res:720", "ext:mp4:m4a"],
        },
        {
            "format": "h264_720p/h264_540p/best[height<=720][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best",
            "sort": [],
        },
        {
            "format": "bestvideo*+bestaudio/best",
            "sort": [],
        },
    ]
    last_download = None

    for index, attempt in enumerate(attempts):
        if index > 0:
            cleanup_previous_download(job_dir)

        command = [
            "yt-dlp",
            "-o",
            output_template,
            "-f",
            attempt["format"],
            "--force-overwrites",
            "--newline",
            video_url,
        ]
        for sort_key in attempt["sort"]:
            command.extend(["-S", sort_key])

        download = subprocess.run(
            command,
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        last_download = download
        if download.returncode != 0:
            continue

        video_path = locate_video(job_dir)
        if has_audio_stream(video_path):
            return

    if last_download and last_download.returncode != 0:
        raise RuntimeError(f"yt-dlp 下载视频失败：{format_process_error(last_download)}")


def cleanup_previous_download(job_dir: Path) -> None:
    for path in job_dir.glob(f"{DOWNLOAD_NAME}.*"):
        if path.is_file():
            path.unlink()
    for stale_name in ["audio.wav", "first-frame.jpg"]:
        stale_path = job_dir / stale_name
        if stale_path.exists():
            stale_path.unlink()


def format_process_error(process: subprocess.CompletedProcess) -> str:
    output = "\n".join(part.strip() for part in [process.stderr, process.stdout] if part and part.strip())
    if not output:
        output = f"退出码 {process.returncode}"
    return output[-4000:]


def locate_video(job_dir: Path) -> Path:
    candidates = [path for path in job_dir.iterdir() if path.is_file() and path.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}]
    if not candidates:
        raise RuntimeError("未找到下载后的视频文件。")
    return sorted(candidates)[0]


def capture_first_frame(video_path: Path, frame_path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(video_path),
            "-frames:v",
            "1",
            str(frame_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def should_run_visual_understanding(transcript: str, video_path: Path) -> bool:
    if os.environ.get("TT2TEXT_ALWAYS_VISUAL") == "1":
        return True

    text = normalize_text(transcript)
    if len(text) < 24:
        return True

    words = re.findall(r"[\w\u00c0-\u024f\u0400-\u04ff\u3040-\u30ff\u3400-\u9fff]+", text, re.U)
    unique_words = set(word.lower() for word in words)
    if len(words) <= 6 or len(unique_words) <= 3:
        return True

    duration = get_video_duration_seconds(video_path)
    if duration >= 8 and len(text) < max(48, duration * 2.5):
        return True

    music_markers = [
        "music",
        "song",
        "singing",
        "applause",
        "laughter",
        "background music",
        "音乐",
        "歌曲",
        "掌声",
        "笑声",
    ]
    lower = text.lower()
    return any(marker in lower for marker in music_markers) and len(text) < 80


def get_video_duration_seconds(video_path: Path) -> float:
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ],
        capture_output=True,
        text=True,
    )
    try:
        return float((probe.stdout or "0").strip() or 0)
    except ValueError:
        return 0.0


def extract_visual_frames(video_path: Path, job_dir: Path) -> list[Path]:
    frame_dir = job_dir / "visual-frames"
    frame_dir.mkdir(parents=True, exist_ok=True)
    for stale in frame_dir.glob("frame-*.jpg"):
        stale.unlink()

    duration = get_video_duration_seconds(video_path)
    if duration <= 0:
        timestamps = [0]
    else:
        timestamps = []
        current = 0.0
        while current <= duration and len(timestamps) < MAX_VISUAL_FRAMES:
            timestamps.append(current)
            current += max(1, FRAME_INTERVAL_SECONDS)
        if duration > 1 and (not timestamps or duration - timestamps[-1] > 2) and len(timestamps) < MAX_VISUAL_FRAMES:
            timestamps.append(max(0, duration - 0.8))

    frame_paths = []
    for index, timestamp in enumerate(timestamps, start=1):
        frame_path = frame_dir / f"frame-{index:02d}-{timestamp:.2f}s.jpg"
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                f"{timestamp:.2f}",
                "-i",
                str(video_path),
                "-frames:v",
                "1",
                "-q:v",
                "3",
                str(frame_path),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and frame_path.exists() and frame_path.stat().st_size > 512:
            frame_paths.append(frame_path)
    return frame_paths


def summarize_video_frames(video_url: str, metadata: dict, transcript_payload: dict, frame_paths: list[Path]) -> dict:
    output_path = frame_paths[0].parent.parent / "visual-summary.json"
    transcript = normalize_text(transcript_payload.get("text"))
    frame_lines = []
    for index, frame_path in enumerate(frame_paths, start=1):
        timestamp = parse_frame_timestamp(frame_path)
        timestamp_label = f"{timestamp:.2f}s" if timestamp is not None else f"frame {index}"
        frame_lines.append(f"- image {index}: {timestamp_label} ({frame_path.name})")
    prompt = "\n".join([
        "你在分析一个 TikTok 短视频推广素材。这个视频的音频转写为空、很短，或主要是音乐/环境声；请重点理解画面、屏幕字幕、app 截图和人物动作表达的意思。",
        "要求：",
        "1. 不要只做 OCR，要结合连续帧判断视频在讲什么。",
        "2. 如果画面里有字幕、app 截图、推荐榜单、聊天界面、功能演示，请提取关键原文并翻译解释。",
        "3. visual_text_segments 必须是画面文字时间轴：只记录画面上真实出现的文字；每段包含 start、end、original、zh；不要返回 bbox，文字坐标由 OCR 流程单独生成。",
        "4. start/end 用秒，按传入图片的时间戳粗估；同一句跨多帧出现就合并成一个时间段；画面没有文字就不要生成段落。",
        "5. 如果一帧里同时有多条重要文字，可以合并到同一个段落，用顿号或分号分隔；不要把音频口播当成画面文字。",
        "6. summary_zh 是中文总结，说明视频主题、推广的 app/功能、使用场景、核心卖点、情绪氛围。",
        "7. 不要估算画面文字坐标；如果输入图片里的文字位置不确定，也只输出文字内容和时间段。",
        "8. 只返回 JSON，不要 markdown，形状如下：",
        "{\"summary_zh\":\"...\",\"visual_text_segments\":[{\"start\":0,\"end\":2.4,\"original\":\"...\",\"zh\":\"...\"}]}",
        "",
        "传入图片顺序与时间戳：",
        *frame_lines,
        "",
        f"TikTok URL: {video_url}",
        f"标题/文案: {metadata.get('description') or metadata.get('title') or ''}",
        f"音频转写: {transcript or '无有效台词'}",
    ])
    if VISION_PROVIDER in {"agnes", "agnes-ai", "sapiens"}:
        return summarize_video_frames_with_agnes(prompt, frame_paths, output_path)
    if VISION_PROVIDER not in {"codex", "codex-cli", "local"}:
        raise RuntimeError(f"不支持的视觉理解 provider：{VISION_PROVIDER}，请设置 TT2TEXT_VISION_PROVIDER=agnes 或 codex。")
    return summarize_video_frames_with_codex(prompt, frame_paths, output_path)


def summarize_video_frames_with_codex(prompt: str, frame_paths: list[Path], output_path: Path) -> dict:
    command = [
        CODEX_BIN,
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--output-last-message",
        str(output_path),
    ]
    for path in frame_paths:
        command.extend(["--image", str(path)])
    command.append("-")
    process = subprocess.run(
        command,
        input=prompt,
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=CODEX_TRANSLATION_TIMEOUT,
    )
    if process.returncode != 0:
        detail = (process.stderr or process.stdout or "").strip()
        raise RuntimeError(f"Codex CLI 视觉理解失败: {detail}")
    if not output_path.exists():
        raise RuntimeError("Codex CLI 视觉理解失败: 未生成输出文件。")
    return parse_visual_summary_payload(output_path.read_text(encoding="utf-8"))


def summarize_video_frames_with_agnes(prompt: str, frame_paths: list[Path], output_path: Path) -> dict:
    api_key = read_agnes_api_key()
    if not api_key:
        raise RuntimeError("Agnes 视觉理解失败: 未配置 AGNES_API_KEY 或 macOS Keychain agnes-ai/default。")
    content = [{"type": "text", "text": prompt}]
    for frame_path in frame_paths:
        content.append({
            "type": "image_url",
            "image_url": {
                "url": image_data_url(frame_path)
            }
        })
    body = {
        "model": AGNES_VISION_MODEL,
        "messages": [
            {"role": "system", "content": "你是严谨的视频画面理解助手，只返回严格 JSON，不输出代码块。"},
            {"role": "user", "content": content}
        ],
        "temperature": 0.1,
        "max_tokens": 1800,
        "response_format": {"type": "json_object"}
    }
    request = urllib.request.Request(
        f"{AGNES_BASE_URL}/chat/completions",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=CODEX_TRANSLATION_TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Agnes 视觉理解失败: HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Agnes 视觉理解失败: {error.reason}") from error
    content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not content:
        raise RuntimeError("Agnes 视觉理解失败: 输出为空。")
    output_path.write_text(content, encoding="utf-8")
    return parse_visual_summary_payload(content)


def image_data_url(path: Path) -> str:
    ext = path.suffix.lower()
    mime = "image/png" if ext == ".png" else "image/webp" if ext == ".webp" else "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def read_agnes_api_key() -> str:
    key = os.environ.get("AGNES_API_KEY") or os.environ.get("TT2TEXT_AGNES_API_KEY")
    if key:
        return key.strip()
    security = shutil.which("security")
    if not security:
        return ""
    try:
        result = subprocess.run(
            [security, "find-generic-password", "-a", "default", "-s", "agnes-ai", "-w"],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def parse_frame_timestamp(frame_path: Path) -> float | None:
    match = re.search(r"-(\d+(?:\.\d+)?)s$", frame_path.stem)
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def parse_visual_summary_payload(content: str) -> dict:
    payload = json.loads(extract_json_object(content))
    if not isinstance(payload, dict):
        raise RuntimeError("Codex CLI 视觉理解失败: 输出 JSON 格式不正确。")
    summary_zh = normalize_text(payload.get("summary_zh") or payload.get("summary") or payload.get("translation") or "")
    return {
        "summary_zh": summary_zh,
        "visual_text_segments": normalize_visual_text_segments(payload.get("visual_text_segments") or payload.get("visualTextSegments") or []),
    }


def normalize_visual_text_segments(items: object) -> list[dict]:
    if not isinstance(items, list):
        return []

    normalized = []
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            start = max(0.0, float(item.get("start", item.get("startTime", item.get("from", 0))) or 0))
        except (TypeError, ValueError):
            start = 0.0
        try:
            end = float(item.get("end", item.get("endTime", item.get("to", start + 2.5))) or start + 2.5)
        except (TypeError, ValueError):
            end = start + 2.5
        if end <= start:
            end = start + 2.5
        original = normalize_text(item.get("original") or item.get("source") or item.get("text") or "")
        zh = normalize_text(item.get("zh") or item.get("translation_zh") or item.get("translationZh") or item.get("translation") or "")
        if not original and not zh:
            continue
        segment = {
            "start": round(start, 2),
            "end": round(end, 2),
            "original": original[:240],
            "zh": zh[:240],
        }
        normalized.append(segment)
    return normalized[:40]


def normalize_visual_text_bbox(value: object) -> dict | None:
    raw = None
    if isinstance(value, list) and len(value) >= 4:
        raw = {
            "x": value[0],
            "y": value[1],
            "w": value[2],
            "h": value[3],
        }
    elif isinstance(value, dict):
        raw = {
            "x": value.get("x", value.get("left")),
            "y": value.get("y", value.get("top")),
            "w": value.get("w", value.get("width")),
            "h": value.get("h", value.get("height")),
        }
    if not raw:
        return None

    try:
        numbers = [float(raw[key]) for key in ["x", "y", "w", "h"]]
    except (TypeError, ValueError):
        return None

    should_treat_as_percent = any(item > 1 for item in numbers) and all(0 <= item <= 100 for item in numbers)
    if should_treat_as_percent:
        numbers = [item / 100 for item in numbers]

    x = clamp_number(numbers[0], 0, 0.98)
    y = clamp_number(numbers[1], 0, 0.98)
    w = clamp_number(numbers[2], 0.02, 1 - x)
    h = clamp_number(numbers[3], 0.02, 1 - y)
    if w <= 0 or h <= 0:
        return None
    return {
        "x": round(x, 4),
        "y": round(y, 4),
        "w": round(w, 4),
        "h": round(h, 4),
    }


def clamp_number(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def has_audio_stream(video_path: Path) -> bool:
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index",
            "-of",
            "json",
            str(video_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(probe.stdout or "{}")
    return bool(payload.get("streams"))


def transcribe_video(video_path: Path, audio_path: Path) -> dict:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(video_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    python_bin = venv_bin("python")
    runner = f"""
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
from pathlib import Path
import json
import sys

audio_path = Path(sys.argv[1])
model = WhisperModel(
    {WHISPER_MODEL_SIZE!r},
    device='cpu',
    compute_type='int8',
    download_root={str(WHISPER_CACHE_DIR)!r},
)
audio = decode_audio(
    str(audio_path),
    sampling_rate=16000,
    split_stereo=False,
)
detect_audio = audio[:16000 * 30] if len(audio) > 16000 * 30 else audio
language, language_probability, _ = model.detect_language(
    audio=detect_audio,
    language_detection_segments=1,
)
transcribe_language = language if language and language != "unknown" else None
segments, info = model.transcribe(
    audio,
    language=transcribe_language,
    vad_filter=True,
    beam_size=5,
    condition_on_previous_text=False,
)
parts = []
for seg in segments:
    text = seg.text.strip()
    if text:
        parts.append(text)
detected_language = info.language or language or "unknown"
detected_probability = float(getattr(info, "language_probability", language_probability) or language_probability or 0.0)
print(
    json.dumps(
        {{
            "language": detected_language,
            "language_probability": detected_probability,
            "text": " ".join(parts),
        }},
        ensure_ascii=False,
    )
)
"""
    output = subprocess.run(
        [str(python_bin), "-c", runner, str(audio_path)],
        check=True,
        capture_output=True,
        text=True,
        env=python_env(),
    )
    payload = json.loads(output.stdout)
    payload["text"] = payload["text"].strip()
    return payload


def translate_to_chinese(text: str, source_language: str | None = None, source_language_probability: float | None = None) -> str:
    transcript = re.sub(r"\s+", " ", text).strip()
    if not transcript:
        return ""

    language_hint = "The source language was not detected."
    if source_language and source_language != "unknown":
        language_hint = f"Whisper detected the source language as {source_language}."
        if isinstance(source_language_probability, (int, float)):
            language_hint = f"{language_hint} Confidence: {source_language_probability:.2%}."

    prompt = (
        "Translate the following video transcript into natural, fluent Simplified Chinese.\n"
        "Requirements:\n"
        f"- {language_hint}\n"
        "- Preserve the original meaning and casual spoken tone.\n"
        "- Keep proper names, app names, brands, and place names in English when appropriate.\n"
        "- Do not add explanations, notes, markdown, or commentary.\n"
        "- Return JSON only in this exact shape: {\"translation\":\"...\"}\n\n"
        f"Transcript:\n{transcript}"
    )
    content = run_agnes_translation(prompt)
    translation = parse_translation_payload(content, provider_label="Agnes 翻译")
    return normalize_chinese_translation(translation)


def run_agnes_translation(prompt: str) -> str:
    command = [
        shutil.which("python3") or "python3",
        AGNES_CALL_SCRIPT,
        "chat",
        "--model",
        AGNES_TRANSLATION_MODEL,
        "--max-tokens",
        "800",
        prompt,
    ]
    process = subprocess.run(
        command,
        capture_output=True,
        text=True,
        cwd=ROOT,
        timeout=CODEX_TRANSLATION_TIMEOUT,
    )
    if process.returncode != 0:
        detail = (process.stderr or process.stdout or "").strip()
        raise RuntimeError(f"Agnes 翻译失败: {detail}")
    content = (process.stdout or "").strip()
    if not content:
        raise RuntimeError("Agnes 翻译失败: 输出为空。")
    return content


def parse_translation_payload(content: str, provider_label: str = "翻译模型") -> str:
    if not content:
        raise RuntimeError(f"{provider_label}失败: 输出为空。")

    payload = json.loads(extract_json_object(content))
    if not isinstance(payload, dict) or not isinstance(payload.get("translation"), str):
        raise RuntimeError(f"{provider_label}失败: 输出 JSON 格式不正确。")
    return payload["translation"]


def extract_json_object(content: str) -> str:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()
    if text.startswith("{") and text.endswith("}"):
        return text

    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        raise RuntimeError("翻译模型失败: 找不到 JSON 对象。")
    return match.group(0)


def normalize_chinese_translation(text: str) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    compact = re.sub(r"\s*([。！？；：，、])\s*", r"\1", compact)
    return compact


def derive_video_title(metadata: dict, fallback: str) -> str:
    title = normalize_text(metadata.get("title"))
    description = normalize_text(metadata.get("description"))
    domain = normalize_text(metadata.get("webpage_url_domain")).lower()
    extractor_key = normalize_text(metadata.get("extractor_key")).lower()

    is_tiktok = "tiktok" in domain or extractor_key == "tiktok"
    if is_tiktok and description:
        first_sentence = extract_first_sentence(description)
        if first_sentence:
            return first_sentence

    return title or fallback


def extract_engagement(metadata: dict) -> dict:
    return {
        "likeCount": metadata.get("like_count"),
        "commentCount": metadata.get("comment_count"),
        "shareCount": metadata.get("repost_count") or metadata.get("share_count"),
        "viewCount": metadata.get("view_count"),
        "source": "yt-dlp",
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

    release_date = normalize_text(metadata.get("release_date"))
    if re.match(r"^\d{8}$", release_date):
        return f"{release_date[:4]}-{release_date[4:6]}-{release_date[6:8]}"

    return ""


def extract_published_text(metadata: dict) -> str:
    return (
        extract_published_at(metadata)
        or normalize_text(metadata.get("upload_date"))
        or normalize_text(metadata.get("release_date"))
        or normalize_text(metadata.get("modified_date"))
    )


def extract_first_sentence(text: str) -> str:
    compact = normalize_text(text)
    if not compact:
        return ""

    first_line = compact.splitlines()[0].strip()
    if not first_line:
        return ""

    match = re.search(r"^(.+?[.!?。！？])(?:\s|$)", first_line)
    if match:
        return match.group(1).strip()

    return first_line


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value).strip()


def python_env() -> dict[str, str]:
    env = os.environ.copy()
    cert_candidates = sorted(VENV_DIR.glob("lib/python*/site-packages/certifi/cacert.pem"))
    cert_path = cert_candidates[0] if cert_candidates else None
    if cert_path and cert_path.exists():
        env.setdefault("SSL_CERT_FILE", str(cert_path))
        env.setdefault("REQUESTS_CA_BUNDLE", str(cert_path))
    return env


def venv_bin(name: str) -> Path:
    return VENV_DIR / "bin" / name


if __name__ == "__main__":
    raise SystemExit(main())
