import { rarityLabel, type GameMeta } from './db'
import { skillChips } from './sins'
import { SKILL_ROLE_LABELS, type Identity } from '../types'

/**
 * Outcome for a single comparison category.
 *
 * `exact` / `partial` / `miss` describe set overlap; `exact` / `under` / `over` describe
 * an ordinal guess. They share a type because a cell is only ever one colour, and the
 * arrow variants are the ordinal analogue of "partial" information: the value is known
 * to be on one side but not pinned down.
 */
export type Match = 'exact' | 'partial' | 'miss' | 'under' | 'over'

export type CategoryKey =
  | 'sinner'
  | 'faction'
  | 'rarity'
  | 'season'
  | 'damageTypes'
  | 'sinAffinities'
  | 'skills'
  | 'keywords'

export type Category = {
  key: CategoryKey
  label: string
  kind: 'exact' | 'ordinal' | 'set'
  hint: string
}

export const CATEGORIES: readonly Category[] = [
  {
    key: 'sinner',
    label: '罪人',
    kind: 'exact',
    hint: '完全相同才算正確',
  },
  {
    key: 'faction',
    label: '標籤',
    kind: 'set',
    hint: '全部命中為綠，部分命中為黃，錯誤為紅',
  },
  {
    key: 'rarity',
    label: '稀有度',
    kind: 'ordinal',
    hint: '箭頭指出正確的稀有度在你猜測的哪一側',
  },
  {
    key: 'season',
    label: '賽季',
    kind: 'ordinal',
    hint: '箭頭指出正確的賽季在你猜測的哪一側',
  },
  {
    key: 'damageTypes',
    label: '屬性',
    kind: 'set',
    hint: '全部命中為綠，部分命中為黃，錯誤為紅',
  },
  {
    key: 'sinAffinities',
    label: '罪孽',
    kind: 'set',
    hint: '全部命中為綠，部分命中為黃，錯誤為紅',
  },
  {
    key: 'skills',
    label: '技能',
    kind: 'set',
    hint: '一行四格：S1、S2、S3、防禦；逐格比對：同格同罪孽且攻防類型相同才為綠，同格同罪孽但攻防類型不同、罪孽配對或攻擊類型相同為橘，皆不符為紅',
  },
  {
    key: 'keywords',
    label: '關鍵字',
    kind: 'set',
    hint: '全部命中為綠，部分命中為黃，錯誤為紅',
  },
] as const

export type Comparison = Record<CategoryKey, Match>

/**
 * How much of the comparison the player is allowed to see.
 *
 * The categories themselves never change - the answer is always scored on all eight -
 * difficulty only controls which of those scores are handed back. Hiding a column makes
 * the round strictly harder, so `easy` shows everything while `normal`/`hard` replace
 * the two attribute columns (屬性/罪孽) with 技能 and drop tag/season/keyword leaks.
 */
export type Difficulty = 'easy' | 'normal' | 'hard'

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard']

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '簡單',
  normal: '普通',
  hard: '困難',
}

export const DIFFICULTY_HINTS: Record<Difficulty, string> = {
  easy: '顯示標籤、賽季、關鍵字與屬性、罪孽',
  normal: '隱藏標籤，屬性與罪孽改以技能呈現',
  hard: '隱藏標籤、賽季與關鍵字，屬性與罪孽改以技能呈現',
}

const HIDDEN_BY_DIFFICULTY: Record<Difficulty, readonly CategoryKey[]> = {
  easy: ['skills'],
  normal: ['faction', 'damageTypes', 'sinAffinities'],
  hard: ['faction', 'season', 'keywords', 'damageTypes', 'sinAffinities'],
}

/** The columns a given difficulty reveals. Used by the grid and the shareable
 *  emoji grid so the two can never disagree about what was shown. */
export function visibleCategories(difficulty: Difficulty): readonly Category[] {
  const hidden = HIDDEN_BY_DIFFICULTY[difficulty]
  return CATEGORIES.filter((category) => !hidden.includes(category.key))
}

export function setMatch(guess: string[], answer: string[]): Match {
  const a = new Set(guess)
  const b = new Set(answer)
  let overlap = 0
  for (const value of a) {
    if (b.has(value)) overlap++
  }
  // Both sides empty is a genuine match - four identities carry no keyword at all.
  if (overlap === a.size && overlap === b.size) return 'exact'
  if (overlap > 0) return 'partial'
  return 'miss'
}

function ordinalMatch(guess: number, answer: number): Match {
  if (guess === answer) return 'exact'
  return guess < answer ? 'under' : 'over'
}

/**
 * Per-slot verdict for the 技能 column - each of the four chips is graded on its own
 * rather than as one shared set.
 *
 * - the same sin in the same slot only counts as a hit (green) when the kind lines up
 *   too: same role and same attack type. 暴食打擊 answered with 暴食斬擊, or 防禦
 *   answered with 反擊, is amber rather than green;
 * - a sin the answer owns in a *different* slot is partial (amber) - and so is the
 *   paired slot with the right sin but the wrong kind, which always falls through to
 *   that rule;
 * - an attack type that matches the paired slot is partial too - right type, wrong
 *   colour is still worth orange rather than red;
 * - anything else fails (red). A slot neither side fills (both null) counts as a hit.
 */
export function skillSlotMatches(guess: Identity, answer: Identity): Match[] {
  const guessChips = skillChips(guess)
  const answerChips = skillChips(answer)
  const answerSins = new Set(
    answerChips.map((chip) => chip.sin_zh).filter((sin): sin is string => Boolean(sin)),
  )
  return guessChips.map((chip, index) => {
    const target = answerChips[index]
    const sameSin = (chip.sin_zh ?? null) === (target.sin_zh ?? null)
    const sameKind =
      chip.role === target.role &&
      (chip.attack_type_zh ?? null) === (target.attack_type_zh ?? null)
    if (sameSin && (!chip.sin_zh || sameKind)) return 'exact'
    if (chip.sin_zh && answerSins.has(chip.sin_zh)) return 'partial'
    if (
      chip.attack_type_zh &&
      target.attack_type_zh &&
      chip.attack_type_zh === target.attack_type_zh
    ) {
      return 'partial'
    }
    return 'miss'
  })
}

/** One cell / one emoji glyph has to be a single colour, so the four slot verdicts
 *  collapse into the usual three: all exact, anything at all, nothing. */
function aggregate(slots: readonly Match[]): Match {
  if (slots.every((slot) => slot === 'exact')) return 'exact'
  if (slots.some((slot) => slot !== 'miss')) return 'partial'
  return 'miss'
}

export function compareGuess(guess: Identity, answer: Identity): Comparison {
  return {
    sinner: guess.sinner === answer.sinner ? 'exact' : 'miss',
    // 標籤欄比對中文標籤（['獄兒園','XX班'] 等），而不是 faction 位元組串。
    faction: setMatch(guess.tags_zh, answer.tags_zh),
    rarity: ordinalMatch(guess.rarity, answer.rarity),
    season: ordinalMatch(guess.season, answer.season),
    damageTypes: setMatch(guess.damage_types, answer.damage_types),
    sinAffinities: setMatch(guess.sin_affinities, answer.sin_affinities),
    skills: aggregate(skillSlotMatches(guess, answer)),
    keywords: setMatch(guess.keywords, answer.keywords),
  }
}

/** What the player actually saw, per category - the left-hand label of each cell. */
export function guessValue(identity: Identity, key: CategoryKey, meta: GameMeta): string {
  switch (key) {
    case 'sinner':
      return identity.sinner_zh
    case 'faction':
      // The cell shows every 中文標籤 the identity carries.
      return identity.tags_zh.join('・')
    case 'rarity':
      return rarityLabel(meta, identity.rarity)
    case 'season':
      return identity.season_zh
    case 'damageTypes':
      return identity.damage_types_zh.join('・')
    case 'sinAffinities':
      return identity.sin_affinities_zh.join('・')
    case 'skills':
      // Non-attack slots print their role (防禦/閃避/反擊), not a blanket 防禦 -
      // the verdict now depends on the role, so the label has to show it too.
      return skillChips(identity)
        .map((chip) =>
          chip.role === 'attack'
            ? `${chip.sin_zh ?? '—'}（${chip.attack_type_zh ?? '攻擊'}）`
            : `${chip.sin_zh ?? '—'}（${SKILL_ROLE_LABELS[chip.role]}）`,
        )
        .join('・')
    case 'keywords':
      return identity.keywords_zh.length ? identity.keywords_zh.join('・') : '（無）'
  }
}

/**
 * In a set category the guess only reveals its own overlap, so show the guess's own
 * entries. For ordinals we additionally expose the numeric value, which the arrows
 * would otherwise leave ambiguous (is 2 one step low or five?).
 */
export function cellTitle(
  identity: Identity,
  key: CategoryKey,
  match: Match,
  meta: GameMeta,
): string {
  const value = guessValue(identity, key, meta)
  switch (match) {
    case 'exact':
      return `${value} — 正確`
    case 'partial':
      return `${value} — 部分命中`
    case 'miss':
      return `${value} — 不符`
    case 'under':
      return `${value} — 正確答案更高`
    case 'over':
      return `${value} — 正確答案更低`
  }
}

/** Cell -> Tailwind classes. Kept in one place so the grid and legend cannot drift. */
export const MATCH_STYLES: Record<Match, string> = {
  exact: 'bg-emerald-600 text-white',
  partial: 'bg-amber-500 text-black',
  miss: 'bg-rose-700 text-white',
  under: 'bg-slate-600 text-white',
  over: 'bg-slate-600 text-white',
}

export const MATCH_EMOJI: Record<Match, string> = {
  exact: '🟩',
  partial: '🟨',
  miss: '🟥',
  under: '🔼',
  over: '🔽',
}