import { RomBuffer } from './buffer'
import { type AnchorMap, VANILLA_BPRE } from './anchors'
import { anchorsFromToml } from './hmaToml'
import { readSpecies, readTypeNames, readAbilityNames, type SpeciesInfo } from './tables/species'
import { readMoves, type MoveInfo } from './tables/moves'
import { readAllLearnsets, type Learnset } from './tables/learnsets'
import { readMoveIdTable, readAllCompat } from './tables/compat'
import { readAllWildAreas, type WildArea } from './tables/wild'
import { readAllEvolutions, readItemNames, type Evolution } from './tables/evolutions'
import { readAllTrades, type Trade } from './tables/trades'

export interface LoadedRom {
  fileName: string
  rom: RomBuffer
  anchors: AnchorMap
  anchorSource: 'toml' | 'vanilla'
  species: SpeciesInfo[]
  moves: MoveInfo[]
  typeNames: string[]
  abilityNames: string[]
  learnsets: Learnset[]
  /** Move ids of TM01–50 + HM01–08 / the 15 tutors. */
  tmMoves: number[]
  tutorMoves: number[]
  /** Per species: one flag per TM/HM or tutor slot. */
  tmCompat: boolean[][]
  tutorCompat: boolean[][]
  wildAreas: WildArea[]
  /** Outgoing evolutions per species. */
  evolutions: Evolution[][]
  itemNames: string[]
  /** In-game NPC trades. */
  trades: Trade[]
  warnings: string[]
}

export function loadRom(bytes: Uint8Array, fileName: string, tomlText?: string): LoadedRom {
  const rom = new RomBuffer(bytes)
  const warnings: string[] = []

  const code = rom.gameCode()
  if (code !== 'BPRE') {
    warnings.push(`Game code is “${code}”, expected BPRE (FireRed US). Table offsets may be wrong.`)
  }

  let anchors: AnchorMap = { ...VANILLA_BPRE }
  let anchorSource: 'toml' | 'vanilla' = 'vanilla'
  if (tomlText !== undefined) {
    const { anchors: fromToml, found } = anchorsFromToml(tomlText)
    if (found.length > 0) {
      anchors = { ...anchors, ...fromToml }
      anchorSource = 'toml'
    } else {
      warnings.push('The .toml sidecar contained no recognizable anchors — using vanilla offsets.')
    }
  } else {
    warnings.push(
      'No HMA .toml sidecar loaded — using vanilla FireRed offsets. ' +
        'If your mod repointed tables, names and movesets may look wrong.',
    )
  }

  const species = readSpecies(rom, anchors)
  const moves = readMoves(rom, anchors)
  const typeNames = readTypeNames(rom, anchors)
  const abilityNames = readAbilityNames(rom, anchors)
  const learnsets = readAllLearnsets(rom, anchors)
  const tmMoves = readMoveIdTable(rom, anchors.tms, anchors.tmCount)
  const tutorMoves = readMoveIdTable(rom, anchors.tutors, anchors.tutorCount)
  const tmCompat = readAllCompat(rom, anchors.tmCompat, anchors.speciesCount, anchors.tmCount)
  const tutorCompat = readAllCompat(rom, anchors.tutorCompat, anchors.speciesCount, anchors.tutorCount)
  const wildAreas = readAllWildAreas(rom, anchors)
  const evolutions = readAllEvolutions(rom, anchors)
  const itemNames = readItemNames(rom, anchors)
  const trades = readAllTrades(rom, anchors)

  if (species[1]?.name !== 'BULBASAUR') {
    warnings.push(
      `Sanity check failed: species #1 decodes to “${species[1]?.name}”, expected BULBASAUR. ` +
        'Table locations are probably wrong for this ROM.',
    )
  }

  return {
    fileName,
    rom,
    anchors,
    anchorSource,
    species,
    moves,
    typeNames,
    abilityNames,
    learnsets,
    tmMoves,
    tutorMoves,
    tmCompat,
    tutorCompat,
    wildAreas,
    evolutions,
    itemNames,
    trades,
    warnings,
  }
}
