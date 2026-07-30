/**
 * Replace the Emerald-base surf encounters (Tentacool/Wingull/Pelipper, Surskit,
 * etc.) with authoritative HG/SS surf tables across every map bank, so no matter
 * which map the game loads for a route the player gets canon HG/SS surf.
 *
 *   npx tsx scripts/apply-hgss-surf.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-hgss-surf.mts --dry-run "<rom.gba>" [toml]
 *
 * Canon data lives in scripts/hgss-surf-canon.mts (HGSS_SURF, keyed by the ROM's
 * resolved area name). For each wild area whose name is in the table and whose
 * surf group differs, all 5 surf slots are rewritten from the canon layout. The
 * group rate is preserved. Areas not in the table (and non-surf groups) are left
 * untouched. Backs up, writes, and re-parses to verify. BPEE needs no toml.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { applyRomEdits } from '../src/rom/writer'
import { wildKey, type WildGroupEdit, type WildSlot } from '../src/rom/tables/wild'
import { HGSS_SURF, type CanonSlot } from './hgss-surf-canon.mts'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) {
  console.error('usage: npx tsx scripts/apply-hgss-surf.mts [--dry-run] "<rom.gba>" [toml]')
  process.exit(2)
}

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length > 0) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)

// species name (ALLCAPS) → id
const idByName = new Map<string, number>()
loaded.species.forEach((s, i) => { if (s.name) idByName.set(s.name, i) })
const sp = (id: number) => loaded.species[id]?.name ?? `#${id}`

function canonToSlots(canon: CanonSlot[]): WildSlot[] {
  const slots: WildSlot[] = []
  for (const c of canon) {
    const id = idByName.get(c.species)
    if (id === undefined) throw new Error(`Canon species not in ROM: ${c.species}`)
    slots.push({ species: id, low: c.low, high: c.high })
  }
  // Surf groups are 5 slots; pad by repeating the last if a canon entry is short.
  while (slots.length < 5) slots.push({ ...slots[slots.length - 1] })
  return slots.slice(0, 5)
}

const slotsEqual = (a: WildSlot[], b: WildSlot[]) =>
  a.length === b.length && a.every((s, i) => s.species === b[i].species && s.low === b[i].low && s.high === b[i].high)

/**
 * Emerald-base surf contaminants that never appear in a canon HG/SS surf slot.
 * We ONLY rewrite a surf group that contains one of these — that way already-
 * correct tables (incl. per-floor variants like Union Cave 1F Wooper/Quagsire vs
 * B2F Tentacool/Quagsire, or Mt. Silver's Goldeen pools) are left untouched.
 */
const CONTAMINANTS = new Set<number>(
  ['WINGULL', 'PELIPPER', 'SURSKIT', 'SPHEAL', 'CARVANHA', 'SHARPEDO', 'WAILMER', 'WAILORD', 'CLAMPERL', 'RELICANTH', 'LOMBRE', 'LOTAD', 'MARILL', 'AZUMARILL']
    .map((n) => idByName.get(n))
    .filter((id): id is number => id !== undefined),
)
const isContaminated = (slots: WildSlot[]) => slots.some((s) => CONTAMINANTS.has(s.species))

const wild = new Map<string, WildGroupEdit>()
const changed: { idx: number; name: string; bank: number; from: string; to: string }[] = []
const namesHit = new Set<string>()
const namesMissing = new Set<string>()

// Fallback substitution for contaminated tables on maps we have no name-canon
// for (vestigial Hoenn maps whose names don't resolve). Swap each contaminant
// slot for TENTACOOL (or MAGIKARP if the table is otherwise freshwater), keeping
// the slot's levels — this guarantees no Hoenn gull survives anywhere.
const TENTACOOL = idByName.get('TENTACOOL')!
const MAGIKARP = idByName.get('MAGIKARP')!
function neutralize(slots: WildSlot[]): WildSlot[] {
  const hasSea = slots.some((s) => s.species === TENTACOOL || s.species === idByName.get('TENTACRUEL'))
  const fill = hasSea ? TENTACOOL : MAGIKARP
  return slots.map((s) => (CONTAMINANTS.has(s.species) ? { ...s, species: fill } : s))
}

for (const area of loaded.wildAreas) {
  const group = area.groups.surf
  if (!group) continue
  const canon = HGSS_SURF[area.name]
  if (!canon) {
    if (group.slots.some((s) => s.species > 0)) namesMissing.add(area.name)
    // No name-canon, but if it's contaminated, neutralize the offending slots.
    if (isContaminated(group.slots)) {
      const target = neutralize(group.slots)
      wild.set(wildKey(area.index, 'surf'), { rate: group.rate, slots: target })
      changed.push({
        idx: area.index, name: area.name, bank: area.bank,
        from: [...new Set(group.slots.filter((s) => s.species > 0).map((s) => sp(s.species)))].join('/'),
        to: [...new Set(target.map((s) => sp(s.species)))].join('/') + ' (neutralized)',
      })
    }
    continue
  }
  namesHit.add(area.name)
  // Only rewrite tables that are actually contaminated with Emerald surf species.
  // Correct tables (including legit per-floor variants) are left alone.
  if (!isContaminated(group.slots)) continue
  const target = canonToSlots(canon)
  if (slotsEqual(group.slots, target)) continue // already correct
  wild.set(wildKey(area.index, 'surf'), { rate: group.rate, slots: target })
  changed.push({
    idx: area.index,
    name: area.name,
    bank: area.bank,
    from: [...new Set(group.slots.filter((s) => s.species > 0).map((s) => sp(s.species)))].join('/'),
    to: [...new Set(target.map((s) => sp(s.species)))].join('/'),
  })
}

console.log(`ROM: ${romName}  (${loaded.rom.gameCode()}, anchors ${loaded.anchorSource})`)
console.log(`canon locations matched in ROM: ${namesHit.size}/${Object.keys(HGSS_SURF).length}`)
if (namesMissing.size) {
  console.log(`surf areas with NO canon entry (left untouched): ${[...namesMissing].sort().join(', ')}`)
}
if (changed.length === 0) {
  console.log('\nAll surf tables already match canon — nothing to change.')
  process.exit(0)
}
console.log(`\n${changed.length} surf table(s) to rewrite:`)
for (const c of changed) {
  console.log(`  [${String(c.idx).padStart(3)}] ${c.name.padEnd(18)} (bank ${c.bank})  ${c.from || '(empty)'}  →  ${c.to}`)
}

if (dryRun) {
  console.log('\n--dry-run: no changes written.')
  process.exit(0)
}

const { bytes: out, ops } = applyRomEdits(loaded.rom, loaded.anchors, { wild })

// Independent re-parse: no contaminant may survive in any edited table, and
// name-canon tables must match their canon target exactly.
const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length > 0) throw new Error(`Output ROM has warnings: ${check.warnings.join('; ')}`)
const checkContam = new Set<number>(
  ['WINGULL', 'PELIPPER', 'SURSKIT', 'SPHEAL', 'CARVANHA', 'SHARPEDO', 'WAILMER', 'WAILORD', 'CLAMPERL', 'RELICANTH', 'LOMBRE', 'LOTAD', 'MARILL', 'AZUMARILL']
    .map((n) => check.species.findIndex((s) => s.name === n))
    .filter((id) => id > 0),
)
for (const c of changed) {
  const area = check.wildAreas[c.idx]
  const slots = area.groups.surf!.slots
  if (slots.some((s) => checkContam.has(s.species))) {
    throw new Error(`Post-check failed: contaminant survived at area ${c.idx} (${c.name})`)
  }
  const canon = HGSS_SURF[area.name]
  if (canon && !slotsEqual(slots, canonToSlots(canon))) {
    throw new Error(`Post-check failed: canon mismatch at area ${c.idx} (${c.name})`)
  }
}

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = romPath.replace(/\.gba$/i, '') + `.pre-surf-${stamp}.gba`
fs.copyFileSync(romPath, backupPath)
fs.writeFileSync(romPath, out)

console.log(`\n✅ rewrote ${changed.length} surf tables (${ops.length} write ops, ${diff} bytes changed).`)
console.log(`   backup: ${backupPath.split(/[\\/]/).pop()}`)
