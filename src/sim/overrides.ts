import type { LoadedRom } from '../rom/loadRom'
import type { MoveInfo } from '../rom/tables/moves'
import type { SpeciesInfo } from '../rom/tables/species'
import { nameIndex, norm, resolveName } from '../lib/names'

/**
 * "What if this Pokémon had 20 more Sp.Atk / that move hit for 90 / it learnt
 * Earthquake?" — applied to an in-memory copy of the ROM's parsed tables, never
 * to the ROM itself. The harness runs baseline and modified side by side, so a
 * change can be judged before an `apply-*` script commits it.
 *
 * The file is name-keyed on purpose: a hand-written what-if shouldn't need
 * species ids, and a typo should fail loudly with a suggestion rather than
 * silently editing the wrong row.
 */

export interface SpeciesOverride {
  /** Any subset of hp/atk/def/spa/spd/spe, absolute values. */
  stats?: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>
  /** Type names, e.g. ["WATER", "DARK"]; one entry means a mono-type. */
  types?: string[]
  /** Ability name for slot 1. */
  ability?: string
  /** Level-up moves to add, as "LEVEL:MOVE" or just "MOVE" (⇒ level 1). */
  addMoves?: string[]
  /** Level-up moves to remove, by name. */
  removeMoves?: string[]
}

export interface MoveOverride {
  power?: number
  accuracy?: number
  pp?: number
  /** Type name. */
  type?: string
  /** Secondary-effect chance %. */
  effectAccuracy?: number
}

export interface OverrideFile {
  /** Free-text note echoed into the report so a run explains itself. */
  note?: string
  species?: Record<string, SpeciesOverride>
  moves?: Record<string, MoveOverride>
}

/** A deep-enough copy of the tables an override can touch. */
export interface OverlayRom extends LoadedRom {
  /** Human-readable list of what the overrides changed. */
  appliedOverrides: string[]
}

const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const

function cloneSpecies(s: SpeciesInfo): SpeciesInfo {
  return { ...s, stats: { ...s.stats } }
}

function parseAddMove(
  raw: string,
  moveIdx: ReadonlyMap<string, number>,
): { level: number; moveId: number } {
  const [head, tail] = raw.includes(':') ? raw.split(':', 2) : ['1', raw]
  const level = Number(head)
  if (!Number.isInteger(level) || level < 1 || level > 100) {
    throw new Error(`bad level in addMoves entry “${raw}” (expected 1–100)`)
  }
  return { level, moveId: resolveName(moveIdx, tail, 'move') }
}

/** Validate an override file's shape, throwing on anything unrecognized. */
export function validateOverrides(data: unknown): OverrideFile {
  if (typeof data !== 'object' || data === null) throw new Error('overrides must be a JSON object')
  const file = data as Record<string, unknown>
  for (const key of Object.keys(file)) {
    if (!['note', 'species', 'moves'].includes(key)) {
      throw new Error(`unknown top-level key “${key}” (expected note, species or moves)`)
    }
  }
  const speciesBlock = (file.species ?? {}) as Record<string, Record<string, unknown>>
  for (const [name, entry] of Object.entries(speciesBlock)) {
    for (const key of Object.keys(entry)) {
      if (!['stats', 'types', 'ability', 'addMoves', 'removeMoves'].includes(key)) {
        throw new Error(`species “${name}”: unknown key “${key}”`)
      }
    }
    const stats = (entry.stats ?? {}) as Record<string, unknown>
    for (const [stat, value] of Object.entries(stats)) {
      if (!(STAT_KEYS as readonly string[]).includes(stat)) {
        throw new Error(`species “${name}”: unknown stat “${stat}”`)
      }
      if (typeof value !== 'number' || value < 1 || value > 255) {
        throw new Error(`species “${name}”: ${stat} must be 1–255, got ${String(value)}`)
      }
    }
  }
  const movesBlock = (file.moves ?? {}) as Record<string, Record<string, unknown>>
  for (const [name, entry] of Object.entries(movesBlock)) {
    for (const key of Object.keys(entry)) {
      if (!['power', 'accuracy', 'pp', 'type', 'effectAccuracy'].includes(key)) {
        throw new Error(`move “${name}”: unknown key “${key}”`)
      }
    }
  }
  return file as OverrideFile
}

/**
 * Apply an override file to a *copy* of the loaded ROM's tables. The returned
 * object shares the RomBuffer (nothing writes to it) but has its own species,
 * move and learnset arrays.
 */
export function applyOverrides(rom: LoadedRom, file: OverrideFile): OverlayRom {
  const applied: string[] = []
  const species = rom.species.map(cloneSpecies)
  const moves: MoveInfo[] = rom.moves.map((m) => ({ ...m }))
  const learnsets = rom.learnsets.map((l) => ({ ...l, entries: l.entries.map((e) => ({ ...e })) }))

  const speciesIdx = nameIndex(rom.species.map((s) => s.name))
  const moveIdx = nameIndex(rom.moves.map((m) => m.name))
  const typeIdx = nameIndex(rom.typeNames)
  const abilityIdx = nameIndex(rom.abilityNames)

  for (const [name, entry] of Object.entries(file.species ?? {})) {
    const id = resolveName(speciesIdx, name, 'species')
    const target = species[id]
    for (const stat of STAT_KEYS) {
      const value = entry.stats?.[stat]
      if (value === undefined) continue
      applied.push(`${target.name} ${stat}: ${target.stats[stat]} → ${value}`)
      target.stats[stat] = value
    }
    if (entry.types) {
      const ids = entry.types.map((t) => resolveName(typeIdx, t, 'type'))
      const t1 = ids[0]
      const t2 = ids[1] ?? ids[0]
      applied.push(
        `${target.name} types: ${rom.typeNames[target.type1]}/${rom.typeNames[target.type2]} → ` +
          `${rom.typeNames[t1]}/${rom.typeNames[t2]}`,
      )
      target.type1 = t1
      target.type2 = t2
    }
    if (entry.ability) {
      const abilityId = resolveName(abilityIdx, entry.ability, 'ability')
      applied.push(
        `${target.name} ability: ${rom.abilityNames[target.ability1]} → ${rom.abilityNames[abilityId]}`,
      )
      target.ability1 = abilityId
    }
    for (const raw of entry.addMoves ?? []) {
      const { level, moveId } = parseAddMove(raw, moveIdx)
      learnsets[id].entries.push({ level, moveId })
      learnsets[id].entries.sort((a, b) => a.level - b.level)
      applied.push(`${target.name} learns ${rom.moves[moveId].name} at L${level}`)
    }
    for (const raw of entry.removeMoves ?? []) {
      const moveId = resolveName(moveIdx, raw, 'move')
      const before = learnsets[id].entries.length
      learnsets[id].entries = learnsets[id].entries.filter((e) => e.moveId !== moveId)
      if (learnsets[id].entries.length !== before) {
        applied.push(`${target.name} no longer learns ${rom.moves[moveId].name}`)
      }
    }
  }

  for (const [name, entry] of Object.entries(file.moves ?? {})) {
    const id = resolveName(moveIdx, name, 'move')
    const target = moves[id]
    if (entry.power !== undefined) {
      applied.push(`${target.name} power: ${target.power} → ${entry.power}`)
      target.power = entry.power
    }
    if (entry.accuracy !== undefined) {
      applied.push(`${target.name} accuracy: ${target.accuracy} → ${entry.accuracy}`)
      target.accuracy = entry.accuracy
    }
    if (entry.pp !== undefined) {
      applied.push(`${target.name} PP: ${target.pp} → ${entry.pp}`)
      target.pp = entry.pp
    }
    if (entry.effectAccuracy !== undefined) {
      applied.push(`${target.name} effect chance: ${target.effectAccuracy} → ${entry.effectAccuracy}`)
      target.effectAccuracy = entry.effectAccuracy
    }
    if (entry.type !== undefined) {
      const typeId = resolveName(typeIdx, entry.type, 'type')
      applied.push(`${target.name} type: ${rom.typeNames[target.type]} → ${rom.typeNames[typeId]}`)
      target.type = typeId
    }
  }

  return { ...rom, species, moves, learnsets, appliedOverrides: applied }
}

/** Parse + validate + apply, in one step. Throws with a readable message. */
export function loadOverrides(rom: LoadedRom, json: string): OverlayRom {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    throw new Error(`overrides file is not valid JSON: ${(err as Error).message}`)
  }
  return applyOverrides(rom, validateOverrides(parsed))
}

export { norm }
