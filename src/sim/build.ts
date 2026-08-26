import type { LoadedRom } from '../rom/loadRom'
import type { SpeciesInfo, SpeciesStats } from '../rom/tables/species'
import { computeStats, ivFromDifficultyByte, MAX_IV } from './statCalc'
import { toSimMove } from './effects'
import { itemNameOf } from './items'
import type { Combatant, CombatantSource, SimContext, SimMove } from './types'

/** Turn a loaded ROM into the read-only context the engine runs against. */
export function makeContext(rom: LoadedRom): SimContext {
  return {
    moves: rom.moves,
    typeChart: rom.typeChart,
    typeNames: rom.typeNames,
    abilityNames: rom.abilityNames,
    itemNames: rom.itemNames,
    speciesNames: rom.species.map((s) => s.name),
  }
}

export interface BuildOptions {
  level: number
  /** Move ids; 0/duplicates are dropped. */
  moves: number[]
  /** 1 or 2 — which of the species' two ability slots to use. */
  abilitySlot?: 1 | 2
  item?: number
  ivs?: number
  evs?: number
  /** Overrides the label the reports print. */
  label?: string
  source?: CombatantSource
  /** Overrides for a what-if run: replace the species' stats/types/ability. */
  statsOverride?: Partial<SpeciesStats>
  typesOverride?: [number, number]
  abilityOverride?: number
}

/** Resolve move ids against the ROM, dropping empty and duplicate slots. */
export function resolveMoves(ctx: SimContext, ids: readonly number[]): SimMove[] {
  const out: SimMove[] = []
  const seen = new Set<number>()
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    const info = ctx.moves[id]
    if (!info || !info.name) continue
    seen.add(id)
    out.push(toSimMove(info))
  }
  return out
}

/** Assemble one combatant from a species + a level + a moveset. */
export function buildCombatant(
  ctx: SimContext,
  species: SpeciesInfo,
  opts: BuildOptions,
): Combatant {
  const base: SpeciesStats = { ...species.stats, ...opts.statsOverride }
  const ivs = opts.ivs ?? MAX_IV
  const evs = opts.evs ?? 0
  const slot = opts.abilitySlot ?? 1
  const ability =
    opts.abilityOverride ??
    (slot === 2 && species.ability2 ? species.ability2 : species.ability1)
  const item = opts.item ?? 0
  const types: [number, number] = opts.typesOverride ?? [species.type1, species.type2]
  return {
    speciesId: species.id,
    species: species.name,
    label: opts.label ?? `${species.name} L${opts.level}`,
    level: opts.level,
    types,
    base,
    stats: computeStats(base, opts.level, ivs, evs),
    ability,
    abilityName: ctx.abilityNames[ability] ?? '',
    item,
    itemName: itemNameOf(ctx, item),
    moves: resolveMoves(ctx, opts.moves),
    ivs,
    evs,
    source: opts.source ?? { kind: 'peer' },
  }
}

export { ivFromDifficultyByte }
