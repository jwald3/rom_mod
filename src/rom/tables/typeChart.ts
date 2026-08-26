import type { RomBuffer } from '../buffer'
import type { AnchorMap } from '../anchors'

/**
 * `gTypeEffectiveness` — a flat list of `{attackType, defendType, multiplier}`
 * byte triples listing only the non-neutral matchups; any pair absent from the
 * table is ×1. Multipliers are stored in tenths: 0, 5 (×0.5), 20 (×2).
 *
 * Two markers punctuate the list:
 *   FE FE 00  — everything *after* it is ignored while Foresight is in effect.
 *               Vanilla parks the two Ghost immunities (Normal→Ghost,
 *               Fighting→Ghost) there so Foresight can lift them.
 *   FF FF 00  — end of table.
 *
 * Foresight isn't modeled by the simulator, so post-marker rows are read as
 * ordinary matchups — which is what they are for a battle nobody used
 * Foresight/Odor Sleuth in.
 *
 * Heart & Soul (BPEE) carries **two** such tables, both referenced from
 * adjacent literal-pool words. The one at 0x6E13BC is canonically complete;
 * its neighbour at 0x6E1258 is missing six standard matchups (Ground→Rock ×2,
 * Rock→Ground ×½, Ice→Water ×½, Steel→Ice ×2, Bug→Ghost ×½, Bug→Fairy ×½) and
 * carries a non-canonical Rock→Rock ×½, so the anchor points at 0x6E13BC and
 * `readTypeChart` validates the canonical matchups before trusting it.
 */

export const MUL_NO_EFFECT = 0
export const MUL_NOT_VERY = 5
export const MUL_NEUTRAL = 10
export const MUL_SUPER = 20

const FORESIGHT_MARKER = 0xfe
const END_MARKER = 0xff
/** Safety cap while scanning — a full Gen-6 chart is ~130 rows. */
const MAX_ROWS = 400

export interface TypeChartRow {
  attack: number
  defend: number
  /** Multiplier in tenths: 0, 5, 10 or 20. */
  mul: number
  /** Row sat after the Foresight marker (a Ghost immunity, in vanilla data). */
  afterForesight: boolean
}

export interface TypeChart {
  /** ROM offset the rows were read from, or -1 when no chart was available. */
  offset: number
  rows: TypeChartRow[]
  /** Attacking-type multiplier vs one defending type, in tenths (10 = neutral). */
  mulTenths(attack: number, defend: number): number
  /** Combined multiplier vs a (possibly dual-typed) defender, as a real number. */
  effectiveness(attack: number, defend1: number, defend2: number): number
  warnings: string[]
}

/** Canonical matchups any usable Gen-3+ chart must agree with (tenths). */
const CANONICAL: [attack: number, defend: number, mul: number][] = [
  [11, 10, MUL_SUPER], // Water → Fire
  [10, 12, MUL_SUPER], // Fire → Grass
  [12, 11, MUL_SUPER], // Grass → Water
  [13, 4, MUL_NO_EFFECT], // Electric → Ground
  [0, 7, MUL_NO_EFFECT], // Normal → Ghost
  [1, 7, MUL_NO_EFFECT], // Fighting → Ghost
  [4, 2, MUL_NO_EFFECT], // Ground → Flying
  [4, 5, MUL_SUPER], // Ground → Rock
  [5, 4, MUL_NOT_VERY], // Rock → Ground
  [1, 5, MUL_SUPER], // Fighting → Rock
  [14, 17, MUL_NO_EFFECT], // Psychic → Dark
  [15, 11, MUL_NOT_VERY], // Ice → Water
  [8, 15, MUL_SUPER], // Steel → Ice
  [6, 7, MUL_NOT_VERY], // Bug → Ghost
]

/** Extra checks that only apply once the ROM has a Fairy type (index 18). */
const CANONICAL_FAIRY: [number, number, number][] = [
  [8, 18, MUL_SUPER], // Steel → Fairy
  [16, 18, MUL_NO_EFFECT], // Dragon → Fairy
  [17, 18, MUL_NOT_VERY], // Dark → Fairy
  [18, 16, MUL_SUPER], // Fairy → Dragon
]

/** Read the triples at `offset` up to the end marker. Returns null if malformed. */
export function parseTypeChartRows(rom: RomBuffer, offset: number): TypeChartRow[] | null {
  if (offset <= 0 || offset + 3 > rom.length) return null
  const rows: TypeChartRow[] = []
  let o = offset
  let afterForesight = false
  while (o + 3 <= rom.length) {
    const attack = rom.u8(o)
    const defend = rom.u8(o + 1)
    const mul = rom.u8(o + 2)
    if (attack === END_MARKER && defend === END_MARKER) return rows
    if (attack === FORESIGHT_MARKER && defend === FORESIGHT_MARKER) {
      afterForesight = true
      o += 3
      continue
    }
    if (mul !== MUL_NO_EFFECT && mul !== MUL_NOT_VERY && mul !== MUL_NEUTRAL && mul !== MUL_SUPER) {
      return null // not a type chart
    }
    if (rows.length >= MAX_ROWS) return null
    rows.push({ attack, defend, mul, afterForesight })
    o += 3
  }
  return null // ran off the end without a terminator
}

function lookup(rows: readonly TypeChartRow[], attack: number, defend: number): number {
  for (const r of rows) if (r.attack === attack && r.defend === defend) return r.mul
  return MUL_NEUTRAL
}

/** How many canonical matchups these rows get right, and which ones they miss. */
export function scoreTypeChart(
  rows: readonly TypeChartRow[],
  typeCount: number,
): { hits: number; total: number; misses: string[] } {
  const checks = typeCount > 18 ? [...CANONICAL, ...CANONICAL_FAIRY] : CANONICAL
  const misses: string[] = []
  let hits = 0
  for (const [attack, defend, want] of checks) {
    if (lookup(rows, attack, defend) === want) hits++
    else misses.push(`${attack}>${defend} = ${lookup(rows, attack, defend)}, expected ${want}`)
  }
  return { hits, total: checks.length, misses }
}

/**
 * Search a window for a chart that passes every canonical check. The tables are
 * 4-byte aligned in ROM (they're `const u8[]` arrays), so only aligned offsets
 * are tried. Returns the best-scoring offset, or null if nothing parses.
 */
export function findTypeChart(
  rom: RomBuffer,
  from: number,
  to: number,
  typeCount: number,
): { offset: number; rows: TypeChartRow[] } | null {
  let best: { offset: number; rows: TypeChartRow[]; hits: number } | null = null
  const start = Math.max(0, from & ~3)
  const end = Math.min(rom.length - 3, to)
  for (let o = start; o <= end; o += 4) {
    const rows = parseTypeChartRows(rom, o)
    if (!rows || rows.length < 50) continue
    const { hits, total } = scoreTypeChart(rows, typeCount)
    if (!best || hits > best.hits || (hits === best.hits && rows.length > best.rows.length)) {
      best = { offset: o, rows, hits }
      if (hits === total) break
    }
  }
  return best ? { offset: best.offset, rows: best.rows } : null
}

/** How far either side of the anchor to look when the anchored copy fails. */
const SCAN_RADIUS = 0x1000

/** Build a TypeChart from rows — used by the reader and by tests. */
export function typeChartFromRows(
  rows: TypeChartRow[],
  offset = -1,
  warnings: string[] = [],
): TypeChart {
  // Flat 2-D lookup so the battle loop isn't scanning a 120-row list per hit.
  const table = new Map<number, number>()
  for (const r of rows) table.set(r.attack * 256 + r.defend, r.mul)
  const mulTenths = (attack: number, defend: number): number =>
    table.get(attack * 256 + defend) ?? MUL_NEUTRAL
  return {
    offset,
    rows,
    mulTenths,
    effectiveness(attack, defend1, defend2) {
      const first = mulTenths(attack, defend1) / 10
      const second = defend2 === defend1 ? 1 : mulTenths(attack, defend2) / 10
      return first * second
    },
    warnings,
  }
}

/**
 * Read the ROM's type chart. Falls back to scanning near the anchor when the
 * anchored copy doesn't validate, and finally to an all-neutral chart (with a
 * warning) when the profile has no anchor at all — a simulation on a neutral
 * chart is wrong, so callers surface the warning rather than silently running.
 */
export function readTypeChart(rom: RomBuffer, a: AnchorMap): TypeChart {
  const warnings: string[] = []
  if (!a.typeChart) {
    warnings.push(
      'No type-chart anchor for this ROM profile — every matchup will read as neutral (×1).',
    )
    return typeChartFromRows([], -1, warnings)
  }

  const anchored = parseTypeChartRows(rom, a.typeChart)
  if (anchored) {
    const { hits, total, misses } = scoreTypeChart(anchored, a.typeCount)
    if (hits === total) return typeChartFromRows(anchored, a.typeChart, warnings)
    warnings.push(
      `Type chart at 0x${a.typeChart.toString(16)} failed ${total - hits}/${total} canonical ` +
        `checks (${misses[0]}) — scanning for a better copy.`,
    )
  } else {
    warnings.push(`No type chart parsed at 0x${a.typeChart.toString(16)} — scanning.`)
  }

  const found = findTypeChart(
    rom,
    a.typeChart - SCAN_RADIUS,
    a.typeChart + SCAN_RADIUS,
    a.typeCount,
  )
  if (found) {
    const { hits, total, misses } = scoreTypeChart(found.rows, a.typeCount)
    if (hits < total) {
      warnings.push(
        `Best type chart found (0x${found.offset.toString(16)}) still fails ${total - hits} ` +
          `canonical check(s): ${misses.join('; ')}.`,
      )
    } else {
      warnings.push(`Using the type chart found at 0x${found.offset.toString(16)} instead.`)
    }
    return typeChartFromRows(found.rows, found.offset, warnings)
  }

  warnings.push('No usable type chart found — every matchup will read as neutral (×1).')
  return typeChartFromRows(anchored ?? [], -1, warnings)
}
