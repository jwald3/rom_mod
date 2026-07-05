import type { LearnsetEntry } from '../rom/tables/learnsets'

export interface SpeciesDiff {
  species: number
  added: LearnsetEntry[]
  removed: LearnsetEntry[]
}

const key = (e: LearnsetEntry) => e.level * 512 + e.moveId

/** Multiset diff of two learnsets (a move at a different level counts as remove + add). */
export function diffLearnsetPair(
  current: LearnsetEntry[],
  baseline: LearnsetEntry[],
): { added: LearnsetEntry[]; removed: LearnsetEntry[] } {
  const counts = new Map<number, { entry: LearnsetEntry; n: number }>()
  for (const e of current) {
    const k = key(e)
    counts.set(k, { entry: e, n: (counts.get(k)?.n ?? 0) + 1 })
  }
  for (const e of baseline) {
    const k = key(e)
    counts.set(k, { entry: e, n: (counts.get(k)?.n ?? 0) - 1 })
  }
  const added: LearnsetEntry[] = []
  const removed: LearnsetEntry[] = []
  for (const { entry, n } of counts.values()) {
    for (let i = 0; i < n; i++) added.push(entry)
    for (let i = 0; i < -n; i++) removed.push(entry)
  }
  const byLevel = (a: LearnsetEntry, b: LearnsetEntry) => a.level - b.level || a.moveId - b.moveId
  return { added: added.sort(byLevel), removed: removed.sort(byLevel) }
}

/** All species whose learnsets differ between current and baseline. */
export function diffAllLearnsets(
  current: LearnsetEntry[][],
  baseline: LearnsetEntry[][],
): SpeciesDiff[] {
  const out: SpeciesDiff[] = []
  const count = Math.min(current.length, baseline.length)
  for (let s = 0; s < count; s++) {
    const { added, removed } = diffLearnsetPair(current[s], baseline[s])
    if (added.length > 0 || removed.length > 0) out.push({ species: s, added, removed })
  }
  return out
}
