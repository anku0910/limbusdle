import type { Identity } from '../types'

/** Local calendar day as `YYYY-MM-DD`. Deliberately *not* UTC: the rollover must
 *  happen at the player's midnight, not at Greenwich's. */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** FNV-1a over the date key. Any change to the pool or the algorithm reshuffles every
 *  future day, which is why `SALT` is versioned alongside the game rules. */
function hashDate(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Pick today's answer.
 *
 * The pool is sorted first so the result depends only on the *content* of the dataset,
 * never on the order `import` happens to hand us - otherwise re-sorting the JSON would
 * silently invalidate every saved game.
 */
export function getDailyAnswer(
  date: Date = new Date(),
  identities: Identity[],
  sorted: Identity[] = sortStable(identities),
): Identity {
  if (sorted.length === 0) {
    throw new Error('cannot pick a daily answer from an empty identity pool')
  }
  const rng = mulberry32(hashDate(localDateKey(date)))
  return sorted[Math.floor(rng() * sorted.length)]
}

let cachedSort: Identity[] | null = null
let cachedInput: Identity[] | null = null

function sortStable(identities: Identity[]): Identity[] {
  if (cachedInput === identities && cachedSort) return cachedSort
  cachedSort = [...identities].sort((a, b) => a.id - b.id)
  cachedInput = identities
  return cachedSort
}

/**
 * A guess is legal once every past guess has been consumed, or immediately when the
 * guess itself is the answer. Guards against double-submitting and against replaying a
 * game after the day rolls over.
 */
export function canGuess(
  guess: Identity,
  answer: Identity,
  pastGuesses: Identity[],
  maxGuesses: number,
): boolean {
  if (guess.id === answer.id) return true
  return pastGuesses.length < maxGuesses && !pastGuesses.some((g) => g.id === guess.id)
}