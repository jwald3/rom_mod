import { RomBuffer } from './buffer'
import { type AnchorMap, VANILLA_BPRE, HS_BPEE } from './anchors'
import { anchorsFromToml } from './hmaToml'
import { readSpecies, readTypeNames, readAbilityNames, type SpeciesInfo } from './tables/species'
import { readMoves, type MoveInfo } from './tables/moves'
import { readAllLearnsets, type Learnset } from './tables/learnsets'
import { readMoveIdTable, readAllCompat } from './tables/compat'
import { readAllWildAreas, type WildArea } from './tables/wild'
import { readAllEvolutions, readItemNames, type Evolution } from './tables/evolutions'
import { readAllTrainers, readTrainerClassNames, type Trainer } from './tables/trainers'
import { readPrizeLists, emptyPrizeLists, type PrizeKind, type PrizeList } from './tables/gameCorner'
import { readShops, type Shop } from './tables/shops'
import { readIngameTrades, type IngameTrade } from './tables/ingameTrades'
import { readEggMoves, type EggMoveTable } from './tables/eggMoves'
import { readTypeChart, type TypeChart } from './tables/typeChart'

export interface LoadedRom {
  fileName: string
  rom: RomBuffer
  anchors: AnchorMap
  anchorSource: 'toml' | 'vanilla'
  species: SpeciesInfo[]
  moves: MoveInfo[]
  typeNames: string[]
  /** Non-neutral type matchups; backs the balance simulator's damage math. */
  typeChart: TypeChart
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
  /** NPC trainers and their teams. */
  trainers: Trainer[]
  trainerClassNames: string[]
  /** Celadon Game Corner prize lists (Pokémon / TM / item). */
  prizeLists: Record<PrizeKind, PrizeList>
  /** False when the ROM has no Celadon Game Corner (e.g. Emerald/H&S) → hide the Prizes editor. */
  gameCornerAvailable: boolean
  /** Poké Mart shops (item lists) found in the map scripts. */
  shops: Shop[]
  /** NPC trade offers (`gIngameTrades`); empty when the profile has no anchor. */
  ingameTrades: IngameTrade[]
  /** Egg moves per species id; empty when the profile has no anchor. */
  eggMoves: EggMoveTable
  warnings: string[]
}

export function loadRom(bytes: Uint8Array, fileName: string, tomlText?: string): LoadedRom {
  const rom = new RomBuffer(bytes)
  const warnings: string[] = []

  const code = rom.gameCode()
  // Pick the built-in table profile by game code. BPEE selects the Heart & Soul
  // (pokeemerald-expansion) map; anything else falls back to vanilla FireRed.
  const isEmerald = code === 'BPEE'
  const profile = isEmerald ? HS_BPEE : VANILLA_BPRE
  if (code !== 'BPRE' && code !== 'BPEE') {
    warnings.push(
      `Game code is “${code}”, expected BPRE (FireRed) or BPEE (Emerald). Table offsets may be wrong.`,
    )
  }

  let anchors: AnchorMap = { ...profile }
  let anchorSource: 'toml' | 'vanilla' = 'vanilla'
  if (tomlText !== undefined) {
    const { anchors: fromToml, found } = anchorsFromToml(tomlText)
    if (found.length > 0) {
      // The HMA sidecar can be stale (H&S's describes the vanilla struct sizes),
      // so it only overrides addresses/counts — the built-in profile keeps
      // struct strides like baseStatsLen.
      anchors = { ...anchors, ...fromToml }
      anchorSource = 'toml'
    } else if (!isEmerald) {
      warnings.push('The .toml sidecar contained no recognizable anchors — using vanilla offsets.')
    }
  } else if (!isEmerald) {
    warnings.push(
      'No HMA .toml sidecar loaded — using vanilla FireRed offsets. ' +
        'If your mod repointed tables, names and movesets may look wrong.',
    )
  }

  const species = readSpecies(rom, anchors)
  const moves = readMoves(rom, anchors)
  const typeNames = readTypeNames(rom, anchors)
  const typeChart = readTypeChart(rom, anchors)
  const abilityNames = readAbilityNames(rom, anchors)
  const learnsets = readAllLearnsets(rom, anchors)
  const tmMoves = readMoveIdTable(rom, anchors.tms, anchors.tmCount)
  const tutorMoves = readMoveIdTable(rom, anchors.tutors, anchors.tutorCount)
  const tmCompat = readAllCompat(rom, anchors.tmCompat, anchors.speciesCount, anchors.tmCount)
  const tutorCompat = readAllCompat(rom, anchors.tutorCompat, anchors.speciesCount, anchors.tutorCount)
  const wildAreas = readAllWildAreas(rom, anchors)
  const evolutions = readAllEvolutions(rom, anchors)
  const itemNames = readItemNames(rom, anchors)
  const trainers = readAllTrainers(rom, anchors)
  const trainerClassNames = readTrainerClassNames(rom, anchors)
  // The Celadon Game Corner is FireRed-specific; anchors set multichoice/gcScript
  // to 0 (e.g. Emerald/H&S) when it isn't present. Skip the parse entirely there —
  // reading offset 0 would only yield read-only stubs and a misleading warning.
  const gcAvailable = anchors.multichoice !== 0 && anchors.gcScript !== 0
  const prizeLists = gcAvailable ? readPrizeLists(rom, anchors) : emptyPrizeLists()
  const shops = readShops(rom, anchors)
  const ingameTrades = readIngameTrades(rom, anchors)
  const eggMoves = readEggMoves(rom, anchors)

  if (gcAvailable) {
    const gcUnsupported = (['pokemon', 'tm', 'item'] as PrizeKind[]).filter(
      (k) => !prizeLists[k].regenerable,
    )
    if (gcUnsupported.length > 0) {
      warnings.push(
        `Game Corner ${gcUnsupported.join('/')} prize layout not recognized — that editor will be read-only.`,
      )
    }
  }

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
    typeChart,
    abilityNames,
    learnsets,
    tmMoves,
    tutorMoves,
    tmCompat,
    tutorCompat,
    wildAreas,
    evolutions,
    itemNames,
    trainers,
    trainerClassNames,
    prizeLists,
    gameCornerAvailable: gcAvailable,
    shops,
    ingameTrades,
    eggMoves,
    warnings,
  }
}
