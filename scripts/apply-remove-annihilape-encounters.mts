/**
 * Faithfulness fix: Annihilape (Gen 9) still occupies wild-encounter slots in
 * the ROM's Mt. Silver grass tables — a post-Gen-4 leftover the guide already
 * excludes. Replace every Annihilape encounter slot with DONPHAN, a Gen-2
 * Ground-type that fits Mt. Silver's heavy-hitter roster (and is already in the
 * guide's Mt. Silver grass list). Levels are preserved.
 *
 *   npx tsx scripts/apply-remove-annihilape-encounters.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-remove-annihilape-encounters.mts --dry-run "<rom.gba>" [toml]
 *
 * Backs up, writes via the wild-table editor, and re-parses to assert no
 * Annihilape encounter slot remains. BPEE needs no toml.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { applyRomEdits } from '../src/rom/writer'
import { wildKey, type WildGroupEdit } from '../src/rom/tables/wild'

const REPLACEMENT = 'DONPHAN'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) { console.error('usage: npx tsx scripts/apply-remove-annihilape-encounters.mts [--dry-run] "<rom.gba>" [toml]'); process.exit(2) }

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)

const sp = (id: number) => loaded.species[id]?.name ?? `#${id}`
const annId = loaded.species.findIndex((s) => s.name === 'ANNIHILAPE')
const repId = loaded.species.findIndex((s) => s.name === REPLACEMENT)
if (annId < 0) { console.log('No ANNIHILAPE species in this ROM — nothing to do.'); process.exit(0) }
if (repId < 0) throw new Error(`Replacement ${REPLACEMENT} not found in ROM`)

const wild = new Map<string, WildGroupEdit>()
const changes: string[] = []
for (const a of loaded.wildAreas) {
  for (const kind of ['grass', 'surf', 'fish', 'tree'] as const) {
    const g = a.groups[kind]
    if (!g || !g.slots.some((s) => s.species === annId)) continue
    const slots = g.slots.map((s) => (s.species === annId ? { ...s, species: repId } : { ...s }))
    wild.set(wildKey(a.index, kind), { rate: g.rate, slots })
    const n = g.slots.filter((s) => s.species === annId).length
    changes.push(`  [${a.index}] ${a.name} ${kind} — ${n}× Annihilape → ${REPLACEMENT}`)
  }
}

console.log(`ROM: ${romName} (${loaded.rom.gameCode()})`)
console.log(`Annihilape encounter slots to replace: ${changes.length} table(s)`)
changes.forEach((l) => console.log(l))

if (dryRun) { console.log('\n--dry-run: no changes written.'); process.exit(0) }
if (!wild.size) process.exit(0)

const { bytes: out } = applyRomEdits(loaded.rom, loaded.anchors, { wild })
const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length) throw new Error(`Output warnings: ${check.warnings.join('; ')}`)
let remaining = 0
for (const a of check.wildAreas) for (const kind of ['grass', 'surf', 'fish', 'tree'] as const) {
  const g = a.groups[kind]; if (g) for (const s of g.slots) if (s.species === annId) remaining++
}
if (remaining) throw new Error(`Post-check failed: ${remaining} Annihilape slots remain`)

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backup = romPath.replace(/\.gba$/i, '') + `.pre-annihilape-${stamp}.gba`
fs.copyFileSync(romPath, backup)
fs.writeFileSync(romPath, out)
console.log(`\n✅ replaced all Annihilape encounter slots with ${REPLACEMENT} (${diff} bytes changed).`)
console.log(`   backup: ${backup.split(/[\\/]/).pop()}`)
void sp
