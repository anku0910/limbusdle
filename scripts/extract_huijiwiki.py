"""Phase 2 - pull the Traditional Chinese names from huijiwiki and emit the
frontend dictionaries.

    python scripts/extract_huijiwiki.py

Inputs : data/en_identities.json   (produced by scripts/extract_limbusdeck.py)
Outputs: data/i18n_dict.json       attribute / keyword / faction translations
         data/zh_identities.json   one record per identity, keyed like the English file

Source : https://limbuscompany.huijiwiki.com/wiki/分类:人格

The wiki stores its wikitext in Simplified Chinese and advertises no language
variants, so `action=parse&variant=zh-hant` returns the text unchanged; the
Simplified -> Traditional pass is done locally with OpenCC instead.

Two MediaWiki endpoints back this script:

* `Data:Identitychoose.tabx` is a Cargo-style data page whose wikitext is a JSON
  blob with a `schema`/`data` pair. It holds one row per identity (name, sinner,
  rarity, HP, resistances, speeds, ...) and is far more convenient to join
  against than the rendered pages.
* the `分类:人格` category enumerates the 189 personality pages, which are the
  only place the Chinese *skill* names and status keywords appear.

Because neither dataset carries the other's identifiers, records are paired with
a cascade of progressively looser keys (sinner + rarity + release date + HP +
resistances, then dropping the date, ...). The four identities that even the
loosest key cannot pair are caught by `png1`, the numeric identity id that both
sides happen to encode in different places.
"""

from __future__ import annotations

import html
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import opencc
import requests

ROOT = Path(__file__).resolve().parent.parent
EN_FILE = ROOT / "data" / "en_identities.json"
I18N_FILE = ROOT / "data" / "i18n_dict.json"
ZH_FILE = ROOT / "data" / "zh_identities.json"
CACHE = ROOT / ".cache" / "huijiwiki_pages.json"

API = "https://limbuscompany.huijiwiki.com/api.php"
CATEGORY = "分类:人格"
DATA_PAGE = "Data:Identitychoose.tabx"
UA = "LimbusdleBuild/0.1 (local dev scraper)"

# wiki resistance code -> Limbusdeck vocabulary
RESISTANCE = {0: "ineffective", 1: "normal", 2: "fatal", 3: "endured"}
# ...and the Chinese labels, taken from 模板:颜色 which colour-codes the four tiers.
RESISTANCE_ZH = {
    "ineffective": "脆弱",
    "normal": "一般",
    "fatal": "致命",
    "endured": "耐性",
}

# Simplified sinner names as spelled in the data table; the Traditional forms used
# in the output are produced by OpenCC so the two can never drift apart.
SINNER = {
    "Yi Sang": "李箱",
    "Faust": "浮士德",
    "Don Quixote": "堂吉诃德",
    "Ryoshu": "良秀",
    "Meursault": "默尔索",
    "Hong Lu": "鸿璐",
    "Heathcliff": "希斯克利夫",
    "Ishmael": "以实玛利",
    "Rodion": "罗佳",
    "Sinclair": "辛克莱",
    "Outis": "奥提斯",
    "Gregor": "格里高尔",
}

# The wiki writes 穿刺 on personality pages but 突刺 in the data table and in the
# 突刺易损 / 突刺伤害强化 status pages; the game uses the spec's 突刺.
DAMAGE_ZH = {"slash": "斬擊", "pierce": "突刺", "blunt": "打擊"}
SIN_ZH = {
    "wrath": "暴怒",
    "lust": "色慾",
    "sloth": "怠惰",
    "gluttony": "暴食",
    "gloom": "憂鬱",
    "pride": "傲慢",
    "envy": "嫉妒",
}
# Keyword names, each confirmed against its 状态效果 page. The wiki calls the
# "damage taken +x%" status (Limbusdeck's `poise`) 易損; we ship it as 呼吸.
KEYWORD_ZH = {
    "burn": "燒傷",
    "bleed": "流血",
    "tremor": "震顫",
    "rupture": "破裂",
    "sinking": "沉淪",
    "poise": "呼吸",
    "charge": "充能",
    "haste": "迅捷",
    "offense_down": "攻擊等級降低",
}

# Personality pages carry one block of fields per skill slot, keyed
# `|N技能-<字段>`. Only the first three slots are attack skills: slot 4 is the
# defense skill and slots 5-8 belong to the handful of identities that ship
# extra ones. Modified identities add sub-variants (`|3技能2-<字段>` is a
# second version of skill 3) and enhanced identities add `|强化N技能-<字段>`.
SKILL_FIELD_RE = re.compile(r"\|(强化)?(\d)技能(\d)?-([^=\n|]+)=([^\n|]*)")
# A block with no `类型` still states what it is one field up: `|6技能类型=攻击`.
SKILL_KIND_RE = re.compile(r"\|(?:强化)?(\d)技能类型=([^\n|]*)")
SKILL_TIER_RE = re.compile(r"^(\d)阶(技能威力|硬币威力)$")

# What the skill actually is, as opposed to what it hits with. Matched on a
# head word so it works on both the wiki's Simplified and Traditional spellings
# and on the `类型` value when a slot has one.
SKILL_ROLES = (
    (("防御", "防禦"), "defense"),
    (("闪避", "閃避"), "evade"),
    (("反击", "反擊"), "counter"),
    (("攻击", "攻擊"), "attack"),
    (("守备", "守備"), "guard"),
)
EXTRA_SIN_RE = re.compile(r"罪孽-([^\]\n]+?)\.png")


def skill_role(*values: str | None) -> str:
    for value in values:
        if not value:
            continue
        for names, role in SKILL_ROLES:
            if any(value.startswith(name) for name in names):
                return role
    return "attack"

TO_TRAD = opencc.OpenCC("s2t")


def api(**params) -> dict:
    r = requests.get(
        API,
        params={"format": "json", "formatversion": "2", **params},
        headers={"User-Agent": UA},
        timeout=90,
    )
    r.raise_for_status()
    return r.json()


def trad(text: str | None) -> str | None:
    return TO_TRAD.convert(text) if text else text


def clean(text: str | None) -> str | None:
    """Strip wiki/HTML cruft and convert to Traditional."""
    if not text:
        return text
    out = re.sub(r"<[^>]+>", "", text)
    out = html.unescape(out).replace("_", " ")
    return re.sub(r"\s+", " ", trad(out)).strip() or None


def parse_skills(body: str, defense: str | None = None) -> list[dict]:
    """Every skill block on a personality page, in slot then variant order.

    Coin cost, base power, coin power and the modifier are all stored because the
    sites this data is checked against show them next to each skill. The `N阶`
    fields repeat the power pair for every upgrade tier, so only the topmost tier
    present is kept. `defense` is the tabx's `skill4def`, the canonical name for
    the defense skill, which the page itself only names colloquially (防御, 闪避,
    反击_斩击, ...).
    """
    blocks: dict[tuple[bool, int, int], dict[str, str]] = {}
    for enhanced, slot, variant, field, value in SKILL_FIELD_RE.findall(body):
        key = (bool(enhanced), int(slot), int(variant) if variant else 1)
        blocks.setdefault(key, {})[field.strip()] = clean(value) or ""

    kinds = {int(slot): clean(value) for slot, value in SKILL_KIND_RE.findall(body)}

    def extra_sin(value: str) -> str | None:
        # `罪孽1` is a bare name, `罪孽2` carries an "追加属性：" prefix and a
        # link to the sin's icon file.
        found = EXTRA_SIN_RE.search(value)
        if found:
            return clean(found.group(1))
        return clean(value.split("：")[-1])

    skills = []
    for (enhanced, slot, variant), fields in sorted(blocks.items()):
        name = fields.get("名称")
        if not name:
            continue

        tiers: dict[int, dict[str, str]] = {}
        for field, value in fields.items():
            found = SKILL_TIER_RE.match(field)
            if found:
                tiers.setdefault(int(found.group(1)), {})[found.group(2)] = value
        top = tiers[max(tiers)] if tiers else {}

        kind = fields.get("类型") or kinds.get(slot) or ""
        if slot == 4 and defense:
            role = skill_role(defense)
        else:
            role = skill_role(kinds.get(slot), kind, name)

        # `罪孽` is the skill's own sin; `罪孽1`/`罪孽2` hold the sins a defense
        # skill applies to itself. The wiki is inconsistent about which of the
        # three is populated, and a defense skill often repeats one sin, so the
        # set is collected and deduplicated with the first entry becoming the
        # primary.
        sins: list[str] = []
        for raw in (fields.get("罪孽"), fields.get("罪孽1"), fields.get("罪孽2")):
            found = extra_sin(raw or "")
            if found and found not in sins:
                sins.append(found)

        skills.append(
            {
                "slot": slot,
                "variant": variant,
                "enhanced": enhanced,
                "role": role,
                "name_zh": name,
                "attack_type_zh": fields.get("类型") or None,
                "sin_zh": sins[0] if sins else None,
                "extra_sins_zh": sins[1:],
                "coin_cost": int(fields["硬币数"]) if fields.get("硬币数", "").isdigit() else None,
                "base_power": int(top["技能威力"]) if top.get("技能威力", "").isdigit() else None,
                "coin_power": top.get("硬币威力") or None,
                "modifier": fields.get("修正值") or None,
                "attack_capacity": int(fields["攻击容量"])
                if fields.get("攻击容量", "").isdigit()
                else None,
            }
        )
    # An enhanced skill is the upgraded form of the base skill in the same slot and
    # the wiki omits its sin, so fall back to the one it upgrades.
    by_key = {(s["enhanced"], s["slot"], s["variant"]): s for s in skills}
    for skill in skills:
        if skill["sin_zh"] or not skill["enhanced"]:
            continue
        base = by_key.get((False, skill["slot"], skill["variant"]))
        if base:
            skill["sin_zh"] = base["sin_zh"]
            skill["extra_sins_zh"] = list(base["extra_sins_zh"])
    return skills


def parse_date(value: str) -> date:
    return date(*map(int, value.replace(".", "-").split("-")))


# --------------------------------------------------------------------------- fetch


def fetch_table() -> list[dict]:
    """Rows of Data:Identitychoose.tabx as dicts keyed by column name."""
    data = api(
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


def fetch_category() -> list[str]:
    data = api(action="query", list="categorymembers", cmtitle=CATEGORY, cmlimit="max")
    return [m["title"] for m in data["query"]["categorymembers"]]


def resolve_alias(alias: dict[str, str], title: str) -> str:
    """Follow a normalisation chain such as `_` -> space then `:` -> `::` to its end."""
    seen = {title}
    while title in alias and alias[title] not in seen:
        title = alias[title]
        seen.add(title)
    return title


def fetch_wikitext(titles: list[str]) -> dict[str, str]:
    """Raw wikitext keyed by every title that should resolve to it.

    The data table and the wiki disagree on the punctuation of the E.G.O and
    高级定制 titles (`X E.G.O:Foo` in the table, `X E.G.O::Foo` on the page), so
    request both spellings and let `redirects=1` plus MediaWiki's own
    normalisation map each of them onto the same body.
    """
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))

    pages: dict[str, str] = {}
    for i in range(0, len(titles), 50):
        batch = titles[i : i + 50]
        data = api(
            action="query",
            prop="revisions",
            rvslots="main",
            rvprop="content",
            redirects="1",
            titles="|".join(batch),
        )
        alias = {n["from"]: n["to"] for n in data["query"].get("normalized", [])}
        alias.update({n["from"]: n["to"] for n in data["query"].get("redirects", [])})
        for page in data["query"]["pages"]:
            if "revisions" not in page:
                continue
            body = page["revisions"][0]["slots"]["main"]["content"]
            pages[page["title"]] = body
            for src in alias:
                if resolve_alias(alias, src) == page["title"]:
                    pages[src] = body
        print(f"      pages {min(i + 50, len(titles))}/{len(titles)}")
    return pages


# --------------------------------------------------------------------------- join


def join_records(en: list[dict], rows: list[dict]) -> dict[int, str]:
    """Pair each English record with a wiki row, one to one.

    Both datasets describe the same 189 identities but neither carries the other's
    key, and the sources disagree on a handful of values (off-by-one release dates,
    post-launch HP rebalances, a rotated resistance column). So try the exact key
    first and relax it only as far as needed to keep the mapping bijective.
    """

    def exact(row):
        return (
            row["belong"], row["rarity"], row["time"].replace(".", "-"), row["hp"],
            RESISTANCE[row["sres"]], RESISTANCE[row["pres"]], RESISTANCE[row["hres"]],
        )

    def no_date(row):
        return (
            row["belong"], row["rarity"], row["hp"],
            RESISTANCE[row["sres"]], RESISTANCE[row["pres"]], RESISTANCE[row["hres"]],
        )

    def date_rarity(row):
        return (row["belong"], row["rarity"], row["time"].replace(".", "-"))

    def date_off_by_one(row):
        return (row["belong"], row["rarity"], parse_date(row["time"]).toordinal())

    def hp_only(row):
        return (row["belong"], row["rarity"], row["hp"])

    tiers = [
        ("exact", exact, lambda e: (SINNER[e["sinner"]], e["rarity"], e["release_date"],
                                    e["hp_base"], e["resistances"]["slash"],
                                    e["resistances"]["pierce"], e["resistances"]["blunt"])),
        ("no-date", no_date, lambda e: (SINNER[e["sinner"]], e["rarity"], e["hp_base"],
                                        e["resistances"]["slash"], e["resistances"]["pierce"],
                                        e["resistances"]["blunt"])),
        ("date-only", date_rarity, lambda e: (SINNER[e["sinner"]], e["rarity"],
                                               e["release_date"])),
        ("date+-1", date_off_by_one, lambda e: (SINNER[e["sinner"]], e["rarity"],
                                                 parse_date(e["release_date"]).toordinal())),
        ("hp-only", hp_only, lambda e: (SINNER[e["sinner"]], e["rarity"], e["hp_base"])),
    ]

    used: set[str] = set()
    pairs: dict[int, str] = {}
    usage: dict[str, int] = defaultdict(int)
    for label, row_key, en_key in tiers:
        index: dict[tuple, list[dict]] = defaultdict(list)
        for row in rows:
            index[row_key(row)].append(row)
        for record in en:
            if record["id"] in pairs:
                continue
            candidates = [r for r in index.get(en_key(record), []) if r["name"] not in used]
            if len(candidates) == 1:
                pairs[record["id"]] = candidates[0]["name"]
                used.add(candidates[0]["name"])
                usage[label] += 1
    print(f"      joined {len(pairs)}/{len(en)} via {dict(usage)}")
    return pairs


# --------------------------------------------------------------------------- main


def main() -> int:
    en = json.loads(EN_FILE.read_text(encoding="utf-8"))
    print(f"[1/5] {len(en)} English records from {EN_FILE.name}")

    rows = fetch_table()
    print(f"[2/5] {DATA_PAGE}: {len(rows)} rows")

    titles = fetch_category()
    wanted = sorted({*titles, *(r["name"] for r in rows)})
    print(f"[3/5] {CATEGORY}: {len(titles)} pages, {len(wanted)} titles to fetch")
    pages = fetch_wikitext(wanted)
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(pages, ensure_ascii=False), encoding="utf-8")
    print(f"      {len(pages)} pages cached (with redirects resolved)")

    pairs = join_records(en, rows)
    if len(pairs) != len(en):
        print("join is incomplete", file=sys.stderr)
        return 1
    by_name = {r["name"]: r for r in rows}

    # Limbusdeck's `faction` is a trait name ("Fixer", "Syndicate", ...) with no
    # Chinese counterpart of its own, and `organize2` only names the individual
    # squad. The wiki's `tag` column already lists the complete set of labels a
    # person belongs to, full-width-comma separated -- 李箱Seven协会南部6科 carries
    # `收尾人，Seven协会`, which is exactly the 收尾人 / Seven協會 pair the roster
    # needs. So the labels are read straight off the column instead of guessing.
    tags: dict[int, list[str]] = {}
    thin = []
    for record in en:
        row = by_name[pairs[record["id"]]]
        labels = []
        for value in re.split(r"[,，]", row["tag"] or ""):
            label = clean(value)
            if label and label not in labels:
                labels.append(label)
        affiliation = clean(row["organize2"])
        if affiliation and affiliation not in labels:
            labels.append(affiliation)
        tags[record["id"]] = labels
        if len(labels) < 2:
            thin.append(record["name"])
    print(f"      {sum(1 for v in tags.values() if v)} identities with tags; {len(thin)} with one or none")
    for name in thin[:5]:
        print(f"        {name}")

    # Limbusdeck stores season as an integer; the wiki's `season` column is a free
    # text label whose vocabulary does not line up (it distinguishes 常驻 from
    # 第1赛季, while Limbusdeck folds both into 1), so the display label is derived
    # from the integer and the raw wiki string is kept alongside it for reference.
    season_zh = {n: f"第{n}賽季" for n in sorted({r["season"] for r in en if r["season"]})}

    out = []
    for record in en:
        row = by_name[pairs[record["id"]]]
        body = pages.get(pairs[record["id"]], "")
        out.append(
            {
                **{k: record[k] for k in
                   ("id", "slug", "name", "sinner", "rarity", "season", "faction",
                    "damage_types", "sin_affinities", "primary_sin", "keywords",
                    "hp_base", "min_speed", "max_speed", "resistances", "image")},
                # The wiki spells the full name with the sinner in front
                # ("李箱Seven協會南部6科"); the game keeps the sinner only on
                # sinner_zh, so the identity name drops that prefix.
                "name_zh": clean(row["name"]).removeprefix(trad(row["belong"])),
                "sinner_zh": trad(row["belong"]),
                "tags_zh": tags[record["id"]],
                "damage_types_zh": [DAMAGE_ZH[t] for t in record["damage_types"] if t in DAMAGE_ZH],
                "sin_affinities_zh": [SIN_ZH[s] for s in record["sin_affinities"] if s in SIN_ZH],
                "primary_sin_zh": SIN_ZH.get(record["primary_sin"]),
                "keywords_zh": [KEYWORD_ZH[k] for k in record["keywords"] if k in KEYWORD_ZH],
                "season_zh": season_zh.get(record["season"]),
                "season_wiki": trad(row["season"]),
                "resistances_zh": {k: RESISTANCE_ZH[v] for k, v in record["resistances"].items()},
                "skills_zh": parse_skills(body, trad(row["skill4def"])),
                "wiki_page": pairs[record["id"]],
            }
        )

    i18n = {
        "sinner": {en_name: trad(zh_name) for en_name, zh_name in SINNER.items()},
        "damage_types": DAMAGE_ZH,
        "sins": SIN_ZH,
        "keywords": KEYWORD_ZH,
        "resistances": RESISTANCE_ZH,
        "tags": {r["faction"]: r["tags_zh"] for r in out if r["faction"]},
        "seasons": {str(k): v for k, v in season_zh.items()},
    }
    I18N_FILE.parent.mkdir(parents=True, exist_ok=True)
    I18N_FILE.write_text(json.dumps(i18n, ensure_ascii=False, indent=2), encoding="utf-8")
    ZH_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[4/5] wrote {len(i18n['tags'])} tag sets, {len(SIN_ZH)} sins, "
          f"{len(KEYWORD_ZH)} keywords -> {I18N_FILE.name}")
    print(f"[5/5] wrote {len(out)} identities -> {ZH_FILE.name}")

    missing = [r["name"] for r in out if not r["name_zh"]]
    if missing:
        print(f"      {len(missing)} identities without a Chinese name: {missing[:5]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())