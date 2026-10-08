import { useEffect, useState } from 'react'
import { type Difficulty } from '../lib/compare'
import { rarityLabel, type GameMeta } from '../lib/db'
import { buildShareText, copyText, MAX_GUESSES, type Round } from '../lib/game'
import { IdentityAvatar } from './IdentityAvatar'
import { SKILL_ROLE_LABELS, type Identity } from '../types'

type Props = {
  status: 'won' | 'lost'
  tries: number
  rounds: Round[]
  answer: Identity
  dateKey: string
  meta: GameMeta
  /** Filters the shareable emoji grid to the columns this round was played with. */
  difficulty?: Difficulty
  /** Endless mode only: deal the next random answer without leaving the screen. */
  onNextRound?: () => void
  onClose: () => void
}

/**
 * Post-game screen: reveals the answer, shows the full breakdown, and hands over a
 * spoiler-free emoji grid for sharing.
 */
export function ResultModal({
  status,
  tries,
  rounds,
  answer,
  dateKey,
  meta,
  difficulty = 'easy',
  onNextRound,
  onClose,
}: Props) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  const text = buildShareText({ status, tries, rounds, dateKey, answer, meta, difficulty })
  const won = status === 'won'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Highlight the revealed answer so the player can compare it against their grid.
  useEffect(() => {
    if (copied === 'idle') return
    const timer = window.setTimeout(() => setCopied('idle'), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function onCopy() {
    setCopied((await copyText(text)) ? 'ok' : 'fail')
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="回合結果"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-start gap-4">
          <IdentityAvatar identity={answer} size={72} />
          <div className="min-w-0 flex-1">
            <h2 className={`text-xl font-bold ${won ? 'text-emerald-400' : 'text-rose-400'}`}>
              {won ? `第 ${tries} 次猜中！` : '沒能猜中'}
            </h2>
            <p className="mt-1 text-lg text-zinc-100">{answer.name_zh}</p>
            <p className="text-xs text-zinc-500">{answer.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <dl className="mb-5 grid grid-cols-2 gap-x-4 gap-y-2 bg-zinc-950 p-4 text-sm">
          <Row label="罪人" value={answer.sinner_zh} />
          <Row label="稀有度" value={rarityLabel(meta, answer.rarity)} />
          <Row label="賽季" value={`${answer.season_zh}${answer.season_wiki && answer.season_wiki !== answer.season_zh ? `（${answer.season_wiki}）` : ''}`} />
          <Row label="標籤" value={answer.tags_zh.join('・')} />
          <Row label="屬性" value={answer.damage_types_zh.join('・')} />
          <Row label="罪孽" value={answer.sin_affinities_zh.join('・')} />
          <Row label="關鍵字" value={answer.keywords_zh.length ? answer.keywords_zh.join('・') : '（無）'} />
          <Row label="HP / 速度" value={`${answer.hp_base} / ${answer.min_speed}–${answer.max_speed}`} />
        </dl>

        <div className="mb-4">
          <h3 className="mb-2 text-xs font-medium text-zinc-400">
            技能（{answer.skills_zh.length}）
          </h3>
          <ul className="flex flex-col gap-1.5">
            {answer.skills_zh.map((skill, index) => (
              <li
                key={`${skill.slot}-${skill.variant}-${skill.enhanced}-${index}`}
                className="bg-zinc-950 px-3 py-2 text-xs"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-zinc-200">
                    {skill.enhanced && <span className="text-amber-400">強化 </span>}
                    {skill.name_zh}
                  </span>
                  <span className="shrink-0 font-mono text-zinc-400">
                    {skill.coin_cost != null && `${skill.coin_cost} 硬幣`}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-zinc-500">
                  <span>{SKILL_ROLE_LABELS[skill.role]}</span>
                  {skill.attack_type_zh && <span>{skill.attack_type_zh}</span>}
                  {skill.sin_zh && <span>{skill.sin_zh}</span>}
                  {skill.base_power != null && <span>威力 {skill.base_power}</span>}
                  {skill.coin_power && <span>硬幣威力 {skill.coin_power}</span>}
                  {skill.modifier && <span>修正 {skill.modifier}</span>}
                  {skill.attack_capacity != null && skill.attack_capacity > 1 && (
                    <span>攻擊 {skill.attack_capacity} 次</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <pre className="mb-4 overflow-x-auto whitespace-pre-wrap break-words bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
          {text}
        </pre>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCopy}
            className="flex-1 bg-amber-500 px-4 py-3 font-bold text-zinc-950 hover:bg-amber-400"
          >
            {copied === 'ok' ? '已複製到剪貼簿' : copied === 'fail' ? '複製失敗，請手動選取' : '複製結果'}
          </button>
          <span className="text-xs text-zinc-600">
            {won ? `${tries}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`}
          </span>
        </div>

        {onNextRound && (
          <button
            type="button"
            onClick={onNextRound}
            className="mt-3 w-full bg-zinc-100 px-4 py-3 font-bold text-zinc-900 hover:bg-white"
          >
            下一題
          </button>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-[11px] text-zinc-500">{label}</dt>
      <dd className="truncate text-zinc-200" title={value}>
        {value}
      </dd>
    </div>
  )
}