import { describe, it, expect } from 'vitest'
import { RomBuffer, GBA_ROM_BASE } from '../src/rom/buffer'
import { VANILLA_BPRE, type AnchorMap } from '../src/rom/anchors'
import { readLearnset, type LearnsetEntry } from '../src/rom/tables/learnsets'
import { readCompatRow } from '../src/rom/tables/compat'
import { readEvolutionsFor } from '../src/rom/tables/evolutions'
import { readTrainer, trainerToEdit } from '../src/rom/tables/trainers'
import { applyLearnsetEdits, applyRomEdits } from '../src/rom/writer'

const FLOOR = 0x800

/**
 * Synthetic ROM: pointer table for 4 species at 0x10, learnsets at 0x100+,
 * free space (0xFF) from 0x800. Species 2 and 3 share one learnset.
 */
function syntheticRom(): { rom: RomBuffer; anchors: AnchorMap } {
  const bytes = new Uint8Array(0x1000)
  const view = new DataView(bytes.buffer)

  view.setUint32(0x10, GBA_ROM_BASE + 0x100, true) // species 0
  view.setUint32(0x14, GBA_ROM_BASE + 0x120, true) // species 1
  view.setUint32(0x18, GBA_ROM_BASE + 0x140, true) // species 2 ┐ shared
  view.setUint32(0x1c, GBA_ROM_BASE + 0x140, true) // species 3 ┘

  const put = (off: number, entries: LearnsetEntry[]) => {
    entries.forEach((e, i) => view.setUint16(off + i * 2, (e.level << 9) | e.moveId, true))
    view.setUint16(off + entries.length * 2, 0xffff, true)
  }
  put(0x100, [{ level: 1, moveId: 33 }, { level: 4, moveId: 45 }]) // cap 3 slots
  put(0x120, [{ level: 1, moveId: 10 }]) // cap 2 slots
  put(0x140, [{ level: 5, moveId: 20 }, { level: 6, moveId: 21 }]) // shared, cap 3 slots

  // TM compat rows (8 bytes × 4 species) at 0x200; tutor rows (2 × 4) at 0x240.
  bytes[0x200 + 8] = 0b0000_0001 // species 1 knows TM01 only

  bytes.fill(0xff, FLOOR)

  const anchors: AnchorMap = {
    ...VANILLA_BPRE,
    learnsets: 0x10,
    speciesCount: 4,
    tmCompat: 0x200,
    tutorCompat: 0x240,
    evolutions: 0x300, // 4 species × 40 bytes, all zero (no evolutions)
  }
  return { rom: new RomBuffer(bytes), anchors }
}

const edit = (species: number, entries: LearnsetEntry[]) => new Map([[species, entries]])
const opts = { freeSpaceFloor: FLOOR }

describe('applyLearnsetEdits', () => {
  it('writes same-size edits in place without moving the pointer', () => {
    const { rom, anchors } = syntheticRom()
    const next = [{ level: 2, moveId: 34 }, { level: 5, moveId: 46 }]
    const { bytes, ops } = applyLearnsetEdits(rom, anchors, edit(0, next), opts)

    expect(ops).toEqual([
      { species: 0, kind: 'in-place', oldOffset: 0x100, newOffset: 0x100, byteLength: 6, erasedOld: false },
    ])
    const out = new RomBuffer(bytes)
    expect(out.pointer(0x10)).toBe(0x100)
    expect(readLearnset(out, anchors, 0).entries).toEqual(next)
  })

  it('erases the tail when a learnset shrinks in place', () => {
    const { rom, anchors } = syntheticRom()
    const { bytes } = applyLearnsetEdits(rom, anchors, edit(0, [{ level: 2, moveId: 34 }]), opts)
    const out = new RomBuffer(bytes)
    expect(readLearnset(out, anchors, 0).entries).toEqual([{ level: 2, moveId: 34 }])
    // slots 2 (old entry) freed: bytes 0x104..0x105 are 0xFF
    expect(bytes[0x104]).toBe(0xff)
    expect(bytes[0x105]).toBe(0xff)
  })

  it('repoints when a learnset grows, erasing the old copy', () => {
    const { rom, anchors } = syntheticRom()
    const next = [
      { level: 1, moveId: 10 },
      { level: 9, moveId: 11 },
      { level: 12, moveId: 12 },
    ]
    const { bytes, ops } = applyLearnsetEdits(rom, anchors, edit(1, next), opts)

    expect(ops[0].kind).toBe('repointed')
    expect(ops[0].erasedOld).toBe(true)
    expect(ops[0].newOffset).toBeGreaterThanOrEqual(FLOOR)
    expect(ops[0].newOffset % 4).toBe(0)

    const out = new RomBuffer(bytes)
    expect(out.pointer(0x14)).toBe(ops[0].newOffset)
    expect(readLearnset(out, anchors, 1).entries).toEqual(next)
    // old slot (0x120, 2 slots = 4 bytes) erased
    for (let i = 0x120; i < 0x124; i++) expect(bytes[i]).toBe(0xff)
  })

  it('clones on write for shared learnsets and never erases a shared slot', () => {
    const { rom, anchors } = syntheticRom()
    const next = [{ level: 50, moveId: 99 }]
    const { bytes, ops } = applyLearnsetEdits(rom, anchors, edit(2, next), opts)

    // fits in the old slot, but it's shared → must repoint, must not erase
    expect(ops[0].kind).toBe('repointed')
    expect(ops[0].erasedOld).toBe(false)

    const out = new RomBuffer(bytes)
    expect(readLearnset(out, anchors, 2).entries).toEqual(next)
    // co-owner species 3 is untouched
    expect(out.pointer(0x1c)).toBe(0x140)
    expect(readLearnset(out, anchors, 3).entries).toEqual([
      { level: 5, moveId: 20 },
      { level: 6, moveId: 21 },
    ])
  })

  it('lets the second co-owner reclaim a shared slot once the first has moved away', () => {
    const { rom, anchors } = syntheticRom()
    const edits = new Map<number, LearnsetEntry[]>([
      [2, [{ level: 50, moveId: 99 }]],
      [3, [{ level: 60, moveId: 98 }, { level: 61, moveId: 97 }]],
    ])
    const { bytes, ops } = applyLearnsetEdits(rom, anchors, edits, opts)

    const op2 = ops.find((o) => o.species === 2)!
    const op3 = ops.find((o) => o.species === 3)!
    expect(op2.kind).toBe('repointed')
    // species 3 became sole owner after 2 moved away, and its edit fits → in place
    expect(op3.kind).toBe('in-place')
    expect(op3.newOffset).toBe(0x140)

    const out = new RomBuffer(bytes)
    expect(readLearnset(out, anchors, 2).entries).toEqual([{ level: 50, moveId: 99 }])
    expect(readLearnset(out, anchors, 3).entries).toEqual([
      { level: 60, moveId: 98 },
      { level: 61, moveId: 97 },
    ])
  })

  it('keeps multiple grown learnsets from colliding in free space', () => {
    const { rom, anchors } = syntheticRom()
    const grow = (base: number): LearnsetEntry[] =>
      Array.from({ length: 10 }, (_, i) => ({ level: i + 1, moveId: base + i }))
    const edits = new Map<number, LearnsetEntry[]>([
      [0, grow(100)],
      [1, grow(200)],
    ])
    const { bytes, ops } = applyLearnsetEdits(rom, anchors, edits, opts)

    const [a, b] = ops
    expect(Math.abs(a.newOffset - b.newOffset)).toBeGreaterThanOrEqual(a.byteLength)
    const out = new RomBuffer(bytes)
    expect(readLearnset(out, anchors, 0).entries).toEqual(grow(100))
    expect(readLearnset(out, anchors, 1).entries).toEqual(grow(200))
  })

  it('never mutates the source buffer', () => {
    const { rom, anchors } = syntheticRom()
    const before = rom.bytes.slice()
    applyLearnsetEdits(rom, anchors, edit(1, [{ level: 1, moveId: 1 }, { level: 2, moveId: 2 }]), opts)
    expect(rom.bytes).toEqual(before)
  })

  it('writes compat rows in place alongside learnset edits', () => {
    const { rom, anchors } = syntheticRom()
    const tmFlags = Array.from({ length: 58 }, (_, i) => i === 0 || i === 5 || i === 57)
    const tutorFlags = Array.from({ length: 15 }, (_, i) => i === 14)
    const { bytes, ops } = applyRomEdits(
      rom,
      anchors,
      {
        learnsets: edit(0, [{ level: 3, moveId: 40 }]),
        tmCompat: new Map([[1, tmFlags]]),
        tutorCompat: new Map([[1, tutorFlags]]),
      },
      opts,
    )

    expect(ops.map((o) => o.kind).sort()).toEqual(['in-place', 'tm-compat', 'tutor-compat'])
    const out = new RomBuffer(bytes)
    expect(readCompatRow(out, 0x200, 1, 58)).toEqual(tmFlags)
    expect(readCompatRow(out, 0x240, 1, 15)).toEqual(tutorFlags)
    expect(readLearnset(out, anchors, 0).entries).toEqual([{ level: 3, moveId: 40 }])
    // neighbouring species' rows untouched
    expect(bytes[0x200]).toBe(0)
    expect(bytes[0x200 + 16]).toBe(0)
  })

  it('rejects compat rows with the wrong flag count', () => {
    const { rom, anchors } = syntheticRom()
    expect(() =>
      applyRomEdits(rom, anchors, { tmCompat: new Map([[1, [true, false]]]) }, opts),
    ).toThrow(/2 flags, expected 58/)
  })

  it('writes evolution lists in place, zero-padding unused slots', () => {
    const { rom, anchors } = syntheticRom()
    const evos = [
      { method: 4, param: 16, target: 2 },
      { method: 7, param: 94, target: 3 },
    ]
    const { bytes, ops } = applyRomEdits(rom, anchors, { evolutions: new Map([[1, evos]]) }, opts)

    expect(ops).toEqual([
      {
        species: 1,
        kind: 'evolution',
        oldOffset: 0x300 + 40,
        newOffset: 0x300 + 40,
        byteLength: 40,
        erasedOld: false,
      },
    ])
    const out = new RomBuffer(bytes)
    expect(readEvolutionsFor(out, anchors, 1)).toEqual(evos)
    // unused slots stay zeroed; neighbours untouched
    expect(bytes[0x300 + 40 + 16]).toBe(0)
    expect(readEvolutionsFor(out, anchors, 0)).toEqual([])
    expect(readEvolutionsFor(out, anchors, 2)).toEqual([])
  })

  it('writes held items into the base stats struct in place', () => {
    const { rom, anchors } = syntheticRom()
    const a = { ...anchors, baseStats: 0x400 } // 4 species × 28 bytes, zeroed
    const { bytes, ops } = applyRomEdits(
      rom,
      a,
      { heldItems: new Map([[2, { item1: 0, item2: 199 }]]) },
      opts,
    )
    expect(ops).toEqual([
      {
        species: 2,
        kind: 'held-items',
        oldOffset: 0x400 + 2 * 28 + 12,
        newOffset: 0x400 + 2 * 28 + 12,
        byteLength: 4,
        erasedOld: false,
      },
    ])
    const out = new RomBuffer(bytes)
    expect(out.u16(0x400 + 2 * 28 + 12)).toBe(0)
    expect(out.u16(0x400 + 2 * 28 + 14)).toBe(199)
    // neighbours untouched
    expect(out.u16(0x400 + 1 * 28 + 14)).toBe(0)
    expect(out.u16(0x400 + 3 * 28 + 14)).toBe(0)
  })

  it('rejects invalid held-item edits', () => {
    const { rom, anchors } = syntheticRom()
    const a = { ...anchors, baseStats: 0x400 }
    expect(() =>
      applyRomEdits(rom, a, { heldItems: new Map([[2, { item1: 0, item2: 9999 }]]) }, opts),
    ).toThrow(/invalid held item2/)
    expect(() =>
      applyRomEdits(rom, a, { heldItems: new Map([[99, { item1: 0, item2: 1 }]]) }, opts),
    ).toThrow(/invalid species/)
  })

  it('rejects invalid evolution edits', () => {
    const { rom, anchors } = syntheticRom()
    const run = (evos: { method: number; param: number; target: number }[]) => () =>
      applyRomEdits(rom, anchors, { evolutions: new Map([[1, evos]]) }, opts)

    expect(run([{ method: 99, param: 1, target: 2 }])).toThrow(/unknown method 99/)
    expect(run([{ method: 4, param: 16, target: 0 }])).toThrow(/invalid target/)
    expect(run([{ method: 4, param: 0, target: 2 }])).toThrow(/level 0 out of range/)
    expect(run([{ method: 7, param: 9999, target: 2 }])).toThrow(/invalid item/)
    expect(
      run(Array.from({ length: 6 }, () => ({ method: 4, param: 10, target: 2 }))),
    ).toThrow(/max 5/)
  })

  it('rejects out-of-range entries with the species in the message', () => {
    const { rom, anchors } = syntheticRom()
    expect(() =>
      applyLearnsetEdits(rom, anchors, edit(0, [{ level: 1, moveId: 600 }]), opts),
    ).toThrow(/Species #0.*move #600/)
    expect(() =>
      applyLearnsetEdits(rom, anchors, edit(0, [{ level: 0, moveId: 33 }]), opts),
    ).toThrow(/Species #0.*level 0/)
  })
})

/**
 * Synthetic ROM with one trainer (structType 0, 2 mons at 0x100, cap 16 bytes)
 * plus free space at FLOOR — for exercising in-place vs repointed party writes.
 */
function trainerRom(): { rom: RomBuffer; anchors: AnchorMap } {
  const bytes = new Uint8Array(0x1000)
  const view = new DataView(bytes.buffer)
  const TRAINERS = 0x20
  const PARTY = 0x100
  bytes[TRAINERS + 0] = 0 // structType
  bytes[TRAINERS + 1] = 3 // class
  bytes[TRAINERS + 4] = 0xff // empty name
  view.setUint32(TRAINERS + 0x20, 2, true) // partyCount
  view.setUint32(TRAINERS + 0x24, GBA_ROM_BASE + PARTY, true)
  for (let i = 0; i < 2; i++) {
    view.setUint16(PARTY + i * 8 + 2, 5, true) // level
    view.setUint16(PARTY + i * 8 + 4, 1, true) // species
  }
  bytes.fill(0xff, FLOOR)
  const anchors: AnchorMap = {
    ...VANILLA_BPRE,
    trainers: TRAINERS,
    trainerCount: 1,
    // Keep the always-run learnset owner-census in bounds (pointers read null).
    learnsets: 0x300,
    speciesCount: 412,
  }
  return { rom: new RomBuffer(bytes), anchors }
}

describe('trainer writes', () => {
  it('writes a same-size team in place and updates the record', () => {
    const { rom, anchors } = trainerRom()
    const e = trainerToEdit(readTrainer(rom, anchors, 0))
    e.party[0] = { ...e.party[0], species: 25, level: 50 }
    const { bytes, ops } = applyRomEdits(rom, anchors, { trainers: new Map([[0, e]]) }, opts)

    expect(ops[0].kind).toBe('trainer')
    expect(ops[0].newOffset).toBe(0x100)
    const out = new RomBuffer(bytes)
    expect(readTrainer(out, anchors, 0).party[0]).toEqual({
      iv: 0,
      level: 50,
      species: 25,
      heldItem: 0,
      moves: [0, 0, 0, 0],
    })
  })

  it('repoints and erases the old block when the team grows past its slot', () => {
    const { rom, anchors } = trainerRom()
    const e = trainerToEdit(readTrainer(rom, anchors, 0))
    // Turn on custom moves → 16-byte entries → 32 bytes > 16-byte capacity.
    e.hasMoves = true
    e.party = e.party.map((m) => ({ ...m, moves: [33, 0, 0, 0] }))
    const { bytes, ops } = applyRomEdits(rom, anchors, { trainers: new Map([[0, e]]) }, opts)

    expect(ops[0].kind).toBe('trainer-repointed')
    expect(ops[0].erasedOld).toBe(true)
    expect(ops[0].newOffset).toBeGreaterThanOrEqual(FLOOR)
    const out = new RomBuffer(bytes)
    expect(out.pointer(anchors.trainers + 0x24)).toBe(ops[0].newOffset)
    expect(out.u8(anchors.trainers)).toBe(1) // structType now 1 (custom moves)
    const t = readTrainer(out, anchors, 0)
    expect(t.hasMoves).toBe(true)
    expect(t.party[0].moves).toEqual([33, 0, 0, 0])
    // old 16-byte block erased to 0xFF
    for (let i = 0x100; i < 0x110; i++) expect(bytes[i]).toBe(0xff)
  })

  it('rejects an out-of-range team member', () => {
    const { rom, anchors } = trainerRom()
    const e = trainerToEdit(readTrainer(rom, anchors, 0))
    e.party[0] = { ...e.party[0], level: 200 }
    expect(() => applyRomEdits(rom, anchors, { trainers: new Map([[0, e]]) }, opts)).toThrow(
      /Trainer #0.*level 200/,
    )
  })

  it('never mutates the source buffer', () => {
    const { rom, anchors } = trainerRom()
    const before = rom.bytes.slice()
    const e = trainerToEdit(readTrainer(rom, anchors, 0))
    e.party[0] = { ...e.party[0], species: 99 }
    applyRomEdits(rom, anchors, { trainers: new Map([[0, e]]) }, opts)
    expect(rom.bytes).toEqual(before)
  })
})
