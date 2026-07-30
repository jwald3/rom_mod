import type { RomBuffer } from '../buffer'
import type { AnchorMap } from '../anchors'

/**
 * Evolution table: per species, `evosPerSpecies` entries of
 *   [method u16, param u16, targetSpecies u16, unused u16]
 * Method 0 = empty slot. Params: level for level methods, item id for
 * stone/held-item methods, move id for method 22, beauty threshold for 15.
 * Vanilla FireRed/Emerald store 5 entries (40-byte blocks); pokeemerald-
 * expansion (Heart & Soul) stores 8 (64-byte blocks).
 */

export interface Evolution {
  method: number
  param: number
  target: number
}

/** Default evolution slots per species (vanilla FireRed/Emerald). Profiles
 *  override via AnchorMap.evosPerSpecies (Heart & Soul = 8). */
export const EVOS_PER_SPECIES = 5
const ENTRY_LEN = 8
const ITEM_STRUCT_LEN = 44
const ITEM_NAME_LEN = 14

export function readEvolutionsFor(rom: RomBuffer, a: AnchorMap, species: number): Evolution[] {
  const list: Evolution[] = []
  const slots = a.evosPerSpecies
  const base = a.evolutions + species * slots * ENTRY_LEN
  for (let i = 0; i < slots; i++) {
    const o = base + i * ENTRY_LEN
    const method = rom.u16(o)
    if (method === 0) continue
    list.push({ method, param: rom.u16(o + 2), target: rom.u16(o + 4) })
  }
  return list
}

export function readAllEvolutions(rom: RomBuffer, a: AnchorMap): Evolution[][] {
  const out: Evolution[][] = []
  for (let s = 0; s < a.speciesCount; s++) out.push(readEvolutionsFor(rom, a, s))
  return out
}

/** Serialize a species' evolution list to its fixed block (zero-padded).
 *  `slots` = the profile's evosPerSpecies (5 vanilla, 8 expansion). */
export function serializeEvolutions(evos: Evolution[], slots: number = EVOS_PER_SPECIES): Uint8Array {
  const out = new Uint8Array(slots * ENTRY_LEN)
  const view = new DataView(out.buffer)
  evos.forEach((e, i) => {
    view.setUint16(i * ENTRY_LEN, e.method, true)
    view.setUint16(i * ENTRY_LEN + 2, e.param, true)
    view.setUint16(i * ENTRY_LEN + 4, e.target, true)
  })
  return out
}

export function evosEqual(a: Evolution[], b: Evolution[]): boolean {
  return (
    a.length === b.length &&
    a.every((e, i) => e.method === b[i].method && e.param === b[i].param && e.target === b[i].target)
  )
}

export function readItemNames(rom: RomBuffer, a: AnchorMap): string[] {
  const out: string[] = []
  for (let i = 0; i < a.itemCount; i++) {
    out.push(rom.text(a.items + i * ITEM_STRUCT_LEN, ITEM_NAME_LEN))
  }
  return out
}

export const EVO_METHOD_LABELS: Record<number, string> = {
  1: 'Friendship',
  2: 'Friendship (day)',
  3: 'Friendship (night)',
  4: 'Level',
  5: 'Trade',
  6: 'Trade holding item',
  7: 'Use item (stone)',
  8: 'Level, Atk > Def',
  9: 'Level, Atk = Def',
  10: 'Level, Atk < Def',
  11: 'Level (Silcoon half)',
  12: 'Level (Cascoon half)',
  13: 'Level (Ninjask)',
  14: 'Level (Shedinja slot)',
  15: 'Beauty',
  // pokeemerald-expansion methods used by Heart & Soul (param kind noted).
  18: 'Level (special)',
  20: 'Use item (method 20)',
  21: 'Use item (method 21)',
  22: 'Knows move',
  24: 'Use item (method 24)',
  25: 'Use item (method 25)',
  26: 'Trade / held item',
  27: 'Use item (method 27)',
}

/** Human label for a method, falling back for anything not in the table. */
export function evoMethodLabel(method: number): string {
  return EVO_METHOD_LABELS[method] ?? `Method ${method}`
}

/** What the param field means for a given method — drives the edit control. */
export function evoParamKind(method: number): 'level' | 'item' | 'beauty' | 'move' | 'none' {
  switch (method) {
    case 4:
    case 8:
    case 9:
    case 10:
    case 11:
    case 12:
    case 13:
    case 14:
    case 18:
      return 'level'
    case 6:
    case 7:
    case 20:
    case 21:
    case 24:
    case 25:
    case 26:
    case 27:
      return 'item'
    case 22:
      return 'move'
    case 15:
      return 'beauty'
    default:
      return 'none'
  }
}

export type EvoCategory = 'level' | 'stone' | 'trade' | 'friendship' | 'special'

export const EVO_CATEGORIES: EvoCategory[] = ['level', 'stone', 'friendship', 'trade', 'special']

export function evoCategory(method: number): EvoCategory {
  switch (method) {
    case 1:
    case 2:
    case 3:
      return 'friendship'
    case 4:
      return 'level'
    case 5:
    case 6:
      return 'trade'
    case 7:
      return 'stone'
    default:
      return 'special' // Tyrogue splits, Wurmple splits, Ninjask/Shedinja, beauty
  }
}

export function describeEvolution(evo: Evolution, itemNames: string[]): string {
  const item = () => itemNames[evo.param] ?? `item #${evo.param}`
  switch (evo.method) {
    case 1:
      return 'Friendship'
    case 2:
      return 'Friendship, day'
    case 3:
      return 'Friendship, night'
    case 4:
      return `Lv ${evo.param}`
    case 5:
      return 'Trade'
    case 6:
      return `Trade holding ${item()}`
    case 7:
      return item()
    case 8:
      return `Lv ${evo.param}, Atk > Def`
    case 9:
      return `Lv ${evo.param}, Atk = Def`
    case 10:
      return `Lv ${evo.param}, Atk < Def`
    case 11:
      return `Lv ${evo.param}, Silcoon half`
    case 12:
      return `Lv ${evo.param}, Cascoon half`
    case 13:
      return `Lv ${evo.param}, Ninjask`
    case 14:
      return `Lv ${evo.param}, empty slot (Shedinja)`
    case 15:
      return `Beauty ≥ ${evo.param}`
    case 18:
      return `Lv ${evo.param}`
    case 20:
    case 21:
    case 24:
    case 25:
    case 27:
      return item()
    case 26:
      return `Trade / ${item()}`
    case 22:
      return `Knows move #${evo.param}`
    default:
      return `method ${evo.method} (${evo.param})`
  }
}
