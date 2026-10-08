import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { checkHealth } from './health'
import type { Identities } from '../types'
import type { GameMeta } from './db'

const DATA_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'data')
const roster = JSON.parse(
  readFileSync(path.join(DATA_DIR, 'zh_identities.json'), 'utf8'),
) as Identities
const meta = JSON.parse(
  readFileSync(path.join(DATA_DIR, 'game_meta.json'), 'utf8'),
) as GameMeta

test('the shipped roster passes every health check', () => {
  const report = checkHealth(roster, meta.rarity)
  assert.deepEqual(report.issues, [])
  assert.equal(report.orphans.length, 36)
})

test('broken rows surface as zh issues, blank keywords do not', () => {
  const broken = roster.map((row, index) => {
    if (index !== 0) return row
    return {
      ...row,
      name_zh: '',
      tags_zh: [],
      rarity: 99,
      season: 12,
      hp_base: 0,
      min_speed: 8,
      max_speed: 3,
      skills_zh: [],
      keywords: [],
      keywords_zh: [],
    }
  })
  const report = checkHealth(broken, meta.rarity)
  const messages = report.issues.filter((issue) => issue.identityId === broken[0].id).map((issue) => issue.message)
  assert.ok(messages.some((message) => message.includes('「name_zh」是空的')))
  assert.ok(messages.some((message) => message.includes('沒有任何標籤')))
  assert.ok(messages.some((message) => message.includes('稀有度 99')))
  assert.ok(messages.some((message) => message.includes('賽季 12')))
  assert.ok(messages.some((message) => message.includes('速度反轉')))
  assert.ok(messages.some((message) => message.includes('HP 0')))
  assert.ok(messages.some((message) => message.includes('沒有任何技能')))

  // keywords 空是合法的：同一筆不該因為空 keywords 被點名。
  assert.ok(!messages.some((message) => message.includes('keywords')))
})
