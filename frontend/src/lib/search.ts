import pinyin from '../data/pinyin.json'
import type { Identity } from '../types'

/** character -> pinyin without tones, e.g. "李" -> "li", "箱" -> "xiang". */
const READINGS = pinyin as Record<string, string>

const CJK = /[\u3400-\u9fff]/

function transliterate(text: string): { full: string; initials: string } {
  let full = ''
  let initials = ''
  for (const char of text) {
    const reading = READINGS[char]
    if (reading) {
      full += reading
      initials += reading[0]
    } else {
      full += char
      initials += char
    }
  }
  return { full, initials }
}

export type SearchEntry = {
  identity: Identity
  /** Lowercased Chinese name, matched as a plain substring. */
  zh: string
  /** Concatenated pinyin, so "lixiang" finds 李箱. */
  full: string
  /** One letter per character, so "lx" finds 李箱. */
  initials: string
  /** Same three forms for the sinner, because players search by either. */
  sinnerZh: string
  sinnerFull: string
  sinnerInitials: string
  /** Lowercased English name, e.g. "lcb sinner yi sang". */
  en: string
}

function build(identities: Identity[]): SearchEntry[] {
  return identities.map((identity) => {
    const zh = identity.name_zh.toLowerCase()
    const sinnerZh = identity.sinner_zh.toLowerCase()
    const name = transliterate(zh)
    const sinner = transliterate(sinnerZh)
    return {
      identity,
      zh,
      full: name.full,
      initials: name.initials,
      sinnerZh,
      sinnerFull: sinner.full,
      sinnerInitials: sinner.initials,
      en: identity.name.toLowerCase(),
    }
  })
}

export function buildSearchIndex(identities: Identity[]): SearchEntry[] {
  return build(identities)
}

/**
 * Score a query against the index.
 *
 * Ranking, strongest first:
 *   0-2   exact name        "李箱" / "lx" / "lixiang"
 *   3-5   name prefix      "箱", "lxiang"
 *   6-7   English name
 *   8-13  sinner name      "李箱" as a sinner, not an identity
 *   14-18 substring anywhere in the above
 *
 * Identity-name matches always outrank sinner-name matches. Both 李箱 and 良秀
 * romanise to "lx", so without that ordering a query for one sinner would bury every
 * identity belonging to it.
 */
export function scoreEntry(entry: SearchEntry, query: string): number {
  if (!query) return -1

  if (entry.zh === query) return 0
  if (entry.initials === query) return 1
  if (entry.full === query) return 2

  if (entry.zh.startsWith(query)) return 3
  if (entry.initials.startsWith(query)) return 4
  if (entry.full.startsWith(query)) return 5

  if (entry.en === query) return 6
  if (entry.en.startsWith(query)) return 7

  if (entry.sinnerZh === query) return 8
  if (entry.sinnerInitials === query) return 9
  if (entry.sinnerFull === query) return 10
  if (entry.sinnerZh.startsWith(query)) return 11
  if (entry.sinnerInitials.startsWith(query)) return 12
  if (entry.sinnerFull.startsWith(query)) return 13

  if (entry.zh.includes(query)) return 14
  if (entry.full.includes(query)) return 15
  if (entry.en.includes(query)) return 16
  if (entry.sinnerFull.includes(query)) return 17
  if (entry.sinnerInitials.includes(query)) return 18

  return -1
}

export type SearchResult = { identity: Identity; score: number }

/**
 * Rank matches. Ties break on name length then identity id so the ordering is stable
 * across renders - the list must not reshuffle while the player is arrow-keying it.
 */
export function search(
  index: SearchEntry[],
  rawQuery: string,
  limit = 12,
  exclude: ReadonlySet<number> = new Set(),
): SearchResult[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return []

  const hits: SearchResult[] = []
  for (const entry of index) {
    if (exclude.has(entry.identity.id)) continue
    const score = scoreEntry(entry, query)
    if (score >= 0) hits.push({ identity: entry.identity, score })
  }

  hits.sort(
    (a, b) =>
      a.score - b.score ||
      a.identity.name_zh.length - b.identity.name_zh.length ||
      a.identity.id - b.identity.id,
  )
  return hits.slice(0, limit)
}

/** True when the query is Chinese text, so we should prefer substring over initials. */
export function isCjkQuery(query: string): boolean {
  return CJK.test(query)
}