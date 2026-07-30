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
  /** Region-map section name table; (map header mapsec − mapsecBase) indexes it. */
  mapNames: number
  mapNameCount: number
  /** Bytes per mapNames entry: 4 (FireRed: bare name pointer) or 8 (Emerald: x/y/w/h then pointer). */
  mapNameStride: number
  /** Byte offset of the name pointer within a mapNames entry (0 FireRed, 4 Emerald). */
  mapNamePtrOffset: number
  /** Value subtracted from a map header's mapsec byte to index mapNames (0x58 FireRed, 0 Emerald). */
  mapsecBase: number
  /** Trainer table: 40-byte records, each pointing at a party block. */
  trainers: number
  trainerCount: number
  /** Trainer class names (13-byte text entries). */
  trainerClasses: number
  trainerClassCount: number
  /**
   * Byte stride of one base-stats record. 28 for vanilla FireRed/Emerald;
   * pokeemerald-expansion ROMs (e.g. Heart & Soul) append fields → 40. The
   * field offsets the reader uses (types 6/7, held items 12/14, abilities
   * 22/23) are identical across both, so only the stride changes.
   */
  baseStatsLen: number
  /**
   * Evolution slots per species. Vanilla FireRed/Emerald store 5 (40-byte
   * blocks); pokeemerald-expansion widens this — Heart & Soul uses 8 (64-byte
   * blocks), which is why Eevee can hold all eight of its evolutions.
   */
  evosPerSpecies: number
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
  trainers: 0x23eac8,
  trainerCount: 743,
  trainerClasses: 0x23e558,
  trainerClassCount: 107,
  baseStatsLen: 28,
  evosPerSpecies: 5,
  mapNameStride: 4,
  mapNamePtrOffset: 0,
  mapsecBase: 0x58,
}

/**
 * Pokémon Heart & Soul (BPEE / pokeemerald-expansion) — a 32 MB Emerald hack
 * whose data tables were repointed into expanded ROM space. Every address here
 * was reverse-engineered from the ROM and verified against known data
 * (Bulbasaur base stats/evolution, the vanilla TM list, etc.); see
 * scripts/hs-locate.mjs. Struct layouts match vanilla except base stats, which
 * expansion widens to 40 bytes (baseStatsLen).
 *
 * Maps aren't resolved (mapNameCount = 0 → wild areas show "Map bank.map"):
 * Emerald's region-map name table uses a different struct and H&S repointed the
 * map-bank table out of reach, so labels fall back gracefully. Everything else
 * (movesets, TMs/tutors, evolutions, wild slots, trainer teams) is fully
 * editable.
 */
export const HS_BPEE: AnchorMap = {
  speciesNames: 0x744798,
  speciesCount: 462,
  moveNames: 0x745b74,
  moveCount: 368,
  moveStats: 0x937998,
  learnsets: 0x94e0d8,
  baseStats: 0x93bd40,
  typeNames: 0x6e152c,
  typeCount: 19, // adds FAIRY at 18; index 9 is the vanilla ??? slot
  abilityNames: 0x6e1e90,
  abilityCount: 82,
  tms: 0x91b450,
  tmCount: 58,
  tutors: 0x91a098,
  tutorCount: 30, // Emerald has 30 tutors (FireRed 15) → 4-byte compat rows
  tmCompat: 0x93a010,
  tutorCompat: 0x9667ac,
  evolutions: 0x946620, // 8 slots × 8 bytes = 64-byte blocks per species (expansion)
  items: 0x8fe910,
  itemCount: 626,
  wild: 0xd3bd90,
  mapBanks: 0xf39750, // 32 banks of map-header pointer arrays
  mapNames: 0x96db40, // Emerald region-map entries: NEW BARK TOWN … TRAINER HILL (Johto+Kanto)
  mapNameCount: 213,
  trainers: 0x73c0c0,
  trainerCount: 864,
  trainerClasses: 0x73bcf1, // 75 named classes (0 COOLTRAINER … 74 PSYCHIC), then the trainer table
  trainerClassCount: 75,
  baseStatsLen: 40,
  evosPerSpecies: 8,
  mapNameStride: 8, // Emerald: {u8 x,y,w,h; const u8* name}
  mapNamePtrOffset: 4,
  mapsecBase: 0, // Emerald mapsec ids index the table directly
}
