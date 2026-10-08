"""Phase 1 - extract the Limbusdeck identity database into data/en_identities.json.

limbusdeck.com is a Next.js App Router SPA. Neither the server-rendered HTML nor
the RSC flight payload contain the database (pages ship skeletons only), but the
app does ship one JS chunk with the full record set embedded as a JS object
literal. We locate that chunk by its `IDENTITIES` export, parse the literal, and
flatten it into the schema the rest of the project expects.

Source: https://limbusdeck.com/en/database/identities
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from jsliteral import resolve_export

BASE = "https://limbusdeck.com"
PAGE = f"{BASE}/en/database/identities"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
OUT = Path(__file__).resolve().parent.parent / "data" / "en_identities.json"
IMAGE_BASE = "https://assets.limbusdeck.com"

# Limbus damage types; `counter`/`guard` show up on defensive skills and are not
# part of the damage-type triad.
DAMAGE_TYPES = ("slash", "pierce", "blunt")
SINS = ("wrath", "lust", "sloth", "gluttony", "gloom", "pride", "envy")


def get(url: str) -> str:
    r = requests.get(url, headers={"User-Agent": UA}, timeout=60)
    r.raise_for_status()
    # the CDN sends no charset, so decode explicitly instead of trusting requests
    return r.content.decode("utf-8", errors="replace")


def chunk_urls(html: str) -> list[str]:
    return sorted({f"{BASE}{s}" for s in re.findall(r'<script[^>]*src="([^"]+\.js)"', html)})


def collect_iter_sins(identity: dict) -> list[str]:
    """Every sin referenced by the identity's skills and passives."""
    sins: set[str] = set()
    buckets = [identity.get("skills"), identity.get("defenseSkills"), identity.get("passives")]
    for bucket in buckets:
        for entry in bucket or []:
            for key in ("sin", "conditionSin"):
                v = entry.get(key)
                if isinstance(v, str) and v in SINS:
                    sins.add(v)
            for cond in entry.get("extraConditions") or []:
                v = cond.get("sin")
                if v in SINS:
                    sins.add(v)
    return sorted(sins)


def collect_damage_types(identity: dict) -> list[str]:
    types: set[str] = set()
    for entry in (identity.get("skills") or []) + (identity.get("defenseSkills") or []):
        for variant in [entry] + list(entry.get("variants") or []):
            at = variant.get("attackType")
            if at in DAMAGE_TYPES:
                types.add(at)
    return [t for t in DAMAGE_TYPES if t in types]


def collect_keywords(identity: dict) -> list[str]:
    """Union of the top-level keyword list and every keyword attached to a skill."""
    kws: set[str] = set(identity.get("keywords") or [])
    buckets = [identity.get("skills"), identity.get("defenseSkills"), identity.get("passives")]
    for bucket in buckets:
        for entry in bucket or []:
            for variant in [entry] + list(entry.get("variants") or []):
                for kw in variant.get("keywords") or []:
                    if isinstance(kw, dict) and kw.get("keyword"):
                        kws.add(kw["keyword"])
                    elif isinstance(kw, str):
                        kws.add(kw)
            for eff in entry.get("effects") or []:
                if eff.get("keyword"):
                    kws.add(eff["keyword"])
    return sorted(kws)


def collect_primary_sin(identity: dict) -> str | None:
    """Limbusdeck only tags `primarySin` on its "new arrivals" list; derive it from
    the identity's first offensive skill instead."""
    for entry in identity.get("skills") or []:
        if entry.get("sin") in SINS:
            return entry["sin"]
    sins = collect_iter_sins(identity)
    return sins[0] if sins else None


def main() -> int:
    html = get(PAGE)
    chunks = chunk_urls(html)
    print(f"[1/4] page fetched ({len(html)} bytes), {len(chunks)} chunks referenced")

    data_chunk = None
    for url in chunks:
        text = get(url)
        if '"IDENTITIES"' in text and "wikiSynced" in text:
            data_chunk = (url, text)
            break
    if not data_chunk:
        print("could not find the chunk carrying the identity database", file=sys.stderr)
        return 1
    url, text = data_chunk
    print(f"[2/4] database chunk: {url.rsplit('/', 1)[-1]} ({len(text)} bytes)")

    # sinner roster + trait (faction) names live in sibling chunks; fetch all so we
    # can resolve sinnerId and traits into readable English.
    pool = [text]
    for u in chunks:
        if u != url:
            pool.append(get(u))

    def export(name: str, validate=None):
        for chunk in pool:
            value = resolve_export(chunk, name, validate)
            if value:
                return value
        return None

    sinners = export("SINNERS") or []
    sinner_by_id = {s["id"]: s for s in sinners}
    traits_raw = export("TRAITS") or {}
    trait_by_slug = {k: (v.get("en") or k) for k, v in traits_raw.items() if isinstance(v, dict)}
    keywords_known = export("KEYWORDS") or []
    print(
        f"[3/4] resolved {len(sinners)} sinners, {len(traits_raw)} traits, "
        f"{len(keywords_known)} keywords"
    )

    def looks_like_identities(value) -> bool:
        return (
            isinstance(value, list)
            and bool(value)
            and all(isinstance(v, dict) and "sinnerId" in v and "id" in v for v in value)
        )

    records = export("IDENTITIES", looks_like_identities) or []
    print(f"      {len(records)} raw identity records")

    out: list[dict] = []
    for rec in records:
        sinner = sinner_by_id.get(rec.get("sinnerId"))
        trait_slugs = [t for t in (rec.get("traits") or []) if t]
        factions = [trait_by_slug.get(t, t) for t in trait_slugs]
        rarity = rec.get("rarity")
        season = rec.get("season")
        slug = rec.get("slug") or ""
        out.append(
            {
                "id": rec.get("id"),
                "slug": slug,
                "name": rec.get("nameEn"),
                "name_ko": rec.get("nameKo"),
                "sinner_id": rec.get("sinnerId"),
                "sinner": (sinner or {}).get("nameEn"),
                "sinner_slug": (sinner or {}).get("slug"),
                "rarity": rarity if isinstance(rarity, int) else 0,
                "season": season if isinstance(season, int) else 0,
                "release_date": rec.get("releaseDate"),
                "faction": factions[0] if factions else None,
                "factions": factions,
                "damage_types": collect_damage_types(rec),
                "sin_affinities": collect_iter_sins(rec),
                "primary_sin": collect_primary_sin(rec),
                "keywords": collect_keywords(rec),
                "hp_base": rec.get("hpBase"),
                "min_speed": rec.get("minSpeed"),
                "max_speed": rec.get("maxSpeed"),
                "defense_level": rec.get("defenseLevel"),
                "resistances": rec.get("resistances"),
                "image": f"{IMAGE_BASE}/identities/thumbnail/{slug}.webp",
                "image_full": f"{IMAGE_BASE}/identities/full/{slug}.webp",
            }
        )

    out.sort(key=lambda r: (r["id"] if isinstance(r["id"], int) else 0))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[4/4] wrote {len(out)} identities -> {OUT}")
    return 0


def parse_object_export(text: str, export: str) -> dict:
    return resolve_export(text, export) or {}


if __name__ == "__main__":
    raise SystemExit(main())
