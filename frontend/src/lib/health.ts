import type { Identities } from '../types'
import type { GameMeta } from './db'
import { orphanTags } from './tagTools'

export type HealthIssue = {
  identityId: number
  nameZh: string
  message: string
}

export type HealthReport = {
  issues: HealthIssue[]
  /** 沒有任何人格在用的孤兒標籤。 */
  orphans: string[]
}

const REQUIRED_STRINGS = ['slug', 'name_zh', 'sinner_zh', 'season_zh', 'image']
/** 必須有內容的陣列欄位；keywords 允許為空（少數人格本來就沒有關鍵字）。 */
const REQUIRED_NON_EMPTY_ARRAYS = ['damage_types_zh', 'sin_affinities_zh']

/**
 * 資料健康檢查：每一項都對得上存檔規則（validateIdentities）與遊戲畫面的需求。
 * keywords 為空是合法的（少數人格本來就沒有關鍵字），所以不做空值檢查。
 */
export function checkHealth(identities: Identities, rarityMeta: GameMeta['rarity']): HealthReport {
  const issues: HealthIssue[] = []
  const seenIds = new Set<number>()

  const push = (identity: Identities[number], message: string): void => {
    issues.push({ identityId: identity.id, nameZh: identity.name_zh, message })
  }

  for (const identity of identities) {
    if (seenIds.has(identity.id)) push(identity, `id ${identity.id} 重複`)
    seenIds.add(identity.id)

    for (const field of REQUIRED_STRINGS)
      if (typeof (identity as unknown as Record<string, unknown>)[field] !== 'string' ||
          (identity as unknown as Record<string, string>)[field] === '')
        push(identity, `「${field}」是空的`)

    for (const field of REQUIRED_NON_EMPTY_ARRAYS) {
      const value = (identity as unknown as Record<string, unknown>)[field]
      if (!Array.isArray(value) || value.length === 0)
        push(identity, `「${field}」是空的`)
    }

    if (identity.tags_zh.length === 0) push(identity, '沒有任何標籤')
    if (new Set(identity.tags_zh).size !== identity.tags_zh.length) push(identity, '標籤有重複')

    if (!(identity.rarity in rarityMeta))
      push(identity, `稀有度 ${identity.rarity} 沒有 game_meta 設定`)

    if (identity.season < 1 || identity.season > 9) push(identity, `賽季 ${identity.season} 超出 1-9`)

    if (identity.min_speed > identity.max_speed)
      push(identity, `速度反轉（${identity.min_speed}-${identity.max_speed}）`)
    if (identity.hp_base <= 0) push(identity, `HP ${identity.hp_base} 不是正數`)

    if (identity.skills_zh.length === 0) push(identity, '沒有任何技能')
    if (!identity.skills_zh.some((skill) => skill.slot === 4))
      push(identity, '缺少防禦技能（slot 4）')
    for (const skill of identity.skills_zh) {
      if (!Number.isInteger(skill.slot) || skill.slot < 1 || skill.slot > 9)
        push(identity, `技能格 ${skill.slot} 不在 1-9`)
      if (!['attack', 'defense', 'evade', 'counter', 'guard'].includes(skill.role))
        push(identity, `技能角色 ${skill.role} 無效`)
    }
  }

  return { issues, orphans: orphanTags(identities) }
}
