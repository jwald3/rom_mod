import type { RomBuffer } from '../buffer'
import type { AnchorMap } from '../anchors'

/**
 * Evolution table: per species, 5 entries of
 *   [method u16, param u16, targetSpecies u16, unused u16]
 * Method 0 = empty slot. Params: level for level methods, item id for
 * stone/held-item methods, beauty threshold for method 15.
 */

export interface Evolution {
  method: number
  param: number
  target: number
}

export const EVOS_PER_SPECIES = 5
const ENTRY_LEN = 8
const ITEM_STRUCT_LEN = 44
const ITEM_NAME_LEN = 14

export function readEvolutionsFor(rom: RomBuffer, a: AnchorMap, species: number): Evolution[] {
  const list: Evolution[] = []
  const base = a.evolutions + species * EVOS_PER_SPECIES * ENTRY_LEN
  for (let i = 0; i < EVOS_PER_SPECIES; i++) {
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

/** Serialize a species' evolution list to its fixed 40-byte block (zero-padded). */
export function serializeEvolutions(evos: Evolution[]): Uint8Array {
  const out = new Uint8Array(EVOS_PER_SPECIES * ENTRY_LEN)
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
}

/** What the param field means for a given method — drives the edit control. */
export function evoParamKind(method: number): 'level' | 'item' | 'beauty' | 'none' {
  switch (method) {
    case 4:
    case 8:
    case 9:
    case 10:
    case 11:
    case 12:
    case 13:
    case 14:
      return 'level'
    case 6:
    case 7:
      return 'item'
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
    default:
      return `method ${evo.method} (${evo.param})`
  }
}
