import type { RomBuffer } from '../buffer'
import { GBA_ROM_BASE } from '../buffer'
import type { AnchorMap } from '../anchors'
import { encode } from '../charmap'

/**
 * Map object-events (overworld people/trainers/item-balls) — read + write.
 *
 * Verified against real bytes in Pokémon Heart & Soul (BPEE), 2026-08-29; the
 * data uses the vanilla pokeemerald layout even though HMA can't open these maps
 * ([[hma-cant-edit-hs-maps]], [[hs-map-events-recon]]). This module is the reusable
 * form of the one-off `apply-rocktunnel-trainers.mts` slice.
 *
 * Layout (all little-endian):
 *   Map header (28 B), reached from `AnchorMap.mapBanks` (an array of bank
 *   pointers; each bank is an array of map-header pointers):
 *     0x00 ptr layout  0x04 ptr events  0x08 ptr scripts  0x0C ptr connections
 *     0x10 u16 music   0x12 u16 layoutId  0x14 u8 mapsec  0x15 u8 cave  …
 *   Events struct:
 *     0x00 u8 objCount  0x01 u8 warpCount  0x02 u8 coordCount  0x03 u8 bgCount
 *     0x04 ptr objectEvents  0x08 ptr warps  0x0C ptr coordEvents  0x10 ptr bgEvents
 *   Object event (24 B):
 *     0x00 u8 localId   0x01 u8 gfxId   0x02 u8 kind   0x03 u8 pad
 *     0x04 s16 x        0x06 s16 y      0x08 u8 elev   0x09 u8 mvType
 *     0x0A u8 mvRange   0x0B u8 pad     0x0C u16 trainerType  0x0E u16 sight
 *     0x10 ptr script   0x14 u16 flag   0x16 u16 pad
 *
 * Only object events are modeled here; warps/coord/bg events are decoded far
 * enough to preserve their pointers, not edited. The write side returns byte
 * arrays + {offset, bytes} patches (like tables/trainers.ts serialize*): the
 * caller owns the ROM copy, free-space allocation, backup, and verify.
 */

// ------------------------------------------------------------------ constants
export const MAP_HEADER_LEN = 28
export const OBJECT_EVENT_LEN = 24

// Events-struct offsets.
const EV_OBJ_COUNT = 0x00
const EV_WARP_COUNT = 0x01
const EV_COORD_COUNT = 0x02
const EV_BG_COUNT = 0x03
const EV_OBJ_PTR = 0x04
const EV_WARP_PTR = 0x08
const EV_COORD_PTR = 0x0c
const EV_BG_PTR = 0x10

// Object-event field offsets.
const O_LOCAL_ID = 0x00
const O_GFX = 0x01
const O_KIND = 0x02
const O_X = 0x04
const O_Y = 0x06
const O_ELEV = 0x08
const O_MV_TYPE = 0x09
const O_MV_RANGE = 0x0a
const O_TRAINER_TYPE = 0x0c
const O_SIGHT = 0x0e
const O_SCRIPT = 0x10
const O_FLAG = 0x14

// Map-header field offsets we care about.
const H_EVENTS_PTR = 0x04

// trainerbattle (kind 0) script: a 14-byte command + a fixed 9-byte tail.
// 5C 00 [id u16] 00 00 [introPtr:4] [defeatPtr:4]  0F 00 [afterPtr:4] 09 06 02
const TRAINERBATTLE_SCRIPT_LEN = 23

/** GBA address (0x08…) of a ROM file offset. */
export function gbaPointer(offset: number): number {
  return GBA_ROM_BASE + offset
}

// -------------------------------------------------------------------- read side

/** One overworld object event (person / trainer / item-ball). */
export interface ObjectEvent {
  /** Byte offset of this event's 24-byte record in the ROM. */
  offset: number
  localId: number
  gfxId: number
  kind: number
  x: number
  y: number
  elevation: number
  movementType: number
  movementRange: number
  /** 0 = plain NPC, 1 = trainer with line-of-sight, 2 = trainer see-all. */
  trainerType: number
  /** Line-of-sight range in tiles (only meaningful when trainerType != 0). */
  sight: number
  /** ROM file offset of the event's script, or null if the pointer is null/invalid. */
  scriptOffset: number | null
  /** Flag that hides the object when set; 0 = always visible. */
  flag: number
}

/** The four event arrays of one map, with their counts and array offsets. */
export interface MapEvents {
  /** Byte offset of the events struct itself (so writers can patch its count/ptr). */
  eventsOffset: number
  objectCount: number
  objectArrayOffset: number | null
  objects: ObjectEvent[]
  warpCount: number
  warpArrayOffset: number | null
  coordCount: number
  coordArrayOffset: number | null
  bgCount: number
  bgArrayOffset: number | null
}

/**
 * Resolve the byte offset of a map header from its bank/map indices.
 * Throws if the bank or map index is out of range or its pointer is invalid.
 */
export function resolveMapHeader(rom: RomBuffer, a: AnchorMap, bank: number, map: number): number {
  const bankPtr = rom.pointer(a.mapBanks + bank * 4)
  if (bankPtr === null) throw new Error(`map bank ${bank}: null/invalid pointer at mapBanks[${bank}]`)
  const headerPtr = rom.pointer(bankPtr + map * 4)
  if (headerPtr === null) throw new Error(`map ${bank}.${map}: null/invalid header pointer`)
  return headerPtr
}

function readObjectEvent(rom: RomBuffer, offset: number): ObjectEvent {
  return {
    offset,
    localId: rom.u8(offset + O_LOCAL_ID),
    gfxId: rom.u8(offset + O_GFX),
    kind: rom.u8(offset + O_KIND),
    x: signed16(rom.u16(offset + O_X)),
    y: signed16(rom.u16(offset + O_Y)),
    elevation: rom.u8(offset + O_ELEV),
    movementType: rom.u8(offset + O_MV_TYPE),
    movementRange: rom.u8(offset + O_MV_RANGE),
    trainerType: rom.u16(offset + O_TRAINER_TYPE),
    sight: rom.u16(offset + O_SIGHT),
    scriptOffset: rom.pointer(offset + O_SCRIPT),
    flag: rom.u16(offset + O_FLAG),
  }
}

/** Decode all event arrays for a map header. Object events are fully parsed. */
export function readEvents(rom: RomBuffer, headerOffset: number): MapEvents {
  const eventsOffset = rom.pointer(headerOffset + H_EVENTS_PTR)
  if (eventsOffset === null) throw new Error(`map header @0x${headerOffset.toString(16)}: null events pointer`)

  const objectCount = rom.u8(eventsOffset + EV_OBJ_COUNT)
  const objectArrayOffset = rom.pointer(eventsOffset + EV_OBJ_PTR)
  const objects: ObjectEvent[] = []
  if (objectArrayOffset !== null) {
    for (let i = 0; i < objectCount; i++) {
      objects.push(readObjectEvent(rom, objectArrayOffset + i * OBJECT_EVENT_LEN))
    }
  }

  return {
    eventsOffset,
    objectCount,
    objectArrayOffset,
    objects,
    warpCount: rom.u8(eventsOffset + EV_WARP_COUNT),
    warpArrayOffset: rom.pointer(eventsOffset + EV_WARP_PTR),
    coordCount: rom.u8(eventsOffset + EV_COORD_COUNT),
    coordArrayOffset: rom.pointer(eventsOffset + EV_COORD_PTR),
    bgCount: rom.u8(eventsOffset + EV_BG_COUNT),
    bgArrayOffset: rom.pointer(eventsOffset + EV_BG_PTR),
  }
}

// ------------------------------------------------------------------- write side

/** A byte range to write into the ROM: `bytes` go at `offset`. */
export interface Patch {
  offset: number
  bytes: Uint8Array
}

/** The editable value of an object event (offsets/kind resolved at write time). */
export interface ObjectEventEdit {
  localId: number
  gfxId: number
  x: number
  y: number
  elevation: number
  movementType: number
  movementRange: number
  trainerType: number
  sight: number
  /** GBA address (0x08…) of the event's script. */
  scriptPtr: number
  flag: number
}

/** Serialize one 24-byte object event. */
export function serializeObjectEvent(e: ObjectEventEdit): Uint8Array {
  if (e.localId < 0 || e.localId > 0xff) throw new Error(`localId ${e.localId} out of range (0–255)`)
  if (e.gfxId < 0 || e.gfxId > 0xff) throw new Error(`gfxId ${e.gfxId} out of range (0–255)`)
  if (e.x < -0x8000 || e.x > 0x7fff) throw new Error(`x ${e.x} out of range`)
  if (e.y < -0x8000 || e.y > 0x7fff) throw new Error(`y ${e.y} out of range`)
  if (e.scriptPtr !== 0 && e.scriptPtr < GBA_ROM_BASE) throw new Error(`scriptPtr 0x${e.scriptPtr.toString(16)} is not a GBA address`)

  const out = new Uint8Array(OBJECT_EVENT_LEN)
  const dv = new DataView(out.buffer)
  dv.setUint8(O_LOCAL_ID, e.localId)
  dv.setUint8(O_GFX, e.gfxId)
  dv.setInt16(O_X, e.x, true)
  dv.setInt16(O_Y, e.y, true)
  dv.setUint8(O_ELEV, e.elevation)
  dv.setUint8(O_MV_TYPE, e.movementType)
  dv.setUint8(O_MV_RANGE, e.movementRange)
  dv.setUint16(O_TRAINER_TYPE, e.trainerType, true)
  dv.setUint16(O_SIGHT, e.sight, true)
  dv.setUint32(O_SCRIPT, e.scriptPtr >>> 0, true)
  dv.setUint16(O_FLAG, e.flag, true)
  return out
}

/**
 * Assemble a `trainerbattle` (kind 0) script. All three text pointers are GBA
 * addresses (0x08…). Returns the 23 bytes to place in free space.
 */
export function assembleTrainerbattle(args: {
  trainerId: number
  introPtr: number
  defeatPtr: number
  afterPtr: number
}): Uint8Array {
  const { trainerId, introPtr, defeatPtr, afterPtr } = args
  if (trainerId < 0 || trainerId > 0xffff) throw new Error(`trainerId ${trainerId} out of range (0–65535)`)
  for (const [name, p] of [['intro', introPtr], ['defeat', defeatPtr], ['after', afterPtr]] as const) {
    if (p < GBA_ROM_BASE) throw new Error(`${name} pointer 0x${p.toString(16)} is not a GBA address`)
  }
  const out = new Uint8Array(TRAINERBATTLE_SCRIPT_LEN)
  const dv = new DataView(out.buffer)
  out[0] = 0x5c // trainerbattle
  out[1] = 0x00 // kind 0
  dv.setUint16(2, trainerId, true)
  dv.setUint16(4, 0, true) // rematch/unused
  dv.setUint32(6, introPtr >>> 0, true)
  dv.setUint32(10, defeatPtr >>> 0, true)
  out[14] = 0x0f // loadword post-battle text
  out[15] = 0x00
  dv.setUint32(16, afterPtr >>> 0, true)
  out[20] = 0x09 // (release-style tail every real trainer shares)
  out[21] = 0x06
  out[22] = 0x02 // end
  return out
}

/**
 * Encode a dialogue string to Gen-3 bytes with a 0xFF terminator. `\n` becomes
 * the 0xFE newline control code. NOTE the Gen-3 charmap has no ASCII apostrophe;
 * use the curly `’` (see [[hs-map-events-recon]]).
 */
export function encodeDialogue(text: string): Uint8Array {
  const chunks: number[] = []
  text.split('\n').forEach((line, i) => {
    if (i > 0) chunks.push(0xfe)
    for (const b of encode(line)) chunks.push(b)
  })
  chunks.push(0xff)
  return Uint8Array.from(chunks)
}

/**
 * Grow a map's object-event array by appending `newObjects`, returning the full
 * relocated array plus the two patches to the events struct (bumped count byte +
 * repointed array pointer). The existing objects are copied verbatim from
 * `existing.objectArrayOffset`; the old array is left in place (a harmless
 * orphan — erasing it risks clobbering data an aliasing header shares).
 *
 * The caller allocates `newArrayOffset` in free space (via FreeSpaceAllocator),
 * writes `array` there, then applies `patches`.
 */
export function growObjectArray(
  rom: RomBuffer,
  events: MapEvents,
  newObjects: ObjectEventEdit[],
  newArrayOffset: number,
): { array: Uint8Array; patches: Patch[] } {
  if (events.objectArrayOffset === null) throw new Error('map has no object array to grow')
  const total = events.objectCount + newObjects.length
  if (total > 0xff) throw new Error(`object count ${total} exceeds the 255-object byte limit`)

  const array = new Uint8Array(total * OBJECT_EVENT_LEN)
  // Existing objects, byte-identical.
  array.set(rom.slice(events.objectArrayOffset, events.objectCount * OBJECT_EVENT_LEN), 0)
  // Appended new objects.
  newObjects.forEach((o, i) => {
    array.set(serializeObjectEvent(o), (events.objectCount + i) * OBJECT_EVENT_LEN)
  })

  const countPatch: Patch = { offset: events.eventsOffset + EV_OBJ_COUNT, bytes: Uint8Array.of(total) }
  const ptrBytes = new Uint8Array(4)
  new DataView(ptrBytes.buffer).setUint32(0, gbaPointer(newArrayOffset), true)
  const ptrPatch: Patch = { offset: events.eventsOffset + EV_OBJ_PTR, bytes: ptrBytes }

  return { array, patches: [countPatch, ptrPatch] }
}

/**
 * Overwrite an existing object event in place (no array growth, no relocation) —
 * the safe path for editing a trainer/NPC already on a map. Returns a single
 * patch over the object's own 24-byte slot.
 */
export function editObjectInPlace(target: ObjectEvent, edit: ObjectEventEdit): Patch {
  return { offset: target.offset, bytes: serializeObjectEvent(edit) }
}

function signed16(u: number): number {
  return u >= 0x8000 ? u - 0x10000 : u
}
