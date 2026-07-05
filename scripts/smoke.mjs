// Headless smoke test: drives the dev server in system Edge via playwright-core.
// Usage: node scripts/smoke.mjs  (dev server must be running on :5173)
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const ROM_DIR = 'C:/Users/Waldo/Downloads/Pokemon - Fire Red Version [a1] (U) (Squirrels) (2)'
const ROM = `${ROM_DIR}/20260426__GPT_Mods.gba`
const TOML = `${ROM_DIR}/20260426__GPT_Mods.toml`
const OUT = 'smoke'

mkdirSync(OUT, { recursive: true })
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`📸 ${OUT}/${name}.png`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

try {
  await page.goto('http://localhost:5173/')
  await page.waitForSelector('text=FireRed Moveset Editor')
  await shot(page, '01-open-screen')

  // Load ROM + toml through the hidden file input (same path as the picker).
  await page.setInputFiles('input[type=file]', [ROM, TOML])
  await page.waitForSelector('h2:has-text("BULBASAUR")')
  await shot(page, '02-bulbasaur-loaded')

  // Search and jump to Charizard.
  await page.fill('#species-search', 'chariz')
  await page.click('aside button:has-text("CHARIZARD")')
  await page.waitForSelector('h2:has-text("CHARIZARD")')
  await shot(page, '03-charizard')

  // TM/HM tab.
  await page.click('nav button:has-text("TM/HM")')
  await page.waitForSelector('text=learnable')
  await shot(page, '04-tm-grid')

  // Back to level-up; add THUNDERBOLT via the fuzzy picker.
  await page.click('nav button:has-text("Level-up")')
  await page.click('button:has-text("Add move")')
  await page.fill('input[placeholder^="Search moves"]', 'thbolt')
  await page.waitForSelector('li button:has-text("THUNDERBOLT")')
  await page.keyboard.press('Enter')
  await page.waitForSelector('text=● modified')
  await shot(page, '05-edited-dirty')

  // Undo — dirty badge must clear.
  await page.keyboard.press('Control+z')
  await page.waitForSelector('text=● modified', { state: 'detached' })
  await page.waitForSelector('text=No changes')
  await shot(page, '06-undone-clean')

  // Maps view: Viridian Forest wild encounters.
  await page.click('aside button:has-text("Maps")')
  await page.fill('#map-search', 'viridian')
  await page.click('aside button:has-text("VIRIDIAN FOREST")')
  await page.waitForSelector('h2:has-text("VIRIDIAN FOREST")')
  await page.waitForSelector('text=Grass')
  await shot(page, '07-wild-viridian')

  // Swap the first grass slot to MEW via the species picker.
  await page.click('main section tbody tr:first-child td:nth-child(2) button')
  await page.fill('input[placeholder^="Search species"]', 'mew')
  await page.waitForSelector('li button:has-text("MEW")')
  await page.keyboard.press('Enter')
  await page.waitForSelector('text=● modified')
  await page.waitForSelector('text=1 area modified')
  await shot(page, '08-wild-edited')

  // Reverse lookup: Pokémon view → MEW → Locations tab shows Viridian Forest.
  await page.click('aside button:has-text("Pokémon")')
  await page.fill('#species-search', '151') // exact id — plain "mew" also matches MEWTWO
  await page.click('aside button:has-text("MEW")')
  await page.click('nav button:has-text("Locations")')
  await page.waitForSelector('td button:has-text("VIRIDIAN FOREST")')
  await shot(page, '09-locations-tab')

  // Undo the wild edit — should jump back to the Maps view, clean.
  await page.keyboard.press('Control+z')
  await page.waitForSelector('h2:has-text("VIRIDIAN FOREST")')
  await page.waitForSelector('text=No changes')
  await shot(page, '10-wild-undone')

  // No-wild-location filter: Charizard (never wild) stays, Pidgey (Route 1) filtered out.
  await page.click('aside button:has-text("Pokémon")')
  await page.fill('#species-search', '')
  await page.click('text=only no-wild-location')
  await page.waitForSelector('aside button:has-text("CHARIZARD")')
  await page.waitForSelector('aside button:has-text("PIDGEY")', { state: 'detached' })
  await shot(page, '11-no-wild-filter')

  // Evolution editing: bump Bulbasaur's evolution level, then undo.
  await page.click('text=only no-wild-location') // toggle filter back off
  await page.fill('#species-search', '1')
  await page.click('aside button:has-text("BULBASAUR")')
  await page.click('nav button:has-text("Evolution")')
  await page.waitForSelector('text=Evolves into')
  await page.fill('main td input[type=number]', '20')
  await page.press('main td input[type=number]', 'Enter')
  await page.waitForSelector('text=● modified')
  await shot(page, '12-evolution-edited')
  await page.keyboard.press('Control+z')
  await page.waitForSelector('text=No changes')

  if (errors.length > 0) {
    console.error('❌ console errors:\n' + errors.join('\n'))
    process.exit(1)
  }
  console.log('✅ smoke passed: load → search → tabs → fuzzy add → undo, no console errors')
} finally {
  await browser.close()
}
