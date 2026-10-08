import type { Identity, SkillZh } from '../types'

/** The seven sins in the approved palette (Wrath, Lust, Sloth, Gluttony, Gloom,
 *  Pride, Envy); every chip, badge and preview reads its colour from here. */
export const SIN_COLORS: Record<string, string> = {
  暴怒: '#893126',
  色慾: '#b56131',
  怠惰: '#e48800',
  暴食: '#60822b',
  憂鬱: '#316570',
  傲慢: '#19538b',
  嫉妒: '#7e4e96',
}

export const NEUTRAL_SIN_COLOR = '#52525b'

export function sinColor(sinZh: string | null): string {
  if (!sinZh) return NEUTRAL_SIN_COLOR
  return SIN_COLORS[sinZh] ?? NEUTRAL_SIN_COLOR
}

/** Attack-type glyphs downloaded at build time (Limbus Company art, bg removed). */
export const ATTACK_ICONS: Record<string, string> = {
  斬擊: '/thumbs/atk-slash.png',
  穿刺: '/thumbs/atk-pierce.png',
  突刺: '/thumbs/atk-pierce.png',
  打擊: '/thumbs/atk-blunt.png',
}

/** Slot-4 role glyphs (Guard / Evade / Counter) from limbuscompany.wiki.gg. */
export const ROLE_ICONS: Record<string, string> = {
  defense: '/thumbs/role-guard.png',
  guard: '/thumbs/role-guard.png',
  evade: '/thumbs/role-evade.png',
  counter: '/thumbs/role-counter.png',
}

export type SkillChip = {
  slot: number
  role: SkillZh['role']
  name_zh: string
  sin_zh: string | null
  attack_type_zh: string | null
}

/**
 * The four chips the 技能 column draws: S1, S2, S3 and the slot-4 defense skill,
 * in slot order. Enhanced skills and variant>=2 versions are skipped so every
 * identity is compared on the same four base skills.
 */
export function skillChips(identity: Identity): SkillChip[] {
  const bySlot = new Map<number, SkillZh>()
  for (const skill of identity.skills_zh) {
    if (skill.enhanced || skill.variant !== 1 || skill.slot > 4) continue
    if (!bySlot.has(skill.slot)) bySlot.set(skill.slot, skill)
  }
  const chips: SkillChip[] = []
  for (const slot of [1, 2, 3, 4]) {
    const skill = bySlot.get(slot)
    chips.push(
      skill
        ? {
            slot,
            role: skill.role,
            name_zh: skill.name_zh,
            sin_zh: skill.sin_zh,
            attack_type_zh: skill.attack_type_zh,
          }
        : { slot, role: 'attack', name_zh: '', sin_zh: null, attack_type_zh: null },
    )
  }
  return chips
}
