import type { RomBuffer } from '../buffer'
import {
  type AnchorMap,
  SPECIES_NAME_LEN,
  TYPE_NAME_LEN,
  ABILITY_NAME_LEN,
  BASE_STATS_LEN,
} from '../anchors'

export interface SpeciesStats {
  hp: number
  atk: number
  def: number
  spa: number
  spd: number
  spe: number
}

export interface SpeciesInfo {
  id: number
  name: string
  type1: number
  type2: number
  stats: SpeciesStats
  ability1: number
  ability2: number
  /** Wild held items: item1 = 50% slot, item2 = 5% slot (0 = none). */
  heldItem1: number
  heldItem2: number
}

// Base stats struct: hp, atk, def, speed, spatk, spdef, type1, type2, …,
// held items at 12–15, abilities at 22–23.
const TYPE1_OFFSET = 6
const TYPE2_OFFSET = 7
const ITEM1_OFFSET = 12
const ITEM2_OFFSET = 14
const ABILITY1_OFFSET = 22
const ABILITY2_OFFSET = 23

export function readSpecies(rom: RomBuffer, a: AnchorMap): SpeciesInfo[] {
  const out: SpeciesInfo[] = []
  for (let i = 0; i < a.speciesCount; i++) {
    const s = a.baseStats + i * BASE_STATS_LEN
    out.push({
      id: i,
      name: rom.text(a.speciesNames + i * SPECIES_NAME_LEN, SPECIES_NAME_LEN),
      type1: rom.u8(s + TYPE1_OFFSET),
      type2: rom.u8(s + TYPE2_OFFSET),
      stats: {
        hp: rom.u8(s),
        atk: rom.u8(s + 1),
        def: rom.u8(s + 2),
        spe: rom.u8(s + 3), // yes, speed comes before the special stats in ROM
        spa: rom.u8(s + 4),
        spd: rom.u8(s + 5),
      },
      ability1: rom.u8(s + ABILITY1_OFFSET),
      ability2: rom.u8(s + ABILITY2_OFFSET),
      heldItem1: rom.u16(s + ITEM1_OFFSET),
      heldItem2: rom.u16(s + ITEM2_OFFSET),
    })
  }
  return out
}

/**
 * Placeholder species: #0 and the unused gap between Celebi (251) and
 * Treecko (277), whose names are all question marks.
 */
export function isGapSpecies(s: SpeciesInfo): boolean {
  return s.name.length > 0 && /^\?+$/.test(s.name)
}

export function readTypeNames(rom: RomBuffer, a: AnchorMap): string[] {
  const out: string[] = []
  for (let i = 0; i < a.typeCount; i++) {
    out.push(rom.text(a.typeNames + i * TYPE_NAME_LEN, TYPE_NAME_LEN))
  }
  return out
}

export function readAbilityNames(rom: RomBuffer, a: AnchorMap): string[] {
  const out: string[] = []
  for (let i = 0; i < a.abilityCount; i++) {
    out.push(rom.text(a.abilityNames + i * ABILITY_NAME_LEN, ABILITY_NAME_LEN))
  }
  return out
}
