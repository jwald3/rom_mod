import type { LearnsetEntry } from './tables/learnsets'

export interface LearnsetWarning {
  /** Row index, or -1 for learnset-wide warnings. */
  index: number
  kind: 'duplicate' | 'level' | 'badMove' | 'tooMany'
  message: string
}

/** Move relearner menu handles at most this many entries cleanly. */
export const RELEARNER_SAFE_MAX = 25

export function validateLearnset(entries: LearnsetEntry[], moveCount: number): LearnsetWarning[] {
  const warnings: LearnsetWarning[] = []
  const seen = new Map<number, number>()

  entries.forEach((e, i) => {
    if (e.moveId <= 0 || e.moveId >= moveCount || e.moveId > 511) {
      warnings.push({ index: i, kind: 'badMove', message: `row ${i + 1}: invalid move #${e.moveId}` })
    }
    if (e.level < 1 || e.level > 100) {
      warnings.push({ index: i, kind: 'level', message: `row ${i + 1}: level ${e.level} is out of range` })
    }
    const first = seen.get(e.moveId)
    if (first !== undefined) {
      warnings.push({
        index: i,
        kind: 'duplicate',
        message: `row ${i + 1}: duplicate of row ${first + 1}`,
      })
    } else {
      seen.set(e.moveId, i)
    }
  })

  if (entries.length > RELEARNER_SAFE_MAX) {
    warnings.push({
      index: -1,
      kind: 'tooMany',
      message: `${entries.length} moves — the in-game move relearner may misbehave above ${RELEARNER_SAFE_MAX}`,
    })
  }
  return warnings
}
