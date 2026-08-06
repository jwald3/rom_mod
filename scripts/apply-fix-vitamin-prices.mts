/**
 * Bugfix: the six stat vitamins are priced at ₽1350 in this build — an odd value
 * that's neither the mainline price nor a clean number. Set them to the standard
 * ₽9800 (the game derives the sell price as buy/2 = ₽4900). Only the price u16
 * changes; every other item field is untouched, and PP Up / PP Max are left as-is.
 *
 *   npx tsx scripts/apply-fix-vitamin-prices.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-fix-vitamin-prices.mts --dry-run "<rom.gba>" [toml]
 *
 * Backs up, patches in place, re-parses to assert each vitamin now reads ₽9800.
 * BPEE needs no toml.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'

const ITEM_STRUCT_LEN = 44
const OFF_PRICE = 0x10 // u16
const VANILLA_PRICE = 9800
const VITAMINS = ['HP UP', 'PROTEIN', 'IRON', 'CARBOS', 'CALCIUM', 'ZINC']

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) { console.error('usage: npx tsx scripts/apply-fix-vitamin-prices.mts [--dry-run] "<rom.gba>" [toml]'); process.exit(2) }

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)

const rom = loaded.rom
const itemsBase = (loaded.anchors as any).items as number
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const itemId = (name: string) => loaded.itemNames.findIndex((n) => n && norm(n) === norm(name))
const priceOff = (id: number) => itemsBase + id * ITEM_STRUCT_LEN + OFF_PRICE

console.log(`ROM: ${romName} (${loaded.rom.gameCode()})\n`)
const toFix: number[] = []
for (const name of VITAMINS) {
  const id = itemId(name)
  if (id < 0) { console.log(`  ${name}: NOT FOUND — skipping`); continue }
  const cur = rom.u16(priceOff(id))
  if (cur === VANILLA_PRICE) { console.log(`  ${name.padEnd(10)} already ₽${VANILLA_PRICE}`); continue }
  toFix.push(id)
  console.log(`  ${name.padEnd(10)} ₽${cur} → ₽${VANILLA_PRICE} (sell ₽${VANILLA_PRICE / 2})`)
}

console.log(`\n${toFix.length} vitamin price(s) to fix.`)
if (dryRun) { console.log('\n--dry-run: no changes written.'); process.exit(0) }
if (!toFix.length) { console.log('All vitamins already priced correctly — nothing to do.'); process.exit(0) }

const out = bytes.slice()
const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
for (const id of toFix) view.setUint16(priceOff(id), VANILLA_PRICE, true)

// verify
const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length) throw new Error(`Output warnings: ${check.warnings.join('; ')}`)
let bad = 0
for (const name of VITAMINS) { const id = itemId(name); if (id >= 0 && check.rom.u16(priceOff(id)) !== VANILLA_PRICE) bad++ }
if (bad) throw new Error(`Post-check failed: ${bad} vitamin(s) not at ₽${VANILLA_PRICE}`)

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backup = romPath.replace(/\.gba$/i, '') + `.pre-vitamin-prices-${stamp}.gba`
fs.copyFileSync(romPath, backup)
fs.writeFileSync(romPath, out)
console.log(`\n✅ vitamins now buy for ₽${VANILLA_PRICE} / sell for ₽${VANILLA_PRICE / 2} (${diff} bytes changed).`)
console.log(`   backup: ${backup.split(/[\\/]/).pop()}`)
