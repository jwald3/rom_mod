import { norm } from '../lib/names'
import type { Combatant, SimMove, Status } from './types'

/**
 * Ability effects the engine understands, keyed by *name* rather than id: this
 * build runs 82 abilities (vanilla Gen 3 has 78) and the extras — TRANSISTOR,
 * DRAGON'S MAW, MULTITYPE, PIXILATE — sit above the vanilla range, so an id
 * table would need per-ROM maintenance while a name lookup just works.
 *
 * Abilities not listed here are no-ops, and `unmodeledAbility` reports them so
 * a result can say which ones it ignored.
 */

export type AbilityKey =
  | 'levitate'
  | 'intimidate'
  | 'thick-fat'
  | 'water-absorb'
  | 'volt-absorb'
  | 'flash-fire'
  | 'wonder-guard'
  | 'sturdy'
  | 'guts'
  | 'huge-power'
  | 'speed-boost'
  | 'status-immune'
  | 'shield-dust'
  | 'battle-armor'
  | 'rock-head'
  | 'clear-body'
  | 'overgrow'
  | 'blaze'
  | 'torrent'
  | 'swarm'
  | 'marvel-scale'
  | 'transistor'
  | 'dragons-maw'
  | 'truant'

/** Ability name (normalized) → what the engine does with it. */
const BY_NAME: Record<string, AbilityKey> = {
  LEVITATE: 'levitate',
  INTIMIDATE: 'intimidate',
  THICKFAT: 'thick-fat',
  WATERABSORB: 'water-absorb',
  VOLTABSORB: 'volt-absorb',
  FLASHFIRE: 'flash-fire',
  WONDERGUARD: 'wonder-guard',
  STURDY: 'sturdy',
  GUTS: 'guts',
  HUGEPOWER: 'huge-power',
  PUREPOWER: 'huge-power',
  SPEEDBOOST: 'speed-boost',
  IMMUNITY: 'status-immune',
  LIMBER: 'status-immune',
  INSOMNIA: 'status-immune',
  VITALSPIRIT: 'status-immune',
  WATERVEIL: 'status-immune',
  MAGMAARMOR: 'status-immune',
  SHIELDDUST: 'shield-dust',
  BATTLEARMOR: 'battle-armor',
  SHELLARMOR: 'battle-armor',
  ROCKHEAD: 'rock-head',
  CLEARBODY: 'clear-body',
  WHITESMOKE: 'clear-body',
  HYPERCUTTER: 'clear-body',
  OVERGROW: 'overgrow',
  BLAZE: 'blaze',
  TORRENT: 'torrent',
  SWARM: 'swarm',
  MARVELSCALE: 'marvel-scale',
  TRANSISTOR: 'transistor',
  DRAGONSMAW: 'dragons-maw',
  TRUANT: 'truant',
}

/** Which status each status-immunity ability blocks. */
const STATUS_IMMUNITY: Record<string, Status> = {
  IMMUNITY: 'psn',
  LIMBER: 'par',
  INSOMNIA: 'slp',
  VITALSPIRIT: 'slp',
  WATERVEIL: 'brn',
  MAGMAARMOR: 'frz',
}

/** Types each pinch ability boosts, and the type each absorb ability nullifies. */
const PINCH_TYPE: Partial<Record<AbilityKey, number>> = {
  overgrow: 12, // Grass
  blaze: 10, // Fire
  torrent: 11, // Water
  swarm: 6, // Bug
  transistor: 13, // Electric
  'dragons-maw': 16, // Dragon
}

const ABSORB_TYPE: Partial<Record<AbilityKey, number>> = {
  'water-absorb': 11,
  'volt-absorb': 13,
  'flash-fire': 10,
}

const TYPE_GROUND = 4

export function abilityKey(name: string): AbilityKey | null {
  return BY_NAME[norm(name)] ?? null
}

/** True when the engine has no handler for this ability name. */
export function isUnmodeledAbility(name: string): boolean {
  return name.trim().length > 0 && abilityKey(name) === null
}

/** The status this combatant's ability makes it immune to, if any. */
export function statusImmunity(c: Combatant): Status | null {
  return STATUS_IMMUNITY[norm(c.abilityName)] ?? null
}

/** Immune to this move's type outright (Levitate, the absorb abilities)? */
export function absorbsType(defender: Combatant, moveType: number): boolean {
  const key = abilityKey(defender.abilityName)
  if (!key) return false
  if (key === 'levitate' && moveType === TYPE_GROUND) return true
  return ABSORB_TYPE[key] === moveType
}

/** Wonder Guard: only super-effective damage lands. */
export function hasWonderGuard(c: Combatant): boolean {
  return abilityKey(c.abilityName) === 'wonder-guard'
}

/** Sturdy blocks OHKO moves (its Gen-3 behaviour — no endure-a-hit). */
export function blocksOhko(c: Combatant): boolean {
  return abilityKey(c.abilityName) === 'sturdy'
}

/** Shield Dust suppresses the *secondary* effects of moves used against it. */
export function blocksSecondaries(c: Combatant): boolean {
  return abilityKey(c.abilityName) === 'shield-dust'
}

/** Battle/Shell Armor: can't be hit by a critical. */
export function blocksCrits(c: Combatant): boolean {
  return abilityKey(c.abilityName) === 'battle-armor'
}

/** Rock Head: no recoil damage. */
export function ignoresRecoil(c: Combatant): boolean {
  return abilityKey(c.abilityName) === 'rock-head'
}

/** Clear Body / White Smoke: the foe can't drop this mon's stats. */
export function blocksStatDrops(c: Combatant): boolean {
  return abilityKey(c.abilityName) === 'clear-body'
}

/** Speed Boost: +1 Speed at the end of every turn. */
export function hasSpeedBoost(c: Combatant): boolean {
  return abilityKey(c.abilityName) === 'speed-boost'
}

/** Intimidate: −1 to the foe's Attack on entry. */
export function hasIntimidate(c: Combatant): boolean {
  return abilityKey(c.abilityName) === 'intimidate'
}

/** Truant: acts only every other turn — it loafs after any turn it moved. */
export function hasTruant(c: Combatant): boolean {
  return abilityKey(c.abilityName) === 'truant'
}

/**
 * Attack multiplier from the *attacker's* ability, as a numerator over 100.
 * Huge Power doubles Attack; Guts adds 50% while statused (and cancels burn's
 * halving, which `damage.ts` handles); the pinch abilities add 50% to their
 * type below 1/3 HP.
 */
export function attackMultiplier(
  attacker: Combatant,
  move: SimMove,
  hpFraction: number,
  status: Status,
): number {
  const key = abilityKey(attacker.abilityName)
  if (!key) return 100
  if (key === 'huge-power' && move.category === 'physical') return 200
  if (key === 'guts' && status !== 'none' && move.category === 'physical') return 150
  const pinch = PINCH_TYPE[key]
  if (pinch !== undefined && move.type === pinch && hpFraction <= 1 / 3) return 150
  return 100
}

/**
 * Defence multiplier from the *defender's* ability, as a numerator over 100.
 * Thick Fat halves incoming Fire/Ice by boosting the defence; Marvel Scale adds
 * 50% Defense while statused.
 */
export function defenseMultiplier(defender: Combatant, move: SimMove, status: Status): number {
  const key = abilityKey(defender.abilityName)
  if (!key) return 100
  if (key === 'thick-fat' && (move.type === 10 || move.type === 15)) return 200
  if (key === 'marvel-scale' && status !== 'none' && move.category === 'physical') return 150
  return 100
}
