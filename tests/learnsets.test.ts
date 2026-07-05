import { describe, it, expect } from 'vitest'
import { RomBuffer, GBA_ROM_BASE } from '../src/rom/buffer'
import { VANILLA_BPRE, type AnchorMap } from '../src/rom/anchors'
import { readLearnset, packEntry, unpackEntry } from '../src/rom/tables/learnsets'

/** Build a tiny synthetic ROM: pointer table at 0x10, learnset data at 0x40. */
function syntheticRom(): { rom: RomBuffer; anchors: AnchorMap } {
  const bytes = new Uint8Array(0x100)
  const view = new DataView(bytes.buffer)

  // species 0 → learnset at 0x40; species 1 → invalid pointer (0)
  view.setUint32(0x10, GBA_ROM_BASE + 0x40, true)
  view.setUint32(0x14, 0, true)
  // species 2 → empty learnset at 0x60
  view.setUint32(0x18, GBA_ROM_BASE + 0x60, true)

  // learnset for species 0: Lv1 move 33, Lv4 move 45, Lv15 move 300
  view.setUint16(0x40, (1 << 9) | 33, true)
  view.setUint16(0x42, (4 << 9) | 45, true)
  view.setUint16(0x44, (15 << 9) | 300, true)
  view.setUint16(0x46, 0xffff, true)
  // empty learnset
  view.setUint16(0x60, 0xffff, true)

  const anchors: AnchorMap = { ...VANILLA_BPRE, learnsets: 0x10, speciesCount: 3 }
  return { rom: new RomBuffer(bytes), anchors }
}

describe('learnsets', () => {
  it('packs and unpacks entries symmetrically', () => {
    for (const e of [
      { level: 1, moveId: 33 },
      { level: 100, moveId: 511 },
      { level: 46, moveId: 76 },
    ]) {
      expect(unpackEntry(packEntry(e))).toEqual(e)
    }
  })

  it('reads a learnset until the terminator', () => {
    const { rom, anchors } = syntheticRom()
    const ls = readLearnset(rom, anchors, 0)
    expect(ls.entries).toEqual([
      { level: 1, moveId: 33 },
      { level: 4, moveId: 45 },
      { level: 15, moveId: 300 },
    ])
    expect(ls.origOffset).toBe(0x40)
    expect(ls.origCapacity).toBe(4) // 3 entries + terminator
  })

  it('handles invalid pointers gracefully', () => {
    const { rom, anchors } = syntheticRom()
    const ls = readLearnset(rom, anchors, 1)
    expect(ls.entries).toEqual([])
    expect(ls.origOffset).toBe(-1)
    expect(ls.origCapacity).toBe(0)
  })

  it('handles empty learnsets', () => {
    const { rom, anchors } = syntheticRom()
    const ls = readLearnset(rom, anchors, 2)
    expect(ls.entries).toEqual([])
    expect(ls.origOffset).toBe(0x60)
    expect(ls.origCapacity).toBe(1)
  })
})
