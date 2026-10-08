import {
  CATEGORIES,
  MATCH_EMOJI,
  visibleCategories,
  type CategoryKey,
  type Comparison,
  type Difficulty,
} from './compare'
import { rarityLabel, type GameMeta } from './db'
import type { Identity } from '../types'

export const MAX_GUESSES = 8

export type GameStatus = 'playing' | 'won' | 'lost'

export type Round = {
  /** Identity id, so a saved game survives re-sorting the dataset. */
  id: number
  comparison: Comparison
}

export type SavedGame = {
  /** The date key the round was started under; a mismatch discards the save. */
  date: string
  /** `SALT` at write time - a rules change invalidates old rounds. */
  version: typeof SALT
  guesses: number[]
  status: GameStatus
  /** Which columns the round was played with. Absent in saves from before the
   *  difficulty selector existed, which is why it is optional. */
  difficulty?: Difficulty
}

/**
 * Bump whenever `compareGuess`, the category list or the answer-selection salt changes
 * in a way that would make a saved game disagree with a fresh replay of the same day.
 */
export const SALT = 'v2'
export const INF_MODE_SALT = 'inf-v2'

/** Daily puzzle (one answer per calendar day) or the endless random run. */
export type GameMode = 'daily' | 'infinite'

export const MODE_LABELS: Record<GameMode, string> = {
  daily: '每日',
  infinite: '無限',
}

export type Stats = {
  streak: number
  bestStreak: number
  played: number
  won: number
  /** Guess count -> times finished in exactly that many tries, 1..MAX_GUESSES. */
  distribution: number[]
  /**
   * Date key of the most recently scored round. Makes scoring idempotent: reopening
   * the result screen, or a double-submit racing the state update, must not count the
   * same day twice.
   */
  lastScored: string | null
}

export const EMPTY_STATS: Stats = {
  streak: 0,
  bestStreak: 0,
  played: 0,
  won: 0,
  distribution: new Array(MAX_GUESSES).fill(0),
  lastScored: null,
}

/** Emoji rows for the guess grid. Ordinal cells carry their arrow *and* a red square,
 *  because the arrow is only meaningful next to the "not equal" colour.
 *
 *  `categories` defaults to everything, so a caller that has no difficulty to apply
 *  (the tests, a pre-difficulty save) still renders a full row. */
export function emojiRow(
  comparison: Comparison,
  categories: readonly { key: CategoryKey }[] = CATEGORIES,
): string {
  return categories
    .map(({ key }) => {
      const match = comparison[key]
      if (match === 'under') return '🟥🔼'
      if (match === 'over') return '🟥🔽'
      return MATCH_EMOJI[match]
    })
    .join('')
}

export function emojiGrid(
  rounds: Round[],
  categories: readonly { key: CategoryKey }[] = CATEGORIES,
): string {
  return rounds.map((round) => emojiRow(round.comparison, categories)).join('\n')
}

export type SharePayload = {
  status: GameStatus
  tries: number
  rounds: Round[]
  dateKey: string
  answer: Identity
  meta: GameMeta
  /** Defaults to `easy`: every column, which is what the tests and any caller
   *  without a difficulty to report want. */
  difficulty?: Difficulty
}

/**
 * Text pasted to the clipboard / social post.
 *
 * The emoji grid is spoiler-free for a reader who has not played yet; the breakdown below
 * it names the answer, so it is meant to be posted *after* the round, next to the grid.
 */
export function buildShareText({
  status,
  tries,
  rounds,
  dateKey,
  answer,
  meta,
  difficulty = 'easy',
}: SharePayload): string {
  const attempts =
    status === 'won' ? `${tries}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`
  const headline = status === 'won' ? '🎉 猜中了' : '💀 沒猜中'
  const roster = new Set(rounds.map((r) => r.id)).size
  const perfect = rounds.filter((r) =>
    CATEGORIES.every(({ key }) => r.comparison[key] === 'exact'),
  ).length

  // The emoji grid reproduces *feedback*, so it is filtered by difficulty exactly like
  // the on-screen grid. The breakdown below it is the answer reveal and always prints
  // in full - it is only ever posted after the round has finished.
  const shown = visibleCategories(difficulty)

  return [
    `${headline} Limbusdle ${dateKey}`,
    attempts,
    emojiGrid(rounds, shown),
    '',
    `人格：${answer.name_zh}`,
    `罪人：${answer.sinner_zh}　稀有度：${rarityLabel(meta, answer.rarity)}　賽季：${answer.season_zh}`,
    `標籤：${answer.tags_zh.join('・')}`,
    `屬性：${answer.damage_types_zh.join('・')}`,
    `罪孽：${answer.sin_affinities_zh.join('・')}`,
    `關鍵字：${answer.keywords_zh.length ? answer.keywords_zh.join('・') : '（無）'}`,
    '',
    `共猜 ${roster} 位人格・完全吻合 ${perfect} 次`,
  ].join('\n')
}

/** Copy with a `document.execCommand` fallback for browsers that refuse the async API
 *  outside a secure context (e.g. a plain `http://` LAN preview). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }

  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export type { CategoryKey, Difficulty }