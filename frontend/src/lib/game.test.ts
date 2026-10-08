import assert from 'node:assert/strict'
import test from 'node:test'
import { CATEGORIES, MATCH_EMOJI, compareGuess, guessValue, setMatch, skillSlotMatches, visibleCategories } from './compare'
import type { CategoryKey, Difficulty } from './compare'
import type { GameMeta } from './db'
import { buildShareText, copyText, emojiRow } from './game'
import {
  emptyStats,
  infiniteRoundKey,
  loadInfinite,
  loadPrefs,
  nextInfiniteRound,
  recordResult,
} from './storage'
import { EMPTY_STATS } from './game'
import type { Round, SavedGame } from './game'
import { MAX_GUESSES, SALT } from './game'
import { canGuess, getDailyAnswer, localDateKey, mulberry32 } from './seed'
import type { Identity, SkillZh } from '../types'

/** Minimal meta: only `rarity` matters to `guessValue` and the share text. */
const meta: GameMeta = {
  version: 1,
  title: 'Limbusdle',
  subtitle: '邊獄猜人格',
  tagline: '每天一題。',
  rarity: {
    '1': { label: '0' },
    '2': { label: '00' },
    '3': { label: '000' },
  },
}

const base: Identity = {
  id: 1,
  slug: 'test',
  name: 'LCCB Sinner Yi Sang',
  name_zh: '以實瑪利LCCB首席執行官',
  sinner: 'Yi Sang',
  sinner_zh: '以實瑪利',
  rarity: 2,
  season: 1,
  season_zh: '第1賽季',
  season_wiki: '第1賽季',
  faction: 'Limbus Company',
  tags_zh: ['異種公司', 'LCCB'],
  damage_types: ['slash', 'pierce'],
  damage_types_zh: ['斬擊', '突刺'],
  sin_affinities: ['gloom'],
  sin_affinities_zh: ['憂鬱'],
  primary_sin: 'gloom',
  primary_sin_zh: '憂鬱',
  keywords: ['bleed'],
  keywords_zh: ['流血'],
  hp_base: 100,
  min_speed: 2,
  max_speed: 6,
  resistances: { slash: 'normal', pierce: 'fatal', blunt: 'ineffective' },
  resistances_zh: { slash: '一般', pierce: '致命', blunt: '脆弱' },
  image: '',
  skills_zh: [
    {
      slot: 1,
      variant: 1,
      enhanced: false,
      role: 'attack',
      name_zh: '斬割',
      attack_type_zh: '斬擊',
      sin_zh: '憂鬱',
      extra_sins_zh: [],
      coin_cost: 2,
      base_power: 4,
      coin_power: '+4',
      modifier: '+0',
      attack_capacity: null,
    },
  ],
  wiki_page: '',
}

const variant = (patch: Partial<Identity>): Identity => ({ ...base, ...patch })

/** An identity whose four base skills carry the given sins, one per slot. The first
 *  three slots default to 斬擊 so a test can vary type and colour independently. */
const withSkills = (
  sins: [string, string, string, string | null],
  attackTypes: [string, string, string] = ['斬擊', '斬擊', '斬擊'],
): Identity => ({
  ...base,
  skills_zh: sins.map(
    (sin, index): SkillZh => ({
      slot: index + 1,
      variant: 1,
      enhanced: false,
      role: index === 3 ? 'defense' : 'attack',
      name_zh: `技能${index + 1}`,
      attack_type_zh: index === 3 ? null : attackTypes[index],
      sin_zh: sin,
      extra_sins_zh: [],
      coin_cost: 1,
      base_power: 4,
      coin_power: '+4',
      modifier: '+0',
      attack_capacity: null,
    }),
  ),
})

test('setMatch grades exact, partial, disjoint and empty sets', () => {
  assert.equal(setMatch(['a', 'b'], ['a', 'b']), 'exact')
  assert.equal(setMatch(['a'], ['a', 'b']), 'partial')
  assert.equal(setMatch(['a'], ['b']), 'miss')
  assert.equal(setMatch([], ['a']), 'miss')
  assert.equal(setMatch([], []), 'exact')
})

test('compareGuess marks an identical identity exact everywhere', () => {
  const result = compareGuess(base, base)
  for (const { key } of CATEGORIES) {
    assert.equal(result[key], 'exact', `${key} should be exact`)
  }
})

test('compareGuess applies strict matching to the sinner and set matching to tags', () => {
  const guess = variant({ id: 2, sinner: 'Sinclair', sinner_zh: '辛克萊', tags_zh: ['收尾人'] })
  const result = compareGuess(guess, base)
  assert.equal(result.sinner, 'miss')
  assert.equal(result.faction, 'miss')
})

test('the tags column grades by set overlap, not by whole-list equality', () => {
  // base carries ['異種公司', 'LCCB']; sharing one of them must come back yellow.
  assert.equal(compareGuess(variant({ tags_zh: ['異種公司'] }), base).faction, 'partial')
  assert.equal(compareGuess(variant({ tags_zh: ['異種公司', 'LCCB'] }), base).faction, 'exact')
  assert.equal(compareGuess(variant({ tags_zh: ['獄兒園'] }), base).faction, 'miss')
})

test('the skills column grades S1-S3 + defense as a set', () => {
  const all = ['憂鬱', '憂鬱', '憂鬱', '憂鬱'] as const
  assert.equal(
    compareGuess(withSkills([...all]), withSkills([...all])).skills,
    'exact',
  )
  assert.equal(
    compareGuess(withSkills(['憂鬱', '暴怒', '暴怒', '暴怒']), withSkills([...all])).skills,
    'partial',
  )
  // Red needs the colour *and* the attack type to miss together.
  assert.equal(
    compareGuess(
      withSkills(['暴怒', '暴食', '傲慢', '嫉妒'], ['穿刺', '穿刺', '穿刺']),
      withSkills([...all]),
    ).skills,
    'miss',
  )
})

test('the skills column grades each of its four slots on its own', () => {
  const answer = withSkills(['憂鬱', '暴怒', '暴食', '傲慢'])

  // Two sins swapped between slots: each lands in the answer's set but the wrong
  // position, so those slots are orange while the untouched ones stay green.
  const moved = withSkills(['暴怒', '憂鬱', '暴食', '傲慢'])
  assert.deepEqual(skillSlotMatches(moved, answer), ['partial', 'partial', 'exact', 'exact'])
  // The cell colour / emoji row still collapses the four verdicts into one.
  assert.equal(compareGuess(moved, answer).skills, 'partial')

  // Right attack type, colour the answer does not own: orange, not red. Only the
  // empty defense slot against a filled one is allowed to go red here.
  const wrongColor = withSkills(['嫉妒', '嫉妒', '嫉妒', null])
  assert.deepEqual(
    skillSlotMatches(wrongColor, answer),
    ['partial', 'partial', 'partial', 'miss'],
  )
  assert.equal(compareGuess(wrongColor, answer).skills, 'partial')

  // Wrong colour *and* wrong type in every attack slot: fully red.
  const disjoint = withSkills(['嫉妒', '嫉妒', '嫉妒', null], ['穿刺', '穿刺', '穿刺'])
  assert.deepEqual(skillSlotMatches(disjoint, answer), ['miss', 'miss', 'miss', 'miss'])
  assert.equal(compareGuess(disjoint, answer).skills, 'miss')

  // Same sins in the same slots - including two empty defenses - are all green.
  const twin = withSkills(['憂鬱', '暴怒', '暴食', null])
  const twinAnswer = withSkills(['憂鬱', '暴怒', '暴食', null])
  assert.deepEqual(skillSlotMatches(twin, twinAnswer), ['exact', 'exact', 'exact', 'exact'])
})

test('the skills column only goes green when the sin and the kind both match', () => {
  const answer = withSkills(['暴食', '憂鬱', '暴怒', '傲慢'], ['打擊', '斬擊', '穿刺'])

  // Right colour, wrong attack type in S1: amber, not green.
  const wrongType = withSkills(['暴食', '憂鬱', '暴怒', '傲慢'], ['斬擊', '斬擊', '穿刺'])
  assert.deepEqual(skillSlotMatches(wrongType, answer), ['partial', 'exact', 'exact', 'exact'])
  assert.equal(compareGuess(wrongType, answer).skills, 'partial')

  // Right colour, defense answered with a counter: amber, not green either.
  const counter = withSkills(['暴食', '憂鬱', '暴怒', '傲慢'], ['打擊', '斬擊', '穿刺'])
  counter.skills_zh[3] = { ...counter.skills_zh[3], role: 'counter' }
  assert.deepEqual(skillSlotMatches(counter, answer), ['exact', 'exact', 'exact', 'partial'])
  assert.equal(compareGuess(counter, answer).skills, 'partial')

  // The stricter green must not swallow a genuine match.
  const exact = withSkills(['暴食', '憂鬱', '暴怒', '傲慢'], ['打擊', '斬擊', '穿刺'])
  assert.deepEqual(skillSlotMatches(exact, answer), ['exact', 'exact', 'exact', 'exact'])
})

test('compareGuess points the arrow the right way for ordinals', () => {
  assert.equal(compareGuess(variant({ rarity: 1 }), base).rarity, 'under')
  assert.equal(compareGuess(variant({ rarity: 3 }), base).rarity, 'over')
  assert.equal(compareGuess(variant({ season: 0 }), base).season, 'under')
  assert.equal(compareGuess(variant({ season: 9 }), base).season, 'over')
  assert.equal(compareGuess(variant({ rarity: 2 }), base).rarity, 'exact')
})

test('compareGuess uses set overlap for the array categories', () => {
  assert.equal(compareGuess(variant({ damage_types: ['slash'] }), base).damageTypes, 'partial')
  assert.equal(compareGuess(variant({ damage_types: ['blunt'] }), base).damageTypes, 'miss')
  assert.equal(compareGuess(variant({ keywords: [] }), base).keywords, 'miss')
})

test('ordinal arrows carry a red square in the emoji row', () => {
  const under = emojiRow(compareGuess(variant({ rarity: 1 }), base))
  const over = emojiRow(compareGuess(variant({ rarity: 3 }), base))
  assert.ok(under.includes('🟥🔼'))
  assert.ok(over.includes('🟥🔽'))
  // Every category contributes exactly one glyph, plus the arrow on the ordinal.
  assert.equal([...under].length, CATEGORIES.length + 1)
  assert.equal([...over].length, CATEGORIES.length + 1)
})

test('emoji row width matches the category count', () => {
  const row = emojiRow(compareGuess(base, base))
  assert.equal(row, CATEGORIES.map(() => MATCH_EMOJI.exact).join(''))
})

test('guessValue renders every category without throwing', () => {
  for (const { key } of CATEGORIES) {
    const value = guessValue(base, key as CategoryKey, meta)
    assert.ok(value.length > 0, `${key} rendered empty`)
  }
  assert.equal(guessValue(base, 'rarity', meta), '00')
  // The English and Chinese keyword lists are stored in parallel, so an identity with
  // no keywords has both arrays empty.
  assert.equal(
    guessValue(variant({ keywords: [], keywords_zh: [] }), 'keywords', meta),
    '（無）',
  )
})

test('canGuess rejects repeats but allows the answer at any time', () => {
  const answer = base
  const wrong = variant({ id: 2 })
  assert.equal(canGuess(answer, answer, [wrong], MAX_GUESSES), true)
  assert.equal(canGuess(wrong, answer, [wrong], MAX_GUESSES), false)
  assert.equal(canGuess(wrong, answer, [], MAX_GUESSES), true)
  assert.equal(canGuess(wrong, answer, [variant({ id: 3 })], 1), false)
})

test('localDateKey pads month and day', () => {
  assert.equal(localDateKey(new Date(2026, 0, 5)), '2026-01-05')
  assert.equal(localDateKey(new Date(2026, 11, 31)), '2026-12-31')
})

test('mulberry32 stays inside the unit interval', () => {
  const rng = mulberry32(7)
  for (let i = 0; i < 100; i++) {
    const value = rng()
    assert.ok(value >= 0 && value < 1)
  }
})

test('getDailyAnswer is deterministic for a date', () => {
  const pool = Array.from({ length: 20 }, (_, i) => variant({ id: i + 1 }))
  const date = new Date(2026, 4, 1)
  assert.equal(getDailyAnswer(date, pool).id, getDailyAnswer(date, pool).id)
})

test('emptyStats starts a clean slate', () => {
  const stats = emptyStats()
  assert.deepEqual(stats, EMPTY_STATS)
  assert.notEqual(stats.distribution, EMPTY_STATS.distribution)
})

test('recordResult counts a win once and extends the streak', () => {
  const first = recordResult(emptyStats(), '2026-01-01', 'won', 3)
  assert.equal(first.played, 1)
  assert.equal(first.won, 1)
  assert.equal(first.streak, 1)
  assert.equal(first.distribution[2], 1)

  const replay = recordResult(first, '2026-01-01', 'won', 3)
  assert.equal(replay.played, 1, 'a second call for the same day must be ignored')

  const second = recordResult(first, '2026-01-02', 'won', 1)
  assert.equal(second.streak, 2)
  assert.equal(second.bestStreak, 2)
})

test('recordResult resets the streak on a loss and ignores a live round', () => {
  const won = recordResult(emptyStats(), '2026-01-01', 'won', 2)
  const lost = recordResult(won, '2026-01-02', 'lost', MAX_GUESSES)
  assert.equal(lost.streak, 0)
  assert.equal(lost.bestStreak, 1)
  assert.equal(lost.played, 2)

  const untouched = recordResult(won, '2026-01-03', 'playing', 1)
  assert.deepEqual(untouched, won)
})

test('buildShareText includes the try count and the emoji grid', () => {
  const rounds: Round[] = [
    { id: 1, comparison: compareGuess(variant({ rarity: 1 }), base) },
    { id: 2, comparison: compareGuess(base, base) },
  ]
  const text = buildShareText({
    status: 'won',
    tries: 2,
    rounds,
    dateKey: '2026-01-01',
    answer: base,
    meta,
  })
  assert.ok(text.includes('2/8'))
  assert.ok(text.includes('2026-01-01'))
  assert.ok(text.includes(base.name_zh))
  // The rarity in the breakdown comes from meta, not from a hardcoded table.
  assert.ok(text.includes('稀有度：00'), text)
  assert.equal(text.split('\n').filter((line) => line.includes('🟥') || line.includes('🟩')).length, 2)
})

test('buildShareText marks a loss with X', () => {
  const text = buildShareText({
    status: 'lost',
    tries: MAX_GUESSES,
    rounds: [],
    dateKey: '2026-01-01',
    answer: base,
    meta,
  })
  assert.ok(text.includes('X/8'))
})

test('copyText resolves outside a browser-like global scope', async () => {
  assert.equal(await copyText('hello'), false)
})

test('a saved game round-trips through JSON', () => {
  const saved: SavedGame = { date: '2026-01-01', version: SALT, guesses: [1, 2], status: 'playing' }
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), saved)
})

test('difficulty decides which comparison columns are shown', () => {
  const keys = (level: Difficulty) => visibleCategories(level).map((category) => category.key)

  // 簡單 shows every scored column except 技能; the 人格 column is always on top.
  assert.equal(keys('easy').length, CATEGORIES.length - 1)
  assert.ok(!keys('easy').includes('skills'))

  // 普通 swaps 屬性/罪孽 for 技能 but keeps season and keywords.
  assert.deepEqual(keys('normal'), ['sinner', 'rarity', 'season', 'skills', 'keywords'])

  // 困難 withholds everything that leaks structure except the two anchors and 技能.
  assert.deepEqual(keys('hard'), ['sinner', 'rarity', 'skills'])
  for (const hidden of ['faction', 'season', 'keywords', 'damageTypes', 'sinAffinities'] as const) {
    assert.ok(!keys('hard').includes(hidden), `${hidden} must stay hidden on hard`)
  }
})

test('an emoji row only carries the columns the difficulty reveals', () => {
  const comparison = compareGuess(base, base)
  const easy = emojiRow(comparison, visibleCategories('easy'))
  const hard = emojiRow(comparison, visibleCategories('hard'))
  // Nothing differs from the answer here, so there is no ordinal arrow to add on top.
  assert.equal([...easy].length, CATEGORIES.length - 1)
  assert.equal([...hard].length, 3)
})

test('share text hides the emoji columns the player never saw', () => {
  const rounds: Round[] = [{ id: 1, comparison: compareGuess(variant({ rarity: 1 }), base) }]
  const easy = buildShareText({
    status: 'lost',
    tries: MAX_GUESSES,
    rounds,
    dateKey: '2026-01-01',
    answer: base,
    meta,
    difficulty: 'easy',
  })
  const hard = buildShareText({
    status: 'lost',
    tries: MAX_GUESSES,
    rounds,
    dateKey: '2026-01-01',
    answer: base,
    meta,
    difficulty: 'hard',
  })

  // `u` matters: without it the class is code-unit based and would also match the `🎉`
  // in the headline, which is not part of the grid at all.
  const gridLine = (text: string) =>
    text.split('\n').find((line) => /[🟩🟥🟨🔼🔽]/u.test(line))!
  assert.equal([...gridLine(easy)].length, visibleCategories('easy').length + 1)
  // One column count for hard, plus the second glyph the rarity arrow needs.
  assert.equal([...gridLine(hard)].length, visibleCategories('hard').length + 1)

  // The answer breakdown below the grid is a post-round reveal and stays complete.
  for (const needle of ['標籤：', '賽季：', '關鍵字：']) {
    assert.ok(hard.includes(needle), `${needle} should still be revealed in the breakdown`)
  }
})

test('preferences fall back to a playable default when nothing is stored', () => {
  // No `window` in the test runner, so every read returns its fallback.
  assert.deepEqual(loadPrefs(), { difficulty: 'easy', mode: 'daily' })
  assert.equal(loadInfinite(), null)
})

test('an endless round survives JSON and carries its counter forward', () => {
  const first = nextInfiniteRound(42, null)
  assert.deepEqual(first, { answerId: 42, guesses: [], status: 'playing', round: 1 })
  assert.equal(JSON.parse(JSON.stringify(first)).answerId, 42)

  const played = { ...first, guesses: [7, 9], status: 'lost' as const }
  const second = nextInfiniteRound(99, played)
  assert.equal(second.round, 2, 'the round counter must keep climbing')
  assert.deepEqual(second.guesses, [], 'a new round starts empty')

  assert.equal(infiniteRoundKey(3), 'inf-3')
  assert.notEqual(infiniteRoundKey(1), infiniteRoundKey(2))
})