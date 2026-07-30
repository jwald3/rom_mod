/**
 * Apply the poke-emerald-legacy move EFFECT changes that were deferred by
 * apply-legacy-moves.mts (which only did power/accuracy/PP/type). These edit the
 * move-stats struct's effect id (offset 0) and effect-chance (offset 5, "effAcc").
 *
 *   npx tsx scripts/apply-legacy-move-effects.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-legacy-move-effects.mts --dry-run "<rom.gba>" [toml]
 *
 * Effect ids were decoded empirically from this ROM by cross-referencing moves
 * with known secondary effects (Bubble/Rock Tomb = 70 lower-Speed, Crush Claw =
 * 69 lower-Def, Aurora Beam = 68 lower-Atk, Headbutt/Rock Slide = 31 flinch,
 * Water Pulse = 76 confuse, Metal Claw = 139 raise-user-Atk). Each planned change
 * asserts the move's CURRENT effect matches an expected value before writing, so
 * a wrong assumption fails loudly instead of corrupting a move. Backup + verify.
 *
 * NOT applied (structural reworks that need engine/flag changes, not struct
 * bytes): Stockpile persistence, Sky Attack no-charge, Hail/Sandstorm typed chip
 * damage, and Blaze Kick's burn-or-flinch (already a custom effect). Leaf Blade
 * is already high-crit (effect 43), so it needs no change.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { MOVE_STATS_LEN } from '../src/rom/anchors'

// Decoded effect enum (verified against reference moves in this ROM).
const EFF = { LOWER_ATK: 68, LOWER_DEF: 69, LOWER_SPE: 70, RAISE_USER_ATK: 139, FLINCH: 31, CONFUSE: 76 }

/**
 * name → { expect: current effect id(s) we require before touching it,
 *          effect?: new effect id, effAcc?: new effect chance % }
 * `expect` guards against silently corrupting a move whose data differs from
 * what we decoded. A move that fails its guard is reported and left untouched.
 */
const PLAN: { name: string; expect: number[]; effect?: number; effAcc?: number; note: string }[] = [
  { name: 'Constrict',   expect: [EFF.LOWER_SPE],  effAcc: 30, note: '30% lower Speed' },
  { name: 'Vicegrip',    expect: [0],              effect: EFF.LOWER_ATK, effAcc: 20, note: '20% lower Attack' },
  { name: 'Muddy Water', expect: [73, EFF.LOWER_SPE], effect: EFF.LOWER_SPE, effAcc: 50, note: '50% lower Speed' },
  { name: 'Waterfall',   expect: [0],              effect: EFF.FLINCH, effAcc: 30, note: '30% flinch' },
  { name: 'Rock Smash',  expect: [EFF.LOWER_DEF],  effAcc: 20, note: '20% lower Defense' },
  { name: 'Iron Tail',   expect: [EFF.LOWER_DEF],  effAcc: 20, note: '20% lower Defense' },
  { name: 'Metal Claw',  expect: [EFF.RAISE_USER_ATK], effAcc: 20, note: '20% raise Attack' },
  { name: 'Hyper Voice', expect: [0],              effect: EFF.CONFUSE, effAcc: 30, note: '30% confusion' },
]

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) {
  console.error('usage: npx tsx scripts/apply-legacy-move-effects.mts [--dry-run] "<rom.gba>" [toml]')
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

for (const p of PLAN) {
  const id = idByMove.get(norm(p.name))
  if (id === undefined) { skipped.push(`${p.name} (not in ROM)`); continue }
  const base = a.moveStats + id * MOVE_STATS_LEN
  const curEffect = bytes[base + O_EFFECT]
  const curAcc = bytes[base + O_EFFACC]
  if (!p.expect.includes(curEffect)) {
    skipped.push(`${p.name} (current effect ${curEffect} not in expected [${p.expect.join(',')}] — guard tripped)`)
    continue
  }
  const parts: string[] = []
  if (p.effect !== undefined && curEffect !== p.effect) { out[base + O_EFFECT] = p.effect; parts.push(`effect ${curEffect}→${p.effect}`) }
  if (p.effAcc !== undefined && curAcc !== p.effAcc) { out[base + O_EFFACC] = p.effAcc; parts.push(`chance ${curAcc}%→${p.effAcc}%`) }
  if (!parts.length) continue
  writes++
  changes.push(`${p.name.padEnd(12)} ${parts.join('  ')}   [${p.note}]`)
}

console.log(`ROM: ${romName}  (${loaded.rom.gameCode()}, anchors ${loaded.anchorSource})`)
console.log(`move-effect changes: ${writes}`)
console.log()
changes.forEach((l) => console.log('  ' + l))
if (skipped.length) { console.log('\n  skipped:'); skipped.forEach((l) => console.log('    ' + l)) }
console.log('\n  not attempted (structural reworks): Stockpile, Sky Attack, Hail, Sandstorm, Blaze Kick; Leaf Blade already high-crit.')

if (dryRun) { console.log('\n--dry-run: no changes written.'); process.exit(0) }
if (writes === 0) { console.log('\nNothing to change.'); process.exit(0) }

// Re-read verify.
const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length > 0) throw new Error(`Output ROM has warnings: ${check.warnings.join('; ')}`)
for (const p of PLAN) {
  const id = idByMove.get(norm(p.name))
  if (id === undefined) continue
  const base = a.moveStats + id * MOVE_STATS_LEN
  if (!p.expect.includes(bytes[base + O_EFFECT])) continue // was skipped
  if (p.effect !== undefined && out[base + O_EFFECT] !== p.effect) throw new Error(`Post-check effect ${p.name}`)
  if (p.effAcc !== undefined && out[base + O_EFFACC] !== p.effAcc) throw new Error(`Post-check chance ${p.name}`)
}

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = romPath.replace(/\.gba$/i, '') + `.pre-move-effects-${stamp}.gba`
fs.copyFileSync(romPath, backupPath)
fs.writeFileSync(romPath, out)

console.log(`\n✅ ${writes} move effects updated (${diff} bytes changed).`)
console.log(`   backup: ${backupPath.split(/[\\/]/).pop()}`)
