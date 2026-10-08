import type { Identities } from '../types'

/**
 * 匯入防線：JSON 與 CSV 兩條路徑共用。伺服器存檔時還會再跑一次欄位驗證，
 * 這裡先擋掉會讓整個編輯器狀態壞掉的結構問題。
 */
export function assertImportedIdentities(value: unknown, expectedCount: number): Identities {
  if (!Array.isArray(value)) throw new Error('匯入內容必須是人格陣列。')
  if (value.length !== expectedCount)
    throw new Error(`筆數必須維持 ${expectedCount} 筆，收到 ${value.length} 筆。`)
  if (!value.every((row) => row && typeof row === 'object' && 'id' in row && 'name_zh' in row))
    throw new Error('每一筆都要有 id 與 name_zh 欄位。')
  return value as Identities
}
