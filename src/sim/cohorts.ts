import type { LoadedRom } from '../rom/loadRom'
import type { Trainer, TrainerMon } from '../rom/tables/trainers'
import type { SpeciesInfo } from '../rom/tables/species'
import { defaultMovesAtLevel } from '../rom/tables/learnsets'
import { norm } from '../lib/names'
import { buildCombatant } from './build'
import { ivFromDifficultyByte } from './statCalc'
import type { Combatant, SimContext } from './types'

/**
 * Who to measure a Pokémon *against*.
 *
 * The default cohort is the benchmark rosters — gym leaders, the Elite Four,
 * Red — read straight out of the ROM's trainer table at their real levels, so
 * "is this thing good" means "against what the game actually asks of you".
 * The band and dex cohorts exist for the other question: how it compares to
 * its peers.
 */

/** The 22 benchmark trainers, in play order, and the names to match in-ROM. */
export const BENCHMARK_TRAINERS: { label: string; keys: string[] }[] = [
  { label: 'Falkner', keys: ['FALKNER'] },
  { label: 'Bugsy', keys: ['BUGSY'] },
  { label: 'Whitney', keys: ['WHITNEY'] },
  { label: 'Morty', keys: ['MORTY'] },
  { label: 'Chuck', keys: ['CHUCK'] },
  { label: 'Jasmine', keys: ['JASMINE'] },
  { label: 'Pryce', keys: ['PRYCE'] },
  { label: 'Clair', keys: ['CLAIR', 'CLAIRE'] },
  { label: 'Brock', keys: ['BROCK'] },
  { label: 'Misty', keys: ['MISTY'] },
  { label: 'Lt. Surge', keys: ['SURGE'] },
  { label: 'Erika', keys: ['ERIKA'] },
  { label: 'Janine', keys: ['JANINE'] },
  { label: 'Sabrina', keys: ['SABRINA'] },
  { label: 'Blaine', keys: ['BLAINE'] },
  { label: 'Blue', keys: ['BLUE', 'GARY'] },
  { label: 'Will', keys: ['WILL'] },
  { label: 'Koga', keys: ['KOGA'] },
  { label: 'Bruno', keys: ['BRUNO'] },
  { label: 'Karen', keys: ['KAREN'] },
  { label: 'Lance', keys: ['LANCE'] },
  { label: 'Red', keys: ['RED'] },
]

export interface CohortMember {
  combatant: Combatant
  /** "Falkner", "peers", … — groups the report's rows. */
  group: string
}

export interface CohortResult {
  members: CohortMember[]
  warnings: string[]
}

/**
 * Trainer records for one leader. An exact name match wins outright — the ROM
 * has an ALFRED and a JARED that both *contain* "RED", and a WILLIAM that
 * contains "WILL", so a substring search alone hands you a random NPC's team.
 * The substring pass only runs when nothing matched exactly, which is what
 * catches "LT. SURGE" for the key SURGE.
 */
function matchTrainers(rom: LoadedRom, keys: readonly string[]): Trainer[] {
  const wanted = keys.map(norm)
  const named = rom.trainers.filter((t) => norm(t.name).length > 0)
  const exact = named.filter((t) => wanted.includes(norm(t.name)))
  if (exact.length > 0) return exact
  return named.filter((t) => wanted.some((k) => norm(t.name).includes(k)))
}

/** Average level of a team — the tiebreak for picking between duplicate records. */
function teamLevel(t: Trainer): number {
  if (t.party.length === 0) return 0
  return t.party.reduce((n, m) => n + m.level, 0) / t.party.length
}

/** Turn one trainer party slot into a combatant. */
function monToCombatant(
  ctx: SimContext,
  rom: LoadedRom,
  trainer: Trainer,
  mon: TrainerMon,
  ownerLabel: string,
): Combatant | null {
  const species = rom.species[mon.species]
  if (!species || !species.name) return null
  // Trainer parties carry explicit moves only when the record says so;
  // otherwise the engine fills in the level-up defaults, and so do we.
  const moves =
    trainer.hasMoves && mon.moves.some((m) => m)
      ? mon.moves
      : defaultMovesAtLevel(rom.learnsets[mon.species]?.entries ?? [], mon.level)
  return buildCombatant(ctx, species, {
    level: mon.level,
    moves,
    item: trainer.hasItems ? mon.heldItem : 0,
    ivs: ivFromDifficultyByte(mon.iv),
    evs: 0,
    label: `${ownerLabel}'s ${species.name} L${mon.level}`,
    source: { kind: 'trainer', owner: ownerLabel },
  })
}

export interface BenchmarkOptions {
  /** Only these labels (case-insensitive); empty/undefined means all of them. */
  only?: readonly string[]
  /** Use each leader's strongest (rematch) team instead of the first battle. */
  rematch?: boolean
}

/** Build the gym / Elite Four / Red cohort from the ROM's trainer table. */
export function benchmarkCohort(
  ctx: SimContext,
  rom: LoadedRom,
  opts: BenchmarkOptions = {},
): CohortResult {
  const warnings: string[] = []
  const members: CohortMember[] = []
  const multiRecord: string[] = []
  const filter = opts.only?.length ? new Set(opts.only.map(norm)) : null

  for (const entry of BENCHMARK_TRAINERS) {
    if (filter && !filter.has(norm(entry.label))) continue
    const candidates = matchTrainers(rom, entry.keys).filter((t) => t.party.length > 0)
    if (candidates.length === 0) {
      warnings.push(`No trainer record found for ${entry.label} — skipped.`)
      continue
    }
    const sorted = [...candidates].sort((a, b) => teamLevel(b) - teamLevel(a))
    const chosen = opts.rematch ? sorted[0] : sorted[sorted.length - 1]
    if (candidates.length > 1) multiRecord.push(entry.label)
    for (const mon of chosen.party) {
      const c = monToCombatant(ctx, rom, chosen, mon, entry.label)
      if (c) members.push({ combatant: c, group: entry.label })
      else warnings.push(`${entry.label}: skipped party slot with unknown species #${mon.species}.`)
    }
  }
  // Leaders usually have a story record plus one or more rematch records; say
  // once which side of that the cohort took, rather than 20 identical lines.
  if (multiRecord.length > 0) {
    warnings.push(
      `${multiRecord.length} leaders have several trainer records — used the ` +
        `${opts.rematch ? 'strongest (rematch)' : 'first-battle'} team for each ` +
        `(${multiRecord.join(', ')}).`,
    )
  }
  return { members, warnings }
}

export interface PeerOptions {
  /** Include species whose BST is within this percentage of the subject's. */
  bandPercent?: number
  level: number
  /** Species ids to exclude (the purged post-Gen-4 entries, the subject itself). */
  exclude?: ReadonlySet<number>
  /** Cap the cohort size, keeping the closest-BST entries. */
  limit?: number
  /** Only fully-evolved species (nothing evolves out of them). */
  fullyEvolvedOnly?: boolean
}

const bst = (s: SpeciesInfo): number =>
  s.stats.hp + s.stats.atk + s.stats.def + s.stats.spa + s.stats.spd + s.stats.spe

/** Species that never evolve into anything else. */
export function fullyEvolvedIds(rom: LoadedRom): Set<number> {
  const out = new Set<number>()
  rom.species.forEach((s, id) => {
    if (!s.name || /^\?+$/.test(s.name)) return
    const evos = rom.evolutions[id] ?? []
    if (!evos.some((e) => e.target > 0)) out.add(id)
  })
  return out
}

/**
 * A cohort of comparable species, each given its level-up moveset at `level`.
 * Used by `--cohort band` (BST neighbours) and `--cohort dex` (everything
 * fully evolved) — the "how does it stack up against its peers" question.
 */
export function peerCohort(
  ctx: SimContext,
  rom: LoadedRom,
  subjectId: number,
  opts: PeerOptions,
): CohortResult {
  const warnings: string[] = []
  const subject = rom.species[subjectId]
  const target = bst(subject)
  const exclude = opts.exclude ?? new Set<number>()
  const evolved = opts.fullyEvolvedOnly ? fullyEvolvedIds(rom) : null

  let pool = rom.species.filter((s) => {
    if (s.id === subjectId || exclude.has(s.id)) return false
    if (!s.name || /^\?+$/.test(s.name)) return false
    if (evolved && !evolved.has(s.id)) return false
    if (opts.bandPercent !== undefined) {
      const delta = Math.abs(bst(s) - target) / target
      if (delta > opts.bandPercent / 100) return false
    }
    return true
  })

  if (opts.limit && pool.length > opts.limit) {
    pool = [...pool]
      .sort((a, b) => Math.abs(bst(a) - target) - Math.abs(bst(b) - target))
      .slice(0, opts.limit)
    warnings.push(
      `Peer cohort capped at ${opts.limit} species (closest BST kept) — pass a higher --limit for the full set.`,
    )
  }

  const members = pool.map((s) => ({
    group: 'peers',
    combatant: buildCombatant(ctx, s, {
      level: opts.level,
      moves: defaultMovesAtLevel(rom.learnsets[s.id]?.entries ?? [], opts.level),
      label: `${s.name} L${opts.level}`,
      source: { kind: 'peer' as const },
    }),
  }))
  return { members, warnings }
}
