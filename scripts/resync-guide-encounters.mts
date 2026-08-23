/**
 * Rewrite the guide's per-zone encounter tables (level range + species list)
 * from the ROM, for the zones named on the command line (every zone with --all,
 * or every Kanto zone with --kanto). Companion to verify-guide-encounters.mts, which only reports
 * species mismatches; this one fixes the tables after an encounter edit.
 *
 *   npx tsx scripts/resync-guide-encounters.mts --all "<rom.gba>"
 *   npx tsx scripts/resync-guide-encounters.mts --kanto "<rom.gba>"
 *   npx tsx scripts/resync-guide-encounters.mts --dry-run --all "<rom.gba>"
 *   npx tsx scripts/resync-guide-encounters.mts "<rom.gba>" "Route 12" "Mt. Moon"
 *
 * A zone is only rewritten when every part of its (possibly combined, e.g.
 * "Route 2 / Viridian Forest") name resolves to a ROM wild area, so a typo
 * silently skips rather than blanking a table. Species display names are taken
 * from the spellings already used elsewhere in the guide, falling back to
 * title-case for names the guide has never printed.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { WILD_KINDS, type WildKind } from '../src/rom/tables/wild'

const GUIDE = 'heart-and-soul-guide.html'

const KANTO = new Set(
  [
    'PALLET TOWN', 'VIRIDIAN CITY', 'PEWTER CITY', 'CERULEAN CITY', 'VERMILION CITY',
    'LAVENDER TOWN', 'CELADON CITY', 'SAFFRON CITY', 'FUCHSIA CITY', 'CINNABAR ISLAND',
    'VIRIDIAN FOREST', 'MT MOON', 'DIGLETTS CAVE', 'ROCK TUNNEL', 'SEAFOAM ISLANDS',
    'CERULEAN CAVE', 'POWER PLANT',
    ...Array.from({ length: 25 }, (_, i) => `ROUTE ${i + 1}`),
  ].map((n) => n.replace(/[^A-Z0-9]/g, '')),
)

/**
 * Gen-5+ species the guide deliberately doesn't document (see
 * apply-remove-postgen4-species.mts). The ROM no longer spawns any of them, so
 * this is a backstop: if one ever reappears in a wild slot, the tables stay
 * clean and the discrepancy shows up in verify-guide-encounters instead.
 */
const POST_GEN4_NAMES = new Set(
  ['REGIDRAGO', 'REGIELEKI', 'SYLVEON', 'ANNIHILAPE', 'FARIGIRAF', 'DUDUNSPARC', 'WYRDEER', 'URSALUNA', 'KLEAVOR'],
)

/** Guide row label → ROM wild kind. */
const KIND: Record<string, WildKind> = {
  GRASS: 'grass', SURF: 'surf', SURFING: 'surf', FISH: 'fish', FISHING: 'fish',
  ROCKSMASH: 'tree', HEADBUTT: 'tree',
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const kantoMode = args.includes('--kanto')
const allMode = args.includes('--all')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const onlyZones = positional.slice(1)
if (!romPath) { console.error('usage: npx tsx scripts/resync-guide-encounters.mts [--dry-run] [--all|--kanto] "<rom.gba>" [zone...]'); process.exit(2) }
if (!allMode && !kantoMode && !positional.slice(1).length) { console.error('nothing selected: pass --all, --kanto, or zone names'); process.exit(2) }

const r = loadRom(new Uint8Array(readFileSync(romPath)), romPath.split(/[\\/]/).pop()!, undefined)
if (r.warnings.length) throw new Error(`ROM warnings: ${r.warnings.join('; ')}`)
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

// ── ROM: per zone name, per kind → species (slot order) + level span ───────────
interface KindData { species: string[]; lo: number; hi: number }
const romByZone = new Map<string, Partial<Record<WildKind, KindData>>>()
for (const area of r.wildAreas) {
  const key = norm(area.name)
  if (!romByZone.has(key)) romByZone.set(key, {})
  const rec = romByZone.get(key)!
  for (const kind of WILD_KINDS) {
    const g = area.groups[kind]
    if (!g) continue
    const cur = rec[kind] ?? { species: [], lo: 99, hi: 0 }
    for (const s of g.slots) {
      if (!s.species) continue
      const name = r.species[s.species]?.name ?? `#${s.species}`
      if (POST_GEN4_NAMES.has(name)) continue
      if (!cur.species.includes(name)) cur.species.push(name)
      cur.lo = Math.min(cur.lo, s.low)
      cur.hi = Math.max(cur.hi, s.high)
    }
    if (cur.species.length) rec[kind] = cur
  }
}

/** "Route 2 / Viridian Forest", "Route 24 / 25" → the union of its parts. */
function partsOf(name: string): string[] {
  const parts = name.split('/').map((p) => p.trim())
  if (parts.length < 2) return [name]
  // "Route 5 / 6" → the bare "6" inherits "Route " from the first part.
  const base = (parts[0].match(/^(.*?)\d+\s*$/) || [])[1] ?? ''
  return parts.map((p) => (/^\d+$/.test(p) && base ? base + p : p))
}
function romRecordFor(name: string): Partial<Record<WildKind, KindData>> | null {
  const names = partsOf(name)
  const recs = names.map((p) => romByZone.get(norm(p)))
  if (recs.some((x) => !x)) return null
  const merged: Partial<Record<WildKind, KindData>> = {}
  for (const rec of recs as Partial<Record<WildKind, KindData>>[]) {
    for (const kind of WILD_KINDS) {
      const k = rec[kind]
      if (!k) continue
      const cur = merged[kind] ?? { species: [], lo: 99, hi: 0 }
      for (const s of k.species) if (!cur.species.includes(s)) cur.species.push(s)
      cur.lo = Math.min(cur.lo, k.lo)
      cur.hi = Math.max(cur.hi, k.hi)
      merged[kind] = cur
    }
  }
  return merged
}

let html = readFileSync(GUIDE, 'utf8')

// ── display names: prefer the spelling the guide already uses ─────────────────
const display = new Map<string, string>()
for (const m of html.matchAll(/<td class="lv">[^<]*<\/td>\s*<td>([^<]*)<\/td>/g)) {
  for (const raw of m[1].split(',')) {
    const nameText = raw.replace(/&nbsp;/g, ' ').trim()
    if (nameText) display.set(norm(nameText), nameText)
  }
}
const titleCase = (romName: string) =>
  romName
    .toLowerCase()
    .replace(/(^|[\s.'’\-])([a-z0-9])/g, (_, sep, ch) => sep + ch.toUpperCase())
    .replace(/^Mr\.mime$/i, 'Mr. Mime')
const unknown = new Set<string>()
function pretty(romName: string): string {
  const known = display.get(norm(romName))
  if (known) return known
  unknown.add(romName)
  return titleCase(romName)
}

// ── rewrite the tables ────────────────────────────────────────────────────────
const zoneRe = /(<h4 class="zone-name">([^<]+)<\/h4>)([\s\S]*?)(<\/aside>)/g
let zonesTouched = 0
let rowsTouched = 0
const skipped: string[] = []

html = html.replace(zoneRe, (whole, head, zoneName: string, body: string, tail) => {
  const name = zoneName.trim()
  const wanted = onlyZones.length
    ? onlyZones.some((z) => norm(z) === norm(name) || partsOf(name).some((p) => norm(p) === norm(z)))
    : allMode || (kantoMode && partsOf(name).every((p) => KANTO.has(norm(p))))
  if (!wanted) return whole
  const rec = romRecordFor(name)
  if (!rec) { skipped.push(`${name} (no ROM area)`); return whole }

  let changed = 0
  const newBody = body.replace(
    /(<th>)([^<]+)(<\/th>\s*<td class="lv">)([^<]*)(<\/td>\s*<td>)([^<]*)(<\/td>)/g,
    (row, a, label: string, b, lvCell: string, c, spCell: string, d) => {
      const kind = KIND[norm(label.replace(/&nbsp;/g, ' '))] // "Rock&nbsp;Smash"
      if (!kind) return row
      const data = rec[kind]
      if (!data || !data.species.length) return row
      const lv = data.lo === data.hi ? `Lv&nbsp;${data.lo}` : `Lv&nbsp;${data.lo}–${data.hi}`
      const species = data.species.map(pretty).join(', ')
      if (lv === lvCell && species === spCell) return row
      changed++
      return `${a}${label}${b}${lv}${c}${species}${d}`
    },
  )
  if (!changed) return whole
  zonesTouched++
  rowsTouched += changed
  console.log(`  ${name}: ${changed} row(s)`)
  return head + newBody + tail
})

console.log(`\n${rowsTouched} row(s) across ${zonesTouched} zone(s).`)
if (unknown.size) console.log(`Names the guide had never printed (title-cased): ${[...unknown].join(', ')}`)
if (skipped.length) console.log(`Skipped: ${skipped.join('; ')}`)
if (dryRun) { console.log('\n--dry-run: guide not written.'); process.exit(0) }
if (rowsTouched) {
  writeFileSync(GUIDE, html, 'utf8')
  console.log(`\n✅ ${GUIDE} updated.`)
}
