/**
 * Verify the wild-encounter tables shown in heart-and-soul-guide.html against
 * the ROM's actual encounter data, per zone and per method. Read-only.
 *
 *   npx tsx scripts/verify-guide-encounters.mts "<rom.gba>" [toml]
 *
 * For each zone the guide shows a <div class="enc"> table with Grass / Surf /
 * Fish / Rock Smash rows. We aggregate the ROM's species for every wild area
 * that resolves to the same zone name (across all map banks and time-of-day
 * variants) and diff the two sets, reporting:
 *   guide-only  = species the guide lists that the ROM never spawns there
 *   rom-only    = species the ROM spawns that the guide omits
 * Zone names that don't resolve to any ROM wild area are reported as unmatched.
 */
import { readFileSync } from 'node:fs'
import { loadRom } from '../src/rom/loadRom'

const romPath = process.argv[2]
if (!romPath) { console.error('usage: npx tsx scripts/verify-guide-encounters.mts "<rom.gba>" [toml]'); process.exit(2) }
const toml = process.argv[3] ? readFileSync(process.argv[3], 'utf8') : undefined
const r = loadRom(new Uint8Array(readFileSync(romPath)), romPath.split(/[\\/]/).pop()!, toml)
const sp = (id: number) => r.species[id]?.name ?? `#${id}`
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

// guide method label → ROM wild kind
const KIND: Record<string, 'grass' | 'surf' | 'fish' | 'tree'> = {
  GRASS: 'grass', SURF: 'surf', SURFING: 'surf', FISH: 'fish', FISHING: 'fish',
  ROCKSMASH: 'tree', HEADBUTT: 'tree',
}

/**
 * Wild areas that exist in the ROM but sit on maps no warp or connection can
 * reach: the vanilla-Emerald Hoenn Safari Zone, kept in place and re-speciesed
 * but never wired into the live map graph (its only door is the leftover Hoenn
 * Route 121 entrance, itself unreachable). They still carry MAPSEC "SAFARI
 * ZONE", so counting them would bury the real Safari Zone — Baoba's, west of
 * Cianwood, maps 26.11–26.17 — under species you can never catch. Other Hoenn
 * leftovers feed their zone's table too, but this is the only zone where the
 * dead maps outnumber the live ones.
 */
export const UNREACHABLE_AREAS = new Set(['29.76', '30.60', '30.61', '30.62', '30.63', '30.71', '30.72', '30.73'])

// ── ROM: aggregate species per zone-name, per kind (all banks + times) ──
const romByZone = new Map<string, Record<string, Set<string>>>()
for (const a of r.wildAreas) {
  if (UNREACHABLE_AREAS.has(`${a.bank}.${a.map}`)) continue
  const key = norm(a.name)
  if (!romByZone.has(key)) romByZone.set(key, { grass: new Set(), surf: new Set(), fish: new Set(), tree: new Set() })
  const rec = romByZone.get(key)!
  for (const k of ['grass', 'surf', 'fish', 'tree'] as const) {
    const g = (a.groups as any)[k]
    if (!g) continue
    for (const s of g.slots) if (s.species > 0) rec[k].add(norm(sp(s.species)))
  }
}

// ── Guide: extract each zone's enc table ──
const html = readFileSync('heart-and-soul-guide.html', 'utf8')
const zoneRe = /<h4 class="zone-name">([^<]+)<\/h4>([\s\S]*?)<\/aside>/g
interface ZoneEnc { name: string; rows: { method: string; species: string[] }[] }
const guideZones: ZoneEnc[] = []
let zm: RegExpExecArray | null
while ((zm = zoneRe.exec(html))) {
  const name = zm[1].trim()
  const encBlock = zm[2].match(/<div class="enc">([\s\S]*?)<\/div>/)
  if (!encBlock) { guideZones.push({ name, rows: [] }); continue }
  const rows: { method: string; species: string[] }[] = []
  const rowRe = /<th>([^<]+)<\/th>\s*<td class="lv">[^<]*<\/td>\s*<td>([^<]*)<\/td>/g
  let rowM: RegExpExecArray | null
  while ((rowM = rowRe.exec(encBlock[1]))) {
    const method = rowM[1].replace(/&nbsp;/g, ' ').trim()
    const species = rowM[2].split(',').map((s) => s.replace(/&nbsp;/g, ' ').replace(/&#39;|’/g, "'").trim()).filter(Boolean)
    rows.push({ method, species })
  }
  guideZones.push({ name, rows })
}

// ── diff ──
// For a guide zone name, gather the ROM species record — handling combined
// names like "Route 24 / 25", "Route 2 / Viridian Forest", "Route 8 / 7" by
// unioning the ROM records of each part.
function romRecordFor(name: string): Record<string, Set<string>> | null {
  const direct = romByZone.get(norm(name))
  if (direct) return direct
  const parts = name.split('/').map((p) => p.trim())
  if (parts.length < 2) return null
  // "Route 24 / 25" → ["Route 24", "Route 25"]; "Route 8 / 7" likewise. The base
  // is the first part's non-numeric prefix, so a bare "25" inherits "Route ".
  const base = (parts[0].match(/^(.*?)\d+\s*$/) || [])[1] ?? ''
  const expanded = parts.map((p) => (/^\d+$/.test(p) && base ? base + p : p))
  const recs = expanded.map((p) => romByZone.get(norm(p))).filter(Boolean) as Record<string, Set<string>>[]
  if (!recs.length) return null
  const merged: Record<string, Set<string>> = { grass: new Set(), surf: new Set(), fish: new Set(), tree: new Set() }
  for (const rec of recs) for (const k of ['grass', 'surf', 'fish', 'tree'] as const) rec[k].forEach((v) => merged[k].add(v))
  return merged
}

let checked = 0, cleanZones = 0
const problems: string[] = []
const unmatched: string[] = []
for (const z of guideZones) {
  if (!z.rows.length) continue
  const romRec = romRecordFor(z.name)
  if (!romRec) { unmatched.push(z.name); continue }
  checked++
  let zoneClean = true
  for (const row of z.rows) {
    const kind = KIND[norm(row.method)]
    if (!kind) continue // unknown method label (shouldn't happen)
    const romSet = romRec[kind]
    const guideSet = new Set(row.species.map(norm))
    const guideNames = new Map(row.species.map((s) => [norm(s), s]))
    const guideOnly = [...guideSet].filter((s) => !romSet.has(s)).map((s) => guideNames.get(s) ?? s)
    const romOnly = [...romSet].filter((s) => !guideSet.has(s)).map(sp2 => {
      // pretty-print ROM species name (title-case-ish from ALLCAPS)
      const orig = [...r.species].find((sp3) => norm(sp3.name) === sp2)
      return orig ? orig.name : sp2
    })
    if (guideOnly.length || romOnly.length) {
      zoneClean = false
      const parts: string[] = []
      if (guideOnly.length) parts.push(`guide-only: ${guideOnly.join(', ')}`)
      if (romOnly.length) parts.push(`ROM-only: ${romOnly.join(', ')}`)
      problems.push(`  ${z.name} · ${row.method}: ${parts.join('  |  ')}`)
    }
  }
  if (zoneClean) cleanZones++
}

console.log(`ROM: ${romPath.split(/[\\/]/).pop()} (${r.rom.gameCode()})\n`)
console.log(`Zones with encounter tables checked: ${checked}`)
console.log(`  fully matching: ${cleanZones}`)
console.log(`  with a discrepancy: ${checked - cleanZones}`)
if (unmatched.length) console.log(`  unmatched zone names (no ROM area): ${unmatched.join(', ')}`)
console.log(`\n── ${problems.length} row discrepancies ──`)
if (problems.length) console.log(problems.join('\n'))
else console.log('  (none — every guide encounter row matches the ROM ✅)')
