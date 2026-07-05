import { describe, it, expect } from 'vitest'
import { sortEntries, entriesEqual } from '../src/rom/tables/learnsets'
import { validateLearnset } from '../src/rom/validate'
import { fuzzyScore } from '../src/lib/fuzzy'

describe('sortEntries', () => {
  it('sorts by level, keeping same-level relative order', () => {
    const sorted = sortEntries([
      { level: 15, moveId: 77 },
      { level: 1, moveId: 33 },
      { level: 15, moveId: 79 },
      { level: 4, moveId: 45 },
    ])
    expect(sorted).toEqual([
      { level: 1, moveId: 33 },
      { level: 4, moveId: 45 },
      { level: 15, moveId: 77 }, // 77 stays before 79
      { level: 15, moveId: 79 },
    ])
  })

  it('does not mutate the input', () => {
    const input = [
      { level: 9, moveId: 1 },
      { level: 2, moveId: 2 },
    ]
    sortEntries(input)
    expect(input[0].level).toBe(9)
  })
})

describe('entriesEqual', () => {
  it('compares by value', () => {
    expect(
      entriesEqual([{ level: 1, moveId: 33 }], [{ level: 1, moveId: 33 }]),
    ).toBe(true)
    expect(
      entriesEqual([{ level: 1, moveId: 33 }], [{ level: 2, moveId: 33 }]),
    ).toBe(false)
    expect(entriesEqual([], [{ level: 1, moveId: 33 }])).toBe(false)
  })
})

describe('validateLearnset', () => {
  it('accepts a clean learnset', () => {
    expect(
      validateLearnset(
        [
          { level: 1, moveId: 33 },
          { level: 4, moveId: 45 },
        ],
        356,
      ),
    ).toEqual([])
  })

  it('flags duplicates, bad levels, and bad moves', () => {
    const warnings = validateLearnset(
      [
        { level: 1, moveId: 33 },
        { level: 5, moveId: 33 }, // duplicate
        { level: 0, moveId: 45 }, // bad level
        { level: 10, moveId: 400 }, // beyond moveCount 356
      ],
      356,
    )
    expect(warnings.map((w) => w.kind).sort()).toEqual(['badMove', 'duplicate', 'level'])
    expect(warnings.find((w) => w.kind === 'duplicate')?.index).toBe(1)
  })

  it('warns when exceeding the relearner-safe count', () => {
    const entries = Array.from({ length: 26 }, (_, i) => ({ level: i + 1, moveId: i + 1 }))
    const warnings = validateLearnset(entries, 356)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].kind).toBe('tooMany')
    expect(warnings[0].index).toBe(-1)
  })
})

describe('fuzzyScore', () => {
  it('ranks prefix > substring > subsequence', () => {
    const prefix = fuzzyScore('thunder', 'THUNDERBOLT')!
    const substring = fuzzyScore('bolt', 'THUNDERBOLT')!
    const subsequence = fuzzyScore('thbolt', 'THUNDERBOLT')!
    expect(prefix).toBeGreaterThan(substring)
    expect(substring).toBeGreaterThan(subsequence)
  })

  it('ignores spaces and punctuation', () => {
    expect(fuzzyScore('vinewhip', 'VINE WHIP')).not.toBeNull()
    expect(fuzzyScore('poisonpowder', 'POISONPOWDER')).not.toBeNull()
  })

  it('returns null for non-matches', () => {
    expect(fuzzyScore('xyz', 'TACKLE')).toBeNull()
  })

  it('matches everything with an empty query', () => {
    expect(fuzzyScore('', 'TACKLE')).toBe(0)
  })
})
