import type { Rng } from './rng'
import { applyStage } from './statCalc'
import {
  absorbsType,
  attackMultiplier,
  blocksCrits,
  defenseMultiplier,
  hasWonderGuard,
} from './abilities'
import { isPhysicalType } from './effects'
import { itemDamageBoost } from './items'
import type { Combatant, SimContext, SimMove, Status, BoostableStat } from './types'

/**
 * The Gen-3 damage formula, with the same integer truncation at each step as
 * the engine — the flooring is why a 1-point stat change sometimes moves a KO
 * threshold and sometimes doesn't, which is exactly the kind of thing this
 * harness exists to answer.
 *
 *   base = ⌊ ⌊ ⌊ (2·L/5 + 2) · power · A / D ⌋ / 50 ⌋ ⌋ + 2
 *   then, each flooring separately: crit ×2 · item ×1.1 · STAB ×1.5 ·
 *        type1 · type2 · random(85–100)/100
 *
 * Burn halves a physical attacker's Attack (Guts ignores it). A critical hit
 * ignores the attacker's *negative* stat stages and the defender's *positive*
 * ones, per Gen 3.
 */

/** Live per-side battle state the formula needs beyond the static Combatant. */
export interface SideState {
  hp: number
  status: Status
  stages: Record<BoostableStat, number>
}

export function freshStages(): Record<BoostableStat, number> {
  return { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 }
}

export function newSide(c: Combatant): SideState {
  return { hp: c.stats.hp, status: 'none', stages: freshStages() }
}

export const CRIT_RATE = 1 / 16
export const HIGH_CRIT_RATE = 1 / 4

export function critRate(move: SimMove, defender: Combatant): number {
  if (blocksCrits(defender)) return 0
  return move.effect.kind === 'high-crit' || move.effectId === 209 ? HIGH_CRIT_RATE : CRIT_RATE
}

export interface DamageOptions {
  crit?: boolean
  /** 85–100; omit to use the average (a deterministic 92.5% roll). */
  randomPercent?: number
}

export interface DamageResult {
  damage: number
  /** Combined type multiplier (0, 0.25, 0.5, 1, 2, 4). */
  effectiveness: number
  /** True when the defender is immune (type chart, Levitate, absorb, Wonder Guard). */
  immune: boolean
  stab: boolean
}

/** Effective attacking stat after stages, burn, and ability multipliers. */
function attackStat(
  attacker: Combatant,
  attackerState: SideState,
  move: SimMove,
  crit: boolean,
): number {
  const physical = move.category === 'physical'
  const raw = physical ? attacker.stats.atk : attacker.stats.spa
  const key: BoostableStat = physical ? 'atk' : 'spa'
  // A crit ignores the attacker's own negative stages.
  const stage = crit ? Math.max(0, attackerState.stages[key]) : attackerState.stages[key]
  let value = applyStage(raw, stage, key)
  const hpFraction = attackerState.hp / attacker.stats.hp
  const mult = attackMultiplier(attacker, move, hpFraction, attackerState.status)
  if (mult !== 100) value = Math.floor((value * mult) / 100)
  // Burn halves physical Attack — unless Guts already claimed the status bonus.
  if (physical && attackerState.status === 'brn' && mult !== 150) value = Math.floor(value / 2)
  return Math.max(1, value)
}

/** Effective defending stat after stages and ability multipliers. */
function defenseStat(
  defender: Combatant,
  defenderState: SideState,
  move: SimMove,
  crit: boolean,
): number {
  const physical = move.category === 'physical'
  const raw = physical ? defender.stats.def : defender.stats.spd
  const key: BoostableStat = physical ? 'def' : 'spd'
  // A crit ignores the defender's positive stages.
  const stage = crit ? Math.min(0, defenderState.stages[key]) : defenderState.stages[key]
  let value = applyStage(raw, stage, key)
  const mult = defenseMultiplier(defender, move, defenderState.status)
  if (mult !== 100) value = Math.floor((value * mult) / 100)
  return Math.max(1, value)
}

/** Combined type effectiveness, folding in the type-immunity abilities. */
export function typeEffectiveness(
  ctx: SimContext,
  move: SimMove,
  defender: Combatant,
): { multiplier: number; immune: boolean } {
  if (absorbsType(defender, move.type)) return { multiplier: 0, immune: true }
  const mul = ctx.typeChart.effectiveness(move.type, defender.types[0], defender.types[1])
  if (mul === 0) return { multiplier: 0, immune: true }
  if (hasWonderGuard(defender) && mul < 2) return { multiplier: mul, immune: true }
  return { multiplier: mul, immune: false }
}

/**
 * Damage one hit deals. Returns 0 with `immune: true` when nothing lands;
 * a landed hit is never less than 1, as in-game.
 */
export function calcDamage(
  ctx: SimContext,
  attacker: Combatant,
  attackerState: SideState,
  defender: Combatant,
  defenderState: SideState,
  move: SimMove,
  opts: DamageOptions = {},
): DamageResult {
  const { multiplier, immune } = typeEffectiveness(ctx, move, defender)
  const stab = move.type === attacker.types[0] || move.type === attacker.types[1]
  if (immune || move.power <= 0) {
    return { damage: 0, effectiveness: multiplier, immune, stab }
  }

  const crit = opts.crit ?? false
  const a = attackStat(attacker, attackerState, move, crit)
  const d = defenseStat(defender, defenderState, move, crit)

  let dmg = Math.floor((2 * attacker.level) / 5) + 2
  dmg = Math.floor((dmg * move.power * a) / d)
  dmg = Math.floor(dmg / 50)
  if (crit) dmg *= 2
  const itemBoost = itemDamageBoost(attacker, move)
  if (itemBoost !== 100) dmg = Math.floor((dmg * itemBoost) / 100)
  dmg += 2
  if (stab) dmg = Math.floor((dmg * 3) / 2)

  // Type multipliers apply one defending type at a time, each floored.
  const first = ctx.typeChart.mulTenths(move.type, defender.types[0])
  dmg = Math.floor((dmg * first) / 10)
  if (defender.types[1] !== defender.types[0]) {
    const second = ctx.typeChart.mulTenths(move.type, defender.types[1])
    dmg = Math.floor((dmg * second) / 10)
  }

  const roll = opts.randomPercent ?? 92.5
  dmg = Math.floor((dmg * roll) / 100)
  return { damage: Math.max(1, dmg), effectiveness: multiplier, immune: false, stab }
}

/** Roll the 85–100 damage spread. */
export function rollDamage(
  ctx: SimContext,
  attacker: Combatant,
  attackerState: SideState,
  defender: Combatant,
  defenderState: SideState,
  move: SimMove,
  rng: Rng,
  crit: boolean,
): DamageResult {
  return calcDamage(ctx, attacker, attackerState, defender, defenderState, move, {
    crit,
    randomPercent: rng.range(85, 100),
  })
}

/** Min / max / average damage, ignoring crits — the matchup calculator's view. */
export function damageRange(
  ctx: SimContext,
  attacker: Combatant,
  defender: Combatant,
  move: SimMove,
): { min: number; max: number; avg: number; effectiveness: number; immune: boolean; stab: boolean } {
  const aState = newSide(attacker)
  const dState = newSide(defender)
  const low = calcDamage(ctx, attacker, aState, defender, dState, move, { randomPercent: 85 })
  const high = calcDamage(ctx, attacker, aState, defender, dState, move, { randomPercent: 100 })
  const mid = calcDamage(ctx, attacker, aState, defender, dState, move, {})
  return {
    min: low.damage,
    max: high.damage,
    avg: mid.damage,
    effectiveness: mid.effectiveness,
    immune: mid.immune,
    stab: mid.stab,
  }
}

/**
 * Damage a move is *worth* per turn: average damage, weighted by accuracy and
 * the chance of a crit, and adjusted for the effects that change how much
 * damage one turn's use produces (multi-hit, two-turn, fixed damage…).
 * This is what the AI ranks moves by and what turns-to-KO is built on.
 */
export function expectedDamage(
  ctx: SimContext,
  attacker: Combatant,
  defender: Combatant,
  move: SimMove,
): number {
  const aState = newSide(attacker)
  const dState = newSide(defender)
  const effect = move.effect

  // Effects whose damage doesn't come from the formula at all.
  switch (effect.kind) {
    case 'fixed-damage':
      return typeEffectiveness(ctx, move, defender).immune ? 0 : (effect.amount ?? 0)
    case 'level-damage':
      return typeEffectiveness(ctx, move, defender).immune ? 0 : attacker.level
    case 'psywave':
      return typeEffectiveness(ctx, move, defender).immune ? 0 : attacker.level
    case 'super-fang':
      return typeEffectiveness(ctx, move, defender).immune ? 0 : Math.floor(defender.stats.hp / 2)
    case 'ohko':
      // Gen-3 OHKO accuracy is level-gated and it fails outright on a higher-level foe.
      if (attacker.level < defender.level) return 0
      return (defender.stats.hp * ohkoAccuracy(attacker, defender)) / 100
    default:
      break
  }

  if (move.power <= 0) return 0

  // Dream Eater does nothing unless the foe is asleep. The matchup/picker view
  // treats opponents as awake — this move can't be relied on to deal damage —
  // so it's worth zero here, keeping the picker from rating it as a real hit.
  if (effect.requiresSleep) return 0

  const base = calcDamage(ctx, attacker, aState, defender, dState, move, {})
  if (base.immune) return 0
  const crit = calcDamage(ctx, attacker, aState, defender, dState, move, { crit: true })
  const rate = critRate(move, defender)
  let perHit = base.damage * (1 - rate) + crit.damage * rate

  if (effect.kind === 'multi-hit') perHit *= 3 // 2–5 hits, mean 3 with the 3/8-3/8-1/8-1/8 spread
  if (effect.kind === 'double-hit') perHit *= 2
  if (effect.kind === 'charge') perHit /= 2 // one damaging turn out of two

  return perHit * (accuracyOf(move) / 100)
}

/** A move's hit chance as a percentage; the ROM stores 0 for "never misses". */
export function accuracyOf(move: SimMove): number {
  if (move.effect.kind === 'always-hit') return 100
  return move.accuracy === 0 ? 100 : Math.min(100, move.accuracy)
}

/** Gen-3 OHKO accuracy: base accuracy + the level difference. */
export function ohkoAccuracy(attacker: Combatant, defender: Combatant): number {
  if (attacker.level < defender.level) return 0
  return Math.max(0, Math.min(100, 30 + (attacker.level - defender.level)))
}

/** Whether a move is a damaging one at all (after this ROM's reworks). */
export function isDamaging(move: SimMove): boolean {
  if (move.power > 0) return true
  return (
    move.effect.kind === 'fixed-damage' ||
    move.effect.kind === 'level-damage' ||
    move.effect.kind === 'psywave' ||
    move.effect.kind === 'super-fang' ||
    move.effect.kind === 'ohko'
  )
}

/** Physical/special split by type, exported for report columns. */
export { isPhysicalType }
