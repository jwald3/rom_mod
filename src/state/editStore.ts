import { create } from 'zustand'
import { entriesEqual, type Learnset, type LearnsetEntry } from '../rom/tables/learnsets'
import { flagsEqual } from '../rom/tables/compat'
import {
  parseWildKey,
  wildGroupsEqual,
  wildKey,
  WILD_KINDS,
  type WildGroupEdit,
  type WildKind,
} from '../rom/tables/wild'
import { evosEqual, type Evolution } from '../rom/tables/evolutions'
import { tradesEqual, type Trade } from '../rom/tables/trades'
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
  | { field: 'evo'; species: number; prev: Evolution[]; next: Evolution[] }
  /** species carries the wild area index so undo can jump to it. */
  | { field: 'wild'; species: number; key: string; prev: WildGroupEdit; next: WildGroupEdit }
  /** species carries the trade index so undo can jump to it. */
  | { field: 'trade'; species: number; prev: Trade; next: Trade }

const MAX_UNDO = 200
const MAX_RECENT = 8

interface EditStore {
  drafts: Record<number, LearnsetEntry[]>
  tmDrafts: Record<number, boolean[]>
  tutorDrafts: Record<number, boolean[]>
  /** Keyed by wildKey(areaIndex, kind). */
  wildDrafts: Record<string, WildGroupEdit>
  evoDrafts: Record<number, Evolution[]>
  /** Keyed by trade index. */
  tradeDrafts: Record<number, Trade>
  undoStack: EditRecord[]
  redoStack: EditRecord[]
  clipboard: LearnsetEntry[] | null
  recentMoves: number[]

  /** Replace a species' learnset (records an undo step). No-op if unchanged. */
  apply(species: number, next: LearnsetEntry[]): void
  /** Replace a species' TM/HM or tutor flags (records an undo step). No-op if unchanged. */
  applyCompat(field: CompatField, species: number, next: boolean[]): void
  /** Replace one wild encounter group (records an undo step). No-op if unchanged. */
  applyWild(areaIndex: number, kind: WildKind, next: WildGroupEdit): void
  /** Replace a species' evolution list (records an undo step). No-op if unchanged. */
  applyEvos(species: number, next: Evolution[]): void
  /** Replace one in-game trade (records an undo step). No-op if unchanged. */
  applyTrade(index: number, next: Trade): void
  /** Returns the applied record (for selection jump), or null. */
  undo(): EditRecord | null
  redo(): EditRecord | null
  /** Restore learnset + compat rows to ROM state (each an undoable step). */
  revert(species: number): void
  /** Restore all of an area's encounter groups to ROM state. */
  revertWild(areaIndex: number): void
  /** Restore one trade to ROM state (an undoable step). */
  revertTrade(index: number): void
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

function originalEvos(species: number): Evolution[] {
  return useRomStore.getState().loaded?.evolutions[species] ?? []
}

function originalTrade(index: number): Trade | null {
  return useRomStore.getState().loaded?.trades[index] ?? null
}

function originalWild(key: string): WildGroupEdit | null {
  const { areaIndex, kind } = parseWildKey(key)
  const group = useRomStore.getState().loaded?.wildAreas[areaIndex]?.groups[kind]
  return group ? { rate: group.rate, slots: group.slots } : null
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

/** Trade indexes whose drafts differ from the ROM. */
export function computeTradeDirtySet(
  tradeDrafts: Record<number, Trade>,
  loaded: LoadedRom,
): Set<number> {
  const dirty = new Set<number>()
  for (const key of Object.keys(tradeDrafts)) {
    const index = Number(key)
    const orig = loaded.trades[index]
    if (!orig || !tradesEqual(tradeDrafts[index], orig)) dirty.add(index)
  }
  return dirty
}

/** Current trade for an index: draft if present, else ROM original. */
export function effectiveTrade(
  tradeDrafts: Record<number, Trade>,
  loaded: LoadedRom,
  index: number,
): Trade | null {
  return tradeDrafts[index] ?? loaded.trades[index] ?? null
}

/** Union of learnset + TM + tutor + evolution dirty species. */
export function computeAllDirty(
  s: Pick<EditStore, 'drafts' | 'tmDrafts' | 'tutorDrafts' | 'evoDrafts'>,
  loaded: LoadedRom,
): Set<number> {
  const dirty = computeDirtySet(s.drafts, loaded.learnsets)
  for (const sp of computeCompatDirtySet(s.tmDrafts, loaded.tmCompat)) dirty.add(sp)
  for (const sp of computeCompatDirtySet(s.tutorDrafts, loaded.tutorCompat)) dirty.add(sp)
  for (const sp of computeEvoDirtySet(s.evoDrafts, loaded)) dirty.add(sp)
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

function tradeDraftsWith(
  drafts: Record<number, Trade>,
  index: number,
  trade: Trade,
): Record<number, Trade> {
  const next = { ...drafts }
  const orig = originalTrade(index)
  if (orig && tradesEqual(trade, orig)) delete next[index]
  else next[index] = trade
  return next
}

export const useEditStore = create<EditStore>((set, get) => {
  /** Partial state applying `value` as the draft for the record's field/species. */
  function patch(
    record: EditRecord,
    value: LearnsetEntry[] | boolean[] | WildGroupEdit | Evolution[] | Trade,
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
    if (record.field === 'evo') {
      return { evoDrafts: evoDraftsWith(s.evoDrafts, record.species, value as Evolution[]) }
    }
    if (record.field === 'trade') {
      return { tradeDrafts: tradeDraftsWith(s.tradeDrafts, record.species, value as Trade) }
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
    wildDrafts: {},
    evoDrafts: {},
    tradeDrafts: {},
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

    applyTrade(index, next) {
      const prev = get().tradeDrafts[index] ?? originalTrade(index)
      if (!prev || tradesEqual(prev, next)) return
      push({ field: 'trade', species: index, prev, next })
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
    },

    revertWild(areaIndex) {
      for (const kind of WILD_KINDS) {
        const orig = originalWild(wildKey(areaIndex, kind))
        if (orig) get().applyWild(areaIndex, kind, orig)
      }
    },

    revertTrade(index) {
      const orig = originalTrade(index)
      if (orig) get().applyTrade(index, orig)
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
        wildDrafts: {},
        evoDrafts: {},
        tradeDrafts: {},
        undoStack: [],
        redoStack: [],
      })
    },
  }
})
