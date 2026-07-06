#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import statistics
import subprocess
import sys
import unicodedata
import venv
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
STORAGE_ROOT = Path(
    os.environ.get("TT2TEXT_STORAGE_DIR")
    or os.environ.get("TT2TEXT_DATA_ROOT")
    or os.environ.get("TT2TEXT_HOME")
    or (Path.home() / "Library" / "Application Support" / "TT2Text")
).expanduser()
TOOLS_DIR = STORAGE_ROOT / ".tools"
OCR_VENV_DIR = TOOLS_DIR / "ocr-venv"
OCR_VENV_MARKER = "TT2TEXT_OCR_VENV_ACTIVE"
FRAME_INTERVAL_SECONDS = float(os.environ.get("TT2TEXT_OCR_FRAME_INTERVAL", "0.75"))
MAX_OCR_FRAMES = int(os.environ.get("TT2TEXT_MAX_OCR_FRAMES", "80"))
MIN_OCR_SCORE = float(os.environ.get("TT2TEXT_OCR_MIN_SCORE", "0.45"))
MAX_OCR_SEGMENTS = int(os.environ.get("TT2TEXT_MAX_OCR_SEGMENTS", "80"))
IGNORE_TEXT_RE = re.compile(
    r"(tiktok|business\s*creative\s*center|creative\s*center|广告|sponsored|promoted)",
    re.I,
)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: extract_visual_text_ocr.py <video_path> <job_dir>", file=sys.stderr)
        return 1

    if os.environ.get(OCR_VENV_MARKER) != "1" and os.environ.get("TT2TEXT_OCR_USE_SYSTEM") != "1":
        return run_inside_managed_venv()

    video_path = Path(sys.argv[1]).resolve()
    job_dir = Path(sys.argv[2]).resolve()
    job_dir.mkdir(parents=True, exist_ok=True)

    try:
        if not video_path.is_file():
            raise RuntimeError(f"视频不存在：{video_path}")
        info = probe_video(video_path)
        frame_paths = extract_frames(video_path, job_dir, info["duration"])
        if not frame_paths:
            raise RuntimeError("没有抽取到可 OCR 的视频帧。")
        engine = load_ocr_engine()
        raw_items = []
        for timestamp, frame_path in frame_paths:
            result = engine(str(frame_path))
            raw_items.extend(normalize_ocr_result(result, timestamp, info["width"], info["height"]))
        segments = merge_ocr_items(raw_items, info["duration"], FRAME_INTERVAL_SECONDS)
        payload = {
            "engine": "rapidocr",
            "video_path": str(video_path),
            "duration": info["duration"],
            "frame_count": len(frame_paths),
            "raw_item_count": len(raw_items),
            "visual_text_segments": segments,
            "frame_paths": [str(path) for _, path in frame_paths],
        }
        output_path = job_dir / "visual-ocr.json"
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        payload["output_path"] = str(output_path)
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    except Exception as error:
        print(f"OCR 定位失败：{error}", file=sys.stderr)
        return 1


def run_inside_managed_venv() -> int:
    python_bin = venv_python()
    if not python_bin.exists():
        TOOLS_DIR.mkdir(parents=True, exist_ok=True)
        venv.EnvBuilder(with_pip=True).create(OCR_VENV_DIR)
    ensure_ocr_dependencies(python_bin)
    env = {**os.environ, OCR_VENV_MARKER: "1"}
    process = subprocess.run([str(python_bin), __file__, *sys.argv[1:]], cwd=ROOT, env=env)
    return process.returncode


def venv_python() -> Path:
    return OCR_VENV_DIR / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def ensure_ocr_dependencies(python_bin: Path) -> None:
    probe = subprocess.run(
        [
            str(python_bin),
            "-c",
            "import importlib.util; print(bool(importlib.util.find_spec('rapidocr') and importlib.util.find_spec('onnxruntime')))",
        ],
        capture_output=True,
        text=True,
    )
    if "True" in probe.stdout:
        return
    subprocess.run(
        [str(python_bin), "-m", "pip", "install", "rapidocr", "onnxruntime"],
        check=True,
        cwd=ROOT,
    )


def load_ocr_engine():
    try:
        from rapidocr import RapidOCR
    except Exception as error:
        raise RuntimeError("RapidOCR 未安装或不可用，请检查 .tools/ocr-venv。") from error
    return RapidOCR()


def probe_video(video_path: Path) -> dict:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,duration",
            "-of",
            "json",
            str(video_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout or "{}")
    stream = (payload.get("streams") or [{}])[0]
    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    duration = float(stream.get("duration") or 0)
    if width <= 0 or height <= 0:
        raise RuntimeError("无法读取视频尺寸。")
    return {"width": width, "height": height, "duration": max(0.0, duration)}


def extract_frames(video_path: Path, job_dir: Path, duration: float) -> list[tuple[float, Path]]:
    frame_dir = job_dir / "ocr-frames"
    frame_dir.mkdir(parents=True, exist_ok=True)
    for stale in frame_dir.glob("ocr-frame-*.jpg"):
        stale.unlink()

    timestamps = build_timestamps(duration)
    frame_paths = []
    for index, timestamp in enumerate(timestamps, start=1):
        frame_path = frame_dir / f"ocr-frame-{index:03d}-{timestamp:.2f}s.jpg"
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
            frame_paths.append((timestamp, frame_path))
    return frame_paths


def build_timestamps(duration: float) -> list[float]:
    if duration <= 0:
        return [0.0]
    interval = max(0.25, FRAME_INTERVAL_SECONDS)
    timestamps = []
    current = 0.0
    while current <= duration and len(timestamps) < MAX_OCR_FRAMES:
        timestamps.append(round(current, 2))
        current += interval
    if timestamps and duration - timestamps[-1] > interval * 0.6 and len(timestamps) < MAX_OCR_FRAMES:
        timestamps.append(max(0.0, round(duration - 0.1, 2)))
    return timestamps


def normalize_ocr_result(result, timestamp: float, frame_width: int, frame_height: int) -> list[dict]:
    items = []
    for box, text, score in iter_ocr_result(result):
        clean_text = normalize_text(text)
        if should_ignore_text(clean_text):
            continue
        try:
            confidence = float(score)
        except (TypeError, ValueError):
            confidence = 0.0
        if confidence < MIN_OCR_SCORE:
            continue
        bbox = normalize_box(box, frame_width, frame_height)
        if not bbox:
            continue
        if bbox["w"] < 0.025 or bbox["h"] < 0.012:
            continue
        items.append(
            {
                "timestamp": round(timestamp, 2),
                "original": clean_text,
                "bbox": bbox,
                "score": round(confidence, 4),
                "key": text_key(clean_text),
            }
        )
    return items


def iter_ocr_result(result):
    if result is None:
        return
    if isinstance(result, tuple) and result:
        result = result[0]

    boxes = getattr(result, "boxes", None)
    txts = getattr(result, "txts", None)
    scores = getattr(result, "scores", None)
    if boxes is not None and txts is not None:
        boxes = boxes.tolist() if hasattr(boxes, "tolist") else boxes
        txts = list(txts or [])
        scores = list(scores or [0] * len(txts))
        for box, text, score in zip(boxes, txts, scores):
            yield box, text, score
        return

    if isinstance(result, list):
        for item in result:
            if isinstance(item, dict):
                box = item.get("box") or item.get("bbox") or item.get("points")
                text = item.get("text") or item.get("txt") or item.get("rec_text")
                score = item.get("score") or item.get("confidence") or item.get("rec_score") or 0
                yield box, text, score
            elif isinstance(item, (list, tuple)) and len(item) >= 3:
                yield item[0], item[1], item[2]


def normalize_box(box, frame_width: int, frame_height: int) -> dict | None:
    points = []
    if isinstance(box, dict):
        if all(key in box for key in ["x", "y", "w", "h"]):
            x = float(box["x"])
            y = float(box["y"])
            w = float(box["w"])
            h = float(box["h"])
            if max(x, y, w, h) > 1:
                x, y, w, h = x / frame_width, y / frame_height, w / frame_width, h / frame_height
            return clamp_bbox({"x": x, "y": y, "w": w, "h": h})
        box = box.get("points") or box.get("box")
    if not isinstance(box, (list, tuple)):
        return None
    for point in box:
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            try:
                points.append((float(point[0]), float(point[1])))
            except (TypeError, ValueError):
                pass
    if not points:
        return None
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    left, right = min(xs), max(xs)
    top, bottom = min(ys), max(ys)
    if right <= left or bottom <= top:
        return None
    return clamp_bbox(
        {
            "x": left / frame_width,
            "y": top / frame_height,
            "w": (right - left) / frame_width,
            "h": (bottom - top) / frame_height,
        }
    )


def clamp_bbox(bbox: dict) -> dict | None:
    x = clamp(float(bbox["x"]), 0.0, 0.98)
    y = clamp(float(bbox["y"]), 0.0, 0.98)
    w = clamp(float(bbox["w"]), 0.01, 1.0 - x)
    h = clamp(float(bbox["h"]), 0.01, 1.0 - y)
    if w <= 0 or h <= 0:
        return None
    return {"x": round(x, 4), "y": round(y, 4), "w": round(w, 4), "h": round(h, 4)}


def merge_ocr_items(items: list[dict], duration: float, interval: float) -> list[dict]:
    buckets: dict[str, list[dict]] = {}
    for item in items:
        key = item.get("key") or text_key(item.get("original"))
        if not key:
            continue
        buckets.setdefault(key, []).append(item)

    segments = []
    max_gap = max(1.25, interval * 2.4)
    for key, bucket in buckets.items():
        bucket.sort(key=lambda item: item["timestamp"])
        runs = []
        current = []
        for item in bucket:
            if current and item["timestamp"] - current[-1]["timestamp"] > max_gap:
                runs.append(current)
                current = []
            current.append(item)
        if current:
            runs.append(current)
        for run in runs:
            if not run:
                continue
            text = choose_text(run)
            start = max(0.0, run[0]["timestamp"] - interval * 0.35)
            end = min(duration or run[-1]["timestamp"] + interval, run[-1]["timestamp"] + interval * 1.1)
            if end <= start:
                end = start + max(0.5, interval)
            segments.append(
                {
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "original": text,
                    "zh": "",
                    "bbox": median_bbox([item["bbox"] for item in run]),
                    "bbox_source": "rapidocr",
                    "bbox_confidence": round(statistics.mean(item["score"] for item in run), 4),
                    "bbox_trusted": True,
                    "overlay_mode": "plain",
                }
            )
    segments.sort(key=lambda item: (item["start"], item["bbox"]["y"], item["bbox"]["x"]))
    return segments[:MAX_OCR_SEGMENTS]


def choose_text(items: list[dict]) -> str:
    values = [normalize_text(item.get("original")) for item in items if normalize_text(item.get("original"))]
    if not values:
        return ""
    return max(values, key=lambda value: (values.count(value), len(value)))


def median_bbox(boxes: list[dict]) -> dict:
    return {
        "x": round(statistics.median(box["x"] for box in boxes), 4),
        "y": round(statistics.median(box["y"] for box in boxes), 4),
        "w": round(statistics.median(box["w"] for box in boxes), 4),
        "h": round(statistics.median(box["h"] for box in boxes), 4),
    }


def should_ignore_text(text: str) -> bool:
    if not text or IGNORE_TEXT_RE.search(text):
        return True
    key = text_key(text)
    return len(key) < 2


def text_key(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", normalize_text(text))
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return "".join(char.lower() for char in normalized if char.isalnum())


def normalize_text(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


if __name__ == "__main__":
    raise SystemExit(main())
