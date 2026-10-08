import type { Identities, Identity } from '../types'

/**
 * Derived views over the loaded roster.
 *
 * The dataset used to be imported here as a module constant, which froze the identities at
 * build time. Everything is now built from whatever `db.ts` loaded, so an edit saved in the
 * editor takes effect on the next reload.
 */

export type Roster = {
  all: Identities
  byId: ReadonlyMap<number, Identity>
}

export function buildRoster(identities: Identities): Roster {
  return {
    all: identities,
    byId: new Map(identities.map((identity) => [identity.id, identity])),
  }
}

export type SinnerGroup = {
  sinnerZh: string
  identities: Identity[]
}

/**
 * Group identities by sinner, in order of first appearance in id order.
 *
 * That ordering is arbitrary but stable, and it is derived rather than hardcoded so
 * reshuffling the dataset cannot silently move a tab.
 */
export function groupBySinner(identities: Identities): SinnerGroup[] {
  const groups = new Map<string, Identity[]>()
  for (const identity of [...identities].sort((a, b) => a.id - b.id)) {
    const bucket = groups.get(identity.sinner_zh)
    if (bucket) bucket.push(identity)
    else groups.set(identity.sinner_zh, [identity])
  }
  return [...groups].map(([sinnerZh, list]) => ({ sinnerZh, identities: list }))
}