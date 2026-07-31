import { describe, it, expect, beforeEach } from 'vitest'
import { useRomStore } from '../src/state/romStore'
import * as stores from '../src/state/editStore'
import {
  useEditStore,
  effectiveEntries,
  computeDirtySet,
  computeAllDirty,
  effectiveTutorMoves,
  isTutorMovesDirty,
} from '../src/state/editStore'
import type { LoadedRom } from '../src/rom/loadRom'
import type { LearnsetEntry } from '../src/rom/tables/learnsets'

const ORIGINAL_1: LearnsetEntry[] = [
  { level: 1, moveId: 33 },
  { level: 4, moveId: 45 },
]
const ORIGINAL_2: LearnsetEntry[] = [{ level: 1, moveId: 10 }]

const TM_ROW_1 = [true, false, true]

function fakeLoaded(): LoadedRom {
  return {
    learnsets: [
      { species: 0, entries: [], origOffset: 0x10, origCapacity: 1 },
      { species: 1, entries: ORIGINAL_1, origOffset: 0x20, origCapacity: 3 },
      { species: 2, entries: ORIGINAL_2, origOffset: 0x30, origCapacity: 2 },
    ],
    tmCompat: [[false, false, false], TM_ROW_1, [false, false, false]],
    tutorCompat: [[false], [true], [false]],
    tutorMoves: [33, 45, 20],
    evolutions: [[], [{ method: 4, param: 16, target: 2 }], []],
    wildAreas: [
      {
        index: 0,
        bank: 2,
        map: 27,
        name: 'TEST CAVE',
        groups: {
          grass: {
            rate: 7,
            slots: [{ low: 5, high: 7, species: 41 }],
            infoOffset: 0x100,
            listOffset: 0x110,
          },
        },
      },
    ],
  } as unknown as LoadedRom
}

beforeEach(() => {
  useRomStore.setState({ loaded: fakeLoaded() })
  useEditStore.getState().reset()
})

const state = () => useEditStore.getState()
const loadedLearnsets = () => useRomStore.getState().loaded!.learnsets

describe('editStore', () => {
  it('applies drafts and tracks dirty species', () => {
    state().apply(1, [{ level: 5, moveId: 99 }])
    expect(effectiveEntries(state().drafts, loadedLearnsets(), 1)).toEqual([
      { level: 5, moveId: 99 },
    ])
    expect(effectiveEntries(state().drafts, loadedLearnsets(), 2)).toEqual(ORIGINAL_2)
    expect([...computeDirtySet(state().drafts, loadedLearnsets())]).toEqual([1])
  })

  it('ignores no-op applies', () => {
    state().apply(1, [...ORIGINAL_1])
    expect(state().undoStack).toHaveLength(0)
    expect(computeDirtySet(state().drafts, loadedLearnsets()).size).toBe(0)
  })

  it('undoes and redoes, reporting the affected species', () => {
    state().apply(1, [{ level: 5, moveId: 99 }])
    state().apply(2, [])

    expect(state().undo()?.species).toBe(2)
    expect(effectiveEntries(state().drafts, loadedLearnsets(), 2)).toEqual(ORIGINAL_2)
    expect(state().undo()?.species).toBe(1)
    expect(computeDirtySet(state().drafts, loadedLearnsets()).size).toBe(0)
    expect(state().undo()).toBeNull()

    expect(state().redo()?.species).toBe(1)
    expect(effectiveEntries(state().drafts, loadedLearnsets(), 1)).toEqual([
      { level: 5, moveId: 99 },
    ])
    expect(state().redo()?.species).toBe(2)
    expect(state().redo()).toBeNull()
  })

  it('drops the draft when an edit returns to the original', () => {
    state().apply(1, [{ level: 5, moveId: 99 }])
    state().apply(1, [...ORIGINAL_1])
    expect(state().drafts[1]).toBeUndefined()
    // …but both steps remain undoable
    expect(state().undoStack).toHaveLength(2)
  })

  it('clears the redo stack on a new edit', () => {
    state().apply(1, [{ level: 5, moveId: 99 }])
    state().undo()
    state().apply(1, [{ level: 7, moveId: 100 }])
    expect(state().redo()).toBeNull()
  })

  it('reverts to the ROM original as an undoable step', () => {
    state().apply(1, [{ level: 5, moveId: 99 }])
    state().revert(1)
    expect(computeDirtySet(state().drafts, loadedLearnsets()).size).toBe(0)
    expect(state().undo()?.species).toBe(1)
    expect(effectiveEntries(state().drafts, loadedLearnsets(), 1)).toEqual([
      { level: 5, moveId: 99 },
    ])
  })

  it('copies and pastes between species', () => {
    state().copy(1)
    state().paste(2)
    expect(effectiveEntries(state().drafts, loadedLearnsets(), 2)).toEqual(ORIGINAL_1)
    // clipboard holds effective (draft) entries, not just originals
    state().apply(1, [{ level: 50, moveId: 200 }])
    state().copy(1)
    state().paste(2)
    expect(effectiveEntries(state().drafts, loadedLearnsets(), 2)).toEqual([
      { level: 50, moveId: 200 },
    ])
  })

  it('applies, undoes, and redoes compat edits on the shared stack', () => {
    state().applyCompat('tm', 1, [false, false, true])
    state().apply(1, [{ level: 5, moveId: 99 }])

    let dirty = computeAllDirty(state(), useRomStore.getState().loaded!)
    expect([...dirty]).toEqual([1])

    expect(state().undo()?.field).toBe('learnset')
    expect(state().undo()?.field).toBe('tm')
    dirty = computeAllDirty(state(), useRomStore.getState().loaded!)
    expect(dirty.size).toBe(0)
    expect(state().tmDrafts[1]).toBeUndefined()

    expect(state().redo()?.species).toBe(1)
    expect(state().tmDrafts[1]).toEqual([false, false, true])
  })

  it('applies, undoes, and reverts wild encounter edits', () => {
    const { computeWildDirtyAreas } = stores
    const loaded = () => useRomStore.getState().loaded!

    // no-op apply is ignored
    state().applyWild(0, 'grass', { rate: 7, slots: [{ low: 5, high: 7, species: 41 }] })
    expect(state().undoStack).toHaveLength(0)

    state().applyWild(0, 'grass', { rate: 30, slots: [{ low: 10, high: 12, species: 1 }] })
    expect([...computeWildDirtyAreas(state().wildDrafts, loaded())]).toEqual([0])

    const record = state().undo()
    expect(record?.field).toBe('wild')
    expect(record?.species).toBe(0) // area index for the selection jump
    expect(computeWildDirtyAreas(state().wildDrafts, loaded()).size).toBe(0)
    expect(state().wildDrafts['0:grass']).toBeUndefined()

    state().redo()
    state().revertWild(0)
    expect(computeWildDirtyAreas(state().wildDrafts, loaded()).size).toBe(0)
  })

  it('applyCompat ignores no-ops and drops drafts equal to the original', () => {
    state().applyCompat('tm', 1, [...TM_ROW_1])
    expect(state().undoStack).toHaveLength(0)

    state().applyCompat('tm', 1, [false, false, true])
    state().applyCompat('tm', 1, [...TM_ROW_1]) // back to original
    expect(state().tmDrafts[1]).toBeUndefined()
    expect(state().undoStack).toHaveLength(2)
  })

  it('revert restores learnset and compat rows together', () => {
    state().apply(1, [{ level: 5, moveId: 99 }])
    state().applyCompat('tutor', 1, [false])
    state().revert(1)
    expect(state().drafts[1]).toBeUndefined()
    expect(state().tutorDrafts[1]).toBeUndefined()
  })

  it('applies, undoes, and reverts evolution edits', () => {
    const { computeEvoDirtySet } = stores
    const loaded = () => useRomStore.getState().loaded!

    // no-op ignored
    state().applyEvos(1, [{ method: 4, param: 16, target: 2 }])
    expect(state().undoStack).toHaveLength(0)

    state().applyEvos(1, [{ method: 7, param: 94, target: 2 }])
    expect([...computeEvoDirtySet(state().evoDrafts, loaded())]).toEqual([1])
    expect(computeAllDirty(state(), loaded()).has(1)).toBe(true)

    const record = state().undo()
    expect(record?.field).toBe('evo')
    expect(state().evoDrafts[1]).toBeUndefined()

    state().redo()
    state().revert(1) // revert covers evolutions too
    expect(computeEvoDirtySet(state().evoDrafts, loaded()).size).toBe(0)
  })

  it('computes wild species presence, reflecting drafts', () => {
    const { computeWildSpeciesPresence } = stores
    const loaded = () => useRomStore.getState().loaded!

    let present = computeWildSpeciesPresence(state().wildDrafts, loaded())
    expect(present.has(41)).toBe(true) // Zubat in the fake cave
    expect(present.has(1)).toBe(false)

    // Swap the slot to species 1 — presence follows the draft, unsaved.
    state().applyWild(0, 'grass', { rate: 7, slots: [{ low: 5, high: 7, species: 1 }] })
    present = computeWildSpeciesPresence(state().wildDrafts, loaded())
    expect(present.has(1)).toBe(true)
    expect(present.has(41)).toBe(false)
  })

  it('tracks recent moves, most recent first, deduplicated', () => {
    state().noteRecentMove(1)
    state().noteRecentMove(2)
    state().noteRecentMove(1)
    expect(state().recentMoves).toEqual([1, 2])
  })

  it('edits, undoes, and reverts the global tutor move roster', () => {
    const loaded = () => useRomStore.getState().loaded!
    expect(effectiveTutorMoves(state().tutorMovesDraft, loaded())).toEqual([33, 45, 20])
    expect(isTutorMovesDirty(state().tutorMovesDraft, loaded())).toBe(false)

    state().applyTutorMoves([33, 99, 20]) // change slot 1
    expect(effectiveTutorMoves(state().tutorMovesDraft, loaded())).toEqual([33, 99, 20])
    expect(isTutorMovesDirty(state().tutorMovesDraft, loaded())).toBe(true)

    // no-op apply records nothing
    state().applyTutorMoves([33, 99, 20])
    expect(state().undoStack).toHaveLength(1)

    // returning to the original drops the draft
    state().applyTutorMoves([33, 45, 20])
    expect(state().tutorMovesDraft).toBeNull()
    expect(isTutorMovesDirty(state().tutorMovesDraft, loaded())).toBe(false)

    // undo brings the edit back, undo again clears it
    expect(state().undo()).not.toBeNull()
    expect(effectiveTutorMoves(state().tutorMovesDraft, loaded())).toEqual([33, 99, 20])
    expect(state().undo()).not.toBeNull()
    expect(state().tutorMovesDraft).toBeNull()
  })
})
