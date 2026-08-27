import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import { RomBuffer } from '../src/rom/buffer'
import {
  MUL_NEUTRAL,
  MUL_NOT_VERY,
  MUL_NO_EFFECT,
  MUL_SUPER,
  parseTypeChartRows,
  readTypeChart,
  scoreTypeChart,
  typeChartFromRows,
} from '../src/rom/tables/typeChart'
import { HS_BPEE } from '../src/rom/anchors'
import { loadRom } from '../src/rom/loadRom'
import { heartAndSoulRom } from './romPath'

/** Build a ROM-shaped buffer with a type chart at `offset`. */
function romWithChart(
  offset: number,
  triples: number[][],
  opts: { foresightAt?: number; terminate?: boolean } = {},
): RomBuffer {
  const bytes = new Uint8Array(offset + triples.length * 3 + 64)
  let o = offset
  triples.forEach((t, i) => {
    if (opts.foresightAt === i) {
      bytes[o++] = 0xfe
      bytes[o++] = 0xfe
      bytes[o++] = 0x00
    }
    bytes[o++] = t[0]
    bytes[o++] = t[1]
    bytes[o++] = t[2]
  })
  if (opts.terminate !== false) {
    bytes[o++] = 0xff
    bytes[o++] = 0xff
    bytes[o++] = 0x00
  }
  return new RomBuffer(bytes)
}

describe('type chart parsing', () => {
  it('reads triples up to the terminator', () => {
    const rom = romWithChart(0x100, [
      [11, 10, MUL_SUPER],
      [10, 11, MUL_NOT_VERY],
    ])
    const rows = parseTypeChartRows(rom, 0x100)
    expect(rows).toHaveLength(2)
    expect(rows![0]).toEqual({ attack: 11, defend: 10, mul: 20, afterForesight: false })
  })

  it('flags rows after the Foresight marker but still reads them', () => {
    const rom = romWithChart(
      0x100,
      [
        [11, 10, MUL_SUPER],
        [0, 7, MUL_NO_EFFECT],
      ],
      { foresightAt: 1 },
    )
    const rows = parseTypeChartRows(rom, 0x100)!
    expect(rows).toHaveLength(2)
    expect(rows[1].afterForesight).toBe(true)
    // Foresight isn't modeled, so the Ghost immunity still applies.
    expect(typeChartFromRows(rows).mulTenths(0, 7)).toBe(MUL_NO_EFFECT)
  })

  it('rejects data with impossible multipliers', () => {
    const rom = romWithChart(0x100, [[11, 10, 17]])
    expect(parseTypeChartRows(rom, 0x100)).toBeNull()
  })

  it('rejects an unterminated table', () => {
    const rom = romWithChart(0x100, [[11, 10, MUL_SUPER]], { terminate: false })
    expect(parseTypeChartRows(rom, 0x100)).toBeNull()
  })

  it('treats unlisted pairs as neutral and multiplies both defending types', () => {
    const chart = typeChartFromRows([
      { attack: 11, defend: 10, mul: MUL_SUPER, afterForesight: false },
      { attack: 11, defend: 5, mul: MUL_SUPER, afterForesight: false },
      { attack: 11, defend: 12, mul: MUL_NOT_VERY, afterForesight: false },
    ])
    expect(chart.mulTenths(11, 0)).toBe(MUL_NEUTRAL)
    expect(chart.effectiveness(11, 10, 5)).toBe(4) // Water vs Fire/Rock
    expect(chart.effectiveness(11, 10, 12)).toBe(1) // Water vs Fire/Grass
    expect(chart.effectiveness(11, 10, 10)).toBe(2) // mono-type: not squared
  })

  it('scores a chart against the canonical matchups', () => {
    const rows = [{ attack: 11, defend: 10, mul: MUL_SUPER, afterForesight: false }]
    const { hits, total, misses } = scoreTypeChart(rows, 18)
    expect(hits).toBe(1)
    expect(total).toBeGreaterThan(1)
    expect(misses.length).toBe(total - 1)
  })

  it('falls back to an all-neutral chart, with a warning, when no anchor exists', () => {
    const rom = romWithChart(0x100, [[11, 10, MUL_SUPER]])
    const chart = readTypeChart(rom, { ...HS_BPEE, typeChart: 0 })
    expect(chart.offset).toBe(-1)
    expect(chart.effectiveness(11, 10, 10)).toBe(1)
    expect(chart.warnings[0]).toMatch(/no type-chart anchor/i)
  })
})

const romExists = heartAndSoulRom !== null

describe.skipIf(!romExists)('type chart against the real Heart & Soul ROM', () => {
  const loaded = romExists
    ? loadRom(new Uint8Array(fs.readFileSync(heartAndSoulRom!.rom)), 'Pokemon Heart & Soul.gba')
    : null!

  it('reads the canonically complete table at the anchored offset', () => {
    expect(loaded.typeChart.offset).toBe(0x6e13bc)
    expect(loaded.typeChart.rows).toHaveLength(120)
    expect(loaded.typeChart.warnings).toEqual([])
  })

  it('agrees with every canonical matchup, Fairy included', () => {
    const { hits, total, misses } = scoreTypeChart(loaded.typeChart.rows, loaded.anchors.typeCount)
    expect(misses).toEqual([])
    expect(hits).toBe(total)
  })

  it('resolves dual-type matchups', () => {
    const t = loaded.typeChart
    expect(t.effectiveness(13, 11, 2)).toBe(4) // Electric vs Water/Flying (Gyarados)
    expect(t.effectiveness(13, 4, 5)).toBe(0) // Electric vs Ground/Rock
    expect(t.effectiveness(12, 11, 4)).toBe(4) // Grass vs Water/Ground (Quagsire)
    expect(t.effectiveness(10, 6, 8)).toBe(4) // Fire vs Bug/Steel (Scizor)
  })

  it('is not the incomplete neighbouring copy at 0x6e1258', () => {
    const other = parseTypeChartRows(loaded.rom, 0x6e1258)!
    const chart = typeChartFromRows(other)
    // The neighbour is missing Ground→Rock ×2, which the real one has.
    expect(chart.mulTenths(4, 5)).toBe(MUL_NEUTRAL)
    expect(loaded.typeChart.mulTenths(4, 5)).toBe(MUL_SUPER)
  })
})
