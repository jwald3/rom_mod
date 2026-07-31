import { describe, it, expect } from 'vitest'
import { RomBuffer } from '../src/rom/buffer'
import {
  compatRowBytes,
  readCompatRow,
  serializeCompatRow,
  flagsEqual,
  tmSlotLabel,
  readMoveIdTable,
  serializeMoveIdTable,
  moveIdsEqual,
} from '../src/rom/tables/compat'
import { diffLearnsetPair } from '../src/lib/diff'

describe('compat bitfields', () => {
  it('computes row sizes', () => {
    expect(compatRowBytes(58)).toBe(8)
    expect(compatRowBytes(15)).toBe(2)
    expect(compatRowBytes(8)).toBe(1)
  })

  it('round-trips serialize → read', () => {
    const flags = Array.from({ length: 58 }, (_, i) => i % 3 === 0 || i === 57)
    const row = serializeCompatRow(flags)
    expect(row.length).toBe(8)

    const bytes = new Uint8Array(0x40)
    bytes.set(row, 0x10 + 2 * 8) // species 2's row
    const rom = new RomBuffer(bytes)
    expect(readCompatRow(rom, 0x10, 2, 58)).toEqual(flags)
  })

  it('uses LSB-first bit order within bytes', () => {
    const row = serializeCompatRow([true, false, false, false, false, false, false, false, true])
    expect(row[0]).toBe(0b0000_0001) // bit 0 = flag 0
    expect(row[1]).toBe(0b0000_0001) // bit 8 = flag 8
  })

  it('compares flags by value', () => {
    expect(flagsEqual([true, false], [true, false])).toBe(true)
    expect(flagsEqual([true, false], [true, true])).toBe(false)
    expect(flagsEqual([true], [true, false])).toBe(false)
  })

  it('labels TM and HM slots', () => {
    expect(tmSlotLabel(0)).toBe('TM01')
    expect(tmSlotLabel(49)).toBe('TM50')
    expect(tmSlotLabel(50)).toBe('HM01')
    expect(tmSlotLabel(57)).toBe('HM08')
  })
})

describe('move-id tables (TM / tutor rosters)', () => {
  it('round-trips serialize → read as little-endian u16', () => {
    const ids = [33, 264, 355, 1, 0]
    const data = serializeMoveIdTable(ids)
    expect(data.length).toBe(ids.length * 2)
    // low byte first
    expect(data[0]).toBe(33 & 0xff)
    expect(data[1]).toBe(33 >> 8)
    expect(data[2]).toBe(264 & 0xff)
    expect(data[3]).toBe(264 >> 8)

    const bytes = new Uint8Array(0x40)
    bytes.set(data, 0x10)
    const rom = new RomBuffer(bytes)
    expect(readMoveIdTable(rom, 0x10, ids.length)).toEqual(ids)
  })

  it('masks ids to 16 bits', () => {
    const data = serializeMoveIdTable([0x1_2345])
    const rom = new RomBuffer(data)
    expect(readMoveIdTable(rom, 0, 1)).toEqual([0x2345])
  })

  it('compares move-id lists by value', () => {
    expect(moveIdsEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(moveIdsEqual([1, 2, 3], [1, 2, 4])).toBe(false)
    expect(moveIdsEqual([1, 2], [1, 2, 3])).toBe(false)
  })
})

describe('diffLearnsetPair', () => {
  it('reports added and removed entries sorted by level', () => {
    const base = [
      { level: 1, moveId: 33 },
      { level: 9, moveId: 52 },
    ]
    const current = [
      { level: 1, moveId: 33 },
      { level: 5, moveId: 99 },
    ]
    const { added, removed } = diffLearnsetPair(current, base)
    expect(added).toEqual([{ level: 5, moveId: 99 }])
    expect(removed).toEqual([{ level: 9, moveId: 52 }])
  })

  it('treats a level change as remove + add', () => {
    const { added, removed } = diffLearnsetPair([{ level: 7, moveId: 33 }], [{ level: 1, moveId: 33 }])
    expect(added).toEqual([{ level: 7, moveId: 33 }])
    expect(removed).toEqual([{ level: 1, moveId: 33 }])
  })

  it('handles duplicates as a multiset', () => {
    const { added, removed } = diffLearnsetPair(
      [
        { level: 15, moveId: 77 },
        { level: 15, moveId: 77 },
      ],
      [{ level: 15, moveId: 77 }],
    )
    expect(added).toEqual([{ level: 15, moveId: 77 }])
    expect(removed).toEqual([])
  })

  it('reports nothing for identical learnsets', () => {
    const list = [
      { level: 1, moveId: 33 },
      { level: 4, moveId: 45 },
    ]
    const { added, removed } = diffLearnsetPair(list, [...list])
    expect(added).toEqual([])
    expect(removed).toEqual([])
  })
})
