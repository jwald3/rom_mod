/**
 * Conform the ROM's move-tutor compatibility to canonical Emerald, removing the
 * illogical tutor/Pokémon combos the hack left in (Meganium learning
 * ThunderPunch, etc.).
 *
 *   npx tsx scripts/apply-canon-tutor-compat.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-canon-tutor-compat.mts --dry-run "<rom.gba>" [toml]
 *
 * Ground truth is pret/pokeemerald's sTutorLearnsets, parsed into
 * scripts/emerald-tutors.json ({ SPECIES_NAME: [MOVE_NAME, …] }) from
 *   https://raw.githubusercontent.com/pret/pokeemerald/master/src/data/pokemon/tutor_learnsets.h
 * This ROM carries the exact Emerald 30-tutor roster, so each tutor slot is
 * matched to Emerald BY THE MOVE IT TEACHES, not by index (the hack swapped
 * slot 7 Mimic→Headbutt).
 *
 * Rules (chosen deliberately):
 *   • Remove-only. A compat bit is CLEARED when Emerald doesn't grant it; we
 *     never add a tutor a species lacks. Anything the mod granted that's also
 *     canon is preserved.
 *   • Headbutt (the swapped slot) has no Emerald equivalent, so its bits are
 *     left untouched.
 *   • Gen-4 evolutions Emerald never knew inherit their canonical pre-evolution's
 *     tutor set (Rhyperior←Rhydon, Magnezone←Magneton, …), resolved from the
 *     ROM's own evolution table. A baby form with no pre-evo (Bonsly, Munchlax,
 *     Mime Jr., …) inherits from its evolution instead. Purged post-Gen-4
 *     species with no canonical basis are left untouched.
 *
 * Compat rows are fixed-size bitfields, so every write is in place. Backs up,
 * writes, and re-reads to verify. BPEE needs no toml.
 */
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadRom } from '../src/rom/loadRom'
import { readEvolutionsFor } from '../src/rom/tables/evolutions'
import { compatRowBytes, serializeCompatRow } from '../src/rom/tables/compat'
import { isExcludedSpecies } from './lib/excluded-species'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) {
  console.error('usage: npx tsx scripts/apply-canon-tutor-compat.mts [--dry-run] "<rom.gba>" [toml]')
  process.exit(2)
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

// ── canonical Emerald tutor sets, keyed by normalized species name ──
const emeraldRaw: Record<string, string[]> = JSON.parse(
  fs.readFileSync(resolve(here, 'emerald-tutors.json'), 'utf8'),
)
const emerald = new Map<string, Set<string>>() // normalized decomp name → set of MOVE tokens
for (const [decompName, moves] of Object.entries(emeraldRaw)) {
  emerald.set(norm(decompName), new Set(moves))
}
// The ♀/♂ Nidoran forms both normalize to "NIDORAN", colliding with each other
// and never matching the decomp's NIDORAN_F / NIDORAN_M. Resolve them by the
// ROM's fixed species ids instead of by name.
const EMERALD_BY_ID: Record<number, Set<string>> = {
  29: emerald.get(norm('NIDORAN_F')) ?? new Set(),
  32: emerald.get(norm('NIDORAN_M')) ?? new Set(),
}

// decomp MOVE token (e.g. THUNDER_PUNCH) → ROM move name (THUNDERPUNCH)
const moveTokenToRom = (token: string) => norm(token) // both normalize to the same alnum key

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length > 0) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)
const a = loaded.anchors

// ── map each ROM tutor slot → its move's normalized name; flag Headbutt ──
const slotMoveKey = loaded.tutorMoves.map((mid) => norm(loaded.moves[mid]?.name ?? ''))
const HEADBUTT = norm('HEADBUTT')

// ── build the effective canonical tutor set for every ROM species ──
// Gen-4 evos absent from Emerald inherit their pre-evolution's set (walking the
// chain until we hit a species Emerald knows). Purged species are skipped.
const idByName = new Map<string, number>()
loaded.species.forEach((s, i) => {
  if (s.name) idByName.set(norm(s.name), i)
})
// reverse-evolution map: species id → its pre-evolution id (first found)
const preEvoOf = new Map<number, number>()
loaded.species.forEach((_, sid) => {
  for (const e of readEvolutionsFor(loaded.rom, a, sid)) {
    if (!preEvoOf.has(e.target)) preEvoOf.set(e.target, sid)
  }
})

function canonicalSetFor(id: number): Set<string> | null {
  const name = loaded.species[id]?.name
  if (!name) return null
  if (EMERALD_BY_ID[id]) return EMERALD_BY_ID[id]
  const direct = emerald.get(norm(name))
  if (direct) return direct
  // Walk pre-evolutions until we find one Emerald knows.
  const seen = new Set<number>([id])
  let cur = preEvoOf.get(id)
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur)
    const set = emerald.get(norm(loaded.species[cur].name))
    if (set) return set
    cur = preEvoOf.get(cur)
  }
  // A baby Gen-4 form has no pre-evo; fall back to its evolution's canonical set
  // (its legit tutors are a subset of the evolved form's). Walk forward.
  const fseen = new Set<number>([id])
  let fwd: number | undefined = readEvolutionsFor(loaded.rom, a, id)[0]?.target
  while (fwd !== undefined && !fseen.has(fwd)) {
    fseen.add(fwd)
    const set = emerald.get(norm(loaded.species[fwd].name))
    if (set) return set
    fwd = readEvolutionsFor(loaded.rom, a, fwd)[0]?.target
  }
  return null // no canonical basis (e.g. a purged Gen-4 species)
}

// ── compute the new compat rows ──
const out = new Uint8Array(bytes)
const changes: { name: string; removed: string[] }[] = []
const noBasis: string[] = []
let bitsCleared = 0

for (let id = 0; id < loaded.species.length; id++) {
  const s = loaded.species[id]
  if (!s.name || /^\?+$/.test(s.name)) continue
  const row = loaded.tutorCompat[id]
  if (!row) continue

  const canon = canonicalSetFor(id)
  if (!canon) {
    // No canonical basis: leave the row untouched, but note it if it has bits set
    // and isn't a deliberately-purged species.
    if (!isExcludedSpecies(s.name) && row.some(Boolean)) noBasis.push(s.name)
    continue
  }
  const canonKeys = new Set([...canon].map(moveTokenToRom))

  const removed: string[] = []
  const next = [...row]
  for (let slot = 0; slot < next.length; slot++) {
    if (!next[slot]) continue // already off
    if (slotMoveKey[slot] === HEADBUTT) continue // swapped slot, no Emerald basis
    if (!canonKeys.has(slotMoveKey[slot])) {
      next[slot] = false
      removed.push(loaded.moves[loaded.tutorMoves[slot]]?.name ?? `slot${slot}`)
    }
  }
  if (removed.length === 0) continue

  // Serialize the row back to its bitfield using the same helper the reader
  // pairs with, at the reader's row stride (compatRowBytes(tutorCount)).
  const rowBase = a.tutorCompat + id * compatRowBytes(next.length)
  out.set(serializeCompatRow(next), rowBase)
  bitsCleared += removed.length
  changes.push({ name: s.name, removed })
}

console.log(`ROM: ${romName}  (${loaded.rom.gameCode()}, anchors ${loaded.anchorSource})`)
console.log(
  `tutor compat conformed to Emerald: ${changes.length} species, ${bitsCleared} bits cleared`,
)
if (noBasis.length) {
  console.log(`⚠ ${noBasis.length} species left untouched (no Emerald basis): ${noBasis.join(', ')}`)
}
console.log()
for (const c of changes.slice(0, 40)) {
  console.log(`  ${c.name.padEnd(12)} − ${c.removed.join(', ')}`)
}
if (changes.length > 40) console.log(`  … and ${changes.length - 40} more`)

if (dryRun) {
  console.log('\n--dry-run: no changes written.')
  process.exit(0)
}
if (bitsCleared === 0) {
  console.log('\nNothing to change.')
  process.exit(0)
}

// Independent re-parse: every changed species must read back the trimmed set,
// and must be a strict subset of what it had before (remove-only).
const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length > 0) throw new Error(`Output ROM has warnings: ${check.warnings.join('; ')}`)
for (let id = 0; id < loaded.species.length; id++) {
  const before = loaded.tutorCompat[id]
  const after = check.tutorCompat[id]
  if (!before || !after) continue
  for (let slot = 0; slot < before.length; slot++) {
    if (after[slot] && !before[slot]) throw new Error(`Post-check: ${loaded.species[id].name} gained a tutor bit`)
  }
}

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = romPath.replace(/\.gba$/i, '') + `.pre-tutor-compat-${stamp}.gba`
fs.copyFileSync(romPath, backupPath)
fs.writeFileSync(romPath, out)

console.log(`\n✅ ${changes.length} species conformed (${diff} bytes changed).`)
console.log(`   backup: ${backupPath.split(/[\\/]/).pop()}`)
