"""Phase 2b - emit a pinyin lookup for the Traditional Chinese text in the dataset.

    python scripts/build_pinyin_index.py

Input : data/zh_identities.json
Output: frontend/src/data/pinyin.json   {character: "full pinyin", ...}

The search box accepts 拼音首字母 (`lx` -> 李箱), full pinyin (`lixiang` -> 李箱) and
plain Chinese (`李箱`). Rather than ship a runtime pinyin library, this resolves the
reading of every character that actually appears in the dataset once, at build time.
Only those characters can ever be typed into a matching query, so a full dictionary
would be dead weight in the bundle.

Characters are collected from every user-visible field rather than just the identity
name, so a query such as 異色 or 沉淪 also matches while the search fields are widened.
"""

from __future__ import annotations

import json
from pathlib import Path

from pypinyin import Style, pinyin

ROOT = Path(__file__).resolve().parent.parent
ZH_FILE = ROOT / "data" / "zh_identities.json"
OUT = ROOT / "frontend" / "src" / "data" / "pinyin.json"

# Fields a query may plausibly be matched against, plus the nested skill records.
TEXT_FIELDS = (
    "name_zh",
    "sinner_zh",
    "tags_zh",
    "season_zh",
    "damage_types_zh",
    "sin_affinities_zh",
    "keywords_zh",
)


def collect_characters(records: list[dict]) -> set[str]:
    chars: set[str] = set()

    def absorb(value) -> None:
        if isinstance(value, str):
            chars.update(c for c in value if "\u3400" <= c <= "\u9fff")

    for record in records:
        for field in TEXT_FIELDS:
            value = record.get(field)
            if isinstance(value, list):
                for item in value:
                    absorb(item)
            else:
                absorb(value)
        for skill in record.get("skills_zh") or []:
            for value in skill.values():
                absorb(value)
    return chars


def main() -> int:
    records = json.loads(ZH_FILE.read_text(encoding="utf-8"))
    chars = collect_characters(records)
    print(f"[1/3] {len(chars)} distinct CJK characters across {len(records)} identities")

    readings: dict[str, str] = {}
    polyphones: list[str] = []
    for char in chars:
        # `heteronym=False` keeps the most common reading, which is what a player
        # typing 血 (xue) or 长 (chang) will expect.
        syllables = pinyin(char, style=Style.NORMAL, heteronym=False, errors="ignore")
        if not syllables or not syllables[0]:
            polyphones.append(char)
            continue
        readings[char] = syllables[0][0]

    missing = sorted(chars - readings.keys())
    print(f"[2/3] resolved {len(readings)} readings; {len(missing)} unresolved: {missing[:12]}")
    if polyphones:
        print(f"      {len(polyphones)} without a reading: {polyphones[:12]}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(dict(sorted(readings.items())), ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    size = OUT.stat().st_size
    print(f"[3/3] wrote {len(readings)} entries ({size / 1024:.1f} KiB) -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())