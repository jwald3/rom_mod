import { describe, it, expect } from 'vitest'
import { RomBuffer } from '../src/rom/buffer'
import {
  compatRowBytes,
  readCompatRow,
  serializeCompatRow,
  flagsEqual,
  tmSlotLabel,
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
