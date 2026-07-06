#!/usr/bin/env python3
import json
import os
from pathlib import Path

from transcribe_translate import translate_to_chinese


ROOT = Path(__file__).resolve().parent.parent
STORAGE_ROOT = Path(
    os.environ.get("TT2TEXT_STORAGE_DIR")
    or os.environ.get("TT2TEXT_DATA_ROOT")
    or os.environ.get("TT2TEXT_HOME")
    or (Path.home() / "Library" / "Application Support" / "TT2Text")
).expanduser()
DATA_DIR = Path(os.environ.get("TT2TEXT_DATA_DIR", STORAGE_ROOT / "data")).expanduser()
RESULTS_FILE = DATA_DIR / "results.json"


def main() -> int:
    data = json.loads(RESULTS_FILE.read_text(encoding="utf-8"))
    updated = 0

    for item in data:
        transcript_en = (item.get("transcriptEn") or "").strip()
        if not transcript_en:
            continue

        item["transcriptZh"] = translate_to_chinese(transcript_en)
        updated += 1
        print(f"retranslated {item.get('id', '<unknown>')}")

    RESULTS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"updated {updated} records")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
