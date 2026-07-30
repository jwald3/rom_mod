import { GBA_ROM_BASE, type RomBuffer } from '../buffer'
import type { AnchorMap } from '../anchors'

/**
 * Poké Mart (shop) editor support.
 *
 * Shops are `pokemart` script commands (opcode 0x86) followed by a pointer to a
 * 0-terminated array of u16 item ids. We scan the script region for these, parse
 * the item lists, and let the user add/remove/modify items. On save each edited
 * list is written to free space and its pointer repointed (the list can grow past
 * its in-place slot), mirroring the app's other repoint-on-overflow writes.
 *
 * Shops have no names in the ROM, so we label each by its contents.
 */

/** pokemart family opcodes: mart / decoration marts (all share the ptr-to-list shape). */
const OP_POKEMART = 0x86
const OP_POKEMART_DECOR = 0x87
const OP_POKEMART_DECOR2 = 0x88
const MART_OPS = [OP_POKEMART, OP_POKEMART_DECOR, OP_POKEMART_DECOR2]

/**
 * `waitmsg` (0x0f) — the script command that immediately follows a real
 * `pokemart <ptr>` (a 5-byte command) in both FireRed and Emerald. Requiring it
 * is the discriminator that rejects the false positives a full-ROM scan surfaces
 * (stray 0x86/0x87/0x88 bytes in graphics/map data that happen to be followed by
 * a pointer to a valid-looking item list). Verified: all 23 FireRed shops and
 * all 40 real Heart & Soul marts have this tail; every false positive lacks it.
 */
const OP_WAITMSG = 0x0f
const POKEMART_CMD_LEN = 5 // opcode (1) + pointer (4)

const MAX_ITEMS = 20 // sanity bound on a single shop's list length

export interface Shop {
  /** Stable id: the ROM offset of the pokemart command (unique per shop). */
  cmdOffset: number
  /** ROM offset of the item-id list (may be repointed after an edit). */
  listOffset: number
  /** Item ids sold, in order. */
  items: number[]
}

function toPtr(off: number): number {
  return (GBA_ROM_BASE + off) >>> 0
}

/**
 * Read a 0-terminated u16 item list; returns null if it doesn't look like one.
 * `maxItemId` (the profile's itemCount) rejects out-of-range ids — the main
 * defense against false-positive opcode matches when scanning the whole ROM.
 */
function readItemList(rom: RomBuffer, listOffset: number, maxItemId: number): number[] | null {
  const items: number[] = []
  for (let p = listOffset; p < rom.length - 1; p += 2) {
    const id = rom.u16(p)
    if (id === 0) return items
    if (id >= maxItemId) return null
    items.push(id)
    if (items.length > MAX_ITEMS) return null
  }
  return null
}

/**
 * Scan the script region for pokemart commands and parse their item lists.
 * Deduped by list offset (some marts share a list). Sorted by command offset for
 * a stable order across loads.
 */
export function readShops(rom: RomBuffer, anchors: AnchorMap): Shop[] {
  const shops: Shop[] = []
  const seenLists = new Set<number>()
  const start = anchors.scriptScanStart
  // scriptScanEnd = 0 means "to the end of the ROM" (expansion scatters marts
  // across the whole image); otherwise honor the profile's narrow window.
  const end = anchors.scriptScanEnd > 0 ? Math.min(anchors.scriptScanEnd, rom.length) : rom.length
  const maxItemId = anchors.itemCount
  for (let o = start; o < end; o++) {
    if (!MART_OPS.includes(rom.u8(o))) continue
    // A real pokemart command is followed by `waitmsg`; this rejects the
    // coincidental opcode matches a whole-ROM scan would otherwise pick up.
    if (rom.u8(o + POKEMART_CMD_LEN) !== OP_WAITMSG) continue
    const listOffset = rom.pointer(o + 1)
    if (listOffset === null || listOffset >= rom.length) continue
    const items = readItemList(rom, listOffset, maxItemId)
    if (!items || items.length < 1) continue
    if (seenLists.has(listOffset)) continue
    seenLists.add(listOffset)
    shops.push({ cmdOffset: o, listOffset, items })
  }
  return shops.sort((a, b) => a.cmdOffset - b.cmdOffset)
}

/** A short human label for a shop, derived from what it sells. */
export function describeShop(shop: Shop, itemNames: string[]): string {
  const names = shop.items.map((id) => itemNames[id] ?? `#${id}`)
  const count = (re: RegExp) => names.filter((n) => re.test(n)).length
  // Pick the most distinctive category by which item class dominates the list.
  let tag = ''
  if (count(/STONE/) >= 2) tag = 'Evolution stones — '
  else if (count(/^TM\d/) >= 2) tag = 'TMs — '
  else if (count(/^X /) >= 2) tag = 'Battle X-items — '
  else if (count(/HP UP|PROTEIN|IRON|CALCIUM|ZINC|CARBOS/) >= 2) tag = 'Vitamins — '
  else if (count(/BALL/) >= 2) tag = 'Poké Balls & goods — '
  else if (count(/POTION|HEAL|ANTIDOTE|REVIVE|RESTORE/) >= 2) tag = 'Medicine — '
  const preview = names.slice(0, 4).join(', ')
  return `${tag}${preview}${names.length > 4 ? `, +${names.length - 4}` : ''}`
}

export function shopsEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

// ── Serialization ─────────────────────────────────────────────────────────

export interface ShopEdit {
  /** Where to write the new 0-terminated u16 list (allocated in free space). */
  listBytes: Uint8Array
  listOffset: number
  /** The pokemart pointer operand to repoint at listOffset. */
  ptrAt: number
}

/** Serialize a new item list to a 0-terminated u16 array. */
export function serializeShopList(items: number[]): Uint8Array {
  const bytes = new Uint8Array((items.length + 1) * 2)
  const view = new DataView(bytes.buffer)
  items.forEach((id, i) => view.setUint16(i * 2, id, true))
  view.setUint16(items.length * 2, 0, true)
  return bytes
}

/** Build the write-plan for one edited shop: new list in free space + repoint. */
export function buildShopEdit(
  shop: Shop,
  newItems: number[],
  allocate: (size: number) => number,
): { blob: { offset: number; bytes: Uint8Array }; pointer: { at: number; target: number } } {
  const listBytes = serializeShopList(newItems)
  const offset = allocate(listBytes.length)
  return {
    blob: { offset, bytes: listBytes },
    pointer: { at: shop.cmdOffset + 1, target: offset },
  }
}

export { toPtr as shopToPtr }
