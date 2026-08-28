import { create } from 'zustand'
import { entriesEqual, type Learnset, type LearnsetEntry } from '../rom/tables/learnsets'
import { flagsEqual, moveIdsEqual } from '../rom/tables/compat'
import {
  parseWildKey,
  wildGroupsEqual,
  wildKey,
  WILD_KINDS,
  type WildGroupEdit,
  type WildKind,
} from '../rom/tables/wild'
import { evosEqual, type Evolution } from '../rom/tables/evolutions'
import type { SpeciesInfo } from '../rom/tables/species'
import type { BaseStatsEdit } from '../rom/writer'
import { trainersEqual, trainerToEdit, type TrainerEdit } from '../rom/tables/trainers'
import { prizesEqual, PRIZE_KINDS, type Prize, type PrizeKind } from '../rom/tables/gameCorner'
import { shopsEqual } from '../rom/tables/shops'
import type { LoadedRom } from '../rom/loadRom'
import { useRomStore } from './romStore'

/**
 * Draft edits layered over the loaded ROM: learnsets plus TM/HM and tutor
 * compatibility rows. A species has a draft only once it's been touched;
 * "dirty" means the draft differs from the original. Undo/redo is one shared
 * stack of tagged before/after snapshots (all payloads are tiny).
 */

export type CompatField = 'tm' | 'tutor'

export type EditRecord =
  | { field: 'learnset'; species: number; prev: LearnsetEntry[]; next: LearnsetEntry[] }
  | { field: 'tm'; species: number; prev: boolean[]; next: boolean[] }
  | { field: 'tutor'; species: number; prev: boolean[]; next: boolean[] }
  /** The global tutor move-id list (which move each tutor slot teaches). species unused (0). */
  | { field: 'tutor-moves'; species: number; prev: number[]; next: number[] }
  | { field: 'evo'; species: number; prev: Evolution[]; next: Evolution[] }
  | { field: 'base-stats'; species: number; prev: BaseStatsEdit; next: BaseStatsEdit }
  /** species carries the wild area index so undo can jump to it. */
  | { field: 'wild'; species: number; key: string; prev: WildGroupEdit; next: WildGroupEdit }
  /** species carries the trainer index so undo can jump to it. */
  | { field: 'trainer'; species: number; prev: TrainerEdit; next: TrainerEdit }
  /** Game Corner prize list; species is unused (0). */
  | { field: 'gamecorner'; species: number; kind: PrizeKind; prev: Prize[]; next: Prize[] }
  /** Poké Mart shop; species carries the shop's command offset for jump-on-undo. */
  | { field: 'shop'; species: number; cmdOffset: number; prev: number[]; next: number[] }

const MAX_UNDO = 200
const MAX_RECENT = 8

interface EditStore {
  drafts: Record<number, LearnsetEntry[]>
  tmDrafts: Record<number, boolean[]>
  tutorDrafts: Record<number, boolean[]>
  /** The global tutor move-id list draft, or null when unmodified. */
  tutorMovesDraft: number[] | null
  /** Keyed by wildKey(areaIndex, kind). */
  wildDrafts: Record<string, WildGroupEdit>
  evoDrafts: Record<number, Evolution[]>
  /** Base stats / types / abilities drafts, keyed by species id. */
  baseStatsDrafts: Record<number, BaseStatsEdit>
  /** Keyed by trainer index. */
  trainerDrafts: Record<number, TrainerEdit>
  /** Game Corner prize drafts, keyed by list kind. */
  gcDrafts: Partial<Record<PrizeKind, Prize[]>>
  /** Poké Mart shop drafts, keyed by the shop's command offset. */
  shopDrafts: Record<number, number[]>
  undoStack: EditRecord[]
  redoStack: EditRecord[]
  clipboard: LearnsetEntry[] | null
  recentMoves: number[]

  /** Replace a species' learnset (records an undo step). No-op if unchanged. */
  apply(species: number, next: LearnsetEntry[]): void
  /** Replace a species' TM/HM or tutor flags (records an undo step). No-op if unchanged. */
  applyCompat(field: CompatField, species: number, next: boolean[]): void
  /** Replace the global tutor move-id list (records an undo step). No-op if unchanged. */
  applyTutorMoves(next: number[]): void
  /** Replace one wild encounter group (records an undo step). No-op if unchanged. */
  applyWild(areaIndex: number, kind: WildKind, next: WildGroupEdit): void
  /** Replace a species' evolution list (records an undo step). No-op if unchanged. */
  applyEvos(species: number, next: Evolution[]): void
  /** Replace a species' base stats / types / abilities (records an undo step). No-op if unchanged. */
  applyBaseStats(species: number, next: BaseStatsEdit): void
  /** Replace an NPC trainer (records an undo step). No-op if unchanged. */
  applyTrainer(index: number, next: TrainerEdit): void
  /** Replace a Game Corner prize list (records an undo step). No-op if unchanged. */
  applyGameCorner(kind: PrizeKind, next: Prize[]): void
  /** Replace a Poké Mart shop's item list (records an undo step). No-op if unchanged. */
  applyShop(cmdOffset: number, next: number[]): void
  /** Returns the applied record (for selection jump), or null. */
  undo(): EditRecord | null
  redo(): EditRecord | null
  /** Restore learnset + compat rows to ROM state (each an undoable step). */
  revert(species: number): void
  /** Restore all of an area's encounter groups to ROM state. */
  revertWild(areaIndex: number): void
  /** Restore an NPC trainer to ROM state. */
  revertTrainer(index: number): void
  copy(species: number): void
  paste(species: number): void
  noteRecentMove(moveId: number): void
  reset(): void
}

function originalEntries(species: number): LearnsetEntry[] {
  return useRomStore.getState().loaded?.learnsets[species]?.entries ?? []
}

function originalFlags(field: CompatField, species: number): boolean[] {
  const loaded = useRomStore.getState().loaded
  const table = field === 'tm' ? loaded?.tmCompat : loaded?.tutorCompat
  return table?.[species] ?? []
}

function originalTutorMoves(): number[] {
  return useRomStore.getState().loaded?.tutorMoves ?? []
}

/** Current tutor move-id list: draft if present, else the ROM original. */
export function effectiveTutorMoves(draft: number[] | null, loaded: LoadedRom): number[] {
  return draft ?? loaded.tutorMoves
}

/** True when the tutor move-id draft differs from the ROM. */
export function isTutorMovesDirty(draft: number[] | null, loaded: LoadedRom): boolean {
  return draft !== null && !moveIdsEqual(draft, loaded.tutorMoves)
}

/** A species' base stats / types / abilities as an editable draft. */
export function speciesToBaseStats(s: SpeciesInfo): BaseStatsEdit {
  return {
    stats: { ...s.stats },
    type1: s.type1,
    type2: s.type2,
    ability1: s.ability1,
    ability2: s.ability2,
  }
}

export function baseStatsEqual(a: BaseStatsEdit, b: BaseStatsEdit): boolean {
  return (
    a.type1 === b.type1 &&
    a.type2 === b.type2 &&
    a.ability1 === b.ability1 &&
    a.ability2 === b.ability2 &&
    (Object.keys(a.stats) as (keyof BaseStatsEdit['stats'])[]).every(
      (k) => a.stats[k] === b.stats[k],
    )
  )
}

function originalBaseStats(species: number): BaseStatsEdit {
  const s = useRomStore.getState().loaded?.species?.[species]
  return s
    ? speciesToBaseStats(s)
    : { stats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, type1: 0, type2: 0, ability1: 0, ability2: 0 }
}

/** Effective (draft-or-ROM) base-stats edit for a species. */
export function effectiveBaseStats(
  drafts: Record<number, BaseStatsEdit>,
  loaded: LoadedRom,
  species: number,
): BaseStatsEdit {
  return drafts[species] ?? speciesToBaseStats(loaded.species[species])
}

/** Species whose base-stats drafts differ from the ROM. */
export function computeBaseStatsDirtySet(
  drafts: Record<number, BaseStatsEdit>,
  loaded: LoadedRom,
): Set<number> {
  const dirty = new Set<number>()
  for (const key of Object.keys(drafts)) {
    const species = Number(key)
    if (!baseStatsEqual(drafts[species], speciesToBaseStats(loaded.species[species]))) {
      dirty.add(species)
    }
  }
  return dirty
}

function originalEvos(species: number): Evolution[] {
  return useRomStore.getState().loaded?.evolutions[species] ?? []
}

function originalWild(key: string): WildGroupEdit | null {
  const { areaIndex, kind } = parseWildKey(key)
  const group = useRomStore.getState().loaded?.wildAreas[areaIndex]?.groups[kind]
  return group ? { rate: group.rate, slots: group.slots } : null
}

function originalTrainer(index: number): TrainerEdit | null {
  const trainer = useRomStore.getState().loaded?.trainers[index]
  return trainer ? trainerToEdit(trainer) : null
}

function originalPrizes(kind: PrizeKind): Prize[] {
  return useRomStore.getState().loaded?.prizeLists[kind]?.entries ?? []
}

/** Current prize list for a kind: draft if present, else the ROM original. */
export function effectivePrizes(
  gcDrafts: Partial<Record<PrizeKind, Prize[]>>,
  loaded: LoadedRom,
  kind: PrizeKind,
): Prize[] {
  return gcDrafts[kind] ?? loaded.prizeLists[kind]?.entries ?? []
}

/** Prize-list kinds whose drafts differ from the ROM. */
export function computeGcDirty(
  gcDrafts: Partial<Record<PrizeKind, Prize[]>>,
  loaded: LoadedRom,
): Set<PrizeKind> {
  const dirty = new Set<PrizeKind>()
  for (const kind of PRIZE_KINDS) {
    const draft = gcDrafts[kind]
    if (draft && !prizesEqual(draft, loaded.prizeLists[kind]?.entries ?? [])) dirty.add(kind)
  }
  return dirty
}

function originalShop(cmdOffset: number): number[] {
  return useRomStore.getState().loaded?.shops.find((s) => s.cmdOffset === cmdOffset)?.items ?? []
}

/** Current item list for a shop: draft if present, else the ROM original. */
export function effectiveShop(
  shopDrafts: Record<number, number[]>,
  loaded: LoadedRom,
  cmdOffset: number,
): number[] {
  return shopDrafts[cmdOffset] ?? loaded.shops.find((s) => s.cmdOffset === cmdOffset)?.items ?? []
}

/** Shop command-offsets whose drafts differ from the ROM. */
export function computeShopDirty(
  shopDrafts: Record<number, number[]>,
  loaded: LoadedRom,
): Set<number> {
  const dirty = new Set<number>()
  for (const key of Object.keys(shopDrafts)) {
    const cmd = Number(key)
    const orig = loaded.shops.find((s) => s.cmdOffset === cmd)?.items ?? []
    if (!shopsEqual(shopDrafts[cmd], orig)) dirty.add(cmd)
  }
  return dirty
}

/** Current entries for a species: draft if present, else ROM original. */
export function effectiveEntries(
  drafts: Record<number, LearnsetEntry[]>,
  learnsets: Learnset[],
  species: number,
): LearnsetEntry[] {
  return drafts[species] ?? learnsets[species]?.entries ?? []
}

/** Species ids whose learnset drafts differ from the ROM. */
export function computeDirtySet(
  drafts: Record<number, LearnsetEntry[]>,
  learnsets: Learnset[],
): Set<number> {
  const dirty = new Set<number>()
  for (const key of Object.keys(drafts)) {
    const species = Number(key)
    if (!entriesEqual(drafts[species], learnsets[species]?.entries ?? [])) dirty.add(species)
  }
  return dirty
}

/** Species ids whose compat drafts differ from the ROM rows. */
export function computeCompatDirtySet(
  drafts: Record<number, boolean[]>,
  originals: boolean[][],
): Set<number> {
  const dirty = new Set<number>()
  for (const key of Object.keys(drafts)) {
    const species = Number(key)
    if (!flagsEqual(drafts[species], originals[species] ?? [])) dirty.add(species)
  }
  return dirty
}

/** Species with dirty evolution lists. */
export function computeEvoDirtySet(
  evoDrafts: Record<number, Evolution[]>,
  loaded: LoadedRom,
): Set<number> {
  const dirty = new Set<number>()
  for (const key of Object.keys(evoDrafts)) {
    const species = Number(key)
    if (!evosEqual(evoDrafts[species], loaded.evolutions[species] ?? [])) dirty.add(species)
  }
  return dirty
}

/** Trainer indexes whose drafts differ from the ROM. */
export function computeTrainerDirtySet(
  trainerDrafts: Record<number, TrainerEdit>,
  loaded: LoadedRom,
): Set<number> {
  const dirty = new Set<number>()
  for (const key of Object.keys(trainerDrafts)) {
    const index = Number(key)
    const orig = loaded.trainers[index]
    if (!orig || !trainersEqual(trainerDrafts[index], trainerToEdit(orig))) dirty.add(index)
  }
  return dirty
}

/** Effective (draft-or-ROM) trainer edit for an index. */
export function effectiveTrainer(
  trainerDrafts: Record<number, TrainerEdit>,
  loaded: LoadedRom,
  index: number,
): TrainerEdit | null {
  return trainerDrafts[index] ?? (loaded.trainers[index] ? trainerToEdit(loaded.trainers[index]) : null)
}

/** Union of learnset + TM + tutor + evolution dirty species. */
export function computeAllDirty(
  s: Pick<EditStore, 'drafts' | 'tmDrafts' | 'tutorDrafts' | 'evoDrafts' | 'baseStatsDrafts'>,
  loaded: LoadedRom,
): Set<number> {
  const dirty = computeDirtySet(s.drafts, loaded.learnsets)
  for (const sp of computeCompatDirtySet(s.tmDrafts, loaded.tmCompat)) dirty.add(sp)
  for (const sp of computeCompatDirtySet(s.tutorDrafts, loaded.tutorCompat)) dirty.add(sp)
  for (const sp of computeEvoDirtySet(s.evoDrafts, loaded)) dirty.add(sp)
  for (const sp of computeBaseStatsDirtySet(s.baseStatsDrafts, loaded)) dirty.add(sp)
  return dirty
}

/** Dirty wild-group keys (wildKey format). */
export function computeWildDirtyKeys(
  wildDrafts: Record<string, WildGroupEdit>,
  loaded: LoadedRom,
): Set<string> {
  const dirty = new Set<string>()
  for (const key of Object.keys(wildDrafts)) {
    const orig = originalWildFrom(loaded, key)
    if (!orig || !wildGroupsEqual(wildDrafts[key], orig)) dirty.add(key)
  }
  return dirty
}

/** Area indexes with any dirty wild group. */
export function computeWildDirtyAreas(
  wildDrafts: Record<string, WildGroupEdit>,
  loaded: LoadedRom,
): Set<number> {
  const areas = new Set<number>()
  for (const key of computeWildDirtyKeys(wildDrafts, loaded)) {
    areas.add(parseWildKey(key).areaIndex)
  }
  return areas
}

function originalWildFrom(loaded: LoadedRom, key: string): WildGroupEdit | null {
  const { areaIndex, kind } = parseWildKey(key)
  const group = loaded.wildAreas[areaIndex]?.groups[kind]
  return group ? { rate: group.rate, slots: group.slots } : null
}

/** Every species that appears in at least one wild slot (drafts included). */
export function computeWildSpeciesPresence(
  wildDrafts: Record<string, WildGroupEdit>,
  loaded: LoadedRom,
): Set<number> {
  const present = new Set<number>()
  for (const area of loaded.wildAreas) {
    for (const kind of WILD_KINDS) {
      const group = effectiveWildGroup(wildDrafts, loaded, area.index, kind)
      if (!group) continue
      for (const slot of group.slots) present.add(slot.species)
    }
  }
  return present
}

/** Effective (draft-or-ROM) wild group for an area/kind. */
export function effectiveWildGroup(
  wildDrafts: Record<string, WildGroupEdit>,
  loaded: LoadedRom,
  areaIndex: number,
  kind: WildKind,
): WildGroupEdit | null {
  return wildDrafts[wildKey(areaIndex, kind)] ?? originalWildFrom(loaded, wildKey(areaIndex, kind))
}

/** Store the new learnset draft, dropping it entirely if it matches the original. */
function draftsWith(
  drafts: Record<number, LearnsetEntry[]>,
  species: number,
  entries: LearnsetEntry[],
): Record<number, LearnsetEntry[]> {
  const next = { ...drafts }
  if (entriesEqual(entries, originalEntries(species))) delete next[species]
  else next[species] = entries
  return next
}

function compatDraftsWith(
  field: CompatField,
  drafts: Record<number, boolean[]>,
  species: number,
  flags: boolean[],
): Record<number, boolean[]> {
  const next = { ...drafts }
  if (flagsEqual(flags, originalFlags(field, species))) delete next[species]
  else next[species] = flags
  return next
}

function wildDraftsWith(
  drafts: Record<string, WildGroupEdit>,
  key: string,
  group: WildGroupEdit,
): Record<string, WildGroupEdit> {
  const next = { ...drafts }
  const orig = originalWild(key)
  if (orig && wildGroupsEqual(group, orig)) delete next[key]
  else next[key] = group
  return next
}

function evoDraftsWith(
  drafts: Record<number, Evolution[]>,
  species: number,
  evos: Evolution[],
): Record<number, Evolution[]> {
  const next = { ...drafts }
  if (evosEqual(evos, originalEvos(species))) delete next[species]
  else next[species] = evos
  return next
}

function baseStatsDraftsWith(
  drafts: Record<number, BaseStatsEdit>,
  species: number,
  edit: BaseStatsEdit,
): Record<number, BaseStatsEdit> {
  const next = { ...drafts }
  if (baseStatsEqual(edit, originalBaseStats(species))) delete next[species]
  else next[species] = edit
  return next
}

function trainerDraftsWith(
  drafts: Record<number, TrainerEdit>,
  index: number,
  edit: TrainerEdit,
): Record<number, TrainerEdit> {
  const next = { ...drafts }
  const orig = originalTrainer(index)
  if (orig && trainersEqual(edit, orig)) delete next[index]
  else next[index] = edit
  return next
}

function gcDraftsWith(
  drafts: Partial<Record<PrizeKind, Prize[]>>,
  kind: PrizeKind,
  prizes: Prize[],
): Partial<Record<PrizeKind, Prize[]>> {
  const next = { ...drafts }
  if (prizesEqual(prizes, originalPrizes(kind))) delete next[kind]
  else next[kind] = prizes
  return next
}

function shopDraftsWith(
  drafts: Record<number, number[]>,
  cmdOffset: number,
  items: number[],
): Record<number, number[]> {
  const next = { ...drafts }
  if (shopsEqual(items, originalShop(cmdOffset))) delete next[cmdOffset]
  else next[cmdOffset] = items
  return next
}

export const useEditStore = create<EditStore>((set, get) => {
  /** Partial state applying `value` as the draft for the record's field/species. */
  function patch(
    record: EditRecord,
    value: LearnsetEntry[] | boolean[] | WildGroupEdit | Evolution[] | TrainerEdit | Prize[] | number[] | BaseStatsEdit,
  ): Partial<EditStore> {
    const s = get()
    if (record.field === 'learnset') {
      return { drafts: draftsWith(s.drafts, record.species, value as LearnsetEntry[]) }
    }
    if (record.field === 'tm') {
      return { tmDrafts: compatDraftsWith('tm', s.tmDrafts, record.species, value as boolean[]) }
    }
    if (record.field === 'tutor') {
      return { tutorDrafts: compatDraftsWith('tutor', s.tutorDrafts, record.species, value as boolean[]) }
    }
    if (record.field === 'tutor-moves') {
      const moves = value as number[]
      return { tutorMovesDraft: moveIdsEqual(moves, originalTutorMoves()) ? null : moves }
    }
    if (record.field === 'evo') {
      return { evoDrafts: evoDraftsWith(s.evoDrafts, record.species, value as Evolution[]) }
    }
    if (record.field === 'base-stats') {
      return { baseStatsDrafts: baseStatsDraftsWith(s.baseStatsDrafts, record.species, value as BaseStatsEdit) }
    }
    if (record.field === 'trainer') {
      return { trainerDrafts: trainerDraftsWith(s.trainerDrafts, record.species, value as TrainerEdit) }
    }
    if (record.field === 'gamecorner') {
      return { gcDrafts: gcDraftsWith(s.gcDrafts, record.kind, value as Prize[]) }
    }
    if (record.field === 'shop') {
      return { shopDrafts: shopDraftsWith(s.shopDrafts, record.cmdOffset, value as number[]) }
    }
    return { wildDrafts: wildDraftsWith(s.wildDrafts, record.key, value as WildGroupEdit) }
  }

  function push(record: EditRecord): void {
    const { undoStack } = get()
    set({
      ...patch(record, record.next),
      undoStack: [...undoStack.slice(-(MAX_UNDO - 1)), record],
      redoStack: [],
    })
  }

  return {
    drafts: {},
    tmDrafts: {},
    tutorDrafts: {},
    tutorMovesDraft: null,
    wildDrafts: {},
    evoDrafts: {},
    baseStatsDrafts: {},
    trainerDrafts: {},
    gcDrafts: {},
    shopDrafts: {},
    undoStack: [],
    redoStack: [],
    clipboard: null,
    recentMoves: [],

    apply(species, next) {
      const prev = get().drafts[species] ?? originalEntries(species)
      if (entriesEqual(prev, next)) return
      push({ field: 'learnset', species, prev, next })
    },

    applyCompat(field, species, next) {
      const s = get()
      const drafts = field === 'tm' ? s.tmDrafts : s.tutorDrafts
      const prev = drafts[species] ?? originalFlags(field, species)
      if (flagsEqual(prev, next)) return
      push({ field, species, prev, next })
    },

    applyTutorMoves(next) {
      const prev = get().tutorMovesDraft ?? originalTutorMoves()
      if (moveIdsEqual(prev, next)) return
      push({ field: 'tutor-moves', species: 0, prev, next })
    },

    applyWild(areaIndex, kind, next) {
      const key = wildKey(areaIndex, kind)
      const prev = get().wildDrafts[key] ?? originalWild(key)
      if (!prev || wildGroupsEqual(prev, next)) return
      push({ field: 'wild', species: areaIndex, key, prev, next })
    },

    applyEvos(species, next) {
      const prev = get().evoDrafts[species] ?? originalEvos(species)
      if (evosEqual(prev, next)) return
      push({ field: 'evo', species, prev, next })
    },

    applyBaseStats(species, next) {
      const prev = get().baseStatsDrafts[species] ?? originalBaseStats(species)
      if (baseStatsEqual(prev, next)) return
      push({ field: 'base-stats', species, prev, next })
    },

    applyTrainer(index, next) {
      const prev = get().trainerDrafts[index] ?? originalTrainer(index)
      if (!prev || trainersEqual(prev, next)) return
      push({ field: 'trainer', species: index, prev, next })
    },

    applyGameCorner(kind, next) {
      const prev = get().gcDrafts[kind] ?? originalPrizes(kind)
      if (prizesEqual(prev, next)) return
      push({ field: 'gamecorner', species: 0, kind, prev, next })
    },

    applyShop(cmdOffset, next) {
      const prev = get().shopDrafts[cmdOffset] ?? originalShop(cmdOffset)
      if (shopsEqual(prev, next)) return
      push({ field: 'shop', species: 0, cmdOffset, prev, next })
    },

    undo() {
      const { undoStack, redoStack } = get()
      const record = undoStack[undoStack.length - 1]
      if (!record) return null
      set({
        ...patch(record, record.prev),
        undoStack: undoStack.slice(0, -1),
        redoStack: [...redoStack, record],
      })
      return record
    },

    redo() {
      const { undoStack, redoStack } = get()
      const record = redoStack[redoStack.length - 1]
      if (!record) return null
      set({
        ...patch(record, record.next),
        undoStack: [...undoStack, record],
        redoStack: redoStack.slice(0, -1),
      })
      return record
    },

    revert(species) {
      get().apply(species, originalEntries(species))
      get().applyCompat('tm', species, originalFlags('tm', species))
      get().applyCompat('tutor', species, originalFlags('tutor', species))
      get().applyEvos(species, originalEvos(species))
      get().applyBaseStats(species, originalBaseStats(species))
    },

    revertWild(areaIndex) {
      for (const kind of WILD_KINDS) {
        const orig = originalWild(wildKey(areaIndex, kind))
        if (orig) get().applyWild(areaIndex, kind, orig)
      }
    },

    revertTrainer(index) {
      const orig = originalTrainer(index)
      if (orig) get().applyTrainer(index, orig)
    },

    copy(species) {
      const { drafts } = get()
      set({
        clipboard: effectiveEntries(drafts, useRomStore.getState().loaded?.learnsets ?? [], species),
      })
    },

    paste(species) {
      const { clipboard } = get()
      if (clipboard) get().apply(species, clipboard)
    },

    noteRecentMove(moveId) {
      const { recentMoves } = get()
      set({ recentMoves: [moveId, ...recentMoves.filter((m) => m !== moveId)].slice(0, MAX_RECENT) })
    },

    reset() {
      // Clipboard and recent moves deliberately survive — they're still useful
      // after a reload of the same ROM (and harmless otherwise).
      set({
        drafts: {},
        tmDrafts: {},
        tutorDrafts: {},
        tutorMovesDraft: null,
        wildDrafts: {},
        evoDrafts: {},
        baseStatsDrafts: {},
        trainerDrafts: {},
        gcDrafts: {},
        shopDrafts: {},
        undoStack: [],
        redoStack: [],
      })
    },
  }
})
