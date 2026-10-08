import { useState } from 'react'
import type { Identity } from '../types'

type Props = {
  identity: Identity
  size?: number
  className?: string
}

/**
 * Identity thumbnail: the local 128px icon first, the Limbusdeck CDN as the safety
 * net, and finally the first letter of the Chinese name so a dead asset degrades
 * into a readable chip instead of a broken-image glyph.
 */
export function IdentityAvatar({ identity, size = 56, className = '' }: Props) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const dimension = { width: size, height: size }
  const sources = [`/thumbs/${identity.id}.png`, identity.image]
  const src = sources.find((source) => !failed.has(source))

  if (!src) {
    return (
      <div
        {...dimension}
        className={`flex items-center justify-center bg-zinc-800 font-bold text-zinc-400 ${className}`}
        aria-hidden="true"
      >
        {identity.name_zh.slice(0, 1)}
      </div>
    )
  }

  return (
    <img
      {...dimension}
      src={src}
      alt={identity.name_zh}
      loading="lazy"
      decoding="async"
      onError={() => setFailed((current) => new Set(current).add(src))}
      className={`object-cover ${className}`}
    />
  )
}
