import type { LoadedRom } from '../rom/loadRom'
import type { SpeciesInfo } from '../rom/tables/species'
import type { BaseStatsEdit } from '../rom/writer'
import { makeContext } from './build'
import { buildCombatant } from './build'
import { benchmarkCohort, type CohortMember } from './cohorts'
import { evaluateCohort, viabilityScore } from './matchup'
import { levelUpPool, machinePool, pickBestMoves } from './movesets'
import { pickBestMovesBySim } from './pickMoves'
import { simulateMany } from './battle'
import type { Combatant, SimContext } from './types'

/**
 * A lightweight, browser-side version of the balance harness for the editor's
 * live win-rate readout. Given the loaded ROM, a species, and an optional draft
 * (edited stats/types/abilities), it builds the subject from those draft values
 * and runs it against the benchmark bosses at level parity — the same honest
 * model the guide's tier list uses. Pure and synchronous; call it off a debounce.
 */

export interface QuickRateResult {
  /** Mean win rate across the cohort, 0–100. */
  winRate: number
  /** −1…+1 viability score from the matchup calculator. */
  viability: number
  /** The moveset used, by name (auto-picked unless overridden). */
  moves: string[]
  /** The move ids used, so the editor can show which slots are set. */
  moveIds: number[]
  /** How many benchmark opponents were faced. */
  opponents: number
}

/** The cohort is fixed per ROM; cache it so keystroke re-rates don't rebuild it. */
const cohortCache = new WeakMap<LoadedRom, { ctx: SimContext; members: CohortMember[] }>()

function cohortFor(rom: LoadedRom): { ctx: SimContext; members: CohortMember[] } {
  const hit = cohortCache.get(rom)
  if (hit) return hit
  const ctx = makeContext(rom)
  const members = benchmarkCohort(ctx, rom, {}).members
  const built = { ctx, members }
  cohortCache.set(rom, built)
  return built
}

/**
 * Rate a species against the benchmark cohort. `draft` overrides the species'
 * stats/types/abilities (for the live what-if); omit it to rate the ROM as-is.
 * `sims` trades accuracy for speed — 60 is smooth for typing, higher is steadier.
 */
export function quickRate(
  rom: LoadedRom,
  species: SpeciesInfo,
  draft?: BaseStatsEdit,
  opts: { sims?: number; seed?: number; moveOverride?: readonly number[]; optimize?: boolean } = {},
): QuickRateResult | null {
  if (rom.typeChart.offset < 0) return null // no type chart → meaningless
  const { ctx, members } = cohortFor(rom)
  if (members.length === 0) return null
  const foes = members.map((m) => m.combatant)
  const sims = opts.sims ?? 60
  const seed = opts.seed ?? 1

  const statsOverride = draft?.stats
  const typesOverride: [number, number] | undefined = draft
    ? [draft.type1, draft.type2]
    : undefined
  const abilityOverride = draft?.ability1

  // Endgame level: pick the moveset once at the top boss level (its settled
  // pool), then rebuild per-boss at parity so only stats scale — matching the
  // tier list, and cheap enough for a live readout.
  const foeLevels = foes.map((c) => Math.max(5, c.level))
  const hiLevel = Math.max(...foeLevels)

  const buildAt = (level: number, moves: number[]): Combatant =>
    buildCombatant(ctx, species, {
      level,
      moves,
      statsOverride,
      typesOverride,
      abilityOverride,
      source: { kind: 'tested' },
    })

  // A forced moveset (from the editor) wins; otherwise auto-pick. The default
  // pick is the fast greedy one (instant, for live typing); `optimize` runs the
  // slower simulate-every-candidate search that finds materially better sets.
  const forced = opts.moveOverride?.filter((id) => id > 0) ?? []
  let moveIds: number[]
  if (forced.length > 0) {
    moveIds = [...forced]
  } else {
    const pool = [
      ...levelUpPool(rom.learnsets[species.id], hiLevel),
      ...machinePool(rom.tmCompat[species.id], rom.tmMoves),
      ...machinePool(rom.tutorCompat[species.id], rom.tutorMoves),
    ]
    if (opts.optimize) {
      moveIds = pickBestMovesBySim(ctx, species, pool, foes, hiLevel, foeLevels)
    } else {
      const bare = buildAt(hiLevel, [])
      moveIds = pickBestMoves(ctx, bare, pool, foes, {}).map((m) => m.id)
    }
  }

  const atLevel = new Map<number, Combatant>()
  const subjectAt = (level: number): Combatant => {
    let c = atLevel.get(level)
    if (!c) {
      c = buildAt(level, moveIds)
      atLevel.set(level, c)
    }
    return c
  }

  const matchups = foes.map((foe, i) => evaluateCohort(ctx, subjectAt(foeLevels[i]), [foe])[0])
  let winSum = 0
  foes.forEach((foe, i) => {
    winSum += simulateMany(ctx, subjectAt(foeLevels[i]), foe, sims, seed + i * 1013).winRate
  })

  const used = subjectAt(hiLevel).moves
  return {
    winRate: Math.round(winSum / foes.length),
    viability: Number(viabilityScore(matchups).toFixed(2)),
    moves: used.map((m) => m.name),
    moveIds: used.map((m) => m.id),
    opponents: foes.length,
  }
}
