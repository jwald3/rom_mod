import { describe, it, expect } from 'vitest'
import { RomBuffer, GBA_ROM_BASE } from '../src/rom/buffer'
import { VANILLA_BPRE, type AnchorMap } from '../src/rom/anchors'
import {
  readTrainer,
  serializeParty,
  serializeTrainerRecord,
  partyEntryLen,
  structTypeOf,
  trainerToEdit,
  trainersEqual,
  blankMon,
  type TrainerEdit,
} from '../src/rom/tables/trainers'
import { encode } from '../src/rom/charmap'

/**
 * Synthetic ROM with two trainers: #0 default-moves (structType 0, 8-byte
 * entries) and #1 item+custom-moves (structType 3, 16-byte entries). Their
 * party blocks sit after the 40-byte records.
 */
function syntheticRom(): { rom: RomBuffer; anchors: AnchorMap } {
  const bytes = new Uint8Array(0x400)
  const view = new DataView(bytes.buffer)
  const TRAINERS = 0x40
  const P0 = 0x100 // trainer 0 party (2 mons × 8)
  const P1 = 0x140 // trainer 1 party (1 mon × 16)

  // Trainer 0: structType 0, class 5, name "RED", 2 Pokémon.
  const t0 = TRAINERS
  bytes[t0 + 0] = 0
  bytes[t0 + 1] = 5
  bytes[t0 + 2] = 0x80 | 3 // female + music 3
  bytes[t0 + 3] = 9
  bytes.set(encode('RED'), t0 + 4)
  bytes[t0 + 4 + 3] = 0xff
  view.setUint32(t0 + 0x20, 2, true)
  view.setUint32(t0 + 0x24, GBA_ROM_BASE + P0, true)
  view.setUint16(P0 + 0, 10, true) // iv
  view.setUint16(P0 + 2, 5, true) // level
  view.setUint16(P0 + 4, 1, true) // species
  view.setUint16(P0 + 8, 20, true)
  view.setUint16(P0 + 10, 7, true)
  view.setUint16(P0 + 12, 4, true)

  // Trainer 1: structType 3, class 2, no name, 1 Pokémon with held item + moves.
  const t1 = TRAINERS + 40
  bytes[t1 + 0] = 3
  bytes[t1 + 1] = 2
  bytes[t1 + 4] = 0xff // empty name
  view.setUint32(t1 + 0x1c, 7, true) // aiFlags
  view.setUint32(t1 + 0x20, 1, true)
  view.setUint32(t1 + 0x24, GBA_ROM_BASE + P1, true)
  view.setUint16(P1 + 0, 250, true) // iv
  view.setUint16(P1 + 2, 54, true) // level
  view.setUint16(P1 + 4, 131, true) // species (LAPRAS)
  view.setUint16(P1 + 6, 142, true) // held item
  view.setUint16(P1 + 8, 55, true) // move 1
  view.setUint16(P1 + 10, 57, true) // move 2

  const anchors: AnchorMap = {
    ...VANILLA_BPRE,
    trainers: TRAINERS,
    trainerCount: 2,
  }
  return { rom: new RomBuffer(bytes), anchors }
}

describe('trainer entry layout', () => {
  it('uses 8-byte entries without custom moves and 16-byte with', () => {
    expect(partyEntryLen(false)).toBe(8)
    expect(partyEntryLen(true)).toBe(16)
  })

  it('derives structType from the two flags', () => {
    expect(structTypeOf({ hasMoves: false, hasItems: false })).toBe(0)
    expect(structTypeOf({ hasMoves: true, hasItems: false })).toBe(1)
    expect(structTypeOf({ hasMoves: false, hasItems: true })).toBe(2)
    expect(structTypeOf({ hasMoves: true, hasItems: true })).toBe(3)
  })
})

describe('readTrainer', () => {
  it('reads a default-moves trainer with name and gender', () => {
    const { rom, anchors } = syntheticRom()
    const t = readTrainer(rom, anchors, 0)
    expect(t.name).toBe('RED')
    expect(t.cls).toBe(5)
    expect(t.gender).toBe(1)
    expect(t.music).toBe(3)
    expect(t.sprite).toBe(9)
    expect(t.hasMoves).toBe(false)
    expect(t.hasItems).toBe(false)
    expect(t.party).toEqual([
      { iv: 10, level: 5, species: 1, heldItem: 0, moves: [0, 0, 0, 0] },
      { iv: 20, level: 7, species: 4, heldItem: 0, moves: [0, 0, 0, 0] },
    ])
    expect(t.partyCapacity).toBe(2 * 8)
  })

  it('reads a held-item + custom-move trainer', () => {
    const { rom, anchors } = syntheticRom()
    const t = readTrainer(rom, anchors, 1)
    expect(t.name).toBe('')
    expect(t.hasMoves).toBe(true)
    expect(t.hasItems).toBe(true)
    expect(t.aiFlags).toBe(7)
    expect(t.party).toEqual([
      { iv: 250, level: 54, species: 131, heldItem: 142, moves: [55, 57, 0, 0] },
    ])
    expect(t.partyCapacity).toBe(1 * 16)
  })
})

describe('serialize round-trip', () => {
  it('serializes a party block that reads back identically', () => {
    const { rom, anchors } = syntheticRom()
    const edit = trainerToEdit(readTrainer(rom, anchors, 1))
    const party = serializeParty(edit, anchors.speciesCount, anchors.moveCount, anchors.itemCount)
    expect(party.length).toBe(16)
    const view = new DataView(party.buffer)
    expect(view.getUint16(0, true)).toBe(250)
    expect(view.getUint16(4, true)).toBe(131)
    expect(view.getUint16(6, true)).toBe(142)
    expect(view.getUint16(8, true)).toBe(55)
  })

  it('round-trips a full record', () => {
    const { rom, anchors } = syntheticRom()
    const edit = trainerToEdit(readTrainer(rom, anchors, 0))
    const record = serializeTrainerRecord(edit, GBA_ROM_BASE + 0x200, anchors.trainerClassCount, anchors.itemCount)
    expect(record.length).toBe(40)
    expect(record[0]).toBe(0) // structType
    expect(record[1]).toBe(5) // class
    // name RED then terminator
    expect([...record.slice(4, 7)]).toEqual([...encode('RED')])
    expect(record[7]).toBe(0xff)
  })
})

describe('validation', () => {
  const base = (): TrainerEdit => ({
    name: 'X',
    cls: 0,
    gender: 0,
    music: 0,
    sprite: 0,
    items: [0, 0, 0, 0],
    doubleBattle: 0,
    aiFlags: 0,
    hasMoves: false,
    hasItems: false,
    party: [blankMon()],
  })

  it('rejects out-of-range level, species, iv', () => {
    const a = VANILLA_BPRE
    expect(() => serializeParty({ ...base(), party: [{ ...blankMon(), level: 0 }] }, a.speciesCount, a.moveCount, a.itemCount)).toThrow(/level 0/)
    expect(() => serializeParty({ ...base(), party: [{ ...blankMon(), level: 200 }] }, a.speciesCount, a.moveCount, a.itemCount)).toThrow(/level 200/)
    expect(() => serializeParty({ ...base(), party: [{ ...blankMon(), species: 9999 }] }, a.speciesCount, a.moveCount, a.itemCount)).toThrow(/invalid species/)
    expect(() => serializeParty({ ...base(), party: [{ ...blankMon(), iv: 999 }] }, a.speciesCount, a.moveCount, a.itemCount)).toThrow(/IV 999/)
  })

  it('rejects an unencodable or overlong name', () => {
    const a = VANILLA_BPRE
    expect(() => serializeTrainerRecord({ ...base(), name: '日' }, GBA_ROM_BASE, a.trainerClassCount, a.itemCount)).toThrow(/name/)
    expect(() =>
      serializeTrainerRecord({ ...base(), name: 'ABCDEFGHIJKLM' }, GBA_ROM_BASE, a.trainerClassCount, a.itemCount),
    ).toThrow(/exceeds 12/)
  })

  it('rejects an empty or oversized party', () => {
    const a = VANILLA_BPRE
    expect(() => serializeTrainerRecord({ ...base(), party: [] }, GBA_ROM_BASE, a.trainerClassCount, a.itemCount)).toThrow(/party size 0/)
    expect(() =>
      serializeTrainerRecord({ ...base(), party: Array.from({ length: 7 }, blankMon) }, GBA_ROM_BASE, a.trainerClassCount, a.itemCount),
    ).toThrow(/party size 7/)
  })
})

describe('trainersEqual', () => {
  it('is order- and value-sensitive', () => {
    const { rom, anchors } = syntheticRom()
    const a = trainerToEdit(readTrainer(rom, anchors, 0))
    const b = trainerToEdit(readTrainer(rom, anchors, 0))
    expect(trainersEqual(a, b)).toBe(true)
    b.party[0] = { ...b.party[0], level: 99 }
    expect(trainersEqual(a, b)).toBe(false)
  })
})
