import { describe, it, expect } from 'vitest'
import { RomBuffer } from '../src/rom/buffer'
import { VANILLA_BPRE, type AnchorMap } from '../src/rom/anchors'
import {
  readTrade,
  readAllTrades,
  serializeTrade,
  tradesEqual,
  natureName,
  describeTrade,
  TRADE_ENTRY_LEN,
  type Trade,
} from '../src/rom/tables/trades'
import { applyRomEdits } from '../src/rom/writer'
import { anchorsFromToml } from '../src/rom/hmaToml'

const TRADES_OFF = 0x100
const LEARNSETS_OFF = 0x1000

function makeTrade(over: Partial<Trade> = {}): Trade {
  return {
    nickname: 'ABRA',
    receivedSpecies: 63, // ABRA
    ivs: [10, 20, 30, 5, 15, 25],
    abilityNum: 1,
    otId: 12345,
    conditions: [1, 2, 3, 4, 5],
    personality: 0x12345678,
    heldItem: 0,
    mailNum: 0,
    otName: 'RED',
    otGender: 0,
    sheen: 7,
    requestedSpecies: 122, // MR. MIME
    ...over,
  }
}

/** Buffer with the trades table at 0x100 and a null learnset pointer table at 0x1000. */
function syntheticRom(trades: Trade[]): { rom: RomBuffer; anchors: AnchorMap } {
  const bytes = new Uint8Array(0x2000)
  const anchors: AnchorMap = {
    ...VANILLA_BPRE,
    trades: TRADES_OFF,
    tradeCount: trades.length,
    learnsets: LEARNSETS_OFF,
    speciesCount: 412,
    itemCount: 375,
  }
  trades.forEach((t, i) => {
    bytes.set(serializeTrade(t, new Uint8Array(TRADE_ENTRY_LEN)), TRADES_OFF + i * TRADE_ENTRY_LEN)
  })
  return { rom: new RomBuffer(bytes), anchors }
}

const edit = (index: number, t: Trade) => ({ trades: new Map([[index, t]]) })

describe('trades read/serialize', () => {
  it('round-trips every field through serialize + read', () => {
    const t = makeTrade()
    const { rom, anchors } = syntheticRom([t])
    expect(readTrade(rom, anchors, 0)).toEqual(t)
  })

  it('reads all entries', () => {
    const a = makeTrade({ nickname: 'ONE', receivedSpecies: 1 })
    const b = makeTrade({ nickname: 'TWO', receivedSpecies: 4 })
    const { rom, anchors } = syntheticRom([a, b])
    const all = readAllTrades(rom, anchors)
    expect(all).toHaveLength(2)
    expect(all[0].nickname).toBe('ONE')
    expect(all[1].receivedSpecies).toBe(4)
  })

  it('preserves the struct’s padding bytes it does not own', () => {
    const original = new Uint8Array(TRADE_ENTRY_LEN).fill(0xab)
    const block = serializeTrade(makeTrade(), original)
    // Pad regions: after abilityNum (0x15–0x17), after conditions (0x21–0x23),
    // after requestedSpecies (0x3A–0x3B).
    for (const off of [0x15, 0x16, 0x17, 0x21, 0x22, 0x23, 0x3a, 0x3b]) {
      expect(block[off]).toBe(0xab)
    }
  })

  it('terminates and pads shortened name fields', () => {
    const block = serializeTrade(makeTrade({ nickname: 'ABRA' }), new Uint8Array(TRADE_ENTRY_LEN))
    expect(block[4]).toBe(0xff) // terminator right after the 4 chars
    expect(block[5]).toBe(0x00) // padding
  })

  it('rejects names the game font can’t store', () => {
    expect(() => serializeTrade(makeTrade({ nickname: 'ab#cd' }), new Uint8Array(TRADE_ENTRY_LEN))).toThrow()
  })
})

describe('tradesEqual + helpers', () => {
  it('detects any field change', () => {
    const base = makeTrade()
    expect(tradesEqual(base, makeTrade())).toBe(true)
    expect(tradesEqual(base, makeTrade({ heldItem: 1 }))).toBe(false)
    expect(tradesEqual(base, makeTrade({ ivs: [10, 20, 30, 5, 15, 26] }))).toBe(false)
    expect(tradesEqual(base, makeTrade({ nickname: 'ABRAA' }))).toBe(false)
  })

  it('derives nature from personality % 25', () => {
    expect(natureName(0)).toBe('Hardy')
    expect(natureName(25)).toBe('Hardy')
    expect(natureName(3)).toBe('Adamant')
    expect(natureName(0xffffffff)).toBe(natureName(0xffffffff % 25))
  })

  it('describes a trade', () => {
    const names = (id: number) => (id === 63 ? 'ABRA' : id === 122 ? 'MR. MIME' : `#${id}`)
    expect(describeTrade(makeTrade(), names)).toBe('ABRA for MR. MIME')
  })
})

describe('writer: trades', () => {
  it('writes a trade edit in place and reads it back', () => {
    const { rom, anchors } = syntheticRom([makeTrade()])
    const next = makeTrade({ nickname: 'GENGAR', receivedSpecies: 94, heldItem: 3, ivs: [31, 31, 31, 31, 31, 31] })
    const { bytes, ops } = applyRomEdits(rom, anchors, edit(0, next))

    expect(ops).toEqual([
      {
        species: 0,
        kind: 'trade',
        oldOffset: TRADES_OFF,
        newOffset: TRADES_OFF,
        byteLength: TRADE_ENTRY_LEN,
        erasedOld: false,
      },
    ])
    const out = new RomBuffer(bytes)
    expect(readTrade(out, anchors, 0)).toEqual(next)
    // The source buffer is never mutated.
    expect(readTrade(rom, anchors, 0).nickname).toBe('ABRA')
  })

  it('rejects an out-of-range species', () => {
    const { rom, anchors } = syntheticRom([makeTrade()])
    expect(() => applyRomEdits(rom, anchors, edit(0, makeTrade({ requestedSpecies: 9999 })))).toThrow(
      /requested species/,
    )
  })

  it('rejects an out-of-range held item', () => {
    const { rom, anchors } = syntheticRom([makeTrade()])
    expect(() => applyRomEdits(rom, anchors, edit(0, makeTrade({ heldItem: 9999 })))).toThrow(
      /held item/,
    )
  })
})

describe('toml wiring', () => {
  it('resolves the trades anchor and count', () => {
    const sample = `
[[NamedAnchors]]
Name = '''data.pokemon.trades'''
Address = 0x26CF8C
Format = '''[nickname""12 receive:data.pokemon.names hp. attack. defense. speed. spatk. spdef. abilitynum:: trainerid:: cool. tough. beauty. smart. cute. unused. unused: personality:: nature|=personality%25|data.pokemon.natures.names helditem:data.items.stats mailnum. trainername""11 trainergender.trainergender sheen. give::data.pokemon.names]9'''
`
    const { anchors, found } = anchorsFromToml(sample)
    expect(anchors.trades).toBe(0x26cf8c)
    expect(anchors.tradeCount).toBe(9)
    expect(found).toContain('data.pokemon.trades')
  })
})
