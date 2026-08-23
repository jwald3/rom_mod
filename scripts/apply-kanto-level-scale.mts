/**
 * Scale Kanto's wild encounters up to post-game levels.
 *
 * Kanto is badges 9–16 here — the leaders run Lv 57–69 (Brock 66, Blue 67–69) —
 * but most of the region still carries Gen-1 vanilla levels: Route 1 at 2–6,
 * Routes 5–8 at 12–20, Route 17 at 29–34. Every wild slot at or below the old
 * Kanto ceiling (Lv 34) is remapped into a 45–58 band, keeping each area's
 * relative ordering; slots already above 34 (Route 10, Rock Tunnel, Cerulean
 * Cave, the deep Seafoam/Cinnabar slots) are left exactly as they are.
 *
 * Species keep pace with the levels: a slot whose new level is past its line's
 * level-up evolution threshold is promoted (Pidgey → Pidgeot, Rattata →
 * Raticate, Magikarp → Gyarados). Only plain level evolutions are followed —
 * stone, trade, friendship and the conditional splits (Tyrogue, Wurmple,
 * Nincada) are left alone and reported.
 *
 *   npx tsx scripts/apply-kanto-level-scale.mts ["<rom.gba>"]
 *   npx tsx scripts/apply-kanto-level-scale.mts --dry-run ["<rom.gba>"]
 *
 * Slot arrays are fixed-size and unshared (verified: no two wild areas point at
 * the same list), so every edit is written in place. Backs up, re-parses to
 * assert the new levels/species, and asserts no non-Kanto area moved.
 * BPEE needs no toml.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { WILD_KINDS, WILD_KIND_LABELS } from '../src/rom/tables/wild'

const DEFAULT_ROM = 'C:/Users/Waldo/Downloads/H&S/Pokemon Heart & Soul.gba'

/** Old Kanto span → new band. Slots above IN_HI are endgame already; untouched. */
const IN_LO = 2
const IN_HI = 34
const OUT_LO = 45
const OUT_HI = 58

/** Evolution methods that are purely "reach this level" (see EVO_METHOD_LABELS). */
const LEVEL_METHODS = new Set([4, 18])
/** Level methods with a condition we can't resolve for a wild slot — reported, not followed. */
const CONDITIONAL_LEVEL_METHODS = new Set([8, 9, 10, 11, 12, 13, 14])
/**
 * Gen-5+ dex slots this project deliberately keeps out of reach (see
 * apply-remove-postgen4-species.mts). Never promote a wild slot into one —
 * note that Primeape → Annihilape (Lv 44) and Ursaring → Ursaluna (Lv 42) are
 * still live level evolutions in the ROM, so without this guard the scaled
 * Cerulean Cave / Route 28 slots would spawn them.
 */
const POST_GEN4 = new Set([439, 440, 444, 449, 450, 451, 452, 453, 454, 455])

const KANTO = new Set(
  [
    'PALLET TOWN', 'VIRIDIAN CITY', 'PEWTER CITY', 'CERULEAN CITY', 'VERMILION CITY',
    'LAVENDER TOWN', 'CELADON CITY', 'SAFFRON CITY', 'FUCHSIA CITY', 'CINNABAR ISLAND',
    'VIRIDIAN FOREST', 'MT MOON', 'DIGLETTS CAVE', 'ROCK TUNNEL', 'SEAFOAM ISLANDS',
    'CERULEAN CAVE', 'POWER PLANT',
    ...Array.from({ length: 25 }, (_, i) => `ROUTE ${i + 1}`),
  ].map((n) => n.replace(/[^A-Z0-9]/g, '')),
)

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const romPath = args.filter((s) => !s.startsWith('--'))[0] ?? DEFAULT_ROM

const bytes = new Uint8Array(fs.readFileSync(romPath))
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, undefined)
if (loaded.warnings.length) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)
if (loaded.rom.gameCode() !== 'BPEE') throw new Error(`Expected BPEE (Emerald-based H&S), got ${loaded.rom.gameCode()}`)

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const spName = (id: number) => loaded.species[id]?.name ?? `#${id}`

/** Slots at or below the old ceiling move into the band; anything above stays. */
function scaleLevel(level: number): number {
  if (level > IN_HI) return level
  const x = Math.max(level, IN_LO)
  const scaled = Math.round(OUT_LO + ((x - IN_LO) * (OUT_HI - OUT_LO)) / (IN_HI - IN_LO))
  return Math.max(level, scaled)
}

const skippedEvos = new Map<string, string>()

/** Walk a line's level-up evolutions as far as `level` allows. */
function promote(species: number, level: number): number {
  let cur = species
  for (let hops = 0; hops < 5; hops++) {
    const evos = loaded.evolutions[cur] ?? []
    const next = evos.find((e) => LEVEL_METHODS.has(e.method) && e.param <= level)
    if (!next) {
      const cond = evos.find((e) => CONDITIONAL_LEVEL_METHODS.has(e.method) && e.param <= level)
      if (cond) skippedEvos.set(spName(cur), `${spName(cur)} → ${spName(cond.target)} (method ${cond.method}, conditional)`)
      return cur
    }
    const target = next.target
    if (!target || target >= loaded.species.length || !loaded.species[target]?.name) {
      skippedEvos.set(spName(cur), `${spName(cur)} → species #${target} (target missing from this ROM)`)
      return cur
    }
    if (POST_GEN4.has(target)) {
      skippedEvos.set(spName(cur), `${spName(cur)} → ${spName(target)} (post-Gen-4, kept out of the wild)`)
      return cur
    }
    cur = target
  }
  return cur
}

interface SlotEdit { offset: number; low: number; high: number; species: number }
interface ZoneReport {
  zone: string
  before: Map<string, [number, number]>
  after: Map<string, [number, number]>
  species: Map<string, string>
}

const edits: SlotEdit[] = []
const zones = new Map<string, ZoneReport>()
let areasTouched = 0

for (const area of loaded.wildAreas) {
  if (!KANTO.has(norm(area.name))) continue
  let touched = false
  const zoneKey = area.name
  if (!zones.has(zoneKey)) zones.set(zoneKey, { zone: zoneKey, before: new Map(), after: new Map(), species: new Map() })
  const rep = zones.get(zoneKey)!

  for (const kind of WILD_KINDS) {
    const group = area.groups[kind]
    if (!group) continue
    const label = WILD_KIND_LABELS[kind]
    for (let i = 0; i < group.slots.length; i++) {
      const slot = group.slots[i]
      if (!slot.species) continue
      const low = scaleLevel(slot.low)
      const high = Math.max(low, scaleLevel(slot.high))
      const species = promote(slot.species, low)

      const b = rep.before.get(label) ?? [99, 0]
      rep.before.set(label, [Math.min(b[0], slot.low), Math.max(b[1], slot.high)])
      const af = rep.after.get(label) ?? [99, 0]
      rep.after.set(label, [Math.min(af[0], low), Math.max(af[1], high)])
      if (species !== slot.species) rep.species.set(spName(slot.species), spName(species))

      if (low === slot.low && high === slot.high && species === slot.species) continue
      edits.push({ offset: group.listOffset + i * 4, low, high, species })
      touched = true
    }
  }
  if (touched) areasTouched++
}

console.log(`ROM: ${romName} (${loaded.rom.gameCode()})\n`)
console.log(`Kanto band: Lv ${OUT_LO}–${OUT_HI} (slots above Lv ${IN_HI} untouched)\n`)
const fmt = (r: [number, number]) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}\u2013${r[1]}`)
for (const rep of [...zones.values()].sort((a, b) => a.zone.localeCompare(b.zone))) {
  const methods = [...rep.before.keys()]
    .map((m) => {
      const b = fmt(rep.before.get(m)!)
      const af = fmt(rep.after.get(m)!)
      return `${m} ${b}${b === af ? ' (kept)' : ` \u2192 ${af}`}`
    })
    .join('  |  ')
  console.log(`  ${rep.zone.padEnd(18)} ${methods}`)
  if (rep.species.size) {
    console.log(`  ${' '.repeat(18)} evolves: ${[...rep.species].map(([a, b]) => `${a}\u2192${b}`).join(', ')}`)
  }
}
const allPromotions = new Map<string, string>()
for (const rep of zones.values()) for (const [from, to] of rep.species) allPromotions.set(from, to)
if (allPromotions.size) {
  console.log(`\nSpecies promoted (${allPromotions.size} lines):`)
  const list = [...allPromotions].map(([a, b]) => `${a}→${b}`).sort()
  for (let i = 0; i < list.length; i += 4) console.log('  ' + list.slice(i, i + 4).map((s) => s.padEnd(26)).join(''))
}
console.log(`\n${edits.length} slots across ${areasTouched} wild areas in ${zones.size} zones.`)
if (skippedEvos.size) {
  console.log('\nLevel evolutions NOT followed (conditional or missing target):')
  for (const line of skippedEvos.values()) console.log(`  ${line}`)
}
if (!edits.length) { console.log('\nNothing to do — Kanto is already scaled.'); process.exit(0) }
if (dryRun) { console.log('\n--dry-run: no changes written.'); process.exit(0) }

const out = bytes.slice()
const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
for (const e of edits) {
  out[e.offset] = e.low
  out[e.offset + 1] = e.high
  view.setUint16(e.offset + 2, e.species, true)
}

// ── verify against a fresh parse ───────────────────────────────────────────────
const check = loadRom(out, 'check.gba', undefined)
if (check.warnings.length) throw new Error(`Output warnings: ${check.warnings.join('; ')}`)

const expected = new Map(edits.map((e) => [e.offset, e]))
for (const area of check.wildAreas) {
  const kanto = KANTO.has(norm(area.name))
  for (const kind of WILD_KINDS) {
    const group = area.groups[kind]
    if (!group) continue
    for (let i = 0; i < group.slots.length; i++) {
      const off = group.listOffset + i * 4
      const slot = group.slots[i]
      const want = expected.get(off)
      if (want) {
        if (slot.low !== want.low || slot.high !== want.high || slot.species !== want.species) {
          throw new Error(`post-check: slot at ${off.toString(16)} did not take`)
        }
      } else if (!kanto) {
        // untouched areas must read exactly as before
        const orig = loaded.wildAreas.find((a) => a.index === area.index)?.groups[kind]?.slots[i]
        if (orig && (orig.low !== slot.low || orig.high !== slot.high || orig.species !== slot.species)) {
          throw new Error(`post-check: non-Kanto area ${area.name} changed`)
        }
      }
    }
  }
}
const origSlots = new Map<number, { low: number; high: number; species: number }>()
for (const area of loaded.wildAreas) {
  for (const kind of WILD_KINDS) {
    const g = area.groups[kind]
    if (!g) continue
    g.slots.forEach((s, i) => origSlots.set(g.listOffset + i * 4, { ...s }))
  }
}
let lowered = 0
let stillLow = 0
for (const area of check.wildAreas) {
  if (!KANTO.has(norm(area.name))) continue
  for (const kind of WILD_KINDS) {
    const g = area.groups[kind]
    if (!g) continue
    g.slots.forEach((slot, i) => {
      if (!slot.species) return
      const orig = origSlots.get(g.listOffset + i * 4)!
      if (slot.low < orig.low || slot.high < orig.high) lowered++
      // slots that started at or below the old ceiling must have reached the band
      if (orig.low <= IN_HI && slot.low < OUT_LO) stillLow++
    })
  }
}
if (lowered) throw new Error(`post-check: ${lowered} Kanto slots came out lower than they went in`)
if (stillLow) throw new Error(`post-check: ${stillLow} Kanto slots below Lv ${OUT_LO} that should have been scaled`)

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
if (diff > edits.length * 4) throw new Error(`post-check: ${diff} bytes changed, expected at most ${edits.length * 4}`)

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backup = romPath.replace(/\.gba$/i, '') + `.pre-kanto-levels-${stamp}.gba`
fs.copyFileSync(romPath, backup)
fs.writeFileSync(romPath, out)
console.log(`\n✅ Kanto wilds scaled to Lv ${OUT_LO}–${OUT_HI} (${edits.length} slots, ${diff} bytes changed).`)
console.log(`   backup: ${backup.split(/[\\/]/).pop()}`)
