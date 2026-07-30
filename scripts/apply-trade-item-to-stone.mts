/**
 * Convert every "trade while holding an item" evolution into a "use item"
 * (stone-style) evolution, in place. After this, e.g. using a Metal Coat on
 * Onix evolves it into Steelix directly — no trade required. The held item is
 * kept as the trigger item, so each species evolves from the same item it used
 * to need on a trade.
 *
 *   npx tsx scripts/apply-trade-item-to-stone.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-trade-item-to-stone.mts --dry-run "<rom.gba>" [toml]
 *
 * Method map (see src/rom/tables/evolutions.ts):
 *   6  "Trade holding item"  (vanilla FireRed/Emerald)   → 7 "Use item (stone)"
 *   26 "Trade / held item"   (pokeemerald-expansion / H&S) → 7 "Use item (stone)"
 * Param (the item id) is preserved unchanged. Plain trade (method 5, no item)
 * is intentionally left alone — there is no item to key a stone evolution on.
 *
 * Backs up the ROM first, writes, then re-parses the output and asserts every
 * converted entry now reads method 7 with the same item/target, and that no
 * method-6/26 entries remain. Emerald/H&S (BPEE) uses its built-in profile, so
 * the toml is optional; FireRed mods should pass their toml.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { applyRomEdits } from '../src/rom/writer'
import { readAllEvolutions, type Evolution } from '../src/rom/tables/evolutions'

const TRADE_ITEM_METHODS = new Set([6, 26])
const USE_ITEM_METHOD = 7

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) {
  console.error('usage: npx tsx scripts/apply-trade-item-to-stone.mts [--dry-run] "<rom.gba>" [toml]')
  process.exit(2)
}

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length > 0) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)

const sp = (id: number) => loaded.species[id]?.name ?? `#${id}`
const item = (id: number) => loaded.itemNames[id] ?? `item#${id}`

// Build per-species edits: copy each species' evo list, flip trade-with-item to
// use-item. Only species that actually change get an entry.
const all = readAllEvolutions(loaded.rom, loaded.anchors)
const evolutions = new Map<number, Evolution[]>()
const changes: { species: number; target: number; itemId: number; from: number }[] = []

all.forEach((evos, species) => {
  let touched = false
  const next = evos.map((e) => {
    if (TRADE_ITEM_METHODS.has(e.method)) {
      touched = true
      changes.push({ species, target: e.target, itemId: e.param, from: e.method })
      return { method: USE_ITEM_METHOD, param: e.param, target: e.target }
    }
    return e
  })
  if (touched) evolutions.set(species, next)
})

console.log(`ROM: ${romName}  (${loaded.rom.gameCode()}, anchors ${loaded.anchorSource})`)
if (changes.length === 0) {
  console.log('No trade-with-item (method 6/26) evolutions found — nothing to do.')
  process.exit(0)
}
console.log(`\n${changes.length} evolution${changes.length > 1 ? 's' : ''} to convert (method → 7 "Use item"):`)
for (const c of changes) {
  console.log(`  ${sp(c.species).padEnd(12)} → ${sp(c.target).padEnd(12)}  use ${item(c.itemId)}  (was method ${c.from})`)
}

if (dryRun) {
  console.log('\n--dry-run: no changes written.')
  process.exit(0)
}

const { bytes: out, ops } = applyRomEdits(loaded.rom, loaded.anchors, { evolutions })

// Independent re-parse of the output: every converted entry must now be method
// 7 with the same item+target, and NO method-6/26 entries may remain anywhere.
const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length > 0) throw new Error(`Output ROM has warnings: ${check.warnings.join('; ')}`)
const checkAll = readAllEvolutions(check.rom, check.anchors)
for (const c of changes) {
  const got = checkAll[c.species].find((e) => e.target === c.target)
  if (!got || got.method !== USE_ITEM_METHOD || got.param !== c.itemId) {
    throw new Error(
      `Post-check failed: ${sp(c.species)} → ${sp(c.target)} is ${JSON.stringify(got)}, expected method 7 item ${c.itemId}`,
    )
  }
}
let leftover = 0
checkAll.forEach((evos) => evos.forEach((e) => { if (TRADE_ITEM_METHODS.has(e.method)) leftover++ }))
if (leftover > 0) throw new Error(`Post-check failed: ${leftover} trade-with-item evolutions still present`)

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = romPath.replace(/\.gba$/i, '') + `.pre-stone-evos-${stamp}.gba`
fs.copyFileSync(romPath, backupPath)
fs.writeFileSync(romPath, out)

console.log(`\n✅ ${changes.length} evolutions converted across ${ops.length} write op(s) (${diff} bytes changed).`)
console.log(`   backup: ${backupPath.split(/[\\/]/).pop()}`)
