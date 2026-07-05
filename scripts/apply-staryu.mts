/**
 * One-off: port Staryu's LeafGreen availability into this FireRed (Kanto only).
 *   Routes 19/20/21 (areas 105/106/107/108) fish slot 6 (40% Super Rod):
 *     duplicate HORSEA → STARYU Lv15–25 (Horsea keeps slot 5 everywhere)
 *   Pallet/Vermilion/Cinnabar (areas 113/116/119) fish slot 7 (15% Super Rod):
 *     GYARADOS → STARYU Lv15–25 (Shellder's exclusive slot 6 untouched)
 * Backs up the ROM first; verifies every edit after writing.
 * Run: npx tsx scripts/apply-staryu.mts
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

const staryu = loaded.species.find((s) => s.name === 'STARYU')
if (!staryu) throw new Error('STARYU not found in this ROM')
const STARYU: WildSlot = { low: 15, high: 25, species: staryu.id }

function edit(
  area: number,
  kind: WildKind,
  expectName: string,
  slot: number,
  expectOccupant: string,
): [string, WildGroupEdit] {
  const a = loaded.wildAreas[area]
  if (a.name !== expectName) throw new Error(`Area #${area} is ${a.name}, expected ${expectName}`)
  const group = a.groups[kind]
  if (!group) throw new Error(`${expectName} has no ${kind} group`)
  const slots = group.slots.map((s) => ({ ...s }))
  const cur = loaded.species[slots[slot].species].name
  if (cur !== expectOccupant) {
    throw new Error(`${expectName} ${kind} slot ${slot} holds ${cur}, expected ${expectOccupant} — aborting`)
  }
  slots[slot] = { ...STARYU }
  return [wildKey(area, kind), { rate: group.rate, slots }]
}

const wild = new Map<string, WildGroupEdit>([
  edit(105, 'fish', 'ROUTE 19', 6, 'HORSEA'),
  edit(106, 'fish', 'ROUTE 20', 6, 'HORSEA'),
  edit(107, 'fish', 'ROUTE 21', 6, 'HORSEA'),
  edit(108, 'fish', 'ROUTE 21', 6, 'HORSEA'),
  edit(113, 'fish', 'PALLET TOWN', 7, 'GYARADOS'),
  edit(116, 'fish', 'VERMILION CITY', 7, 'GYARADOS'),
  edit(119, 'fish', 'CINNABAR ISLAND', 7, 'GYARADOS'),
])

const { bytes: out, ops } = applyRomEdits(loaded.rom, loaded.anchors, { wild })

// Independent post-check on a fresh parse of the output.
const check = loadRom(out, 'check.gba', toml)
for (const [area, slot] of [
  [105, 6], [106, 6], [107, 6], [108, 6], [113, 7], [116, 7], [119, 7],
] as const) {
  const s = check.wildAreas[area].groups.fish!.slots[slot]
  if (s.species !== staryu.id || s.low !== 15 || s.high !== 25) {
    throw new Error(`Post-check failed: area ${area} fish slot ${slot} = ${JSON.stringify(s)}`)
  }
}
// Horsea must still hold slot 5 on the routes; Shellder must be untouched at slot 6.
for (const area of [105, 106, 107, 108]) {
  if (check.species[check.wildAreas[area].groups.fish!.slots[5].species].name !== 'HORSEA') {
    throw new Error(`Post-check failed: area ${area} lost its slot-5 HORSEA`)
  }
}
for (const area of [113, 116, 119]) {
  if (check.species[check.wildAreas[area].groups.fish!.slots[6].species].name !== 'SHELLDER') {
    throw new Error(`Post-check failed: area ${area} SHELLDER slot disturbed`)
  }
}
if (check.warnings.length > 0) throw new Error('Output ROM has warnings — aborting')

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = `${DIR}/20260426__GPT_Mods.pre-staryu-${stamp}.gba`
fs.copyFileSync(ROM_PATH, backupPath)
fs.writeFileSync(ROM_PATH, out)

console.log(`✅ ${ops.length} fishing tables written (${diff} bytes changed in a 16MB ROM)`)
console.log(`   STARYU #${staryu.id} Lv15–25 Super Rod:`)
console.log('   40% — Route 19, Route 20, Route 21 (both halves)')
console.log('   15% — Pallet Town, Vermilion City, Cinnabar Island')
console.log(`   backup: ${backupPath}`)
