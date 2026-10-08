import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { CATEGORIES, compareGuess, guessValue } from './compare'
import type { GameMeta } from './db'
import { buildRoster, groupBySinner } from './roster'
import { getDailyAnswer } from './seed'
import { buildSearchIndex, search } from './search'
import type { Identity, Identities } from '../types'

// Read straight from the dataset directory: the frontend no longer carries a bundled copy,
// so the single source of truth is what these assertions must be checking.
const DATA_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'data')
const readData = <T>(name: string): T =>
  JSON.parse(readFileSync(path.join(DATA_DIR, name), 'utf8')) as T

const roster = readData<Identities>('zh_identities.json')
const meta = readData<GameMeta>('game_meta.json')

test('roster is complete and free of blank Chinese fields', () => {
  assert.equal(roster.length, 201)
  assert.equal(new Set(roster.map((identity) => identity.id)).size, 201)
  for (const identity of roster) {
    assert.ok(identity.name_zh, `missing name_zh on ${identity.name}`)
    assert.ok(identity.sinner_zh, `missing sinner_zh on ${identity.name}`)
    assert.ok(identity.tags_zh.length, `missing tags_zh on ${identity.name}`)
    assert.ok(identity.season_zh, `missing season_zh on ${identity.name}`)
    assert.ok(identity.skills_zh.length > 0, `missing skills_zh on ${identity.name}`)
  }
})

test('tags merge the role and the affiliation into one list', () => {
  for (const identity of roster) {
    assert.ok(identity.tags_zh.length > 0, `no tags on ${identity.name}`)
    assert.equal(
      new Set(identity.tags_zh).size,
      identity.tags_zh.length,
      `duplicate tags on ${identity.name}`,
    )
    for (const tag of identity.tags_zh) {
      assert.ok(tag.trim() === tag && tag, `blank tag on ${identity.name}`)
    }
  }
  // Seven協會南部6科 carries both the Fixer role and its squad; the sinner name
  // itself lives only on `sinner_zh`, never inside the identity name.
  const yiSang = roster.find((identity) => identity.name_zh === 'Seven協會南部6科')
  assert.deepEqual(yiSang?.tags_zh, ['收尾人', 'Seven協會'])
})

test('the legacy faction / affiliation split is gone', () => {
  for (const identity of roster) {
    assert.equal(
      'faction_zh' in identity,
      false,
      `faction_zh still present on ${identity.name}`,
    )
    assert.equal(
      'affiliation_zh' in identity,
      false,
      `affiliation_zh still present on ${identity.name}`,
    )
  }
})

test('every skill carries a slot, a role and a coin cost', () => {
  const roles = new Set(['attack', 'defense', 'evade', 'counter', 'guard'])
  for (const identity of roster) {
    for (const skill of identity.skills_zh) {
      const where = `${identity.name} / ${skill.name_zh}`
      assert.ok(skill.slot >= 1, `bad slot on ${where}`)
      assert.ok(skill.variant >= 1, `bad variant on ${where}`)
      assert.equal(typeof skill.enhanced, 'boolean', `bad enhanced on ${where}`)
      assert.ok(roles.has(skill.role), `bad role on ${where}`)
      assert.ok(skill.name_zh, `blank name on ${where}`)
      assert.ok(
        skill.coin_cost != null && skill.coin_cost >= 0,
        `missing coin cost on ${where}`,
      )
      assert.ok(Array.isArray(skill.extra_sins_zh), `bad extra sins on ${where}`)
    }
  }
})

test('slot 4 is the defense skill and nothing truncates the tail', () => {
  for (const identity of roster) {
    const fourth = identity.skills_zh.filter(
      (skill) => skill.slot === 4 && !skill.enhanced && skill.variant === 1,
    )
    assert.equal(fourth.length, 1, `expected one slot-4 skill on ${identity.name}`)
    assert.notEqual(fourth[0].role, 'attack', `slot 4 should not be an attack on ${identity.name}`)
  }
  // Identities that ship more than the base four are kept whole.
  const extended = roster.filter((identity) => identity.skills_zh.length > 4)
  assert.ok(extended.length > 0, 'expected identities with extra skills')
  assert.ok(
    extended.some((identity) => identity.skills_zh.some((skill) => skill.enhanced)),
    'expected at least one 強化 skill to be recorded',
  )
})

test('every rarity in use has a label in game_meta.json', () => {
  for (const identity of roster) {
    const label = meta.rarity[String(identity.rarity)]?.label
    assert.ok(label, `rarity ${identity.rarity} has no label in game_meta.json`)
    assert.ok(
      !/[☆★]/.test(label),
      `rarity label "${label}" must not contain star glyphs`,
    )
  }
})

test('rarity labels are the plain 0 / 00 / 000 notation', () => {
  assert.equal(meta.rarity['1'].label, '0')
  assert.equal(meta.rarity['2'].label, '00')
  assert.equal(meta.rarity['3'].label, '000')
})

test('roster module agrees with the raw dataset', () => {
  const { all, byId } = buildRoster(roster)
  assert.equal(all.length, roster.length)
  assert.equal(byId.size, roster.length)
  assert.equal(byId.get(roster[0].id)?.name_zh, roster[0].name_zh)
})

test('grouping by sinner covers every identity exactly once', () => {
  const groups = groupBySinner(roster)
  assert.equal(groups.length, 12)
  assert.equal(
    groups.reduce((total, group) => total + group.identities.length, 0),
    roster.length,
  )
  for (const group of groups) {
    for (const identity of group.identities) {
      assert.equal(identity.sinner_zh, group.sinnerZh)
    }
  }
})

test('rarity and season are integers so the grid can order them', () => {
  for (const identity of roster) {
    assert.equal(typeof identity.rarity, 'number')
    assert.equal(typeof identity.season, 'number')
  }
  assert.deepEqual([...new Set(roster.map((i) => i.rarity))].sort(), [1, 2, 3])
  assert.ok(Math.min(...roster.map((i) => i.season)) >= 1)
})

test('every identity is a fixed point of compareGuess', () => {
  for (const identity of roster) {
    const result = compareGuess(identity, identity)
    for (const { key, label } of CATEGORIES) {
      assert.equal(result[key], 'exact', `${label} should be exact for ${identity.name_zh}`)
    }
  }
})

test('guessValue renders rarity through the meta labels', () => {
  for (const identity of roster) {
    assert.equal(guessValue(identity, 'rarity', meta), meta.rarity[String(identity.rarity)].label)
  }
})

test('the daily answer always comes from the roster and is stable', () => {
  const today = new Date()
  const first = getDailyAnswer(today, roster)
  const second = getDailyAnswer(today, roster)
  assert.ok(roster.some((identity) => identity.id === first.id))
  assert.equal(first.id, second.id)
})

test('search finds identities by Chinese, pinyin initials and English', () => {
  const index = buildSearchIndex(roster)
  const first = search(index, roster[0].name_zh)[0]?.identity
  assert.equal(first?.id, roster[0].id)

  // `lx` reads as 李箱 (li-xiang) and 良秀 (liang-xiu) alike, and with sinner names
  // stripped from the identity names the 六協會 (liu-xie) squad names start with
  // the very same initials. Everything that scores for lx must be one of those.
  const byInitials = search(index, 'lx', 40)
  assert.ok(byInitials.length > 0)
  for (const hit of byInitials) {
    const sinnerHit =
      hit.identity.sinner_zh === '李箱' || hit.identity.sinner_zh === '良秀'
    assert.ok(
      sinnerHit || hit.identity.name_zh.startsWith('六協會'),
      `lx should only match 李箱/良秀 or 六協會 names, got ${hit.identity.name_zh} (score ${hit.score})`,
    )
  }
  assert.ok(byInitials.some((hit) => hit.identity.sinner_zh === '李箱'))
  assert.ok(byInitials.some((hit) => hit.identity.sinner_zh === '良秀'))

  // An exact name outranks every other reading of the same letters. Identity names
  // never carry the sinner name any more, so a query for 李箱 ranks through the
  // sinner path instead - every hit must belong to that sinner.
  const exact = search(index, '李箱')
  assert.ok(exact.length > 0)
  assert.ok(exact.every((hit) => hit.identity.sinner_zh === '李箱'))
  for (let i = 1; i < exact.length; i += 1) {
    assert.ok(
      exact[i - 1].identity.name_zh.length <= exact[i].identity.name_zh.length,
      'ties break by name length, shortest first',
    )
  }

  const byEnglish = search(index, 'yi sang')[0]?.identity.sinner_zh
  assert.ok(byEnglish, 'yi sang should match a sinner')

  assert.equal(search(index, '').length, 0)
  assert.equal(search(index, 'zzzzzzzz').length, 0)
})

test('search hides identities that have already been guessed', () => {
  const index = buildSearchIndex(roster)
  const target = roster[0]
  const hidden = search(index, target.name_zh, 14, new Set([target.id]))
  assert.ok(!hidden.some((hit) => hit.identity.id === target.id))
})

test('every sinner has an LCB base form to use as its picker icon', () => {
  for (const group of groupBySinner(roster)) {
    const base = group.identities.find((identity: Identity) => /^lcb-sinner-[a-z-]+$/.test(identity.slug))
    assert.ok(base, `no LCB base form for sinner ${group.sinnerZh}`)
    assert.ok(base.image, `LCB base form for ${group.sinnerZh} has no image`)
  }
})

test('kindergarten identities carry the group tags and the approved name format', () => {
  const kindergarten = roster.filter((identity) => identity.tags_zh.includes('獄兒園'))
  assert.equal(kindergarten.length, 12)
  const groups = new Set<string>()
  for (const identity of kindergarten) {
    const group = identity.tags_zh.find((tag) => tag !== '獄兒園') ?? ''
    assert.ok(group.endsWith('班'), `${identity.name_zh} is missing its 班 tag`)
    assert.ok(
      identity.name_zh.startsWith(group),
      `${identity.name_zh} must start with its group tag`,
    )
    groups.add(group)
  }
  assert.deepEqual([...groups].sort(), ['早期大象班', '活潑企鵝班', '開朗小雞班'].sort())
  const captains = kindergarten.filter((identity) => identity.name_zh.endsWith('-班長'))
  assert.equal(captains.length, 3, 'one 班長 per group')
})

test('every identity has a local thumbnail for the picker and the grid', () => {
  const thumbsDir = path.resolve(import.meta.dirname, '..', '..', 'public', 'thumbs')
  for (const identity of roster) {
    assert.ok(
      existsSync(path.join(thumbsDir, `${identity.id}.png`)),
      `missing thumb for ${identity.name_zh}`,
    )
  }
  // One passport photo per sinner, named from the English sinner name.
  for (const group of groupBySinner(roster)) {
    const sinner = group.identities[0]?.sinner ?? ''
    assert.ok(sinner, `no sinner name for ${group.sinnerZh}`)
    const slug = sinner.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    assert.ok(
      existsSync(path.join(thumbsDir, `sinner-${slug}.png`)),
      `missing passport photo for ${group.sinnerZh}`,
    )
  }
  assert.ok(existsSync(path.join(thumbsDir, 'atk-slash.png')))
  assert.ok(existsSync(path.join(thumbsDir, 'atk-pierce.png')))
  assert.ok(existsSync(path.join(thumbsDir, 'atk-blunt.png')))
})