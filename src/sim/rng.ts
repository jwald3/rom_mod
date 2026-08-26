/**
 * Seeded RNG. Every simulation takes one of these so a run is reproducible:
 * same seed + same inputs ⇒ identical output, which is what makes an A/B
 * comparison of two stat spreads meaningful.
 *
 * mulberry32: 32-bit state, good enough distribution for Monte Carlo counting,
 * and short enough to be obviously deterministic.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [0, n). */
  int(n: number): number
  /** Uniform integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number
  /** True with probability `percent` (0–100). */
  chance(percent: number): boolean
  /** One in `n`. */
  oneIn(n: number): boolean
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (n) => (n <= 0 ? 0 : Math.floor(next() * n)),
    range: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (percent) => next() * 100 < percent,
    oneIn: (n) => next() * n < 1,
  }
}
