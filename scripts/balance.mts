/**
 * Balance-testing harness: run a Pokémon against the benchmark rosters (or its
 * peers) and print how it actually fares — damage both ways, turns to KO, and
 * seeded Monte Carlo win rates. Read-only; the ROM is never written.
 *
 *   npx tsx scripts/balance.mts "<rom.gba>" --mon Feraligatr
 *   npx tsx scripts/balance.mts "<rom.gba>" --mon Typhlosion --gyms "Bugsy,Pryce"
 *   npx tsx scripts/balance.mts "<rom.gba>" --mon Ampharos --overrides whatif.json --html out.html
 *
 * Options
 *   --mon <name>          the Pokémon under test (required)
 *   --level <n>           its level; default: the average level of the cohort
 *   --cohort gyms|band|dex   who to fight (default gyms)
 *   --gyms "A,B"          restrict the gyms cohort to these leaders
 *   --rematch             use each leader's strongest (rematch) team
 *   --band-pct <n>        BST window for --cohort band (default 10)
 *   --limit <n>           cap a band/dex cohort's size (default 40)
 *   --moves "a,b,c,d"     force a moveset instead of picking one
 *   --tm                  let the move picker use TM/HM and tutor moves too
 *   --iv <n> --ev <n>     the tested mon's IVs / EVs per stat (default 31 / 0)
 *   --ability 1|2         which ability slot to use
 *   --item <name>         give it a held item
 *   --overrides <file>    what-if JSON; runs baseline vs modified side by side
 *   --sims <n>            battles per matchup (default 300)
 *   --seed <n>            RNG seed (default 1 — runs are reproducible)
 *   --no-mc               skip the Monte Carlo layer (matchup calculator only)
 *   --html <file>         write a standalone HTML report
 *   --json <file>         write the raw results as JSON
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { loadRom, type LoadedRom } from '../src/rom/loadRom'
import { nameIndex, norm, resolveName } from '../src/lib/names'
import { isExcludedSpecies } from './lib/excluded-species'
import {
  benchmarkCohort,
  buildCombatant,
  coverage,
  evaluateCohort,
  isUnmodeledAbility,
  isModeledItem,
  levelUpPool,
  loadOverrides,
  machinePool,
  makeContext,
  peerCohort,
  pickBestMoves,
  simulateMany,
  viabilityScore,
  type BatchResult,
  type CohortMember,
  type Combatant,
  type Matchup,
  type SimContext,
  type SimMove,
} from '../src/sim'
import { renderHtmlReport } from './lib/balance-report'

// ── argument parsing ──────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flags = new Map<string, string>()
const positional: string[] = []
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (!arg.startsWith('--')) {
    positional.push(arg)
    continue
  }
  const key = arg.slice(2)
  const next = argv[i + 1]
  if (next === undefined || next.startsWith('--')) flags.set(key, 'true')
  else {
    flags.set(key, next)
    i++
  }
}

const usage = (msg: string): never => {
  console.error(`${msg}\n\nusage: npx tsx scripts/balance.mts "<rom.gba>" --mon <name> [options]`)
  console.error('       see the header of scripts/balance.mts for the full option list')
  process.exit(2)
}

const romPath = positional[0]
if (!romPath) usage('missing ROM path')
const tomlPath = positional[1]
const monName = flags.get('mon')
if (!monName) usage('missing --mon <name>')

const num = (key: string, fallback: number): number => {
  const raw = flags.get(key)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) usage(`--${key} expects a number, got “${raw}”`)
  return value
}
const has = (key: string): boolean => flags.get(key) === 'true'
const list = (key: string): string[] =>
  (flags.get(key) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const cohortKind = flags.get('cohort') ?? 'gyms'
if (!['gyms', 'band', 'dex'].includes(cohortKind)) usage(`unknown --cohort “${cohortKind}”`)
const runMonteCarlo = !has('no-mc')
const sims = num('sims', 300)
const seed = num('seed', 1)

// ── load ──────────────────────────────────────────────────────────────────
const bytes = new Uint8Array(readFileSync(romPath))
const toml = tomlPath ? readFileSync(tomlPath, 'utf8') : undefined
const baseRom = loadRom(bytes, romPath.split(/[\\/]/).pop()!, toml)

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
}

const notes: string[] = []
const unmodeledAbilities = new Set<string>()
const unmodeledItems = new Set<string>()
for (const w of baseRom.warnings) notes.push(w)
for (const w of baseRom.typeChart.warnings) notes.push(w)
if (baseRom.typeChart.offset < 0) {
  console.error(
    c.red(
      'No type chart could be read from this ROM — every matchup would be neutral, ' +
        'which makes the results meaningless. Aborting.',
    ),
  )
  process.exit(1)
}

// ── the run ───────────────────────────────────────────────────────────────
export interface MatchupRow {
  group: string
  opponent: Combatant
  matchup: Matchup
  batch: BatchResult | null
}

export interface RunResult {
  label: string
  subject: Combatant
  rows: MatchupRow[]
  viability: number
  meanWinRate: number
  record: { wins: number; losses: number; draws: number }
  coveragePercent: number
  unmodeledMoves: string[]
}

function buildCohort(
  ctx: SimContext,
  rom: LoadedRom,
  subjectId: number,
  level: number,
): { members: CohortMember[]; warnings: string[] } {
  if (cohortKind === 'gyms') {
    return benchmarkCohort(ctx, rom, { only: list('gyms'), rematch: has('rematch') })
  }
  const exclude = new Set<number>()
  rom.species.forEach((s) => {
    if (isExcludedSpecies(s.name)) exclude.add(s.id)
  })
  return peerCohort(ctx, rom, subjectId, {
    level,
    exclude,
    bandPercent: cohortKind === 'band' ? num('band-pct', 10) : undefined,
    limit: num('limit', 40),
    fullyEvolvedOnly: cohortKind === 'dex',
  })
}

function run(rom: LoadedRom, label: string): RunResult {
  const ctx = makeContext(rom)
  const speciesIdx = nameIndex(rom.species.map((s) => s.name))
  const subjectId = resolveName(speciesIdx, monName!, 'species')
  const species = rom.species[subjectId]

  // Build the cohort first when the level isn't given — the default level is
  // the cohort's average, which is what "can it keep up" actually means.
  const provisionalLevel = num('level', 50)
  const firstPass = buildCohort(ctx, rom, subjectId, provisionalLevel)
  const level = flags.has('level')
    ? provisionalLevel
    : Math.max(
        5,
        Math.round(
          firstPass.members.reduce((n, m) => n + m.combatant.level, 0) /
            Math.max(1, firstPass.members.length),
        ),
      )
  const cohort = flags.has('level') ? firstPass : buildCohort(ctx, rom, subjectId, level)
  for (const w of cohort.warnings) if (!notes.includes(w)) notes.push(w)

  const itemId = flags.has('item')
    ? resolveName(nameIndex(rom.itemNames), flags.get('item')!, 'item')
    : 0
  const abilitySlot = num('ability', 1) === 2 ? 2 : 1
  const ivs = num('iv', 31)
  const evs = num('ev', 0)

  // A provisional build with no moves, so move selection can measure damage.
  const bare = buildCombatant(ctx, species, {
    level,
    moves: [],
    abilitySlot,
    item: itemId,
    ivs,
    evs,
    source: { kind: 'tested' },
  })

  let moves: SimMove[]
  if (flags.has('moves')) {
    // Resolved through buildCombatant so the moves carry their effects, same
    // as every other path.
    const moveIdx = nameIndex(rom.moves.map((m) => m.name))
    moves = buildCombatant(ctx, species, {
      level,
      moves: list('moves').map((name) => resolveName(moveIdx, name, 'move')),
      abilitySlot,
      item: itemId,
      ivs,
      evs,
    }).moves
  } else {
    const pool = levelUpPool(rom.learnsets[subjectId], level)
    const extra = has('tm')
      ? [
          ...machinePool(rom.tmCompat[subjectId], rom.tmMoves),
          ...machinePool(rom.tutorCompat[subjectId], rom.tutorMoves),
        ]
      : []
    moves = pickBestMoves(
      ctx,
      bare,
      pool,
      cohort.members.map((m) => m.combatant),
      { extra },
    )
  }

  const subject = buildCombatant(ctx, species, {
    level,
    moves: moves.map((m) => m.id),
    abilitySlot,
    item: itemId,
    ivs,
    evs,
    label: `${species.name} L${level}`,
    source: { kind: 'tested' },
  })

  const matchups = evaluateCohort(
    ctx,
    subject,
    cohort.members.map((m) => m.combatant),
  )
  const rows: MatchupRow[] = matchups.map((matchup, i) => ({
    group: cohort.members[i].group,
    opponent: cohort.members[i].combatant,
    matchup,
    batch: runMonteCarlo
      ? simulateMany(ctx, subject, cohort.members[i].combatant, sims, seed + i * 1013)
      : null,
  }))

  const record = rows.reduce(
    (acc, r) => {
      if (!r.batch) return acc
      acc.wins += r.batch.wins
      acc.losses += r.batch.losses
      acc.draws += r.batch.draws
      return acc
    },
    { wins: 0, losses: 0, draws: 0 },
  )
  const withBatches = rows.filter((r) => r.batch)
  const meanWinRate =
    withBatches.length === 0
      ? 0
      : withBatches.reduce((n, r) => n + r.batch!.winRate, 0) / withBatches.length

  const allMoves = [subject, ...cohort.members.map((m) => m.combatant)].flatMap((x) => x.moves)
  const cov = coverage(allMoves)

  // Ability / item caveats — aggregated, because a full cohort turns up dozens
  // of them and one line per Pokémon buries everything else.
  for (const combatant of [subject, ...cohort.members.map((m) => m.combatant)]) {
    if (isUnmodeledAbility(combatant.abilityName)) unmodeledAbilities.add(combatant.abilityName)
    if (combatant.itemName && !isModeledItem(combatant.itemName)) {
      unmodeledItems.add(combatant.itemName)
    }
  }

  return {
    label,
    subject,
    rows,
    viability: viabilityScore(matchups),
    meanWinRate,
    record,
    coveragePercent: cov.percent,
    unmodeledMoves: cov.unmodeled,
  }
}

const baseline = run(baseRom, 'baseline')

const listOf = (set: ReadonlySet<string>): string => [...set].sort().join(', ')
if (unmodeledAbilities.size > 0) {
  notes.push(`${unmodeledAbilities.size} abilities have no handler and act as no-ops: ${listOf(unmodeledAbilities)}.`)
}
if (unmodeledItems.size > 0) {
  notes.push(`${unmodeledItems.size} held items have no handler and act as no-ops: ${listOf(unmodeledItems)}.`)
}

let modified: RunResult | null = null
let overrideNotes: string[] = []
if (flags.has('overrides')) {
  const overlay = loadOverrides(baseRom, readFileSync(flags.get('overrides')!, 'utf8'))
  overrideNotes = overlay.appliedOverrides
  modified = run(overlay, 'modified')
}

// ── console output ────────────────────────────────────────────────────────
const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s.padEnd(n))
const padL = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s.padStart(n))
const pct = (n: number): string => `${n.toFixed(0)}%`
const scoreColor = (n: number): string =>
  n > 0.25 ? c.green(n.toFixed(2)) : n < -0.25 ? c.red(n.toFixed(2)) : c.yellow(n.toFixed(2))

const typeName = (id: number): string => baseRom.typeNames[id] ?? `#${id}`
const describeSubject = (s: Combatant): string => {
  const types = s.types[0] === s.types[1] ? typeName(s.types[0]) : `${typeName(s.types[0])}/${typeName(s.types[1])}`
  const st = s.stats
  return (
    `${c.bold(s.species)} L${s.level} ${c.dim(types)} · ${s.abilityName}` +
    (s.itemName ? ` @ ${s.itemName}` : '') +
    `\n  stats ${st.hp}/${st.atk}/${st.def}/${st.spa}/${st.spd}/${st.spe} (HP/Atk/Def/SpA/SpD/Spe)` +
    `\n  moves ${s.moves.map((m) => m.name).join(', ') || '(none)'}`
  )
}

console.log(c.bold(`Balance harness · ${baseRom.fileName} · ${baseRom.rom.gameCode()}`))
console.log(
  c.dim(
    `type chart 0x${baseRom.typeChart.offset.toString(16)} (${baseRom.typeChart.rows.length} rows) · ` +
      `cohort ${cohortKind} · ${runMonteCarlo ? `${sims} sims/matchup, seed ${seed}` : 'matchup calculator only'}`,
  ),
)
console.log()
console.log(describeSubject(baseline.subject))
console.log()

const header =
  pad('Opponent', 26) +
  padL('Spe', 5) +
  '  ' +
  pad('Best move', 15) +
  padL('%/turn', 8) +
  padL('TTK', 5) +
  padL('inTTK', 6) +
  padL('Score', 7) +
  (runMonteCarlo ? padL('Win%', 7) : '')
console.log(c.bold(header))
console.log(c.dim('─'.repeat(header.length)))

let lastGroup = ''
for (const row of baseline.rows) {
  if (row.group !== lastGroup) {
    lastGroup = row.group
    console.log(c.cyan(row.group))
  }
  const m = row.matchup
  const best = m.selfSide.best
  const ttk = Number.isFinite(m.selfSide.turnsToKo) ? String(m.selfSide.turnsToKo) : '—'
  const inTtk = Number.isFinite(m.foeSide.turnsToKo) ? String(m.foeSide.turnsToKo) : '—'
  const speed = m.speedTie ? '=' : m.outspeeds ? '+' : '−'
  console.log(
    '  ' +
      pad(`${row.opponent.species} L${row.opponent.level}`, 24) +
      padL(speed, 5) +
      '  ' +
      pad(best?.move.name ?? '(none)', 15) +
      padL(best ? pct(best.fraction * 100) : '—', 8) +
      padL(ttk, 5) +
      padL(inTtk, 6) +
      padL(scoreColor(m.score), 7 + 9) + // +9 for the colour escape bytes
      (runMonteCarlo ? padL(pct(row.batch!.winRate), 7) : ''),
  )
}

console.log(c.dim('─'.repeat(header.length)))
const summary = (r: RunResult): string =>
  `viability ${scoreColor(r.viability)}` +
  (runMonteCarlo
    ? ` · mean win rate ${pct(r.meanWinRate)} · ${r.record.wins}W-${r.record.losses}L-${r.record.draws}D over ${r.rows.length * sims} battles`
    : '')
console.log(summary(baseline))

if (modified) {
  console.log()
  console.log(c.bold('With overrides:'))
  for (const line of overrideNotes) console.log(c.dim(`  ${line}`))
  console.log(`  ${summary(modified)}`)
  const deltas = baseline.rows.map((row, i) => ({
    name: row.opponent.species,
    base: row.batch?.winRate ?? row.matchup.score * 50 + 50,
    mod: modified!.rows[i].batch?.winRate ?? modified!.rows[i].matchup.score * 50 + 50,
  }))
  const moved = deltas.filter((d) => Math.abs(d.mod - d.base) >= 1)
  console.log(
    `  changed ${moved.length}/${deltas.length} matchups · ` +
      `viability ${baseline.viability.toFixed(2)} → ${modified.viability.toFixed(2)} ` +
      `(${modified.viability >= baseline.viability ? '+' : ''}${(modified.viability - baseline.viability).toFixed(2)})`,
  )
  for (const d of moved.slice(0, 12)) {
    const delta = d.mod - d.base
    const arrow = delta > 0 ? c.green(`+${delta.toFixed(0)}`) : c.red(delta.toFixed(0))
    console.log(`    ${pad(d.name, 16)} ${pct(d.base)} → ${pct(d.mod)}  ${arrow}`)
  }
}

console.log()
console.log(
  c.dim(
    `move coverage ${baseline.coveragePercent}% modeled` +
      (baseline.unmodeledMoves.length
        ? ` · unmodeled: ${baseline.unmodeledMoves.slice(0, 10).join(', ')}${baseline.unmodeledMoves.length > 10 ? ` (+${baseline.unmodeledMoves.length - 10})` : ''}`
        : ''),
  ),
)
console.log(c.dim('not modeled: weather · screens · Protect/Counter · switching · natures · badge boosts'))
for (const note of notes) console.log(c.yellow(`⚠ ${note}`))

// ── file output ───────────────────────────────────────────────────────────
if (flags.has('json')) {
  const path = flags.get('json')!
  writeFileSync(
    path,
    JSON.stringify(
      {
        rom: baseRom.fileName,
        cohort: cohortKind,
        sims: runMonteCarlo ? sims : 0,
        seed,
        notes,
        overrides: overrideNotes,
        runs: [baseline, modified].filter(Boolean).map((r) => ({
          label: r!.label,
          subject: {
            species: r!.subject.species,
            level: r!.subject.level,
            stats: r!.subject.stats,
            ability: r!.subject.abilityName,
            item: r!.subject.itemName,
            moves: r!.subject.moves.map((m) => m.name),
          },
          viability: r!.viability,
          meanWinRate: r!.meanWinRate,
          record: r!.record,
          coveragePercent: r!.coveragePercent,
          rows: r!.rows.map((row) => ({
            group: row.group,
            opponent: row.opponent.species,
            level: row.opponent.level,
            score: row.matchup.score,
            bestMove: row.matchup.selfSide.best?.move.name ?? null,
            percentPerTurn: row.matchup.selfSide.percentPerTurn,
            turnsToKo: row.matchup.selfSide.turnsToKo,
            turnsToBeKod: row.matchup.foeSide.turnsToKo,
            outspeeds: row.matchup.outspeeds,
            winRate: row.batch?.winRate ?? null,
          })),
        })),
      },
      null,
      2,
    ),
    'utf8',
  )
  console.log(c.dim(`wrote ${path}`))
}

if (flags.has('html')) {
  const path = flags.get('html')!
  writeFileSync(
    path,
    renderHtmlReport({
      romName: baseRom.fileName,
      cohort: cohortKind,
      sims: runMonteCarlo ? sims : 0,
      seed,
      typeNames: baseRom.typeNames,
      notes,
      overrideNotes,
      baseline,
      modified,
    }),
    'utf8',
  )
  console.log(c.dim(`wrote ${path}`))
}

export { norm }
