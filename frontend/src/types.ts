/** What a skill does, as opposed to what it hits with. */
export type SkillRole = 'attack' | 'defense' | 'evade' | 'counter' | 'guard'

export const SKILL_ROLE_LABELS: Record<SkillRole, string> = {
  attack: '攻擊',
  defense: '防禦',
  evade: '閃避',
  counter: '反擊',
  guard: '守備',
}

export type SkillZh = {
  /** 1-9, the slot the skill sits in. Slot 4 is the defense skill; 5-9 are the
   *  extra skills a handful of identities ship. */
  slot: number
  /** 1, or 2+ when a modified identity gives one slot a second version. */
  variant: number
  /** True for the `强化` skills that upgrade their base skill in the same slot. */
  enhanced: boolean
  role: SkillRole
  name_zh: string
  /** Damage type, null for skills that deal none. */
  attack_type_zh: string | null
  sin_zh: string | null
  /** Sins a defense skill applies to itself; empty for attack skills. */
  extra_sins_zh: string[]
  /** Coins the skill costs. */
  coin_cost: number | null
  /** Base power and coin power at the identity's top upgrade tier. */
  base_power: number | null
  coin_power: string | null
  /** Power modifier, e.g. "+2". */
  modifier: string | null
  /** Attack capacity, e.g. the number of times a multi-hit skill fires. */
  attack_capacity: number | null
}

export type Resistances = Record<'slash' | 'pierce' | 'blunt', string>

export type Identity = {
  id: number
  slug: string
  /** English name, e.g. "LCB Sinner Yi Sang". */
  name: string
  name_zh: string
  sinner: string
  sinner_zh: string
  /** Rarity tier 1 / 2 / 3. The text shown for it lives in `game_meta.json`, not here. */
  rarity: number
  /** 1-9; identities with no season entry are folded into 1. */
  season: number
  season_zh: string
  /** Raw wiki label, e.g. "常駐" or "第5賽季活動". Kept for the result screen. */
  season_wiki: string
  faction: string
  /** Every label the identity carries, e.g. ["收尾人", "Seven協會"]. Roles and
   *  affiliations are kept together; the wiki only supplies the affiliation for
   *  a couple of dozen identities. */
  tags_zh: string[]
  damage_types: string[]
  damage_types_zh: string[]
  sin_affinities: string[]
  sin_affinities_zh: string[]
  primary_sin: string
  primary_sin_zh: string
  /** Empty for the handful of identities that carry no status keyword. */
  keywords: string[]
  keywords_zh: string[]
  hp_base: number
  min_speed: number
  max_speed: number
  resistances: Resistances
  resistances_zh: Record<string, string>
  image: string
  skills_zh: SkillZh[]
  wiki_page: string
}

export type Identities = Identity[]