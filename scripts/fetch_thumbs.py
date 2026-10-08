"""Download every image the frontend needs into the repo.

    python scripts/fetch_thumbs.py [--force]

Outputs: frontend/public/thumbs/{id}.png        201 identity avatars (128px)
         frontend/public/thumbs/sinner-{slug}.png 12 passport photos (ver3)
         frontend/public/thumbs/passport-bg.png  the passport background strip
         frontend/public/thumbs/atk-{type}.png   slash / pierce / blunt icons

Sources
* huijiwiki  `Data:Identitychoose.tabx` holds `png1`, the numeric id that names
  `File:头像-{belong}-{png1}.png` for the 189 stock identities. The 12 kindergarten
  identities are not in the table and take their `image` URL from zh_identities.json
  (the 256x256 `<title> Icon.png` on wiki.gg).
* huijiwiki  `/wiki/罪人` renders three passport photos per sinner; `alternate2`
  (ver3) is the version the site shows by default.
* the three attack-type icons are the ones the site uses, kept as raw URLs.

Existing files are skipped unless --force is passed, so a re-run only fetches what
is missing. Anything that fails to download is reported and fails the build.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import unquote

import requests

ROOT = Path(__file__).resolve().parent.parent
ZH_FILE = ROOT / "data" / "zh_identities.json"
OUT_DIR = ROOT / "frontend" / "public" / "thumbs"

HUIJI_API = "https://limbuscompany.huijiwiki.com/api.php"
DATA_PAGE = "Data:Identitychoose.tabx"
PASSPORT_PAGE = "罪人"
UA = "LimbusdleBuild/0.1 (local dev scraper)"

THUMB_WIDTH = 128

# The passport page lays the twelve out in limbusdeck release order; each photo is
# wrapped in a link to the sinner's page, so the mapping comes from the href.
SINNER_ZH_TO_EN = {
    "李箱": "yi-sang",
    "浮士德": "faust",
    "堂吉诃德": "don-quixote",
    "良秀": "ryoshu",
    "默尔索": "meursault",
    "鸿璐": "hong-lu",
    "希斯克利夫": "heathcliff",
    "以实玛利": "ishmael",
    "罗佳": "rodion",
    "辛克莱": "sinclair",
    "奥提斯": "outis",
    "格里高尔": "gregor",
}

ATTACK_ICONS = {
    "atk-slash.png": "https://huiji-thumb.huijistatic.com/limbuscompany/uploads/thumb/1/10/%E6%96%A9%E5%87%BB.png/30px-%E6%96%A9%E5%87%BB.png",
    "atk-pierce.png": "https://huiji-thumb.huijistatic.com/limbuscompany/uploads/thumb/3/36/%E7%AA%81%E5%88%BA.png/35px-%E7%AA%81%E5%88%BA.png",
    "atk-blunt.png": "https://huiji-thumb.huijistatic.com/limbuscompany/uploads/thumb/5/5f/%E6%89%93%E5%87%BB.png/30px-%E6%89%93%E5%87%BB.png",
}

# Slot-4 defense roles, from limbuscompany.wiki.gg (as pinned by the user).
ROLE_ICONS = {
    "role-guard.png": "https://limbuscompany.wiki.gg/images/thumb/Guard.png/25px-Guard.png?d41a83",
    "role-evade.png": "https://limbuscompany.wiki.gg/images/thumb/Evade.png/25px-Evade.png?7a44b8",
    "role-counter.png": "https://limbuscompany.wiki.gg/images/thumb/Counter.png/25px-Counter.png?52850a",
}


def slugify(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", ascii_text.lower())).strip("-")


def api(session: requests.Session, **params) -> dict:
    r = session.get(
        HUIJI_API,
        params={"format": "json", "formatversion": "2", **params},
        timeout=90,
    )
    r.raise_for_status()
    return r.json()


def fetch_tabx(session: requests.Session) -> list[dict]:
    data = api(
        session,
        action="query",
        prop="revisions",
        rvslots="main",
        rvprop="content",
        titles=DATA_PAGE,
    )
    page = data["query"]["pages"][0]
    blob = json.loads(page["revisions"][0]["slots"]["main"]["content"])
    columns = [f["name"] for f in blob["schema"]["fields"]]
    return [dict(zip(columns, row)) for row in blob["data"]]


def resolve_thumbs(session: requests.Session, titles: list[str]) -> dict[str, str]:
    """`File:` titles -> 128px thumbnail URL, keyed by the title that was asked for."""
    urls: dict[str, str] = {}
    for i in range(0, len(titles), 40):
        batch = titles[i : i + 40]
        data = api(
            session,
            action="query",
            prop="imageinfo",
            iiprop="url",
            iiurlwidth=str(THUMB_WIDTH),
            titles="|".join(batch),
        )
        alias = {n["from"]: n["to"] for n in data["query"].get("normalized", [])}
        for page in data["query"]["pages"]:
            info = page.get("imageinfo")
            if not info:
                continue
            resolved = page.get("title", "")
            source = next((t for t in batch if alias.get(t, t) == resolved), None)
            if source:
                urls[source] = info[0].get("thumburl") or info[0]["url"]
        print(f"      resolved {min(i + 40, len(titles))}/{len(titles)}")
    return urls


def download(session: requests.Session, url: str, dest: Path, force: bool) -> str:
    """`ok` / `skipped` / `failed: <reason>`."""
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return "skipped"
    try:
        r = session.get(url, timeout=90, allow_redirects=True)
        r.raise_for_status()
    except Exception as error:  # noqa: BLE001 - reported verbatim in the summary
        return f"failed: {error}"
    content_type = r.headers.get("Content-Type", "")
    if not content_type.startswith("image/") or len(r.content) < 512:
        return f"failed: {content_type or 'no content-type'}, {len(r.content)} bytes"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(r.content)
    return "ok"


def main(argv: list[str]) -> int:
    force = "--force" in argv
    session = requests.Session()
    session.headers.update({"User-Agent": UA})

    records = json.loads(ZH_FILE.read_text(encoding="utf-8"))
    stock = [r for r in records if r["id"] < 190]
    kindergarten = [r for r in records if r["id"] >= 190]
    print(f"[1/5] {len(records)} identities ({len(stock)} stock + {len(kindergarten)} kindergarten)")

    # --- identity avatars -------------------------------------------------
    rows = fetch_tabx(session)
    by_name = {row["name"]: row for row in rows}
    jobs: dict[Path, str] = {}  # dest -> url

    titles = []
    wanted: dict[str, int] = {}  # File: title -> identity id
    for record in stock:
        row = by_name.get(record["wiki_page"])
        if not row:
            print(f"      no tabx row for {record['wiki_page']}", file=sys.stderr)
            return 1
        title = f"File:头像-{row['belong']}-{row['png1']}.png"
        titles.append(title)
        wanted[title] = record["id"]
    urls = resolve_thumbs(session, sorted(set(titles)))
    for title, identity_id in wanted.items():
        url = urls.get(title)
        if not url:
            print(f"      no thumbnail for {title}", file=sys.stderr)
            return 1
        jobs[OUT_DIR / f"{identity_id}.png"] = url
    print(f"[2/5] {len(jobs)} stock avatar thumbnails resolved")

    for record in kindergarten:
        jobs[OUT_DIR / f"{record['id']}.png"] = record["image"]
    print(f"[3/5] {len(kindergarten)} kindergarten icons queued")

    # --- sinner passports -------------------------------------------------
    data = api(session, action="parse", page=PASSPORT_PAGE, prop="text")
    html = data["parse"]["text"]
    passport_urls: dict[str, str] = {}
    for href, block in re.findall(
        r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, flags=re.S
    ):
        found = re.search(
            r'class="sinner_passport_image alternate2" src="([^"]+)"', block
        )
        if not found:
            continue
        title = unquote(href.rsplit("/", 1)[-1])
        slug = SINNER_ZH_TO_EN.get(title)
        if not slug:
            print(f"      passport link to unknown sinner {title!r}", file=sys.stderr)
            return 1
        passport_urls[slug] = found.group(1)
    backgrounds = set(re.findall(r'src="([^"]+MainUI_PersonalityStory[^"]+)"', html))
    if len(passport_urls) != 12:
        print(f"      found {len(passport_urls)}/12 passport photos", file=sys.stderr)
        return 1
    if len(backgrounds) != 1:
        print(f"      found {len(backgrounds)} passport backgrounds", file=sys.stderr)
        return 1
    for slug, url in passport_urls.items():
        jobs[OUT_DIR / f"sinner-{slug}.png"] = url
    jobs[OUT_DIR / "passport-bg.png"] = next(iter(backgrounds))
    print(f"[4/5] {len(passport_urls)} passport photos + background resolved")

    # --- attack + defense-role icons ---------------------------------------
    for name, url in ATTACK_ICONS.items():
        jobs[OUT_DIR / name] = url
    for name, url in ROLE_ICONS.items():
        jobs[OUT_DIR / name] = url

    # --- download ---------------------------------------------------------
    counts = {"ok": 0, "skipped": 0}
    failures: list[tuple[Path, str]] = []
    for dest, url in sorted(jobs.items()):
        result = download(session, url, dest, force)
        if result.startswith("failed"):
            failures.append((dest, f"{result} | {url}"))
        else:
            counts[result] += 1
    total = sum(p.stat().st_size for p in OUT_DIR.glob("*.png"))
    print(
        f"[5/5] {counts['ok']} downloaded, {counts['skipped']} cached, "
        f"{len(failures)} failed -> {total / 1024 / 1024:.1f} MB in {OUT_DIR}"
    )
    for dest, url in failures:
        print(f"      FAILED {dest.name}: {url}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
