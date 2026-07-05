import { describe, it, expect } from 'vitest'
import { FreeSpaceAllocator } from '../src/rom/freespace'

const SLACK = 16

function buffer(size: number): Uint8Array {
  return new Uint8Array(size) // all zeros = "used"
}

describe('FreeSpaceAllocator', () => {
  it('finds a 4-aligned run above the floor', () => {
    const bytes = buffer(0x200)
    bytes.fill(0xff, 0x81) // free space starts at odd offset 0x81
    const alloc = new FreeSpaceAllocator(bytes, 0x40)
    const off = alloc.allocate(16)
    expect(off).toBe(0x84) // rounded up to alignment
    expect(off % 4).toBe(0)
  })

  it('skips runs that are too small', () => {
    const bytes = buffer(0x200)
    bytes.fill(0xff, 0x50, 0x60) // 16 bytes — too small for 32+slack
    bytes.fill(0xff, 0x100, 0x180)
    const alloc = new FreeSpaceAllocator(bytes, 0)
    expect(alloc.allocate(32)).toBe(0x100)
  })

  it('ignores free space below the floor', () => {
    const bytes = buffer(0x200)
    bytes.fill(0xff, 0x10, 0x80)
    bytes.fill(0xff, 0x100)
    const alloc = new FreeSpaceAllocator(bytes, 0xc0)
    expect(alloc.allocate(8)).toBeGreaterThanOrEqual(0x100)
  })

  it('sequential allocations never overlap and keep slack between them', () => {
    const bytes = buffer(0x400)
    bytes.fill(0xff, 0x100)
    const alloc = new FreeSpaceAllocator(bytes, 0)
    const a = alloc.allocate(10)
    bytes.fill(0xaa, a, a + 10) // caller writes immediately
    const b = alloc.allocate(10)
    expect(b).toBeGreaterThanOrEqual(a + 10 + SLACK)
    bytes.fill(0xbb, b, b + 10)
    expect(bytes[a]).toBe(0xaa) // first allocation untouched
  })

  it('throws when no run is large enough', () => {
    const bytes = buffer(0x100)
    bytes.fill(0xff, 0xf0) // only 16 bytes free
    const alloc = new FreeSpaceAllocator(bytes, 0)
    expect(() => alloc.allocate(64)).toThrow(/No free space/)
  })
})
