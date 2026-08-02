import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import { RomBuffer } from '../src/rom/buffer'
import { HS_BPEE, VANILLA_BPRE } from '../src/rom/anchors'
import { readEggMoves } from '../src/rom/tables/eggMoves'

/**
 * `gEggMoves` is a flat u16 array with no count field, so the reader has to know
 * where to stop. These tests pin both ends of that: a synthetic table that runs
 * into junk, and the real Heart & Soul table (166 species / 991 moves).
 */

const HS_ROM = process.env.SMOKE_ROM ?? 'C:/Users/Waldo/Downloads/H&S/Pokemon Heart & Soul.gba'
const hsExists = fs.existsSync(HS_ROM)

const MARKER = 20000
const CHARMANDER = 4

/** Table lives at TABLE_AT, not 0 — offset 0 is the reader's "no anchor" sentinel. */
const TABLE_AT = 8

function fakeRom(words: number[]): RomBuffer {
  const bytes = new Uint8Array(TABLE_AT + words.length * 2 + 8)
  words.forEach((w, i) => {
    bytes[TABLE_AT + i * 2] = w & 0xff
    bytes[TABLE_AT + i * 2 + 1] = (w >> 8) & 0xff
  })
  return new RomBuffer(bytes)
}

describe('egg move table', () => {
  const anchors = { ...HS_BPEE, eggMoves: 0, moveCount: 368, speciesCount: 462 }

  it('splits species blocks on the marker', () => {
    const rom = fakeRom([MARKER + 1, 10, 20, MARKER + 4, 30, 0xffff])
    const table = readEggMoves(rom, { ...anchors, eggMoves: TABLE_AT })
    expect([...table.keys()]).toEqual([1, 4])
    expect(table.get(1)).toEqual([10, 20])
    expect(table.get(4)).toEqual([30])
  })

  it('stops at the end of the table instead of reading past it', () => {
    // trailing junk: a non-marker word, then an out-of-range move id
    const rom = fakeRom([MARKER + 1, 10, 0x0102, MARKER + 2, 9999])
    const table = readEggMoves(rom, { ...anchors, eggMoves: TABLE_AT })
    expect([...table.keys()]).toEqual([1])
  })

  it('returns nothing without an anchor', () => {
    const rom = fakeRom([MARKER + 1, 10])
    expect(readEggMoves(rom, VANILLA_BPRE).size).toBe(0)
  })
})

describe.skipIf(!hsExists)('egg moves (real Heart & Soul ROM)', () => {
  const rom = hsExists ? new RomBuffer(new Uint8Array(fs.readFileSync(HS_ROM))) : null!

  it('reads the whole table', () => {
    const table = readEggMoves(rom, HS_BPEE)
    expect(table.size).toBe(166)
    expect([...table.values()].reduce((n, m) => n + m.length, 0)).toBe(991)
  })

  it('gives Charmander its Dragon Dance line', () => {
    const moves = readEggMoves(rom, HS_BPEE).get(CHARMANDER) ?? []
    expect(moves).toHaveLength(9)
    expect(moves[0]).toBe(187) // BELLY DRUM
    expect(moves.at(-1)).toBe(349) // DRAGON DANCE
  })
})
