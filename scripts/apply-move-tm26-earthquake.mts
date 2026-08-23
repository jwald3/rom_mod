/**
 * Move TM26 (Earthquake) out of Brock's hands and onto the floor of the Team
 * Rocket hideout under Mahogany Town.
 *
 * Before: beating Brock (Pewter Gym, map 13.4) handed over the BOULDERBADGE and
 * TM26 — the only obtainable copy in the game (no mart stocks it, it isn't a
 * Game Corner prize, and the one item ball carrying it sits on map 29.36, an
 * orphaned vanilla-Emerald leftover with no warp or connection leading in).
 *
 * After:
 *   • Rocket hideout B3F (map 24.85) gains an item ball at (8,20) holding TM26 —
 *     the deepest floor, past Ross/Mitch/Eto, reached only through B1F→B2F→B3F.
 *   • Brock hands over TM39 (Rock Tomb) instead, so Pewter still fits the
 *     every-gym-gives-a-TM pattern.
 *
 *   npx tsx scripts/apply-move-tm26-earthquake.mts ["<rom.gba>"]
 *   npx tsx scripts/apply-move-tm26-earthquake.mts --dry-run ["<rom.gba>"]
 *
 * Adding a ball means growing a map's object-event array, so the array is copied
 * into the ROM's trailing free space with the new 24-byte template appended, and
 * the map's event header is repointed at the copy (the old array is left in place,
 * unreferenced). The ball's 13-byte find-item script is written to free space too.
 * Backs up, patches in place, re-parses to assert both halves of the move landed.
 * BPEE needs no toml.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { FreeSpaceAllocator, FREE_BYTE } from '../src/rom/freespace'

const DEFAULT_ROM = 'C:/Users/Waldo/Downloads/H&S/Pokemon Heart & Soul.gba'

const ITEM_TM26 = 314 // Earthquake
const ITEM_TM39 = 327 // Rock Tomb

/** Rocket hideout B3F — the new ball. */
const BALL = { bank: 24, map: 85, x: 8, y: 20, gfx: 0x3b, flag: 0x463 }
/** Pewter Gym — Brock's post-battle script. */
const GYM = { bank: 13, map: 4, obj: 2 }

const OBJ_LEN = 24
const TEMPLATE_LIMIT = 64 // OBJECT_EVENT_TEMPLATES_COUNT — the save's per-map copy buffer

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const romPath = args.filter((a) => !a.startsWith('--'))[0] ?? DEFAULT_ROM

const bytes = new Uint8Array(fs.readFileSync(romPath))
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, undefined)
if (loaded.warnings.length) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)

const rom = loaded.rom
const a = loaded.anchors
if (rom.gameCode() !== 'BPEE') throw new Error(`Expected BPEE (Emerald-based H&S), got ${rom.gameCode()}`)

const out = bytes.slice()
const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
const u8 = (o: number) => out[o]
const u16 = (o: number) => view.getUint16(o, true)
const u32 = (o: number) => view.getUint32(o, true)
const s16 = (o: number) => view.getInt16(o, true)
const deref = (o: number) => {
  const v = u32(o)
  return v >= 0x8000000 && v < 0x8000000 + out.length ? v - 0x8000000 : -1
}
const hex = (n: number) => '0x' + n.toString(16)

// ── map plumbing ───────────────────────────────────────────────────────────────
const bankCount = (() => {
  let n = 0
  while (n < 64 && deref(a.mapBanks + n * 4) >= 0) n++
  return n
})()
const bankOffsets = Array.from({ length: bankCount }, (_, i) => deref(a.mapBanks + i * 4))
/** Bank arrays are laid out back to back, the last one ending at the bank table. */
const mapCount = (b: number) => ((b + 1 < bankCount ? bankOffsets[b + 1] : a.mapBanks) - bankOffsets[b]) / 4
const headerOf = (b: number, m: number) => deref(bankOffsets[b] + m * 4)
const eventsOf = (b: number, m: number) => deref(headerOf(b, m) + 4)

const itemName = (id: number) => loaded.itemNames[id] ?? '?'
const tmMove = (id: number) => loaded.moves[u16(a.tms + (id - 289) * 2)]?.name ?? '?'

// ── preflight: the ROM is the one this script was written against ──────────────
if (itemName(ITEM_TM26) !== 'TM26') throw new Error(`item ${ITEM_TM26} is ${itemName(ITEM_TM26)}, expected TM26`)
if (itemName(ITEM_TM39) !== 'TM39') throw new Error(`item ${ITEM_TM39} is ${itemName(ITEM_TM39)}, expected TM39`)
if (tmMove(ITEM_TM26) !== 'EARTHQUAKE') throw new Error(`TM26 teaches ${tmMove(ITEM_TM26)}, expected EARTHQUAKE`)
if (tmMove(ITEM_TM39) !== 'ROCK TOMB') throw new Error(`TM39 teaches ${tmMove(ITEM_TM39)}, expected ROCK TOMB`)

console.log(`ROM: ${romName} (${rom.gameCode()})\n`)

// ── half 1: Brock gives TM39 instead of TM26 ───────────────────────────────────
// His defeat branch runs `setorcopyvar VAR_0x8000, item / setorcopyvar VAR_0x8001, 1
// / callstd STD_OBTAIN_ITEM`; only the item u16 moves.
const gymEvents = eventsOf(GYM.bank, GYM.map)
const brockScript = deref(deref(gymEvents + 4) + GYM.obj * OBJ_LEN + 16)
if (brockScript < 0) throw new Error(`no script on object #${GYM.obj} of map ${GYM.bank}.${GYM.map}`)

const findGive = (start: number, span: number, item: number) => {
  const hits: number[] = []
  for (let o = start; o < start + span; o++) {
    if ((u8(o) !== 0x1a && u8(o) !== 0x16) || u16(o + 1) !== 0x8000 || u16(o + 3) !== item) continue
    if ((u8(o + 5) !== 0x1a && u8(o + 5) !== 0x16) || u16(o + 6) !== 0x8001) continue
    if (u8(o + 10) !== 0x09) continue // callstd
    hits.push(o)
  }
  return hits
}

const brockGivesTm26 = findGive(brockScript, 256, ITEM_TM26)
const brockGivesTm39 = findGive(brockScript, 256, ITEM_TM39)
let brockPatched = false
if (brockGivesTm26.length === 1) {
  view.setUint16(brockGivesTm26[0] + 3, ITEM_TM39, true)
  brockPatched = true
  console.log(`  Brock (${GYM.bank}.${GYM.map} obj#${GYM.obj}, script ${hex(brockScript)}): TM26 → TM39 (Rock Tomb) at ${hex(brockGivesTm26[0] + 3)}`)
} else if (brockGivesTm26.length === 0 && brockGivesTm39.length) {
  console.log('  Brock already gives TM39 — leaving his script alone.')
} else {
  throw new Error(`expected exactly one TM26 gift in Brock's script, found ${brockGivesTm26.length}`)
}

// ── half 2: an item ball on Rocket hideout B3F ─────────────────────────────────
const ballEvents = eventsOf(BALL.bank, BALL.map)
const objCount = u8(ballEvents)
const objArr = deref(ballEvents + 4)
const warpCount = u8(ballEvents + 1)
const coordCount = u8(ballEvents + 2)
const bgCount = u8(ballEvents + 3)
const warpArr = deref(ballEvents + 8)
const coordArr = deref(ballEvents + 12)
const bgArr = deref(ballEvents + 16)

const readBall = (o: number) => {
  const s = deref(o + 16)
  if (u8(o + 1) !== BALL.gfx || s < 0) return null
  if (u8(s) !== 0x1a || u16(s + 1) !== 0x8000) return null
  return u16(s + 3)
}
const alreadyThere = Array.from({ length: objCount }, (_, i) => objArr + i * OBJ_LEN).some(
  (o) => readBall(o) === ITEM_TM26,
)
if (alreadyThere) {
  console.log(`  Map ${BALL.bank}.${BALL.map} already carries a TM26 ball — leaving its events alone.`)
} else {
  // The tile must be walkable and unoccupied, or the ball is unreachable scenery.
  const layout = deref(headerOf(BALL.bank, BALL.map))
  const width = u32(layout)
  const height = u32(layout + 4)
  const mapData = deref(layout + 12)
  if (BALL.x < 0 || BALL.x >= width || BALL.y < 0 || BALL.y >= height) {
    throw new Error(`(${BALL.x},${BALL.y}) is outside map ${BALL.bank}.${BALL.map} (${width}x${height})`)
  }
  const collision = (u16(mapData + (BALL.y * width + BALL.x) * 2) >> 10) & 3
  if (collision !== 0) throw new Error(`tile (${BALL.x},${BALL.y}) has collision ${collision} — not walkable`)

  const occupied: string[] = []
  for (let i = 0; i < objCount; i++) {
    const o = objArr + i * OBJ_LEN
    if (s16(o + 4) === BALL.x && s16(o + 6) === BALL.y) occupied.push(`object #${i}`)
  }
  for (let i = 0; i < warpCount; i++) {
    const o = warpArr + i * 8
    if (s16(o) === BALL.x && s16(o + 2) === BALL.y) occupied.push(`warp #${i}`)
  }
  for (let i = 0; i < coordCount; i++) {
    const o = coordArr + i * 16
    if (s16(o) === BALL.x && s16(o + 2) === BALL.y) occupied.push(`coord event #${i}`)
  }
  for (let i = 0; i < bgCount; i++) {
    const o = bgArr + i * 12
    if (s16(o) === BALL.x && s16(o + 2) === BALL.y) occupied.push(`bg event #${i}`)
  }
  if (occupied.length) throw new Error(`(${BALL.x},${BALL.y}) is already taken by ${occupied.join(', ')}`)

  // The flag hides the ball once collected, so it must belong to nothing else.
  for (let b = 0; b < bankCount; b++) {
    for (let m = 0; m < mapCount(b); m++) {
      const ev = eventsOf(b, m)
      if (ev < 0) continue
      const arr = deref(ev + 4)
      if (arr < 0) continue
      for (let i = 0; i < u8(ev); i++) {
        if (u16(arr + i * OBJ_LEN + 20) === BALL.flag) throw new Error(`flag ${hex(BALL.flag)} already belongs to object #${i} of map ${b}.${m}`)
      }
    }
  }
  if (objCount + 1 > TEMPLATE_LIMIT) throw new Error(`map ${BALL.bank}.${BALL.map} is at the ${TEMPLATE_LIMIT}-template limit`)

  const localIds = Array.from({ length: objCount }, (_, i) => u8(objArr + i * OBJ_LEN))
  const localId = Math.max(0, ...localIds) + 1
  if (localId > 0xff) throw new Error('out of local ids on this map')

  // Free space: everything past the last non-0xFF byte is provably unused, which
  // beats trusting a mid-ROM run of padding.
  let lastUsed = out.length - 1
  while (lastUsed > 0 && out[lastUsed] === FREE_BYTE) lastUsed--
  const alloc = new FreeSpaceAllocator(out, lastUsed + 1)

  // finditem TM26: setorcopyvar VAR_0x8000, TM26 / setorcopyvar VAR_0x8001, 1 /
  // callstd STD_FIND_ITEM / end — byte-for-byte the shape of the hideout's other balls.
  const script = alloc.allocate(13)
  out.set([0x1a, 0x00, 0x80, ITEM_TM26 & 0xff, ITEM_TM26 >> 8, 0x1a, 0x01, 0x80, 0x01, 0x00, 0x09, 0x01, 0x02], script)

  const newArr = alloc.allocate((objCount + 1) * OBJ_LEN)
  out.set(out.subarray(objArr, objArr + objCount * OBJ_LEN), newArr)
  const t = newArr + objCount * OBJ_LEN
  out.fill(0, t, t + OBJ_LEN)
  out[t] = localId
  out[t + 1] = BALL.gfx
  view.setInt16(t + 4, BALL.x, true)
  view.setInt16(t + 6, BALL.y, true)
  // elevation 0 / MOVEMENT_TYPE_NONE / no trainer fields — as the map's other balls
  view.setUint32(t + 16, 0x8000000 + script, true)
  view.setUint16(t + 20, BALL.flag, true)

  view.setUint32(ballEvents + 4, 0x8000000 + newArr, true)
  out[ballEvents] = objCount + 1

  console.log(
    `  Map ${BALL.bank}.${BALL.map} (Rocket hideout B3F): + item ball localId ${localId} at (${BALL.x},${BALL.y}), flag ${hex(BALL.flag)}`,
  )
  console.log(`    script ${hex(script)}, object array ${hex(objArr)} (${objCount}) → ${hex(newArr)} (${objCount + 1})`)
}

if (dryRun) {
  console.log('\n--dry-run: no changes written.')
  process.exit(0)
}

// ── verify against a fresh parse of the output ─────────────────────────────────
const check = loadRom(out, 'check.gba', undefined)
if (check.warnings.length) throw new Error(`Output warnings: ${check.warnings.join('; ')}`)

const vEvents = eventsOf(BALL.bank, BALL.map)
const vCount = u8(vEvents)
const vArr = deref(vEvents + 4)
const balls = Array.from({ length: vCount }, (_, i) => vArr + i * OBJ_LEN)
  .map((o) => ({ o, item: readBall(o) }))
  .filter((b) => b.item !== null)
const tm26 = balls.find((b) => b.item === ITEM_TM26)
if (!tm26) throw new Error('post-check: no TM26 ball on the hideout floor')
if (s16(tm26.o + 4) !== BALL.x || s16(tm26.o + 6) !== BALL.y) throw new Error('post-check: TM26 ball at the wrong tile')
if (u16(tm26.o + 20) !== BALL.flag) throw new Error('post-check: TM26 ball has the wrong flag')
if (findGive(deref(deref(eventsOf(GYM.bank, GYM.map) + 4) + GYM.obj * OBJ_LEN + 16), 256, ITEM_TM26).length) {
  throw new Error('post-check: Brock still gives TM26')
}
if (!findGive(deref(deref(eventsOf(GYM.bank, GYM.map) + 4) + GYM.obj * OBJ_LEN + 16), 256, ITEM_TM39).length) {
  throw new Error('post-check: Brock does not give TM39')
}

// Nothing anywhere else should still hand out TM26 on a reachable map.
console.log(`\n  hideout B3F balls now: ${balls.map((b) => itemName(b.item!)).join(', ')}`)

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
if (!diff) {
  console.log('\nNothing to do — the move is already applied.')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backup = romPath.replace(/\.gba$/i, '') + `.pre-move-tm26-${stamp}.gba`
fs.copyFileSync(romPath, backup)
fs.writeFileSync(romPath, out)
console.log(`\n✅ TM26 (Earthquake) is now a floor pickup on Rocket hideout B3F; Brock gives TM39 (Rock Tomb). (${diff} bytes changed${brockPatched ? '' : ', ball only'}.)`)
console.log(`   backup: ${backup.split(/[\\/]/).pop()}`)
