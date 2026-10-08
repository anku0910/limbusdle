import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { csvToIdentities, identitiesToCsv, parseCsv } from './csv'
import type { Identities } from '../types'

const DATA_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'data')
const roster = JSON.parse(
  readFileSync(path.join(DATA_DIR, 'zh_identities.json'), 'utf8'),
) as Identities

test('the real roster round-trips through CSV unchanged', () => {
  const csv = identitiesToCsv(roster)
  assert.ok(csv.charCodeAt(0) === 0xfeff, 'CSV should start with a UTF-8 BOM')
  const back = csvToIdentities(csv, roster.length)
  assert.deepEqual(back, roster)
})

test('quoted cells keep commas, quotes and newlines intact', () => {
  const rows = parseCsv('a,b\r\n"x,y","he said ""hi"""\r\n"line\r\nbreak",z\r\n')
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['x,y', 'he said "hi"'],
    ['line\r\nbreak', 'z'],
  ])
})

test('a wrong row count or a missing column is rejected with zh text', () => {
  assert.throws(() => csvToIdentities(identitiesToCsv(roster.slice(1)), roster.length), /筆數必須維持 201 筆/)
  const missing = identitiesToCsv(roster).replace('wiki_page', 'wiki')
  assert.throws(() => csvToIdentities(missing, roster.length), /缺少欄位「wiki_page」/)
})
