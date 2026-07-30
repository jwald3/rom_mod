/**
 * Apply the two structural move reworks from poke-emerald-legacy that were
 * deferred: Sky Attack (remove the 2-turn charge) and Blaze Kick (20% burn).
 * https://mryakobo.github.io/poke-emerald-legacy-docs/
 *
 *   npx tsx scripts/apply-legacy-move-reworks.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-legacy-move-reworks.mts --dry-run "<rom.gba>" [toml]
 *
 * Both moves carry a DEDICATED effect id in this ROM (Sky Attack=75 "charge +
 * flinch + high-crit"; Blaze Kick=200 "high-crit + 10% burn"). The doc wants:
 *   Sky Attack — "no longer a 2-turn charge; chance to flinch or crit."
 *     → effect 75 → 31 (plain flinch), 30% chance. Removes the charge; keeps a
 *       flinch chance. (No non-charge "flinch+crit" combo effect exists to point
 *       at, and the doc accepts "flinch OR crit", so flinch is the clean choice.)
 *   Blaze Kick — "20% chance to burn or flinch."
 *     → effect 200 → 4 (burn), 20% chance. No burn-or-flinch combo effect exists;
 *       burn is the thematic pick for a Fire move and matches the 20% figure.
 *
 * Verified effect ids from reference moves: 31 = flinch (Headbutt/Rock Slide/Air
 * Slash), 4 = burn (Ember/Fire Punch/Flamethrower). Each write guards on the
 * move's current effect first. Backup + re-read verify.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { MOVE_STATS_LEN } from '../src/rom/anchors'

const EFF_FLINCH = 31
const EFF_BURN = 4

const REWORKS: { name: string; expectEffect: number; newEffect: number; newChance: number; note: string }[] = [
  { name: 'Sky Attack', expectEffect: 75, newEffect: EFF_FLINCH, newChance: 30, note: 'no charge; 30% flinch (was 2-turn charge)' },
  { name: 'Blaze Kick', expectEffect: 200, newEffect: EFF_BURN, newChance: 20, note: '20% burn (was high-crit + 10% burn)' },
]

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) {
  console.error('usage: npx tsx scripts/apply-legacy-move-reworks.mts [--dry-run] "<rom.gba>" [toml]')
  process.exit(2)
}

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length > 0) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)
const a = loaded.anchors

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const idByMove = new Map<string, number>()
loaded.moves.forEach((m) => { if (m.name) idByMove.set(norm(m.name), m.id) })

const out = new Uint8Array(bytes)
const O_EFFECT = 0, O_EFFACC = 5

const changes: string[] = []
const skipped: string[] = []
let writes = 0

for (const rw of REWORKS) {
  const id = idByMove.get(norm(rw.name))
  if (id === undefined) { skipped.push(`${rw.name} (not in ROM)`); continue }
  const base = a.moveStats + id * MOVE_STATS_LEN
  const curEffect = bytes[base + O_EFFECT]
  if (curEffect !== rw.expectEffect) {
    skipped.push(`${rw.name} (current effect ${curEffect} ≠ expected ${rw.expectEffect} — guard tripped)`)
    continue
  }
  out[base + O_EFFECT] = rw.newEffect
  out[base + O_EFFACC] = rw.newChance
  writes++
  changes.push(`${rw.name.padEnd(12)} effect ${curEffect}→${rw.newEffect}  chance ${bytes[base + O_EFFACC]}%→${rw.newChance}%   [${rw.note}]`)
}

console.log(`ROM: ${romName}  (${loaded.rom.gameCode()}, anchors ${loaded.anchorSource})`)
console.log(`move reworks: ${writes}`)
console.log()
changes.forEach((l) => console.log('  ' + l))
if (skipped.length) { console.log('\n  skipped:'); skipped.forEach((l) => console.log('    ' + l)) }
console.log('\n  note: Sky Attack keeps its 120 power at no charge cost — a real buff. Blaze Kick trades')
console.log('  its innate high-crit for a higher (20%) burn chance, per the doc.')

if (dryRun) { console.log('\n--dry-run: no changes written.'); process.exit(0) }
if (writes === 0) { console.log('\nNothing to change.'); process.exit(0) }

const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length > 0) throw new Error(`Output ROM has warnings: ${check.warnings.join('; ')}`)
for (const rw of REWORKS) {
  const id = idByMove.get(norm(rw.name))
  if (id === undefined || bytes[a.moveStats + id * MOVE_STATS_LEN] !== rw.expectEffect) continue
  const base = a.moveStats + id * MOVE_STATS_LEN
  if (out[base + O_EFFECT] !== rw.newEffect || out[base + O_EFFACC] !== rw.newChance) {
    throw new Error(`Post-check failed for ${rw.name}`)
  }
}

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = romPath.replace(/\.gba$/i, '') + `.pre-move-reworks-${stamp}.gba`
fs.copyFileSync(romPath, backupPath)
fs.writeFileSync(romPath, out)

console.log(`\n✅ ${writes} move reworks applied (${diff} bytes changed).`)
console.log(`   backup: ${backupPath.split(/[\\/]/).pop()}`)
