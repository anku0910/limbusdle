import type { Identity } from '../types'

/**
 * 標籤清單的瀏覽順序（編輯器的標籤篩選、統計 Top 10 共用）。
 *
 * 規則一：先分塊，塊間照這個順序 —— 協會 → 公司（含腦葉/E.G.O/黑獸/血魔/眷屬）→ 獄兒園 →
 * 事務所 → 蜘蛛巢 → 手指 → 幫派，沒配到塊的標籤排最後。
 * 規則二：塊內先看這裡指定的接續順序（例如腦葉公司下面接 E.G.O裝備、H公司接黑獸、
 * 血魔 → 拉·曼卻領 → 二代眷屬 → 三代眷屬）。
 * 規則三：沒指定順序的，依登場賽季新 → 舊（標籤的賽季 = 攜帶它的人格中最早的 season）。
 * 規則四：最後用 localeCompare 兜底，保證同分時也是穩定順序。
 */

/** 協會名稱本身就是編號：Zwei=2…Öufi=11。 */
const ASSOCIATION_NUMBERS: Record<string, number> = {
  Hana: 1,
  Zwei: 2,
  Tres: 3,
  し: 4,
  Cinq: 5,
  Liu: 6,
  Seven: 7,
  Eight: 8,
  Девять: 9,
  Dieci: 10,
  Öufi: 11,
  Dodeka: 12,
}
const CJK_NUMERALS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
}

const associationRank = (tag: string): number => {
  const base = tag.replace(/協會$/, '')
  const known = ASSOCIATION_NUMBERS[base]
  if (known !== undefined) return known
  if (base.startsWith('十')) {
    const rest = CJK_NUMERALS[base.slice(1)] ?? 0
    return 10 + rest
  }
  return CJK_NUMERALS[base] ?? 99
}

/** 使用者指定的公司接續：腦葉 → E.G.O → H公司 → 黑獸（依地支）→ 眷屬（二 → 三）。 */
const COMPANY_RUN = [
  '腦葉公司',
  '腦葉公司本部',
  '腦葉公司支部',
  'E.G.O裝備',
  'H公司',
  '黑獸',
  '黑獸-魁首',
  '黑獸-卯',
  '黑獸-巳',
  '黑獸-午',
  '黑獸-未',
  '黑獸-酉',
  '血魔',
  '拉·曼卻領',
  '二代眷屬',
  '三代眷屬',
]

/** 手指依解剖順序：拇指 → 食指 → 中指 → 環指（無名指）→ 小指。 */
const FINGERS = ['手指', '拇指', '食指', '中指', '環指', '環指點彩派', '小指']

const byOrder =
  (order: readonly string[]) =>
  (tag: string): number => {
    const index = order.indexOf(tag)
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }

type Block = {
  match: (tag: string) => boolean
  /** 塊內指定順序；數字越小越前面，沒列到的（MAX）才輪到賽季規則。 */
  rank?: (tag: string) => number
}

const isCompanyLike = (tag: string) =>
  tag.includes('公司') ||
  tag.includes('黑獸') ||
  tag.includes('眷屬') ||
  tag === 'E.G.O裝備' ||
  tag === '血魔' ||
  tag === '拉·曼卻領'

/** 塊間順序：協會 → 公司 → 獄兒園 → 事務所 → 蜘蛛巢 → 手指 → 幫派。 */
const BLOCKS: readonly Block[] = [
  { match: (tag) => tag.includes('協會'), rank: associationRank },
  { match: isCompanyLike, rank: byOrder(COMPANY_RUN) },
  { match: (tag) => tag.includes('獄兒園') || tag.endsWith('班'), rank: byOrder(['獄兒園']) },
  { match: (tag) => tag.includes('事務所') },
  { match: (tag) => tag.includes('蜘蛛巢') },
  { match: (tag) => FINGERS.includes(tag), rank: byOrder(FINGERS) },
  { match: (tag) => tag.includes('幫') || tag.includes('派') || tag.endsWith('會'), rank: byOrder(['幫派']) },
]

/** 標籤的登場賽季 = 攜帶它的人格中最早的 season（新 → 舊排時用）。 */
export function tagIntroSeasons(identities: readonly Identity[]): Map<string, number> {
  const intro = new Map<string, number>()
  for (const identity of identities)
    for (const tag of identity.tags_zh)
      intro.set(tag, Math.min(intro.get(tag) ?? Number.MAX_SAFE_INTEGER, identity.season))
  return intro
}

/** 標籤所屬的分塊（0 開始）；越小越前面，等于 BLOCKS 長度代表落在「其餘」。 */
export function tagBlockRank(tag: string): number {
  const index = BLOCKS.findIndex((block) => block.match(tag))
  return index === -1 ? BLOCKS.length : index
}

export const TAG_BLOCK_LABELS: readonly string[] = [
  '協會',
  '公司',
  '獄兒園',
  '事務所',
  '蜘蛛巢',
  '手指',
  '幫派',
  '其餘',
]

/**
 * `customOrder` 是使用者在編輯器裡排好的完整順序：列在裡面的標籤照他的順序，
 * 沒列到的新標籤（例如後來批次加的）排在後面，彼此仍走內建的分塊＋賽季規則。
 */
export function makeTagComparator(
  identities: readonly Identity[],
  customOrder: readonly string[] = [],
): (a: string, b: string) => number {
  const intro = tagIntroSeasons(identities)
  const defaultCompare = (a: string, b: string): number => {
    const blockDelta = tagBlockRank(a) - tagBlockRank(b)
    if (blockDelta !== 0) return blockDelta
    const block = BLOCKS[tagBlockRank(a)]
    if (block?.rank) {
      const rankDelta = block.rank(a) - block.rank(b)
      if (rankDelta !== 0) return rankDelta
    }
    const seasonDelta = (intro.get(b) ?? 1) - (intro.get(a) ?? 1)
    if (seasonDelta !== 0) return seasonDelta
    return a.localeCompare(b, 'zh-Hant')
  }

  if (customOrder.length === 0) return defaultCompare
  const customIndex = new Map(customOrder.map((tag, index) => [tag, index]))
  return (a, b) => {
    const indexA = customIndex.get(a)
    const indexB = customIndex.get(b)
    if (indexA !== undefined && indexB !== undefined) return indexA - indexB
    if (indexA !== undefined) return -1
    if (indexB !== undefined) return 1
    return defaultCompare(a, b)
  }
}
