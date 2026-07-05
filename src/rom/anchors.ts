/** Resolved table locations for one ROM. */
export interface AnchorMap {
  speciesNames: number
  speciesCount: number
  moveNames: number
  moveCount: number
  moveStats: number
  learnsets: number
  baseStats: number
  typeNames: number
  typeCount: number
  abilityNames: number
  abilityCount: number
  /** TM01–50 + HM01–08 move-id table (58 u16 entries). */
  tms: number
  tmCount: number
  tutors: number
  tutorCount: number
  /** Bitfield rows, one per species: bit i = compatible with tms[i] / tutors[i]. */
  tmCompat: number
  tutorCompat: number
  /** Evolution table: 5 entries × 8 bytes per species. */
  evolutions: number
  /** Item stats table (44-byte structs, name first) — used for stone/held-item names. */
  items: number
  itemCount: number
  /** Wild encounter headers (20 bytes each, 0xFFFF-terminated). */
  wild: number
  /** Map bank pointer table (bank → map header pointers). */
  mapBanks: number
  /** Region-map section name pointers; map header mapsec − 0x58 indexes this. */
  mapNames: number
  mapNameCount: number
}

export const SPECIES_NAME_LEN = 11
export const MOVE_NAME_LEN = 13
export const TYPE_NAME_LEN = 7
export const ABILITY_NAME_LEN = 13
export const BASE_STATS_LEN = 28
export const MOVE_STATS_LEN = 12

/**
 * Vanilla FireRed 1.0 (BPRE) offsets — fallback when no HMA .toml sidecar is
 * available. A modded ROM may have repointed any of these; loadRom runs a
 * sanity check (species #1 must decode to BULBASAUR) and warns if it fails.
 */
export const VANILLA_BPRE: AnchorMap = {
  speciesNames: 0x245ee0,
  speciesCount: 412,
  moveNames: 0x247094,
  moveCount: 355,
  moveStats: 0x250c04,
  learnsets: 0x25d7b4,
  baseStats: 0x254784,
  typeNames: 0x24f1a0,
  typeCount: 18,
  abilityNames: 0x24fc40,
  abilityCount: 78,
  tms: 0x45a80c,
  tmCount: 58,
  tutors: 0x459b60,
  tutorCount: 15,
  tmCompat: 0x252bc8,
  tutorCompat: 0x459b7e,
  evolutions: 0x259754,
  items: 0x3db028,
  itemCount: 375,
  wild: 0x3c9cb8,
  mapBanks: 0x3526a8,
  mapNames: 0x3f1cac,
  mapNameCount: 109,
}
