/**
 * Apply the poke-emerald-legacy move changes (power / accuracy / PP / type) to
 * the ROM. https://mryakobo.github.io/poke-emerald-legacy-docs/
 *
 *   npx tsx scripts/apply-legacy-moves.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-legacy-moves.mts --dry-run "<rom.gba>" [toml]
 *
 * Data: scripts/legacy-moves-parsed.json ({name, power, acc, pp, newType, effect}).
 * Move battle-stats struct (12 bytes), written in place at:
 *   0 effect  1 power  2 type  3 accuracy  4 pp  5 effectAcc  6 target  7 priority
 * We write power/accuracy/pp (u8) and, where the doc specifies one, type (u8 via
 * the ROM's type table). A null field means "not specified, leave as-is".
 *
 * DEFERRED (reported, not applied): the doc's move EFFECT changes (e.g. Constrict
 * "30% chance to lower Speed") and the global physical/special split notes
 * ("Ghost type now Special", "Dark now physical"). Those need the expansion's
 * effect-id / split mechanism, which we don't infer blindly. Backup + re-read verify.
 */
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadRom } from '../src/rom/loadRom'
import { MOVE_STATS_LEN } from '../src/rom/anchors'

const here = dirname(fileURLToPath(import.meta.url))

interface MoveRow { name: string; power: number | null; acc: number | null; pp: number | null; newType: string | null; effect: string }
const moves: MoveRow[] = JSON.parse(fs.readFileSync(resolve(here, 'legacy-moves-parsed.json'), 'utf8'))

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) {
  console.error('usage: npx tsx scripts/apply-legacy-moves.mts [--dry-run] "<rom.gba>" [toml]')
  process.exit(2)
}

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length > 0) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)
const a = loaded.anchors

// Normalize move names for matching: uppercase, strip non-alphanumerics.
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const idByMove = new Map<string, number>()
loaded.moves.forEach((m) => { if (m.name) idByMove.set(norm(m.name), m.id) })
const typeByName = new Map<string, number>()
loaded.typeNames.forEach((n, i) => { if (n) typeByName.set(n.toUpperCase(), i) })

const out = new Uint8Array(bytes)
const O_POWER = 1, O_TYPE = 2, O_ACC = 3, O_PP = 4

const changes: string[] = []
const missing: string[] = []
const deferred: string[] = []
let writes = 0

for (const row of moves) {
  const id = idByMove.get(norm(row.name))
  if (id === undefined) { missing.push(row.name); continue }
  const base = a.moveStats + id * MOVE_STATS_LEN
  const cur = loaded.moves[id]
  const parts: string[] = []

  if (row.power !== null && row.power >= 0 && row.power <= 255 && row.power !== cur.power) {
    parts.push(`pow ${cur.power}→${row.power}`); out[base + O_POWER] = row.power
  }
  if (row.acc !== null && row.acc >= 0 && row.acc <= 100 && row.acc !== cur.accuracy) {
    parts.push(`acc ${cur.accuracy}→${row.acc}`); out[base + O_ACC] = row.acc
  }
  if (row.pp !== null && row.pp >= 1 && row.pp <= 99 && row.pp !== cur.pp) {
    parts.push(`pp ${cur.pp}→${row.pp}`); out[base + O_PP] = row.pp
  }
  if (row.newType) {
    const t = typeByName.get(row.newType.toUpperCase())
    if (t === undefined) throw new Error(`${row.name}: type ${row.newType} not in ROM`)
    if (t !== cur.type) { parts.push(`type ${loaded.typeNames[cur.type]}→${row.newType}`); out[base + O_TYPE] = t }
  }
  if (row.effect && !row.newType) deferred.push(`${row.name}: ${row.effect}`)
  if (parts.length) { writes++; changes.push(`${row.name.padEnd(14)} ${parts.join('  ')}`) }
}

console.log(`ROM: ${romName}  (${loaded.rom.gameCode()}, anchors ${loaded.anchorSource})`)
console.log(`moves with power/acc/pp/type writes: ${writes}`)
if (missing.length) console.log(`⚠ move names not found in ROM (skipped): ${missing.join(', ')}`)
console.log()
changes.forEach((l) => console.log('  ' + l))
if (deferred.length) {
  console.log(`\n  — DEFERRED effect changes (${deferred.length}), not applied (need effect-id mapping): —`)
  deferred.forEach((l) => console.log('    ' + l))
  console.log('    (plus global split notes: "Ghost type now Special", "Dark now physical")')
}

if (dryRun) { console.log('\n--dry-run: no changes written.'); process.exit(0) }
if (writes === 0) { console.log('\nNothing to change.'); process.exit(0) }

// Re-read verify: each written field matches.
const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length > 0) throw new Error(`Output ROM has warnings: ${check.warnings.join('; ')}`)
for (const row of moves) {
  const id = idByMove.get(norm(row.name))
  if (id === undefined) continue
  const m = check.moves[id]
  if (row.power !== null && row.power >= 0 && row.power <= 255 && m.power !== row.power) throw new Error(`Post-check power ${row.name}: ${m.power}≠${row.power}`)
  if (row.acc !== null && row.acc >= 0 && row.acc <= 100 && m.accuracy !== row.acc) throw new Error(`Post-check acc ${row.name}: ${m.accuracy}≠${row.acc}`)
  if (row.pp !== null && row.pp >= 1 && row.pp <= 99 && m.pp !== row.pp) throw new Error(`Post-check pp ${row.name}: ${m.pp}≠${row.pp}`)
  if (row.newType) { const t = typeByName.get(row.newType.toUpperCase())!; if (m.type !== t) throw new Error(`Post-check type ${row.name}`) }
}

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = romPath.replace(/\.gba$/i, '') + `.pre-legacy-moves-${stamp}.gba`
fs.copyFileSync(romPath, backupPath)
fs.writeFileSync(romPath, out)

console.log(`\n✅ ${writes} moves updated (${diff} bytes changed).`)
console.log(`   ${deferred.length} effect-based changes deferred (see above).`)
console.log(`   backup: ${backupPath.split(/[\\/]/).pop()}`)
