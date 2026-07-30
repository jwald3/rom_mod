/**
 * Follow-up to apply-legacy-stats.mts: the legacy doc buffed several pre-evos
 * without touching their (mostly Gen-4) evolutions, which created a handful of
 * stat inversions — a pre-evo ending up higher than its evolution in some stat.
 * This raises ONLY those evolutions, and ONLY in the affected stat, just enough
 * that no evolution is beaten by its own pre-evo in a stat the buff pushed past
 * it (Camerupt, Dusknoir, Gallade, Honchkrow, Mamoswine, Weavile, Yanmega).
 *
 *   npx tsx scripts/apply-legacy-evo-stat-fixes.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-legacy-evo-stat-fixes.mts --dry-run "<rom.gba>" [toml]
 *
 * Data (scripts/legacy-evo-stat-fixes.json) was derived by comparing every
 * pre-evo→evo edge before vs after the buffs and flagging only inversions the
 * buffs created or widened (pre-existing canon cases like Metapod<Caterpie or
 * Steelix<Onix in Speed are intentional and left alone). Absolute new stat
 * lines, written in place at struct offsets 0..5. Backup + re-read verify.
 */
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadRom } from '../src/rom/loadRom'

const here = dirname(fileURLToPath(import.meta.url))
interface StatRow { name: string; hp: number; atk: number; def: number; spa: number; spd: number; spe: number }
const fixes: StatRow[] = JSON.parse(fs.readFileSync(resolve(here, 'legacy-evo-stat-fixes.json'), 'utf8'))

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) {
  console.error('usage: npx tsx scripts/apply-legacy-evo-stat-fixes.mts [--dry-run] "<rom.gba>" [toml]')
  process.exit(2)
}

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length > 0) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)
const a = loaded.anchors

const idByName = new Map<string, number>()
loaded.species.forEach((s, i) => { if (s.name) idByName.set(s.name.toUpperCase(), i) })

const out = new Uint8Array(bytes)
const STAT_OFF = [0, 1, 2, 3, 4, 5] as const // hp,atk,def,spe,spa,spd
const changes: string[] = []
const missing: string[] = []
let writes = 0

for (const row of fixes) {
  const id = idByName.get(row.name.toUpperCase())
  if (id === undefined) { missing.push(row.name); continue }
  const base = a.baseStats + id * a.baseStatsLen
  const cur = loaded.species[id].stats
  const vals = [row.hp, row.atk, row.def, row.spe, row.spa, row.spd] // note Spe before SpA/SpD
  for (const v of vals) if (v < 1 || v > 255) throw new Error(`${row.name}: stat ${v} out of range`)
  const diffParts: string[] = []
  if (cur.hp !== row.hp) diffParts.push(`HP ${cur.hp}→${row.hp}`)
  if (cur.atk !== row.atk) diffParts.push(`Atk ${cur.atk}→${row.atk}`)
  if (cur.def !== row.def) diffParts.push(`Def ${cur.def}→${row.def}`)
  if (cur.spa !== row.spa) diffParts.push(`SpA ${cur.spa}→${row.spa}`)
  if (cur.spd !== row.spd) diffParts.push(`SpD ${cur.spd}→${row.spd}`)
  if (cur.spe !== row.spe) diffParts.push(`Spe ${cur.spe}→${row.spe}`)
  if (!diffParts.length) continue
  STAT_OFF.forEach((o, k) => { out[base + o] = vals[k] })
  writes++
  changes.push(`${row.name.padEnd(12)} ${diffParts.join('  ')}`)
}

console.log(`ROM: ${romName}  (${loaded.rom.gameCode()}, anchors ${loaded.anchorSource})`)
console.log(`evolution stat fixes: ${writes}`)
if (missing.length) console.log(`⚠ not found: ${missing.join(', ')}`)
console.log()
changes.forEach((l) => console.log('  ' + l))

if (dryRun) { console.log('\n--dry-run: no changes written.'); process.exit(0) }
if (writes === 0) { console.log('\nNothing to change.'); process.exit(0) }

const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length > 0) throw new Error(`Output ROM has warnings: ${check.warnings.join('; ')}`)
for (const row of fixes) {
  const id = idByName.get(row.name.toUpperCase())
  if (id === undefined) continue
  const s = check.species[id].stats
  if (s.hp !== row.hp || s.atk !== row.atk || s.def !== row.def || s.spe !== row.spe || s.spa !== row.spa || s.spd !== row.spd) {
    throw new Error(`Post-check failed for ${row.name}: got ${JSON.stringify(s)}`)
  }
}

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = romPath.replace(/\.gba$/i, '') + `.pre-evo-stat-fixes-${stamp}.gba`
fs.copyFileSync(romPath, backupPath)
fs.writeFileSync(romPath, out)

console.log(`\n✅ ${writes} evolution stat lines fixed (${diff} bytes changed).`)
console.log(`   backup: ${backupPath.split(/[\\/]/).pop()}`)
