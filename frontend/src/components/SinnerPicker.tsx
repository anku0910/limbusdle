import { useMemo, useState } from 'react'
import { groupBySinner } from '../lib/roster'
import type { Identity, Identities } from '../types'

type Props = {
  identities: Identities
  usedIds: ReadonlySet<number>
  disabled?: boolean
  onGuess: (identity: Identity) => void
}

/** Release order, as limbusdeck lists the sinners. */
const SINNER_ORDER = [
  'Yi Sang',
  'Faust',
  'Don Quixote',
  'Ryoshu',
  'Meursault',
  'Hong Lu',
  'Heathcliff',
  'Ishmael',
  'Rodion',
  'Sinclair',
  'Outis',
  'Gregor',
] as const

/** Local 128px icon first; the CDN portrait is the safety net. */
function identityThumb(identity: Identity): string {
  return `/thumbs/${identity.id}.png`
}

function sinnerSlug(sinner: string): string {
  return sinner.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function SinnerIcon({
  identity,
  label,
  onSelect,
}: {
  identity: Identity
  label: string
  onSelect: () => void
}) {
  const [failed, setFailed] = useState(false)
  const src = `/thumbs/sinner-${sinnerSlug(identity.sinner)}.png`
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      className="passport-sway group relative block w-full overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
    >
      {failed ? (
        <span className="flex aspect-[90/133] w-full items-center justify-center bg-zinc-800 text-lg font-semibold text-zinc-300">
          {label}
        </span>
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="w-full group-hover:brightness-110"
        />
      )}
    </button>
  )
}

function IdentityTile({
  identity,
  used,
  disabled,
  onGuess,
}: {
  identity: Identity
  used: boolean
  disabled: boolean
  onGuess: () => void
}) {
  const locked = used || disabled
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const sources = [identityThumb(identity), identity.image]
  const src = sources.find((source) => !failed.has(source))
  return (
    <button
      type="button"
      onClick={onGuess}
      disabled={locked}
      aria-label={identity.name_zh}
      title={identity.name_zh}
      className={`relative block w-full overflow-hidden transition hover:scale-[1.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
        used ? 'opacity-35' : ''
      } ${disabled && !used ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed((current) => new Set(current).add(src))}
          className="aspect-square w-full object-cover"
        />
      ) : (
        <span className="flex aspect-square w-full items-center justify-center bg-zinc-800 px-1 text-center text-xs leading-tight text-zinc-300">
          {identity.name_zh}
        </span>
      )}
      {used && (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center bg-zinc-950/40 text-2xl font-bold text-emerald-400"
        >
          ✓
        </span>
      )}
    </button>
  )
}

/**
 * Two-step picker: pick a sinner by portrait, then one of that sinner's identities.
 *
 * Nothing is written next to a portrait - names, ids and rarity text would all narrow
 * the search - so the only labels in the DOM are the `aria-label`s the screen reader
 * needs and the `title` tooltip on hover. Guessed identities stay on the board greyed
 * out with a tick rather than disappearing, which keeps the sinner grid from reflowing
 * as the round fills up.
 */
export function SinnerPicker({ identities, usedIds, disabled = false, onGuess }: Props) {
  const [openSinner, setOpenSinner] = useState<string | null>(null)

  const sinners = useMemo(
    () =>
      groupBySinner(identities)
        // `flatMap` rather than `map` because a group with no identity at all has no
        // portrait to render, and `icon` would be `undefined`.
        .flatMap((group) => {
          const icon =
            group.identities.find((identity) => identity.slug.startsWith('lcb-sinner-')) ??
            group.identities[0]
          if (!icon) return []
          return [
            {
              sinner: icon.sinner,
              label: group.sinnerZh,
              // The LCB base form is one per sinner and makes a consistent picker icon.
              icon,
              identities: group.identities,
            },
          ]
        })
        .sort(
          (a, b) =>
            SINNER_ORDER.indexOf(a.sinner as (typeof SINNER_ORDER)[number]) -
            SINNER_ORDER.indexOf(b.sinner as (typeof SINNER_ORDER)[number]),
        ),
    [identities],
  )

  const active = sinners.find((entry) => entry.sinner === openSinner) ?? null

  return (
    <section aria-label="選擇人格" className="px-1 pt-1">
      {active && (
        <button
          type="button"
          onClick={() => setOpenSinner(null)}
          className="mb-3 block text-xs text-zinc-500 underline hover:text-zinc-300"
        >
          ← 返回罪人列表
        </button>
      )}

      {active ? (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {active.identities.map((identity) => (
            <li key={identity.id}>
              <IdentityTile
                identity={identity}
                used={usedIds.has(identity.id)}
                disabled={disabled}
                onGuess={() => onGuess(identity)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-3 gap-5 sm:grid-cols-4 md:grid-cols-6">
          {sinners.map((entry) => (
            <li key={entry.sinner}>
              <SinnerIcon
                identity={entry.icon}
                label={entry.label}
                onSelect={() => setOpenSinner(entry.sinner)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
