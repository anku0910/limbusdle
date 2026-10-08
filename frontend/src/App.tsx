import { useCallback, useEffect, useMemo, useState } from 'react'
import { DataEditor } from './components/DataEditor'
import { GuessGrid } from './components/GuessGrid'
import { ResultModal } from './components/ResultModal'
import { SinnerPicker } from './components/SinnerPicker'
import { Distribution } from './components/StatsPanel'
import {
  DIFFICULTIES,
  DIFFICULTY_HINTS,
  DIFFICULTY_LABELS,
  compareGuess,
} from './lib/compare'
import { loadDb, type Db } from './lib/db'
import {
  MAX_GUESSES,
  MODE_LABELS,
  SALT,
  type GameMode,
  type GameStatus,
  type Round,
} from './lib/game'
import { buildRoster } from './lib/roster'
import { canGuess, getDailyAnswer, localDateKey } from './lib/seed'
import {
  infiniteRoundKey,
  loadGame,
  loadInfinite,
  loadInfiniteStats,
  loadPrefs,
  loadStats,
  nextInfiniteRound,
  recordResult,
  saveGame,
  saveInfinite,
  saveInfiniteStats,
  savePrefs,
  saveStats,
  type InfiniteRound,
} from './lib/storage'
import type { Identity, Identities } from './types'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; db: Db }

function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [route, setRoute] = useState(() => window.location.hash)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    loadDb()
      .then((db) => {
        if (!cancelled) setState({ status: 'ready', db })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <p className="py-20 text-center text-sm text-zinc-500">載入資料中…</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="mx-auto max-w-lg border border-rose-800 bg-rose-950/40 p-5">
        <h1 className="mb-2 font-bold text-rose-300">無法載入資料</h1>
        <p className="text-sm text-zinc-300">{state.message}</p>
        <button
          type="button"
          className="mt-3 bg-zinc-800 px-4 py-3 font-medium text-zinc-200 hover:bg-zinc-700"
          onClick={reload}
        >
          重新載入
        </button>
      </div>
    )
  }

  if (route.startsWith('#/edit')) {
    return <DataEditor db={state.db} onReload={reload} />
  }

  return <GameView db={state.db} />
}

/**
 * Deal a random answer for the endless mode, never the one just played so two rounds
 * in a row cannot hand out the same identity.
 */
function pickRandomAnswer(identities: Identities, excludeId: number | null): number {
  const pool =
    excludeId != null && identities.length > 1
      ? identities.filter((identity) => identity.id !== excludeId)
      : identities
  const choice = pool[Math.floor(Math.random() * pool.length)]
  if (!choice) throw new Error('人格資料是空的，無法開始無限模式')
  return choice.id
}

type DailyRound = {
  guesses: number[]
  status: GameStatus
}

function GameView({ db }: { db: Db }) {
  const { meta, identities } = db

  const roster = useMemo(() => buildRoster(identities), [identities])
  const byId = roster.byId

  // Preferences outlive any single round, so they are their own piece of state rather
  // than being folded into whichever round happens to be loaded.
  const [prefs, setPrefs] = useState(loadPrefs)
  const { difficulty, mode } = prefs

  const [dateKey] = useState(() => localDateKey())

  const [daily, setDaily] = useState<DailyRound>(() => {
    const saved = loadGame(dateKey)
    return { guesses: saved?.guesses ?? [], status: saved?.status ?? 'playing' }
  })

  const [infinite, setInfinite] = useState<InfiniteRound | null>(() => loadInfinite())

  // Open straight on the result screen when the restored round is already over; a mode
  // switch later must not do this, or toggling modes would keep popping the modal up.
  const [showResult, setShowResult] = useState(
    () => (mode === 'infinite' ? (infinite?.status ?? 'playing') : daily.status) !== 'playing',
  )

  const [stats, setStats] = useState(loadStats)
  const [infiniteStats, setInfiniteStats] = useState(loadInfiniteStats)
  const [notice, setNotice] = useState<string | null>(null)

  // The endless mode has no date to derive an answer from, so the round either gets
  // restored from storage or is dealt right here on first entry.
  useEffect(() => {
    if (mode !== 'infinite') return
    const usable = infinite !== null && byId.has(infinite.answerId)
    if (!usable) {
      setInfinite(nextInfiniteRound(pickRandomAnswer(identities, null), infinite))
    }
  }, [mode, infinite, byId, identities])

  useEffect(() => savePrefs(prefs), [prefs])
  useEffect(() => saveStats(stats), [stats])
  useEffect(() => saveInfiniteStats(infiniteStats), [infiniteStats])

  useEffect(() => {
    saveGame({ date: dateKey, version: SALT, ...daily, difficulty })
  }, [dateKey, daily, difficulty])

  useEffect(() => {
    if (infinite) saveInfinite(infinite)
  }, [infinite])

  const active =
    mode === 'daily'
      ? daily
      : { guesses: infinite?.guesses ?? [], status: infinite?.status ?? 'playing' }
  const { guesses, status } = active

  const answer = useMemo<Identity>(() => {
    if (mode === 'infinite') {
      const stored = infinite ? byId.get(infinite.answerId) : undefined
      if (stored) return stored
    }
    return getDailyAnswer(new Date(), identities)
  }, [mode, infinite, byId, identities])

  const rounds = useMemo<Round[]>(
    () =>
      guesses.flatMap((id) => {
        const guess = byId.get(id)
        return guess ? [{ id, comparison: compareGuess(guess, answer) }] : []
      }),
    [guesses, byId, answer],
  )

  const usedIds = useMemo(() => new Set(guesses), [guesses])

  // Compact headline numbers live in the header so the body can stay reserved for
  // the picker, the grid and the distribution.
  const shownStats = mode === 'daily' ? stats : infiniteStats
  const winRate = shownStats.played
    ? Math.round((shownStats.won / shownStats.played) * 100)
    : 0

  const pastGuesses = useMemo(
    () => guesses.flatMap((id) => {
      const guess = byId.get(id)
      return guess ? [guess] : []
    }),
    [guesses, byId],
  )

  // Score the round exactly once. `recordResult` is idempotent on this key, so the
  // modal being reopened - or this effect re-running - cannot count a round twice.
  const scoreKey = mode === 'daily' ? dateKey : infiniteRoundKey(infinite?.round ?? 1)

  useEffect(() => {
    if (status === 'playing') return
    const score = (previous: typeof stats) =>
      recordResult(previous, scoreKey, status, guesses.length)
    if (mode === 'daily') setStats(score)
    else setInfiniteStats(score)
  }, [status, mode, scoreKey, guesses.length])

  const submit = useCallback(
    (guess: Identity) => {
      if (status !== 'playing') {
        setNotice('這一題已經結束了')
        return
      }
      if (!canGuess(guess, answer, pastGuesses, MAX_GUESSES)) {
        setNotice('這位人格已經猜過了')
        return
      }

      const nextGuesses = [...guesses, guess.id]
      const nextStatus: GameStatus =
        guess.id === answer.id
          ? 'won'
          : nextGuesses.length >= MAX_GUESSES
            ? 'lost'
            : 'playing'

      if (mode === 'daily') setDaily({ guesses: nextGuesses, status: nextStatus })
      else setInfinite((current) => (current ? { ...current, guesses: nextGuesses, status: nextStatus } : current))

      if (nextStatus !== 'playing') setShowResult(true)
    },
    [status, answer, pastGuesses, guesses, mode],
  )

  const startNextRound = useCallback(() => {
    const answerId = pickRandomAnswer(identities, infinite?.answerId ?? null)
    setInfinite(nextInfiniteRound(answerId, infinite))
    setShowResult(false)
  }, [identities, infinite])

  const changeMode = useCallback((next: GameMode) => {
    if (next === mode) return
    setShowResult(false)
    setPrefs((current) => ({ ...current, mode: next }))
  }, [mode])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 2600)
    return () => window.clearTimeout(timer)
  }, [notice])

  return (
    <div className="min-h-screen text-zinc-100">
      <header className="bg-zinc-900/70 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">
              {meta.title}
              <span className="ml-2 text-sm font-normal text-zinc-500">{meta.subtitle}</span>
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              {meta.tagline}（{identities.length} 位人格）
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="難度"
                className="flex bg-zinc-950 p-1"
              >
                {DIFFICULTIES.map((level) => (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={difficulty === level}
                    title={DIFFICULTY_HINTS[level]}
                    onClick={() => setPrefs((current) => ({ ...current, difficulty: level }))}
                    className={`px-3 py-1.5 text-xs font-medium transition ${
                      difficulty === level
                        ? 'bg-amber-500 text-zinc-950'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {DIFFICULTY_LABELS[level]}
                  </button>
                ))}
              </div>

              <button
                type="button"
                aria-pressed={mode === 'infinite'}
                onClick={() => changeMode(mode === 'daily' ? 'infinite' : 'daily')}
                className={`px-3 py-2 text-xs font-medium transition ${
                  mode === 'infinite'
                    ? 'bg-sky-500 text-zinc-950'
                    : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                無限模式
              </button>
            </div>

            <p className="mt-2 text-[11px] text-zinc-500">
              {MODE_LABELS[mode]}模式・{DIFFICULTY_LABELS[difficulty]}難度
              {difficulty !== 'easy' && `・${DIFFICULTY_HINTS[difficulty]}`}
            </p>
          </div>

          <div className="shrink-0 text-xs text-zinc-500 sm:text-right">
            <div>
              {mode === 'daily' ? '今日' : `第 ${infinite?.round ?? 1} 題`}{' '}
              <span className="text-zinc-300">{dateKey}</span>
            </div>
            <div>
              已猜 <span className="text-zinc-300">{guesses.length}</span>/{MAX_GUESSES}
            </div>
            <div>
              目前連勝{' '}
              <span className="text-zinc-300">{shownStats.streak}</span>{' '}
              ・最高 <span className="text-zinc-300">{shownStats.bestStreak}</span>
              ・勝率 <span className="text-zinc-300">{winRate}%</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6">
        <SinnerPicker
          identities={identities}
          usedIds={usedIds}
          disabled={status !== 'playing'}
          onGuess={submit}
        />

        {notice && (
          <p role="status" className="bg-amber-500/15 px-3 py-2 text-sm text-amber-300">
            {notice}
          </p>
        )}

        <section aria-label="猜測紀錄" className="min-w-0 flex-1">
          {rounds.length === 0 ? (
            <p className="bg-zinc-900/60 px-4 py-10 text-center text-sm text-zinc-600">
              還沒有紀錄。選一位罪人開始吧。
            </p>
          ) : (
            <GuessGrid
              rounds={rounds}
              byId={byId}
              status={status}
              meta={meta}
              difficulty={difficulty}
              answer={answer}
            />
          )}
        </section>

        {/* Pinned to the viewport edge so it never steals width from the grid;
            wide screens (xl and up) are the only ones with room for it. */}
        <aside className="fixed right-4 top-1/2 z-10 hidden w-48 -translate-y-1/2 xl:block">
          <Distribution stats={shownStats} />
        </aside>

        {status !== 'playing' && (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setShowResult(true)}
              className="flex-1 bg-zinc-800 px-4 py-3 font-medium text-zinc-200 hover:bg-zinc-700"
            >
              查看結果與分享
            </button>
            {mode === 'infinite' && (
              <button
                type="button"
                onClick={startNextRound}
                className="flex-1 bg-amber-500 px-4 py-3 font-bold text-zinc-950 hover:bg-amber-400"
              >
                下一題
              </button>
            )}
          </div>
        )}

        <footer className="pt-2 text-xs text-zinc-600">
          <a href="#/edit" className="underline hover:text-zinc-400">
            資料編輯器
          </a>
        </footer>
      </main>

      {showResult && status !== 'playing' && (
        <ResultModal
          status={status}
          tries={guesses.length}
          rounds={rounds}
          answer={answer}
          dateKey={dateKey}
          meta={meta}
          difficulty={difficulty}
          onNextRound={mode === 'infinite' ? startNextRound : undefined}
          onClose={() => setShowResult(false)}
        />
      )}
    </div>
  )
}

export default App
