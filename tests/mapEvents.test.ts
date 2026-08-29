import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { RomBuffer } from '../src/rom/buffer'
import {
  resolveMapHeader,
  readEvents,
  serializeObjectEvent,
  assembleTrainerbattle,
  encodeDialogue,
  growObjectArray,
  editObjectInPlace,
  gbaPointer,
  OBJECT_EVENT_LEN,
  type ObjectEventEdit,
} from '../src/rom/tables/mapEvents'
import { heartAndSoulRom } from './romPath'

// -------- Pure-function tests (no ROM needed) --------

describe('mapEvents serializers', () => {
  it('serializes an object event to 24 bytes and round-trips through readEvents-style decode', () => {
    const edit: ObjectEventEdit = {
      localId: 14,
      gfxId: 0x2e,
      x: 16,
      y: 3,
      elevation: 3,
      movementType: 0x08,
      movementRange: 0,
      trainerType: 1,
      sight: 4,
      scriptPtr: gbaPointer(0x15789cc),
      flag: 0,
    }
    const bytes = serializeObjectEvent(edit)
    expect(bytes.length).toBe(OBJECT_EVENT_LEN)

    // Decode the fields back out of the raw bytes.
    const dv = new DataView(bytes.buffer)
    expect(dv.getUint8(0)).toBe(14) // localId
    expect(dv.getUint8(1)).toBe(0x2e) // gfxId
    expect(dv.getInt16(4, true)).toBe(16) // x
    expect(dv.getInt16(6, true)).toBe(3) // y
    expect(dv.getUint16(12, true)).toBe(1) // trainerType
    expect(dv.getUint16(14, true)).toBe(4) // sight
    expect(dv.getUint32(16, true)).toBe(gbaPointer(0x15789cc)) // script
    expect(dv.getUint16(20, true)).toBe(0) // flag
  })

  it('serializes negative coordinates as signed 16-bit', () => {
    const bytes = serializeObjectEvent({
      localId: 1, gfxId: 0, x: -5, y: -1, elevation: 0, movementType: 0,
      movementRange: 0, trainerType: 0, sight: 0, scriptPtr: 0, flag: 0,
    })
    const dv = new DataView(bytes.buffer)
    expect(dv.getInt16(4, true)).toBe(-5)
    expect(dv.getInt16(6, true)).toBe(-1)
  })

  it('rejects an out-of-range gfxId and a non-GBA script pointer', () => {
    const base: ObjectEventEdit = {
      localId: 1, gfxId: 0, x: 0, y: 0, elevation: 0, movementType: 0,
      movementRange: 0, trainerType: 0, sight: 0, scriptPtr: 0, flag: 0,
    }
    expect(() => serializeObjectEvent({ ...base, gfxId: 300 })).toThrow(/gfxId/)
    expect(() => serializeObjectEvent({ ...base, scriptPtr: 0x1234 })).toThrow(/GBA address/)
  })

  it('assembles the exact 23-byte trainerbattle script', () => {
    const s = assembleTrainerbattle({
      trainerId: 11,
      introPtr: gbaPointer(0x157893c),
      defeatPtr: gbaPointer(0x1578970),
      afterPtr: gbaPointer(0x1578990),
    })
    expect(s.length).toBe(23)
    expect(s[0]).toBe(0x5c) // trainerbattle
    expect(s[1]).toBe(0x00) // kind 0
    const dv = new DataView(s.buffer)
    expect(dv.getUint16(2, true)).toBe(11) // trainerId
    expect(dv.getUint32(6, true)).toBe(gbaPointer(0x157893c)) // intro
    expect(dv.getUint32(10, true)).toBe(gbaPointer(0x1578970)) // defeat
    expect(s[14]).toBe(0x0f) // loadword
    expect(dv.getUint32(16, true)).toBe(gbaPointer(0x1578990)) // after
    expect(s[20]).toBe(0x09)
    expect(s[21]).toBe(0x06)
    expect(s[22]).toBe(0x02) // end
  })

  it('encodes dialogue with 0xFE newlines and a 0xFF terminator', () => {
    const enc = encodeDialogue('AB\nCD')
    expect(enc[enc.length - 1]).toBe(0xff) // terminator
    expect([...enc]).toContain(0xfe) // newline control code
    // exactly one newline byte for one \n
    expect([...enc].filter((b) => b === 0xfe).length).toBe(1)
  })
})

// -------- Real-ROM tests (skipped when H&S isn't present) --------

const romExists = heartAndSoulRom !== null

describe.skipIf(!romExists)('mapEvents on the real Heart & Soul ROM', () => {
  const bytes = romExists ? new Uint8Array(fs.readFileSync(heartAndSoulRom!.rom)) : new Uint8Array()
  const loaded = romExists ? loadRom(bytes, 'Pokemon Heart & Soul.gba', undefined) : null!
  const rom = romExists ? new RomBuffer(bytes) : null!

  it('resolves Rock Tunnel 1F (bank 24 map 59) to header 0xf34754', () => {
    const header = resolveMapHeader(rom, loaded.anchors, 24, 59)
    expect(header).toBe(0xf34754)
  })

  it('decodes the Rock Tunnel 1F object-event array cleanly', () => {
    const header = resolveMapHeader(rom, loaded.anchors, 24, 59)
    const events = readEvents(rom, header)
    // 13 originally; 14 once the BRUNO trainer has been applied. Either is valid.
    expect(events.objectCount).toBeGreaterThanOrEqual(13)
    expect(events.objects.length).toBe(events.objectCount)
    // Every object's coordinates are within the 58×40 layout, elevation sane.
    for (const o of events.objects) {
      expect(o.x).toBeGreaterThanOrEqual(0)
      expect(o.y).toBeGreaterThanOrEqual(0)
      expect(o.elevation).toBeLessThanOrEqual(15)
    }
  })

  it('grows the object array: existing objects byte-identical, new one appended', () => {
    const header = resolveMapHeader(rom, loaded.anchors, 24, 59)
    const events = readEvents(rom, header)
    const newObj: ObjectEventEdit = {
      localId: events.objectCount + 1, gfxId: 0x2e, x: 20, y: 10, elevation: 3,
      movementType: 0x08, movementRange: 0, trainerType: 1, sight: 3,
      scriptPtr: gbaPointer(0x1600000), flag: 0,
    }
    const fakeArrayOffset = 0x1600100
    const { array, patches } = growObjectArray(rom, events, [newObj], fakeArrayOffset)

    // Array is the right size and its head matches the current objects verbatim.
    expect(array.length).toBe((events.objectCount + 1) * OBJECT_EVENT_LEN)
    const head = rom.slice(events.objectArrayOffset!, events.objectCount * OBJECT_EVENT_LEN)
    expect([...array.subarray(0, head.length)]).toEqual([...head])
    // Appended object serializes to our edit.
    const appended = array.subarray(events.objectCount * OBJECT_EVENT_LEN)
    expect([...appended]).toEqual([...serializeObjectEvent(newObj)])

    // Two patches: bumped count byte + repointed array pointer.
    expect(patches).toHaveLength(2)
    const countPatch = patches[0]
    expect(countPatch.bytes[0]).toBe(events.objectCount + 1)
    const ptrPatch = patches[1]
    expect(new DataView(ptrPatch.bytes.buffer, ptrPatch.bytes.byteOffset).getUint32(0, true))
      .toBe(gbaPointer(fakeArrayOffset))
  })

  it('edits an object in place without relocation', () => {
    const header = resolveMapHeader(rom, loaded.anchors, 24, 59)
    const events = readEvents(rom, header)
    const first = events.objects[0]
    const moved: ObjectEventEdit = {
      localId: first.localId, gfxId: first.gfxId, x: first.x + 1, y: first.y,
      elevation: first.elevation, movementType: first.movementType,
      movementRange: first.movementRange, trainerType: first.trainerType,
      sight: first.sight, scriptPtr: first.scriptOffset === null ? 0 : gbaPointer(first.scriptOffset),
      flag: first.flag,
    }
    const patch = editObjectInPlace(first, moved)
    // Patch targets the object's own slot and is exactly one record wide.
    expect(patch.offset).toBe(first.offset)
    expect(patch.bytes.length).toBe(OBJECT_EVENT_LEN)
  })
})
