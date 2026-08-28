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
  type Combatant,
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
// Each boss's own team level — the subject fights it at parity, mirroring a
// playthrough where your ace keeps pace with the badge curve (Falkner ~L11,
// Red ~L77). This isolates a mon's kit and stats from the endgame level gap
// that a single flat level would otherwise punish (a L52 Mewtwo vs a L93
// Pikachu is a level problem, not a Mewtwo problem).
const foeLevels = foes.map((c) => Math.max(5, c.level))
const loLevel = Math.min(...foeLevels)
const hiLevel = Math.max(...foeLevels)

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

const extraPoolFor = (id: number) => [
  ...machinePool(rom.tmCompat[id], rom.tmMoves),
  ...machinePool(rom.tutorCompat[id], rom.tutorMoves),
]

for (const s of rom.species) {
  if (!s.name || /^\?+$/.test(s.name) || s.name === 'UNUSED') continue
  if (s.id < 1 || s.id > 386) continue // the classic 386-species dex
  if (isExcludedSpecies(s.name)) continue

  // Pick the moveset once, at the endgame level — the pool a mon settles into
  // (its best four barely change across the L11–L77 band once it's evolved),
  // and the build that faces the bulk of the hard fights. Then rebuild the same
  // four moves at each boss's level, so only stats scale per matchup — far
  // cheaper than re-picking at every level, with effectively identical results.
  const bare = buildCombatant(ctx, s, { level: hiLevel, moves: [], source: { kind: 'tested' } })
  const moveIds = pickBestMoves(ctx, bare, levelUpPool(rom.learnsets[s.id], hiLevel), foes, {
    extra: extraPoolFor(s.id),
  }).map((m) => m.id)

  const atLevel = new Map<number, Combatant>()
  const subjectAt = (lvl: number): Combatant => {
    let c = atLevel.get(lvl)
    if (!c) {
      c = buildCombatant(ctx, s, { level: lvl, moves: moveIds, source: { kind: 'tested' } })
      atLevel.set(lvl, c)
    }
    return c
  }

  // Simulate every boss at level parity, and collect per-matchup for viability.
  const matchups = foes.map((foe, i) => evaluateCohort(ctx, subjectAt(foeLevels[i]), [foe])[0])
  let winSum = 0
  foes.forEach((foe, i) => {
    winSum += simulateMany(ctx, subjectAt(foeLevels[i]), foe, SIMS, SEED + i * 1013).winRate
  })

  entries.push({
    id: s.id,
    name: s.name,
    types: s.type1 === s.type2 ? [tn(s.type1)] : [tn(s.type1), tn(s.type2)],
    ability: rom.abilityNames[s.ability1] ?? '',
    moves: subjectAt(hiLevel).moves.map((m) => m.name),
    win: Math.round(winSum / foes.length),
    viability: Number(viabilityScore(matchups).toFixed(2)),
  })
  if (entries.length % 25 === 0) process.stderr.write(`  …${entries.length} evaluated\n`)
}

entries.sort((a, b) => b.win - a.win || a.id - b.id)

const out = {
  rom: rom.fileName,
  levelModel: 'parity', // each mon fights every boss at that boss's team level
  levelLo: loLevel,
  levelHi: hiLevel,
  sims: SIMS,
  seed: SEED,
  cohort: cohort.members.map((m) => m.group).filter((g, i, a) => a.indexOf(g) === i),
  meanWin: Math.round(entries.reduce((n, e) => n + e.win, 0) / entries.length),
  entries,
}
writeFileSync(resolve(here, 'tierlist-data.json'), JSON.stringify(out, null, 2))
console.log(`wrote scripts/tierlist-data.json`)
console.log(`  ${entries.length} species · level parity ${loLevel}–${hiLevel} · ${SIMS} sims/matchup · mean ${out.meanWin}%`)
console.log(`  top: ${entries.slice(0, 8).map((e) => `${e.name} ${e.win}%`).join(', ')}`)
