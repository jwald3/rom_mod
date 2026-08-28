/**
 * Build the dataset for the guide's "Tier List" chapter by running the balance
 * harness over the whole reachable dex against the benchmark cohort (every gym
 * leader, the Elite Four and Red, at their real levels), then recording each
 * species' Monte-Carlo win rate and auto-picked --tm moveset.
 *
 *   npx tsx scripts/gen-tierlist-data.mts "<rom.gba>" [toml]
 *
 * Reproducible: same ROM + same seed ⇒ identical numbers. The engine is the
 * same one behind scripts/balance.mts, so the ranking matches what that CLI
 * prints per-mon. Writes scripts/tierlist-data.json.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadRom } from '../src/rom/loadRom'
import { isExcludedSpecies } from './lib/excluded-species'
import {
  benchmarkCohort,
  buildCombatant,
  evaluateCohort,
  levelUpPool,
  machinePool,
  makeContext,
  pickBestMoves,
  simulateMany,
  viabilityScore,
} from '../src/sim'

const here = dirname(fileURLToPath(import.meta.url))
const romPath = process.argv[2]
if (!romPath) {
  console.error('usage: npx tsx scripts/gen-tierlist-data.mts "<rom.gba>" [toml]')
  process.exit(2)
}
const toml = process.argv[3] ? readFileSync(process.argv[3], 'utf8') : undefined
const SIMS = 200
const SEED = 1

const rom = loadRom(new Uint8Array(readFileSync(romPath)), romPath.split(/[\\/]/).pop()!, toml)
if (rom.typeChart.offset < 0) throw new Error('no type chart — results would be meaningless')
const ctx = makeContext(rom)
const tn = (i: number) => rom.typeNames[i] ?? `#${i}`

const cohort = benchmarkCohort(ctx, rom, {})
const foes = cohort.members.map((m) => m.combatant)
const level = Math.max(5, Math.round(foes.reduce((n, c) => n + c.level, 0) / Math.max(1, foes.length)))

interface Entry {
  id: number
  name: string
  types: string[]
  ability: string
  moves: string[]
  win: number
  viability: number
}
const entries: Entry[] = []

for (const s of rom.species) {
  if (!s.name || /^\?+$/.test(s.name) || s.name === 'UNUSED') continue
  if (s.id < 1 || s.id > 386) continue // the classic 386-species dex
  if (isExcludedSpecies(s.name)) continue

  const bare = buildCombatant(ctx, s, { level, moves: [], source: { kind: 'tested' } })
  const pool = levelUpPool(rom.learnsets[s.id], level)
  const extra = [
    ...machinePool(rom.tmCompat[s.id], rom.tmMoves),
    ...machinePool(rom.tutorCompat[s.id], rom.tutorMoves),
  ]
  const moves = pickBestMoves(ctx, bare, pool, foes, { extra })
  const subject = buildCombatant(ctx, s, {
    level,
    moves: moves.map((m) => m.id),
    source: { kind: 'tested' },
  })

  const matchups = evaluateCohort(ctx, subject, foes)
  let winSum = 0
  matchups.forEach((_, i) => {
    winSum += simulateMany(ctx, subject, foes[i], SIMS, SEED + i * 1013).winRate
  })
  entries.push({
    id: s.id,
    name: s.name,
    types: s.type1 === s.type2 ? [tn(s.type1)] : [tn(s.type1), tn(s.type2)],
    ability: rom.abilityNames[s.ability1] ?? '',
    moves: subject.moves.map((m) => m.name),
    win: Math.round(winSum / matchups.length),
    viability: Number(viabilityScore(matchups).toFixed(2)),
  })
  if (entries.length % 25 === 0) process.stderr.write(`  …${entries.length} evaluated\n`)
}

entries.sort((a, b) => b.win - a.win || a.id - b.id)

const out = {
  rom: rom.fileName,
  level,
  sims: SIMS,
  seed: SEED,
  cohort: cohort.members.map((m) => m.group).filter((g, i, a) => a.indexOf(g) === i),
  meanWin: Math.round(entries.reduce((n, e) => n + e.win, 0) / entries.length),
  entries,
}
writeFileSync(resolve(here, 'tierlist-data.json'), JSON.stringify(out, null, 2))
console.log(`wrote scripts/tierlist-data.json`)
console.log(`  ${entries.length} species · level ${level} · ${SIMS} sims/matchup · mean ${out.meanWin}%`)
console.log(`  top: ${entries.slice(0, 5).map((e) => `${e.name} ${e.win}%`).join(', ')}`)
