import { norm } from './names'

/**
 * Post-Gen-4 species removed from this build. Their slots still exist in the
 * ROM's tables, but nothing wild / trainer / evolution reaches them any more —
 * see `apply-remove-postgen4-species.mts`. Anything that presents the game's
 * obtainable roster (the guide's Pokédex and item pages, the balance harness's
 * cohorts) filters them out.
 */
export const EXCLUDED_SPECIES: ReadonlySet<string> = new Set([
  'REGIDRAGO',
  'REGIELEKI',
  'SYLVEON',
  'ANNIHILAPE',
  'FARIGIRAF',
  'DUDUNSPARC',
  'WYRDEER',
  'URSALUNA',
  'KLEAVOR',
])

const EXCLUDED_KEYS = new Set([...EXCLUDED_SPECIES].map(norm))

/** True when a ROM species name is one of the purged post-Gen-4 entries. */
export const isExcludedSpecies = (name: string): boolean => EXCLUDED_KEYS.has(norm(name))
