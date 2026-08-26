import type { SpeciesStats } from '../rom/tables/species'
import type { Stats, BoostableStat } from './types'

/**
 * Gen-3 stat maths. Natures aren't modeled (every mon is neutral): this build
 * has no nature-editing surface in the harness, and a neutral baseline keeps
 * an A/B stat comparison honest.
 *
 *   hp    = ⌊(2·base + iv + ⌊ev/4⌋) · L / 100⌋ + L + 10
 *   other = ⌊(2·base + iv + ⌊ev/4⌋) · L / 100⌋ + 5
 *
 * Shedinja's 1 HP is a species-level special case in the real engine; it's
 * applied here too so Wonder Guard testing isn't nonsense.
 */

export const MAX_IV = 31
export const MAX_EV_PER_STAT = 255

export function calcHp(base: number, level: number, iv: number, ev: number): number {
  if (base === 1) return 1 // Shedinja
  return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10
}

export function calcStat(base: number, level: number, iv: number, ev: number): number {
  return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5
}

/** Final stats for a species at a level, with one IV and EV value across the board. */
export function computeStats(base: SpeciesStats, level: number, iv: number, ev: number): Stats {
  return {
    hp: calcHp(base.hp, level, iv, ev),
    atk: calcStat(base.atk, level, iv, ev),
    def: calcStat(base.def, level, iv, ev),
    spa: calcStat(base.spa, level, iv, ev),
    spd: calcStat(base.spd, level, iv, ev),
    spe: calcStat(base.spe, level, iv, ev),
  }
}

/**
 * Trainer party entries store a 0–255 "difficulty" byte the engine scales into
 * IVs (`ivByte * 31 / 255` in `CreateNPCTrainer…`), so a 0 byte is a 0-IV mon
 * and 255 is a perfect one. Gym leaders in this ROM all sit at 255.
 */
export function ivFromDifficultyByte(byte: number): number {
  return Math.floor((Math.max(0, Math.min(255, byte)) * MAX_IV) / 255)
}

/** Gen-3 stat-stage multipliers, as numerator/denominator pairs. */
const STAGE_TABLE: [number, number][] = [
  [10, 40], // -6  ×0.25
  [10, 35],
  [10, 30],
  [10, 25],
  [10, 20],
  [10, 15],
  [10, 10], // 0   ×1
  [15, 10],
  [20, 10],
  [25, 10],
  [30, 10],
  [35, 10],
  [40, 10], // +6  ×4
]

/** Accuracy and evasion use a gentler curve than the other stats. */
const ACC_STAGE_TABLE: [number, number][] = [
  [33, 100],
  [36, 100],
  [43, 100],
  [50, 100],
  [60, 100],
  [75, 100],
  [100, 100],
  [133, 100],
  [166, 100],
  [200, 100],
  [250, 100],
  [266, 100],
  [300, 100],
]

export const MIN_STAGE = -6
export const MAX_STAGE = 6

export function clampStage(stage: number): number {
  return Math.max(MIN_STAGE, Math.min(MAX_STAGE, stage))
}

/** Apply a stat stage to a raw stat value (integer truncation, as in-game). */
export function applyStage(value: number, stage: number, stat: BoostableStat): number {
  const table = stat === 'acc' || stat === 'eva' ? ACC_STAGE_TABLE : STAGE_TABLE
  const [num, den] = table[clampStage(stage) + 6]
  return Math.max(1, Math.floor((value * num) / den))
}

/** The multiplier a stage represents, for reports. */
export function stageMultiplier(stage: number, stat: BoostableStat = 'atk'): number {
  const table = stat === 'acc' || stat === 'eva' ? ACC_STAGE_TABLE : STAGE_TABLE
  const [num, den] = table[clampStage(stage) + 6]
  return num / den
}
