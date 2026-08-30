/**
 * Populate Kanto's ROCK TUNNEL (1F and B1F) with its canonical trainer roster,
 * ported from FireRed (the GPT_Mods BPRE ROM) into Heart & Soul (BPEE) —
 * replacing the old one-off BRUNO placeholder. Pick a floor with
 * `--floor=1f` (default) or `--floor=b1f`; each floor's map ids, free trainer
 * slots, and off-map relocations live in the FLOORS table. Built on the
 * reusable map-events layer
 * (src/rom/tables/mapEvents.ts, see memory/hs-map-events-recon.md).
 *
 * The port is data-driven: it READS FireRed's Rock Tunnel 1F at runtime and
 * remaps everything to H&S by NAME, so no hand-transcribed id tables:
 *  - species / moves / trainer-classes → looked up by name in H&S's tables
 *    (verified: every FR name resolves in H&S — zero unmapped).
 *  - levels → scaled into H&S's post-E4 Kanto band (Lv 45–58) with the SAME
 *    linear map apply-kanto-level-scale.mts uses for wilds, then each mon is
 *    promoted past any level-up evolution it now outgrows (Koffing→Weezing,
 *    Charmander→Charizard, …). See memory/hs-kanto-level-band.md.
 *  - bikers keep their explicit FireRed movesets; bird-keepers/twins stay on
 *    engine-default moves (hasMoves=false), same as FireRed.
 *  - overworld sprite (gfxId) is carried over verbatim (shared FR/H&S OW set).
 *
 * H&S's 1F layout is 58×40 — SMALLER than FireRed's — so three southern trainers
 * (BENNY, and the twins KIRI & JAN at y≥47) fall off the map; they're relocated
 * to verified-walkable tiles in the lower area (collision-checked against the
 * blockmap). The other nine keep their FireRed coordinates (all walkable).
 *
 * Trainer records are written into empty H&S slots (379 are free; this claims a
 * small block starting at #11, reclaimed from BRUNO). The twins share ONE record
 * (as in FireRed). Everything else — parties, trainerbattle scripts, dialogue —
 * goes into the 0xFF tail run at 0x15788dc.
 *
 *   npx tsx scripts/apply-rocktunnel-trainers.mts [--dry-run] ["<hs-rom.gba>"]
 *
 * The base ROM MUST be pre-BRUNO (13 objects on 1F). Writes a timestamped
 * .pre-rocktunnel backup, then re-parses to assert every trainer round-trips.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { RomBuffer } from '../src/rom/buffer'
import { FreeSpaceAllocator } from '../src/rom/freespace'
import { encode } from '../src/rom/charmap'
import {
  readTrainer, readTrainerClassNames, serializeParty, serializeTrainerRecord,
  partyGbaPointer, type TrainerEdit, type TrainerMon,
} from '../src/rom/tables/trainers'
import {
  resolveMapHeader, readEvents, growObjectArray, assembleTrainerbattle,
  gbaPointer, OBJECT_EVENT_LEN, type ObjectEventEdit, type Patch,
} from '../src/rom/tables/mapEvents'

const FR_ROM = 'C:/Users/Jordan/Downloads/20260426__GPT_Mods.gba'
const FR_TOML = 'C:/Users/Jordan/Downloads/20260426__GPT_Mods.toml'
const DEFAULT_HS = 'C:/Users/Jordan/Downloads/Pokemon H&S/Pokemon Heart & Soul.gba'
const FREE_FLOOR = 0x15788dc

// Level-scaling (identical to apply-kanto-level-scale.mts).
const IN_LO = 2, IN_HI = 34, OUT_LO = 45, OUT_HI = 58
const LEVEL_METHODS = new Set([4, 18])
const POST_GEN4 = new Set([439, 440, 444, 449, 450, 451, 452, 453, 454, 455])

/** One hand-placed trainer for a manual roster: a FireRed trainer record id to
 * read the team from, an H&S overworld sprite, and where to stand it. */
interface ManualTrainer {
  frId: number
  x: number
  y: number
  gfxId: number
  sight: number
  intro: string
  defeat: string
}

interface FloorConfig {
  hsHeader: number
  hsMap: [bank: number, map: number]
  /** FireRed source map to read trainer objects from (omit for a manual roster). */
  frMap?: [bank: number, map: number]
  baseObjectCount: number
  /** Empty H&S trainer slots to claim — must not overlap other floors' slots. */
  slots: number[]
  /**
   * Placement overrides keyed by FireRed record id, for trainers whose FireRed
   * coords fall off-map / on a wall in H&S. All verified walkable + unoccupied.
   * A shared record (twins/crush-kin) with two objects puts the 2nd at x+1.
   */
  relocate: Record<number, { x: number; y: number }>
  /**
   * Hand-built roster: explicit FireRed trainer record ids + placements, used
   * when the FireRed map itself has no readable trainer objects (e.g. Mt. Moon,
   * whose trainers are script-driven — see hs-mtmoon-script-trainers). The
   * teams are still read from the real FireRed records and scaled/remapped.
   */
  manualRoster?: ManualTrainer[]
}

// Rock Tunnel 1F: H&S 24.59 (58×40) ← FireRed 3.32. 13 base objects (pre-BRUNO).
// B1F: H&S 24.60 (48×50) ← FireRed 3.33. FireRed's B1F is far wider, so 8 of 11
// trainers are relocated into H&S's differently-shaped cave (see hs-map-events-recon).
const FLOORS: Record<string, FloorConfig> = {
  '1f': {
    hsHeader: 0xf34754, hsMap: [24, 59], frMap: [3, 32], baseObjectCount: 13,
    slots: [11, 30, 31, 35, 39, 40, 41, 42, 43, 57, 60],
    relocate: {
      304: { x: 30, y: 30 }, // BENNY (was 18,47 — off the 40-tall map)
      487: { x: 32, y: 30 }, // TWINS KIRI & JAN (was 12–13,51)
    },
  },
  'b1f': {
    hsHeader: 0, hsMap: [24, 60], frMap: [3, 33], baseObjectCount: 16,
    slots: [61, 62, 63, 64, 67, 68, 69, 70, 78, 82, 84],
    relocate: {
      305: { x: 3, y: 20 },  // EDWIN   (was 31,12 — on a wall)
      481: { x: 4, y: 23 },  // CELIA   (was 28,6 — on a wall)
      274: { x: 8, y: 40 },  // OLIVIA  (was 50,12 — x off the 48-wide map)
      198: { x: 10, y: 46 }, // ALEX    (was 59,12)
      197: { x: 20, y: 22 }, // ERNEST  (was 63,13)
      480: { x: 24, y: 14 }, // BECKY   (was 52,8)
      273: { x: 40, y: 13 }, // GRACE   (was 54,12)
      488: { x: 43, y: 22 }, // CRUSH KIN RON & MYA (was 39–40,7)
    },
  },
  // Mt. Moon — HAND-BUILT (FireRed's Mt. Moon has no readable trainer objects,
  // its battles are script-driven; see hs-mtmoon-script-trainers). Teams are read
  // from the real FireRed trainer RECORDS by id, then scaled/remapped/placed.
  // Overworld sprites use ONLY gfx ids confirmed present on this build's Kanto
  // cave maps (0x1a young-trainer, 0x1d female, 0x35 biker/rugged, 0x11 hiker,
  // 0x2e tough-guy) so no trainer renders as a glitch/rock/wild-mon sprite.
  'mtmoon-1f': {
    hsHeader: 0xf3471c, hsMap: [24, 57], baseObjectCount: 15,
    slots: [85, 86, 87, 93, 105, 106, 107],
    relocate: {},
    manualRoster: [
      { frId: 104, x: 13, y: 10, gfxId: 0x1a, sight: 3, intro: 'Bug POKéMON are the best!', defeat: 'Aww, my bugs…' },
      { frId: 108, x: 17, y: 15, gfxId: 0x1a, sight: 3, intro: 'I catch bugs in this cave!', defeat: 'You squashed me!' },
      { frId: 120, x: 30, y: 15, gfxId: 0x1d, sight: 2, intro: 'Look at my cute POKéMON!', defeat: 'Oh, no!' },
      { frId: 121, x: 33, y: 29, gfxId: 0x1d, sight: 3, intro: 'A CLEFAIRY lives here, you know.', defeat: 'You’re strong!' },
      { frId: 169, x: 16, y: 37, gfxId: 0x2e, sight: 3, intro: 'My machines never lose!', defeat: 'It does not compute!' },
      { frId: 91,  x: 34, y: 15, gfxId: 0x1a, sight: 2, intro: 'Wanna battle in the dark?', defeat: 'You got me!' },
      { frId: 181, x: 10, y: 8,  gfxId: 0x11, sight: 3, intro: 'I dig rocks in MT. MOON!', defeat: 'Rock solid, you are!' },
    ],
  },
  'mtmoon-b2f': {
    hsHeader: 0xf34738, hsMap: [24, 58], baseObjectCount: 14,
    slots: [108, 109, 110, 111, 112],
    relocate: {},
    manualRoster: [
      { frId: 170, x: 11, y: 11, gfxId: 0x2e, sight: 3, intro: 'The fossils are ours!', defeat: 'Tch, meddling kid!' },
      { frId: 352, x: 13, y: 16, gfxId: 0x35, sight: 3, intro: 'TEAM ROCKET takes what it wants!', defeat: 'Curses!' },
      { frId: 353, x: 10, y: 20, gfxId: 0x35, sight: 3, intro: 'Get lost, kid!', defeat: 'How dare you!' },
      { frId: 354, x: 24, y: 19, gfxId: 0x35, sight: 4, intro: 'You’ll regret crossing ROCKET!', defeat: 'Impossible!' },
      { frId: 355, x: 7,  y: 5,  gfxId: 0x35, sight: 3, intro: 'This cave belongs to ROCKET now!', defeat: 'You haven’t seen the last of us!' },
    ],
  },
  // Route 3 (H&S 0.43, 84×20) ← FireRed 3.21. Map-object port (clean tType=1
  // source). H&S already has 4 endgame trainers here; these 8 are ADDED
  // alongside. Relocations avoid H&S's occupied tiles (verified walkable).
  'route3': {
    hsHeader: 0xf324c4, hsMap: [0, 43], frMap: [3, 21], baseObjectCount: 10,
    slots: [113, 119, 124, 125, 133, 134, 135, 136],
    relocate: {
      117: { x: 29, y: 3 }, // LASS SALLY (FR 30,3 is occupied by H&S's WARREN)
    },
  },
  // Viridian Forest (H&S 24.56, 74×69) ← FireRed 0.5. 5 Bug Catchers added
  // alongside H&S's 3 Old Couples. H&S's forest layout differs, so 4 of 5
  // relocate to verified walkable+free tiles.
  'viridian-forest': {
    hsHeader: 0xf34700, hsMap: [24, 56], frMap: [0, 5], baseObjectCount: 19,
    slots: [137, 138, 139, 140, 141],
    relocate: {
      102: { x: 46, y: 44 }, // RICK    (FR 47,45 blocked)
      103: { x: 46, y: 29 }, // DOUG    (FR 47,29 blocked)
      104: { x: 6,  y: 22 }, // SAMMY   (FR 7,22 occupied)
      532: { x: 14, y: 9 },  // CHARLIE (FR 16,5 blocked)
    },
  },
}

// ------------------------------------------------------------------ arg parse
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const floorArg = (args.find((s) => s.startsWith('--floor=')) ?? '--floor=1f').split('=')[1].toLowerCase()
const floor = FLOORS[floorArg]
if (!floor) throw new Error(`unknown --floor=${floorArg} (expected: ${Object.keys(FLOORS).join(', ')})`)
const hsPath = args.filter((s) => !s.startsWith('--'))[0] ?? DEFAULT_HS
const [HS_BANK, HS_MAP] = floor.hsMap
const FREE_SLOTS = floor.slots
const RELOCATE = floor.relocate

// ------------------------------------------------------------------ load ROMs
const frBytes = new Uint8Array(fs.readFileSync(FR_ROM))
const fr = loadRom(frBytes, 'GPT_Mods.gba', fs.readFileSync(FR_TOML, 'utf8'))
if (fr.rom.gameCode() !== 'BPRE') throw new Error(`FireRed source expected BPRE, got ${fr.rom.gameCode()}`)
const frRom = new RomBuffer(frBytes)
const frClasses = readTrainerClassNames(frRom, fr.anchors)

const original = new Uint8Array(fs.readFileSync(hsPath))
const hs = loadRom(original, hsPath.split(/[\\/]/).pop()!, undefined)
if (hs.rom.gameCode() !== 'BPEE') throw new Error(`H&S target expected BPEE, got ${hs.rom.gameCode()}`)
if (hs.warnings.length) throw new Error(`H&S warnings: ${hs.warnings.join('; ')}`)
const anchors = hs.anchors
const srcRom = new RomBuffer(original)
const hsClasses = readTrainerClassNames(srcRom, anchors)
const out = new Uint8Array(original)
const hex = (n: number) => '0x' + (n >>> 0).toString(16)

// ------------------------------------------------- name→id lookups (H&S side)
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
function lookup(names: { name: string }[]): Map<string, number> {
  const m = new Map<string, number>()
  names.forEach((n, i) => { if (n?.name && !m.has(norm(n.name))) m.set(norm(n.name), i) })
  return m
}
const hsSpecies = lookup(hs.species)
const hsMoves = lookup(hs.moves)
const hsClassByName = new Map<string, number>()
hsClasses.forEach((c, i) => { if (c && !hsClassByName.has(norm(c))) hsClassByName.set(norm(c), i) })

const frSp = (id: number) => fr.species[id]?.name ?? `#${id}`
const frMv = (id: number) => fr.moves[id]?.name ?? `#${id}`
function mapSpecies(id: number): number {
  const h = hsSpecies.get(norm(frSp(id)))
  if (h === undefined) throw new Error(`species "${frSp(id)}" not found in H&S`)
  return h
}
function mapMove(id: number): number {
  if (id === 0) return 0
  const h = hsMoves.get(norm(frMv(id)))
  if (h === undefined) throw new Error(`move "${frMv(id)}" not found in H&S`)
  return h
}
// FireRed classes with no same-name H&S class → nearest H&S equivalent by flavor.
const CLASS_SUBSTITUTE: Record<string, string> = {
  'CRUSHKIN': 'SIS AND BRO',  // brother+sister fighting pair; H&S has no CRUSH KIN
  'HIKER': 'RUIN MANIAC',     // H&S has no HIKER; RUIN MANIAC is the rugged-cave class
  'TEAMROCKET': 'ROCKET',     // H&S names the grunt class just "ROCKET"
}
function mapClass(cls: number): number {
  const raw = frClasses[cls] ?? ''
  let h = hsClassByName.get(norm(raw))
  if (h === undefined) {
    const sub = CLASS_SUBSTITUTE[norm(raw)]
    if (sub) h = hsClassByName.get(norm(sub))
  }
  if (h === undefined) throw new Error(`class "${raw}" not found in H&S (and no substitute)`)
  return h
}
function scaleLevel(level: number): number {
  if (level > IN_HI) return level
  const x = Math.max(level, IN_LO)
  return Math.max(level, Math.round(OUT_LO + ((x - IN_LO) * (OUT_HI - OUT_LO)) / (IN_HI - IN_LO)))
}
function promote(species: number, level: number): number {
  let cur = species
  for (let i = 0; i < 5; i++) {
    const evos = hs.evolutions[cur] ?? []
    const next = evos.find((e) => LEVEL_METHODS.has(e.method) && e.param <= level)
    if (!next || !next.target || POST_GEN4.has(next.target) || !hs.species[next.target]?.name) return cur
    cur = next.target
  }
  return cur
}

interface Ported {
  frId: number
  edit: TrainerEdit
  obj: { x: number; y: number; sight: number; gfxId: number; movementType: number }
  intro: Uint8Array
  defeat: Uint8Array
  after: Uint8Array
}

// Copy a 0xFF-terminated Gen-3 string VERBATIM (bytes, incl. terminator). The
// BPRE and BPEE charmaps are the same encoding, so raw bytes port directly —
// and this preserves control codes (scroll 0xFA/0xFB, newline 0xFE) that a
// text decode→re-encode round-trip would corrupt. Null ptr → a single space.
function copyDialogue(rom: RomBuffer, off: number | null): Uint8Array {
  if (off === null) return Uint8Array.of(0x00, 0xff) // " "-ish empty: space char + terminator
  let end = off
  while (end - off < 400 && rom.u8(end) !== 0xff) end++
  return rom.bytes.slice(off, end + 1) // include the 0xFF
}

/** Read a FireRed trainer record by id and remap+scale it into an H&S TrainerEdit. */
function buildEdit(frId: number): TrainerEdit {
  const t = readTrainer(frRom, fr.anchors, frId)
  const party: TrainerMon[] = (t.party as TrainerMon[]).map((m) => {
    const newLvl = scaleLevel(m.level)
    return {
      iv: m.iv,
      level: newLvl,
      species: promote(mapSpecies(m.species), newLvl),
      heldItem: t.hasItems ? mapItem(m.heldItem) : 0,
      moves: t.hasMoves ? m.moves.map(mapMove) : [0, 0, 0, 0],
    }
  })
  return {
    name: t.name, cls: mapClass(t.cls), gender: t.gender, music: t.music, sprite: t.sprite,
    items: t.items.map(mapItem), doubleBattle: t.doubleBattle, aiFlags: t.aiFlags,
    hasMoves: t.hasMoves, hasItems: t.hasItems, party,
  }
}

const ported: Ported[] = []
const recordByFrId = new Map<number, number>() // FR record id → H&S slot (shared for twins/pairs)
let slotCursor = 0

if (floor.manualRoster) {
  // Hand-built roster: teams from real FireRed records, placement/sprite/dialogue supplied.
  for (const mt of floor.manualRoster) {
    ported.push({
      frId: mt.frId,
      edit: buildEdit(mt.frId),
      obj: { x: mt.x, y: mt.y, sight: mt.sight, gfxId: mt.gfxId, movementType: 0x08 /* face down */ },
      intro: encodeManual(mt.intro),
      defeat: encodeManual(mt.defeat),
      after: encodeManual(''),
    })
    if (!recordByFrId.has(mt.frId)) {
      if (slotCursor >= FREE_SLOTS.length) throw new Error(`not enough free slots (${FREE_SLOTS.length}) for the roster`)
      recordByFrId.set(mt.frId, FREE_SLOTS[slotCursor++])
    }
  }
} else {
  // Read trainer objects straight from the FireRed source map (Rock Tunnel-style).
  if (!floor.frMap) throw new Error(`floor ${floorArg} has neither frMap nor manualRoster`)
  const [FR_BANK, FR_MAP] = floor.frMap
  const frHeader = resolveMapHeader(frRom, fr.anchors, FR_BANK, FR_MAP)
  const frEvents = readEvents(frRom, frHeader)
  const frTrainerObjs = frEvents.objects.filter(
    (o) => o.trainerType !== 0 && o.scriptOffset !== null && frRom.u8(o.scriptOffset) === 0x5c,
  )
  for (const o of frTrainerObjs) {
    const s = o.scriptOffset!
    const frId = frRom.u16(s + 2)

    // Position: relocate if off-map, else keep FireRed coords. Shared record's 2nd object sits beside the first.
    let x = o.x, y = o.y
    const reloc = RELOCATE[frId]
    if (reloc) {
      x = reloc.x + (recordByFrId.has(frId) ? 1 : 0)
      y = reloc.y
    }

    ported.push({
      frId, edit: buildEdit(frId),
      obj: { x, y, sight: o.sight, gfxId: o.gfxId, movementType: o.movementType },
      intro: copyDialogue(frRom, frRom.pointer(s + 6)),
      defeat: copyDialogue(frRom, frRom.pointer(s + 10)),
      after: copyDialogue(frRom, frRom.pointer(s + 16)),
    })

    // Assign an H&S record slot (shared record reuses the same one).
    if (!recordByFrId.has(frId)) {
      if (slotCursor >= FREE_SLOTS.length) throw new Error(`not enough free slots (${FREE_SLOTS.length}) for the roster`)
      recordByFrId.set(frId, FREE_SLOTS[slotCursor++])
    }
  }
}

/** Encode hand-authored dialogue (H&S charmap) with a 0xFF terminator. Empty → single space. */
function encodeManual(text: string): Uint8Array {
  if (!text) return Uint8Array.of(0x00, 0xff)
  const parts = text.split('\n')
  const bytes: number[] = []
  parts.forEach((p, i) => { if (i > 0) bytes.push(0xfe); for (const b of encode(p)) bytes.push(b) })
  bytes.push(0xff)
  return Uint8Array.from(bytes)
}

// FireRed items are rare on these trainers, but map any that appear by name.
function mapItem(id: number): number {
  if (id === 0) return 0
  const nm = fr.itemNames[id]
  if (!nm) return 0
  const hsId = hs.itemNames.findIndex((n) => n && norm(n) === norm(nm))
  return hsId > 0 ? hsId : 0
}

// ------------------------------------------------------------- free-space alloc
// Scan the ORIGINAL bytes for 0xFF runs (so already-ported data on another floor
// is seen as occupied and skipped). Floor at the known tail run.
const allocator = new FreeSpaceAllocator(original, FREE_FLOOR)
let firstAlloc = -1
let lastAlloc = FREE_FLOOR
function alloc(len: number): number {
  const off = allocator.allocate(len)
  if (firstAlloc < 0) firstAlloc = off
  lastAlloc = off + len
  return off
}
function place(bytes: Uint8Array): number {
  const off = alloc(bytes.length)
  out.set(bytes, off)
  return off
}
function apply(p: Patch) { out.set(p.bytes, p.offset) }

// ------------------------------------------------- write records, parties, scripts, objects
const hsHeader = resolveMapHeader(srcRom, anchors, HS_BANK, HS_MAP)
if (floor.hsHeader && hsHeader !== floor.hsHeader) throw new Error(`H&S ${floorArg} header ${hex(hsHeader)} != ${hex(floor.hsHeader)}`)
const hsEvents = readEvents(srcRom, hsHeader)
if (hsEvents.objectCount !== floor.baseObjectCount) {
  throw new Error(
    `H&S ${floorArg} has ${hsEvents.objectCount} objects, expected ${floor.baseObjectCount} (base count). ` +
    `If this floor was already ported, that's why — start from a base ROM without this floor's trainers.`,
  )
}

const writtenRecords = new Set<number>()
const newObjects: ObjectEventEdit[] = []
let localId = hsEvents.objectCount // next localId = 14, 15, …

for (const p of ported) {
  const slot = recordByFrId.get(p.frId)!

  // Write the trainer record + party once per unique FR record.
  if (!writtenRecords.has(slot)) {
    writtenRecords.add(slot)
    const recOff = anchors.trainers + slot * 40
    const cnt = srcRom.u32(recOff + 0x20), pp = srcRom.u32(recOff + 0x24)
    if (cnt !== 0 || pp !== 0) throw new Error(`slot #${slot} not empty (count=${cnt}, ptr=${hex(pp)})`)
    const partyBytes = serializeParty(p.edit, anchors.speciesCount, anchors.moveCount, anchors.itemCount)
    const partyOff = place(partyBytes)
    apply({
      offset: recOff,
      bytes: serializeTrainerRecord(p.edit, partyGbaPointer(partyOff), anchors.trainerClassCount, anchors.itemCount),
    })
  }

  // Each object gets its own script + dialogue (twins have two objects → two scripts, same record).
  const introOff = place(p.intro)
  const defeatOff = place(p.defeat)
  const afterOff = place(p.after)
  const scriptOff = place(assembleTrainerbattle({
    trainerId: slot,
    introPtr: gbaPointer(introOff),
    defeatPtr: gbaPointer(defeatOff),
    afterPtr: gbaPointer(afterOff),
  }))

  newObjects.push({
    localId: ++localId,
    gfxId: p.obj.gfxId,
    x: p.obj.x, y: p.obj.y,
    elevation: 3,
    movementType: p.obj.movementType,
    movementRange: 0,
    trainerType: 1,
    sight: p.obj.sight,
    scriptPtr: gbaPointer(scriptOff),
    flag: 0,
  })
}

// Grow the object array by all the new trainer objects at once.
const newArrLen = (hsEvents.objectCount + newObjects.length) * OBJECT_EVENT_LEN
const newArrOff = alloc(newArrLen)
const grown = growObjectArray(srcRom, hsEvents, newObjects, newArrOff)
out.set(grown.array, newArrOff)
grown.patches.forEach(apply)

// ------------------------------------------------------------------- report
const srcLabel = floor.manualRoster ? 'hand-built roster (FireRed records)' : `FireRed ${floor.frMap![0]}.${floor.frMap![1]}`
console.log(`Source: ${srcLabel}  →  H&S ${HS_BANK}.${HS_MAP} (header ${hex(hsHeader)})`)
console.log(`Rock Tunnel ${floorArg.toUpperCase()}: ${hsEvents.objectCount} → ${hsEvents.objectCount + newObjects.length} objects (${newObjects.length} trainers, ${writtenRecords.size} records)\n`)
for (const p of ported) {
  const slot = recordByFrId.get(p.frId)!
  const team = p.edit.party.map((m) => `L${m.level} ${hs.species[m.species].name}`).join(', ')
  console.log(`  #${slot} ${hsClasses[p.edit.cls]} "${p.edit.name}" @(${p.obj.x},${p.obj.y})  ${team}`)
}
console.log(`\n  free-space: ${hex(firstAlloc)} → ${hex(lastAlloc)} (${lastAlloc - firstAlloc} B)`)

// =================================================================== VERIFY
const rom2 = new RomBuffer(out)
let problems = 0
const check = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); problems++ } }

const base = hsEvents.objectCount
const ev2 = readEvents(rom2, hsHeader)
check(ev2.objectCount === base + newObjects.length, `objectCount ${ev2.objectCount} != ${base + newObjects.length}`)
// original objects byte-identical
let identical = true
for (let i = 0; i < base * OBJECT_EVENT_LEN; i++) {
  if (out[newArrOff + i] !== original[hsEvents.objectArrayOffset! + i]) identical = false
}
check(identical, `original ${base} objects not byte-identical`)
// each new object is a trainer pointing at a valid trainerbattle
for (let k = 0; k < newObjects.length; k++) {
  const o = ev2.objects[base + k]
  check(o.trainerType === 1, `new obj ${k} trainerType != 1`)
  check(o.scriptOffset !== null && rom2.u8(o.scriptOffset) === 0x5c, `new obj ${k} script not trainerbattle`)
  const slot = rom2.u16(o.scriptOffset! + 2)
  check(rom2.u32(anchors.trainers + slot * 40 + 0x20) === ported[k].edit.party.length, `record #${slot} party count wrong`)
}
// every claimed record round-trips its first mon
for (const p of ported) {
  const slot = recordByFrId.get(p.frId)!
  const recOff = anchors.trainers + slot * 40
  const partyOff = rom2.pointer(recOff + 0x24)!
  check(rom2.u16(partyOff + 2) === p.edit.party[0].level, `#${slot} party[0] level wrong`)
  check(rom2.u16(partyOff + 4) === p.edit.party[0].species, `#${slot} party[0] species wrong`)
}

if (problems) throw new Error(`verification failed: ${problems} problem(s)`)
console.log('\n✓ all post-write checks passed')

if (dryRun) { console.log('(dry run — nothing written)'); process.exit(0) }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backup = hsPath.replace(/\.gba$/i, '') + `.pre-rocktunnel-${stamp}.gba`
fs.copyFileSync(hsPath, backup)
fs.writeFileSync(hsPath, out)
let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== original[i]) diff++
console.log(`\n✅ Rock Tunnel ${floorArg.toUpperCase()} roster ported — ${diff} bytes changed.`)
console.log(`   backup: ${backup.split(/[\\/]/).pop()}`)
