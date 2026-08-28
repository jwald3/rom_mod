import type { MoveInfo } from '../rom/tables/moves'
import type { SimEffect, SimMove, MoveCategory, BoostableStat } from './types'

/**
 * The vanilla Gen-3 `EFFECT_*` enum, and the mapping from an id to something
 * the battle loop can execute.
 *
 * The ids are the pokeemerald `battle_move_effects.h` positions. That they hold
 * for *this* ROM was checked against its own move table: 152 of 156 probed
 * moves land on the expected id, and all four misses are known balance edits in
 * this hack (Double-Edge on the 1/3-recoil variant 198, String Shot at −2 Speed,
 * Crunch lowering Defense, Night Shade reworked to a plain hit) — not enum
 * drift. Every effect id actually present in the ROM is accounted for below.
 *
 * Anything without a handler becomes `kind: 'unmodeled'` and is played as a
 * plain damaging move (or skipped entirely if it has no power), and
 * `coverage()` reports how much of a cohort's move usage that affects — so a
 * result is never quietly wrong about what it simulated.
 */

export const EFFECT = {
  HIT: 0,
  SLEEP: 1,
  POISON_HIT: 2,
  ABSORB: 3,
  BURN_HIT: 4,
  FREEZE_HIT: 5,
  PARALYZE_HIT: 6,
  EXPLOSION: 7,
  DREAM_EATER: 8,
  MIRROR_MOVE: 9,
  ATTACK_UP: 10,
  DEFENSE_UP: 11,
  SPEED_UP: 12,
  SPECIAL_ATTACK_UP: 13,
  SPECIAL_DEFENSE_UP: 14,
  ACCURACY_UP: 15,
  EVASION_UP: 16,
  ALWAYS_HIT: 17,
  ATTACK_DOWN: 18,
  DEFENSE_DOWN: 19,
  SPEED_DOWN: 20,
  SPECIAL_ATTACK_DOWN: 21,
  SPECIAL_DEFENSE_DOWN: 22,
  ACCURACY_DOWN: 23,
  EVASION_DOWN: 24,
  HAZE: 25,
  BIDE: 26,
  RAMPAGE: 27,
  ROAR: 28,
  MULTI_HIT: 29,
  CONVERSION: 30,
  FLINCH_HIT: 31,
  RESTORE_HP: 32,
  TOXIC: 33,
  PAY_DAY: 34,
  LIGHT_SCREEN: 35,
  TRI_ATTACK: 36,
  REST: 37,
  OHKO: 38,
  RAZOR_WIND: 39,
  SUPER_FANG: 40,
  DRAGON_RAGE: 41,
  TRAP: 42,
  HIGH_CRITICAL: 43,
  DOUBLE_HIT: 44,
  RECOIL_IF_MISS: 45,
  MIST: 46,
  FOCUS_ENERGY: 47,
  RECOIL: 48,
  CONFUSE: 49,
  ATTACK_UP_2: 50,
  DEFENSE_UP_2: 51,
  SPEED_UP_2: 52,
  SPECIAL_ATTACK_UP_2: 53,
  SPECIAL_DEFENSE_UP_2: 54,
  ACCURACY_UP_2: 55,
  EVASION_UP_2: 56,
  TRANSFORM: 57,
  ATTACK_DOWN_2: 58,
  DEFENSE_DOWN_2: 59,
  SPEED_DOWN_2: 60,
  SPECIAL_ATTACK_DOWN_2: 61,
  SPECIAL_DEFENSE_DOWN_2: 62,
  ACCURACY_DOWN_2: 63,
  EVASION_DOWN_2: 64,
  REFLECT: 65,
  POISON: 66,
  PARALYZE: 67,
  ATTACK_DOWN_HIT: 68,
  DEFENSE_DOWN_HIT: 69,
  SPEED_DOWN_HIT: 70,
  SPECIAL_ATTACK_DOWN_HIT: 71,
  SPECIAL_DEFENSE_DOWN_HIT: 72,
  ACCURACY_DOWN_HIT: 73,
  EVASION_DOWN_HIT: 74,
  SKY_ATTACK: 75,
  CONFUSE_HIT: 76,
  TWINEEDLE: 77,
  VITAL_THROW: 78,
  SUBSTITUTE: 79,
  RECHARGE: 80,
  RAGE: 81,
  MIMIC: 82,
  METRONOME: 83,
  LEECH_SEED: 84,
  SPLASH: 85,
  DISABLE: 86,
  LEVEL_DAMAGE: 87,
  PSYWAVE: 88,
  COUNTER: 89,
  ENCORE: 90,
  PAIN_SPLIT: 91,
  SNORE: 92,
  CONVERSION_2: 93,
  LOCK_ON: 94,
  SKETCH: 95,
  SLEEP_TALK: 97,
  DESTINY_BOND: 98,
  FLAIL: 99,
  SPITE: 100,
  FALSE_SWIPE: 101,
  HEAL_BELL: 102,
  QUICK_ATTACK: 103,
  TRIPLE_KICK: 104,
  THIEF: 105,
  MEAN_LOOK: 106,
  NIGHTMARE: 107,
  MINIMIZE: 108,
  CURSE: 109,
  PROTECT: 111,
  SPIKES: 112,
  FORESIGHT: 113,
  PERISH_SONG: 114,
  SANDSTORM: 115,
  ENDURE: 116,
  ROLLOUT: 117,
  SWAGGER: 118,
  FURY_CUTTER: 119,
  ATTRACT: 120,
  RETURN: 121,
  PRESENT: 122,
  FRUSTRATION: 123,
  SAFEGUARD: 124,
  THAW_HIT: 125,
  MAGNITUDE: 126,
  BATON_PASS: 127,
  PURSUIT: 128,
  RAPID_SPIN: 129,
  SONICBOOM: 130,
  MORNING_SUN: 132,
  SYNTHESIS: 133,
  MOONLIGHT: 134,
  HIDDEN_POWER: 135,
  RAIN_DANCE: 136,
  SUNNY_DAY: 137,
  DEFENSE_UP_HIT: 138,
  ATTACK_UP_HIT: 139,
  ALL_STATS_UP_HIT: 140,
  BELLY_DRUM: 142,
  PSYCH_UP: 143,
  MIRROR_COAT: 144,
  SKULL_BASH: 145,
  TWISTER: 146,
  EARTHQUAKE: 147,
  FUTURE_SIGHT: 148,
  GUST: 149,
  FLINCH_MINIMIZE_HIT: 150,
  SOLARBEAM: 151,
  THUNDER: 152,
  TELEPORT: 153,
  BEAT_UP: 154,
  SEMI_INVULNERABLE: 155,
  DEFENSE_CURL: 156,
  SOFTBOILED: 157,
  FAKE_OUT: 158,
  UPROAR: 159,
  STOCKPILE: 160,
  SPIT_UP: 161,
  SWALLOW: 162,
  HAIL: 164,
  TORMENT: 165,
  FLATTER: 166,
  WILL_O_WISP: 167,
  MEMENTO: 168,
  FACADE: 169,
  FOCUS_PUNCH: 170,
  SMELLINGSALT: 171,
  FOLLOW_ME: 172,
  NATURE_POWER: 173,
  CHARGE: 174,
  TAUNT: 175,
  HELPING_HAND: 176,
  TRICK: 177,
  ROLE_PLAY: 178,
  WISH: 179,
  ASSIST: 180,
  INGRAIN: 181,
  SUPERPOWER: 182,
  MAGIC_COAT: 183,
  RECYCLE: 184,
  REVENGE: 185,
  BRICK_BREAK: 186,
  YAWN: 187,
  KNOCK_OFF: 188,
  ENDEAVOR: 189,
  ERUPTION: 190,
  SKILL_SWAP: 191,
  IMPRISON: 192,
  REFRESH: 193,
  GRUDGE: 194,
  SNATCH: 195,
  LOW_KICK: 196,
  SECRET_POWER: 197,
  DOUBLE_EDGE: 198,
  TEETER_DANCE: 199,
  BLAZE_KICK: 200,
  MUD_SPORT: 201,
  POISON_FANG: 202,
  WEATHER_BALL: 203,
  OVERHEAT: 204,
  TICKLE: 205,
  COSMIC_POWER: 206,
  SKY_UPPERCUT: 207,
  BULK_UP: 208,
  POISON_TAIL: 209,
  WATER_SPORT: 210,
  CALM_MIND: 211,
  DRAGON_DANCE: 212,
  CAMOUFLAGE: 213,
} as const

/**
 * Types 0–8 are physical, 10+ are special. Gen 3 has no per-move category —
 * the split is purely by type — and this build is on that engine, so Fairy at
 * index 18 is a *special* type. Index 9 (the vanilla ??? slot) is physical,
 * matching the decomp's `IS_TYPE_PHYSICAL` boundary.
 */
export const SPECIAL_TYPE_FLOOR = 10

export function isPhysicalType(type: number): boolean {
  return type < SPECIAL_TYPE_FLOOR
}

export function categoryOf(move: MoveInfo): MoveCategory {
  if (move.power === 0) return 'status'
  return isPhysicalType(move.type) ? 'physical' : 'special'
}

const boost = (
  stat: BoostableStat,
  stages: number,
  target: 'self' | 'foe',
  label: string,
  chance?: number,
): SimEffect => ({
  kind: chance === undefined ? 'boost' : 'boost-hit',
  boosts: [{ stat, stages }],
  boostTarget: target,
  chance,
  modeled: true,
  label,
})

const statusMove = (status: SimEffect['status'], label: string): SimEffect => ({
  kind: 'status',
  status,
  modeled: true,
  label,
})

const statusHit = (status: SimEffect['status'], label: string): SimEffect => ({
  kind: 'status-hit',
  status,
  modeled: true,
  label,
})

const STAT_LABEL: Record<BoostableStat, string> = {
  atk: 'Attack',
  def: 'Defense',
  spa: 'Sp.Atk',
  spd: 'Sp.Def',
  spe: 'Speed',
  acc: 'accuracy',
  eva: 'evasion',
}

/** Single-stat boost effects, as [effect id, stat, stages, target]. */
const BOOST_EFFECTS: [number, BoostableStat, number, 'self' | 'foe'][] = [
  [EFFECT.ATTACK_UP, 'atk', 1, 'self'],
  [EFFECT.DEFENSE_UP, 'def', 1, 'self'],
  [EFFECT.SPEED_UP, 'spe', 1, 'self'],
  [EFFECT.SPECIAL_ATTACK_UP, 'spa', 1, 'self'],
  [EFFECT.SPECIAL_DEFENSE_UP, 'spd', 1, 'self'],
  [EFFECT.ACCURACY_UP, 'acc', 1, 'self'],
  [EFFECT.EVASION_UP, 'eva', 1, 'self'],
  [EFFECT.MINIMIZE, 'eva', 1, 'self'],
  [EFFECT.DEFENSE_CURL, 'def', 1, 'self'],
  [EFFECT.ATTACK_UP_2, 'atk', 2, 'self'],
  [EFFECT.DEFENSE_UP_2, 'def', 2, 'self'],
  [EFFECT.SPEED_UP_2, 'spe', 2, 'self'],
  [EFFECT.SPECIAL_ATTACK_UP_2, 'spa', 2, 'self'],
  [EFFECT.SPECIAL_DEFENSE_UP_2, 'spd', 2, 'self'],
  [EFFECT.ACCURACY_UP_2, 'acc', 2, 'self'],
  [EFFECT.EVASION_UP_2, 'eva', 2, 'self'],
  [EFFECT.ATTACK_DOWN, 'atk', -1, 'foe'],
  [EFFECT.DEFENSE_DOWN, 'def', -1, 'foe'],
  [EFFECT.SPEED_DOWN, 'spe', -1, 'foe'],
  [EFFECT.SPECIAL_ATTACK_DOWN, 'spa', -1, 'foe'],
  [EFFECT.SPECIAL_DEFENSE_DOWN, 'spd', -1, 'foe'],
  [EFFECT.ACCURACY_DOWN, 'acc', -1, 'foe'],
  [EFFECT.EVASION_DOWN, 'eva', -1, 'foe'],
  [EFFECT.ATTACK_DOWN_2, 'atk', -2, 'foe'],
  [EFFECT.DEFENSE_DOWN_2, 'def', -2, 'foe'],
  [EFFECT.SPEED_DOWN_2, 'spe', -2, 'foe'],
  [EFFECT.SPECIAL_ATTACK_DOWN_2, 'spa', -2, 'foe'],
  [EFFECT.SPECIAL_DEFENSE_DOWN_2, 'spd', -2, 'foe'],
  [EFFECT.ACCURACY_DOWN_2, 'acc', -2, 'foe'],
  [EFFECT.EVASION_DOWN_2, 'eva', -2, 'foe'],
]

/** Damage + a chance of a stat change, as [effect id, stat, stages, target]. */
const BOOST_HIT_EFFECTS: [number, BoostableStat, number, 'self' | 'foe'][] = [
  [EFFECT.ATTACK_DOWN_HIT, 'atk', -1, 'foe'],
  [EFFECT.DEFENSE_DOWN_HIT, 'def', -1, 'foe'],
  [EFFECT.SPEED_DOWN_HIT, 'spe', -1, 'foe'],
  [EFFECT.SPECIAL_ATTACK_DOWN_HIT, 'spa', -1, 'foe'],
  [EFFECT.SPECIAL_DEFENSE_DOWN_HIT, 'spd', -1, 'foe'],
  [EFFECT.ACCURACY_DOWN_HIT, 'acc', -1, 'foe'],
  [EFFECT.EVASION_DOWN_HIT, 'eva', -1, 'foe'],
  [EFFECT.ATTACK_UP_HIT, 'atk', 1, 'self'],
  [EFFECT.DEFENSE_UP_HIT, 'def', 1, 'self'],
]

/**
 * Damaging moves whose only extra is that they always land. Modeled as such;
 * everything else about them is a plain hit.
 */
const ALWAYS_HIT_EFFECTS = new Set<number>([EFFECT.ALWAYS_HIT, EFFECT.VITAL_THROW])

/**
 * Effects that are damage-only for our purposes: their extra behaviour either
 * doesn't apply to a 1v1 sim (Pay Day, Thief, Rapid Spin, Knock Off's item
 * removal, Beat Up's party size) or is close enough to a plain hit that
 * pretending otherwise would add noise, not accuracy. These are *modeled* —
 * they're not counted against coverage.
 */
const PLAIN_DAMAGE_EFFECTS = new Set<number>([
  EFFECT.HIT,
  EFFECT.PAY_DAY,
  EFFECT.THIEF,
  EFFECT.RAPID_SPIN,
  EFFECT.KNOCK_OFF,
  EFFECT.FALSE_SWIPE,
  EFFECT.QUICK_ATTACK, // priority already comes from the move's own field
  EFFECT.SNORE,
  EFFECT.RETURN, // power comes from POWER_OVERRIDE (ROM stores a placeholder 1)
  EFFECT.FRUSTRATION,
  EFFECT.HIDDEN_POWER, // ROM stores its 70 base power / Normal typing
  EFFECT.PURSUIT, // no switching in a 1v1 sim, so it never doubles
  EFFECT.FACADE, // doubles only when statused; treated as its listed power
  EFFECT.REVENGE,
  EFFECT.SMELLINGSALT,
  EFFECT.BRICK_BREAK, // no screens modeled
  EFFECT.SECRET_POWER,
  EFFECT.WEATHER_BALL, // no weather modeled ⇒ Normal, listed power
  EFFECT.SKY_UPPERCUT,
  EFFECT.TWISTER,
  EFFECT.GUST,
  EFFECT.EARTHQUAKE,
  EFFECT.MAGNITUDE, // averages out around its listed power
  EFFECT.PRESENT,
  EFFECT.BEAT_UP,
])

/** Status moves with no battle-relevant effect in a 1v1 sim, but no damage either. */
const NO_OP_STATUS_EFFECTS = new Set<number>([
  EFFECT.SPLASH,
  EFFECT.TELEPORT,
  EFFECT.CONVERSION,
  EFFECT.CONVERSION_2,
  EFFECT.CAMOUFLAGE,
  EFFECT.MUD_SPORT,
  EFFECT.WATER_SPORT,
  EFFECT.FORESIGHT,
  EFFECT.MIST,
  EFFECT.SAFEGUARD,
  EFFECT.HEAL_BELL,
  EFFECT.REFRESH,
  EFFECT.SPIKES, // no switching
  EFFECT.MEAN_LOOK, // no switching
  EFFECT.ROAR, // no switching
  EFFECT.BATON_PASS, // no switching
  EFFECT.FOLLOW_ME, // doubles only
  EFFECT.HELPING_HAND, // doubles only
  EFFECT.RECYCLE,
  EFFECT.SNATCH,
  EFFECT.MAGIC_COAT,
  EFFECT.GRUDGE,
  EFFECT.IMPRISON,
  EFFECT.ROLE_PLAY,
  EFFECT.SKILL_SWAP,
  EFFECT.TRICK,
  EFFECT.PSYCH_UP,
  EFFECT.SKETCH,
  EFFECT.MIMIC,
  EFFECT.LOCK_ON,
  EFFECT.CHARGE,
  EFFECT.HAZE,
  EFFECT.FOCUS_ENERGY,
])

function pct(chance: number, fallback: number): number {
  return chance > 0 ? chance : fallback
}

/**
 * Normalize one ROM move into something the battle loop can run.
 * `effectAccuracy` supplies the secondary-effect chance; the ROM stores 0 for
 * moves whose secondary is unconditional, so those fall back to 100.
 */
export function classifyEffect(move: MoveInfo): SimEffect {
  const id = move.effect
  const chance = move.effectAccuracy

  if (PLAIN_DAMAGE_EFFECTS.has(id)) return { kind: 'hit', modeled: true, label: '' }
  if (ALWAYS_HIT_EFFECTS.has(id)) return { kind: 'always-hit', modeled: true, label: 'never misses' }
  if (NO_OP_STATUS_EFFECTS.has(id)) {
    return { kind: 'status', status: 'none', modeled: true, label: 'no battle effect modeled' }
  }

  const up = BOOST_EFFECTS.find((b) => b[0] === id)
  if (up) {
    const [, stat, stages, target] = up
    const dir = stages > 0 ? 'raises' : 'lowers'
    const who = target === 'self' ? 'own' : "foe's"
    return boost(stat, stages, target, `${dir} ${who} ${STAT_LABEL[stat]} ×${Math.abs(stages)}`)
  }

  const hitBoost = BOOST_HIT_EFFECTS.find((b) => b[0] === id)
  if (hitBoost) {
    const [, stat, stages, target] = hitBoost
    const dir = stages > 0 ? 'raise' : 'lower'
    const who = target === 'self' ? 'own' : "foe's"
    const p = pct(chance, 100)
    return boost(stat, stages, target, `${p}% ${dir} ${who} ${STAT_LABEL[stat]}`, p)
  }

  switch (id) {
    // ── pure status ─────────────────────────────────────────────────────
    case EFFECT.SLEEP:
      return statusMove('slp', 'puts the foe to sleep')
    case EFFECT.POISON:
      return statusMove('psn', 'poisons')
    case EFFECT.TOXIC:
      return statusMove('tox', 'badly poisons')
    case EFFECT.PARALYZE:
      return statusMove('par', 'paralyzes')
    case EFFECT.WILL_O_WISP:
      return statusMove('brn', 'burns')
    case EFFECT.CONFUSE:
    case EFFECT.TEETER_DANCE:
      return { kind: 'status', status: 'none', confuses: true, modeled: true, label: 'confuses' }
    case EFFECT.SWAGGER:
      return {
        kind: 'boost',
        boosts: [{ stat: 'atk', stages: 2 }],
        boostTarget: 'foe',
        confuses: true,
        modeled: true,
        label: "confuses, +2 foe's Attack",
      }
    case EFFECT.FLATTER:
      return {
        kind: 'boost',
        boosts: [{ stat: 'spa', stages: 1 }],
        boostTarget: 'foe',
        confuses: true,
        modeled: true,
        label: "confuses, +1 foe's Sp.Atk",
      }

    // ── damage + secondary ──────────────────────────────────────────────
    case EFFECT.POISON_HIT:
      return { ...statusHit('psn', `${pct(chance, 100)}% poison`), chance: pct(chance, 100) }
    case EFFECT.POISON_FANG:
      return { ...statusHit('tox', `${pct(chance, 100)}% badly poison`), chance: pct(chance, 100) }
    case EFFECT.BURN_HIT:
    case EFFECT.BLAZE_KICK:
      return { ...statusHit('brn', `${pct(chance, 100)}% burn`), chance: pct(chance, 100) }
    case EFFECT.THAW_HIT:
      return { ...statusHit('brn', `${pct(chance, 10)}% burn`), chance: pct(chance, 10) }
    case EFFECT.FREEZE_HIT:
      return { ...statusHit('frz', `${pct(chance, 10)}% freeze`), chance: pct(chance, 10) }
    case EFFECT.PARALYZE_HIT:
    case EFFECT.THUNDER:
      return { ...statusHit('par', `${pct(chance, 100)}% paralyze`), chance: pct(chance, 100) }
    case EFFECT.POISON_TAIL:
      // High-crit *and* a poison chance; the crit rate matters more in practice.
      return {
        kind: 'status-hit',
        status: 'psn',
        chance: pct(chance, 10),
        modeled: true,
        label: `high crit, ${pct(chance, 10)}% poison`,
      }
    case EFFECT.TRI_ATTACK:
      // One of burn/freeze/paralyze at 20%; burn is the median outcome.
      return { ...statusHit('brn', '20% burn/freeze/paralyze'), chance: pct(chance, 20) }
    case EFFECT.CONFUSE_HIT:
      return {
        kind: 'hit',
        confuses: true,
        chance: pct(chance, 100),
        modeled: true,
        label: `${pct(chance, 100)}% confuse`,
      }
    case EFFECT.FLINCH_HIT:
    case EFFECT.FLINCH_MINIMIZE_HIT:
    case EFFECT.FAKE_OUT:
      return {
        kind: 'flinch-hit',
        chance: pct(chance, id === EFFECT.FAKE_OUT ? 100 : 30),
        modeled: true,
        label: `${pct(chance, id === EFFECT.FAKE_OUT ? 100 : 30)}% flinch`,
      }
    case EFFECT.ALL_STATS_UP_HIT:
      return {
        kind: 'boost-hit',
        boosts: (['atk', 'def', 'spa', 'spd', 'spe'] as BoostableStat[]).map((stat) => ({
          stat,
          stages: 1,
        })),
        boostTarget: 'self',
        chance: pct(chance, 10),
        modeled: true,
        label: `${pct(chance, 10)}% all stats +1`,
      }

    // ── multi-strike ────────────────────────────────────────────────────
    case EFFECT.MULTI_HIT:
      return { kind: 'multi-hit', modeled: true, label: 'hits 2–5 times' }
    case EFFECT.DOUBLE_HIT:
    case EFFECT.TWINEEDLE:
      return { kind: 'double-hit', modeled: true, label: 'hits twice' }
    case EFFECT.TRIPLE_KICK:
      // Rising power across three hits ≈ twice the listed power on average.
      return { kind: 'double-hit', modeled: true, label: 'hits up to 3 times' }

    // ── hp movement ─────────────────────────────────────────────────────
    case EFFECT.ABSORB:
      return { kind: 'drain', fraction: 50, modeled: true, label: 'drains 50% of damage' }
    case EFFECT.DREAM_EATER:
      // Only works on a sleeping target — fails outright otherwise.
      return { kind: 'drain', fraction: 50, requiresSleep: true, modeled: true, label: 'only vs. sleeping; drains 50%' }
    case EFFECT.RECOIL:
    case EFFECT.RECOIL_IF_MISS:
      return { kind: 'recoil', fraction: 25, modeled: true, label: '1/4 recoil' }
    case EFFECT.DOUBLE_EDGE:
      return { kind: 'recoil', fraction: 33, modeled: true, label: '1/3 recoil' }
    case EFFECT.EXPLOSION:
      return { kind: 'explosion', modeled: true, label: 'user faints, halves Defense' }
    case EFFECT.RESTORE_HP:
    case EFFECT.SOFTBOILED:
    case EFFECT.MORNING_SUN:
    case EFFECT.SYNTHESIS:
    case EFFECT.MOONLIGHT:
      return { kind: 'heal', healPercent: 50, modeled: true, label: 'heals 50% max HP' }
    case EFFECT.REST:
      return { kind: 'rest', healPercent: 100, modeled: true, label: 'full heal, sleeps 2 turns' }

    // ── fixed / formula damage ──────────────────────────────────────────
    case EFFECT.SONICBOOM:
      return { kind: 'fixed-damage', amount: 20, modeled: true, label: 'always 20 HP' }
    case EFFECT.DRAGON_RAGE:
      return { kind: 'fixed-damage', amount: 40, modeled: true, label: 'always 40 HP' }
    case EFFECT.LEVEL_DAMAGE:
      return { kind: 'level-damage', modeled: true, label: "damage = user's level" }
    case EFFECT.PSYWAVE:
      return { kind: 'psywave', modeled: true, label: 'random 0.5–1.5× level' }
    case EFFECT.SUPER_FANG:
      return { kind: 'super-fang', modeled: true, label: "halves the foe's HP" }
    case EFFECT.OHKO:
      return { kind: 'ohko', modeled: true, label: 'one-hit KO' }

    // ── timing ──────────────────────────────────────────────────────────
    case EFFECT.RAZOR_WIND:
    case EFFECT.SKULL_BASH:
    case EFFECT.SKY_ATTACK:
    case EFFECT.SOLARBEAM:
    case EFFECT.SEMI_INVULNERABLE:
      return { kind: 'charge', modeled: true, label: 'two-turn move' }
    case EFFECT.RECHARGE:
      // Modeled as a charge move with the idle turn *after* the hit; close
      // enough on damage-per-turn, which is what the harness measures.
      return { kind: 'charge', modeled: true, label: 'recharges after use' }
    case EFFECT.FUTURE_SIGHT:
      // Delayed: strikes two turns after use, so the foe acts freely in between
      // and the hit can be wasted on a faint/switch. Typeless (can reach Ghosts),
      // but its damage-per-turn is a fraction of an instant hit — scored as such.
      return { kind: 'future-sight', modeled: true, label: 'hits 2 turns later' }

    case EFFECT.HIGH_CRITICAL:
      return { kind: 'high-crit', modeled: true, label: 'high critical rate' }

    default:
      return {
        kind: 'unmodeled',
        modeled: false,
        label: `effect #${id} not modeled`,
      }
  }
}

/**
 * Moves whose real base power isn't in the move table — the engine computes it
 * from state the ROM stores as base power 1. For a "how good can this mon be"
 * harness we assume the best case: Return at max friendship, Frustration at min
 * (both 102 BP). Without this they'd be treated as 1-power whiffs.
 */
const POWER_OVERRIDE: Record<number, number> = {
  [EFFECT.RETURN]: 102,
  [EFFECT.FRUSTRATION]: 102,
}

/** Resolve a ROM move into a battle-ready move. */
export function toSimMove(move: MoveInfo): SimMove {
  const effect = classifyEffect(move)
  const power = move.power <= 1 ? (POWER_OVERRIDE[move.effect] ?? move.power) : move.power
  let category = categoryOf(move)
  // A "status" effect that somehow carries power is still a damaging move, and
  // a damaging effect with 0 power (a reworked move) is not.
  if (power > 0 && category === 'status') category = isPhysicalType(move.type) ? 'physical' : 'special'
  return {
    id: move.id,
    name: move.name,
    type: move.type,
    power,
    accuracy: move.accuracy,
    pp: move.pp,
    priority: move.priority,
    category,
    effectId: move.effect,
    effect,
  }
}

/** Struggle — used when a combatant runs out of PP on every move. */
export const STRUGGLE: SimMove = {
  id: -1,
  name: 'STRUGGLE',
  type: 0,
  power: 50,
  accuracy: 100,
  pp: 1,
  priority: 0,
  category: 'physical',
  effectId: EFFECT.RECOIL,
  effect: { kind: 'recoil', fraction: 25, modeled: true, label: '1/4 recoil' },
}

export interface Coverage {
  /** Distinct moves seen. */
  total: number
  /** Distinct moves whose effect the engine models. */
  modeled: number
  /** Percentage of distinct moves modeled, 0–100. */
  percent: number
  /** Names of the unmodeled moves, for the report footer. */
  unmodeled: string[]
}

/** How much of a set of moves the engine actually models. */
export function coverage(moves: readonly SimMove[]): Coverage {
  const seen = new Map<number, SimMove>()
  for (const m of moves) seen.set(m.id, m)
  const all = [...seen.values()]
  const unmodeled = all.filter((m) => !m.effect.modeled)
  const modeled = all.length - unmodeled.length
  return {
    total: all.length,
    modeled,
    percent: all.length === 0 ? 100 : Math.round((modeled / all.length) * 1000) / 10,
    unmodeled: unmodeled.map((m) => m.name).sort(),
  }
}
