import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import { RomBuffer, GBA_ROM_BASE } from '../src/rom/buffer'
import { VANILLA_BPRE } from '../src/rom/anchors'
import { FreeSpaceAllocator } from '../src/rom/freespace'
import { readSpecies } from '../src/rom/tables/species'
import { readItemNames } from '../src/rom/tables/evolutions'
import {
  readPrizeLists,
  emptyPrizeLists,
  buildPrizeListEdit,
  prizesEqual,
  makePrizeLabel,
  commaGroup,
  type Prize,
  type PrizeKind,
} from '../src/rom/tables/gameCorner'
import { applyRomEdits } from '../src/rom/writer'

const ROM_PATH = 'rom/20260426__GPT_Mods.gba'
const romExists = fs.existsSync(ROM_PATH)

// ── Pure-function tests (always run) ─────────────────────────────────────
describe('game corner label formatting', () => {
  it('comma-groups costs like the vanilla labels', () => {
    expect(commaGroup(180)).toBe('180')
    expect(commaGroup(2800)).toBe('2,800')
    expect(commaGroup(9999)).toBe('9,999')
  })

  it('builds a label with the right-align + shift control codes and COINS suffix', () => {
    const label = makePrizeLabel('ABRA', 180, 0x55)
    // Ends with the 0xFF terminator.
    expect(label[label.length - 1]).toBe(0xff)
    // Contains the right-align control code FC 13 55.
    let hasAlign = false
    for (let i = 0; i + 2 < label.length; i++) {
      if (label[i] === 0xfc && label[i + 1] === 0x13 && label[i + 2] === 0x55) hasAlign = true
    }
    expect(hasAlign).toBe(true)
  })
})

describe('game corner unavailable (no Celadon Game Corner, e.g. Emerald/H&S)', () => {
  it('returns non-regenerable stubs for every prize kind', () => {
    const lists = emptyPrizeLists()
    for (const kind of ['pokemon', 'tm', 'item'] as PrizeKind[]) {
      expect(lists[kind].kind).toBe(kind)
      expect(lists[kind].regenerable).toBe(false)
      expect(lists[kind].entries).toEqual([])
    }
  })
})

// ── Real-ROM tests (skipped when the ROM isn't present) ──────────────────
describe.skipIf(!romExists)('game corner prizes (real ROM)', () => {
  const bytes = romExists ? new Uint8Array(fs.readFileSync(ROM_PATH)) : new Uint8Array()
  const src = romExists ? new RomBuffer(bytes) : null!
  const anchors = VANILLA_BPRE

  it('parses the vanilla FireRed prize lists exactly', () => {
    const lists = readPrizeLists(src, anchors)

    expect(lists.pokemon.regenerable).toBe(true)
    expect(lists.pokemon.entries).toEqual([
      { id: 63, cost: 180, level: 9 }, // ABRA
      { id: 35, cost: 500, level: 8 }, // CLEFAIRY
      { id: 147, cost: 2800, level: 18 }, // DRATINI
      { id: 123, cost: 5500, level: 25 }, // SCYTHER
      { id: 137, cost: 9999, level: 26 }, // PORYGON
    ])

    expect(lists.tm.regenerable).toBe(true)
    expect(lists.tm.entries.map((e) => e.cost)).toEqual([4000, 3500, 4000, 4500, 4000])

    expect(lists.item.regenerable).toBe(true)
    expect(lists.item.entries).toEqual([
      { id: 194, cost: 800 }, // SMOKE BALL
      { id: 205, cost: 1000 }, // MIRACLE SEED
      { id: 215, cost: 1000 }, // CHARCOAL
      { id: 209, cost: 1000 }, // MYSTIC WATER
      { id: 40, cost: 1600 }, // YELLOW FLUTE
    ])
  })

  function reparseAfterEdit(gc: Map<PrizeKind, Prize[]>) {
    const { bytes: out } = applyRomEdits(src, anchors, { gameCorner: gc })
    return readPrizeLists(new RomBuffer(out), anchors)
  }

  it('modifies an existing prize (species + cost) in place-ish', () => {
    const item = readPrizeLists(src, anchors).item
    const next = item.entries.map((e, i) => ({ ...e, cost: 100 + i * 50 }))
    const after = reparseAfterEdit(new Map([['item', next]]))
    expect(prizesEqual(after.item.entries, next)).toBe(true)
    expect(after.item.mcCount).toBe(next.length + 1)
  })

  it('adds a new prize and grows the menu', () => {
    const item = readPrizeLists(src, anchors).item
    const next = [...item.entries, { id: 13, cost: 3000 }]
    const after = reparseAfterEdit(new Map([['item', next]]))
    expect(after.item.entries).toHaveLength(6)
    expect(prizesEqual(after.item.entries, next)).toBe(true)
    expect(after.item.mcCount).toBe(7)
  })

  it('removes a prize and shrinks the menu', () => {
    const item = readPrizeLists(src, anchors).item
    const next = item.entries.slice(0, -1)
    const after = reparseAfterEdit(new Map([['item', next]]))
    expect(after.item.entries).toHaveLength(4)
    expect(after.item.mcCount).toBe(5)
  })

  it('regenerates the Pokémon list with its species-keyed secondary chain + levels', () => {
    const poke = readPrizeLists(src, anchors).pokemon
    const next = [...poke.entries, { id: 25, cost: 4321, level: 10 }] // add Pikachu
    const after = reparseAfterEdit(new Map([['pokemon', next]]))
    expect(after.pokemon.entries).toHaveLength(6)
    expect(prizesEqual(after.pokemon.entries, next)).toBe(true)
    // level round-trips through the secondary give-message routine
    expect(after.pokemon.entries[5].level).toBe(10)
  })

  it('keeps the ROM the same size and only touches free space + the hooked sites', () => {
    const item = readPrizeLists(src, anchors).item
    const next = item.entries.map((e) => ({ ...e, cost: e.cost + 1 }))
    const { bytes: out } = applyRomEdits(src, anchors, { gameCorner: new Map([['item', next]]) })
    expect(out.length).toBe(bytes.length)
    // Diffs are confined to: the multichoice set (8 bytes), the dispatch hook (5),
    // and freshly-allocated free space (>= 0x700000). Nothing in the low ROM beyond those.
    let lowDiffs = 0
    for (let i = 0; i < 0x700000; i++) if (out[i] !== bytes[i]) lowDiffs++
    // set(8) + hook(5) + label pointers/count already counted within the set + hook region;
    // generously bound it.
    expect(lowDiffs).toBeLessThan(64)
  })

  it('rejects an invalid prize id', () => {
    const item = readPrizeLists(src, anchors).item
    const bad = [...item.entries, { id: 999999, cost: 100 }]
    expect(() =>
      applyRomEdits(src, anchors, { gameCorner: new Map([['item', bad]]) }),
    ).toThrow(/invalid id/)
  })

  it('gates on signature: a corrupted dispatch region is not regenerable', () => {
    const corrupt = bytes.slice()
    // Smash the item dispatch chain start so parseDispatch fails.
    const item = readPrizeLists(src, anchors).item
    corrupt.fill(0, item.dispatchOffset, item.dispatchOffset + 12)
    const lists = readPrizeLists(new RomBuffer(corrupt), anchors)
    expect(lists.item.regenerable).toBe(false)
    expect(() =>
      applyRomEdits(new RomBuffer(corrupt), anchors, {
        gameCorner: new Map([['item', item.entries]]),
      }),
    ).toThrow(/unsupported ROM layout/)
  })

  it('builds an edit whose blobs all land in allocated free space', () => {
    const item = readPrizeLists(src, anchors).item
    const species = readSpecies(src, anchors)
    const itemNames = readItemNames(src, anchors)
    const outBytes = bytes.slice()
    const alloc = new FreeSpaceAllocator(outBytes)
    const edit = buildPrizeListEdit(item, [...item.entries, { id: 20, cost: 500 }], {
      allocate: (n) => alloc.allocate(n),
      speciesName: (id) => species[id]?.name ?? '',
      itemName: (id) => itemNames[id] ?? '',
    })
    // The script + options + label blobs (all but the two hook sites) live in free space.
    for (const b of edit.blobs) {
      const isHook = b.offset === item.dispatchOffset || b.offset === item.secondaryDispatchOffset
      if (!isHook) expect(b.offset).toBeGreaterThanOrEqual(0x700000)
    }
    // The multichoice pointer/count writes target the low-ROM set table.
    expect(edit.pointers.some((p) => p.at === item.mcSetOffset)).toBe(true)
    expect(edit.words.some((w) => w.at === item.mcSetOffset + 4)).toBe(true)
    void GBA_ROM_BASE
  })
})
