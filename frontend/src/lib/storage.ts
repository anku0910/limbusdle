import {
  EMPTY_STATS,
  INF_MODE_SALT,
  MAX_GUESSES,
  SALT,
  type Difficulty,
  type GameMode,
  type GameStatus,
  type SavedGame,
  type Stats,
} from '../lib/game'

const PREFIX = 'limbusdle'
const STATS_KEY = `${PREFIX}:stats:${SALT}`
const gameKey = (dateKey: string) => `${PREFIX}:daily:${SALT}:${dateKey}`

/** Selections that outlive a single round: which difficulty to play and which mode. */
const PREFS_KEY = `${PREFIX}:prefs`
/** The one in-flight endless round. Keyed by `INF_MODE_SALT` so a rules change to the
 *  endless mode can invalidate it without touching the daily puzzle. */
const INFINITE_KEY = `${PREFIX}:infinite:${INF_MODE_SALT}`
const INFINITE_STATS_KEY = `${PREFIX}:infstats:${INF_MODE_SALT}`

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed == null ? fallback : (parsed as T)
  } catch {
    // A corrupt or unreadable entry must never wedge the game; start clean instead.
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private-browsing quota errors are not worth interrupting play for.
  }
}

/** Rebuild a `Stats` from whatever JSON was found: every field is coerced, so a
 *  hand-edited or truncated entry degrades to zeroes rather than throwing. */
function normalizeStats(raw: Partial<Stats>): Stats {
  return {
    streak: Math.max(0, Number(raw.streak) || 0),
    bestStreak: Math.max(0, Number(raw.bestStreak) || 0),
    played: Math.max(0, Number(raw.played) || 0),
    won: Math.max(0, Number(raw.won) || 0),
    distribution: Array.from({ length: MAX_GUESSES }, (_, i) =>
      Math.max(0, Number(raw.distribution?.[i]) || 0),
    ),
    lastScored: typeof raw.lastScored === 'string' ? raw.lastScored : null,
  }
}

export function loadStats(): Stats {
  return normalizeStats(read<Partial<Stats>>(STATS_KEY, {}))
}

export function saveStats(stats: Stats): void {
  write(STATS_KEY, stats)
}

/** Lifetime totals for the endless mode, kept apart from the daily ones: a mode the
 *  player never opens must not move the numbers they do see. */
export function loadInfiniteStats(): Stats {
  return normalizeStats(read<Partial<Stats>>(INFINITE_STATS_KEY, {}))
}

export function saveInfiniteStats(stats: Stats): void {
  write(INFINITE_STATS_KEY, stats)
}

export type Prefs = {
  difficulty: Difficulty
  mode: GameMode
}

/** Deliberately permissive: an unknown stored value falls back to the default instead
 *  of wedging the game behind a mode that no longer exists. The default difficulty is
 *  `easy` because that is the full-information game the selector replaced - a returning
 *  player should not suddenly lose columns. */
export function loadPrefs(): Prefs {
  const raw = read<Partial<Prefs>>(PREFS_KEY, {})
  return {
    difficulty:
      raw.difficulty === 'normal' || raw.difficulty === 'hard' ? raw.difficulty : 'easy',
    mode: raw.mode === 'infinite' ? 'infinite' : 'daily',
  }
}

export function savePrefs(prefs: Prefs): void {
  write(PREFS_KEY, prefs)
}

/**
 * Load today's round.
 *
 * The stored `date` and `version` are re-checked on every read: without them a save
 * would survive midnight and the player would resume yesterday's answer against
 * today's grid.
 */
export function loadGame(dateKey: string): SavedGame | null {
  const raw = read<SavedGame | null>(gameKey(dateKey), null)
  if (!raw || typeof raw !== 'object') return null
  if (raw.date !== dateKey || raw.version !== SALT) return null
  if (!Array.isArray(raw.guesses)) return null
  const status: GameStatus =
    raw.status === 'won' || raw.status === 'lost' ? raw.status : 'playing'
  const guesses = raw.guesses.filter((id): id is number => typeof id === 'number')
  const difficulty: Difficulty | undefined =
    raw.difficulty === 'easy' || raw.difficulty === 'normal' || raw.difficulty === 'hard'
      ? raw.difficulty
      : undefined
  return {
    date: dateKey,
    version: SALT,
    guesses: guesses.slice(0, MAX_GUESSES),
    status,
    ...(difficulty ? { difficulty } : {}),
  }
}

export function saveGame(game: SavedGame): void {
  write(gameKey(game.date), game)
}

/**
 * Fold a finished round into the lifetime stats.
 *
 * Idempotent per date via `lastScored`, so opening the result screen repeatedly - or a
 * double-submit racing a state update - cannot count one day twice.
 */
export function recordResult(
  stats: Stats,
  dateKey: string,
  status: GameStatus,
  tries: number,
): Stats {
  if (status === 'playing' || stats.lastScored === dateKey) return stats

  const next: Stats = {
    ...stats,
    played: stats.played + 1,
    won: status === 'won' ? stats.won + 1 : stats.won,
    streak: status === 'won' ? stats.streak + 1 : 0,
    bestStreak: Math.max(
      stats.bestStreak,
      status === 'won' ? stats.streak + 1 : stats.streak,
    ),
    distribution: [...stats.distribution],
    lastScored: dateKey,
  }
  if (status === 'won') {
    const slot = Math.min(Math.max(tries, 1), MAX_GUESSES) - 1
    next.distribution[slot] += 1
  }
  return next
}

export function emptyStats(): Stats {
  return { ...EMPTY_STATS, distribution: [...EMPTY_STATS.distribution] }
}

/**
 * The endless mode's in-flight round.
 *
 * Unlike the daily puzzle nothing here can be re-derived - the answer was picked at
 * random rather than hashed from a date - so the answer id has to survive a reload.
 */
export type InfiniteRound = {
  answerId: number
  guesses: number[]
  status: GameStatus
  /** 1-based counter of rounds started. Doubles as the scoring idempotency key, which
   *  is what lets several rounds share one calendar day. */
  round: number
}

export function loadInfinite(): InfiniteRound | null {
  const raw = read<Partial<InfiniteRound> | null>(INFINITE_KEY, null)
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.answerId !== 'number' || !Array.isArray(raw.guesses)) return null
  const status: GameStatus =
    raw.status === 'won' || raw.status === 'lost' ? raw.status : 'playing'
  const guesses = raw.guesses.filter((id): id is number => typeof id === 'number')
  const round = Number(raw.round)
  return {
    answerId: raw.answerId,
    guesses: guesses.slice(0, MAX_GUESSES),
    status,
    round: Number.isFinite(round) && round >= 1 ? Math.floor(round) : 1,
  }
}

export function saveInfinite(infinite: InfiniteRound): void {
  write(INFINITE_KEY, infinite)
}

/** Start the next round after a finished one, carrying the round counter forward. */
export function nextInfiniteRound(
  answerId: number,
  current: InfiniteRound | null,
): InfiniteRound {
  return { answerId, guesses: [], status: 'playing', round: (current?.round ?? 0) + 1 }
}

/** Idempotency key for scoring an endless round; `recordResult` takes it wherever a
 *  date key would go. */
export function infiniteRoundKey(round: number): string {
  return `inf-${round}`
}