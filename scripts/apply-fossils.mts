/**
 * One-off: give Kabuto and Omanyte wild locations.
 *   Mt. Moon B2F (area 10) grass slots 8/9  → KABUTO / OMANYTE Lv8–10 (4% each)
 *   Sevault Canyon (area 85) rock smash s3  → KABUTO Lv30–40 (4%)
 *   Seafoam B3F/B4F (areas 32/33) surf s3   → OMANYTE Lv30–40 (4%)
 * Backs up the ROM first; verifies every edit after writing.
 * Run: npx tsx scripts/apply-fossils.mts
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { applyRomEdits } from '../src/rom/writer'
import { wildKey, type WildGroupEdit, type WildKind, type WildSlot } from '../src/rom/tables/wild'

const DIR = 'C:/Users/Waldo/Downloads/Pokemon - Fire Red Version [a1] (U) (Squirrels) (2)'
const ROM_PATH = `${DIR}/20260426__GPT_Mods.gba`
const TOML_PATH = `${DIR}/20260426__GPT_Mods.toml`

const bytes = new Uint8Array(fs.readFileSync(ROM_PATH))
const toml = fs.readFileSync(TOML_PATH, 'utf8')
const loaded = loadRom(bytes, 'GPT_Mods.gba', toml)
if (loaded.warnings.length > 0) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)

const idOf = (name: string): number => {
  const s = loaded.species.find((x) => x.name === name)
  if (!s) throw new Error(`Species ${name} not found in this ROM`)
  return s.id
}
const KABUTO = idOf('KABUTO')
const OMANYTE = idOf('OMANYTE')

/** Build one edited group, asserting the area and current occupant first. */
function edit(
  area: number,
  kind: WildKind,
  expectName: string,
  changes: Array<{ slot: number; expect: string; next: WildSlot }>,
): [string, WildGroupEdit] {
  const a = loaded.wildAreas[area]
  if (a.name !== expectName) throw new Error(`Area #${area} is ${a.name}, expected ${expectName}`)
  const group = a.groups[kind]
  if (!group) throw new Error(`${expectName} has no ${kind} group`)
  const slots = group.slots.map((s) => ({ ...s }))
  for (const c of changes) {
    const cur = loaded.species[slots[c.slot].species].name
    if (cur !== c.expect) {
      throw new Error(`${expectName} ${kind} slot ${c.slot} holds ${cur}, expected ${c.expect} — aborting`)
    }
    slots[c.slot] = c.next
  }
  return [wildKey(area, kind), { rate: group.rate, slots }]
}

const wild = new Map<string, WildGroupEdit>([
  edit(10, 'grass', 'MT. MOON', [
    { slot: 8, expect: 'ZUBAT', next: { low: 8, high: 10, species: KABUTO } },
    { slot: 9, expect: 'ZUBAT', next: { low: 8, high: 10, species: OMANYTE } },
  ]),
  edit(85, 'tree', 'SEVAULT CANYON', [
    { slot: 3, expect: 'GEODUDE', next: { low: 30, high: 40, species: KABUTO } },
  ]),
  edit(32, 'surf', 'SEAFOAM ISLANDS', [
    { slot: 3, expect: 'PSYDUCK', next: { low: 30, high: 40, species: OMANYTE } },
  ]),
  edit(33, 'surf', 'SEAFOAM ISLANDS', [
    { slot: 3, expect: 'PSYDUCK', next: { low: 30, high: 40, species: OMANYTE } },
  ]),
])

const { bytes: out, ops } = applyRomEdits(loaded.rom, loaded.anchors, { wild })

// Independent post-check: fresh parse of the output bytes.
const check = loadRom(out, 'check.gba', toml)
const expectSlot = (area: number, kind: WildKind, slot: number, species: number, low: number, high: number) => {
  const s = check.wildAreas[area].groups[kind]!.slots[slot]
  if (s.species !== species || s.low !== low || s.high !== high) {
    throw new Error(`Post-check failed: area ${area} ${kind} slot ${slot} = ${JSON.stringify(s)}`)
  }
}
expectSlot(10, 'grass', 8, KABUTO, 8, 10)
expectSlot(10, 'grass', 9, OMANYTE, 8, 10)
expectSlot(85, 'tree', 3, KABUTO, 30, 40)
expectSlot(32, 'surf', 3, OMANYTE, 30, 40)
expectSlot(33, 'surf', 3, OMANYTE, 30, 40)
if (check.warnings.length > 0) throw new Error('Output ROM has warnings — aborting')

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++

// All checks passed — back up, then write.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = `${DIR}/20260426__GPT_Mods.pre-fossils-${stamp}.gba`
fs.copyFileSync(ROM_PATH, backupPath)
fs.writeFileSync(ROM_PATH, out)

console.log(`✅ ${ops.length} wild groups written (${diff} bytes changed in a 16MB ROM)`)
console.log(`   KABUTO  #${KABUTO}: Mt. Moon B2F grass 4% Lv8–10 · Sevault Canyon rock smash 4% Lv30–40`)
console.log(`   OMANYTE #${OMANYTE}: Mt. Moon B2F grass 4% Lv8–10 · Seafoam B3F+B4F surf 4% Lv30–40`)
console.log(`   backup: ${backupPath}`)
