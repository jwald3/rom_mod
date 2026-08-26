/**
 * Open every area of the Johto (Baoba) Safari Zone at once — drop the phased
 * expansion gates.
 *
 * The Johto Safari Zone sits west of Cianwood (Cliff Cave → Route 47 → Route 48
 * → Safari Zone Gate) and is a 2×3 grid of connected areas, entered from the
 * gate into the bottom-centre one:
 *
 *     26.11 ── 26.16 ── 26.17          26.16/26.12 open from the outset
 *       │        │        │            26.11/26.14 need Baoba's 1st expansion
 *     26.14 ── 26.12 ── 26.15          26.15/26.17 need Baoba's 2nd expansion
 *                │
 *             26.13 (gate corridor)
 *
 * The gates are not terrain — they are eight "Sorry Trainer, this area is still
 * under construction" NPCs (script 0x3768c0, graphicsId 53) standing on the four
 * chokepoints out of 26.12 and 26.16. Each is hidden by a flag:
 *
 *   FLAG 0x307 — set by Baoba's "the SAFARI ZONE has expanded!" call
 *   FLAG 0x308 — set by Baoba's "expanded again … fully realized!" call
 *
 * This script deletes those eight object-event templates outright, so the areas
 * are open on every save regardless of which calls have fired. The blockers are
 * the first four templates in each map's object array, so deleting them is just
 * "advance the array pointer by 4 entries, drop the count by 4" — no repointing
 * into free space and no renumbering of the surviving objects.
 *
 * With --entrance it also deletes the two workers in Cliff Cave (24.18) that
 * hold the path shut until FLAG 0x3aa — i.e. until the Olivine / Jasmine story
 * beat — so the Safari is reachable from the start of the game. Note that
 * walking into the Safari Zone Gate map sets VAR 0x405e to 3 (Baoba's arrival
 * cutscene), which skips his first two phone calls if you get there early.
 *
 *   npx tsx scripts/apply-safari-open-all.mts ["<rom.gba>"]
 *   npx tsx scripts/apply-safari-open-all.mts --entrance ["<rom.gba>"]
 *   npx tsx scripts/apply-safari-open-all.mts --dry-run ["<rom.gba>"]
 *
 * Backs up, then re-parses the written ROM to assert the blockers are gone, the
 * surviving objects are byte-identical, and a flood fill from the gate entrance
 * reaches all six areas. BPEE needs no toml.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'

const DEFAULT_ROM = 'C:/Users/Waldo/Downloads/H&S/Pokemon Heart & Soul.gba'

const MAP_BANKS = 0xf39750
const OBJ_TEMPLATE_LEN = 24
/** Object-event template offsets (Emerald): x/y, script, flagId. */
const OBJ_X = 4
const OBJ_Y = 6
const OBJ_SCRIPT = 16
const OBJ_FLAG = 20
/** The shared "this area is still under construction" NPC script. */
const BLOCKER_SCRIPT = 0x3768c0

interface Target {
  bank: number
  map: number
  label: string
  /** flagIds whose objects are the gates to delete */
  flags: number[]
}

const AREA_GATES: Target[] = [
  { bank: 26, map: 12, label: 'Safari Zone — south-centre (entrance area)', flags: [0x307, 0x308] },
  { bank: 26, map: 16, label: 'Safari Zone — north-centre', flags: [0x307, 0x308] },
]
const ENTRANCE_GATE: Target[] = [
  { bank: 24, map: 18, label: 'Cliff Cave — path to the Safari Zone', flags: [0x3aa] },
]

/** Every area of the Johto Safari Zone, for the reachability post-check. */
const SAFARI_AREAS = [
  [26, 11],
  [26, 12],
  [26, 14],
  [26, 15],
  [26, 16],
  [26, 17],
] as const
/** Where the gate corridor (26.13) drops the player into 26.12. */
const ENTRY = { bank: 26, map: 12, x: 18, y: 28 }

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const withEntrance = args.includes('--entrance')
const romPath = args.filter((s) => !s.startsWith('--'))[0] ?? DEFAULT_ROM

const bytes = new Uint8Array(fs.readFileSync(romPath))
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, undefined)
if (loaded.warnings.length) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)
if (loaded.rom.gameCode() !== 'BPEE') throw new Error(`Expected BPEE (Emerald-based H&S), got ${loaded.rom.gameCode()}`)

// ---------------------------------------------------------------- ROM reading

const view = (buf: Uint8Array) => new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

function u8(buf: Uint8Array, off: number) {
  return buf[off]
}
function u16(buf: Uint8Array, off: number) {
  return view(buf).getUint16(off, true)
}
function i16(buf: Uint8Array, off: number) {
  return view(buf).getInt16(off, true)
}
function u32(buf: Uint8Array, off: number) {
  return view(buf).getUint32(off, true)
}
function pointer(buf: Uint8Array, off: number): number {
  const v = u32(buf, off)
  if (v < 0x08000000 || v >= 0x0a000000) throw new Error(`not a GBA pointer at ${hex(off)}: ${hex(v)}`)
  return v - 0x08000000
}
const hex = (n: number) => `0x${n.toString(16)}`

function mapHeader(buf: Uint8Array, bank: number, map: number): number {
  return pointer(buf, pointer(buf, MAP_BANKS + bank * 4) + map * 4)
}
/** MapEvents: u8 objectCount, warpCount, coordCount, bgCount; then four pointers. */
function mapEvents(buf: Uint8Array, bank: number, map: number) {
  const events = pointer(buf, mapHeader(buf, bank, map) + 4)
  const objectCount = u8(buf, events)
  // maps with no objects leave the array pointer null
  const objects = objectCount === 0 ? 0 : pointer(buf, events + 4)
  return { events, objectCount, objects }
}
function objectTemplate(buf: Uint8Array, base: number, i: number) {
  const o = base + i * OBJ_TEMPLATE_LEN
  return {
    offset: o,
    localId: u8(buf, o),
    graphicsId: u8(buf, o + 1),
    x: i16(buf, o + OBJ_X),
    y: i16(buf, o + OBJ_Y),
    script: u32(buf, o + OBJ_SCRIPT),
    flagId: u16(buf, o + OBJ_FLAG),
    raw: buf.slice(o, o + OBJ_TEMPLATE_LEN),
  }
}

// ------------------------------------------------------------------- the edit

interface Edit {
  offset: number
  size: 1 | 4
  value: number
  what: string
}

const targets = [...AREA_GATES, ...(withEntrance ? ENTRANCE_GATE : [])]
const edits: Edit[] = []
/** Templates we expect to survive each map, to diff after writing. */
const survivors = new Map<string, Uint8Array[]>()

console.log(`ROM: ${romName}\n`)

for (const t of targets) {
  const { events, objectCount, objects } = mapEvents(bytes, t.bank, t.map)
  const all = Array.from({ length: objectCount }, (_, i) => objectTemplate(bytes, objects, i))
  const gateIdx = all
    .map((o, i) => (t.flags.includes(o.flagId) ? i : -1))
    .filter((i) => i >= 0)

  if (gateIdx.length === 0) {
    console.log(`${t.bank}.${t.map}  ${t.label}\n   already open — no gate objects found\n`)
    continue
  }
  // Deleting by trimming the array only works if the gates sit at one end.
  const isPrefix = gateIdx.every((v, i) => v === i)
  const isSuffix = gateIdx.every((v, i) => v === objectCount - gateIdx.length + i)
  if (!isPrefix && !isSuffix) {
    throw new Error(
      `${t.bank}.${t.map}: gate objects at indices [${gateIdx}] are not a prefix or suffix of the ` +
        `${objectCount}-object array — trimming would drop the wrong templates`,
    )
  }

  console.log(`${t.bank}.${t.map}  ${t.label}`)
  for (const i of gateIdx) {
    const o = all[i]
    const shared = o.script === BLOCKER_SCRIPT + 0x08000000 ? ' (under-construction NPC)' : ''
    console.log(
      `   drop obj[${i}] localId ${o.localId} gfx ${o.graphicsId} at (${o.x},${o.y}) ` +
        `flag ${hex(o.flagId)}${shared}`,
    )
  }

  edits.push({
    offset: events,
    size: 1,
    value: objectCount - gateIdx.length,
    what: `${t.bank}.${t.map} objectCount ${objectCount} → ${objectCount - gateIdx.length}`,
  })
  if (isPrefix) {
    const moved = objects + gateIdx.length * OBJ_TEMPLATE_LEN
    edits.push({
      offset: events + 4,
      size: 4,
      value: moved + 0x08000000,
      what: `${t.bank}.${t.map} objectEvents ${hex(objects)} → ${hex(moved)}`,
    })
  }
  survivors.set(
    `${t.bank}.${t.map}`,
    all.filter((_, i) => !gateIdx.includes(i)).map((o) => o.raw),
  )
  console.log(`   → ${objectCount} objects, ${objectCount - gateIdx.length} kept\n`)
}

if (edits.length === 0) {
  console.log('Nothing to do — every gate is already gone.')
  process.exit(0)
}

const out = new Uint8Array(bytes)
const outView = new DataView(out.buffer)
for (const e of edits) {
  if (e.size === 1) outView.setUint8(e.offset, e.value)
  else outView.setUint32(e.offset, e.value, true)
  console.log(`   ${hex(e.offset)}  ${e.what}`)
}

// ------------------------------------------------------------------ verifying

/** Walk the connection graph, placing every reachable map in one global grid. */
function placeMaps(buf: Uint8Array, bank: number, map: number) {
  const placed = new Map<string, { bank: number; map: number; w: number; h: number; data: number; blocked: Set<string>; ox: number; oy: number }>()
  const info = (g: number, m: number) => {
    const header = mapHeader(buf, g, m)
    const layout = pointer(buf, header)
    const w = view(buf).getInt32(layout, true)
    const h = view(buf).getInt32(layout + 4, true)
    const data = pointer(buf, layout + 12)
    const { objectCount, objects } = mapEvents(buf, g, m)
    const blocked = new Set<string>()
    for (let i = 0; i < objectCount; i++) {
      const o = objectTemplate(buf, objects, i)
      // flagId != 0 means the object can be hidden; assume the flag is unset
      // (worst case) so a surviving gate still shows up as a wall.
      blocked.add(`${o.x},${o.y}`)
    }
    const connPtr = u32(buf, header + 12)
    const conns: { dir: number; off: number; bank: number; map: number }[] = []
    if (connPtr >= 0x08000000) {
      const c = connPtr - 0x08000000
      const n = u32(buf, c)
      if (n > 0 && n < 20) {
        const arr = pointer(buf, c + 4)
        for (let i = 0; i < n; i++) {
          const o = arr + i * 12
          conns.push({ dir: u32(buf, o), off: view(buf).getInt32(o + 4, true), bank: u8(buf, o + 8), map: u8(buf, o + 9) })
        }
      }
    }
    return { w, h, data, blocked, conns }
  }
  const walk = (g: number, m: number, ox: number, oy: number) => {
    const key = `${g}.${m}`
    if (placed.has(key)) return
    const self = info(g, m)
    placed.set(key, { bank: g, map: m, w: self.w, h: self.h, data: self.data, blocked: self.blocked, ox, oy })
    for (const c of self.conns) {
      const other = info(c.bank, c.map)
      if (c.dir === 1) walk(c.bank, c.map, ox + c.off, oy + self.h) // down
      else if (c.dir === 2) walk(c.bank, c.map, ox + c.off, oy - other.h) // up
      else if (c.dir === 3) walk(c.bank, c.map, ox - other.w, oy + c.off) // left
      else if (c.dir === 4) walk(c.bank, c.map, ox + self.w, oy + c.off) // right
    }
  }
  walk(bank, map, 0, 0)
  return placed
}

function reachableAreas(buf: Uint8Array): Set<string> {
  const placed = placeMaps(buf, ENTRY.bank, ENTRY.map)
  const tileAt = (gx: number, gy: number) => {
    for (const [key, p] of placed) {
      const x = gx - p.ox
      const y = gy - p.oy
      if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue
      const block = u16(buf, p.data + (y * p.w + x) * 2)
      const passable = ((block >> 10) & 3) === 0 && !p.blocked.has(`${x},${y}`)
      return { key, passable }
    }
    return null
  }
  const start = placed.get(`${ENTRY.bank}.${ENTRY.map}`)!
  const queue: [number, number][] = [[start.ox + ENTRY.x, start.oy + ENTRY.y]]
  const seen = new Set([queue[0].join(',')])
  const hit = new Set<string>()
  while (queue.length) {
    const [x, y] = queue.shift()!
    const tile = tileAt(x, y)
    if (!tile || !tile.passable) continue
    hit.add(tile.key)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`
      if (seen.has(k)) continue
      seen.add(k)
      queue.push([x + dx, y + dy])
    }
  }
  return hit
}

const before = reachableAreas(bytes)
const after = reachableAreas(out)
const wanted = SAFARI_AREAS.map(([b, m]) => `${b}.${m}`)
// Worst-case walkability: collision bits only, and *every* object counts as a
// wall (hidden or not). Ledges and water are not modelled, so the "before"
// number is a floor, not a claim about the live game; "after" is the assertion.
console.log(
  `\nareas reachable from the gate (worst case) — before: ${wanted.filter((k) => before.has(k)).length}/6` +
    `, after: ${wanted.filter((k) => after.has(k)).length}/6`,
)
const missing = wanted.filter((k) => !after.has(k))
if (missing.length) throw new Error(`post-check: areas still walled off after the edit: ${missing.join(', ')}`)

// the gate objects are gone, and nothing else moved
for (const t of targets) {
  const { objectCount, objects } = mapEvents(out, t.bank, t.map)
  const kept = survivors.get(`${t.bank}.${t.map}`)
  if (!kept) continue
  if (objectCount !== kept.length) throw new Error(`post-check: ${t.bank}.${t.map} count is ${objectCount}, expected ${kept.length}`)
  for (let i = 0; i < objectCount; i++) {
    const o = objectTemplate(out, objects, i)
    if (t.flags.includes(o.flagId)) throw new Error(`post-check: ${t.bank}.${t.map} still has a gate object at index ${i}`)
    if (!o.raw.every((v, k) => v === kept[i][k])) throw new Error(`post-check: ${t.bank}.${t.map} obj[${i}] does not match the original template`)
  }
}

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const expected = edits.reduce((n, e) => n + e.size, 0)
if (diff > expected) throw new Error(`post-check: ${diff} bytes changed, expected at most ${expected}`)

if (dryRun) {
  console.log(`\n(dry run — ${diff} bytes would change, nothing written)`)
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backup = romPath.replace(/\.gba$/i, '') + `.pre-safari-open-${stamp}.gba`
fs.copyFileSync(romPath, backup)
fs.writeFileSync(romPath, out)
console.log(`\n✅ Safari Zone opened${withEntrance ? ' (areas + entrance path)' : ''} — ${diff} bytes changed.`)
console.log(`   backup: ${backup.split(/[\\/]/).pop()}`)
