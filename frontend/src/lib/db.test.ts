import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { resolveDbFile, validateIdentities, validateMeta } from '../../vite-plugin-db'
import type { Identities } from '../types'

const DATA_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'data')
const roster = JSON.parse(
  readFileSync(path.join(DATA_DIR, 'zh_identities.json'), 'utf8'),
) as Identities

test('only the two allowlisted files are reachable', () => {
  assert.ok(resolveDbFile(DATA_DIR, 'game_meta.json'))
  assert.ok(resolveDbFile(DATA_DIR, 'zh_identities.json'))

  for (const hostile of [
    '../package.json',
    '../../secrets.json',
    '..%2F..%2Fpackage.json',
    '/etc/passwd',
    'en_identities.json',
    '',
  ]) {
    assert.equal(resolveDbFile(DATA_DIR, hostile), null, `${hostile} must be rejected`)
  }
})

test('validateMeta accepts the shipped file and rejects bad shapes', () => {
  const meta = JSON.parse(
    readFileSync(path.join(DATA_DIR, 'game_meta.json'), 'utf8'),
  ) as unknown
  assert.equal(validateMeta(meta).ok, true)

  assert.equal(validateMeta([]).ok, false)
  assert.equal(validateMeta({ title: '', subtitle: 'x', tagline: 'y', rarity: {} }).ok, false)

  const noRarity = { title: 'a', subtitle: 'b', tagline: 'c', rarity: {} }
  assert.equal(validateMeta(noRarity).ok, false)

  const badKey = { title: 'a', subtitle: 'b', tagline: 'c', rarity: { star: { label: '*' } } }
  assert.equal(validateMeta(badKey).ok, false)

  const blankLabel = { title: 'a', subtitle: 'b', tagline: 'c', rarity: { '1': { label: '  ' } } }
  assert.equal(validateMeta(blankLabel).ok, false)

  const withOrder = {
    title: 'a',
    subtitle: 'b',
    tagline: 'c',
    rarity: { '1': { label: '*' } },
    tag_order: ['收尾人', '六協會'],
  }
  assert.equal(validateMeta(withOrder).ok, true)

  const dupOrder = { ...withOrder, tag_order: ['收尾人', '收尾人'] }
  assert.equal(validateMeta(dupOrder).ok, false)

  const badOrder = { ...withOrder, tag_order: '收尾人' }
  assert.equal(validateMeta(badOrder).ok, false)
})

test('the roster on disk passes its own validation', () => {
  const result = validateIdentities(roster, {
    expectedCount: roster.length,
    rarityKeys: new Set(['1', '2', '3']),
  })
  assert.equal(result.ok, true)
})

test('adding or removing an identity is rejected', () => {
  const extra = [...roster, { ...roster[0], id: 9999 }]
  const grown = validateIdentities(extra, { expectedCount: roster.length })
  assert.equal(grown.ok, false)
  if (!grown.ok) assert.match(grown.errors[0], /不開放新增或刪除/)

  const shrunk = validateIdentities(roster.slice(1), { expectedCount: roster.length })
  assert.equal(shrunk.ok, false)
})

test('blank required fields and duplicate ids are rejected', () => {
  const blank = roster.map((identity, index) =>
    index === 0 ? { ...identity, name_zh: '' } : identity,
  )
  const blankResult = validateIdentities(blank)
  assert.equal(blankResult.ok, false)

  const duplicated = [...roster]
  duplicated[1] = { ...duplicated[1], id: duplicated[0].id }
  const duplicateResult = validateIdentities(duplicated)
  assert.equal(duplicateResult.ok, false)
  if (!duplicateResult.ok) assert.ok(duplicateResult.errors.some((e) => e.includes('重複')))
})

test('a rarity with no meta label is rejected', () => {
  const odd = roster.map((identity, index) =>
    index === 0 ? { ...identity, rarity: 7 } : identity,
  )
  const result = validateIdentities(odd, { rarityKeys: new Set(['1', '2', '3']) })
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes('沒有對應的顯示設定')))
})

test('a non-array roster is rejected outright', () => {
  const result = validateIdentities({ not: 'an array' })
  assert.equal(result.ok, false)
})