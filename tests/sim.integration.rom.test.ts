import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import {
  benchmarkCohort,
  buildCombatant,
  coverage,
  evaluateCohort,
  levelUpPool,
  loadOverrides,
  makeContext,
  pickBestMoves,
  simulateMany,
  viabilityScore,
} from '../src/sim'
import { nameIndex, resolveName } from '../src/lib/names'
import { heartAndSoulRom } from './romPath'

/**
 * The balance harness against the real Heart & Soul ROM. Skipped when the ROM
 * isn't on this machine (CI, another checkout). These are the checks that
 * would catch a reader drifting out of sync with the data — cohort resolution,
 * end-to-end determinism, and the "a buff must not make things worse"
 * monotonicity smoke.
 */
const romExists = heartAndSoulRom !== null

describe.skipIf(!romExists)('balance harness on the real ROM', () => {
  const rom = romExists
    ? loadRom(new Uint8Array(fs.readFileSync(heartAndSoulRom!.rom)), 'Pokemon Heart & Soul.gba')
    : null!
  const ctx = romExists ? makeContext(rom) : null!
  const speciesIdx = romExists ? nameIndex(rom.species.map((s) => s.name)) : null!

  const subjectAt = (name: string, level: number) => {
    const id = resolveName(speciesIdx, name, 'species')
    const bare = buildCombatant(ctx, rom.species[id], { level, moves: [] })
    return { id, bare }
  }

  it('resolves the full benchmark cohort from the trainer table', () => {
    const cohort = benchmarkCohort(ctx, rom)
    // 22 benchmark trainers, every one of them found.
    expect(cohort.warnings.filter((w) => w.startsWith('No trainer record'))).toEqual([])
    const groups = new Set(cohort.members.map((m) => m.group))
    expect(groups.size).toBe(22)
    expect(cohort.members.length).toBeGreaterThan(80)
    for (const m of cohort.members) {
      expect(m.combatant.level).toBeGreaterThan(0)
      expect(m.combatant.moves.length).toBeGreaterThan(0)
      expect(m.combatant.stats.hp).toBeGreaterThan(0)
    }
  })

  it("picks Red's real team, not a trainer whose name merely contains RED", () => {
    // ALFRED and JARED both contain "RED"; only an exact match is Red himself.
    const cohort = benchmarkCohort(ctx, rom, { only: ['Red'] })
    const names = cohort.members.map((m) => m.combatant.species)
    expect(names).toContain('PIKACHU')
    expect(names).toContain('CHARIZARD')
    expect(cohort.members.length).toBe(6)
    expect(Math.max(...cohort.members.map((m) => m.combatant.level))).toBeGreaterThan(80)
  })

  it('reads Falkner at his real levels with his real moves', () => {
    const cohort = benchmarkCohort(ctx, rom, { only: ['Falkner'] })
    const noctowl = cohort.members.find((m) => m.combatant.species === 'NOCTOWL')!
    expect(noctowl.combatant.level).toBe(11)
    expect(noctowl.combatant.moves.map((m) => m.name)).toContain('PECK')
    expect(noctowl.combatant.itemName).toBe('SITRUS BERRY')
  })

  it('models most of what the cohort actually uses', () => {
    const cohort = benchmarkCohort(ctx, rom)
    const cov = coverage(cohort.members.flatMap((m) => m.combatant.moves))
    expect(cov.total).toBeGreaterThan(100)
    expect(cov.percent).toBeGreaterThan(70)
  })

  it('builds a level-up pool and picks a sane moveset', () => {
    const { id, bare } = subjectAt('Typhlosion', 50)
    const pool = levelUpPool(rom.learnsets[id], 50)
    expect(pool.length).toBeGreaterThan(4)
    const cohort = benchmarkCohort(ctx, rom, { only: ['Bugsy'] })
    const picked = pickBestMoves(
      ctx,
      bare,
      pool,
      cohort.members.map((m) => m.combatant),
    )
    expect(picked.length).toBeGreaterThan(0)
    expect(picked.length).toBeLessThanOrEqual(4)
    // A Fire starter should be bringing a Fire move to a Bug gym.
    expect(picked.some((m) => m.type === 10)).toBe(true)
  })

  it('rates a Fire type well against Bugsy and badly against Pryce', () => {
    const { id, bare } = subjectAt('Typhlosion', 40)
    const pool = levelUpPool(rom.learnsets[id], 40)
    const score = (leader: string): number => {
      const cohort = benchmarkCohort(ctx, rom, { only: [leader] })
      const foes = cohort.members.map((m) => m.combatant)
      const moves = pickBestMoves(ctx, bare, pool, foes)
      const subject = buildCombatant(ctx, rom.species[id], {
        level: 40,
        moves: moves.map((m) => m.id),
      })
      return viabilityScore(evaluateCohort(ctx, subject, foes))
    }
    expect(score('Bugsy')).toBeGreaterThan(score('Pryce'))
    expect(score('Bugsy')).toBeGreaterThan(0.5)
  })

  it('is deterministic end to end for a given seed', () => {
    const { id, bare } = subjectAt('Feraligatr', 45)
    const cohort = benchmarkCohort(ctx, rom, { only: ['Jasmine'] })
    const foes = cohort.members.map((m) => m.combatant)
    const moves = pickBestMoves(ctx, bare, levelUpPool(rom.learnsets[id], 45), foes)
    const subject = buildCombatant(ctx, rom.species[id], { level: 45, moves: moves.map((m) => m.id) })
    const first = simulateMany(ctx, subject, foes[0], 40, 12345)
    const second = simulateMany(ctx, subject, foes[0], 40, 12345)
    expect(second).toEqual(first)
  })

  it('never lowers a win rate when an override is a pure buff', () => {
    const level = 40
    const leader = 'Whitney'
    const cohort = benchmarkCohort(ctx, rom, { only: [leader] })
    const foes = cohort.members.map((m) => m.combatant)
    const id = resolveName(speciesIdx, 'Ampharos', 'species')

    const rateFor = (source: typeof rom): number[] => {
      const localCtx = makeContext(source)
      const bare = buildCombatant(localCtx, source.species[id], { level, moves: [] })
      const moves = pickBestMoves(localCtx, bare, levelUpPool(source.learnsets[id], level), foes)
      const subject = buildCombatant(localCtx, source.species[id], {
        level,
        moves: moves.map((m) => m.id),
      })
      return foes.map((foe) => simulateMany(localCtx, subject, foe, 120, 99).winRate)
    }

    const before = rateFor(rom)
    const buffed = loadOverrides(
      rom,
      JSON.stringify({
        note: 'monotonicity smoke',
        species: { AMPHAROS: { stats: { spa: 200, atk: 200, spe: 200 } } },
      }),
    )
    expect(buffed.appliedOverrides.length).toBe(3)
    const after = rateFor(buffed)
    after.forEach((rate, i) => {
      expect(rate).toBeGreaterThanOrEqual(before[i])
    })
  })

  it('rejects an override that names something the ROM doesn’t have', () => {
    expect(() => loadOverrides(rom, JSON.stringify({ species: { NOTAMON: { stats: { hp: 100 } } } })))
      .toThrow(/unknown species/i)
    expect(() => loadOverrides(rom, JSON.stringify({ species: { PIKACHU: { stats: { spx: 1 } } } })))
      .toThrow(/unknown stat/i)
    expect(() => loadOverrides(rom, '{ not json')).toThrow(/not valid JSON/i)
  })

  it('leaves the ROM buffer untouched', () => {
    const before = rom.rom.bytes.slice(0x6e13bc, 0x6e13bc + 64)
    const cohort = benchmarkCohort(ctx, rom, { only: ['Brock'] })
    simulateMany(ctx, cohort.members[0].combatant, cohort.members[0].combatant, 5, 1)
    expect(rom.rom.bytes.slice(0x6e13bc, 0x6e13bc + 64)).toEqual(before)
  })
})
