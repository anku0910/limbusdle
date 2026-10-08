import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { orphanTags, removableCount, removeTagEverywhere, replaceTag, tagCounts } from './tagTools'
import type { Identities } from '../types'

const DATA_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'data')
const roster = JSON.parse(
  readFileSync(path.join(DATA_DIR, 'zh_identities.json'), 'utf8'),
) as Identities

test('replaceTag renames everywhere and merges without duplicating the target', () => {
  const counts = tagCounts(roster)
  // 至少 5 筆在用的標籤（動態挑，資料改了測試也不會失效；收尾人留給合併目標用）。
  const source = [...counts]
    .filter(([tag, count]) => count >= 5 && tag !== '收尾人')
    .map(([tag]) => tag)
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))[0]
  const carriers = roster.filter((row) => row.tags_zh.includes(source))
  assert.ok(carriers.length >= 5, `expected a widely used tag, got ${source} × ${carriers.length}`)

  const renamed = replaceTag(roster, source, `${source}改`)
  assert.equal(renamed.filter((row) => row.tags_zh.includes(`${source}改`)).length, carriers.length)
  assert.ok(!renamed.some((row) => row.tags_zh.includes(source)))
  assert.equal(renamed.length, roster.length)

  // 合併進既有標籤：不重複、不清空、其他筆原封不動。
  const target = '收尾人'
  const carrierIds = new Set(carriers.map((row) => row.id))
  const merged = replaceTag(roster, source, target)
  for (const row of merged) {
    const before = roster.find((entry) => entry.id === row.id)!
    if (!carrierIds.has(row.id)) {
      assert.deepEqual(row.tags_zh, before.tags_zh)
      continue
    }
    assert.ok(!row.tags_zh.includes(source))
    assert.equal(row.tags_zh.filter((tag) => tag === '收尾人').length, 1)
    assert.ok(row.tags_zh.length > 0)
    // 原地替換：原本就帶目標標籤的話會被去重合併（少一格），否則格數不變。
    const expectedLength = before.tags_zh.length - (before.tags_zh.includes(target) ? 1 : 0)
    assert.equal(row.tags_zh.length, expectedLength)
  }
})

test('removeTagEverywhere never strips an identity down to zero tags', () => {
  const synthetic = [
    { tags_zh: ['孤兒'] },
    { tags_zh: ['孤兒', '其他'] },
    { tags_zh: ['其他'] },
  ] as unknown as Identities

  const removed = removeTagEverywhere(synthetic, '孤兒')
  assert.deepEqual(
    removed.map((row) => row.tags_zh),
    [['孤兒'], ['其他'], ['其他']],
  )
  assert.equal(removableCount(synthetic, '孤兒'), 1)
  assert.equal(removableCount(synthetic, '不存在的標籤'), 0)
  assert.equal(removeTagEverywhere(synthetic, '').length, 3)
})

test('orphan tags are the single-use ones, sorted', () => {
  const orphans = orphanTags(roster)
  assert.equal(orphans.length, 36)
  for (let i = 1; i < orphans.length; i++)
    assert.ok(orphans[i - 1].localeCompare(orphans[i], 'zh-Hant') <= 0, `${orphans[i - 1]} before ${orphans[i]}`)
  const counts = tagCounts(roster)
  assert.ok(orphans.every((tag) => counts.get(tag) === 1))
  assert.ok(orphans.includes('天殺星'))
  assert.ok(!orphans.includes('收尾人'))
})
