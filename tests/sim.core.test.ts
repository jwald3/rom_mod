import { describe, it, expect } from 'vitest'
import { typeChartFromRows, MUL_SUPER, MUL_NOT_VERY, MUL_NO_EFFECT } from '../src/rom/tables/typeChart'
import type { MoveInfo } from '../src/rom/tables/moves'
import type { SpeciesInfo } from '../src/rom/tables/species'
import {
  applyStage,
  buildCombatant,
  calcDamage,
  calcHp,
  calcStat,
  classifyEffect,
  coverage,
  computeStats,
  EFFECT,
  expectedDamage,
  isPhysicalType,
  ivFromDifficultyByte,
  makeRng,
  newSide,
  pickBestMoves,
  simulateBattle,
  simulateMany,
  toSimMove,
  type SimContext,
} from '../src/sim'

/**
 * Unit tests for the balance engine. Everything here runs on synthetic data —
 * hand-built species and moves — so the expected numbers can be worked out on
 * paper and don't move when the ROM does.
 */

// ── fixtures ──────────────────────────────────────────────────────────────
const TYPE = { NORMAL: 0, FIGHTING: 1, FLYING: 2, GROUND: 4, GHOST: 7, FIRE: 10, WATER: 11, GRASS: 12, PSYCHIC: 14 }

const move = (over: Partial<MoveInfo> & { id: number; name: string }): MoveInfo => ({
  effect: EFFECT.HIT,
  power: 0,
  type: TYPE.NORMAL,
  accuracy: 100,
  pp: 20,
  effectAccuracy: 0,
  priority: 0,
  ...over,
})

const MOVES: MoveInfo[] = [
  move({ id: 0, name: '-' }),
  move({ id: 1, name: 'TACKLE', power: 100, type: TYPE.NORMAL }),
  move({ id: 2, name: 'FLAMETHROWER', power: 100, type: TYPE.FIRE, effect: EFFECT.BURN_HIT, effectAccuracy: 10 }),
  move({ id: 3, name: 'WATER GUN', power: 100, type: TYPE.WATER }),
  move({ id: 4, name: 'GROWL', power: 0, effect: EFFECT.ATTACK_DOWN }),
  move({ id: 5, name: 'SWORDS DANCE', power: 0, effect: EFFECT.ATTACK_UP_2 }),
  move({ id: 6, name: 'EARTHQUAKE', power: 100, type: TYPE.GROUND, effect: EFFECT.EARTHQUAKE }),
  move({ id: 7, name: 'MYSTERY', power: 80, type: TYPE.NORMAL, effect: 254 }),
  move({ id: 8, name: 'SONICBOOM', power: 0, type: TYPE.NORMAL, effect: EFFECT.SONICBOOM }),
  move({ id: 9, name: 'SLASH', power: 70, type: TYPE.NORMAL, effect: EFFECT.HIGH_CRITICAL }),
  move({ id: 10, name: 'EXPLOSION', power: 250, type: TYPE.NORMAL, effect: EFFECT.EXPLOSION }),
  move({ id: 11, name: 'DREAM EATER', power: 100, type: TYPE.NORMAL, effect: EFFECT.DREAM_EATER }),
  move({ id: 12, name: 'FUTURE SIGHT', power: 100, type: TYPE.PSYCHIC, effect: EFFECT.FUTURE_SIGHT }),
]

const CHART = typeChartFromRows([
  { attack: TYPE.FIRE, defend: TYPE.GRASS, mul: MUL_SUPER, afterForesight: false },
  { attack: TYPE.WATER, defend: TYPE.FIRE, mul: MUL_SUPER, afterForesight: false },
  { attack: TYPE.FIRE, defend: TYPE.WATER, mul: MUL_NOT_VERY, afterForesight: false },
  { attack: TYPE.GROUND, defend: TYPE.FLYING, mul: MUL_NO_EFFECT, afterForesight: false },
  { attack: TYPE.GROUND, defend: TYPE.FIRE, mul: MUL_SUPER, afterForesight: false },
  { attack: TYPE.NORMAL, defend: TYPE.GHOST, mul: MUL_NO_EFFECT, afterForesight: false },
])

const ctx: SimContext = {
  moves: MOVES,
  typeChart: CHART,
  typeNames: ['NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL', '???', 'FIRE', 'WATER', 'GRASS'],
  abilityNames: ['-', 'LEVITATE', 'BLAZE', 'HUGE POWER', 'WONDER GUARD', 'SPORE POWER'],
  itemNames: ['', 'CHARCOAL', 'LEFTOVERS', 'SITRUS BERRY', 'MEGA WIDGET'],
  speciesNames: ['-', 'TESTMON', 'FOEMON'],
}

const species = (over: Partial<SpeciesInfo> & { id: number; name: string }): SpeciesInfo => ({
  type1: TYPE.NORMAL,
  type2: TYPE.NORMAL,
  stats: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
  ability1: 0,
  ability2: 0,
  heldItem1: 0,
  heldItem2: 0,
  ...over,
})

const TESTMON = species({ id: 1, name: 'TESTMON' })
const FOEMON = species({ id: 2, name: 'FOEMON' })

// ── stat maths ────────────────────────────────────────────────────────────
describe('stat calculation', () => {
  it('matches the Gen-3 formulas at level 50', () => {
    expect(calcStat(100, 50, 31, 0)).toBe(120)
    expect(calcHp(100, 50, 31, 0)).toBe(175)
  })

  it('scales with EVs and level', () => {
    expect(calcStat(100, 50, 31, 252)).toBe(152)
    expect(calcStat(100, 100, 31, 0)).toBe(236)
    expect(calcHp(100, 100, 31, 0)).toBe(341)
  })

  it('keeps Shedinja at 1 HP', () => {
    expect(calcHp(1, 50, 31, 0)).toBe(1)
  })

  it('scales a trainer difficulty byte into an IV', () => {
    expect(ivFromDifficultyByte(0)).toBe(0)
    expect(ivFromDifficultyByte(255)).toBe(31)
    expect(ivFromDifficultyByte(128)).toBe(15)
  })

  it('applies stat stages with the Gen-3 table', () => {
    expect(applyStage(100, 0, 'atk')).toBe(100)
    expect(applyStage(100, 1, 'atk')).toBe(150)
    expect(applyStage(100, 2, 'atk')).toBe(200)
    expect(applyStage(100, -1, 'atk')).toBe(66)
    expect(applyStage(100, 6, 'atk')).toBe(400)
    expect(applyStage(100, -6, 'atk')).toBe(25)
    expect(applyStage(100, 99, 'atk')).toBe(400) // clamped
  })

  it('computes a whole stat line', () => {
    expect(computeStats(TESTMON.stats, 50, 31, 0)).toEqual({
      hp: 175,
      atk: 120,
      def: 120,
      spa: 120,
      spd: 120,
      spe: 120,
    })
  })
})

// ── damage ────────────────────────────────────────────────────────────────
describe('damage formula', () => {
  const attacker = buildCombatant(ctx, TESTMON, { level: 50, moves: [1, 2, 3] })
  const defender = buildCombatant(ctx, FOEMON, { level: 50, moves: [1] })

  const hit = (moveId: number, opts = {}, def = defender) =>
    calcDamage(
      ctx,
      attacker,
      newSide(attacker),
      def,
      newSide(def),
      toSimMove(MOVES[moveId]),
      { randomPercent: 100, ...opts },
    )

  it('produces the hand-computed value for a STAB neutral hit', () => {
    // ⌊2·50/5⌋+2 = 22 → ⌊22·100·120/120⌋ = 2200 → ⌊2200/50⌋ = 44 → +2 = 46
    // → STAB ⌊46·3/2⌋ = 69 → ×1 type → 100% roll = 69
    expect(hit(1).damage).toBe(69)
  })

  it('drops STAB for an off-type move', () => {
    expect(hit(3).damage).toBe(46)
  })

  it('doubles on a critical, before the +2 and STAB', () => {
    // 44 ×2 = 88 → +2 = 90 → STAB ⌊90·3/2⌋ = 135
    expect(hit(1, { crit: true }).damage).toBe(135)
  })

  it('applies the 85–100 damage roll', () => {
    expect(hit(1, { randomPercent: 85 }).damage).toBe(58) // ⌊69·85/100⌋
  })

  it('multiplies by type effectiveness', () => {
    const grass = buildCombatant(ctx, species({ ...FOEMON, type1: TYPE.GRASS, type2: TYPE.GRASS }), {
      level: 50,
      moves: [1],
    })
    expect(hit(2, {}, grass).damage).toBe(92) // 46 (no STAB) ×2
    expect(hit(2, {}, grass).effectiveness).toBe(2)
  })

  it('returns zero and flags immunity on a ×0 matchup', () => {
    const flying = buildCombatant(
      ctx,
      species({ ...FOEMON, type1: TYPE.FLYING, type2: TYPE.FLYING }),
      { level: 50, moves: [1] },
    )
    const result = hit(6, {}, flying)
    expect(result.damage).toBe(0)
    expect(result.immune).toBe(true)
  })

  it('never lets a landed hit fall below 1', () => {
    const wall = buildCombatant(
      ctx,
      species({
        id: 3,
        name: 'WALL',
        type1: TYPE.WATER,
        type2: TYPE.WATER,
        stats: { hp: 200, atk: 1, def: 255, spa: 1, spd: 255, spe: 1 },
      }),
      { level: 50, moves: [1] },
    )
    const weak = buildCombatant(
      ctx,
      species({ id: 4, name: 'WEAK', stats: { hp: 10, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 } }),
      { level: 2, moves: [1] },
    )
    // A resisted, un-STAB'd hit from a level-2 nobody rounds to 0 before the
    // clamp: base 0 → +2 → ×0.5 type = 1 → ×85% roll = 0 → clamped to 1.
    const resisted = calcDamage(ctx, weak, newSide(weak), wall, newSide(wall), toSimMove(MOVES[2]), {
      randomPercent: 85,
    })
    expect(resisted.damage).toBe(1)
    // The same hit with STAB clears the clamp — the +2 lands before STAB, so
    // even a hopeless attacker does 2.
    const stab = calcDamage(ctx, weak, newSide(weak), wall, newSide(wall), toSimMove(MOVES[1]), {
      randomPercent: 85,
    })
    expect(stab.damage).toBe(2)
  })

  it('halves physical damage through a burn', () => {
    const burned = { ...newSide(attacker), status: 'brn' as const }
    const normal = calcDamage(ctx, attacker, newSide(attacker), defender, newSide(defender), toSimMove(MOVES[1]), { randomPercent: 100 })
    const withBurn = calcDamage(ctx, attacker, burned, defender, newSide(defender), toSimMove(MOVES[1]), { randomPercent: 100 })
    expect(withBurn.damage).toBeLessThan(normal.damage / 1.9)
  })

  it('weights expected damage by accuracy and crit rate', () => {
    const shaky = toSimMove({ ...MOVES[1], accuracy: 50 })
    const sure = toSimMove(MOVES[1])
    const shakyValue = expectedDamage(ctx, attacker, defender, shaky)
    const sureValue = expectedDamage(ctx, attacker, defender, sure)
    expect(shakyValue).toBeCloseTo(sureValue / 2, 1)
    // Crits push the expectation slightly above the plain average roll.
    expect(sureValue).toBeGreaterThan(
      calcDamage(ctx, attacker, newSide(attacker), defender, newSide(defender), sure, {}).damage,
    )
  })

  it('handles fixed-damage moves outside the formula', () => {
    expect(expectedDamage(ctx, attacker, defender, toSimMove(MOVES[8]))).toBe(20)
  })

  it('discounts Future Sight for its delay and scores it typeless', () => {
    // FUTURE SIGHT (Psychic, 100 BP) and WATER GUN (100 BP, neutral, non-STAB)
    // hit for the same base, but Future Sight lands two turns later — its
    // damage-per-turn should be about a third, never a full hit.
    const fs = expectedDamage(ctx, attacker, defender, toSimMove(MOVES[12]))
    const neutral = expectedDamage(ctx, attacker, defender, toSimMove(MOVES[3])) // WATER GUN
    expect(fs).toBeGreaterThan(0)
    // ≈ 1/3 of a plain hit (delay discount); allow slack for crit weighting and
    // flooring differences between the two paths.
    expect(fs).toBeGreaterThan(neutral / 4)
    expect(fs).toBeLessThan(neutral / 2.5)
  })

  it('lets Future Sight hit a Ghost (typeless)', () => {
    // A Normal move is immune vs Ghost; Future Sight is typeless, so it still
    // lands — that Ghost coverage is the whole point of the move.
    const ghost = buildCombatant(ctx, species({ ...FOEMON, type1: TYPE.GHOST, type2: TYPE.GHOST }), { level: 50, moves: [1] })
    expect(hit(1, {}, ghost).immune).toBe(true) // TACKLE (Normal) can't touch it
    expect(expectedDamage(ctx, attacker, ghost, toSimMove(MOVES[12]))).toBeGreaterThan(0)
  })
})

// ── effects ───────────────────────────────────────────────────────────────
describe('effect classification', () => {
  it('splits categories by type, not by move', () => {
    expect(isPhysicalType(TYPE.NORMAL)).toBe(true)
    expect(isPhysicalType(TYPE.GROUND)).toBe(true)
    expect(isPhysicalType(TYPE.FIRE)).toBe(false)
    expect(isPhysicalType(18)).toBe(false) // Fairy is special on this engine
  })

  it('reads a secondary chance out of effectAccuracy', () => {
    const e = classifyEffect(MOVES[2])
    expect(e.kind).toBe('status-hit')
    expect(e.status).toBe('brn')
    expect(e.chance).toBe(10)
  })

  it('normalizes stat-stage moves', () => {
    expect(classifyEffect(MOVES[4])).toMatchObject({
      kind: 'boost',
      boostTarget: 'foe',
      boosts: [{ stat: 'atk', stages: -1 }],
    })
    expect(classifyEffect(MOVES[5])).toMatchObject({
      kind: 'boost',
      boostTarget: 'self',
      boosts: [{ stat: 'atk', stages: 2 }],
    })
  })

  it('degrades an unknown effect to a plain hit and reports it', () => {
    const e = classifyEffect(MOVES[7])
    expect(e.modeled).toBe(false)
    const cov = coverage([toSimMove(MOVES[1]), toSimMove(MOVES[7])])
    expect(cov.total).toBe(2)
    expect(cov.modeled).toBe(1)
    expect(cov.percent).toBe(50)
    expect(cov.unmodeled).toEqual(['MYSTERY'])
  })
})

// ── moveset selection ─────────────────────────────────────────────────────
describe('move selection', () => {
  it('prefers the move that covers the cohort', () => {
    const self = buildCombatant(ctx, TESTMON, { level: 50, moves: [] })
    const grassFoe = buildCombatant(
      ctx,
      species({ ...FOEMON, type1: TYPE.GRASS, type2: TYPE.GRASS }),
      { level: 50, moves: [1] },
    )
    const picked = pickBestMoves(ctx, self, [1, 2, 3], [grassFoe], { slots: 1 })
    expect(picked.map((m) => m.name)).toEqual(['FLAMETHROWER'])
  })

  it('does not fill slots with moves that add nothing', () => {
    const self = buildCombatant(ctx, TESTMON, { level: 50, moves: [] })
    const foe = buildCombatant(ctx, FOEMON, { level: 50, moves: [1] })
    // TACKLE and WATER GUN are identical against a Normal foe except for STAB,
    // so the second one earns no marginal damage and shouldn't take a slot.
    const picked = pickBestMoves(ctx, self, [1, 3], [foe], { slots: 4, allowUtility: false })
    expect(picked.map((m) => m.name)).toEqual(['TACKLE'])
  })

  it('does not let a self-KO move outrank a repeatable attack on raw power', () => {
    // EXPLOSION hits for 250 BP, far above TACKLE's 100, so scored on damage
    // alone it would win slot one — but it faints the user, so a repeatable
    // attack must come first. (Regression: the picker used to hand this out and
    // the mon blew itself up against everything.)
    const self = buildCombatant(ctx, TESTMON, { level: 50, moves: [] })
    const foe = buildCombatant(ctx, FOEMON, { level: 50, moves: [1] })
    const one = pickBestMoves(ctx, self, [1, 10], [foe], { slots: 1, allowUtility: false })
    expect(one.map((m) => m.name)).toEqual(['TACKLE'])
    // With room for both, EXPLOSION can still ride along as a finisher — it just
    // isn't the primary — so the discount reduces its rank without banning it.
    const two = pickBestMoves(ctx, self, [1, 10], [foe], { slots: 2, allowUtility: false })
    expect(two[0].name).toBe('TACKLE')
  })

  it('breaks a near-tie toward the stronger attacking stat', () => {
    // TACKLE (Normal, physical) and WATER GUN (Water, special) are both 100 BP
    // and both neutral on a Normal foe — a genuine tie except for which stat
    // backs them. A physically-stronger mon should take the physical move; a
    // specially-stronger one the special move.
    const foe = buildCombatant(ctx, FOEMON, { level: 50, moves: [1] })
    const physMon = buildCombatant(ctx, species({ ...TESTMON, stats: { hp: 100, atk: 150, def: 100, spa: 60, spd: 100, spe: 100 } }), { level: 50, moves: [] })
    const specMon = buildCombatant(ctx, species({ ...TESTMON, stats: { hp: 100, atk: 60, def: 100, spa: 150, spd: 100, spe: 100 } }), { level: 50, moves: [] })
    expect(pickBestMoves(ctx, physMon, [1, 3], [foe], { slots: 1, allowUtility: false })[0].name).toBe('TACKLE')
    expect(pickBestMoves(ctx, specMon, [1, 3], [foe], { slots: 1, allowUtility: false })[0].name).toBe('WATER GUN')
  })

  it('does not let the tiebreaker override a real damage difference', () => {
    // On a Grass foe, FLAMETHROWER (special, ×2) out-damages EARTHQUAKE
    // (physical, ×1) by a wide margin. A physically-stronger mon must still take
    // Flamethrower — the category preference is a tiebreaker, not a veto.
    const grassFoe = buildCombatant(ctx, species({ ...FOEMON, type1: TYPE.GRASS, type2: TYPE.GRASS }), { level: 50, moves: [1] })
    const physMon = buildCombatant(ctx, species({ ...TESTMON, stats: { hp: 100, atk: 150, def: 100, spa: 80, spd: 100, spe: 100 } }), { level: 50, moves: [] })
    expect(pickBestMoves(ctx, physMon, [2, 6], [grassFoe], { slots: 1, allowUtility: false })[0].name).toBe('FLAMETHROWER')
  })

  it('scores Dream Eater as zero and never picks it over a real move', () => {
    // Dream Eater only works on a sleeping target, which the picker's view never
    // assumes — so it's worth nothing and can't take a slot from TACKLE.
    const self = buildCombatant(ctx, TESTMON, { level: 50, moves: [] })
    const foe = buildCombatant(ctx, FOEMON, { level: 50, moves: [1] })
    expect(expectedDamage(ctx, self, foe, toSimMove(MOVES[11]))).toBe(0)
    const picked = pickBestMoves(ctx, self, [1, 11], [foe], { slots: 1, allowUtility: false })
    expect(picked.map((m) => m.name)).toEqual(['TACKLE'])
  })

  it('does not pick a self-KO move when a real move already KOs the foe', () => {
    // The Feraligatr case: a high-Attack user where EXPLOSION out-damages the
    // real move by a wide margin, but both one-shot the foe. A flat fractional
    // discount still let Explosion win here; it must add NOTHING when its KO
    // isn't unique. A single frail foe both moves KO → EXPLOSION never chosen.
    const bruiser = buildCombatant(ctx, species({ ...TESTMON, stats: { hp: 100, atk: 200, def: 100, spa: 100, spd: 100, spe: 100 } }), { level: 50, moves: [] })
    const frail = buildCombatant(ctx, species({ ...FOEMON, stats: { hp: 40, atk: 60, def: 40, spa: 60, spd: 60, spe: 60 } }), { level: 50, moves: [1] })
    const picked = pickBestMoves(ctx, bruiser, [1, 10], [frail], { slots: 2, allowUtility: false })
    expect(picked.map((m) => m.name)).not.toContain('EXPLOSION')
  })
})

// ── battle loop ───────────────────────────────────────────────────────────
describe('battle simulation', () => {
  const a = buildCombatant(ctx, TESTMON, { level: 50, moves: [1], label: 'A' })
  const b = buildCombatant(ctx, FOEMON, { level: 50, moves: [1], label: 'B' })

  it('is deterministic for a given seed', () => {
    const first = simulateBattle(ctx, a, b, makeRng(42))
    const second = simulateBattle(ctx, a, b, makeRng(42))
    expect(second).toEqual(first)
  })

  it('produces a different battle for a different seed', () => {
    const batch = simulateMany(ctx, a, b, 50, 1)
    const other = simulateMany(ctx, a, b, 50, 999)
    expect(batch.winRate).not.toBe(other.winRate)
  })

  it('is roughly even in a mirror match', () => {
    const batch = simulateMany(ctx, a, b, 400, 7)
    expect(batch.wins + batch.losses + batch.draws).toBe(400)
    expect(batch.winRate).toBeGreaterThan(30)
    expect(batch.winRate).toBeLessThan(70)
  })

  it('is lopsided across a big level gap', () => {
    const strong = buildCombatant(ctx, TESTMON, { level: 60, moves: [1] })
    const weak = buildCombatant(ctx, FOEMON, { level: 15, moves: [1] })
    expect(simulateMany(ctx, strong, weak, 100, 3).winRate).toBe(100)
    expect(simulateMany(ctx, weak, strong, 100, 3).winRate).toBe(0)
  })

  it('calls a draw when the turn cap runs out', () => {
    // Two mons whose only move is a stat drop can't KO each other inside the cap.
    const passiveA = buildCombatant(ctx, TESTMON, { level: 50, moves: [4] })
    const passiveB = buildCombatant(ctx, FOEMON, { level: 50, moves: [4] })
    const result = simulateBattle(ctx, passiveA, passiveB, makeRng(1), { maxTurns: 10 })
    expect(result.winner).toBe('draw')
    expect(result.turns).toBe(10)
  })

  it('breaks a PP stalemate with Struggle', () => {
    // Same passive pair, uncapped: once GROWL's 20 PP is spent both sides
    // Struggle, and the recoil eventually decides it.
    const passiveA = buildCombatant(ctx, TESTMON, { level: 50, moves: [4] })
    const passiveB = buildCombatant(ctx, FOEMON, { level: 50, moves: [4] })
    const result = simulateBattle(ctx, passiveA, passiveB, makeRng(1))
    expect(result.winner).not.toBe('draw')
    expect(result.turns).toBeGreaterThan(20)
  })

  it('records who won with how much left', () => {
    const strong = buildCombatant(ctx, TESTMON, { level: 70, moves: [1] })
    const weak = buildCombatant(ctx, FOEMON, { level: 20, moves: [1] })
    const result = simulateBattle(ctx, strong, weak, makeRng(5))
    expect(result.winner).toBe('a')
    expect(result.winnerHpPercent).toBeGreaterThan(50)
    expect(result.turns).toBeGreaterThan(0)
  })

  it('Dream Eater does no damage to an awake target', () => {
    // A Dream-Eater-only mon can't scratch a foe that never sleeps: the move
    // fails every turn, so within the cap neither side falls — a draw. (Both
    // have 20 PP of their move, so this happens before any Struggle.)
    const dreamer = buildCombatant(ctx, TESTMON, { level: 50, moves: [11] })
    const passive = buildCombatant(ctx, FOEMON, { level: 50, moves: [4] }) // GROWL
    const result = simulateBattle(ctx, dreamer, passive, makeRng(1), { maxTurns: 10 })
    expect(result.winner).toBe('draw')
  })

  it('keeps a log only when asked', () => {
    expect(simulateBattle(ctx, a, b, makeRng(2)).log).toEqual([])
    expect(simulateBattle(ctx, a, b, makeRng(2), { log: true }).log.length).toBeGreaterThan(0)
  })
})

// ── rng ───────────────────────────────────────────────────────────────────
describe('rng', () => {
  it('repeats exactly for the same seed', () => {
    const draw = (seed: number): number[] =>
      Array.from({ length: 5 }, () => makeRng(seed).next())
    expect(draw(11)).toEqual(draw(11))
  })

  it('stays in range', () => {
    const rng = makeRng(3)
    for (let i = 0; i < 500; i++) {
      const value = rng.range(85, 100)
      expect(value).toBeGreaterThanOrEqual(85)
      expect(value).toBeLessThanOrEqual(100)
    }
  })
})
