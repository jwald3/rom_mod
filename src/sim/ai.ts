import { expectedDamage, isDamaging } from './damage'
import type { Fighter } from './battle'
import type { SimContext, SimMove } from './types'

/**
 * Move choice. Greedy: whatever is expected to remove the most HP this turn,
 * with a few heuristics that keep the sim from looking silly — a setup move is
 * worth using once while healthy, a status move is worth using once on a clean
 * target, and healing is worth it when low.
 *
 * This is deliberately not the in-game AI (which is a per-trainer flag set the
 * harness doesn't model). It's a consistent baseline both sides play by, so
 * results compare like-for-like across a stat change.
 */

/** Chosen move, plus why — the battle log uses this. */
export interface Choice {
  move: SimMove
  reason: 'damage' | 'setup' | 'status' | 'heal'
}

/** Below this HP fraction, healing beats attacking. */
const HEAL_THRESHOLD = 0.4
/** Above this, a setup move is still worth a turn. */
const SETUP_HP_THRESHOLD = 0.6

export function chooseMove(
  ctx: SimContext,
  self: Fighter,
  foe: Fighter,
  usable: readonly SimMove[],
): Choice | null {
  if (usable.length === 0) return null
  const hpFraction = self.hp / self.c.stats.hp

  const damaging = usable.filter(isDamaging)
  let best: SimMove | null = null
  let bestValue = 0
  for (const move of damaging) {
    const value = expectedDamage(ctx, self.c, foe.c, move)
    if (value > bestValue) {
      bestValue = value
      best = move
    }
  }
  // If the best attack already kills, take it — no cleverness needed.
  if (best && bestValue >= foe.hp) return { move: best, reason: 'damage' }

  // Healing, when low and it actually gains something.
  if (hpFraction < HEAL_THRESHOLD) {
    const heal = usable.find((m) => m.effect.kind === 'heal' || m.effect.kind === 'rest')
    if (heal) return { move: heal, reason: 'heal' }
  }

  // A status move, once, on a target that isn't already statused.
  if (foe.status === 'none' && !foe.confusedTurns) {
    const status = usable.find(
      (m) =>
        m.effect.kind === 'status' &&
        (m.effect.status !== 'none' || m.effect.confuses) &&
        !self.usedStatus.has(m.id),
    )
    if (status) return { move: status, reason: 'status' }
  }

  // Setup, while healthy and not already stacked.
  if (hpFraction > SETUP_HP_THRESHOLD) {
    const setup = usable.find(
      (m) =>
        m.effect.kind === 'boost' &&
        m.effect.boostTarget === 'self' &&
        (m.effect.boosts ?? []).some((b) => self.stages[b.stat] < 4) &&
        !self.usedSetup.has(m.id),
    )
    if (setup) return { move: setup, reason: 'setup' }
  }

  if (best) return { move: best, reason: 'damage' }
  // Nothing damaging at all — fall back to the first usable move.
  return { move: usable[0], reason: 'status' }
}
