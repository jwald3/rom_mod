/**
 * Revert species to their Gen-4 typings, undoing type changes the hack made.
 *
 *   npx tsx scripts/apply-revert-nonnatural-types.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-revert-nonnatural-types.mts --dry-run "<rom.gba>" [toml]
 *
 * Two groups (see REVERTS):
 *   1. Invented secondary types on species that are single-type in the games —
 *      most visibly the Johto starters (Typhlosion had gained Ground, etc.).
 *   2. The hack's dex-wide Fairy pass, rolled back to Gen 4 on the lines the
 *      Fairy type didn't exist for then — Clefairy/Jigglypuff/Togepi/Snubbull
 *      → Normal, Marill/Luvdisc → Water, Gardevoir/Mr. Mime → Psychic, Mawile
 *      → Steel, Arbok → Poison. Whole evolution lines, so no stage is left
 *      mismatched; Gallade keeps its canonical Psychic/Fighting.
 *
 * Types are named, resolved through the ROM's own type table (so this doesn't
 * assume a type enum). Each revert states the type the ROM must currently have;
 * if the ROM disagrees the species is reported and skipped, never guessed. A
 * species already at its target is a no-op, so the script is idempotent and safe
 * to re-run. Base-stats records are fixed-size, so writes are in place at struct
 * offset 6 (type1) / 7 (type2). Backs up, writes, and re-reads to verify. BPEE
 * needs no toml.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) {
  console.error(
    'usage: npx tsx scripts/apply-revert-nonnatural-types.mts [--dry-run] "<rom.gba>" [toml]',
  )
  process.exit(2)
}

/**
 * Each revert: the species, the (primary, secondary) it must CURRENTLY read in
 * the ROM (a safety assertion), and the (primary, secondary) it should become.
 * Most become mono-type (to === from primary); Parasect and Noctowl stay dual
 * with their correct vanilla typing.
 */
interface Revert {
  name: string
  fromType1: string
  fromType2: string
  toType1: string
  toType2: string
  note: string
}
const REVERTS: Revert[] = [
  // starters — the whole point of the request
  { name: 'MEGANIUM', fromType1: 'GRASS', fromType2: 'FAIRY', toType1: 'GRASS', toType2: 'GRASS', note: 'drop Fairy' },
  { name: 'TYPHLOSION', fromType1: 'FIRE', fromType2: 'GROUND', toType1: 'FIRE', toType2: 'FIRE', note: 'drop Ground' },
  { name: 'FERALIGATR', fromType1: 'WATER', fromType2: 'DRAGON', toType1: 'WATER', toType2: 'WATER', note: 'drop Dragon' },
  { name: 'GROVYLE', fromType1: 'GRASS', fromType2: 'DRAGON', toType1: 'GRASS', toType2: 'GRASS', note: 'drop Dragon' },
  { name: 'SCEPTILE', fromType1: 'GRASS', fromType2: 'DRAGON', toType1: 'GRASS', toType2: 'GRASS', note: 'drop Dragon' },
  // other clear hack additions
  { name: 'SUNFLORA', fromType1: 'GRASS', fromType2: 'FIRE', toType1: 'GRASS', toType2: 'GRASS', note: 'drop Fire' },
  { name: 'GOLDUCK', fromType1: 'WATER', fromType2: 'PSYCHC', toType1: 'WATER', toType2: 'WATER', note: 'drop Psychic' },
  { name: 'KINGLER', fromType1: 'WATER', fromType2: 'STEEL', toType1: 'WATER', toType2: 'WATER', note: 'drop Steel' },
  { name: 'STANTLER', fromType1: 'NORMAL', fromType2: 'PSYCHC', toType1: 'NORMAL', toType2: 'NORMAL', note: 'drop Psychic' },
  { name: 'GULPIN', fromType1: 'POISON', fromType2: 'NORMAL', toType1: 'POISON', toType2: 'POISON', note: 'drop Normal' },
  { name: 'SWALOT', fromType1: 'POISON', fromType2: 'NORMAL', toType1: 'POISON', toType2: 'POISON', note: 'drop Normal' },
  { name: 'ELECTIVIRE', fromType1: 'ELECTR', fromType2: 'FIGHT', toType1: 'ELECTR', toType2: 'ELECTR', note: 'drop Fighting' },
  // stays dual, but corrected to vanilla typing
  { name: 'PARASECT', fromType1: 'BUG', fromType2: 'GHOST', toType1: 'BUG', toType2: 'GRASS', note: 'Ghost → Grass (vanilla)' },
  { name: 'NOCTOWL', fromType1: 'PSYCHC', fromType2: 'FLYING', toType1: 'NORMAL', toType2: 'FLYING', note: 'Psychic → Normal (vanilla)' },

  // ── Gen-4 typings: undo the hack's dex-wide Fairy pass on these lines ──
  // (whole evolution lines, so no stage is left mismatched; Gallade keeps its
  // canonical Psychic/Fighting and is intentionally not listed.)
  { name: 'ARBOK', fromType1: 'POISON', fromType2: 'DARK', toType1: 'POISON', toType2: 'POISON', note: 'drop Dark (Gen 4)' },
  // Clefairy line → Normal
  { name: 'CLEFFA', fromType1: 'FAIRY', fromType2: 'FAIRY', toType1: 'NORMAL', toType2: 'NORMAL', note: 'Fairy → Normal (Gen 4)' },
  { name: 'CLEFAIRY', fromType1: 'FAIRY', fromType2: 'FAIRY', toType1: 'NORMAL', toType2: 'NORMAL', note: 'Fairy → Normal (Gen 4)' },
  { name: 'CLEFABLE', fromType1: 'FAIRY', fromType2: 'FAIRY', toType1: 'NORMAL', toType2: 'NORMAL', note: 'Fairy → Normal (Gen 4)' },
  // Jigglypuff line → Normal
  { name: 'IGGLYBUFF', fromType1: 'NORMAL', fromType2: 'FAIRY', toType1: 'NORMAL', toType2: 'NORMAL', note: 'drop Fairy (Gen 4)' },
  { name: 'JIGGLYPUFF', fromType1: 'NORMAL', fromType2: 'FAIRY', toType1: 'NORMAL', toType2: 'NORMAL', note: 'drop Fairy (Gen 4)' },
  { name: 'WIGGLYTUFF', fromType1: 'NORMAL', fromType2: 'FAIRY', toType1: 'NORMAL', toType2: 'NORMAL', note: 'drop Fairy (Gen 4)' },
  // Togepi line → Normal / Normal-Flying
  { name: 'TOGEPI', fromType1: 'FAIRY', fromType2: 'FAIRY', toType1: 'NORMAL', toType2: 'NORMAL', note: 'Fairy → Normal (Gen 4)' },
  { name: 'TOGETIC', fromType1: 'FAIRY', fromType2: 'FLYING', toType1: 'NORMAL', toType2: 'FLYING', note: 'Fairy → Normal (Gen 4)' },
  { name: 'TOGEKISS', fromType1: 'FAIRY', fromType2: 'FLYING', toType1: 'NORMAL', toType2: 'FLYING', note: 'Fairy → Normal (Gen 4)' },
  // Marill line → Water (Azurill → Normal, as in Gen 4)
  { name: 'AZURILL', fromType1: 'NORMAL', fromType2: 'FAIRY', toType1: 'NORMAL', toType2: 'NORMAL', note: 'drop Fairy (Gen 4)' },
  { name: 'MARILL', fromType1: 'WATER', fromType2: 'FAIRY', toType1: 'WATER', toType2: 'WATER', note: 'drop Fairy (Gen 4)' },
  { name: 'AZUMARILL', fromType1: 'WATER', fromType2: 'FAIRY', toType1: 'WATER', toType2: 'WATER', note: 'drop Fairy (Gen 4)' },
  // Snubbull line → Normal
  { name: 'SNUBBULL', fromType1: 'FAIRY', fromType2: 'FAIRY', toType1: 'NORMAL', toType2: 'NORMAL', note: 'Fairy → Normal (Gen 4)' },
  { name: 'GRANBULL', fromType1: 'FAIRY', fromType2: 'FAIRY', toType1: 'NORMAL', toType2: 'NORMAL', note: 'Fairy → Normal (Gen 4)' },
  // Skitty line → Normal (Skitty is already Normal; Delcatty drops Fairy)
  { name: 'DELCATTY', fromType1: 'NORMAL', fromType2: 'FAIRY', toType1: 'NORMAL', toType2: 'NORMAL', note: 'drop Fairy (Gen 4)' },
  // singles
  { name: 'LUVDISC', fromType1: 'WATER', fromType2: 'FAIRY', toType1: 'WATER', toType2: 'WATER', note: 'drop Fairy (Gen 4)' },
  { name: 'MAWILE', fromType1: 'STEEL', fromType2: 'FAIRY', toType1: 'STEEL', toType2: 'STEEL', note: 'drop Fairy (Gen 4)' },
  // Ralts line → Psychic (Gallade left as canonical Psychic/Fighting)
  { name: 'RALTS', fromType1: 'PSYCHC', fromType2: 'FAIRY', toType1: 'PSYCHC', toType2: 'PSYCHC', note: 'drop Fairy (Gen 4)' },
  { name: 'KIRLIA', fromType1: 'PSYCHC', fromType2: 'FAIRY', toType1: 'PSYCHC', toType2: 'PSYCHC', note: 'drop Fairy (Gen 4)' },
  { name: 'GARDEVOIR', fromType1: 'PSYCHC', fromType2: 'FAIRY', toType1: 'PSYCHC', toType2: 'PSYCHC', note: 'drop Fairy (Gen 4)' },
  // Mr. Mime line → Psychic
  { name: 'MR. MIME', fromType1: 'PSYCHC', fromType2: 'FAIRY', toType1: 'PSYCHC', toType2: 'PSYCHC', note: 'drop Fairy (Gen 4)' },
  { name: 'MIME JR.', fromType1: 'PSYCHC', fromType2: 'FAIRY', toType1: 'PSYCHC', toType2: 'PSYCHC', note: 'drop Fairy (Gen 4)' },
]

const TYPE1_OFF = 6
const TYPE2_OFF = 7

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length > 0) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)
const a = loaded.anchors

const idByName = new Map<string, number>()
loaded.species.forEach((s, i) => {
  if (s.name) idByName.set(s.name.toUpperCase(), i)
})
const typeByName = new Map<string, number>()
loaded.typeNames.forEach((n, i) => {
  if (n) typeByName.set(n.toUpperCase(), i)
})
const typeId = (name: string): number => {
  const id = typeByName.get(name.toUpperCase())
  if (id === undefined) throw new Error(`Type not in ROM: ${name}`)
  return id
}
const tn = (i: number) => loaded.typeNames[i] ?? `#${i}`

const out = new Uint8Array(bytes)
const changes: string[] = []
const skipped: string[] = []
let writes = 0

for (const r of REVERTS) {
  const id = idByName.get(r.name.toUpperCase())
  if (id === undefined) {
    skipped.push(`${r.name} (not in ROM)`)
    continue
  }
  const cur = loaded.species[id]
  const wantFrom1 = typeId(r.fromType1)
  const wantFrom2 = typeId(r.fromType2)
  // Safety: only touch a species that reads exactly the typing we expect.
  if (cur.type1 !== wantFrom1 || cur.type2 !== wantFrom2) {
    skipped.push(
      `${r.name} (ROM is ${tn(cur.type1)}/${tn(cur.type2)}, expected ${r.fromType1}/${r.fromType2})`,
    )
    continue
  }
  const to1 = typeId(r.toType1)
  const to2 = typeId(r.toType2)
  if (cur.type1 === to1 && cur.type2 === to2) continue // already correct
  const base = a.baseStats + id * a.baseStatsLen
  out[base + TYPE1_OFF] = to1
  out[base + TYPE2_OFF] = to2
  writes++
  changes.push(
    `#${String(id).padStart(3)} ${r.name.padEnd(12)} ` +
      `${tn(cur.type1)}/${tn(cur.type2)} → ${r.toType1}/${r.toType2}  (${r.note})`,
  )
}

console.log(`ROM: ${romName}  (${loaded.rom.gameCode()}, anchors ${loaded.anchorSource})`)
console.log(`type reverts: ${writes} species`)
if (skipped.length) console.log(`⚠ skipped: ${skipped.join(', ')}`)
console.log()
changes.forEach((l) => console.log('  ' + l))

if (dryRun) {
  console.log('\n--dry-run: no changes written.')
  process.exit(0)
}
if (writes === 0) {
  console.log('\nNothing to change.')
  process.exit(0)
}

// Independent re-parse: every changed species must read back the target typing.
const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length > 0) throw new Error(`Output ROM has warnings: ${check.warnings.join('; ')}`)
for (const r of REVERTS) {
  const id = idByName.get(r.name.toUpperCase())
  if (id === undefined) continue
  const want1 = typeByName.get(r.toType1.toUpperCase())!
  const want2 = typeByName.get(r.toType2.toUpperCase())!
  // Only verify the ones we actually wrote (skipped ones keep their ROM value).
  if (loaded.species[id].type1 === want1 && loaded.species[id].type2 === want2) continue
  const s = check.species[id]
  if (s.type1 !== want1 || s.type2 !== want2) {
    throw new Error(`Post-check failed for ${r.name}: got ${tn(s.type1)}/${tn(s.type2)}`)
  }
}

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = romPath.replace(/\.gba$/i, '') + `.pre-type-reverts-${stamp}.gba`
fs.copyFileSync(romPath, backupPath)
fs.writeFileSync(romPath, out)

console.log(`\n✅ ${writes} species written (${diff} bytes changed).`)
console.log(`   backup: ${backupPath.split(/[\\/]/).pop()}`)
