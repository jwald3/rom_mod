import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import { RomBuffer } from '../src/rom/buffer'
import { VANILLA_BPRE } from '../src/rom/anchors'
import { readItemNames } from '../src/rom/tables/evolutions'
import { readShops, describeShop, serializeShopList, shopsEqual } from '../src/rom/tables/shops'
import { applyRomEdits } from '../src/rom/writer'

const ROM_PATH = 'rom/20260426__GPT_Mods.gba'
const romExists = fs.existsSync(ROM_PATH)

describe('shop list serialization', () => {
  it('serializes a 0-terminated u16 list', () => {
    const bytes = serializeShopList([1, 2, 300])
    const v = new DataView(bytes.buffer)
    expect(bytes.length).toBe(8) // 3 items + terminator
    expect(v.getUint16(0, true)).toBe(1)
    expect(v.getUint16(4, true)).toBe(300)
    expect(v.getUint16(6, true)).toBe(0)
  })

  it('shopsEqual compares order-sensitively', () => {
    expect(shopsEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(shopsEqual([1, 2, 3], [3, 2, 1])).toBe(false)
    expect(shopsEqual([1], [1, 2])).toBe(false)
  })
})

describe.skipIf(!romExists)('shops (real ROM)', () => {
  const bytes = romExists ? new Uint8Array(fs.readFileSync(ROM_PATH)) : new Uint8Array()
  const src = romExists ? new RomBuffer(bytes) : null!
  const anchors = VANILLA_BPRE

  it('parses Poké Mart shops with plausible item lists', () => {
    const shops = readShops(src, anchors)
    expect(shops.length).toBeGreaterThan(10)
    // Every shop sells at least one valid item.
    for (const s of shops) {
      expect(s.items.length).toBeGreaterThan(0)
      for (const id of s.items) expect(id).toBeGreaterThan(0)
    }
    // Shops are ordered by command offset (stable).
    for (let i = 1; i < shops.length; i++) {
      expect(shops[i].cmdOffset).toBeGreaterThan(shops[i - 1].cmdOffset)
    }
  })

  it('finds an evolution-stone shop and describes it', () => {
    const names = readItemNames(src, anchors)
    const shops = readShops(src, anchors)
    const stone = shops.find((s) => s.items.some((i) => names[i] === 'FIRE STONE'))
    expect(stone).toBeDefined()
    expect(describeShop(stone!, names)).toContain('STONE')
  })

  function reparse(cmd: number, items: number[]) {
    const { bytes: out } = applyRomEdits(src, anchors, { shops: new Map([[cmd, items]]) })
    return readShops(new RomBuffer(out), anchors).find((s) => s.cmdOffset === cmd)!
  }

  it('modifies an item in place-ish (repointed) and round-trips', () => {
    const shop = readShops(src, anchors)[0]
    const next = shop.items.map((id, i) => (i === 0 ? 4 : id)) // change first item -> #4
    const got = reparse(shop.cmdOffset, next)
    expect(shopsEqual(got.items, next)).toBe(true)
  })

  it('adds an item and grows the list', () => {
    const shop = readShops(src, anchors)[0]
    const next = [...shop.items, 50]
    const got = reparse(shop.cmdOffset, next)
    expect(got.items).toHaveLength(shop.items.length + 1)
    expect(got.items[got.items.length - 1]).toBe(50)
  })

  it('removes an item and shrinks the list', () => {
    const shop = readShops(src, anchors).find((s) => s.items.length >= 3)!
    const next = shop.items.slice(0, -1)
    const got = reparse(shop.cmdOffset, next)
    expect(got.items).toHaveLength(shop.items.length - 1)
  })

  it('keeps the ROM the same size (edits go to free space)', () => {
    const shop = readShops(src, anchors)[0]
    const { bytes: out } = applyRomEdits(src, anchors, {
      shops: new Map([[shop.cmdOffset, [...shop.items, 20]]]),
    })
    expect(out.length).toBe(bytes.length)
  })

  it('rejects an invalid item id', () => {
    const shop = readShops(src, anchors)[0]
    expect(() =>
      applyRomEdits(src, anchors, { shops: new Map([[shop.cmdOffset, [999999]]]) }),
    ).toThrow(/invalid id/)
  })

  it('rejects an empty shop', () => {
    const shop = readShops(src, anchors)[0]
    expect(() =>
      applyRomEdits(src, anchors, { shops: new Map([[shop.cmdOffset, []]]) }),
    ).toThrow(/at least one item/)
  })
})
