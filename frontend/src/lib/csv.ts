import type { Identities, Identity } from '../types'
import { assertImportedIdentities } from './importGuard'

export { assertImportedIdentities } from './importGuard'

/** 陣列欄位的分隔符；標籤與關鍵字本身不會含有「|」。 */
const PIPE = '|'
const ARRAY_FIELDS = new Set([
  'tags_zh',
  'keywords',
  'keywords_zh',
  'damage_types',
  'damage_types_zh',
  'sin_affinities',
  'sin_affinities_zh',
])
const NUMBER_FIELDS = new Set(['id', 'rarity', 'season', 'hp_base', 'min_speed', 'max_speed'])
const JSON_FIELDS = new Set(['resistances', 'resistances_zh', 'skills_zh'])

export const CSV_COLUMNS = [
  'id',
  'slug',
  'name',
  'sinner',
  'sinner_zh',
  'name_zh',
  'rarity',
  'season',
  'season_zh',
  'season_wiki',
  'faction',
  'tags_zh',
  'keywords',
  'keywords_zh',
  'damage_types',
  'damage_types_zh',
  'sin_affinities',
  'sin_affinities_zh',
  'primary_sin',
  'primary_sin_zh',
  'hp_base',
  'min_speed',
  'max_speed',
  'image',
  'wiki_page',
  'resistances',
  'resistances_zh',
  'skills_zh',
] as const

const cell = (column: (typeof CSV_COLUMNS)[number], row: Identity): string => {
  const value = (row as unknown as Record<string, unknown>)[column]
  if (ARRAY_FIELDS.has(column)) return (value as string[]).join(PIPE)
  if (JSON_FIELDS.has(column)) return JSON.stringify(value)
  return String(value ?? '')
}

const quote = (text: string): string =>
  /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text

export function identitiesToCsv(rows: readonly Identity[]): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const row of rows) lines.push(CSV_COLUMNS.map((column) => quote(cell(column, row))).join(','))
  // BOM (U+FEFF) 讓 Excel 直接認出 UTF-8。
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** RFC 4180 的狀態機：支援引號內的逗號、換行與跳脫引號。 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // 尾端多出來的空白行
  while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '')
    rows.pop()
  return rows
}

const convert = (column: string, raw: unknown, line: number): unknown => {
  const text = String(raw ?? '')
  if (NUMBER_FIELDS.has(column)) {
    const value = Number(text)
    if (!Number.isFinite(value)) throw new Error(`第 ${line} 行的「${column}」不是數字：${text}`)
    return value
  }
  if (ARRAY_FIELDS.has(column)) return text === '' ? [] : text.split(PIPE)
  if (JSON_FIELDS.has(column)) {
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`第 ${line} 行的「${column}」不是合法 JSON。`)
    }
  }
  return text
}

export function csvToIdentities(text: string, expectedCount: number): Identities {
  const rows = parseCsv(text)
  if (rows.length === 0) throw new Error('CSV 是空的。')
  const header = rows[0]
  for (const column of CSV_COLUMNS)
    if (!header.includes(column)) throw new Error(`CSV 缺少欄位「${column}」。`)

  const objects = rows.slice(1).map((cells, index) => {
    if (cells.length !== header.length)
      throw new Error(`第 ${index + 2} 行有 ${cells.length} 欄，應為 ${header.length} 欄。`)
    const record: Record<string, unknown> = {}
    header.forEach((column, position) => {
      record[column] = convert(column, cells[position], index + 2)
    })
    return record
  })

  return assertImportedIdentities(objects, expectedCount)
}
