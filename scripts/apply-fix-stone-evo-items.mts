/**
 * Bugfix: the trade-with-item evolutions were converted to "use item" (method 7)
 * evolutions (see apply-trade-item-to-stone.mts), but the trigger items were
 * never made *usable from the bag*. Selecting "Use" on King's Rock, Metal Coat,
 * etc. gives "This isn't the time to use that!" because their item struct still
 * has the non-field-usable type + the reject field-use function.
 *
 * A working evolution stone (Fire Stone) has:
 *   type (+0x1B)         = 1              (bag-usable on a Pokémon)
 *   fieldUseFunc (+0x1C) = 0x08137209    (the evolution-stone field routine)
 *
 * Every item that a method-7 evolution triggers but that doesn't already match
 * those two fields is patched to them, so "Use" evolves the holder like a stone.
 * Nothing else in the struct changes (name, price, pocket, hold effect, etc.).
 *
 *   npx tsx scripts/apply-fix-stone-evo-items.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-fix-stone-evo-items.mts --dry-run "<rom.gba>" [toml]
 *
 * Backs up, patches in place, re-parses to assert every method-7 trigger item
 * now has the stone field-use function. BPEE needs no toml.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { readEvolutionsFor } from '../src/rom/tables/evolutions'

const ITEM_STRUCT_LEN = 44
const OFF_TYPE = 0x1b // u8  — item-use type (1 = bag-usable on a Pokémon)
const OFF_FIELD_FN = 0x1c // u32 — field-use function pointer

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) { console.error('usage: npx tsx scripts/apply-fix-stone-evo-items.mts [--dry-run] "<rom.gba>" [toml]'); process.exit(2) }

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)

const rom = loaded.rom
const itemsBase = (loaded.anchors as any).items as number
const itemOff = (id: number) => itemsBase + id * ITEM_STRUCT_LEN

// Reference values from a known-working stone.
const fireStone = loaded.itemNames.findIndex((n) => n && n.toUpperCase() === 'FIRE STONE')
if (fireStone < 0) throw new Error('FIRE STONE not found — cannot source the working field-use function')
const GOOD_TYPE = rom.u8(itemOff(fireStone) + OFF_TYPE)
const GOOD_FIELD_FN = rom.u32(itemOff(fireStone) + OFF_FIELD_FN)
console.log(`ROM: ${romName} (${loaded.rom.gameCode()})`)
console.log(`Working stone (Fire Stone): type=${GOOD_TYPE}, fieldUseFunc=0x${GOOD_FIELD_FN.toString(16)}\n`)

// Items that trigger a "use item" (method 7) evolution.
const evoItems = new Set<number>()
for (let s = 0; s < loaded.species.length; s++)
  for (const e of readEvolutionsFor(rom, loaded.anchors, s))
    if (e.method === 7 && e.param > 0) evoItems.add(e.param)

// Which of those aren't already field-usable like a stone?
const toFix: number[] = []
for (const id of [...evoItems].sort((a, b) => a - b)) {
  const type = rom.u8(itemOff(id) + OFF_TYPE)
  const fn = rom.u32(itemOff(id) + OFF_FIELD_FN)
  if (type !== GOOD_TYPE || fn !== GOOD_FIELD_FN) {
    toFix.push(id)
    console.log(`  ${loaded.itemNames[id].padEnd(14)} type ${type}→${GOOD_TYPE}, fieldUseFunc 0x${fn.toString(16)}→0x${GOOD_FIELD_FN.toString(16)}`)
  }
}

console.log(`\n${toFix.length} evolution item(s) need the stone field-use fix.`)
if (dryRun) { console.log('\n--dry-run: no changes written.'); process.exit(0) }
if (!toFix.length) { console.log('All evolution items already usable — nothing to do.'); process.exit(0) }

const out = bytes.slice()
const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
for (const id of toFix) {
  out[itemOff(id) + OFF_TYPE] = GOOD_TYPE
  view.setUint32(itemOff(id) + OFF_FIELD_FN, GOOD_FIELD_FN, true)
}

// verify
const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length) throw new Error(`Output warnings: ${check.warnings.join('; ')}`)
let bad = 0
for (const id of evoItems) {
  if (check.rom.u8(itemOff(id) + OFF_TYPE) !== GOOD_TYPE || check.rom.u32(itemOff(id) + OFF_FIELD_FN) !== GOOD_FIELD_FN) bad++
}
if (bad) throw new Error(`Post-check failed: ${bad} evolution item(s) still not field-usable`)

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backup = romPath.replace(/\.gba$/i, '') + `.pre-stone-evo-items-${stamp}.gba`
fs.copyFileSync(romPath, backup)
fs.writeFileSync(romPath, out)
console.log(`\n✅ ${toFix.length} evolution items now usable from the bag like a stone (${diff} bytes changed).`)
console.log(`   backup: ${backup.split(/[\\/]/).pop()}`)
