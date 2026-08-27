import type { Learnset } from '../rom/tables/learnsets'
import { sortEntries } from '../rom/tables/learnsets'
import { expectedDamage, isDamaging } from './damage'
import { toSimMove } from './effects'
import type { Combatant, SimContext, SimMove } from './types'

/**
 * Choosing what a tested Pokémon actually brings to a fight.
 *
 * The default is the honest one for a balance question: everything it could
 * have learnt by level-up at that level (not just the last four), narrowed to
 * four by marginal usefulness against the cohort it's being measured against.
 * A move that adds nothing the other three don't already cover doesn't make
 * the cut, which is roughly how a player picks.
 */

/** Every distinct move learnable by level-up at or below `level`. */
export function levelUpPool(learnset: Learnset, level: number): number[] {
  const ids: number[] = []
  for (const e of sortEntries(learnset.entries)) {
    if (e.level > level) break
    if (e.moveId && !ids.includes(e.moveId)) ids.push(e.moveId)
  }
  return ids
}

/** TM/HM and tutor moves the species is flagged compatible with. */
export function machinePool(
  compat: readonly boolean[] | undefined,
  moveIds: readonly number[],
): number[] {
  if (!compat) return []
  const out: number[] = []
  moveIds.forEach((id, slot) => {
    if (id && compat[slot] && !out.includes(id)) out.push(id)
  })
  return out
}

export interface PickOptions {
  /** Extra candidate move ids beyond the level-up pool (TMs, tutors). */
  extra?: readonly number[]
  /** Slots to fill (defaults to 4). */
  slots?: number
  /**
   * Keep at least one non-damaging move when a setup/status option is
   * available and the fourth attacking slot adds little. Defaults to true.
   */
  allowUtility?: boolean
}

/**
 * A self-KO move (Explosion/Self-Destruct) faints the user on use, so it can't
 * repeat and it trades your Pokémon away even when it lands. Its raw power is
 * huge, so scored on damage alone it crowds out real STAB — which is exactly
 * how the picker used to hand Typhlosion an Explosion it blew itself up with.
 * Keep a small fraction of its value (it's still a real finisher against a foe
 * you couldn't otherwise beat) but never let it win a slot on damage.
 */
const SELF_KO_DISCOUNT = 0.15

/** Marginal gain, in expected damage, from adding `move` to `chosen`. */
function marginalValue(
  ctx: SimContext,
  self: Combatant,
  opponents: readonly Combatant[],
  chosen: readonly SimMove[],
  move: SimMove,
): number {
  const discount = move.effect.kind === 'explosion' ? SELF_KO_DISCOUNT : 1
  let gain = 0
  for (const foe of opponents) {
    const best = chosen.reduce((m, c) => Math.max(m, expectedDamage(ctx, self, foe, c)), 0)
    const withMove = expectedDamage(ctx, self, foe, move)
    // Normalize by the foe's HP so a 400-HP Snorlax doesn't dominate the sum.
    if (withMove > best) gain += ((withMove - best) / foe.stats.hp) * discount
  }
  return gain
}

/** A crude usefulness score for non-damaging moves, so one can win a slot. */
function utilityScore(move: SimMove): number {
  const e = move.effect
  switch (e.kind) {
    case 'status':
      if (e.status === 'slp') return 0.9
      if (e.status === 'par') return 0.7
      if (e.status === 'tox') return 0.65
      if (e.status === 'brn') return 0.6
      if (e.status === 'psn') return 0.4
      return e.confuses ? 0.35 : 0
    case 'boost': {
      if (e.boostTarget !== 'self') return 0.25
      const total = (e.boosts ?? []).reduce((n, b) => n + b.stages, 0)
      return 0.3 * total
    }
    case 'heal':
    case 'rest':
      return 0.5
    default:
      return 0
  }
}

/**
 * Pick the best `slots` moves from a pool, greedily by marginal expected damage
 * across the cohort, then swap the weakest attacking slot for the best utility
 * move when that slot was pulling its weight anyway (< 5% marginal gain).
 */
export function pickBestMoves(
  ctx: SimContext,
  self: Combatant,
  pool: readonly number[],
  opponents: readonly Combatant[],
  opts: PickOptions = {},
): SimMove[] {
  const slots = opts.slots ?? 4
  const candidates = [...new Set([...pool, ...(opts.extra ?? [])])]
    .map((id) => ctx.moves[id])
    .filter((m) => m && m.name)
    .map(toSimMove)

  const attacking = candidates.filter(isDamaging)
  const utility = candidates
    .filter((m) => !isDamaging(m) && utilityScore(m) > 0)
    .sort((a, b) => utilityScore(b) - utilityScore(a))

  const chosen: SimMove[] = []
  const gains: number[] = []
  const remaining = [...attacking]
  while (chosen.length < slots && remaining.length > 0) {
    let bestIndex = 0
    let bestGain = -1
    remaining.forEach((move, i) => {
      const gain = marginalValue(ctx, self, opponents, chosen, move)
      if (gain > bestGain) {
        bestGain = gain
        bestIndex = i
      }
    })
    const [move] = remaining.splice(bestIndex, 1)
    if (bestGain <= 0 && chosen.length > 0) break // adds nothing anywhere
    chosen.push(move)
    gains.push(bestGain)
  }

  // Fill any leftover slots with the best utility, then consider trading the
  // weakest attacker for one.
  const wantUtility = opts.allowUtility !== false && utility.length > 0
  while (chosen.length < slots && wantUtility && utility.length > 0) {
    chosen.push(utility.shift()!)
    gains.push(0)
  }
  if (wantUtility && utility.length > 0 && chosen.length === slots) {
    const weakest = gains.lastIndexOf(Math.min(...gains.filter((g) => g >= 0)))
    const totalGain = gains.reduce((a, b) => a + Math.max(0, b), 0)
    if (weakest > 0 && totalGain > 0 && gains[weakest] / totalGain < 0.05) {
      chosen[weakest] = utility[0]
    }
  }

  // Fall back to whatever exists if the pool had no damaging moves at all.
  if (chosen.length === 0) return candidates.slice(0, slots)
  return chosen
}
