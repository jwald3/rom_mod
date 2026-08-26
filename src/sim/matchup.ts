import { accuracyOf, damageRange, expectedDamage, typeEffectiveness } from './damage'
import type { Combatant, SimContext, SimMove } from './types'

/**
 * Layer 1: the deterministic matchup calculator. No RNG, no turn loop — just
 * "how hard does each side hit, and who gets there first". It's fast enough to
 * run over a whole cohort and it's the thing you can check by hand, so the
 * Monte Carlo layer's numbers have something to be sanity-checked against.
 */

export interface MoveAssessment {
  move: SimMove
  /** Average damage per *use*, before accuracy. */
  damage: number
  /** Accuracy- and crit-weighted damage per turn. */
  expected: number
  /** Fraction of the defender's max HP one use takes off, 0–1. */
  fraction: number
  effectiveness: number
  accuracy: number
  immune: boolean
}

export interface SideAssessment {
  attacker: Combatant
  defender: Combatant
  /** Every move, best first. */
  moves: MoveAssessment[]
  best: MoveAssessment | null
  /** Turns to KO with the best move (Infinity when it can't). */
  turnsToKo: number
  /** Best move's damage as a percentage of the defender's HP. */
  percentPerTurn: number
}

export interface Matchup {
  self: Combatant
  foe: Combatant
  selfSide: SideAssessment
  foeSide: SideAssessment
  /** True when `self` moves first at equal priority. */
  outspeeds: boolean
  speedTie: boolean
  /**
   * −1 (hopeless) … +1 (dominant). Built from the turns-to-KO gap, nudged by
   * who moves first — the tiebreak that decides an even race.
   */
  score: number
}

function assessMove(
  ctx: SimContext,
  attacker: Combatant,
  defender: Combatant,
  move: SimMove,
): MoveAssessment {
  const range = damageRange(ctx, attacker, defender, move)
  const expected = expectedDamage(ctx, attacker, defender, move)
  const { immune, multiplier } = typeEffectiveness(ctx, move, defender)
  return {
    move,
    damage: range.avg,
    expected,
    fraction: expected / defender.stats.hp,
    effectiveness: multiplier,
    accuracy: accuracyOf(move),
    immune,
  }
}

/** Rank one side's moves against a defender. */
export function assessSide(
  ctx: SimContext,
  attacker: Combatant,
  defender: Combatant,
): SideAssessment {
  const moves = attacker.moves
    .map((m) => assessMove(ctx, attacker, defender, m))
    .sort((a, b) => b.expected - a.expected)
  const best = moves.find((m) => m.expected > 0) ?? null
  const turnsToKo = best ? Math.ceil(defender.stats.hp / best.expected) : Infinity
  return {
    attacker,
    defender,
    moves,
    best,
    turnsToKo,
    percentPerTurn: best ? (best.expected / defender.stats.hp) * 100 : 0,
  }
}

/** Speed tiebreak weight in the score — half a turn's worth. */
const SPEED_WEIGHT = 0.5

export function evaluateMatchup(ctx: SimContext, self: Combatant, foe: Combatant): Matchup {
  const selfSide = assessSide(ctx, self, foe)
  const foeSide = assessSide(ctx, foe, self)
  const outspeeds = self.stats.spe > foe.stats.spe
  const speedTie = self.stats.spe === foe.stats.spe

  const a = selfSide.turnsToKo
  const b = foeSide.turnsToKo
  let score: number
  if (!Number.isFinite(a) && !Number.isFinite(b)) score = 0
  else if (!Number.isFinite(a)) score = -1
  else if (!Number.isFinite(b)) score = 1
  else {
    const bump = speedTie ? 0 : outspeeds ? SPEED_WEIGHT : -SPEED_WEIGHT
    score = Math.max(-1, Math.min(1, (b - a + bump) / (a + b)))
  }
  return { self, foe, selfSide, foeSide, outspeeds, speedTie, score }
}

/** Run one Pokémon against a whole cohort. */
export function evaluateCohort(
  ctx: SimContext,
  self: Combatant,
  cohort: readonly Combatant[],
): Matchup[] {
  return cohort.map((foe) => evaluateMatchup(ctx, self, foe))
}

/** Mean matchup score across a cohort, on the same −1…+1 scale. */
export function viabilityScore(matchups: readonly Matchup[]): number {
  if (matchups.length === 0) return 0
  return matchups.reduce((sum, m) => sum + m.score, 0) / matchups.length
}
