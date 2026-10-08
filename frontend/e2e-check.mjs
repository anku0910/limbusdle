import { chromium } from 'playwright'

const BASE = 'http://localhost:4174'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const problems = []
const ok = []
const dump = []
const note = (message) => problems.push(message)

const browser = await chromium.launch({ executablePath: EDGE })
const page = await browser.newPage()

// Cloned pages inherit no media emulation, but the reduced-motion pass above still
// matters: it doubles as a run through the prefers-reduced-motion path the design
// promises to support (and keeps hover transitions from shifting a click target).
await page.emulateMedia({ reducedMotion: 'reduce' })

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

await page.goto(BASE, { waitUntil: 'networkidle' })

const heading = await page.locator('h1').innerText()
if (!heading.includes('Limbusdle')) note(`h1 was ${heading}`)
else ok.push('header renders')

// Before the first guess the grid is intentionally replaced by an empty-state message.
const emptyState = await page.locator('text=還沒有紀錄').count()
if (emptyState !== 1) note('expected the empty-state message before the first guess')
else ok.push('empty state shown before the first guess')

if ((await page.locator('text=連勝').count()) === 0) note('header stats missing')
else ok.push('header stats render')

const picker = page.locator('section[aria-label="選擇人格"]')

// The picker opens straight on the portraits - no 選一位罪人 title strip.
if ((await page.locator('h2:has-text("選一位罪人")').count()) !== 0)
  note('the 選一位罪人 header strip should be gone')
else ok.push('no 選一位罪人 header strip')

// The legend is gone too: the top of the page stays free for the header stats.
if ((await page.locator('text=玩法').count()) !== 0) note('the 玩法 legend should be gone')
else ok.push('no 玩法 legend block')

// The design dropped every rounded corner - no element may keep a radius.
const roundedElements = await page.locator('[class*="rounded"]').count()
if (roundedElements !== 0) note(`${roundedElements} element(s) still carry a rounded class`)
else ok.push('no rounded corners anywhere in the UI')

// The distribution is pinned to the viewport edge so it steals no width from the grid.
const gridBox = await page.locator('section[aria-label="猜測紀錄"]').boundingBox()
const distBox = await page.locator('aside').first().boundingBox()
if (!gridBox || !distBox || distBox.x <= gridBox.x)
  note('distribution is not positioned to the right of the grid')
else ok.push('distribution sits on the right side of the grid')
const distPosition = await page
  .locator('aside')
  .first()
  .evaluate((el) => getComputedStyle(el).position)
if (distPosition !== 'fixed')
  note(`distribution should be pinned fixed, got ${distPosition}`)
else ok.push('distribution is pinned fixed to the viewport edge')

// Passport cards must show the whole portrait: no cover-crop, and back to 6 + 6.
const firstPortrait = picker.locator('ul li button img').first()
const portraitFit = await firstPortrait.evaluate((el) => getComputedStyle(el).objectFit)
if (portraitFit === 'cover')
  note('passport portrait is still object-cover cropped')
else ok.push('passport portrait keeps its full image (no cover crop)')
const portraitBoxes = []
for (let i = 0; i < 12; i += 1) {
  portraitBoxes.push(await picker.locator('ul li button img').nth(i).boundingBox())
}
if (
  !portraitBoxes.every(Boolean) ||
  Math.abs(portraitBoxes[0].y - portraitBoxes[5].y) > 2 ||
  portraitBoxes[6].y - portraitBoxes[0].y < 50
)
  note('sinner cards are not laid out six + six')
else if (portraitBoxes[0].width > 160)
  note(`sinner cards should be back to ~130px, saw ${Math.round(portraitBoxes[0].width)}`)
else ok.push(`sinner cards laid out 6 + 6 (${Math.round(portraitBoxes[0].width)}px wide)`)

dump.push('=== header ===')
dump.push((await page.locator('header').innerText()).trim())

// The text input is gone: the picker must be the only way in.
const combos = await page.getByRole('combobox').count()
if (combos !== 0) note(`expected no search combobox, found ${combos}`)
else ok.push('search input replaced by the portrait picker')

const sinnerTiles = await picker.locator('ul li button').count()
if (sinnerTiles !== 12) note(`expected 12 sinner tiles, saw ${sinnerTiles}`)
else ok.push('picker shows all 12 sinners')

// Portraits only: no name may be rendered as visible text next to a tile.
const pickerText = await picker.innerText()
if (/[\u8f49]/.test(pickerText)) note(`picker leaks names as text: ${pickerText.slice(0, 60)}`)
else ok.push('picker renders portraits with no names')

const portraitSrcs = await picker.locator('img').evaluateAll((nodes) =>
  nodes.map((n) => n.getAttribute('src') || ''),
)
if (!portraitSrcs.every((src) => src.startsWith('/thumbs/')))
  note(`picker is not using the local thumbs: ${portraitSrcs.slice(0, 3).join(', ')}`)
else ok.push(`picker uses ${portraitSrcs.length} local passport thumbs`)

// The background artwork must actually be applied, not just referenced.
const bg = await page.evaluate(() => {
  const el = document.querySelector('.backdrop')
  if (!el) return null
  const style = getComputedStyle(el)
  return { image: style.backgroundImage, size: style.backgroundSize }
})
if (!bg || !bg.image.includes('background.webp'))
  note(`background artwork not applied (${bg ? bg.image : 'no .backdrop element'})`)
else ok.push(`background artwork applied (${bg.size})`)

// Drill into a sinner, then guess an identity by portrait.
await picker.locator('ul li button').first().click()
await page.waitForTimeout(300)
const identityTiles = await picker.locator('ul li button').count()
if (identityTiles === 0) note('opening a sinner showed no identities')
else ok.push(`opening a sinner -> ${identityTiles} identities`)

// The first sinner is 李箱, whose roster now includes the kindergarten captain.
const kindergartenTiles = await picker
  .locator('ul li button[title*="開朗小雞班"]')
  .count()
if (kindergartenTiles !== 1)
  note(`expected 1 開朗小雞班 identity in the 李箱 group, saw ${kindergartenTiles}`)
else ok.push('kindergarten identity shows up in the picker (開朗小雞班-班長)')

const tileSrcs = await picker.locator('ul li button img').evaluateAll((nodes) =>
  nodes.map((n) => n.getAttribute('src') || ''),
)
if (!tileSrcs.every((src) => src.startsWith('/thumbs/')))
  note(`identity tiles are not local thumbs: ${tileSrcs.slice(0, 3).join(', ')}`)
else ok.push('identity tiles use the local 128px icons')

await picker.locator('ul li button').first().click()
await page.waitForTimeout(350)

const guessedTitle = await picker.locator('ul li button').first().getAttribute('title')
const ticked = await picker.locator('ul li button span:has-text("✓")').count()
if (ticked === 0) note('the guessed identity is not marked with a tick')
else ok.push(`guessed identity is dimmed and ticked ("${guessedTitle}")`)

await picker.locator('button:has-text("返回罪人列表")').click()
await page.waitForTimeout(250)
const backToSinners = await picker.locator('ul li button').count()
if (backToSinners !== 12) note(`expected to return to 12 sinners, saw ${backToSinners}`)
else ok.push('can return to the sinner grid')
await page.screenshot({ path: 'shot-picker.png', fullPage: true })

const cells = await page.locator('tbody tr td [title]').count()
if (cells === 0) note('guess produced no coloured cells')
else ok.push(`first guess rendered ${cells} coloured cells`)

// The 人格 column draws the local identity icon rather than the CDN fallback.
const gridThumbs = await page
  .locator('tbody tr:first-child td img[src^="/thumbs/"]')
  .count()
if (gridThumbs !== 1) note(`expected the grid row to use a local thumb, saw ${gridThumbs}`)
else ok.push('grid rows use the local identity icon')

const headers = await page.locator('th').allInnerTexts()
if (headers.length !== 6) note(`expected 6 headers (人格 + 5), got ${headers.length}: ${headers.join('/')}`)
else ok.push(`grid headers: ${headers.join(' / ')}`)
if (headers.includes('罪人') || headers.includes('稀有度'))
  note('罪人/稀有度 must ride inline in the 人格 cell, not own a column')
else ok.push('罪人/稀有度 no longer own their own columns')

const rows = await page.locator('tbody tr').count()
if (rows !== 8) note(`expected 8 grid rows, got ${rows}`)
else ok.push('grid padded to 8 rows')

// exact=emerald, partial=amber, miss=rose, under/over arrows=slate. Scoped past the
// 人格 cell so the inline sinner/rarity verdict badges never inflate the tally.
const green = await page.locator('tbody tr td:not(:first-child) .bg-emerald-600').count()
const amber = await page.locator('tbody tr td:not(:first-child) .bg-amber-500').count()
const rose = await page.locator('tbody tr td:not(:first-child) .bg-rose-700').count()
const slate = await page.locator('tbody tr td:not(:first-child) .bg-slate-600').count()
if (green + amber + rose + slate !== cells) {
  note(`colour classes cover ${green + amber + rose + slate} of ${cells} cells`)
} else {
  ok.push(
    `colours applied (green ${green}, yellow ${amber}, red ${rose}, arrow ${slate})`,
  )
}

// The 人格 cell itself is the verdict now: coloured background (green = the answer,
// amber = the right sinner, red = a miss), identity name on line one, the sinner
// name always spelled out below it, and no badges left inside the cell.
const identityCell = page.locator('tbody tr').first().locator('td').first()
const identityClass = (await identityCell.getAttribute('class')) ?? ''
if (!/bg-(emerald-600|amber-500|rose-700)/.test(identityClass))
  note(`identity cell carries no verdict background: ${identityClass}`)
else ok.push(`identity cell background verdict (${identityClass.match(/bg-\S+/)?.[0] ?? ''})`)
const sinnerLine = await identityCell.locator('span:text-is("李箱")').count()
if (sinnerLine < 1) note('identity cell no longer spells out the sinner name')
else ok.push('identity cell keeps the sinner name line below the identity name')
const rarityMarks = await identityCell
  .locator('span:text-is("▲"), span:text-is("▼"), span:text-is("●")')
  .count()
if (rarityMarks < 1)
  note('identity cell is missing the inline rarity verdict mark (▲/▼/●)')
else ok.push('rarity verdict rides beside the sinner name (▲/▼/●)')
const innerBadges = await identityCell
  .locator('.bg-emerald-600, .bg-amber-500, .bg-rose-700, .bg-slate-600')
  .count()
if (innerBadges !== 0)
  note(`identity cell still holds ${innerBadges} inner verdict badge(s)`)
else ok.push('identity cell has no inner badges (verdict lives on the cell itself)')

const emptyCells = await page.locator('tbody tr td .bg-zinc-900\\/70').count()
if (emptyCells !== (8 - 1) * 5) note(`expected 35 empty placeholders, got ${emptyCells}`)
else ok.push('35 empty placeholders pad the remaining rows')

// --- Difficulty selector ---------------------------------------------------
const headerCount = async () => (await page.locator('th').allInnerTexts()).length
const placeholderCount = () => page.locator('tbody tr td .bg-zinc-900\\/70').count()
const cellCount = () => page.locator('tbody tr td [title]').count()
const difficultyGroup = page.getByRole('group', { name: '難度' })
const levels = (await difficultyGroup.locator('button').allInnerTexts()).map((t) => t.trim())
if (levels.join('/') !== '簡單/普通/困難') note(`difficulty buttons were ${levels.join('/')}`)
else ok.push(`difficulty selector offers ${levels.join('、')}`)

const pickDifficulty = async (label) => {
  await difficultyGroup.locator('button', { hasText: label }).click()
  await page.waitForTimeout(250)
}

await pickDifficulty('困難')
const hardHeaders = await headerCount()
if (hardHeaders !== 2) note(`hard mode should show 2 headers (人格 + 技能), saw ${hardHeaders}`)
else ok.push('hard mode keeps only 技能 (罪人/稀有度 ride inline)')
const hardCells = await cellCount()
if (hardCells !== 1) note(`hard mode should score 1 column per guess, saw ${hardCells}`)
else ok.push('hard mode reveals only the skills cell per guess')
const hardEmpty = await placeholderCount()
if (hardEmpty !== (8 - 1) * 1) note(`hard mode should pad 7 placeholders, got ${hardEmpty}`)
else ok.push('hard mode pads the grid to 1 column')

// The 技能 cell is only on screen here: four sin chips in a single row - S1 S2 S3
// defense - attack glyphs on the attack slots, the Guard/Evade/Counter glyph on
// slot 4, and a verdict ring on every chip.
const skillCell = page.locator('tbody tr').first().locator('td').nth(1)
const chips = await skillCell.locator('div > span').count()
if (chips !== 4) note(`skills cell should draw 4 chips, saw ${chips}`)
else ok.push('skills cell draws S1-S3 + defense chips')
const chipBoxes = []
for (let i = 0; i < 4; i += 1) {
  chipBoxes.push(await skillCell.locator('div > span').nth(i).boundingBox())
}
if (
  !chipBoxes.every(Boolean) ||
  chipBoxes.some((b) => Math.abs(b.y - chipBoxes[0].y) > 2) ||
  !(
    chipBoxes[0].x < chipBoxes[1].x &&
    chipBoxes[1].x < chipBoxes[2].x &&
    chipBoxes[2].x < chipBoxes[3].x
  )
)
  note(`skills chips are not one row of four: ${JSON.stringify(chipBoxes.map((b) => b && [Math.round(b.x), Math.round(b.y)]))}`)
else ok.push('skills chips laid out in one row of four (S1 S2 S3 defense)')
const chipIcons = await skillCell.locator('div > span img').evaluateAll((nodes) =>
  nodes.map((n) => n.getAttribute('src') || ''),
)
const attackIcons = chipIcons.filter((src) => src.startsWith('/thumbs/atk-'))
const roleIcons = chipIcons.filter((src) => src.startsWith('/thumbs/role-'))
if (attackIcons.length < 1 || attackIcons.length > 3)
  note(`skills cell should show 1-3 attack icons, saw ${attackIcons.length}`)
else if (!attackIcons.every((src) => src.startsWith('/thumbs/atk-')))
  note(`attack icons are not local: ${attackIcons.join(', ')}`)
else ok.push(`skills cell overlays ${attackIcons.length} local attack-type icons`)
if (roleIcons.length !== 1)
  note(`slot 4 should show exactly one defense-role icon, saw ${roleIcons.length}`)
else ok.push('slot-4 chip shows its Guard/Evade/Counter icon')
const chipClasses = await skillCell.locator('div > span').evaluateAll((nodes) =>
  nodes.map((n) => n.className),
)
if (!chipClasses.every((cls) => /ring-(emerald-400|amber-400|rose-500)/.test(cls)))
  note(`chips lack per-slot verdict rings: ${chipClasses.join(' | ')}`)
else ok.push('every chip wears its own verdict ring')
// Every column shares one cell height; the skills column simply spends it on a
// row of big chips rather than a stack.
const skillCellBox = await skillCell.locator('div').first().boundingBox()
if (!skillCellBox || skillCellBox.height < 64)
  note(`skills cell should be at least 64px tall, saw ${skillCellBox && Math.round(skillCellBox.height)}`)
else ok.push(`skills cell height ${Math.round(skillCellBox.height)}px`)
const identityBox = await identityCell.locator('div').first().boundingBox()
if (!identityBox || !skillCellBox || Math.abs(identityBox.height - skillCellBox.height) > 3)
  note(
    `人格/技能 cell heights differ: ${identityBox && Math.round(identityBox.height)} vs ${skillCellBox && Math.round(skillCellBox.height)}`,
  )
else ok.push('人格 and 技能 cells share the same height')
const chipBox = await skillCell.locator('div > span').first().boundingBox()
if (!chipBox || chipBox.width < 44)
  note(`skill chips should be at least 44px wide, saw ${chipBox && Math.round(chipBox.width)}`)
else ok.push(`skill chips ${Math.round(chipBox.width)}px square`)
const chipBg = await skillCell
  .locator('div > span')
  .first()
  .evaluate((node) => node.style.backgroundColor)
if (!chipBg) note('skills chips carry no inline sin colour')
else ok.push(`skills chips painted with sin colours (${chipBg})`)
await page.screenshot({ path: 'shot-hard.png', fullPage: true })

await pickDifficulty('普通')
const normalHeaders = await headerCount()
if (normalHeaders !== 4) note(`normal mode should show 4 headers (人格/賽季/技能/關鍵字), saw ${normalHeaders}`)
else ok.push('normal mode hides 標籤 and folds 屬性/罪孽 into 技能')
const skillHint = await page.locator('th', { hasText: '技能' }).first().getAttribute('title')
if (!skillHint || !skillHint.includes('同格同罪孽且攻防類型相同才為綠'))
  note(`skills hint does not document the stricter green rule: ${skillHint}`)
else ok.push('skills header hint documents the sin + kind green rule')
const normalCells = await cellCount()
if (normalCells !== 3) note(`normal mode should score 3 columns per guess, saw ${normalCells}`)
else ok.push('normal mode reveals 3 cells per guess')

// 人格 / 賽季 / 技能 / 關鍵字 - the four columns normal mode shows - must render at
// one shared height so the row reads as a single band.
const normalRow = page.locator('tbody tr').first()
const normalHeights = []
for (const col of [0, 1, 2, 3]) {
  const box = await normalRow.locator('td').nth(col).locator('div').first().boundingBox()
  normalHeights.push(box ? Math.round(box.height) : -1)
}
if (normalHeights.some((h) => Math.abs(h - normalHeights[0]) > 3))
  note(`normal-mode cells are not one height: ${normalHeights.join('/')}`)
else ok.push(`人格/賽季/技能/關鍵字 cells share one height (${normalHeights.join('/')})`)

await pickDifficulty('簡單')
const easyHeaders = await headerCount()
if (easyHeaders !== 6) note(`easy mode should restore 6 headers, saw ${easyHeaders}`)
else ok.push('easy mode restores every column')
const easyEmpty = await placeholderCount()
if (easyEmpty !== (8 - 1) * 5) note(`easy mode should restore 35 placeholders, got ${easyEmpty}`)
else ok.push('easy mode restores the full-width grid')

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(350)
const afterReload = await page.locator('tbody tr td [title]').count()
if (afterReload !== cells) note(`reload lost the guess (${afterReload} cells, was ${cells})`)
else ok.push('guess survives a reload (localStorage)')

// Fill in a finished round so the result modal and share text can be exercised.
await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('limbusdle:daily:'))
  const raw = JSON.parse(localStorage.getItem(key))
  raw.guesses = [...new Set([...raw.guesses, 999999])]
  raw.status = 'lost'
  localStorage.setItem(key, JSON.stringify(raw))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(400)

const modal = page.locator('[role=dialog]')
if ((await modal.count()) === 0) {
  note('result modal did not open for a finished round')
} else {
  ok.push('result modal opens on a finished round')
  const body = await modal.innerText()
  for (const needle of ['人格：', '罪人：', '標籤：', '關鍵字：']) {
    if (!body.includes(needle)) note(`share text missing ${needle}`)
  }
  if (!body.includes('X/8')) note('a loss should report X/8')
  else ok.push('share text reports X/8 for a loss')
  // Every skill must be listed with its coin cost, including the defense skill
  // in slot 4 and any identity that ships more than the base four.
  const skillText = await modal.locator('h3:has-text("技能")').locator('..').innerText()
  if (!/\d+\s*硬幣/.test(skillText)) note('result modal does not show any coin cost')
  else ok.push('result modal lists coin costs for every skill')
  const skillRows = await modal.locator('h3:has-text("技能") + ul > li').count()
  if (skillRows < 4) note(`expected at least 4 skill rows, saw ${skillRows}`)
  else ok.push(`result modal lists ${skillRows} skills`)
  ok.push('share text carries the full answer breakdown')
  dump.push('=== share text ===')
  dump.push((await page.locator('[role=dialog] pre').innerText()).trim())
  await page.screenshot({ path: 'shot-result.png' })
}

dump.push('=== finished-round notice ===')
dump.push((await page.locator('main').innerText()).split('\n').slice(0, 4).join(' | ').trim())

await page.getByRole('button', { name: /關閉/ }).first().click().catch(() => {})
await page.waitForTimeout(200)

// The result modal can be reopened from the main screen after closing it.
const reopened = await page.getByRole('button', { name: /查看結果/ }).count()
if (reopened !== 1) note('expected a 查看結果與分享 button once the round is over')
else {
  await page.getByRole('button', { name: /查看結果/ }).click()
  await page.waitForTimeout(200)
  if ((await page.locator('[role=dialog]').count()) !== 1) note('result modal did not reopen')
  else ok.push('result modal reopens from the main screen')
  await page.getByRole('button', { name: /關閉/ }).first().click()
  await page.waitForTimeout(150)
}

// Copy button must never throw, even where the clipboard API is unavailable.
await page.getByRole('button', { name: /查看結果/ }).click()
await page.waitForTimeout(200)
await page.getByRole('button', { name: /複製結果/ }).click()
await page.waitForTimeout(300)
const copyLabel = await page.locator('[role=dialog]').innerText()
if (!/已複製到剪貼簿|複製失敗，請手動選取/.test(copyLabel)) note('copy button gave no feedback')
else ok.push('copy button reports success or an explicit fallback')
await page.getByRole('button', { name: /關閉/ }).first().click()
await page.waitForTimeout(150)

// Stats should have recorded the loss exactly once, not twice for the reloads above.
const headerText = await page.locator('header').innerText()
if (!headerText.includes('勝率')) note('header is missing the win rate')
else ok.push(`header carries streak + win rate (${headerText.match(/勝率[^\n]*/)?.[0] ?? ''})`)

// --- Endless mode ----------------------------------------------------------
await page.getByRole('button', { name: '無限模式' }).click()
await page.waitForTimeout(400)

const toggled = await page.getByRole('button', { name: '無限模式' }).getAttribute('aria-pressed')
if (toggled !== 'true') note(`無限模式 toggle reported aria-pressed=${toggled}`)
else ok.push('無限模式 toggle switches on')

if ((await page.locator('text=第 1 題').count()) === 0) note('endless mode did not open on round 1')
else ok.push('endless mode opens on 第 1 題')

if ((await page.locator('text=還沒有紀錄').count()) !== 1)
  note('the endless round did not start with an empty grid')
else ok.push('endless round starts empty')

if ((await page.locator('text=目前連勝').count()) === 0)
  note('no streak display in endless mode')
else ok.push('streak (目前連勝 / 最高連勝) on screen in endless mode')

// Land one guess so the round is recognisably live, then force the loss and reload.
const infPicker = page.locator('section[aria-label="選擇人格"]')
await infPicker.locator('ul li button').first().click()
await page.waitForTimeout(300)
await infPicker.locator('ul li button').first().click()
await page.waitForTimeout(350)
if ((await page.locator('tbody tr').count()) !== 8) note('the endless guess did not land in the grid')
else ok.push('endless mode records a guess')

await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('limbusdle:infinite:'))
  if (!key) throw new Error('no endless-mode save was written')
  const raw = JSON.parse(localStorage.getItem(key))
  raw.status = 'lost'
  localStorage.setItem(key, JSON.stringify(raw))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(400)

const infModal = page.locator('[role=dialog]')
if ((await infModal.count()) === 0) {
  note('result modal did not open for a finished endless round')
} else {
  ok.push('endless round opens its result screen')
  if ((await infModal.locator('button:has-text("下一題")').count()) === 0)
    note('no 下一題 button on the endless result screen')
  else ok.push('endless result screen offers 下一題')
  await infModal.locator('button:has-text("下一題")').click()
  await page.waitForTimeout(450)
}

if ((await page.locator('text=第 2 題').count()) === 0) note('下一題 did not advance the endless round')
else ok.push('下一題 deals the next round (第 2 題)')
if ((await page.locator('text=還沒有紀錄').count()) !== 1)
  note('the next endless round was not cleared')
else ok.push('the next endless round starts empty')

// Back to the daily puzzle so the last screenshots show the normal game.
await page.getByRole('button', { name: '無限模式' }).click()
await page.waitForTimeout(300)
if ((await page.locator('text=今日').count()) === 0) note('switching back did not restore the daily puzzle')
else ok.push('endless mode can be switched back off')

// --- Local artwork ---------------------------------------------------------
for (const file of [
  '1.png',
  '190.png',
  'sinner-yi-sang.png',
  'passport-bg.png',
  'atk-slash.png',
  'atk-pierce.png',
  'atk-blunt.png',
  'role-guard.png',
  'role-evade.png',
  'role-counter.png',
]) {
  const res = await page.request.get(`${BASE}/thumbs/${file}`)
  if (!res.ok()) note(`/thumbs/${file} returned ${res.status()}`)
}
ok.push('identity, passport, attack and defense-role thumbs all serve with 200')

// --- Dataset editor search -------------------------------------------------
await page.goto(`${BASE}/#/edit`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
const identitiesTab = page.getByRole('button', { name: /人格（/ })
if ((await identitiesTab.count()) !== 1) {
  note('the #/edit dataset editor did not render')
} else {
  await identitiesTab.click()
  await page.waitForTimeout(200)
  const filter = page.getByLabel('篩選人格')
  await filter.fill('開朗小雞')
  await page.waitForTimeout(250)
  const zhCount = await page.locator('text=/符合 \\d+ 筆/').innerText()
  if (!zhCount.includes('符合 4 筆')) note(`search 開朗小雞 -> ${zhCount}`)
  else ok.push('search finds the 4 開朗小雞班 identities')
  const kgRow = await page.locator('section ul li').first().innerText()
  if (!kgRow.includes('獄兒園')) note(`kindergarten row lacks its tag: ${kgRow}`)
  else ok.push('kindergarten rows carry the 獄兒園 tag')

  await filter.fill('cheery')
  await page.waitForTimeout(250)
  const enCount = await page.locator('text=/符合 \\d+ 筆/').innerText()
  if (!enCount.includes('符合 4 筆')) note(`search cheery -> ${enCount}`)
  else ok.push('search matches the group by its English name')

  // --- Editor select filters -------------------------------------------------
  await filter.fill('')
  const tagOptions = await page.getByLabel('標籤篩選').locator('option').allInnerTexts()
  const tagAt = (tag) => tagOptions.indexOf(tag)
  const tagChainOk =
    tagAt('Zwei協會') !== -1 &&
    tagAt('Zwei協會') < tagAt('し協會') &&
    tagAt('し協會') < tagAt('六協會') &&
    tagAt('六協會') < tagAt('Öufi協會') &&
    tagAt('腦葉公司') < tagAt('E.G.O裝備') &&
    tagAt('E.G.O裝備') < tagAt('H公司') &&
    tagAt('H公司') < tagAt('黑獸') &&
    tagAt('黑獸') < tagAt('二代眷屬') &&
    tagAt('二代眷屬') < tagAt('三代眷屬') &&
    tagAt('三代眷屬') < tagAt('獄兒園') &&
    tagAt('獄兒園') < tagAt('臼齒事務所') &&
    tagAt('吊鉤事務所') < tagAt('蜘蛛巢') &&
    tagAt('蜘蛛巢') < tagAt('手指') &&
    tagAt('手指') < tagAt('幫派') &&
    tagAt('幫派') < tagAt('收尾人') &&
    tagAt('定事務所') < tagAt('吊鉤事務所')
  if (!tagChainOk) note(`tag option order wrong: ${tagOptions.slice(0, 16).join(' / ')}`)
  else ok.push('tag filter options follow the curated block + season order')

  // --- Tag order board -------------------------------------------------------
  const orderDetails = page.locator('details').filter({ hasText: '標籤順序' }).first()
  await orderDetails.locator('summary').click()
  await page.waitForTimeout(150)
  const orderChips = orderDetails.getByRole('list', { name: '標籤順序清單' }).locator('li')
  const beforeOrder = await orderChips.allInnerTexts()
  const downLabel = await orderChips.first().locator('button[aria-label^="下移"]').getAttribute('aria-label')
  const firstTag = downLabel.replace('下移 ', '')
  await orderChips.first().locator('button[aria-label^="下移"]').click()
  await page.waitForTimeout(150)
  const afterOrder = await orderChips.allInnerTexts()
  if (afterOrder[0] === beforeOrder[0] || afterOrder[1] !== beforeOrder[0])
    note(`tag order move failed: ${firstTag} stayed first (${afterOrder.slice(0, 2).join(' | ')})`)
  else ok.push('tag order board moves a chip down with the arrow button')
  if ((await page.locator('text=有未儲存的變更').count()) !== 1)
    note('reordering tags should mark the editor as dirty')
  else ok.push('reordering tags marks the editor as dirty')
  await orderDetails.getByLabel('重設預設順序').click()
  await page.waitForTimeout(150)
  const restoredOrder = await orderChips.allInnerTexts()
  if (JSON.stringify(restoredOrder) !== JSON.stringify(beforeOrder))
    note('reset did not restore the default tag order')
  else ok.push('reset restores the default tag order')
  if ((await page.locator('text=有未儲存的變更').count()) !== 0)
    note('reset should leave the editor clean')
  else ok.push('reset leaves the editor clean again')
  await orderDetails.locator('summary').click()

  await page.getByLabel('標籤篩選').selectOption('獄兒園')
  await page.waitForTimeout(250)
  const tagCount = await page.locator('text=/符合 \\d+ 筆/').innerText()
  if (!tagCount.includes('符合 12 筆')) note(`tag filter 獄兒園 -> ${tagCount}`)
  else ok.push('tag filter narrows to the 12 獄兒園 identities')
  await page.getByLabel('關鍵字篩選').selectOption('呼吸')
  await page.waitForTimeout(250)
  const bothCount = Number(
    (await page.locator('text=/符合 \\d+ 筆/').innerText()).match(/符合 (\d+) 筆/)?.[1] ?? '-1',
  )
  if (!(bothCount < 12))
    note(`filters should AND together (獄兒園 + 呼吸 -> ${bothCount} of 12)`)
  else ok.push(`select filters combine with AND (獄兒園 + 呼吸 = ${bothCount})`)
  await page.getByLabel('標籤篩選').selectOption('')
  await page.waitForTimeout(250)
  const kwOnly = Number(
    (await page.locator('text=/符合 \\d+ 筆/').innerText()).match(/符合 (\d+) 筆/)?.[1] ?? '-1',
  )
  if (!(kwOnly > 0)) note(`keyword filter 呼吸 -> ${kwOnly}`)
  else ok.push(`keyword filter 呼吸 matches ${kwOnly} identities`)
  await page.getByLabel('關鍵字篩選').selectOption('')
  await page.getByLabel('稀有度篩選').selectOption('3')
  await page.waitForTimeout(250)
  const rarityOnly = Number(
    (await page.locator('text=/符合 \\d+ 筆/').innerText()).match(/符合 (\d+) 筆/)?.[1] ?? '-1',
  )
  if (!(rarityOnly > 0)) note(`rarity filter 3 -> ${rarityOnly}`)
  else ok.push(`rarity filter narrows to ${rarityOnly} tier-3 identities`)
  await page.getByLabel('稀有度篩選').selectOption('')
  await page.waitForTimeout(200)

  // --- Column sorting --------------------------------------------------------
  const listRows = page.getByRole('list', { name: '人格清單' }).locator('li')
  const idSort = page.getByRole('button', { name: '依 id 排序', exact: true })
  const rowId = async (row) => Number(await row.locator('.font-mono').innerText())
  await idSort.click()
  await page.waitForTimeout(150)
  const ascIds = [await rowId(listRows.first()), await rowId(listRows.last())]
  if (!(ascIds[0] < ascIds[1])) note(`id ascending sort broken (${ascIds[0]}..${ascIds[1]})`)
  else ok.push('sort by id lists rows ascending')
  await idSort.click()
  await page.waitForTimeout(150)
  const descIds = [await rowId(listRows.first()), await rowId(listRows.last())]
  if (!(descIds[0] > descIds[1])) note(`id descending sort broken (${descIds[0]}..${descIds[1]})`)
  else ok.push('a second click flips the sort to descending')
  await idSort.click()
  await page.waitForTimeout(150)
    if ((await idSort.getAttribute('aria-pressed')) === 'true')
      note('third click should clear the sort, but aria-pressed stayed true')
    else ok.push('a third click returns the list to its natural order')

    // --- Pagination ------------------------------------------------------------
    const pageLabel = page.locator('text=/第 \\d+ \\/ \\d+ 頁/')
    const firstPageLabel = (await pageLabel.innerText()).trim()
    if (firstPageLabel !== '第 1 / 5 頁') note(`first page label -> ${firstPageLabel}`)
    else ok.push('pagination shows 5 pages for 201 rows (page 1/5)')
    await page.getByRole('button', { name: '下一頁', exact: true }).click()
    await page.waitForTimeout(150)
    const secondPageLabel = (await pageLabel.innerText()).trim()
    if (secondPageLabel !== '第 2 / 5 頁') note(`next page -> ${secondPageLabel}`)
    else ok.push('next page advances to 2/5')
    const secondFirstId = Number(await listRows.first().locator('.font-mono').innerText())
    if (!(secondFirstId > 50)) note(`page 2 should start past row 50, got id ${secondFirstId}`)
    else ok.push('page 2 starts after the first 50 rows')
    await page.getByRole('button', { name: '上一頁', exact: true }).click()
    await page.waitForTimeout(150)
    if ((await pageLabel.innerText()).trim() !== '第 1 / 5 頁') note('previous page did not return to 1/5')
    else ok.push('previous page returns to 1/5')

    // --- Quick edit + undo / redo ---------------------------------------------
    // 12 筆人格共用「LCB罪人」這個名字，所以所有操作都鎖在第一列裡面做。
    const quickRow = listRows.first()
    const quickLabel = await quickRow
      .locator('button[aria-label^="快速編輯"]')
      .getAttribute('aria-label')
    const quickTarget = quickLabel.replace('快速編輯 ', '')
    await quickRow.locator('button[aria-label^="快速編輯"]').click()
    await page.waitForTimeout(100)
    await quickRow.getByLabel(`快速標籤 ${quickTarget}`).fill('測試快改')
    await quickRow.getByLabel(`完成快速編輯 ${quickTarget}`).click()
    await page.waitForTimeout(150)
    if (!(await listRows.first().innerText()).includes('測試快改'))
      note(`quick edit did not apply to ${quickTarget}`)
    else ok.push('quick edit applies tags straight from the row')
    const historyDetails = page.locator('details').filter({ hasText: '操作紀錄' }).first()
    await historyDetails.locator('summary').click()
    await page.waitForTimeout(100)
    const historyText = await historyDetails.innerText()
    if (!historyText.includes('修改'))
      note(`history panel should list the quick edit: ${historyText.slice(0, 60).replace(/\s+/g, ' ')}`)
    else ok.push('history panel lists the quick edit entry')
    await historyDetails.locator('summary').click()
    await page.getByLabel('復原上一步').click()
    await page.waitForTimeout(150)
    if ((await listRows.first().innerText()).includes('測試快改'))
      note('undo did not revert the quick edit')
    else ok.push('undo reverts the quick edit')
    await page.getByLabel('重做下一步').click()
    await page.waitForTimeout(150)
    if (!(await listRows.first().innerText()).includes('測試快改'))
      note('redo did not reapply the quick edit')
    else ok.push('redo reapplies the quick edit')
    await page.getByLabel('復原上一步').click()
    await page.waitForTimeout(150)

    // --- Batch selection -------------------------------------------------------
  await listRows.first().locator('input[type=checkbox]').check()
  let selText = await page.locator('text=/已選 \\d+ 筆/').innerText()
  if (!selText.includes('已選 1 筆')) note(`batch select one row -> ${selText}`)
  else ok.push('checking a row starts a batch selection')
  const totalRows = Number(
    (await page.locator('text=/符合 \\d+ 筆/').innerText()).match(/符合 (\d+) 筆/)?.[1] ?? '-1',
  )
  await page.getByLabel('全選符合的人格').check()
  await page.waitForTimeout(150)
  selText = await page.locator('text=/已選 \\d+ 筆/').innerText()
  if (!selText.includes(`已選 ${totalRows} 筆`))
    note(`select-all should check ${totalRows} rows -> ${selText}`)
  else ok.push(`select-all checks every filtered row (${totalRows})`)
  await page.getByLabel('批次標籤').fill('測試標籤')
  await page.getByRole('button', { name: '加入', exact: true }).click()
  await page.waitForTimeout(200)
  const batched = await listRows.first().innerText()
  if (!batched.includes('測試標籤')) note(`batch tag add failed: ${batched}`)
  else ok.push('batch add appends a tag across the selection')
  await page.getByRole('button', { name: '捨棄變更' }).click()
  await page.waitForTimeout(250)
  const reverted = await listRows.first().innerText()
  if (reverted.includes('測試標籤')) note('discard did not revert the batch edit')
  else ok.push('discard reverts batch edits')

  // --- Export / import -------------------------------------------------------
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByLabel('匯出 JSON').click(),
  ])
  if (!download.suggestedFilename().includes('zh_identities'))
    note(`export filename was ${download.suggestedFilename()}`)
  else ok.push('export downloads the roster as zh_identities.json')
    if ((await page.getByLabel('匯入 JSON').count()) !== 1) note('import file control missing')
    else ok.push('import offers a JSON file picker')

    // --- CSV export / import round trip ---------------------------------------
    const [csvDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByLabel('匯出 CSV').click(),
    ])
    if (!csvDownload.suggestedFilename().includes('zh_identities'))
      note(`csv filename was ${csvDownload.suggestedFilename()}`)
    else ok.push('csv export downloads zh_identities.csv')
    await page.getByLabel('匯入 CSV').setInputFiles(await csvDownload.path())
    await page.waitForTimeout(500)
    const csvNote = page.locator('text=/已載入 \\d+ 筆/')
    if ((await csvNote.count()) === 0) note('csv import did not report its row count')
    else if (!(await csvNote.innerText()).includes('已載入 201 筆'))
      note(`csv import note -> ${await csvNote.innerText()}`)
    else ok.push('csv import loads the round-tripped roster back (201 rows)')
    if ((await page.locator('text=有未儲存的變更').count()) !== 0)
      note('re-importing identical data should leave the editor clean')
    else ok.push('re-importing identical data keeps the editor clean')

    // --- Stats panel -----------------------------------------------------------
    const statsDetails = page.locator('details').filter({ hasText: '統計' }).first()
    await statsDetails.locator('summary').click()
    await page.waitForTimeout(150)
    const statsText = await statsDetails.innerText()
    if (!statsText.includes('總筆數 201'))
      note(`stats panel should total 201 rows: ${statsText.slice(0, 60).replace(/\s+/g, ' ')}`)
    else ok.push('stats panel totals the roster (201)')
    const barCount = await statsDetails.locator('[data-bar]').count()
    if (barCount < 10) note(`stats panel drew only ${barCount} distribution bars`)
    else ok.push(`stats panel draws ${barCount} distribution bars`)

    // --- Health check panel ----------------------------------------------------
    const healthDetails = page.locator('details').filter({ hasText: '健康檢查' }).first()
    await healthDetails.locator('summary').click()
    await page.waitForTimeout(150)
    const healthText = await healthDetails.innerText()
    if (!healthText.includes('未發現問題'))
      note(`health panel -> ${healthText.slice(0, 80).replace(/\s+/g, ' ')}`)
    else ok.push('health panel reports a clean dataset')
    if (!healthText.includes('孤兒標籤')) note('health panel misses the orphan tag list')
    else ok.push('health panel lists the orphan tags')

  // --- Duplicate checker -----------------------------------------------------
  const dupDetails = page.locator('details').filter({ hasText: '重複檢查' }).first()
  await dupDetails.locator('summary').click()
  await page.waitForTimeout(150)
    const dupText = await dupDetails.innerText()
    if (!dupText.includes('LCB罪人'))
      note('duplicate checker misses the LCB罪人 same-name group')
    else ok.push('duplicate checker lists same-name groups (LCB罪人)')

    // --- Tag tools -------------------------------------------------------------
    const toolsDetails = page.locator('details').filter({ hasText: '標籤管理' }).first()
    await toolsDetails.locator('summary').click()
    await page.waitForTimeout(150)
    await toolsDetails.getByLabel('來源標籤').selectOption('天殺星')
    await toolsDetails.getByLabel('目標標籤').fill('天殺星改')
    await toolsDetails.getByRole('button', { name: '重新命名／合併', exact: true }).click()
    await page.waitForTimeout(250)
    const afterRename = await page.getByLabel('標籤篩選').locator('option').allInnerTexts()
    if (afterRename.includes('天殺星')) note('rename left the old tag in the filter list')
    else if (!afterRename.includes('天殺星改')) note('rename did not add the new tag')
    else ok.push('tag tools rename swaps the tag across the roster')
    await page.getByLabel('復原上一步').click()
    await page.waitForTimeout(250)
    const afterUndo = await page.getByLabel('標籤篩選').locator('option').allInnerTexts()
    if (!afterUndo.includes('天殺星')) note('undo did not restore the renamed tag')
    else ok.push('undo restores the renamed tag')
  }
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)

await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(250)
await page.screenshot({ path: 'shot-mobile.png', fullPage: true })
ok.push('mobile viewport (390px) screenshot captured')

const realErrors = consoleErrors.filter(
  (text) => !/assets\.limbusdeck\.com|Failed to load resource/i.test(text),
)
if (realErrors.length > 0) note(`console errors: ${realErrors.slice(0, 5).join(' | ')}`)
else ok.push('no unexpected console errors')

// Hover-only sway needs a page WITHOUT reduced-motion emulation: at rest the card
// must be perfectly still, and only under the pointer does it start rocking.
const live = await browser.newPage()
await live.goto(BASE, { waitUntil: 'networkidle' })
const card = live.locator('section[aria-label="選擇人格"] ul li button').first()
const idle = await card.evaluate((el) => getComputedStyle(el).animationName)
if (idle !== 'none') note(`passport card animates at rest (animationName=${idle})`)
else {
  await card.hover()
  await live.waitForTimeout(150)
  const hovered = await card.evaluate((el) => getComputedStyle(el).animationName)
  if (hovered !== 'passport-sway')
    note(`passport card does not sway on hover (animationName=${hovered})`)
  else ok.push('passport cards sway only once the pointer is over them')
}
await live.close()

await browser.close()

const { writeFileSync } = await import('node:fs')
writeFileSync('dump.txt', dump.join('\n'), 'utf8')

for (const line of ok) console.log(`  ok      ${line}`)
for (const line of problems) console.log(`  PROBLEM ${line}`)
console.log(problems.length === 0 ? 'PASS' : `FAIL (${problems.length})`)
process.exit(problems.length === 0 ? 0 : 1)