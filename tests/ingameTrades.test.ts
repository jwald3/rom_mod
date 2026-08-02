import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import { RomBuffer } from '../src/rom/buffer'
import { HS_BPEE, type AnchorMap } from '../src/rom/anchors'
import { encode } from '../src/rom/charmap'
import {
  readIngameTrades,
  findTradeScriptIndices,
  TRADE_RECORD_LEN,
} from '../src/rom/tables/ingameTrades'

/**
 * The Heart & Soul trade table was located by seeding a byte search with one
 * in-game-confirmed trade: Violet City hands you an Onix nicknamed "ROCKY" from
 * an OT called "RUDY" in exchange for a Bellsprout. These tests pin the record
 * layout that seed established (64 bytes, otName at +0x2F, requested species at
 * +0x3C) so a future anchor change can't silently go back to vanilla's 60.
 */

// H&S is the only profile with a known trade table; overridable per machine.
const HS_ROM = process.env.SMOKE_ROM ?? 'C:/Users/Waldo/Downloads/H&S/Pokemon Heart & Soul.gba'
const hsExists = fs.existsSync(HS_ROM)

const ONIX = 95
const BELLSPROUT = 69

/** Build a synthetic ROM holding one trade record at `base`. */
function fakeRom(base: number): { rom: RomBuffer; anchors: AnchorMap } {
  const bytes = new Uint8Array(base + TRADE_RECORD_LEN * 4)
  const put = (off: number, text: string) => {
    bytes.set(encode(text), off)
    bytes[off + text.length] = 0xff // Gen 3 string terminator
  }
  const u16 = (off: number, v: number) => {
    bytes[off] = v & 0xff
    bytes[off + 1] = (v >> 8) & 0xff
  }
  put(base, 'ROCKY')
  u16(base + 0x0c, ONIX)
  bytes.set([31, 31, 31, 31, 31, 31], base + 0x0e)
  u16(base + 0x2c, 140) // held item
  bytes[base + 0x2e] = 0 // mailNum
  put(base + 0x2f, 'RUDY')
  u16(base + 0x3c, BELLSPROUT)
  // second record left zeroed → parsing must stop after the first
  return {
    rom: new RomBuffer(bytes),
    anchors: { ...HS_BPEE, ingameTrades: base, ingameTradeCount: 4 },
  }
}

describe('in-game trade records', () => {
  it('decodes the 64-byte Heart & Soul layout', () => {
    const { rom, anchors } = fakeRom(0x100)
    const trades = readIngameTrades(rom, anchors)
    expect(trades).toHaveLength(1) // stops at the zeroed record
    const t = trades[0]
    expect(t.index).toBe(0)
    expect(t.nickname).toBe('ROCKY')
    expect(t.otName).toBe('RUDY')
    expect(t.species).toBe(ONIX)
    expect(t.requestedSpecies).toBe(BELLSPROUT)
    expect(t.ivs).toEqual([31, 31, 31, 31, 31, 31])
    expect(t.heldItem).toBe(140)
    expect(t.raw).toHaveLength(TRADE_RECORD_LEN)
  })

  it('returns nothing when the profile has no trade anchor', () => {
    const { rom, anchors } = fakeRom(0x100)
    expect(readIngameTrades(rom, { ...anchors, ingameTrades: 0 })).toEqual([])
  })

  it('finds the trade preamble and ignores lookalikes', () => {
    // setvar VAR_0x8008,6 ; copyvar VAR_0x8004,VAR_0x8008 ; special 0xA8
    const good = [0x16, 0x08, 0x80, 0x06, 0x00, 0x19, 0x04, 0x80, 0x08, 0x80, 0x25, 0xa8, 0x00]
    // same setvar, but dispatched through a jump table (how gym scripts use it)
    const bad = [0x16, 0x08, 0x80, 0x03, 0x00, 0x04, 0xd4, 0x1a, 0x2d, 0x08, 0x02, 0x00, 0x00]
    const bytes = new Uint8Array(good.length + bad.length + 16)
    bytes.set(good, 0)
    bytes.set(bad, good.length)
    const hits = findTradeScriptIndices(new RomBuffer(bytes), 13)
    expect([...hits.keys()]).toEqual([6])
    expect(hits.get(6)).toEqual([0])
  })
})

describe.skipIf(!hsExists)('in-game trades (real Heart & Soul ROM)', () => {
  const rom = hsExists ? new RomBuffer(new Uint8Array(fs.readFileSync(HS_ROM))) : null!
  const anchors = HS_BPEE

  it('reads all 13 records from the relocated table', () => {
    const trades = readIngameTrades(rom, anchors)
    expect(trades).toHaveLength(13)
    expect(anchors.ingameTrades).toBe(0xd1c104)
    // Records are contiguous 64-byte entries.
    for (let i = 1; i < trades.length; i++) {
      expect(trades[i].offset - trades[i - 1].offset).toBe(TRADE_RECORD_LEN)
    }
  })

  it('matches the Violet City trade that seeded the search', () => {
    const t = readIngameTrades(rom, anchors)[1]
    expect(t.nickname).toBe('ROCKY')
    expect(t.otName).toBe('RUDY')
    expect(t.species).toBe(ONIX)
    expect(t.requestedSpecies).toBe(BELLSPROUT)
  })

  it('gives every trade flawless IVs', () => {
    for (const t of readIngameTrades(rom, anchors)) {
      expect(t.ivs).toEqual([31, 31, 31, 31, 31, 31])
    }
  })

  it('finds the six trades a script actually triggers', () => {
    const hits = findTradeScriptIndices(rom, 13)
    expect([...hits.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 5, 6])
  })
})
