/**
 * Apply the poke-emerald-legacy level-up LEARNSET changes to the ROM.
 * https://mryakobo.github.io/poke-emerald-legacy-docs/
 *
 *   npx tsx scripts/apply-legacy-learnsets.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-legacy-learnsets.mts --dry-run "<rom.gba>" [toml]
 *
 * Data: scripts/legacy-learnsets.json — [{ name, moves: [{level, move}] }] for the
 * whole dex. Each species' full level-up list is REPLACED with the doc's list
 * (ordered as given). Move + species names are matched case/space-insensitively;
 * Nidoran♀/♂ are aliased explicitly, and the Deoxys forme rows are skipped (the
 * ROM stores 4 same-named Deoxys entries — ambiguous to target). A species or
 * move that can't be resolved is reported and skipped, never guessed.
 *
 * Learnsets are variable-length: the writer rewrites in place when the new list
 * fits, else relocates to free space and repoints (clone-on-write for shared
 * pointers). Backup + re-read verify every entry. BPEE needs no toml.
 */
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadRom } from '../src/rom/loadRom'
import { applyRomEdits } from '../src/rom/writer'
import { readLearnset, type LearnsetEntry } from '../src/rom/tables/learnsets'

const here = dirname(fileURLToPath(import.meta.url))
interface LearnRow { name: string; moves: { level: number; move: string }[] }
const learn: LearnRow[] = JSON.parse(fs.readFileSync(resolve(here, 'legacy-learnsets.json'), 'utf8'))

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) {
  console.error('usage: npx tsx scripts/apply-legacy-learnsets.mts [--dry-run] "<rom.gba>" [toml]')
  process.exit(2)
}

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length > 0) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const moveByName = new Map<string, number>()
loaded.moves.forEach((m) => { if (m.name) moveByName.set(norm(m.name), m.id) })
const spByName = new Map<string, number>()
loaded.species.forEach((s, i) => { if (s.name && spByName.get(norm(s.name)) === undefined) spByName.set(norm(s.name), i) })
// Explicit species aliases for names the doc writes differently.
const SPECIES_ALIAS: Record<string, number | undefined> = {
  NIDORANF: loaded.species.findIndex((s) => s.name === 'NIDORAN♀'),
  NIDORANM: loaded.species.findIndex((s) => s.name === 'NIDORAN♂'),
}
const SKIP = new Set(['DEOXYSSPEED', 'DEOXYSATTACK', 'DEOXYSDEFENSE']) // ambiguous formes
const resolveSpecies = (name: string): number | undefined => {
  const k = norm(name)
  if (SKIP.has(k)) return undefined
  if (SPECIES_ALIAS[k] !== undefined && SPECIES_ALIAS[k]! >= 0) return SPECIES_ALIAS[k]
  return spByName.get(k)
}

const learnsets = new Map<number, LearnsetEntry[]>()
const changed: string[] = []
const missing: string[] = []
const badMoves: string[] = []

for (const row of learn) {
  const id = resolveSpecies(row.name)
  if (id === undefined) { if (!SKIP.has(norm(row.name))) missing.push(row.name); continue }
  const entries: LearnsetEntry[] = []
  let ok = true
  for (const mv of row.moves) {
    const moveId = moveByName.get(norm(mv.move))
    if (moveId === undefined) { badMoves.push(`${row.name}:${mv.move}`); ok = false; break }
    const level = Math.max(1, Math.min(100, mv.level))
    entries.push({ level, moveId })
  }
  if (!ok || entries.length === 0) continue
  // Skip if identical to what's already there.
  const cur = readLearnset(loaded.rom, loaded.anchors, id).entries
  const same = cur.length === entries.length && cur.every((e, i) => e.level === entries[i].level && e.moveId === entries[i].moveId)
  if (same) continue
  learnsets.set(id, entries)
  changed.push(`${row.name.padEnd(12)} ${cur.length}→${entries.length} moves`)
}

console.log(`ROM: ${romName}  (${loaded.rom.gameCode()}, anchors ${loaded.anchorSource})`)
console.log(`learnsets to rewrite: ${changed.length} / ${learn.length} rows`)
if (missing.length) console.log(`⚠ species not found (skipped): ${missing.join(', ')}`)
if (badMoves.length) console.log(`⚠ rows skipped for unresolved move: ${badMoves.join(', ')}`)
console.log(`  (Deoxys forme rows intentionally skipped)`)

if (dryRun) {
  console.log('\nsample of changes:')
  changed.slice(0, 20).forEach((l) => console.log('  ' + l))
  console.log(`  … ${Math.max(0, changed.length - 20)} more`)
  console.log('\n--dry-run: no changes written.')
  process.exit(0)
}
if (learnsets.size === 0) { console.log('\nNothing to change.'); process.exit(0) }

const { bytes: out } = applyRomEdits(loaded.rom, loaded.anchors, { learnsets })

// Re-read verify: every rewritten species matches exactly.
const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length > 0) throw new Error(`Output ROM has warnings: ${check.warnings.join('; ')}`)
for (const [id, want] of learnsets) {
  const got = readLearnset(check.rom, check.anchors, id).entries
  if (got.length !== want.length || got.some((e, i) => e.level !== want[i].level || e.moveId !== want[i].moveId)) {
    throw new Error(`Post-check failed for species #${id} (${loaded.species[id].name})`)
  }
}

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = romPath.replace(/\.gba$/i, '') + `.pre-learnsets-${stamp}.gba`
fs.copyFileSync(romPath, backupPath)
fs.writeFileSync(romPath, out)

console.log(`\n✅ ${learnsets.size} learnsets rewritten (${diff} bytes changed).`)
console.log(`   backup: ${backupPath.split(/[\\/]/).pop()}`)
