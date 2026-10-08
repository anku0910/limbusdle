import type { Identities } from '../types'

/** 標籤出現在幾筆人格上。 */
export function tagCounts(identities: readonly { tags_zh: string[] }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const identity of identities)
    for (const tag of identity.tags_zh) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return counts
}

/** 只被一筆人格使用的標籤，照 zh-Hant 拼音排序。 */
export function orphanTags(identities: readonly { tags_zh: string[] }[]): string[] {
  return [...tagCounts(identities)]
    .filter(([, count]) => count === 1)
    .map(([tag]) => tag)
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
}

/** 重新命名（或合併進既有標籤）：全域替換並去重，不會把任何一筆清成零標籤。 */
export function replaceTag(identities: Identities, from: string, to: string): Identities {
  if (!from || !to || from === to) return identities
  return identities.map((identity) => {
    if (!identity.tags_zh.includes(from)) return identity
    const next = [...new Set(identity.tags_zh.map((tag) => (tag === from ? to : tag)))]
    return { ...identity, tags_zh: next }
  })
}

/**
 * 全域移除標籤：只會拿掉「還有其他標籤」的那幾筆，唯一標籤是它的人格會被跳過，
 * 所以結果永遠不會違反「每筆至少一個標籤」的存檔規則。
 */
export function removeTagEverywhere(identities: Identities, tag: string): Identities {
  if (!tag) return identities
  return identities.map((identity) =>
    identity.tags_zh.includes(tag) && identity.tags_zh.length > 1
      ? { ...identity, tags_zh: identity.tags_zh.filter((entry) => entry !== tag) }
      : identity,
  )
}

/** 全域移除實際會動到的筆數（預覽用）。 */
export function removableCount(identities: readonly { tags_zh: string[] }[], tag: string): number {
  return identities.filter((identity) => identity.tags_zh.includes(tag) && identity.tags_zh.length > 1)
    .length
}
