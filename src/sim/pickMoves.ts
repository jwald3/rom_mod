import type { SpeciesInfo } from '../rom/tables/species'
import { buildCombatant } from './build'
import { expectedDamage, isDamaging } from './damage'
import { toSimMove } from './effects'
import { simulateMany } from './battle'
import { utilityScore } from './movesets'
import type { Combatant, SimContext } from './types'

/**
 * Pick a moveset by *simulating* candidate sets and keeping the one that wins
 * the most battles — a real search, not the greedy expected-damage proxy that
 * `pickBestMoves` uses. The proxy over-values raw power (it happily takes a
 * recoil or two-turn nuke) and mis-values a utility slot; simulating the whole
 * set catches both. Measured gains over greedy are large where it matters
 * (Pidgeot +20%, Feraligatr +15%).
 *
 * Kept tractable for a 361-mon sweep by pruning to a shortlist first:
 *   1. rank the pool by single-move expected damage across the cohort,
 *   2. take the top `shortlist` damaging moves + the best few utility moves,
 *   3. score every 4-combo of that shortlist with a cheap sim pass, then
 *   4. re-rank the top finalists at more sims for a stable winner.
 */
export interface SimPickOptions {
  slots?: number
  /** How many top moves to search over (C(shortlist,slots) combos). */
  shortlist?: number
  /** Best utility moves to add to the shortlist beyond the damaging ones. */
  utilitySlots?: number
  /** Sims per opponent in the cheap ranking pass. */
  coarseSims?: number
  /** Sims per opponent when re-ranking the finalists. */
  fineSims?: number
  /** How many finalists to re-rank at fineSims. */
  finalists?: number
  /**
   * In the coarse pass, sample every Nth opponent (stride) instead of the whole
   * cohort — the shortlist ranking is stable on a representative slice, and the
   * finalists are re-ranked on the full cohort anyway. 1 = no sampling.
   */
  coarseStride?: number
  seed?: number
}

/** All 4-combinations (indices) of `n` items. */
function combinations(n: number, k: number): number[][] {
  const out: number[][] = []
  const idx = Array.from({ length: k }, (_, i) => i)
  if (k > n) return out
  while (true) {
    out.push([...idx])
    let i = k - 1
    while (i >= 0 && idx[i] === n - k + i) i--
    if (i < 0) break
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
  return out
}

export function pickBestMovesBySim(
  ctx: SimContext,
  species: SpeciesInfo,
  pool: readonly number[],
  opponents: readonly Combatant[],
  subjectLevel: number,
  opponentLevels: readonly number[],
  opts: SimPickOptions = {},
): number[] {
  const slots = opts.slots ?? 4
  const shortlist = opts.shortlist ?? 9
  const utilitySlots = opts.utilitySlots ?? 2
  const coarseSims = opts.coarseSims ?? 8
  const fineSims = opts.fineSims ?? 40
  const finalists = opts.finalists ?? 4
  const coarseStride = opts.coarseStride ?? 4
  const seed = opts.seed ?? 1

  const moves = [...new Set(pool)].map((id) => ({ id, sim: ctx.moves[id] ? toSimMove(ctx.moves[id]) : null }))
    .filter((m): m is { id: number; sim: ReturnType<typeof toSimMove> } => m.sim !== null && m.sim.name !== '')

  // Rank damaging moves by best-case expected damage across the cohort; keep the
  // top few utility moves (sleep/paralysis etc.) separately, since a strong
  // status can beat a fourth attack.
  const bare = buildCombatant(ctx, species, { level: subjectLevel, moves: [], source: { kind: 'tested' } })
  const damagingAll = moves
    .filter((m) => isDamaging(m.sim))
    .map((m) => ({ id: m.id, sim: m.sim, score: opponents.reduce((a, f) => a + expectedDamage(ctx, bare, f, m.sim), 0) }))
    .sort((a, b) => b.score - a.score)
  // Collapse functionally-identical attacks — same type AND same effect kind, so
  // Return/Frustration/Strength (all Normal plain-hits) count as one shortlist
  // entry, not three. Keeps the best-scoring of each; a recoil or charge variant
  // has a different effect kind, so it stays as its own option to compare.
  const seenKind = new Set<string>()
  const damaging = damagingAll.filter((m) => {
    const key = `${m.sim.type}:${m.sim.effect.kind}`
    if (seenKind.has(key)) return false
    seenKind.add(key)
    return true
  })
  const utility = moves
    .filter((m) => !isDamaging(m.sim) && utilityScore(m.sim) > 0)
    .map((m) => ({ id: m.id, score: utilityScore(m.sim) }))
    .sort((a, b) => b.score - a.score)

  const candidateIds = [
    ...damaging.slice(0, shortlist).map((m) => m.id),
    ...utility.slice(0, utilitySlots).map((m) => m.id),
  ]
  if (candidateIds.length <= slots) return candidateIds

  // Indices of the opponents to score against: a strided subset for the coarse
  // pass, the whole cohort for the fine re-rank.
  const allIdx = opponents.map((_, i) => i)
  const coarseIdx = allIdx.filter((i) => i % coarseStride === 0)

  // Build per-level combatants for a given moveset once, then reuse per foe.
  const rate = (ids: number[], sims: number, idxs: number[]): number => {
    const atLevel = new Map<number, Combatant>()
    const at = (lvl: number): Combatant => {
      let c = atLevel.get(lvl)
      if (!c) {
        c = buildCombatant(ctx, species, { level: lvl, moves: ids, source: { kind: 'tested' } })
        atLevel.set(lvl, c)
      }
      return c
    }
    let win = 0
    for (const i of idxs) {
      win += simulateMany(ctx, at(opponentLevels[i]), opponents[i], sims, seed + i * 1013).winRate
    }
    return win / idxs.length
  }

  // Coarse pass over every combo (few sims, subset of foes), then a fine
  // re-rank of the top finalists on the full cohort.
  const combos = combinations(candidateIds.length, slots).map((c) => c.map((i) => candidateIds[i]))
  const coarse = combos
    .map((ids) => ({ ids, wr: rate(ids, coarseSims, coarseIdx) }))
    .sort((a, b) => b.wr - a.wr)
  const top = coarse.slice(0, finalists)
  let best = { ids: top[0].ids, wr: -1 }
  for (const cand of top) {
    const wr = rate(cand.ids, fineSims, allIdx)
    if (wr > best.wr) best = { ids: cand.ids, wr }
  }
  return best.ids
}
