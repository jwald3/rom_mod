import { describe, it, expect } from 'vitest'
import { evoCategory, describeEvolution } from '../src/rom/tables/evolutions'

const ITEMS = ['????????', 'MASTER BALL']
ITEMS[96] = 'THUNDERSTONE'
ITEMS[97] = 'WATER STONE'

describe('evoCategory', () => {
  it('maps methods to filter categories', () => {
    expect(evoCategory(1)).toBe('friendship')
    expect(evoCategory(2)).toBe('friendship')
    expect(evoCategory(3)).toBe('friendship')
    expect(evoCategory(4)).toBe('level')
    expect(evoCategory(5)).toBe('trade')
    expect(evoCategory(6)).toBe('trade')
    expect(evoCategory(7)).toBe('stone')
    for (const m of [8, 9, 10, 11, 12, 13, 14, 15]) expect(evoCategory(m)).toBe('special')
  })
})

describe('describeEvolution', () => {
  it('describes common methods', () => {
    expect(describeEvolution({ method: 4, param: 16, target: 2 }, ITEMS)).toBe('Lv 16')
    expect(describeEvolution({ method: 7, param: 97, target: 134 }, ITEMS)).toBe('WATER STONE')
    expect(describeEvolution({ method: 5, param: 0, target: 94 }, ITEMS)).toBe('Trade')
    expect(describeEvolution({ method: 6, param: 96, target: 94 }, ITEMS)).toBe(
      'Trade holding THUNDERSTONE',
    )
    expect(describeEvolution({ method: 2, param: 0, target: 196 }, ITEMS)).toBe('Friendship, day')
    expect(describeEvolution({ method: 8, param: 20, target: 106 }, ITEMS)).toBe('Lv 20, Atk > Def')
  })

  it('falls back for unknown items and methods', () => {
    expect(describeEvolution({ method: 7, param: 300, target: 1 }, ITEMS)).toBe('item #300')
    expect(describeEvolution({ method: 42, param: 7, target: 1 }, ITEMS)).toBe('method 42 (7)')
  })
})
