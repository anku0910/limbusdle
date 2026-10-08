import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DbWriteError,
  missingRarityLabels,
  saveIdentities,
  saveMeta,
  usedRarities,
  type Db,
  type GameMeta,
} from '../lib/db'
import { buildSearchIndex, search } from '../lib/search'
import { makeTagComparator, tagBlockRank } from '../lib/tagOrder'
import { assertImportedIdentities, csvToIdentities, identitiesToCsv } from '../lib/csv'
import { checkHealth } from '../lib/health'
import { orphanTags, removableCount, removeTagEverywhere, replaceTag, tagCounts } from '../lib/tagTools'
import { IdentityAvatar } from './IdentityAvatar'
import { SKILL_ROLE_LABELS, type Identity, type Identities, type SkillRole, type SkillZh } from '../types'

/**
 * Browser-side editor for the dataset in `../data`.
 *
 * Writes go through `PUT /api/db/*`, which only exists while `npm run dev` is running -
 * that is deliberate, because it means an edit lands in the same JSON file the Python
 * extractors produce and shows up as a normal git diff. Against a production build the
 * API is absent, so every control here is disabled with an explanation instead of failing
 * on click.
 *
 * Scope is field-level only. Adding or removing an identity would change the roster
 * length, which re-shuffles the seeded daily answer and invalidates every saved round, so
 * the API rejects it outright.
 */

type Tab = 'meta' | 'identities'

/** 用來比較「內容」而不是「鍵順序」的序列化：CSV 匯入重建過物件，鍵順序會不同。 */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const source = entry as Record<string, unknown>
      return Object.fromEntries(Object.keys(source).sort().map((key) => [key, source[key]]))
    }
    return entry
  })
}

type HistoryEntry = { label: string; at: number; state: Identities }

export function DataEditor({ db, onReload }: { db: Db; onReload: () => void }) {
  const [tab, setTab] = useState<Tab>('meta')
  const [meta, setMeta] = useState<GameMeta>(db.meta)
  const [identities, setIdentities] = useState<Identities>(db.identities)

  // 人格變更的操作紀錄；meta（文案、稀有度、標籤順序）不進歷史。
  const [past, setPast] = useState<HistoryEntry[]>([])
  const [future, setFuture] = useState<HistoryEntry[]>([])

  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // Dirty state is diffed against the snapshot that was loaded, not against the previous
  // render, so a save followed by a reload always starts from a clean slate.
  const metaDirty = canonicalJson(meta) !== canonicalJson(db.meta)
  const identitiesDirty = canonicalJson(identities) !== canonicalJson(db.identities)
  const dirty = metaDirty || identitiesDirty

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const missing = useMemo(
    () => missingRarityLabels(meta, identities),
    [meta, identities],
  )
  const inUse = useMemo(() => usedRarities(identities), [identities])

  // 連續輸入同一個欄位會併成一筆紀錄（2 秒內、同標籤），不然打一個字就爆一筆。
  const commit = (next: Identities, label: string) => {
    if (next === identities) return
    const now = Date.now()
    setPast((previous) => {
      const last = previous[previous.length - 1]
      const coalesced = last && last.label === label && now - last.at < 2000
      const entry: HistoryEntry = { label, at: now, state: identities }
      const merged = coalesced
        ? [...previous.slice(0, -1), entry]
        : [...previous, entry]
      return merged.slice(-50)
    })
    setFuture([])
    setIdentities(next)
  }

  const undo = () => {
    const entry = past[past.length - 1]
    if (!entry) return
    setPast(past.slice(0, -1))
    setFuture([{ label: entry.label, at: Date.now(), state: identities }, ...future].slice(0, 50))
    setIdentities(entry.state)
  }

  const redo = () => {
    const entry = future[0]
    if (!entry) return
    setFuture(future.slice(1))
    setPast([...past, { label: entry.label, at: Date.now(), state: identities }].slice(-50))
    setIdentities(entry.state)
  }

  const setTagOrder = (next: string[] | null) => {
    setMeta((current) => {
      const draft = { ...current }
      if (next === null) delete draft.tag_order
      else draft.tag_order = next
      return draft
    })
  }

  // 標籤瀏覽順序、資料健康與選取狀態都提升到這裡，讓左側狀態卡、底部工具帶與表單共用同一份結果。
  const compareTag = useMemo(
    () => makeTagComparator(identities, meta.tag_order ?? []),
    [identities, meta.tag_order],
  )
  const tagOptions = useMemo(() => {
    const tags = new Set<string>()
    for (const identity of identities) for (const tag of identity.tags_zh) tags.add(tag)
    return [...tags].sort(compareTag)
  }, [identities, compareTag])
  const health = useMemo(() => checkHealth(identities, meta.rarity), [identities, meta.rarity])

  const update = (id: number, patch: Partial<Identity>) => {
    if (Object.keys(patch).length === 0) return
    const next = identities.map((identity) =>
      identity.id === id ? { ...identity, ...patch } : identity,
    )
    commit(next, `修改 #${id}：${Object.keys(patch).join('、')}`)
  }

  const selected = selectedId === null ? null : identities.find((i) => i.id === selectedId) ?? null

  const save = useCallback(async () => {
    setSaving(true)
    setErrors([])
    try {
      if (metaDirty) await saveMeta(meta)
      if (identitiesDirty) await saveIdentities(identities)
      setSavedAt(new Date().toLocaleTimeString('zh-TW'))
      // Re-read from disk rather than trusting local state, so what the game shows next is
      // exactly what the files contain.
      onReload()
    } catch (error) {
      setErrors(
        error instanceof DbWriteError
          ? error.errors
          : [error instanceof Error ? error.message : String(error)],
      )
    } finally {
      setSaving(false)
    }
  }, [meta, identities, metaDirty, identitiesDirty, onReload])

  const discard = () => {
    setMeta(db.meta)
    commit(db.identities, '捨棄變更')
    setErrors([])
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="h-5 w-1 bg-amber-500" aria-hidden="true" />
          <h1 className="text-lg font-bold">資料編輯器</h1>
          <span className="hidden text-xs text-zinc-500 md:inline">
            儲存後會直接寫入 <code className="text-zinc-400">data/</code> 底下的 JSON
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {dirty && <span className="text-xs text-amber-400">有未儲存的變更</span>}
            {savedAt && !dirty && (
              <span className="text-xs text-emerald-400">已於 {savedAt} 儲存</span>
            )}
            <span className="h-5 w-px bg-zinc-800" aria-hidden="true" />
            <button
              type="button"
              aria-label="復原上一步"
              onClick={undo}
              disabled={past.length === 0 || saving}
              className={miniButton}
            >
              復原
            </button>
            <button
              type="button"
              aria-label="重做下一步"
              onClick={redo}
              disabled={future.length === 0 || saving}
              className={miniButton}
            >
              重做
            </button>
            <button
              type="button"
              onClick={discard}
              disabled={!dirty || saving}
              className="bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
            >
              捨棄變更
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="bg-amber-500 px-3 py-1.5 text-sm font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
            >
              {saving ? '儲存中…' : '儲存'}
            </button>
            <a
              href="#/"
              className="bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
            >
              回到遊戲
            </a>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row lg:items-start">
        <aside className="border-b border-zinc-800 lg:sticky lg:top-14 lg:max-h-[calc(100vh-3.5rem)] lg:w-48 lg:self-start lg:overflow-y-auto lg:border-b-0 lg:border-r xl:w-56">
          <nav className="flex gap-1 border-b border-zinc-800 p-2 lg:flex-col lg:border-b-0">
            <TabButton active={tab === 'meta'} onClick={() => setTab('meta')}>
              設定
              {metaDirty && <Dot />}
            </TabButton>
            <TabButton active={tab === 'identities'} onClick={() => setTab('identities')}>
              人格（{identities.length}）
              {identitiesDirty && <Dot />}
            </TabButton>
          </nav>

          <div className="space-y-3 p-3">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs text-zinc-400 hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
                <span>操作紀錄（{past.length}）</span>
                <span
                  className="text-[10px] text-zinc-600 transition-transform group-open:rotate-90"
                  aria-hidden="true"
                >
                  ▶
                </span>
              </summary>
              <ul className="mt-2 space-y-0.5 text-xs text-zinc-500">
                {past.length === 0 ? (
                  <li>尚無操作</li>
                ) : (
                  [...past].reverse().map((entry, index) => (
                    <li key={`${entry.at}-${index}`}>{entry.label}</li>
                  ))
                )}
              </ul>
            </details>

            <div className="border border-zinc-800 bg-zinc-900/40 p-3">
              <h2 className="mb-2 text-xs font-semibold text-zinc-400">資料狀態</h2>
              <dl className="space-y-1 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-zinc-500">人格</dt>
                  <dd className="font-mono text-zinc-300">{identities.length}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-zinc-500">標籤</dt>
                  <dd className="font-mono text-zinc-300">{tagOptions.length}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-zinc-500">孤兒標籤</dt>
                  <dd className="font-mono text-zinc-300">{health.orphans.length}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-zinc-500">健康</dt>
                  <dd className={health.issues.length > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                    {health.issues.length > 0 ? `${health.issues.length} 問題` : '正常'}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 space-y-4 p-4 xl:p-6">
          {errors.length > 0 && (
            <div className="border border-rose-800 bg-rose-950/40 p-4">
              <h2 className="mb-2 text-sm font-bold text-rose-300">儲存失敗</h2>
              <ul className="list-inside list-disc space-y-1 text-sm text-zinc-300">
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          {missing.length > 0 && (
            <div className="border border-amber-700 bg-amber-950/30 p-4 text-sm text-amber-200">
              稀有度 {missing.join('、')} 有人格使用，但沒有設定顯示文字。這些格子會直接顯示數字。
            </div>
          )}

          {tab === 'meta' ? (
            <MetaPanel meta={meta} onChange={setMeta} inUse={inUse} identities={identities} />
          ) : (
            <IdentitiesPanel
              identities={identities}
              onChange={commit}
              rarityMeta={meta.rarity}
              expectedCount={db.identities.length}
              tagOptions={tagOptions}
              selectedId={selectedId}
              onSelectId={setSelectedId}
              onUpdate={update}
            />
          )}
        </main>

        {tab === 'identities' && (
          <aside className="border-t border-zinc-800 lg:sticky lg:top-14 lg:max-h-[calc(100vh-3.5rem)] lg:w-80 lg:self-start lg:overflow-y-auto lg:border-t-0 lg:border-l xl:w-96">
            <div className="p-4">
              <h2 className="mb-3 text-xs font-semibold text-zinc-400">欄位編輯</h2>
              {selected ? (
                <IdentityForm
                  key={selected.id}
                  identity={selected}
                  onChange={(patch) => update(selected.id, patch)}
                />
              ) : (
                <div className="border border-dashed border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-500">
                  <p className="mb-2 font-medium text-zinc-400">尚未選擇人格</p>
                  <ol className="list-inside list-decimal space-y-1">
                    <li>在「人格」分頁用搜尋或篩選找到對象。</li>
                    <li>點選清單中的一列。</li>
                    <li>這裡會顯示所有可編輯欄位。</li>
                    <li>完成後按上方「儲存」寫回 JSON。</li>
                  </ol>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {tab === 'identities' && (
        <div className="border-t border-zinc-800 bg-zinc-900/40 px-4 py-4 xl:px-6">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-sm font-bold text-zinc-200">資料工具</h2>
            <p className="text-xs text-zinc-500">
              統計、健康檢查、重複檢查、標籤順序與標籤管理。
            </p>
          </div>
          <div className="grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-3">
            <details className="group border border-zinc-800 bg-zinc-900/70 lg:col-span-2">
              <ToolSummary>統計</ToolSummary>
              <div className="border-t border-zinc-800 p-4">
                <StatsBlock identities={identities} rarityMeta={meta.rarity} compareTag={compareTag} />
              </div>
            </details>
            <details className="group border border-zinc-800 bg-zinc-900/70">
              <ToolSummary>健康檢查</ToolSummary>
              <div className="border-t border-zinc-800 p-4">
                <HealthBlock report={health} identities={identities} onSelect={setSelectedId} />
              </div>
            </details>
            <details className="group border border-zinc-800 bg-zinc-900/70">
              <ToolSummary>重複檢查</ToolSummary>
              <div className="border-t border-zinc-800 p-4">
                <DupBlock identities={identities} />
              </div>
            </details>
            <details className="group border border-zinc-800 bg-zinc-900/70">
              <ToolSummary>標籤順序</ToolSummary>
              <div className="border-t border-zinc-800 p-4">
                <TagOrderBoard
                  order={tagOptions}
                  counts={tagCounts(identities)}
                  customized={meta.tag_order !== undefined}
                  onApply={setTagOrder}
                />
              </div>
            </details>
            <details className="group border border-zinc-800 bg-zinc-900/70">
              <ToolSummary>標籤管理</ToolSummary>
              <div className="border-t border-zinc-800 p-4">
                <TagToolsBlock identities={identities} onApply={commit} />
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  )
}

function Dot() {
  return <span className="ml-1.5 inline-block size-1.5 bg-amber-400" />
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex flex-1 items-center gap-1 border-b-2 px-3 py-2 text-sm font-medium lg:flex-none lg:border-b-0 lg:border-l-2 ${
        active
          ? 'border-amber-500 bg-zinc-800/70 text-zinc-100'
          : 'border-transparent text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  )
}

function ToolSummary({ children }: { children: React.ReactNode }) {
  return (
    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
      <span className="h-3 w-0.5 bg-amber-500" aria-hidden="true" />
      <span>{children}</span>
      <span className="ml-auto text-[10px] text-zinc-600 transition-transform group-open:rotate-90">
        ▶
      </span>
    </summary>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-zinc-600">{hint}</span>}
    </label>
  )
}

const inputClass =
  'w-full border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-amber-500'

const miniClass =
  'border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-amber-500'

const miniButton =
  'bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-40'

function MetaPanel({
  meta,
  onChange,
  inUse,
  identities,
}: {
  meta: GameMeta
  onChange: (next: GameMeta) => void
  inUse: number[]
  identities: Identities
}) {
  const patch = (partial: Partial<GameMeta>) => onChange({ ...meta, ...partial })

  const rarityKeys = Object.keys(meta.rarity).sort((a, b) => Number(a) - Number(b))

  const setRarity = (key: string, entry: Partial<GameMeta['rarity'][string]>) => {
    onChange({
      ...meta,
      rarity: { ...meta.rarity, [key]: { ...meta.rarity[key], ...entry } },
    })
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
      <section className="border border-zinc-800 bg-zinc-900/70 p-4">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-zinc-300">
          <span className="h-3.5 w-0.5 bg-amber-500" aria-hidden="true" />
          文案
        </h2>
        <div className="grid gap-4">
          <Field label="主標">
            <input
              className={inputClass}
              value={meta.title}
              onChange={(event) => patch({ title: event.target.value })}
            />
          </Field>
          <Field label="副標">
            <input
              className={inputClass}
              value={meta.subtitle}
              onChange={(event) => patch({ subtitle: event.target.value })}
            />
          </Field>
          <div>
            <Field label="說明文字" hint="遊戲人數會自動接在此句後方。">
              <input
                className={inputClass}
                value={meta.tagline}
                onChange={(event) => patch({ tagline: event.target.value })}
              />
            </Field>
          </div>
        </div>
      </section>

      <section className="border border-zinc-800 bg-zinc-900/70 p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-zinc-300">
          <span className="h-3.5 w-0.5 bg-amber-500" aria-hidden="true" />
          稀有度顯示
        </h2>
        <p className="mb-4 text-xs text-zinc-500">
          這裡的文字會同時用在猜測網格、搜尋結果、結果畫面與分享文字。
        </p>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="w-16 pb-2 font-normal">內部值</th>
              <th className="w-32 pb-2 font-normal">顯示文字</th>
              <th className="pb-2 font-normal">備註</th>
              <th className="w-32 pb-2 font-normal">網格預覽</th>
              <th className="w-16 pb-2 font-normal">使用中</th>
            </tr>
          </thead>
          <tbody>
            {rarityKeys.map((key) => (
              <tr key={key} className="border-t border-zinc-800">
                <td className="py-2 align-middle font-mono text-zinc-500">{key}</td>
                <td className="py-2 pr-3 align-middle">
                  <input
                    className={inputClass}
                    value={meta.rarity[key].label}
                    onChange={(event) => setRarity(key, { label: event.target.value })}
                  />
                </td>
                <td className="py-2 pr-3 align-middle">
                  <input
                    className={inputClass}
                    value={meta.rarity[key].hint ?? ''}
                    onChange={(event) => setRarity(key, { hint: event.target.value })}
                  />
                </td>
                <td className="py-2 pr-3 align-middle">
                  <GridPreview label={meta.rarity[key].label || '—'} />
                </td>
                <td className="py-2 align-middle text-xs text-zinc-500">
                  {inUse.includes(Number(key))
                    ? `${identities.filter((i) => i.rarity === Number(key)).length} 筆`
                    : '未使用'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function GridPreview({ label }: { label: string }) {
  return (
    <div className="flex gap-1">
      <span className="flex h-[34px] min-w-[52px] items-center justify-center bg-emerald-600 px-2 text-xs font-medium text-white">
        {label}
      </span>
      <span className="flex h-[34px] min-w-[52px] items-center justify-center bg-slate-600 px-2 text-xs font-medium text-white">
        {label}
        <span className="ml-0.5 text-[10px]">▲</span>
      </span>
    </div>
  )
}

/** Lists are edited as one delimited string so a cell can hold several values. */
const LIST_SEPARATOR = /[、,，/]+/

function toList(value: string): string[] {
  return value
    .split(LIST_SEPARATOR)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function toText(list: string[]): string {
  return list.join('、')
}

type SortKey = 'id' | 'name' | 'sinner' | 'rarity' | 'season'

const SORT_LABELS: Record<SortKey, string> = {
  id: 'id',
  name: '名稱',
  sinner: '罪人',
  rarity: '稀有度',
  season: '賽季',
}

function compareIdentities(a: Identity, b: Identity, key: SortKey): number {
  switch (key) {
    case 'id':
      return a.id - b.id
    case 'name':
      return a.name_zh.localeCompare(b.name_zh, 'zh-Hant') || a.id - b.id
    case 'sinner':
      return (
        a.sinner_zh.localeCompare(b.sinner_zh, 'zh-Hant') ||
        a.name_zh.localeCompare(b.name_zh, 'zh-Hant') ||
        a.id - b.id
      )
    case 'rarity':
      return a.rarity - b.rarity || a.id - b.id
    case 'season':
      return a.season - b.season || a.id - b.id
  }
}

function groupByIdentity(
  identities: Identities,
  key: (identity: Identity) => string,
): [string, Identity[]][] {
  const groups = new Map<string, Identity[]>()
  for (const identity of identities) {
    const bucket = groups.get(key(identity))
    if (bucket) bucket.push(identity)
    else groups.set(key(identity), [identity])
  }
  return [...groups]
}

function IdentitiesPanel({
  identities,
  onChange,
  rarityMeta,
  expectedCount,
  tagOptions,
  selectedId,
  onSelectId,
  onUpdate,
}: {
  identities: Identities
  onChange: (next: Identities, label: string) => void
  rarityMeta: GameMeta['rarity']
  expectedCount: number
  tagOptions: string[]
  selectedId: number | null
  onSelectId: (id: number | null) => void
  onUpdate: (id: number, patch: Partial<Identity>) => void
}) {
  const [query, setQuery] = useState('')
  const [rarityFilter, setRarityFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [keywordFilter, setKeywordFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [batchTag, setBatchTag] = useState('')
  const [batchRarity, setBatchRarity] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [importNote, setImportNote] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [quickId, setQuickId] = useState<number | null>(null)
  const [quickDraft, setQuickDraft] = useState('')
  const [quickRarity, setQuickRarity] = useState('')

  const index = useMemo(() => buildSearchIndex(identities), [identities])

  const rarityOptions = useMemo(
    () => [...new Set(identities.map((identity) => identity.rarity))].sort((a, b) => a - b),
    [identities],
  )
  const keywordOptions = useMemo(() => {
    const words = new Set<string>()
    for (const identity of identities) for (const word of identity.keywords_zh) words.add(word)
    return [...words].sort((a, b) => a.localeCompare(b, 'zh-Hant'))
  }, [identities])

  // Text search first (it caps at 60 hits), then the three select filters on top of
  // whatever the search returned, then the optional column sort.
  const results = useMemo(() => {
    const base = query.trim()
      ? search(index, query, 60)
      : index.map((entry) => ({ ...entry, score: 0 }))
    const filtered = base.filter(
      ({ identity }) =>
        (rarityFilter === '' || identity.rarity === Number(rarityFilter)) &&
        (tagFilter === '' || identity.tags_zh.includes(tagFilter)) &&
        (keywordFilter === '' || identity.keywords_zh.includes(keywordFilter)),
    )
    if (!sort) return filtered
    const direction = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort(
      (a, b) => direction * compareIdentities(a.identity, b.identity, sort.key),
    )
  }, [index, query, rarityFilter, tagFilter, keywordFilter, sort])

  // 分頁：篩選或排序一變就回到第一頁，快速編輯也先收起來。
  const pageSize = 50
  const pageCount = Math.max(1, Math.ceil(results.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = results.slice(currentPage * pageSize, currentPage * pageSize + pageSize)
  useEffect(() => {
    setPage(0)
    setQuickId(null)
  }, [query, rarityFilter, tagFilter, keywordFilter, sort])

  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current?.key === key
        ? current.dir === 'asc'
          ? { key, dir: 'desc' }
          : null
        : { key, dir: 'asc' },
    )

  const allChecked = results.length > 0 && results.every(({ identity }) => checked.has(identity.id))
  const toggleChecked = (id: number) =>
    setChecked((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = (on: boolean) =>
    setChecked((previous) => {
      const next = new Set(previous)
      for (const { identity } of results) {
        if (on) next.add(identity.id)
        else next.delete(identity.id)
      }
      return next
    })

  const applyBatch = (patch: (identity: Identity) => Identity, label: string) => {
    let changed = false
    const next = identities.map((identity) => {
      if (!checked.has(identity.id)) return identity
      const updated = patch(identity)
      if (updated !== identity) changed = true
      return updated
    })
    if (changed) onChange(next, label)
  }

  const batchAddTag = () => {
    const tag = batchTag.trim()
    if (!tag) return
    applyBatch(
      (identity) =>
        identity.tags_zh.includes(tag)
          ? identity
          : { ...identity, tags_zh: [...identity.tags_zh, tag] },
      `批次加入標籤「${tag}」`,
    )
  }

  const batchRemoveTag = () => {
    const tag = batchTag.trim()
    if (!tag) return
    // Never strip an identity down to zero tags - the API rejects that on save.
    applyBatch(
      (identity) =>
        !identity.tags_zh.includes(tag) || identity.tags_zh.length <= 1
          ? identity
          : { ...identity, tags_zh: identity.tags_zh.filter((entry) => entry !== tag) },
      `批次移除標籤「${tag}」`,
    )
  }

  const batchSetRarity = () => {
    const rarity = Number(batchRarity)
    if (!rarity) return
    applyBatch(
      (identity) => (identity.rarity === rarity ? identity : { ...identity, rarity }),
      `批次設定稀有度 ${rarity}`,
    )
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(identities, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'zh_identities.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const exportCsv = () => {
    const blob = new Blob([identitiesToCsv(identities)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'zh_identities.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const finishImport = (next: Identities, label: string) => {
    onChange(next, label)
    setImportNote(`已載入 ${next.length} 筆。`)
    onSelectId(null)
    setChecked(new Set())
    setQuickId(null)
  }

  const importJson = async (file: File) => {
    setImportError(null)
    setImportNote(null)
    let text: string
    try {
      text = await file.text()
    } catch {
      setImportError('無法讀取檔案。')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setImportError('檔案不是合法的 JSON。')
      return
    }
    try {
      finishImport(assertImportedIdentities(parsed, expectedCount), '匯入 JSON')
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  const importCsv = async (file: File) => {
    setImportError(null)
    setImportNote(null)
    try {
      const text = await file.text()
      finishImport(csvToIdentities(text, expectedCount), '匯入 CSV')
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className="space-y-4">
      <div className="border border-zinc-800 bg-zinc-900/70 p-4">
        <input
          className={`${inputClass} mb-3`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="篩選人格：中文字、拼音首字母（lx）、全拼或英文名"
          aria-label="篩選人格"
        />
        <div className="mb-3 grid grid-cols-3 gap-2">
          <select
            className={inputClass}
            value={rarityFilter}
            onChange={(event) => setRarityFilter(event.target.value)}
            aria-label="稀有度篩選"
          >
            <option value="">全部稀有度</option>
            {rarityOptions.map((rarity) => (
              <option key={rarity} value={String(rarity)}>
                稀有度 {rarity}（{rarityMeta[String(rarity)]?.label || rarity}）
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            aria-label="標籤篩選"
          >
            <option value="">全部標籤</option>
            {tagOptions.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={keywordFilter}
            onChange={(event) => setKeywordFilter(event.target.value)}
            aria-label="關鍵字篩選"
          >
            <option value="">全部關鍵字</option>
            {keywordOptions.map((word) => (
              <option key={word} value={word}>
                {word}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">排序</span>
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => {
            const active = sort?.key === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleSort(key)}
                aria-label={`依 ${SORT_LABELS[key]} 排序`}
                aria-pressed={active || undefined}
                className={`px-2 py-1 text-xs ${
                  active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {SORT_LABELS[key]}
                {active && <span aria-hidden="true">{sort?.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
              </button>
            )
          })}
          <span className="ml-auto flex items-center gap-2">
            <button type="button" aria-label="匯出 JSON" onClick={exportJson} className={miniButton}>
              匯出 JSON
            </button>
            <label className={`${miniButton} cursor-pointer`}>
              匯入 JSON
              <input
                type="file"
                accept=".json,application/json"
                aria-label="匯入 JSON"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void importJson(file)
                  event.target.value = ''
                }}
              />
            </label>
            <button type="button" aria-label="匯出 CSV" onClick={exportCsv} className={miniButton}>
              匯出 CSV
            </button>
            <label className={`${miniButton} cursor-pointer`}>
              匯入 CSV
              <input
                type="file"
                accept=".csv,text/csv"
                aria-label="匯入 CSV"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void importCsv(file)
                  event.target.value = ''
                }}
              />
            </label>
          </span>
        </div>

        <p className="mb-2 text-xs text-zinc-500">
          符合 {results.length} 筆，點選一列即可編輯欄位。編輯器不開放新增或刪除人格。
        </p>
        {importError && <p className="mb-2 text-xs text-rose-400">{importError}</p>}
        {importNote && <p className="mb-2 text-xs text-emerald-400">{importNote}</p>}

        <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
          <button
            type="button"
            aria-label="上一頁"
            onClick={() => setPage(currentPage - 1)}
            disabled={currentPage === 0}
            className={miniButton}
          >
            上一頁
          </button>
          <span>第 {currentPage + 1} / {pageCount} 頁</span>
          <button
            type="button"
            aria-label="下一頁"
            onClick={() => setPage(currentPage + 1)}
            disabled={currentPage >= pageCount - 1}
            className={miniButton}
          >
            下一頁
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border border-zinc-800 bg-zinc-900/70 p-3 text-xs">
          <label className="flex cursor-pointer items-center gap-1.5 text-zinc-400">
            <input
              type="checkbox"
              className="size-3.5 accent-amber-500"
              checked={allChecked}
              onChange={(event) => toggleAll(event.target.checked)}
              aria-label="全選符合的人格"
            />
            全選
          </label>
          <span className="text-zinc-500">已選 {checked.size} 筆</span>
          <input
            className={`${miniClass} w-28`}
            value={batchTag}
            onChange={(event) => setBatchTag(event.target.value)}
            placeholder="標籤"
            aria-label="批次標籤"
          />
          <button
            type="button"
            className={miniButton}
            disabled={checked.size === 0 || !batchTag.trim()}
            onClick={batchAddTag}
          >
            加入
          </button>
          <button
            type="button"
            className={miniButton}
            disabled={checked.size === 0 || !batchTag.trim()}
            onClick={batchRemoveTag}
          >
            移除
          </button>
          <select
            className={miniClass}
            value={batchRarity}
            onChange={(event) => setBatchRarity(event.target.value)}
            aria-label="批次稀有度"
          >
            <option value="">稀有度</option>
            {rarityOptions.map((rarity) => (
              <option key={rarity} value={String(rarity)}>
                稀有度 {rarity}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={miniButton}
            disabled={checked.size === 0 || !batchRarity}
            onClick={batchSetRarity}
          >
            套用
          </button>
          <button
            type="button"
            className={miniButton}
            disabled={checked.size === 0}
            onClick={() => setChecked(new Set())}
          >
            清除選取
          </button>
        </div>

      <div className="border border-zinc-800 bg-zinc-900/70">
        <ul
          aria-label="人格清單"
          className="max-h-[40rem] divide-y divide-zinc-800 overflow-auto"
        >
          {pageRows.map(({ identity }) =>
            quickId === identity.id ? (
              <li key={identity.id} className="flex items-center gap-2 px-2 py-2">
                <input
                  className={`${miniClass} min-w-0 flex-1`}
                  value={quickDraft}
                  onChange={(event) => setQuickDraft(event.target.value)}
                  aria-label={`快速標籤 ${identity.name_zh}`}
                />
                <select
                  className={miniClass}
                  value={quickRarity}
                  onChange={(event) => setQuickRarity(event.target.value)}
                  aria-label={`快速稀有度 ${identity.name_zh}`}
                >
                  {rarityOptions.map((rarity) => (
                    <option key={rarity} value={String(rarity)}>
                      稀有度 {rarity}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={miniButton}
                  aria-label={`完成快速編輯 ${identity.name_zh}`}
                  onClick={() => {
                    const patch: Partial<Identity> = {}
                    const nextTags = toList(quickDraft)
                    if (nextTags.join('、') !== identity.tags_zh.join('、')) patch.tags_zh = nextTags
                    const rarity = Number(quickRarity)
                    if (rarity && rarity !== identity.rarity) patch.rarity = rarity
                    setQuickId(null)
                    if (Object.keys(patch).length > 0) onUpdate(identity.id, patch)
                  }}
                >
                  完成
                </button>
                <button
                  type="button"
                  className={miniButton}
                  aria-label={`取消快速編輯 ${identity.name_zh}`}
                  onClick={() => setQuickId(null)}
                >
                  取消
                </button>
              </li>
            ) : (
            <li
              key={identity.id}
              className={`flex items-center border-l-2 ${
                identity.id === selectedId ? 'border-amber-500 bg-zinc-800' : 'border-transparent'
              }`}
            >
              <input
                type="checkbox"
                className="mx-2 size-4 shrink-0 accent-amber-500"
                checked={checked.has(identity.id)}
                onChange={() => toggleChecked(identity.id)}
                aria-label={`選取 ${identity.name_zh}`}
              />
              <button
                type="button"
                onClick={() => onSelectId(identity.id)}
                aria-current={identity.id === selectedId ? 'true' : undefined}
                className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left hover:bg-zinc-800/60"
              >
                <IdentityAvatar identity={identity} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-zinc-100">{identity.name_zh}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
                    <span>{identity.sinner_zh}</span>
                    <span className="flex flex-wrap gap-1">
                      {identity.tags_zh.map((tag) => (
                        <span
                          key={tag}
                          className={`border-l-2 pl-1 ${
                            TAG_BLOCK_COLORS[tagBlockRank(tag)] ??
                            TAG_BLOCK_COLORS[TAG_BLOCK_COLORS.length - 1]
                          }`}
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                    <span className="text-zinc-600">{identity.rarity}</span>
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-600">{identity.id}</span>
              </button>
              <button
                type="button"
                className={`${miniButton} mx-2 shrink-0`}
                aria-label={`快速編輯 ${identity.name_zh}`}
                onClick={() => {
                  setQuickId(identity.id)
                  setQuickDraft(toText(identity.tags_zh))
                  setQuickRarity(String(identity.rarity))
                }}
              >
                快改
              </button>
            </li>
            ),
          )}
        </ul>
      </div>
    </section>
  )
}

/** Live roster overview - counts come straight from the edited rows so an unsaved
 *  edit shows up here immediately. */
function StatsBlock({
  identities,
  rarityMeta,
  compareTag,
}: {
  identities: Identities
  rarityMeta: GameMeta['rarity']
  compareTag: (a: string, b: string) => number
}) {
  const { byRarity, bySeason, bySinner, topTags } = useMemo(() => {
    const rarityCounts = new Map<number, number>()
    const seasonCounts = new Map<number, { label: string; count: number }>()
    const sinnerCounts = new Map<string, number>()
    const tagCounts = new Map<string, number>()
    for (const identity of identities) {
      rarityCounts.set(identity.rarity, (rarityCounts.get(identity.rarity) ?? 0) + 1)
      const season = seasonCounts.get(identity.season) ?? { label: identity.season_zh, count: 0 }
      season.count += 1
      seasonCounts.set(identity.season, season)
      sinnerCounts.set(identity.sinner_zh, (sinnerCounts.get(identity.sinner_zh) ?? 0) + 1)
      for (const tag of identity.tags_zh) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
    return {
      byRarity: [...rarityCounts].sort((a, b) => a[0] - b[0]),
      bySeason: [...seasonCounts].sort((a, b) => a[0] - b[0]),
      bySinner: [...sinnerCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant')),
      topTags: [...tagCounts]
        .sort((a, b) => b[1] - a[1] || compareTag(a[0], b[0]))
        .slice(0, 10),
    }
  }, [identities, compareTag])

  const total = identities.length
  const seasonLabels = new Map(bySeason.map(([season, entry]) => [season, entry.label]))
  const bars = (rows: readonly (readonly [string | number, number])[], label: (key: string | number) => string) => (
    <ul className="space-y-1 text-zinc-500">
      {rows.map(([key, count]) => (
        <li key={key} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate">{label(key)}：{count} 筆</span>
          <span className="h-2 flex-1 bg-zinc-800">
            <span
              data-bar
              className="block h-full bg-amber-600/80"
              style={{ width: `${total ? Math.max(2, Math.round((count / total) * 100)) : 0}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  )

  return (
    <div className="mt-3 space-y-3 text-xs">
      <p className="text-zinc-300">總筆數 {identities.length}</p>
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <div>
          <h4 className="mb-1 font-medium text-zinc-400">稀有度</h4>
          {bars(byRarity, (rarity) => rarityMeta[String(rarity)]?.label || String(rarity))}
        </div>
        <div>
          <h4 className="mb-1 font-medium text-zinc-400">賽季</h4>
          {bars(
            bySeason.map(([season, entry]) => [season, entry.count] as const),
            (season) => seasonLabels.get(Number(season)) ?? String(season),
          )}
        </div>
        <div>
          <h4 className="mb-1 font-medium text-zinc-400">標籤 Top 10</h4>
          {bars(topTags, (tag) => String(tag))}
        </div>
        <div>
          <h4 className="mb-1 font-medium text-zinc-400">罪人分佈</h4>
          {bars(bySinner, (sinner) => String(sinner))}
        </div>
      </div>
    </div>
  )
}

function HealthBlock({
  report,
  identities,
  onSelect,
}: {
  report: ReturnType<typeof checkHealth>
  identities: Identities
  onSelect: (id: number) => void
}) {
  const removableOrphans = useMemo(
    () => report.orphans.filter((tag) => removableCount(identities, tag) > 0),
    [report.orphans, identities],
  )
  return (
    <div className="mt-3 space-y-3 text-xs">
      <p className={report.issues.length > 0 ? 'text-rose-400' : 'text-emerald-400'}>
        {report.issues.length === 0 ? '未發現問題' : `${report.issues.length} 個問題`}
      </p>
      {report.issues.length > 0 && (
        <ul className="space-y-1">
          {report.issues.map((issue) => (
            <li key={`${issue.identityId}-${issue.message}`}>
              <button
                type="button"
                onClick={() => onSelect(issue.identityId)}
                className="text-left text-zinc-300 underline-offset-2 hover:underline"
              >
                #{issue.identityId} {issue.nameZh}：{issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <p className="text-zinc-500">
          孤兒標籤（只有 1 筆在用，共 {report.orphans.length} 個，可移除 {removableOrphans.length} 個）：
        </p>
        <p className="mt-1 break-all text-zinc-600">{report.orphans.join('、')}</p>
      </div>
    </div>
  )
}

const TAG_BLOCK_COLORS = [
  'border-sky-600',
  'border-amber-600',
  'border-emerald-600',
  'border-violet-600',
  'border-rose-600',
  'border-orange-600',
  'border-red-600',
  'border-zinc-600',
]

/** 拖曳或用 ▲▼ 調整整份標籤清單；第一次移動會把順序寫進 game_meta.tag_order。 */
function TagOrderBoard({
  order,
  counts,
  customized,
  onApply,
}: {
  order: string[]
  counts: Map<string, number>
  customized: boolean
  onApply: (next: string[] | null) => void
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= order.length) return
    const next = [...order]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onApply(next)
  }

  return (
    <div className="mt-3 space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <p className="text-zinc-500">
          拖曳色塊或按 ▲▼ 調整標籤在篩選選單與分佈列表中的順序（{order.length} 個）。
        </p>
        <button
          type="button"
          className={`${miniButton} ml-auto`}
          aria-label="重設預設順序"
          disabled={!customized}
          onClick={() => onApply(null)}
        >
          重設預設順序
        </button>
      </div>
      <ul aria-label="標籤順序清單" className="flex flex-wrap gap-1">
        {order.map((tag, index) => (
          <li
            key={tag}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null) move(dragIndex, index)
              setDragIndex(null)
            }}
            className={`flex items-center gap-1 border-l-2 bg-zinc-900 px-2 py-1 ${
              TAG_BLOCK_COLORS[tagBlockRank(tag)] ?? TAG_BLOCK_COLORS[TAG_BLOCK_COLORS.length - 1]
            }`}
          >
            <span className="text-zinc-300">{tag}</span>
            <span className="text-zinc-600">{counts.get(tag) ?? 0}</span>
            <button
              type="button"
              aria-label={`上移 ${tag}`}
              disabled={index === 0}
              onClick={() => move(index, index - 1)}
              className="px-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
            >
              ▲
            </button>
            <button
              type="button"
              aria-label={`下移 ${tag}`}
              disabled={index === order.length - 1}
              onClick={() => move(index, index + 1)}
              className="px-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
            >
              ▼
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TagToolsBlock({
  identities,
  onApply,
}: {
  identities: Identities
  onApply: (next: Identities, label: string) => void
}) {
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const counts = useMemo(() => tagCounts(identities), [identities])
  const options = useMemo(
    () => [...counts.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
    [counts],
  )
  const orphans = useMemo(() => orphanTags(identities), [identities])
  const removableOrphans = useMemo(
    () => orphans.filter((tag) => removableCount(identities, tag) > 0),
    [orphans, identities],
  )

  const affected = source ? counts.get(source) ?? 0 : 0
  const removable = source ? removableCount(identities, source) : 0
  const trimmedTarget = target.trim()

  const rename = () => {
    if (!source || !trimmedTarget || source === trimmedTarget) return
    onApply(replaceTag(identities, source, trimmedTarget), `重新命名標籤「${source}」為「${trimmedTarget}」`)
    setSource('')
    setTarget('')
  }

  const remove = () => {
    if (!source) return
    onApply(removeTagEverywhere(identities, source), `全域移除標籤「${source}」`)
    setSource('')
  }

  const clearOrphans = () => {
    if (removableOrphans.length === 0) return
    let next = identities
    for (const tag of removableOrphans) next = removeTagEverywhere(next, tag)
    onApply(next, `清除孤兒標籤（${removableOrphans.length} 個）`)
  }

  return (
    <div className="mt-3 space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={miniClass}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          aria-label="來源標籤"
        >
          <option value="">來源標籤</option>
          {options.map((tag) => (
            <option key={tag} value={tag}>
              {tag}（{counts.get(tag)}）
            </option>
          ))}
        </select>
        <input
          className={`${miniClass} w-36`}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder="目標標籤"
          aria-label="目標標籤"
        />
        <button
          type="button"
          className={miniButton}
          disabled={!source || !trimmedTarget || source === trimmedTarget}
          onClick={rename}
        >
          重新命名／合併
        </button>
        <button type="button" className={miniButton} disabled={!source || removable === 0} onClick={remove}>
          全域移除
        </button>
        <button
          type="button"
          className={miniButton}
          disabled={removableOrphans.length === 0}
          onClick={clearOrphans}
        >
          清除孤兒標籤（{removableOrphans.length}）
        </button>
      </div>
      <p className="text-zinc-500">
        {source
          ? `「${source}」出現在 ${affected} 筆，重新命名影響 ${affected} 筆、全域移除影響 ${removable} 筆（只剩單一標籤的人格會跳過）。`
          : '選一個來源標籤：重新命名會全域替換（目標已存在就合併），全域移除只會拿掉還有其他標籤的人格。'}
      </p>
    </div>
  )
}

/** Slug must be unique; a shared display name is only a problem when the rows also
 *  share a sinner (the 12 LCB罪人 base identities are deliberately同名). */
function DupBlock({ identities }: { identities: Identities }) {
  const { slugGroups, sameSinner, crossSinner } = useMemo(() => {
    const slugs = groupByIdentity(identities, (identity) => identity.slug).filter(
      ([, rows]) => rows.length > 1,
    )
    const sameSinner: [string, Identity[]][] = []
    const crossSinner: [string, Identity[]][] = []
    for (const [name, rows] of groupByIdentity(identities, (identity) => identity.name_zh)) {
      if (rows.length < 2) continue
      const sinners = new Set(rows.map((row) => row.sinner_zh))
      if (sinners.size === 1) sameSinner.push([name, rows])
      else crossSinner.push([name, rows])
    }
    return { slugGroups: slugs, sameSinner, crossSinner }
  }, [identities])

  const issues = slugGroups.length + sameSinner.length
  return (
    <div className="mt-3 space-y-3 text-xs">
      <p className={issues > 0 ? 'text-rose-400' : 'text-emerald-400'}>
        {issues > 0
          ? `${issues} 個重複問題（slug ${slugGroups.length}、同名同罪人 ${sameSinner.length}）`
          : 'slug 與同名同罪人皆無重複'}
      </p>
      {issues > 0 && (
        <ul className="space-y-1 text-zinc-300">
          {slugGroups.map(([slug, rows]) => (
            <li key={slug}>
              slug「{slug}」重複 {rows.length} 筆：{rows.map((row) => row.id).join('、')}
            </li>
          ))}
          {sameSinner.map(([name, rows]) => (
            <li key={name}>
              同名同罪人「{name}」{rows.length} 筆：{rows.map((row) => row.id).join('、')}
            </li>
          ))}
        </ul>
      )}
      <div>
        <p className="text-zinc-500">同名跨罪人（{crossSinner.length} 組，通常是設計使然）：</p>
        <ul className="mt-1 space-y-0.5 text-zinc-600">
          {crossSinner.map(([name, rows]) => (
            <li key={name}>
              {name} × {rows.length}（
              {[...new Set(rows.map((row) => row.sinner_zh))].join('、')}）
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function SkillForm({
  skill,
  onChange,
}: {
  skill: SkillZh
  onChange: (patch: Partial<SkillZh>) => void
}) {
  const numberField = (
    label: string,
    field: 'coin_cost' | 'base_power' | 'attack_capacity',
  ) => (
    <Field label={label}>
      <input
        className={inputClass}
        type="number"
        min={0}
        step={1}
        value={skill[field] ?? ''}
        onChange={(event) => {
          const raw = event.target.value
          onChange({ [field]: raw === '' ? null : Math.max(0, Math.round(Number(raw) || 0)) })
        }}
      />
    </Field>
  )

  return (
    <div className="flex flex-col gap-2 border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-zinc-500">
          槽 {skill.slot}
          {skill.variant > 1 ? `.${skill.variant}` : ''}
          {skill.enhanced ? ' 強化' : ''}
        </span>
        <select
          className={inputClass}
          value={skill.role}
          onChange={(event) => onChange({ role: event.target.value as SkillRole })}
        >
          {Object.entries(SKILL_ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <Field label="名稱">
        <input
          className={inputClass}
          value={skill.name_zh}
          onChange={(event) => onChange({ name_zh: event.target.value })}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        {numberField('硬幣數', 'coin_cost')}
        {numberField('技能威力', 'base_power')}
        {numberField('攻擊容量', 'attack_capacity')}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="硬幣威力">
          <input
            className={inputClass}
            value={skill.coin_power ?? ''}
            onChange={(event) => onChange({ coin_power: event.target.value || null })}
          />
        </Field>
        <Field label="修正值">
          <input
            className={inputClass}
            value={skill.modifier ?? ''}
            onChange={(event) => onChange({ modifier: event.target.value || null })}
          />
        </Field>
        <Field label="攻擊類型">
          <input
            className={inputClass}
            value={skill.attack_type_zh ?? ''}
            onChange={(event) => onChange({ attack_type_zh: event.target.value || null })}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="罪孽">
          <input
            className={inputClass}
            value={skill.sin_zh ?? ''}
            onChange={(event) => onChange({ sin_zh: event.target.value || null })}
          />
        </Field>
        <Field label="追加罪孽" hint="以「、」分隔。">
          <input
            className={inputClass}
            value={toText(skill.extra_sins_zh)}
            onChange={(event) => onChange({ extra_sins_zh: toList(event.target.value) })}
          />
        </Field>
      </div>
    </div>
  )
}

function IdentityForm({
  identity,
  onChange,
}: {
  identity: Identity
  onChange: (patch: Partial<Identity>) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 border-b border-zinc-800 pb-3">
        <IdentityAvatar identity={identity} size={56} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-100">{identity.name}</p>
          <p className="font-mono text-xs text-zinc-600">
            id {identity.id}　{identity.slug}
          </p>
        </div>
      </div>

      <Field label="中文名稱">
        <input
          className={inputClass}
          value={identity.name_zh}
          onChange={(event) => onChange({ name_zh: event.target.value })}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="罪人">
          <input
            className={inputClass}
            value={identity.sinner_zh}
            onChange={(event) => onChange({ sinner_zh: event.target.value })}
          />
        </Field>
        <Field label="標籤" hint="多個值以「、」分隔；角色與所屬系列合併顯示。">
          <input
            className={inputClass}
            value={toText(identity.tags_zh)}
            onChange={(event) => onChange({ tags_zh: toList(event.target.value) })}
          />
        </Field>
        <Field label="稀有度" hint="內部值 1 / 2 / 3，顯示文字在「設定」分頁調整。">
          <input
            className={inputClass}
            type="number"
            min={1}
            step={1}
            value={identity.rarity}
            onChange={(event) =>
              onChange({ rarity: Math.max(1, Math.round(Number(event.target.value) || 1)) })
            }
          />
        </Field>
        <Field label="賽季">
          <input
            className={inputClass}
            value={identity.season_zh}
            onChange={(event) => onChange({ season_zh: event.target.value })}
          />
        </Field>
      </div>

      <Field label="屬性" hint="多個值以「、」分隔。">
        <input
          className={inputClass}
          value={toText(identity.damage_types_zh)}
          onChange={(event) => onChange({ damage_types_zh: toList(event.target.value) })}
        />
      </Field>

      <Field label="罪孽" hint="多個值以「、」分隔。">
        <input
          className={inputClass}
          value={toText(identity.sin_affinities_zh)}
          onChange={(event) => onChange({ sin_affinities_zh: toList(event.target.value) })}
        />
      </Field>

      <Field label="關鍵字" hint="留空代表沒有關鍵字。">
        <input
          className={inputClass}
          value={toText(identity.keywords_zh)}
          onChange={(event) => onChange({ keywords_zh: toList(event.target.value) })}
        />
      </Field>

      <details className="bg-zinc-950 p-3" open>
        <summary className="cursor-pointer text-xs text-zinc-400">
          技能（{identity.skills_zh.length}）
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-[11px] leading-relaxed text-zinc-600">
            每位人格至少三個技能，第 4 槽為防禦／閃避／反擊，少數人格另有第 5 槽以上或「強化」技能。
            欄位留空表示該來源沒有此資料。
          </p>
          {identity.skills_zh.map((skill, index) => (
            <SkillForm
              key={`${skill.slot}-${skill.variant}-${skill.enhanced}-${index}`}
              skill={skill}
              onChange={(patch) =>
                onChange({
                  skills_zh: identity.skills_zh.map((s, i) => (i === index ? { ...s, ...patch } : s)),
                })
              }
            />
          ))}
        </div>
      </details>

      <details className="bg-zinc-950 p-3">
        <summary className="cursor-pointer text-xs text-zinc-400">其他欄位</summary>
        <div className="mt-3 flex flex-col gap-3">
          <Field label="賽季（原始標籤）">
            <input
              className={inputClass}
              value={identity.season_wiki}
              onChange={(event) => onChange({ season_wiki: event.target.value })}
            />
          </Field>
          <Field label="英文名稱">
            <input
              className={inputClass}
              value={identity.name}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </Field>
          <Field label="罪人（英文）">
            <input
              className={inputClass}
              value={identity.sinner}
              onChange={(event) => onChange({ sinner: event.target.value })}
            />
          </Field>
          <Field label="圖片網址">
            <input
              className={inputClass}
              value={identity.image}
              onChange={(event) => onChange({ image: event.target.value })}
            />
          </Field>
        </div>
      </details>
    </div>
  )
}