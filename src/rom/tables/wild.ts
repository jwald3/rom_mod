import type { RomBuffer } from '../buffer'
import type { AnchorMap } from '../anchors'

/**
 * Wild encounter data. Header table: 20-byte records
 *   [bank u8, map u8, pad u16, grass ptr, surf ptr, tree ptr, fish ptr]
 * terminated when the first u16 reads 0xFFFF. Each group pointer leads to
 *   [rate u32, ptr → slots]
 * with a fixed slot count per kind; each slot is [low u8, high u8, species u16].
 * Everything is fixed-size, so edits are always written in place.
 */

export type WildKind = 'grass' | 'surf' | 'tree' | 'fish'

export const WILD_KINDS: WildKind[] = ['grass', 'surf', 'tree', 'fish']

export const WILD_SLOT_COUNTS: Record<WildKind, number> = {
  grass: 12,
  surf: 5,
  tree: 5,
  fish: 10,
}

export const WILD_KIND_LABELS: Record<WildKind, string> = {
  grass: 'Grass',
  surf: 'Surfing',
  tree: 'Rock Smash',
  fish: 'Fishing',
}

/** Encounter odds per slot index (vanilla engine behaviour). */
export const WILD_SLOT_PERCENTS: Record<WildKind, number[]> = {
  grass: [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1],
  surf: [60, 30, 5, 4, 1],
  tree: [60, 30, 5, 4, 1],
  fish: [70, 30, 60, 20, 20, 40, 40, 15, 4, 1],
}

/** Rod grouping for the 10 fishing slots (indices are contiguous). */
export const FISH_ROD_FOR_SLOT = (i: number): string =>
  i < 2 ? 'Old Rod' : i < 5 ? 'Good Rod' : 'Super Rod'

export interface WildSlot {
  low: number
  high: number
  species: number
}

export interface WildGroup {
  rate: number
  slots: WildSlot[]
  /** ROM offset of [rate u32, listPtr] — rate is written here. */
  infoOffset: number
  /** ROM offset of the slot array. */
  listOffset: number
}

export interface WildArea {
  index: number
  bank: number
  map: number
  name: string
  groups: Partial<Record<WildKind, WildGroup>>
}

/** The value half of a wild edit (offsets are re-resolved at write time). */
export interface WildGroupEdit {
  rate: number
  slots: WildSlot[]
}

const HEADER_LEN = 20
const MAX_AREAS = 1024
const MAPSEC_OFFSET_IN_HEADER = 0x14 // regionMapSectionId — same offset in FireRed and Emerald

export function wildAreaCount(rom: RomBuffer, a: AnchorMap): number {
  let n = 0
  while (n < MAX_AREAS && rom.u16(a.wild + n * HEADER_LEN) !== 0xffff) n++
  return n
}

function readGroup(rom: RomBuffer, headerOffset: number, slotCount: number): WildGroup | undefined {
  const infoOffset = rom.pointer(headerOffset)
  if (infoOffset === null) return undefined
  const listOffset = rom.pointer(infoOffset + 4)
  if (listOffset === null) return undefined
  const slots: WildSlot[] = []
  for (let i = 0; i < slotCount; i++) {
    const o = listOffset + i * 4
    slots.push({ low: rom.u8(o), high: rom.u8(o + 1), species: rom.u16(o + 2) })
  }
  return { rate: rom.u32(infoOffset), slots, infoOffset, listOffset }
}

/** Resolve a display name for bank/map via the map header's mapsec byte. */
export function resolveMapName(rom: RomBuffer, a: AnchorMap, bank: number, map: number): string {
  const fallback = `Map ${bank}.${map}`
  // Profiles without a resolved region-map table (e.g. Heart & Soul) label
  // wild areas by bank.map rather than name.
  if (a.mapNameCount <= 0 || a.mapBanks <= 0) return fallback
  const bankPtr = rom.pointer(a.mapBanks + bank * 4)
  if (bankPtr === null) return fallback
  const headerPtr = rom.pointer(bankPtr + map * 4)
  if (headerPtr === null) return fallback
  const nameIndex = rom.u8(headerPtr + MAPSEC_OFFSET_IN_HEADER) - a.mapsecBase
  if (nameIndex < 0 || nameIndex >= a.mapNameCount) return fallback
  const namePtr = rom.pointer(a.mapNames + nameIndex * a.mapNameStride + a.mapNamePtrOffset)
  if (namePtr === null) return fallback
  const name = rom.text(namePtr, 32)
  return name.length > 0 ? name : fallback
}

export function readWildArea(rom: RomBuffer, a: AnchorMap, index: number): WildArea {
  const h = a.wild + index * HEADER_LEN
  const bank = rom.u8(h)
  const map = rom.u8(h + 1)
  const groups: WildArea['groups'] = {}
  WILD_KINDS.forEach((kind, i) => {
    const group = readGroup(rom, h + 4 + i * 4, WILD_SLOT_COUNTS[kind])
    if (group) groups[kind] = group
  })
  return { index, bank, map, name: resolveMapName(rom, a, bank, map), groups }
}

export function readAllWildAreas(rom: RomBuffer, a: AnchorMap): WildArea[] {
  const count = wildAreaCount(rom, a)
  const out: WildArea[] = []
  for (let i = 0; i < count; i++) out.push(readWildArea(rom, a, i))
  return out
}

export function wildKey(areaIndex: number, kind: WildKind): string {
  return `${areaIndex}:${kind}`
}

export function parseWildKey(key: string): { areaIndex: number; kind: WildKind } {
  const [areaIndex, kind] = key.split(':')
  return { areaIndex: Number(areaIndex), kind: kind as WildKind }
}

export function wildGroupsEqual(a: WildGroupEdit, b: WildGroupEdit): boolean {
  return (
    a.rate === b.rate &&
    a.slots.length === b.slots.length &&
    a.slots.every(
      (s, i) => s.low === b.slots[i].low && s.high === b.slots[i].high && s.species === b.slots[i].species,
    )
  )
}
