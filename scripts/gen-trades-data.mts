/**
 * Extract the in-game trade table from the ROM for the guide's Trades section.
 *
 * The table itself comes from `readIngameTrades`. The *town* for each trade is
 * not in the table — it lives in the NPC script — so we sweep the map banks for
 * the trade preamble (`setvar VAR_0x8008,<index>` / `copyvar VAR_0x8004,…` /
 * `special 0xA8`) and attribute each hit to the object event that owns it.
 * Trades with no script hit are recorded with `location: null`: the record is
 * authored in the table but nothing in the current build triggers it.
 *
 * Writes scripts/trades-data.json.
 *
 *   npx tsx scripts/gen-trades-data.mts "<rom.gba>" [toml]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadRom } from '../src/rom/loadRom'
import { findTradeScriptIndices } from '../src/rom/tables/ingameTrades'
import { resolveMapName } from '../src/rom/tables/wild'

const here = dirname(fileURLToPath(import.meta.url))
const romPath = process.argv[2]
if (!romPath) {
  console.error('usage: npx tsx scripts/gen-trades-data.mts "<rom.gba>" [toml]')
  process.exit(2)
}
const toml = process.argv[3] ? readFileSync(process.argv[3], 'utf8') : undefined
const r = loadRom(new Uint8Array(readFileSync(romPath)), romPath.split(/[\\/]/).pop()!, toml)
const a = r.anchors
const rom = r.rom

const title = (s: string) =>
  s.toLowerCase().replace(/(^|[\s.'’-])([a-z])/g, (_, p, c) => p + c.toUpperCase())
const speciesName = (id: number) => title(r.species[id]?.name ?? `#${id}`)
const itemName = (id: number) => (id ? title(r.itemNames[id] ?? `#${id}`) : null)

// ── map every object-event script offset to its owning map ──
interface Site {
  off: number
  bank: number
  map: number
  obj: number
  name: string
}
const sites: Site[] = []
const bankTables: number[] = []
for (let b = 0; b < 64; b++) {
  const p = rom.pointer(a.mapBanks + b * 4)
  if (p === null) break
  bankTables.push(p)
}
for (let b = 0; b < bankTables.length; b++) {
  const start = bankTables[b]
  const later = bankTables.filter((x) => x > start)
  const end = later.length ? Math.min(...later) : start + 4 * 120
  for (let m = 0; m < Math.floor((end - start) / 4); m++) {
    const hdr = rom.pointer(start + m * 4)
    if (hdr === null) continue
    const events = rom.pointer(hdr + 4)
    if (events === null) continue
    const objects = rom.pointer(events + 4)
    if (objects === null) continue
    let name = ''
    try {
      name = resolveMapName(rom, a, b, m)
    } catch {
      name = ''
    }
    const count = Math.min(rom.u8(events), 80)
    for (let i = 0; i < count; i++) {
      const script = rom.pointer(objects + i * 24 + 16)
      if (script !== null && script > 0) sites.push({ off: script, bank: b, map: m, obj: i, name })
    }
  }
}
sites.sort((x, y) => x.off - y.off)

/**
 * The object events whose script contains `off` — i.e. every site sharing the
 * nearest script start at or before it. Duplicate map banks reuse the same
 * script offset, so this returns all of them and the caller picks the live one.
 */
function ownersOf(off: number): Site[] {
  let lo = 0
  let hi = sites.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (sites[mid].off <= off) {
      best = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  if (best < 0) return []
  const start = sites[best].off
  return sites.filter((s) => s.off === start)
}

// A handful of high map banks are leftover Emerald-base maps carried into the
// hack but never wired into the world. They're distinguished by their sheer
// size (110–200 maps each, vs 5–30 for a real Johto/Kanto bank) and by mapsec
// bytes that resolve to *misleading* Johto town names — e.g. bank 28.18 reports
// "Cherrygrove City" but its mapdata pointer is a different region entirely from
// the real Cherrygrove (bank 2). The live route/dungeon banks (22–26 = routes,
// S.S. Aqua; 29 = Embedded Tower) are NOT leftovers, so this is an explicit set
// rather than a "bank > N" cutoff, which would wrongly kill those.
const LEFTOVER_BANKS = new Set([27, 28, 30, 31])
const isLive = (bank: number) => !LEFTOVER_BANKS.has(bank)

const scriptHits = findTradeScriptIndices(rom, r.ingameTrades.length)
const out = r.ingameTrades.map((t) => {
  const owners = (scriptHits.get(t.index) ?? []).flatMap((off) => ownersOf(off))
  const live = owners.filter((s) => isLive(s.bank))
  const pick = live[0] ?? owners[0] ?? null
  return {
    index: t.index,
    offset: `0x${t.offset.toString(16)}`,
    give: speciesName(t.requestedSpecies),
    get: speciesName(t.species),
    nickname: title(t.nickname),
    otName: title(t.otName),
    heldItem: itemName(t.heldItem),
    ivs: t.ivs,
    location: pick ? title(pick.name) : null,
    npcMap: pick ? `${pick.bank}.${pick.map}` : null,
    npcObject: pick ? pick.obj : null,
    reachable: owners.length > 0,
    /** True only when the NPC sits on a live Johto/Kanto map, not a leftover Emerald-base one. */
    live: live.length > 0,
  }
})

writeFileSync(resolve(here, 'trades-data.json'), JSON.stringify(out, null, 1) + '\n')
const wired = out.filter((t) => t.reachable).length
const inWorld = out.filter((t) => t.live).length
console.log(
  `wrote trades-data.json — ${out.length} records, ${wired} wired to an NPC, ${inWorld} on live maps`,
)
for (const t of out) {
  console.log(
    `  ${String(t.index).padStart(2)}  ${t.give} → ${t.get} “${t.nickname}” (OT ${t.otName})` +
      `${t.heldItem ? `, holds ${t.heldItem}` : ''} — ` +
      `${t.location ?? 'no NPC in this build'}${t.reachable && !t.live ? ' (leftover Emerald-base map)' : ''}`,
  )
}
