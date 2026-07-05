import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { applyLearnsetEdits, applyRomEdits } from '../src/rom/writer'

/**
 * Phase 1 gate: verify parsing against the real modded ROM.
 * Skipped automatically when the ROM isn't present (e.g. CI / other machines).
 * Expected values were independently confirmed with Hex Maniac Advance.
 */
const DIR = 'C:/Users/Waldo/Downloads/Pokemon - Fire Red Version [a1] (U) (Squirrels) (2)'
const ROM_PATH = `${DIR}/20260426__GPT_Mods.gba`
const TOML_PATH = `${DIR}/20260426__GPT_Mods.toml`

const romExists = fs.existsSync(ROM_PATH) && fs.existsSync(TOML_PATH)

describe.skipIf(!romExists)('real ROM integration (Phase 1 gate)', () => {
  const bytes = romExists ? new Uint8Array(fs.readFileSync(ROM_PATH)) : new Uint8Array()
  const toml = romExists ? fs.readFileSync(TOML_PATH, 'utf8') : ''
  const loaded = romExists ? loadRom(bytes, '20260426__GPT_Mods.gba', toml) : null!

  it('identifies the ROM and uses toml anchors', () => {
    expect(loaded.rom.gameCode()).toBe('BPRE')
    expect(loaded.anchorSource).toBe('toml')
    expect(loaded.warnings).toEqual([])
  })

  it('reads expanded tables from the toml', () => {
    expect(loaded.species.length).toBe(412)
    expect(loaded.moves.length).toBe(356) // mod added move #355
    expect(loaded.anchors.moveNames).toBe(0x71a780) // repointed
    expect(loaded.anchors.moveStats).toBe(0x71c600) // repointed
  })

  it('decodes species and move names', () => {
    expect(loaded.species[1].name).toBe('BULBASAUR')
    expect(loaded.moves[33].name).toBe('TACKLE')
    expect(loaded.moves[355].name).toBe('CARVE') // custom move
  })

  it('reads types from base stats', () => {
    expect(loaded.typeNames[10]).toBe('FIRE')
    expect(loaded.typeNames[12]).toBe('GRASS')
    // Bulbasaur: GRASS/POISON
    expect(loaded.species[1].type1).toBe(12)
    expect(loaded.species[1].type2).toBe(3)
  })

  it('reads Bulbasaur’s learnset exactly as HMA shows it', () => {
    const ls = loaded.learnsets[1]
    expect(ls.origOffset).toBe(0x257494)
    expect(ls.entries).toEqual([
      { level: 1, moveId: 33 }, // TACKLE
      { level: 4, moveId: 45 }, // GROWL
      { level: 7, moveId: 73 }, // LEECH SEED
      { level: 10, moveId: 22 }, // VINE WHIP
      { level: 15, moveId: 77 }, // POISONPOWDER
      { level: 15, moveId: 79 }, // SLEEP POWDER
      { level: 20, moveId: 75 }, // RAZOR LEAF
      { level: 25, moveId: 230 }, // SWEET SCENT
      { level: 32, moveId: 74 }, // GROWTH
      { level: 39, moveId: 235 }, // SYNTHESIS
      { level: 46, moveId: 76 }, // SOLARBEAM
    ])
  })

  it('reads base stats and abilities', () => {
    // Bulbasaur: 45/49/49 SPA65 SPD65 SPE45, Overgrow
    expect(loaded.species[1].stats).toEqual({ hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 })
    expect(loaded.abilityNames[loaded.species[1].ability1]).toBe('OVERGROW')
    expect(loaded.species[1].ability2).toBe(0)
  })

  it('reads TM/HM and tutor tables with vanilla-accurate Bulbasaur rows', () => {
    expect(loaded.tmMoves).toHaveLength(58)
    expect(loaded.moves[loaded.tmMoves[5]].name).toBe('TOXIC') // TM06
    expect(loaded.moves[loaded.tmMoves[50]].name).toBe('CUT') // HM01
    expect(loaded.moves[loaded.tmMoves[57]].name).toBe('DIVE') // HM08 (unused in FR)

    const tm = loaded.tmCompat[1]
    expect(tm[5]).toBe(true) // Toxic ✓
    expect(tm[50]).toBe(true) // Cut ✓
    expect(tm[51]).toBe(false) // Fly ✗
    expect(tm[25]).toBe(false) // Earthquake ✗

    expect(loaded.tutorMoves).toHaveLength(15)
    expect(loaded.moves[loaded.tutorMoves[3]].name).toBe('BODY SLAM')
    expect(loaded.tutorCompat[1][3]).toBe(true) // Body Slam ✓
    expect(loaded.tutorCompat[1][0]).toBe(false) // Mega Punch ✗
  })

  it('writes a TM compat toggle with a surgical byte diff (in-memory)', () => {
    // Teach Bulbasaur HM02 Fly (why not — it has leaves).
    const flags = [...loaded.tmCompat[1]]
    flags[51] = true
    const { bytes, ops } = applyRomEdits(loaded.rom, loaded.anchors, {
      tmCompat: new Map([[1, flags]]),
    })

    expect(ops).toEqual([
      {
        species: 1,
        kind: 'tm-compat',
        oldOffset: loaded.anchors.tmCompat + 8,
        newOffset: loaded.anchors.tmCompat + 8,
        byteLength: 8,
        erasedOld: false,
      },
    ])
    let diff = 0
    for (let i = 0; i < bytes.length; i++) if (bytes[i] !== loaded.rom.bytes[i]) diff++
    expect(diff).toBe(1) // exactly one byte flips one bit

    const reloaded = loadRom(bytes, 'test.gba', toml)
    expect(reloaded.tmCompat[1][51]).toBe(true)
    expect(reloaded.tmCompat[1].filter(Boolean).length).toBe(
      loaded.tmCompat[1].filter(Boolean).length + 1,
    )
  })

  it('applies an in-place edit with a surgical byte diff (in-memory)', () => {
    // Species 4 (Charmander) has a sole-owned learnset — bump the first move's
    // level by one: same size, must stay in place.
    const original = loaded.learnsets[4].entries
    const entries = original.map((e, i) => (i === 0 ? { ...e, level: e.level + 1 } : e))
    const { bytes, ops } = applyLearnsetEdits(loaded.rom, loaded.anchors, new Map([[4, entries]]))

    expect(ops).toHaveLength(1)
    expect(ops[0].kind).toBe('in-place')

    let diff = 0
    for (let i = 0; i < bytes.length; i++) if (bytes[i] !== loaded.rom.bytes[i]) diff++
    expect(diff).toBeLessThanOrEqual(2) // one u16 changed, nothing else

    const reloaded = loadRom(bytes, 'test.gba', toml)
    expect(reloaded.learnsets[4].entries).toEqual(entries)
  })

  it('clones on write for Bulbasaur, whose learnset is shared with species 0 (in-memory)', () => {
    // Vanilla quirk preserved in this ROM: species 0 (the “??????????”
    // placeholder) points at Bulbasaur's learnset. Editing Bulbasaur must
    // therefore repoint and must NOT erase the old list.
    expect(loaded.learnsets[0].origOffset).toBe(loaded.learnsets[1].origOffset)

    // Teach Bulbasaur the custom move CARVE at Lv60 (grows past its 12 slots anyway).
    const entries = [...loaded.learnsets[1].entries, { level: 60, moveId: 355 }]
    const { bytes, ops } = applyLearnsetEdits(loaded.rom, loaded.anchors, new Map([[1, entries]]))

    expect(ops[0].kind).toBe('repointed')
    expect(ops[0].erasedOld).toBe(false) // species 0 still owns the old list
    expect(ops[0].newOffset).toBeGreaterThanOrEqual(0x700000)

    // Byte diff confined to: new list (26 bytes) + pointer (4). Old list intact.
    let diff = 0
    for (let i = 0; i < bytes.length; i++) if (bytes[i] !== loaded.rom.bytes[i]) diff++
    expect(diff).toBeLessThanOrEqual(26 + 4)

    const reloaded = loadRom(bytes, 'test.gba', toml)
    expect(reloaded.learnsets[1].entries).toHaveLength(12)
    expect(reloaded.learnsets[1].entries[11]).toEqual({ level: 60, moveId: 355 })
    // species 0 completely unaffected
    expect(reloaded.learnsets[0].entries).toEqual(loaded.learnsets[0].entries)
    expect(reloaded.learnsets[0].origOffset).toBe(loaded.learnsets[0].origOffset)
    expect(reloaded.warnings).toEqual([]) // still a perfectly loadable ROM
  })

  it('reads evolutions and item names', () => {
    // Bulbasaur → Ivysaur at Lv16
    expect(loaded.evolutions[1]).toEqual([{ method: 4, param: 16, target: 2 }])
    // Eevee: five branches — three stones plus day/night friendship (mod-enabled)
    const eevee = loaded.evolutions[133]
    expect(eevee).toHaveLength(5)
    const stoneTargets = eevee
      .filter((e) => e.method === 7)
      .map((e) => loaded.species[e.target].name)
      .sort()
    expect(stoneTargets).toEqual(['FLAREON', 'JOLTEON', 'VAPOREON'])
    expect(eevee.map((e) => e.method).sort((a, b) => a - b)).toEqual([2, 3, 7, 7, 7])
    // This mod converted trade evolutions to level-ups: Haunter → Gengar at Lv42
    expect(loaded.evolutions[93]).toEqual([{ method: 4, param: 42, target: 94 }])
    // Item names resolve for stone params
    expect(loaded.itemNames[97]).toBe('WATER STONE')
    expect(loaded.itemNames[94]).toBe('MOON STONE')
  })

  it('writes an evolution edit with a surgical byte diff (in-memory)', () => {
    // Bulbasaur → Ivysaur at Lv20 instead of Lv16.
    const { bytes, ops } = applyRomEdits(loaded.rom, loaded.anchors, {
      evolutions: new Map([[1, [{ method: 4, param: 20, target: 2 }]]]),
    })
    expect(ops[0].kind).toBe('evolution')

    let diff = 0
    for (let i = 0; i < bytes.length; i++) if (bytes[i] !== loaded.rom.bytes[i]) diff++
    expect(diff).toBeLessThanOrEqual(2) // only the param u16 changes

    const reloaded = loadRom(bytes, 'test.gba', toml)
    expect(reloaded.evolutions[1]).toEqual([{ method: 4, param: 20, target: 2 }])
    expect(reloaded.evolutions[2]).toEqual(loaded.evolutions[2]) // Ivysaur untouched
    expect(reloaded.warnings).toEqual([])
  })

  it('reads wild encounter areas with resolved map names', () => {
    expect(loaded.wildAreas).toHaveLength(132)
    const area0 = loaded.wildAreas[0]
    expect(area0.bank).toBe(2)
    expect(area0.map).toBe(27)
    expect(area0.name).toBe('MONEAN CHAMBER')
    const grass = area0.groups.grass!
    expect(grass.rate).toBe(7)
    expect(grass.slots).toHaveLength(12)
    expect(loaded.species[grass.slots[0].species].name).toBe('UNOWN')
    expect(grass.slots[0]).toMatchObject({ low: 25, high: 25 })
    // every area resolves to a non-empty name
    for (const a of loaded.wildAreas) expect(a.name.length).toBeGreaterThan(0)
  })

  it('writes a wild group edit with a surgical byte diff (in-memory)', () => {
    const grass = loaded.wildAreas[0].groups.grass!
    const slots = grass.slots.map((s, i) =>
      i === 0 ? { low: 10, high: 14, species: 1 } : s,
    )
    const { bytes, ops } = applyRomEdits(loaded.rom, loaded.anchors, {
      wild: new Map([['0:grass', { rate: 30, slots }]]),
    })

    expect(ops).toEqual([
      {
        species: 0,
        kind: 'wild',
        oldOffset: grass.infoOffset,
        newOffset: grass.infoOffset,
        byteLength: 4 + 12 * 4,
        erasedOld: false,
      },
    ])
    // Only the rate (1 byte changes: 7→30) and slot 0 (4 bytes) actually differ.
    let diff = 0
    for (let i = 0; i < bytes.length; i++) if (bytes[i] !== loaded.rom.bytes[i]) diff++
    expect(diff).toBeLessThanOrEqual(5)

    const reloaded = loadRom(bytes, 'test.gba', toml)
    const after = reloaded.wildAreas[0].groups.grass!
    expect(after.rate).toBe(30)
    expect(after.slots[0]).toEqual({ low: 10, high: 14, species: 1 })
    expect(after.slots[1]).toEqual(grass.slots[1]) // neighbours untouched
    expect(reloaded.warnings).toEqual([])
  })

  it('rejects invalid wild edits', () => {
    const grass = loaded.wildAreas[0].groups.grass!
    const badSpecies = grass.slots.map((s, i) => (i === 0 ? { ...s, species: 9999 } : s))
    expect(() =>
      applyRomEdits(loaded.rom, loaded.anchors, {
        wild: new Map([['0:grass', { rate: 7, slots: badSpecies }]]),
      }),
    ).toThrow(/invalid species #9999/)

    const badRange = grass.slots.map((s, i) => (i === 0 ? { ...s, low: 50, high: 10 } : s))
    expect(() =>
      applyRomEdits(loaded.rom, loaded.anchors, {
        wild: new Map([['0:grass', { rate: 7, slots: badRange }]]),
      }),
    ).toThrow(/bad level range/)
  })

  it('reads every learnset without runaway scans', () => {
    for (const ls of loaded.learnsets) {
      expect(ls.entries.length).toBeLessThan(128)
    }
    // every non-gap species (except placeholder 0) should have a valid pointer
    const broken = loaded.learnsets.filter((ls) => ls.origOffset === -1)
    expect(broken.length).toBe(0)
  })
})
