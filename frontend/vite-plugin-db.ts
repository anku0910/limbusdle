import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'

/**
 * Dev-only read/write access to the dataset in `../data`.
 *
 * The game used to `import` its identities, which meant a correction required a full
 * rebuild and the file lived in two places at once. Here the JSON on disk is the single
 * source of truth: `GET /api/db/<file>` serves it and `PUT /api/db/<file>` writes it back,
 * so the in-browser editor takes effect on reload with no bundler in the loop.
 *
 * Safety rests entirely on the allowlist below - names are matched against it exactly, so
 * no traversal string can ever escape the data directory.
 */

export const META_FILE = 'game_meta.json'
export const IDENTITIES_FILE = 'zh_identities.json'
export const EDITABLE_FILES = [META_FILE, IDENTITIES_FILE] as const

export type EditableFile = (typeof EDITABLE_FILES)[number]

/** Resolve a requested name to an absolute path, or `null` if it is not allowlisted. */
export function resolveDbFile(dataDir: string, requested: string): string | null {
  let name = requested
  try {
    name = decodeURIComponent(requested)
  } catch {
    return null
  }
  if (!(EDITABLE_FILES as readonly string[]).includes(name)) return null
  return path.join(dataDir, name)
}

export type ValidationResult = { ok: true } | { ok: false; errors: string[] }

const OK: ValidationResult = { ok: true }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** Cap the error list so a wholly wrong payload cannot return 400 lines of text. */
const MAX_ERRORS = 20

export function validateMeta(value: unknown): ValidationResult {
  const errors: string[] = []
  if (!isPlainObject(value)) {
    return { ok: false, errors: ['game_meta.json 必須是一個 JSON 物件'] }
  }

  for (const field of ['title', 'subtitle', 'tagline'] as const) {
    if (!isNonEmptyString(value[field])) errors.push(`「${field}」必須是非空字串`)
  }

  const rarity = value.rarity
  if (!isPlainObject(rarity)) {
    errors.push('「rarity」必須是一個物件，鍵為稀有度數值，例如 "1"')
  } else {
    const keys = Object.keys(rarity)
    if (keys.length === 0) errors.push('「rarity」至少要有一筆設定')
    for (const key of keys) {
      if (!/^[1-9][0-9]*$/.test(key)) {
        errors.push(`「rarity」的鍵「${key}」必須是正整數數字字串`)
        continue
      }
      const entry = rarity[key]
      if (!isPlainObject(entry) || !isNonEmptyString(entry.label)) {
        errors.push(`「rarity.${key}.label」必須是非空字串`)
      }
    }
  }

  if (
    value.tag_order !== undefined &&
    (!isStringArray(value.tag_order) || new Set(value.tag_order).size !== value.tag_order.length)
  )
    errors.push('「tag_order」必須是不重複的字串陣列')

  return errors.length ? { ok: false, errors: errors.slice(0, MAX_ERRORS) } : OK
}

export type IdentityValidationOptions = {
  /**
   * Roster size the dataset must keep. The editor edits fields but never adds or removes
   * identities: changing the pool length re-shuffles the seeded daily answer and
   * invalidates every saved round, so it is rejected rather than silently accepted.
   */
  expectedCount?: number
  /** Every rarity value in use must have a label, or its grid cell would render blank. */
  rarityKeys?: ReadonlySet<string>
}

const REQUIRED_STRINGS = [
  'slug',
  'name_zh',
  'sinner_zh',
  'season_zh',
  'image',
] as const

const REQUIRED_STRING_ARRAYS = [
  'damage_types_zh',
  'sin_affinities_zh',
  'keywords_zh',
] as const

const SKILL_ROLES = new Set(['attack', 'defense', 'evade', 'counter', 'guard'])

/** Validates one `skills_zh` entry; returns a reason to reject, or null. */
function skillError(skill: unknown): string | null {
  if (!isPlainObject(skill)) return '不是物件'
  if (!isNonEmptyString(skill.name_zh)) return '的「name_zh」必須是非空字串'
  if (!isPositiveInt(skill.slot)) return '的「slot」必須是正整數'
  if (!SKILL_ROLES.has(String(skill.role))) return '的「role」必須是 attack/defense/evade/counter/guard'
  for (const field of ['coin_cost', 'base_power', 'attack_capacity'] as const) {
    const value = skill[field]
    if (value !== null && !(isPositiveInt(value) || value === 0)) {
      return `的「${field}」必須是非負整數或 null`
    }
  }
  if (!isStringArray(skill.extra_sins_zh)) return '的「extra_sins_zh」必須是字串陣列'
  return null
}

export function validateIdentities(
  value: unknown,
  options: IdentityValidationOptions = {},
): ValidationResult {
  const errors: string[] = []
  if (!Array.isArray(value)) {
    return { ok: false, errors: ['zh_identities.json 必須是一個 JSON 陣列'] }
  }

  const { expectedCount, rarityKeys } = options
  if (expectedCount != null && value.length !== expectedCount) {
    errors.push(
      `人格總數必須維持 ${expectedCount} 筆（目前 ${value.length} 筆）；編輯器只開放修改欄位，不開放新增或刪除`,
    )
  }

  const seenIds = new Set<number>()
  value.forEach((record: unknown, index) => {
    if (errors.length > MAX_ERRORS) return
    if (!isPlainObject(record)) {
      errors.push(`第 ${index + 1} 筆不是物件`)
      return
    }
    if (!isPositiveInt(record.id)) {
      errors.push(`第 ${index + 1} 筆的 id 必須是正整數`)
    } else if (seenIds.has(record.id)) {
      errors.push(`id ${record.id} 重複`)
    } else {
      seenIds.add(record.id)
    }

    for (const field of REQUIRED_STRINGS) {
      if (!isNonEmptyString(record[field])) {
        errors.push(`id ${String(record.id)} 的「${field}」必須是非空字串`)
      }
    }
    for (const field of REQUIRED_STRING_ARRAYS) {
      if (!isStringArray(record[field])) {
        errors.push(`id ${String(record.id)} 的「${field}」必須是字串陣列`)
      }
    }
    if (!isPositiveInt(record.rarity)) {
      errors.push(`id ${String(record.id)} 的 rarity 必須是正整數`)
    } else if (rarityKeys && !rarityKeys.has(String(record.rarity))) {
      errors.push(
        `id ${String(record.id)} 的 rarity ${record.rarity} 在 game_meta.json 沒有對應的顯示設定`,
      )
    }
    if (!isPositiveInt(record.season)) {
      errors.push(`id ${String(record.id)} 的 season 必須是正整數`)
    }
// Every identity carries at least one label; the editor must not be able to blank the
// column or pad it with whitespace, which would leave the result screen with nothing
// useful to show.
if (!isStringArray(record.tags_zh) || record.tags_zh.length === 0) {
  errors.push(`id ${String(record.id)} 的「tags_zh」必須是至少一筆的字串陣列`)
} else if (record.tags_zh.some((tag: string) => !tag.trim())) {
  errors.push(`id ${String(record.id)} 的「tags_zh」不可包含空白標籤`)
}
    if (!Array.isArray(record.skills_zh)) {
      errors.push(`id ${String(record.id)} 的「skills_zh」必須是陣列`)
    } else {
      record.skills_zh.forEach((skill: unknown, index: number) => {
        const reason = skillError(skill)
        if (reason) errors.push(`id ${String(record.id)} 的第 ${index + 1} 個技能${reason}`)
      })
    }
  })

  return errors.length ? { ok: false, errors: errors.slice(0, MAX_ERRORS) } : OK
}

const MAX_BODY_BYTES = 8 * 1024 * 1024

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: Parameters<Connect.NextHandleFunction>[1], status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

/** Write via a temp file so a crash mid-write cannot truncate the dataset. */
async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const temp = `${file}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2), 'utf8')
  await rename(temp, file)
}

async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'))
}

function createMiddleware(dataDir: string, writable: boolean): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const url = req.url ?? ''
    if (!url.startsWith('/api/db/')) return next()

    const requested = url.slice('/api/db/'.length).split('?')[0]
    const file = resolveDbFile(dataDir, requested)
    if (!file) {
      sendJson(res, 404, { error: `不允許存取的檔案：${requested}` })
      return
    }

    if (req.method === 'GET') {
      try {
        sendJson(res, 200, await readJsonFile(file))
      } catch {
        sendJson(res, 404, { error: `找不到 ${requested}` })
      }
      return
    }

    if (req.method === 'PUT') {
      if (!writable) {
        sendJson(res, 405, { error: '預覽伺服器為唯讀，請用 npm run dev 進行編輯' })
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(await readBody(req))
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error && error.message === 'payload too large'
            ? '內容過大'
            : 'JSON 格式錯誤',
        })
        return
      }

      const validation =
        requested === META_FILE
          ? validateMeta(parsed)
          : await validateAgainstDisk(file, parsed)
      if (!validation.ok) {
        sendJson(res, 400, { errors: validation.errors })
        return
      }

      try {
        await writeJsonAtomic(file, parsed)
        sendJson(res, 200, { saved: true })
      } catch (error) {
        sendJson(res, 500, {
          error: `寫入失敗：${error instanceof Error ? error.message : String(error)}`,
        })
      }
      return
    }

    sendJson(res, 405, { error: '僅支援 GET 與 PUT' })
  }
}

/**
 * Validate the roster against the meta currently on disk, so an identity cannot be saved
 * with a rarity the UI has no label for.
 */
async function validateAgainstDisk(file: string, parsed: unknown): Promise<ValidationResult> {
  const dir = path.dirname(file)
  let expectedCount: number | undefined
  try {
    const current = await readJsonFile(path.join(dir, IDENTITIES_FILE))
    if (Array.isArray(current)) expectedCount = current.length
  } catch {
    // No roster on disk yet; the count check simply does not apply.
  }

  let rarityKeys: Set<string> | undefined
  try {
    const meta = await readJsonFile(path.join(dir, META_FILE))
    if (isPlainObject(meta) && isPlainObject(meta.rarity)) {
      rarityKeys = new Set(Object.keys(meta.rarity))
    }
  } catch {
    // Same as above: skip the cross-check rather than block the save.
  }

  return validateIdentities(parsed, { expectedCount, rarityKeys })
}

export type DbPluginOptions = {
  /** Absolute path to the dataset directory. Defaults to `<root>/../data`. */
  dataDir?: string
}

export function dbPlugin(options: DbPluginOptions = {}): Plugin {
  let dataDir = options.dataDir ?? ''

  return {
    name: 'limbusdle-db',
    apply: () => true,

    configResolved(config) {
      if (!dataDir) dataDir = path.resolve(config.root, '..', 'data')
    },

    configureServer(server: ViteDevServer) {
      server.middlewares.use(createMiddleware(dataDir, true))
    },

    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(createMiddleware(dataDir, false))
    },

    /**
     * `vite build` has no API to read from, so the dataset is emitted as a static asset
     * and the client falls back to fetching it. `dist/` stays self-contained.
     */
    async generateBundle() {
      for (const name of EDITABLE_FILES) {
        try {
          const source = await readFile(path.join(dataDir, name), 'utf8')
          this.emitFile({ type: 'asset', fileName: `data/${name}`, source })
        } catch {
          // A file that does not exist is simply not emitted.
        }
      }
    },
  }
}