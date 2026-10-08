import type { Identities, Identity } from '../types'

/**
 * Runtime access to the dataset.
 *
 * The identities used to be `import`ed straight into the bundle, which forced a rebuild
 * for every correction and left the same JSON sitting in two places. Everything now goes
 * through `fetch`: the dev server exposes `/api/db/*` (see `vite-plugin-db.ts`) and a
 * production build gets the files emitted as static assets under `data/`, so the client
 * has one code path in both modes.
 */

export const META_FILE = 'game_meta.json'
export const IDENTITIES_FILE = 'zh_identities.json'

/** Dev server API. Present only while `npm run dev` is running. */
const API_BASE = '/api/db'
/** Where `vite build` writes the same two files, relative to the served document. */
const STATIC_BASE = './data'

export type RarityEntry = {
  /** What the grid cell, dropdown and share text all display. */
  label: string
  /** Free-text note for the editor; never shown in game. */
  hint?: string
}

export type GameMeta = {
  version: number
  title: string
  subtitle: string
  tagline: string
  /** Keyed by the raw `Identity.rarity` value as a string, e.g. `"3"`. */
  rarity: Record<string, RarityEntry>
  /** 使用者在編輯器裡排好的標籤順序；缺省＝走內建的分塊＋賽季預設。 */
  tag_order?: string[]
}

export type Db = {
  meta: GameMeta
  identities: Identities
}

async function fetchJson<T>(name: string): Promise<T> {
  const failures: string[] = []

  for (const base of [API_BASE, STATIC_BASE]) {
    let response: Response
    try {
      response = await fetch(`${base}/${name}`, { cache: 'no-store' })
    } catch (error) {
      failures.push(`${base}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (response.status === 404) continue
    if (!response.ok) {
      failures.push(`${base}: HTTP ${response.status}`)
      continue
    }
    return (await response.json()) as T
  }

  throw new Error(`無法載入 ${name}${failures.length ? `（${failures.join('；')}）` : ''}`)
}

/** Load both halves of the dataset. They are independent files, so they load in parallel. */
export async function loadDb(): Promise<Db> {
  const [meta, identities] = await Promise.all([
    fetchJson<GameMeta>(META_FILE),
    fetchJson<Identities>(IDENTITIES_FILE),
  ])
  if (!Array.isArray(identities) || identities.length === 0) {
    throw new Error('人格資料是空的，無法開始遊戲')
  }
  return { meta, identities }
}

export class DbWriteError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join('\n'))
    this.name = 'DbWriteError'
  }
}

async function putJson(name: string, value: unknown): Promise<void> {
  const response = await fetch(`${API_BASE}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  })

  if (response.ok) return

  // The API reports per-field problems as `{errors: [...]}`; fall back to the status text
  // for anything else (no server, read-only preview, network failure).
  let detail = `HTTP ${response.status}`
  try {
    const body = (await response.json()) as { errors?: unknown; error?: unknown }
    if (Array.isArray(body.errors) && body.errors.every((e) => typeof e === 'string')) {
      throw new DbWriteError(body.errors as string[])
    }
    if (typeof body.error === 'string') detail = body.error
  } catch (error) {
    if (error instanceof DbWriteError) throw error
  }
  throw new DbWriteError([detail])
}

export function saveMeta(meta: GameMeta): Promise<void> {
  return putJson(META_FILE, meta)
}

export function saveIdentities(identities: Identities): Promise<void> {
  return putJson(IDENTITIES_FILE, identities)
}

/**
 * Single source of truth for how a rarity is written. Every surface - grid cell, search
 * result, result screen, share text - goes through here, so they cannot disagree.
 */
export function rarityLabel(meta: GameMeta, rarity: number): string {
  return meta.rarity[String(rarity)]?.label ?? String(rarity)
}

/** Ids of identities whose rarity has no label configured. */
export function missingRarityLabels(meta: GameMeta, identities: Identities): number[] {
  const missing = new Set<number>()
  for (const identity of identities) {
    if (!meta.rarity[String(identity.rarity)]) missing.add(identity.rarity)
  }
  return [...missing].sort((a, b) => a - b)
}

/** Rarity values actually used by the roster, ascending. */
export function usedRarities(identities: Identities): number[] {
  return [...new Set(identities.map((identity) => identity.rarity))].sort((a, b) => a - b)
}

export type { Identity, Identities }