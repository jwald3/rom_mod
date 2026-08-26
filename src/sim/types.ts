import type { MoveInfo } from '../rom/tables/moves'
import type { SpeciesStats } from '../rom/tables/species'
import type { TypeChart } from '../rom/tables/typeChart'

/**
 * The simulator's own view of the world. Nothing in `src/sim` touches the ROM,
 * the filesystem or argv — callers read the ROM, build a SimContext and hand it
 * plain objects, so the same engine drives the CLI, the tests, and (later) the
 * React editor.
 */

export type MoveCategory = 'physical' | 'special' | 'status'

/** The five stats a battle can move around, plus hp. */
export interface Stats {
  hp: number
  atk: number
  def: number
  spa: number
  spd: number
  spe: number
}

export type StatKey = keyof Stats
/** Stats that take stage boosts. (hp doesn't; accuracy/evasion are separate.) */
export type BoostableStat = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'acc' | 'eva'

export type Status = 'none' | 'slp' | 'psn' | 'tox' | 'brn' | 'par' | 'frz'

/**
 * What a move does, normalized away from the ROM's `EFFECT_*` id. Everything
 * the battle loop understands is expressed here; effects it doesn't model are
 * flagged `modeled: false` and degrade to a plain hit.
 */
export interface SimEffect {
  kind:
    | 'hit'
    | 'status' // pure status move (no damage)
    | 'status-hit' // damage + chance of status
    | 'boost' // change the user's or target's stat stages
    | 'boost-hit' // damage + chance of a stat change
    | 'flinch-hit'
    | 'multi-hit'
    | 'double-hit'
    | 'drain'
    | 'recoil'
    | 'fixed-damage'
    | 'level-damage'
    | 'psywave'
    | 'super-fang'
    | 'ohko'
    | 'charge' // two-turn move; turn one does nothing
    | 'heal'
    | 'rest'
    | 'explosion'
    | 'high-crit'
    | 'always-hit'
    | 'unmodeled'
  /** Status inflicted (for 'status' / 'status-hit'). */
  status?: Status
  /** Chance % the secondary fires. 0/undefined = always (pure status moves). */
  chance?: number
  /** Stat stage changes; positive targets the user, negative targets the foe. */
  boosts?: { stat: BoostableStat; stages: number }[]
  /** Whether `boosts` applies to the user or the target. */
  boostTarget?: 'self' | 'foe'
  /** 'drain'/'recoil': fraction of damage dealt/taken, as a numerator over 100. */
  fraction?: number
  /** 'fixed-damage': flat hp removed. */
  amount?: number
  /** 'heal': fraction of max hp restored, as a percentage. */
  healPercent?: number
  /** Confusion, on top of whatever else the move does. */
  confuses?: boolean
  /** False when the engine had no handler for the ROM's effect id. */
  modeled: boolean
  /** Human-readable label for reports ("30% burn", "lowers Speed"). */
  label: string
}

/** A move resolved for battle use: ROM stats plus its normalized effect. */
export interface SimMove {
  id: number
  name: string
  type: number
  power: number
  /** 0 means "never misses" in the ROM's encoding. */
  accuracy: number
  pp: number
  priority: number
  category: MoveCategory
  effectId: number
  effect: SimEffect
}

/** Where a combatant's numbers came from, for report footnotes. */
export interface CombatantSource {
  kind: 'tested' | 'trainer' | 'peer'
  /** Trainer name, cohort label, etc. */
  owner?: string
}

/** One side of a matchup: a fully resolved Pokémon at a level. */
export interface Combatant {
  speciesId: number
  species: string
  /** Display label, e.g. "Falkner's NOCTOWL L11". */
  label: string
  level: number
  types: [number, number]
  base: SpeciesStats
  stats: Stats
  ability: number
  abilityName: string
  item: number
  itemName: string
  moves: SimMove[]
  ivs: number
  evs: number
  source: CombatantSource
}

/** Read-only ROM data the engine needs, plus a place to collect caveats. */
export interface SimContext {
  moves: MoveInfo[]
  typeChart: TypeChart
  typeNames: string[]
  abilityNames: string[]
  itemNames: string[]
  speciesNames: string[]
}
