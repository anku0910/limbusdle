import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { makeTagComparator, tagIntroSeasons } from './tagOrder'
import type { Identities } from '../types'

// 與 roster.test 同一條路徑：直接讀資料夾，排序規則要對得上真實名冊。
const DATA_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'data')
const roster = JSON.parse(readFileSync(path.join(DATA_DIR, 'zh_identities.json'), 'utf8')) as Identities

const sortedTags = (): string[] => {
  const tags = new Set<string>()
  for (const identity of roster) for (const tag of identity.tags_zh) tags.add(tag)
  return [...tags].sort(makeTagComparator(roster))
}

test('tag options group 協會 / 公司 / 獄兒園 / 事務所 / 蜘蛛巢→手指→幫派 in that order', () => {
  const sorted = sortedTags()
  const at = (tag: string) => {
    const index = sorted.indexOf(tag)
    assert.ok(index !== -1, `missing tag ${tag}`)
    return index
  }

  // 協會成一塊，且照編號排（Zwei=2 … Öufi=11）。
  assert.deepEqual(
    sorted.filter((tag) => tag.includes('協會')),
    ['Zwei協會', 'し協會', 'Cinq協會', '六協會', 'Seven協會', 'Девять協會', 'Dieci協會', 'Öufi協會'],
  )

  // 公司塊內的指定接續：腦葉 → E.G.O → H公司 → 黑獸（地支）→ 血魔 → 拉·曼卻領 → 二代 > 三代眷屬。
  const run = [
    '腦葉公司',
    '腦葉公司本部',
    '腦葉公司支部',
    'E.G.O裝備',
    'H公司',
    '黑獸',
    '黑獸-魁首',
    '黑獸-卯',
    '黑獸-巳',
    '黑獸-午',
    '黑獸-未',
    '黑獸-酉',
    '血魔',
    '拉·曼卻領',
    '二代眷屬',
    '三代眷屬',
  ]
  assert.deepEqual(
    sorted.filter((tag) => run.includes(tag)),
    run,
  )

  // 手指照解剖順序，環指點彩派跟著環指。
  assert.deepEqual(
    sorted.filter((tag) => ['手指', '拇指', '食指', '中指', '環指', '環指點彩派', '小指'].includes(tag)),
    ['手指', '拇指', '食指', '中指', '環指', '環指點彩派', '小指'],
  )

  // 塊間順序：協會 < 公司 < 獄兒園 < 事務所 < 蜘蛛巢 < 手指 < 幫派 < 其餘。
  assert.ok(at('Zwei協會') < at('腦葉公司'))
  assert.ok(at('黑獸') < at('血魔'))
  assert.ok(at('血魔') < at('拉·曼卻領'))
  assert.ok(at('拉·曼卻領') < at('二代眷屬'))
  assert.ok(at('三代眷屬') < at('W公司')) // 指定接續排在其他公司之前
  assert.ok(at('W公司') < at('獄兒園'))
  assert.ok(at('早期大象班') < at('定事務所')) // 獄兒園塊整塊在事務所之前
  assert.ok(at('吊鉤事務所') < at('蜘蛛巢'))
  assert.ok(at('蜘蛛巢') < at('手指'))
  assert.ok(at('手指') < at('幫派'))
  assert.ok(at('幫派') < at('收尾人'))
})

test('tags without a fixed order sort by introduction season, newest first', () => {
  const intro = tagIntroSeasons(roster)
  const sorted = sortedTags()

  // 事務所沒有內定順序：依登場賽季新 → 舊。
  const offices = sorted.filter((tag) => tag.includes('事務所'))
  assert.ok(offices.length >= 9, `only ${offices.length} office tags`)
  for (let i = 1; i < offices.length; i++) {
    assert.ok(
      (intro.get(offices[i - 1]) ?? 0) >= (intro.get(offices[i]) ?? 0),
      `${offices[i - 1]} (S${intro.get(offices[i - 1])}) before ${offices[i]} (S${intro.get(offices[i])})`,
    )
  }
  assert.ok(sorted.indexOf('定事務所') < sorted.indexOf('吊鉤事務所'))

  // 塊外（最後一個幫派塊成員之後）也遵守同一條規則：最舊的登場排最後。
  const lastGang = sorted.findLast((tag) => tag.includes('幫') || tag.includes('派') || tag.endsWith('會'))
  assert.ok(lastGang, 'no gang block found')
  const ungrouped = sorted.slice(sorted.indexOf(lastGang) + 1)
  assert.ok(ungrouped.includes('收尾人'), '收尾人 should sit in the ungrouped tail')
  for (let i = 1; i < ungrouped.length; i++) {
    assert.ok(
      (intro.get(ungrouped[i - 1]) ?? 0) >= (intro.get(ungrouped[i]) ?? 0),
      `${ungrouped[i - 1]} before ${ungrouped[i]} breaks the season order`,
    )
  }
})

test('a custom order overrides the built-in blocks', () => {
  const compare = makeTagComparator(roster, ['收尾人', '六協會', '幫派'])
  const picks = ['六協會', '幫派', '收尾人', 'Zwei協會', '腦葉公司'].sort(compare)
  assert.deepEqual(picks.slice(0, 3), ['收尾人', '六協會', '幫派'])
  // 沒列進自訂順序的標籤排在後面，彼此仍照內建規則（協會塊 < 公司塊）。
  assert.deepEqual(picks.slice(3), ['Zwei協會', '腦葉公司'])
})
