import type { RomBuffer } from '../buffer'
import type { AnchorMap } from '../anchors'

/**
 * Egg-move table (`gEggMoves`) support.
 *
 * One flat u16 array: a species marker (`species + 20000`) followed by that
 * species' egg-move ids, repeated. There's no count field — the array simply
 * runs until a word that is neither a valid marker nor a valid move id, so we
 * stop on the first entry that fails validation.
 *
 * Heart & Soul keeps the vanilla shape at 0x749188: 166 species, 991 moves.
 */

/** `EGG_MOVES_SPECIES_OFFSET` — added to a species id to mark a new block. */
const SPECIES_MARKER = 20000

export type EggMoveTable = Map<number, number[]>

/**
 * Read every species' egg moves, keyed by species id. Returns an empty map when
 * the profile has no anchor for the table.
 */
export function readEggMoves(rom: RomBuffer, a: AnchorMap): EggMoveTable {
  const out: EggMoveTable = new Map()
  if (!a.eggMoves) return out
  const maxMarker = SPECIES_MARKER + a.speciesCount
  let p = a.eggMoves
  let lastSpecies = -1
  while (p + 2 <= rom.length) {
    const marker = rom.u16(p)
    if (marker < SPECIES_MARKER || marker >= maxMarker) break
    const species = marker - SPECIES_MARKER
    // Markers ascend; anything else means we've run off the end of the table.
    if (species <= lastSpecies) break
    lastSpecies = species
    p += 2
    const moves: number[] = []
    while (p + 2 <= rom.length) {
      const move = rom.u16(p)
      if (move === 0 || move >= SPECIES_MARKER || move >= a.moveCount) break
      moves.push(move)
      p += 2
    }
    if (moves.length === 0) break // a marker with no moves isn't real table data
    out.set(species, moves)
  }
  return out
}
