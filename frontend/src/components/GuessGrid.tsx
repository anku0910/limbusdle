import {
  MATCH_STYLES,
  cellTitle,
  guessValue,
  skillSlotMatches,
  visibleCategories,
  type CategoryKey,
  type Comparison,
  type Difficulty,
  type Match,
} from '../lib/compare'
import type { GameMeta } from '../lib/db'
import { MAX_GUESSES, type Round } from '../lib/game'
import { ATTACK_ICONS, ROLE_ICONS, skillChips, sinColor } from '../lib/sins'
import { IdentityAvatar } from './IdentityAvatar'
import type { Identity } from '../types'

type Props = {
  rounds: Round[]
  byId: ReadonlyMap<number, Identity>
  status: 'playing' | 'won' | 'lost'
  meta: GameMeta
  /** Which columns the player is allowed to see. The answer is always scored on all
   *  eight; difficulty only decides how many of those scores come back. */
  difficulty: Difficulty
  /** The answer itself, so the 技能 column can grade each of its four chips against
   *  the matching slot instead of against the whole set. */
  answer: Identity
}

/**
 * One column per visible comparison category, one row per guess.
 *
 * The category header stays visible for the whole round so a player reading the first
 * row can decode the rest of the grid by memory instead of re-hovering every cell.
 */
export function GuessGrid({ rounds, byId, status, meta, difficulty, answer }: Props) {
  // 罪人 and 稀有度 are no longer columns: the 人格 cell itself carries the verdict
  // as its background colour, with the sinner name spelled out beneath the identity
  // name, so only the other categories grid up.
  const categories = visibleCategories(difficulty).filter(
    (category) => category.key !== 'sinner' && category.key !== 'rarity',
  )
  const pending = status === 'playing' ? MAX_GUESSES - rounds.length : 0

  return (
    <div className="w-full overflow-x-auto pb-2">
      <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-1 text-center text-xs">
        <thead>
          <tr>
            <th className="w-44 px-2 py-2 text-left font-medium text-zinc-500">人格</th>
            {categories.map((category) => (
              <th
                key={category.key}
                title={category.hint}
                className="px-2 py-2 font-medium text-zinc-400"
              >
                {category.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rounds.map((round, rowIndex) => {
            const identity = byId.get(round.id)
            if (!identity) return null
            // 稀有度 no longer owns a column, so the identity cell carries its verdict
            // inline beside the sinner name: ▲ the answer is rarer, ▼ it is commoner,
            // ● the two tiers match.
            const rarityVerdict = round.comparison.rarity
            const rarityMark =
              rarityVerdict === 'exact' ? '●' : rarityVerdict === 'under' ? '▲' : '▼'
            const rarityLabel =
              rarityVerdict === 'exact'
                ? '稀有度相同'
                : rarityVerdict === 'under'
                  ? '正確答案稀有度更高'
                  : '正確答案稀有度更低'
            return (
              <tr key={`${round.id}-${rowIndex}`}>
                <td
                  className={`px-2 py-1 ${
                    MATCH_STYLES[
                      identity.id === answer.id
                        ? 'exact'
                        : identity.sinner === answer.sinner
                          ? 'partial'
                          : 'miss'
                    ]
                  }`}
                >
                  {/* The whole cell is the verdict: green for the answer itself,
                      amber for the right sinner's wrong identity, red otherwise.
                      The sinner name always sits below the identity name, with the
                      rarity verdict trailing it, so the name itself stays free. */}
                  <div className="flex h-full min-h-[68px] items-center gap-2 py-1 text-left">
                    <IdentityAvatar identity={identity} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium leading-tight">
                        {identity.name_zh}
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] opacity-80">
                        <span className="truncate">{identity.sinner_zh}</span>
                        <span className="shrink-0 font-bold" aria-label={rarityLabel}>
                          {rarityMark}
                        </span>
                      </span>
                    </span>
                  </div>
                </td>
                {categories.map((category) => (
                  <Cell
                    key={category.key}
                    identity={identity}
                    categoryKey={category.key}
                    match={round.comparison[category.key]}
                    skillSlots={skillSlotMatches(identity, answer)}
                    meta={meta}
                  />
                ))}
              </tr>
            )
          })}

          {Array.from({ length: pending }, (_, slot) => (
            <tr key={`pending-${slot}`} className="text-zinc-600">
              <td className="px-2 py-1 text-left">—</td>
              {categories.map((category) => (
              <td key={category.key} className="px-1 py-1">
                <div className="bg-zinc-900/70 px-1 py-2" />
              </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cell({
  identity,
  categoryKey,
  match,
  skillSlots,
  meta,
}: {
  identity: Identity
  categoryKey: CategoryKey
  match: Comparison[CategoryKey]
  skillSlots: Match[]
  meta: GameMeta
}) {
  const arrow = match === 'under' ? '▲' : match === 'over' ? '▼' : null

  if (categoryKey === 'skills') {
    return (
      <td className="px-1 py-1">
        <SkillCell identity={identity} match={match} slotMatches={skillSlots} />
      </td>
    )
  }

  return (
    <td className="px-1 py-1">
      <div
        title={cellTitle(identity, categoryKey, match, meta)}
        className={`flex h-full min-h-[68px] items-center justify-center gap-0.5 px-1 py-1.5 font-medium ${MATCH_STYLES[match]}`}
      >
        <span className="line-clamp-2 leading-tight">{guessValue(identity, categoryKey, meta)}</span>
        {arrow && <span className="text-[10px] leading-none">{arrow}</span>}
      </div>
    </td>
  )
}

/** The verdict ring around each chip; the cell itself keeps the aggregate colour so
 *  the column still reads at a glance like every other column. */
const SLOT_RING: Record<Match, string> = {
  exact: 'ring-emerald-400',
  partial: 'ring-amber-400',
  miss: 'ring-rose-500',
  under: 'ring-zinc-400',
  over: 'ring-zinc-400',
}

const SLOT_VERDICT: Record<Match, string> = {
  exact: '正確',
  partial: '部分命中',
  miss: '不符',
  under: '正確答案更高',
  over: '正確答案更低',
}

/** Four sin chips in a single row - S1 S2 S3 defense - sized big enough to read at a
 *  glance while the column keeps the same height as every other column. Attack
 *  chips carry their attack-type glyph, slot 4 its Guard/Evade/Counter glyph, and
 *  every chip wears the ring of its own verdict. */
function SkillCell({
  identity,
  match,
  slotMatches,
}: {
  identity: Identity
  match: Match
  slotMatches: Match[]
}) {
  const chips = skillChips(identity)
  const title = chips
    .map((chip, index) => {
      const slotMatch = slotMatches[index] ?? match
      const detail =
        chip.role === 'attack'
          ? `${chip.sin_zh ?? '—'}${chip.attack_type_zh ? `・${chip.attack_type_zh}` : ''}`
          : `${chip.sin_zh ?? '—'}・${chip.role}`
      return `S${chip.slot} ${chip.name_zh}｜${detail} — ${SLOT_VERDICT[slotMatch]}`
    })
    .join('\n')

  return (
    <div
      title={title}
      className={`flex h-full min-h-[68px] items-center justify-center gap-2 px-2 py-1.5 ${MATCH_STYLES[match]}`}
    >
      {chips.map((chip, index) => {
        const slotMatch = slotMatches[index] ?? match
        const icon =
          chip.role === 'attack'
            ? chip.attack_type_zh
              ? ATTACK_ICONS[chip.attack_type_zh]
              : undefined
            : ROLE_ICONS[chip.role]
        return (
          <span
            key={chip.slot}
            className={`flex h-12 w-12 shrink-0 items-center justify-center ring-2 ${SLOT_RING[slotMatch]}`}
            style={{ backgroundColor: sinColor(chip.sin_zh) }}
          >
            {icon && (
              <img src={icon} alt="" className="h-8 w-8 bg-black/35 object-contain p-1" />
            )}
          </span>
        )
      })}
    </div>
  )
}