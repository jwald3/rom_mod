/**
 * Populate Kanto's ROCK TUNNEL 1F with its canonical trainer roster, ported from
 * FireRed (the GPT_Mods BPRE ROM) into Heart & Soul (BPEE) — replacing the old
 * one-off BRUNO placeholder. Built on the reusable map-events layer
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

// H&S Rock Tunnel 1F = bank 24 map 59; FireRed = bank 3 map 32.
const HS_BANK = 24, HS_MAP = 59
const FR_BANK = 3, FR_MAP = 32

// Empty H&S trainer slots to claim (from the 379 free; #11 reclaimed from BRUNO).
const FREE_SLOTS = [11, 30, 31, 35, 39, 40, 41, 42, 43, 57, 60]

// Relocations for trainers whose FireRed y falls outside H&S's 58×40 map.
// Keyed by FireRed trainer record id; verified walkable + unoccupied.
const RELOCATE: Record<number, { x: number; y: number }> = {
  304: { x: 30, y: 30 }, // BENNY (was 18,47)
  487: { x: 32, y: 30 }, // TWINS KIRI & JAN (was 12–13,51) — second twin bumped +1 x below
}

// Level-scaling (identical to apply-kanto-level-scale.mts).
const IN_LO = 2, IN_HI = 34, OUT_LO = 45, OUT_HI = 58
const LEVEL_METHODS = new Set([4, 18])
const POST_GEN4 = new Set([439, 440, 444, 449, 450, 451, 452, 453, 454, 455])

// ------------------------------------------------------------------ arg parse
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const hsPath = args.filter((s) => !s.startsWith('--'))[0] ?? DEFAULT_HS

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
function mapClass(cls: number): number {
  const h = hsClassByName.get(norm(frClasses[cls] ?? ''))
  if (h === undefined) throw new Error(`class "${frClasses[cls]}" not found in H&S`)
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

// ------------------------------------------------- read FireRed 1F trainer objects
const frHeader = resolveMapHeader(frRom, fr.anchors, FR_BANK, FR_MAP)
const frEvents = readEvents(frRom, frHeader)
const frTrainerObjs = frEvents.objects.filter(
  (o) => o.trainerType !== 0 && o.scriptOffset !== null && frRom.u8(o.scriptOffset) === 0x5c,
)

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

const ported: Ported[] = []
const recordByFrId = new Map<number, number>() // FR record id → H&S slot (twins share)
let slotCursor = 0

for (const o of frTrainerObjs) {
  const s = o.scriptOffset!
  const frId = frRom.u16(s + 2)
  const t = readTrainer(frRom, fr.anchors, frId)

  const party: TrainerMon[] = (t.party as TrainerMon[]).map((m) => {
    const newLvl = scaleLevel(m.level)
    const species = promote(mapSpecies(m.species), newLvl)
    return {
      iv: m.iv,
      level: newLvl,
      species,
      heldItem: t.hasItems ? mapItem(m.heldItem) : 0,
      moves: t.hasMoves ? m.moves.map(mapMove) : [0, 0, 0, 0],
    }
  })

  const edit: TrainerEdit = {
    name: t.name, cls: mapClass(t.cls), gender: t.gender, music: t.music, sprite: t.sprite,
    items: t.items.map(mapItem), doubleBattle: t.doubleBattle, aiFlags: t.aiFlags,
    hasMoves: t.hasMoves, hasItems: t.hasItems, party,
  }

  // Position: relocate if off-map, else keep FireRed coords. Second twin sits beside the first.
  let x = o.x, y = o.y
  const reloc = RELOCATE[frId]
  if (reloc) {
    x = reloc.x + (recordByFrId.has(frId) ? 1 : 0)
    y = reloc.y
  }

  ported.push({
    frId, edit,
    obj: { x, y, sight: o.sight, gfxId: o.gfxId, movementType: o.movementType },
    intro: copyDialogue(frRom, frRom.pointer(s + 6)),
    defeat: copyDialogue(frRom, frRom.pointer(s + 10)),
    after: copyDialogue(frRom, frRom.pointer(s + 16)),
  })

  // Assign an H&S record slot (twins reuse the same one).
  if (!recordByFrId.has(frId)) {
    if (slotCursor >= FREE_SLOTS.length) throw new Error(`not enough free slots (${FREE_SLOTS.length}) for the roster`)
    recordByFrId.set(frId, FREE_SLOTS[slotCursor++])
  }
}

// FireRed items are rare on these trainers, but map any that appear by name.
function mapItem(id: number): number {
  if (id === 0) return 0
  const nm = fr.items[id]?.name
  if (!nm) return 0
  const hsId = hs.items.findIndex((it) => it?.name && norm(it.name) === norm(nm))
  return hsId > 0 ? hsId : 0
}

// ------------------------------------------------------------- free-space alloc
let freeCursor = FREE_FLOOR
function alloc(len: number): number {
  const off = (freeCursor + 3) & ~3
  for (let i = 0; i < len; i++) {
    if (original[off + i] !== 0xff) throw new Error(`free-space ${hex(off)}+${i} not 0xFF (${hex(original[off + i])})`)
  }
  freeCursor = off + len
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
if (hsHeader !== 0xf34754) throw new Error(`H&S 1F header ${hex(hsHeader)} != 0xf34754`)
const hsEvents = readEvents(srcRom, hsHeader)
if (hsEvents.objectCount !== 13) {
  throw new Error(`H&S 1F has ${hsEvents.objectCount} objects, expected 13 — base ROM must be pre-BRUNO (use the .pre-rocktunnel backup)`)
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
console.log(`Source: FireRed ${FR_BANK}.${FR_MAP}  →  H&S ${HS_BANK}.${HS_MAP} (header ${hex(hsHeader)})`)
console.log(`Rock Tunnel 1F: ${hsEvents.objectCount} → ${hsEvents.objectCount + newObjects.length} objects (${newObjects.length} trainers, ${writtenRecords.size} records)\n`)
for (const p of ported) {
  const slot = recordByFrId.get(p.frId)!
  const team = p.edit.party.map((m) => `L${m.level} ${hs.species[m.species].name}`).join(', ')
  console.log(`  #${slot} ${hsClasses[p.edit.cls]} "${p.edit.name}" @(${p.obj.x},${p.obj.y})  ${team}`)
}
console.log(`\n  free-space: ${hex(FREE_FLOOR)} → ${hex(freeCursor)} (${freeCursor - FREE_FLOOR} B)`)

// =================================================================== VERIFY
const rom2 = new RomBuffer(out)
let problems = 0
const check = (c: boolean, m: string) => { if (!c) { console.error('  ✗ ' + m); problems++ } }

const ev2 = readEvents(rom2, hsHeader)
check(ev2.objectCount === 13 + newObjects.length, `objectCount ${ev2.objectCount} != ${13 + newObjects.length}`)
// original 13 byte-identical
let identical = true
for (let i = 0; i < 13 * OBJECT_EVENT_LEN; i++) {
  if (out[newArrOff + i] !== original[hsEvents.objectArrayOffset! + i]) identical = false
}
check(identical, 'original 13 objects not byte-identical')
// each new object is a trainer pointing at a valid trainerbattle
for (let k = 0; k < newObjects.length; k++) {
  const o = ev2.objects[13 + k]
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
console.log(`\n✅ Rock Tunnel 1F roster ported — ${diff} bytes changed.`)
console.log(`   backup: ${backup.split(/[\\/]/).pop()}`)
