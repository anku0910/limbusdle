"""Phase 3 - append the twelve Limbus Kindergarten identities to the roster.

    python scripts/extract_kindergarten.py

Inputs : data/zh_identities.json   (produced by scripts/extract_huijiwiki.py)
Outputs: data/zh_identities.json   the same file, with ids 190-201 upserted

Source : https://limbuscompany.wiki.gg/wiki/Category:Limbus_Kindergarten_Identities

Run order matters: extract_limbusdeck -> extract_huijiwiki -> this script. The first
two rebuild every id from the English dataset and would drop these twelve, so this
script owns the ids >= FIRST_ID and re-adds them after each full rebuild.

These identities exist only on wiki.gg (huijiwiki never covered the event), so the
infobox is `{{ENPage/Invidiae` with English field values: sin names, damage types and
resistances are all translated locally. The wiki's `season=0` means the permanent
pool, which Limbusdeck folds into season 1 - the same value the base LCB identities
carry - so the season is stored as 1 with `season_wiki` remembering the raw label.
"""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
ZH_FILE = ROOT / "data" / "zh_identities.json"

API = "https://limbuscompany.wiki.gg/api.php"
CATEGORY = "Category:Limbus_Kindergarten_Identities"
UA = "LimbusdleBuild/0.1 (local dev scraper)"

# First id this script is allowed to write; ids below it belong to the pipeline.
FIRST_ID = 190

# wiki ENPage infobox vocabulary -> the Traditional Chinese the roster displays.
SIN_ZH = {
    "wrath": "暴怒",
    "lust": "色慾",
    "sloth": "怠惰",
    "gluttony": "暴食",
    "gloom": "憂鬱",
    "pride": "傲慢",
    "envy": "嫉妒",
}
DAMAGE_ZH = {"slash": "斬擊", "pierce": "突刺", "blunt": "打擊"}
RESISTANCE_ZH = {
    "fatal": "致命",
    "ineffective": "脆弱",
    "normal": "一般",
    "endured": "耐性",
}

# The sinner table from extract_huijiwiki, already in its Traditional spellings.
SINNER_ZH = {
    "Yi Sang": "李箱",
    "Faust": "浮士德",
    "Don Quixote": "堂吉訶德",
    "Ryoshu": "良秀",
    "Meursault": "默爾索",
    "Hong Lu": "鴻璐",
    "Heathcliff": "希斯克利夫",
    "Ishmael": "以實瑪利",
    "Rodion": "羅佳",
    "Sinclair": "辛克萊",
    "Outis": "奧提斯",
    "Gregor": "格里高爾",
}

# Keyword pages on the wiki double as the group and faction labels; the roster
# splits them into two separate tags (`獄兒園` + the class name).
GROUP_TAG_ZH = {
    "Cheery Chickies": "開朗小雞班",
    "Early Elephants": "早期大象班",
    "Perky Penguins": "活潑企鵝班",
    "Limbus Kindergarten": "獄兒園",
}

# Chinese skill names for all 48 skills (12 x skill1-3 + defense). The kindergarten
# pages are English-only, so every name is translated here rather than fetched.
SKILL_ZH = {
    # Cheery Chickies Class Captain Yi Sang
    "I Shell Trim": "我來修剪",
    "I Shell Do It!": "我來做!",
    "Is Ideal...": "這樣最理想…",
    "Is Nuthin' Unideal": "沒什麼不理想…",
    # Cheery Chickies Sinnerling Heathcliff
    "Hehehe!": "嘿嘿嘿!",
    "Brek Your Leg Wib Leg!": "用腿打斷你的腿!",
    "Dye!!": "死吧!!",
    "... Wacha Lookin' at?!": "看什麼看?!",
    # Cheery Chickies Sinnerling Ishmael
    "Heeey!": "喂——!",
    "Did I Do Good?": "我做得好嗎?",
    "Gimme Yer Meats!": "把肉交出來!",
    "Kick Its Butt, Plis!": "揍它一頓,拜託!",
    # Cheery Chickies Sinnerling Sinclair
    "C'mere!": "過來!",
    "I'm Gonna be Bwave, too...!": "我也要變勇敢…!",
    "Your Marinade...! I'll Puwge—": "你的醃料…我來抹除—",
    "Bwo! Bwo!": "哇嗚!哇嗚!",
    # Early Elephants Class Captain Faust
    "Hm.": "嗯。",
    "Paus will do dis.": "這樣就行。",
    "I Muss Impwove My Balance.": "我必須改善平衡。",
    "Bigger and Bigger...": "越來越大…",
    # Early Elephants Sinnerling Don Quixote
    "Jussis!": "正義!",
    "Jussis!!": "正義!!",
    "Jussis!!!": "正義!!!",
    "Jussis?": "正義?",
    # Early Elephants Sinnerling Hong Lu
    "Lets Get Dis~": "來吧~",
    "That's Weally Cool~": "那真的很酷~",
    "Not My Taste!": "不合我口味!",
    "Is Yummy?": "好吃嗎?",
    # Early Elephants Sinnerling Ryōshū
    "Heh.": "呵。",
    "Shotening.": "縮短。",
    "S.C.N.C.": "S.C.N.C.",
    "F.U.": "F.U.",
    # Perky Penguins Class Captain Outis
    "Pwocure Ingwedient!": "採購食材!",
    "Commewce Opewation!": "開始行動!",
    "Gaswonomical Experrance!": "美食體驗!",
    "Teach Dem a Lesson, Executive Teach!": "給他們教訓,執行長老師!",
    # Perky Penguins Sinnerling Gregor
    "Clo Grabber!": "搶過來!",
    "Havta Faight...": "不得不戰…",
    "Hiyah!!": "嘿呀!!",
    "Am Not Buggy!": "我才不是蟲子!",
    # Perky Penguins Sinnerling Meursault
    "Leave this to me.": "交給我。",
    "Prepare le Plat-doo-joor.": "準備今日特餐。",
    "Mizanplas.": "料理就緒。",
    "Mm.": "嗯。",
    # Perky Penguins Sinnerling Rodion
    "Hm Hm Hm~": "嗯哼哼~",
    "Sho Tashty!": "真好吃!",
    "Sumthing to Eat!": "來點吃的!",
    "Wan Tasty Food?": "想要美食嗎?",
}


def api(session: requests.Session, **params) -> dict:
    r = session.get(
        API,
        params={"format": "json", "formatversion": "2", **params},
        timeout=90,
    )
    r.raise_for_status()
    return r.json()


def fetch_titles(session: requests.Session) -> list[str]:
    data = api(
        session,
        action="query",
        list="categorymembers",
        cmtitle=CATEGORY,
        cmlimit="max",
    )
    titles = [
        m["title"]
        for m in data["query"]["categorymembers"]
        if not m["title"].startswith("Category:")
    ]
    return sorted(titles)


def fetch_wikitext(session: requests.Session, titles: list[str]) -> dict[str, str]:
    pages: dict[str, str] = {}
    for i in range(0, len(titles), 10):
        data = api(
            session,
            action="query",
            prop="revisions",
            rvslots="main",
            rvprop="content",
            titles="|".join(titles[i : i + 10]),
        )
        for page in data["query"]["pages"]:
            if "revisions" not in page:
                continue
            pages[page["title"]] = page["revisions"][0]["slots"]["main"]["content"]
    return pages


def fetch_portrait_urls(session: requests.Session, files: list[str]) -> dict[str, str]:
    """128px thumbnails of `|portrait=`, keyed by the raw `File:` name."""
    data = api(
        session,
        action="query",
        prop="imageinfo",
        iiprop="url",
        iiurlwidth="128",
        titles="|".join(files),
    )
    alias = {n["from"]: n["to"] for n in data["query"].get("normalized", [])}
    urls: dict[str, str] = {}
    for page in data["query"]["pages"]:
        info = page.get("imageinfo")
        if not info:
            continue
        resolved = page.get("title", "")
        source = next((f for f in files if alias.get(f, f) == resolved), None)
        if source:
            urls[source] = info[0].get("thumburl") or info[0]["url"]
    return urls


# --------------------------------------------------------------------------- parse


def parse_scalars(body: str) -> dict[str, str]:
    """Top-level `|key=value` pairs, with the multiline skill blocks stripped out."""
    stripped = re.sub(r"\|(?:skill[123]|defense)=\{\{Skill\n.*?\n\}\}", "", body, flags=re.S)
    return dict(re.findall(r"^\|(\w+)=(.*)$", stripped, re.M))


def parse_skills(body: str) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for key in ("skill1", "skill2", "skill3", "defense"):
        found = re.search(r"\|%s=\{\{Skill\n(.*?)\n\}\}" % key, body, re.S)
        if found:
            out[key] = dict(re.findall(r"^\|(\w+)=(.*)$", found.group(1), re.M))
    return out


def as_int(value: str | None) -> int | None:
    return int(value) if value and value.isdigit() else None


def slugify(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", ascii_text.lower())).strip("-")


def group_of(title: str) -> str:
    for group in GROUP_TAG_ZH:
        if title.startswith(f"{group} "):
            return group
    raise ValueError(f"no known group prefix on {title!r}")


def sinner_of(title: str) -> str:
    """`Cheery Chickies Sinnerling Heathcliff` -> `Heathcliff`, in limbusdeck spelling."""
    rest = title[len(group_of(title)) + 1 :]
    for prefix in ("Class Captain ", "Sinnerling "):
        if rest.startswith(prefix):
            rest = rest[len(prefix) :]
            break
    return "Ryoshu" if rest == "Ryōshū" else rest


def build_record(
    title: str,
    body: str,
    image: str,
    record_id: int,
) -> dict:
    scalars = parse_scalars(body)
    blocks = parse_skills(body)
    missing = [key for key in ("skill1", "skill2", "skill3", "defense") if key not in blocks]
    if missing:
        raise ValueError(f"{title}: missing {missing}")

    keywords = re.findall(r"\{\{Keyword\|([^}]+)\}\}", scalars.get("keyword", ""))
    tags = []
    for keyword in keywords:
        label = GROUP_TAG_ZH.get(keyword)
        if not label:
            raise ValueError(f"{title}: unknown keyword {keyword!r}")
        if label not in tags:
            tags.append(label)
    if "獄兒園" in tags:
        tags.remove("獄兒園")
    tags.insert(0, "獄兒園")

    sinner_en = sinner_of(title)
    skills_zh = []
    for key, slot in (("skill1", 1), ("skill2", 2), ("skill3", 3), ("defense", 4)):
        fields = blocks[key]
        name = fields.get("name")
        if not name:
            raise ValueError(f"{title}: skill {slot} has no name")
        if name not in SKILL_ZH:
            raise ValueError(f"{title}: no translation for {name!r}")

        skill_type = fields.get("type", "")
        role_word = {"Guard": "defense", "Evade": "evade", "Counter": "counter"}
        if slot == 4 and skill_type in role_word:
            # A defense slot that names its role instead of a damage type.
            role = role_word[skill_type]
            attack_type = None
        elif skill_type.lower() in DAMAGE_ZH:
            # Damage types fill slots 1-3; on slot 4 they mark a defensive skill
            # that still swings (Sinclair and Rodion both ship one).
            role = "attack" if slot < 4 else "defense"
            attack_type = DAMAGE_ZH[skill_type.lower()]
        else:
            raise ValueError(f"{title}: skill {slot} has unknown type {skill_type!r}")

        sin = (fields.get("sin") or "").lower()
        modifier = fields.get("atkmod") or fields.get("defmod") or None
        skills_zh.append(
            {
                "slot": slot,
                "variant": 1,
                "enhanced": False,
                "role": role,
                "name_zh": SKILL_ZH[name],
                "attack_type_zh": attack_type,
                "sin_zh": SIN_ZH.get(sin),
                "extra_sins_zh": [],
                "coin_cost": as_int(fields.get("coin")),
                "base_power": as_int(fields.get("spower")),
                "coin_power": re.sub(r"\s+", "", fields["cpower"]) if fields.get("cpower") else None,
                "modifier": re.sub(r"\s+", "", modifier) if modifier else None,
                "attack_capacity": None,
            }
        )

    def sin_of(skill: dict) -> str | None:
        return skill["sin_zh"]

    if sin_of(skills_zh[0]) is None:
        raise ValueError(f"{title}: skill 1 has no sin")
    primary_en = next(en for en, zh in SIN_ZH.items() if zh == sin_of(skills_zh[0]))
    sins_en = sorted(
        {
            en
            for zh in [sin_of(skill) for skill in skills_zh]
            if zh
            for en, mapped in SIN_ZH.items()
            if mapped == zh
        }
    )
    # Matches the base roster: damage types in order of first appearance across the
    # three attacks, sins sorted alphabetically (both conventions dominate there).
    damage_en: list[str] = []
    for i in (1, 2, 3):
        dtype = blocks[f"skill{i}"].get("type", "").lower()
        if dtype in DAMAGE_ZH and dtype not in damage_en:
            damage_en.append(dtype)
    resistances = {}
    for key in ("slash", "pierce", "blunt"):
        raw = scalars.get(key, "").lower()
        resistances[key] = raw if raw in RESISTANCE_ZH else "normal"
    speed = scalars.get("speed", "1~1")
    min_speed, max_speed = (int(part) for part in speed.split("~"))
    hp = as_int(scalars.get("hp"))
    if hp is None:
        raise ValueError(f"{title}: no hp")

    group = group_of(title)
    captain = "-班長" if title.startswith(f"{group} Class Captain ") else ""
    if tags != ["獄兒園", GROUP_TAG_ZH[group]]:
        raise ValueError(f"{title}: unexpected tags {tags}")

    return {
        "id": record_id,
        "slug": slugify(title),
        "name": title,
        "sinner": sinner_en,
        "rarity": int(scalars.get("rarity", "1")),
        "season": 1,
        "faction": "Limbus Kindergarten",
        "damage_types": damage_en,
        "sin_affinities": sins_en,
        "primary_sin": primary_en,
        "keywords": [],
        "hp_base": hp,
        "min_speed": min_speed,
        "max_speed": max_speed,
        "resistances": resistances,
        "image": image,
                "name_zh": f"{GROUP_TAG_ZH[group]}{captain}",
        "sinner_zh": SINNER_ZH[sinner_en],
        "tags_zh": tags,
        "damage_types_zh": [DAMAGE_ZH[d] for d in damage_en],
        "sin_affinities_zh": [SIN_ZH[en] for en in sins_en],
        "primary_sin_zh": SIN_ZH[primary_en],
        "keywords_zh": [],
        "season_zh": "第1賽季",
        "season_wiki": "常駐",
        "resistances_zh": {k: RESISTANCE_ZH[v] for k, v in resistances.items()},
        "skills_zh": skills_zh,
        "wiki_page": title,
    }


# --------------------------------------------------------------------------- main


def main() -> int:
    session = requests.Session()
    session.headers.update({"User-Agent": UA})

    titles = fetch_titles(session)
    print(f"[1/4] {CATEGORY}: {len(titles)} identities")
    if len(titles) != 12:
        print("expected exactly 12 pages", file=sys.stderr)
        return 1

    pages = fetch_wikitext(session, titles)
    missing = [t for t in titles if t not in pages]
    if missing:
        print(f"missing wikitext: {missing}", file=sys.stderr)
        return 1
    print(f"[2/4] fetched {len(pages)} wikitexts")

    # The infobox's `|portrait=` points at files that were never uploaded; the icon
    # that actually exists on the wiki is `<page title> Icon.png` (256x256, square).
    icons = {title: f"File:{title} Icon.png" for title in titles}
    urls = fetch_portrait_urls(session, sorted(icons.values()))
    print(f"[3/4] resolved {len(urls)}/{len(icons)} identity icons")

    records = []
    for index, title in enumerate(titles):
        filename = icons[title]
        image = urls.get(filename) or (
            f"https://limbuscompany.wiki.gg/wiki/Special:FilePath/"
            f"{filename.removeprefix('File:').replace(' ', '_')}?width=128"
        )
        records.append(build_record(title, pages[title], image, FIRST_ID + index))

    existing = json.loads(ZH_FILE.read_text(encoding="utf-8"))
    kept = [r for r in existing if r["id"] < FIRST_ID]
    ids = [r["id"] for r in kept]
    if ids != sorted(ids) or len(ids) != len(set(ids)):
        print("existing ids below FIRST_ID are not unique", file=sys.stderr)
        return 1
    merged = kept + records
    if len({r["id"] for r in merged}) != len(merged):
        print("id collision after merge", file=sys.stderr)
        return 1
    ZH_FILE.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[4/4] wrote {len(merged)} identities ({len(records)} kindergarten, ids {FIRST_ID}-{FIRST_ID + 11})")

    for record in records:
        print(
            f"      {record['id']} {record['name_zh']}  tags={record['tags_zh']}  "
            f"sin={record['sin_affinities_zh']}  dmg={record['damage_types_zh']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
