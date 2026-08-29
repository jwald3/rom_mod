/**
 * Add an overworld trainer to Kanto's ROCK TUNNEL, which ships with zero
 * trainers on either floor (all its objects are trainerType=0 NPCs, rock-smash
 * rocks, and wild-Pokémon sprites — verified by reading real bytes).
 *
 * This is the vertical slice, now expressed as a thin consumer of the reusable
 * map-events layer (`src/rom/tables/mapEvents.ts`): ONE working trainer on Rock
 * Tunnel 1F, wired end-to-end so it appears, sees the player, and battles. The
 * module owns the array-grow / script-assembly / dialogue-encoding; this script
 * only declares the data and drives free-space allocation + backup + verify.
 *
 * Ground truth (all read from the ROM, see memory/hs-map-events-recon.md):
 *  - Rock Tunnel 1F = header 0xf34754 (bank 24 map 59 / alias 23.87), 13 objects.
 *  - Trainer record #11 is fully zeroed and unused by any script → claimed here.
 *  - ~10.5 MB of 0xFF free space at 0x15788dc; the packed map region has none.
 *  - The Black Belt (class 7; this ROM has no Hiker class) gets a six-mon
 *    Ground/Rock/Fighting cave team in the high-40s/low-50s.
 *
 *   npx tsx scripts/apply-rocktunnel-trainers.mts [--dry-run] ["<rom.gba>"]
 *
 * Writes a timestamped .pre-rocktunnel backup, then re-parses the written ROM to
 * assert the 13 original objects are byte-identical, the 14th is the trainer,
 * its script + text + record round-trip. BPEE needs no toml.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { RomBuffer } from '../src/rom/buffer'
import { encode } from '../src/rom/charmap'
import {
  serializeParty,
  serializeTrainerRecord,
  partyGbaPointer,
  type TrainerEdit,
} from '../src/rom/tables/trainers'
import {
  resolveMapHeader,
  readEvents,
  growObjectArray,
  assembleTrainerbattle,
  encodeDialogue,
  gbaPointer,
  OBJECT_EVENT_LEN,
  type ObjectEventEdit,
  type Patch,
} from '../src/rom/tables/mapEvents'

const DEFAULT_ROM = 'C:/Users/Jordan/Downloads/Pokemon H&S/Pokemon Heart & Soul.gba'

// ------------------------------------------------------------------- constants
const FREE_FLOOR = 0x15788dc // start of the giant tail 0xFF run

// Rock Tunnel 1F: bank 24, map 59.
const RT1F_BANK = 24
const RT1F_MAP = 59
// Where to stand the trainer: open tile, clear 4-tile sight straight down.
const POS = { x: 16, y: 3 }
const SIGHT = 4
// gfx 0x2e reads as a Black-Belt/tough-guy overworld sprite in this build's set.
const GFX_BLACKBELT = 0x2e
const FACING_DOWN_LOOK = 0x08 // MOVEMENT_TYPE_FACE_DOWN (stationary, faces down)

const TRAINER_ID = 11 // claimed empty record
const TRAINER_CLASS = 7 // BLACK BELT (named class in this ROM)

// Species / move ids resolved from the ROM (see recon).
const S = { GRAVELER: 75, GOLEM: 76, MACHOKE: 67, ONIX: 95, RHYHORN: 111, MAROWAK: 105 }
const M = {
  ROCK_SLIDE: 157, EARTHQUAKE: 89, DIG: 91, STRENGTH: 70, CRUNCH: 242,
  BODY_SLAM: 34, DOUBLE_EDGE: 38, MEGAHORN: 224, HEADBUTT: 29, SLAM: 21,
  ROCK_BLAST: 350, SCREECH: 103, TAKE_DOWN: 36, SANDSTORM: 201,
}

// The Black Belt's team — high-40s/low-50s, custom moves, worth grinding on.
const trainer: TrainerEdit = {
  name: 'BRUNO',
  cls: TRAINER_CLASS,
  gender: 0,
  music: 0,
  sprite: 0,
  items: [0, 0, 0, 0],
  doubleBattle: 0,
  aiFlags: 7, // check bad move / try to KO / expert — a real fight
  hasMoves: true,
  hasItems: false,
  party: [
    { iv: 200, level: 47, species: S.MACHOKE, heldItem: 0, moves: [M.CRUNCH, M.STRENGTH, M.HEADBUTT, M.SCREECH] },
    { iv: 200, level: 48, species: S.GRAVELER, heldItem: 0, moves: [M.ROCK_SLIDE, M.EARTHQUAKE, M.DIG, M.SLAM] },
    { iv: 200, level: 48, species: S.RHYHORN, heldItem: 0, moves: [M.EARTHQUAKE, M.ROCK_SLIDE, M.TAKE_DOWN, M.MEGAHORN] },
    { iv: 210, level: 50, species: S.ONIX, heldItem: 0, moves: [M.ROCK_SLIDE, M.EARTHQUAKE, M.SCREECH, M.SLAM] },
    { iv: 210, level: 50, species: S.MAROWAK, heldItem: 0, moves: [M.EARTHQUAKE, M.ROCK_SLIDE, M.BODY_SLAM, M.DOUBLE_EDGE] },
    { iv: 220, level: 52, species: S.GOLEM, heldItem: 0, moves: [M.EARTHQUAKE, M.ROCK_BLAST, M.BODY_SLAM, M.SANDSTORM] },
  ],
}

// Dialogue. \n = line break (0xFE). The Gen-3 charmap has no ASCII apostrophe —
// use the curly ’ (0xB4).
const INTRO = 'This TUNNEL is my dojo!\nProve your grit against me!'
const DEFEAT = 'Hmph! You’ve got real strength.'
const AFTER = 'Keep training in the dark,\nand you’ll grow stronger still.'

// ------------------------------------------------------------------ arg parse
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const romPath = args.filter((s) => !s.startsWith('--'))[0] ?? DEFAULT_ROM

const original = new Uint8Array(fs.readFileSync(romPath))
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(original, romName, undefined)
if (loaded.warnings.length) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)
if (loaded.rom.gameCode() !== 'BPEE') throw new Error(`Expected BPEE, got ${loaded.rom.gameCode()}`)
const { anchors } = loaded

// The editable copy + a read view over the ORIGINAL bytes (for read-side lookups).
const out = new Uint8Array(original)
const srcRom = new RomBuffer(original)
const hex = (n: number) => '0x' + (n >>> 0).toString(16)

// ------------------------------------------------------------- free-space alloc
// A verifying bump allocator over the known tail run (asserts each slot is 0xFF).
let freeCursor = FREE_FLOOR
function alloc(len: number): number {
  const off = (freeCursor + 3) & ~3 // 4-byte align
  for (let i = 0; i < len; i++) {
    if (original[off + i] !== 0xff) throw new Error(`free-space ${hex(off)}+${i} is not 0xFF (${hex(original[off + i])})`)
  }
  freeCursor = off + len
  return off
}
function apply(patch: Patch) {
  out.set(patch.bytes, patch.offset)
}
function place(bytes: Uint8Array): number {
  const off = alloc(bytes.length)
  out.set(bytes, off)
  return off
}

// ------------------------------------------------------- 1. trainer record + party
const partyBytes = serializeParty(trainer, anchors.speciesCount, anchors.moveCount, anchors.itemCount)
const partyOff = place(partyBytes)

const recordOff = anchors.trainers + TRAINER_ID * 40
{
  const cnt = srcRom.u32(recordOff + 0x20)
  const pp = srcRom.u32(recordOff + 0x24)
  if (cnt !== 0 || pp !== 0) throw new Error(`trainer #${TRAINER_ID} is not empty (count=${cnt}, partyPtr=${hex(pp)})`)
}
apply({
  offset: recordOff,
  bytes: serializeTrainerRecord(trainer, partyGbaPointer(partyOff), anchors.trainerClassCount, anchors.itemCount),
})

// ------------------------------------------------------------- 2. script + text
const introOff = place(encodeDialogue(INTRO))
const defeatOff = place(encodeDialogue(DEFEAT))
const afterOff = place(encodeDialogue(AFTER))
const scriptOff = place(
  assembleTrainerbattle({
    trainerId: TRAINER_ID,
    introPtr: gbaPointer(introOff),
    defeatPtr: gbaPointer(defeatOff),
    afterPtr: gbaPointer(afterOff),
  }),
)

// ------------------------------------------------------- 3. grow the object array
const header = resolveMapHeader(srcRom, anchors, RT1F_BANK, RT1F_MAP)
if (header !== 0xf34754) throw new Error(`Rock Tunnel 1F header resolved to ${hex(header)}, expected 0xf34754`)
const events = readEvents(srcRom, header)
if (events.objectCount !== 13) throw new Error(`Rock Tunnel 1F expected 13 objects, found ${events.objectCount} — did this already run?`)

const newObject: ObjectEventEdit = {
  localId: events.objectCount + 1, // 14 (unique)
  gfxId: GFX_BLACKBELT,
  x: POS.x,
  y: POS.y,
  elevation: 3, // normal ground
  movementType: FACING_DOWN_LOOK,
  movementRange: 0,
  trainerType: 1, // normal line-of-sight
  sight: SIGHT,
  scriptPtr: gbaPointer(scriptOff),
  flag: 0, // always visible; beaten state is engine-side
}

// Allocate the grown array first (its offset goes into the repoint patch).
const newArrLen = (events.objectCount + 1) * OBJECT_EVENT_LEN
const newArrOff = alloc(newArrLen)
const grown = growObjectArray(srcRom, events, [newObject], newArrOff)
out.set(grown.array, newArrOff)
grown.patches.forEach(apply)

// ------------------------------------------------------------------- report
console.log(`ROM: ${romName}`)
console.log(`Rock Tunnel 1F (header ${hex(header)}): ${events.objectCount} → ${events.objectCount + 1} objects`)
console.log(`  trainer object @ (${POS.x},${POS.y}) gfx ${hex(GFX_BLACKBELT)} sight ${SIGHT} → script ${hex(scriptOff)}`)
console.log(`  new object array  @ ${hex(newArrOff)} (${newArrLen} B), old ${hex(events.objectArrayOffset!)} orphaned`)
console.log(`  trainer #${TRAINER_ID} "${trainer.name}" class ${TRAINER_CLASS} — ${trainer.party.length} mons, party @ ${hex(partyOff)}`)
console.log(`  script @ ${hex(scriptOff)}  intro ${hex(introOff)}  defeat ${hex(defeatOff)}  after ${hex(afterOff)}`)
console.log(`  free-space used: ${hex(FREE_FLOOR)} → ${hex(freeCursor)} (${freeCursor - FREE_FLOOR} B)`)

// =================================================================== VERIFY
const rom2 = new RomBuffer(out)
let problems = 0
const check = (cond: boolean, msg: string) => { if (!cond) { console.error('  ✗ ' + msg); problems++ } }

const ev2 = readEvents(rom2, header)
check(ev2.objectCount === 14, `objectCount is ${ev2.objectCount}, expected 14`)
check(ev2.objectArrayOffset === newArrOff, `object array ptr ${hex(ev2.objectArrayOffset ?? 0)} != ${hex(newArrOff)}`)
// first 13 byte-identical to the originals
let identical = true
for (let i = 0; i < 13 * OBJECT_EVENT_LEN; i++) {
  if (out[newArrOff + i] !== original[events.objectArrayOffset! + i]) identical = false
}
check(identical, 'first 13 objects are not byte-identical to the originals')
// 14th is our trainer
const t = ev2.objects[13]
check(t.trainerType === 1, 'new object trainerType != 1')
check(t.sight === SIGHT, 'new object sight != ' + SIGHT)
check(t.x === POS.x && t.y === POS.y, 'new object position wrong')
check(t.scriptOffset === scriptOff, 'new object script ptr wrong')

// script round-trips
check(rom2.u8(scriptOff) === 0x5c && rom2.u16(scriptOff + 2) === TRAINER_ID, 'script trainerbattle id wrong')
check(rom2.pointer(scriptOff + 6) === introOff, 'script intro ptr wrong')
check(rom2.pointer(scriptOff + 10) === defeatOff, 'script defeat ptr wrong')
check(rom2.pointer(scriptOff + 16) === afterOff, 'script after ptr wrong')
check(rom2.u8(scriptOff + 22) === 0x02, 'script does not end with 0x02')

// text round-trips (compare bytes)
const introEnc = encodeDialogue(INTRO)
check(introEnc.every((b, i) => out[introOff + i] === b), 'intro text bytes wrong')

// trainer record round-trips
check(rom2.u32(recordOff + 0x20) === trainer.party.length, 'record partyCount wrong')
check(rom2.pointer(recordOff + 0x24) === partyOff, 'record party ptr wrong')
const nameEnc = encode(trainer.name)
check(nameEnc.every((b, i) => out[recordOff + 4 + i] === b), 'record name wrong')
check(rom2.u16(partyOff + 2) === trainer.party[0].level && rom2.u16(partyOff + 4) === trainer.party[0].species, 'party[0] wrong')

if (problems) throw new Error(`verification failed: ${problems} problem(s)`)
console.log('\n✓ all post-write checks passed')

if (dryRun) {
  console.log('(dry run — nothing written to disk)')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backup = romPath.replace(/\.gba$/i, '') + `.pre-rocktunnel-${stamp}.gba`
fs.copyFileSync(romPath, backup)
fs.writeFileSync(romPath, out)
let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== original[i]) diff++
console.log(`\n✅ Rock Tunnel trainer added — ${diff} bytes changed.`)
console.log(`   backup: ${backup.split(/[\\/]/).pop()}`)
