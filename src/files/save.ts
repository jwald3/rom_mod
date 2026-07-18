import { useRomStore, type SaveState } from '../state/romStore'
import {
  useEditStore,
  computeDirtySet,
  computeCompatDirtySet,
  computeWildDirtyKeys,
  computeEvoDirtySet,
  computeTrainerDirtySet,
} from '../state/editStore'
import { applyRomEdits, type RomEdits } from '../rom/writer'
import { loadRom } from '../rom/loadRom'
import type { LearnsetEntry } from '../rom/tables/learnsets'
import type { WildGroupEdit } from '../rom/tables/wild'
import type { Evolution } from '../rom/tables/evolutions'
import type { TrainerEdit } from '../rom/tables/trainers'
import { stashBackup, latestBackup } from './backup'

function setSaveState(saveState: SaveState) {
  useRomStore.setState({ saveState })
}

function buildEdits(): { edits: RomEdits; count: number } {
  const { loaded } = useRomStore.getState()
  const { drafts, tmDrafts, tutorDrafts, wildDrafts, evoDrafts, trainerDrafts } = useEditStore.getState()
  const learnsets = new Map<number, LearnsetEntry[]>()
  const tmCompat = new Map<number, boolean[]>()
  const tutorCompat = new Map<number, boolean[]>()
  const wild = new Map<string, WildGroupEdit>()
  const evolutions = new Map<number, Evolution[]>()
  const trainers = new Map<number, TrainerEdit>()
  if (loaded) {
    for (const s of computeDirtySet(drafts, loaded.learnsets)) learnsets.set(s, drafts[s])
    for (const s of computeCompatDirtySet(tmDrafts, loaded.tmCompat)) tmCompat.set(s, tmDrafts[s])
    for (const s of computeCompatDirtySet(tutorDrafts, loaded.tutorCompat)) {
      tutorCompat.set(s, tutorDrafts[s])
    }
    for (const key of computeWildDirtyKeys(wildDrafts, loaded)) wild.set(key, wildDrafts[key])
    for (const s of computeEvoDirtySet(evoDrafts, loaded)) evolutions.set(s, evoDrafts[s])
    for (const t of computeTrainerDirtySet(trainerDrafts, loaded)) trainers.set(t, trainerDrafts[t])
  }
  return {
    edits: { learnsets, tmCompat, tutorCompat, wild, evolutions, trainers },
    count:
      learnsets.size + tmCompat.size + tutorCompat.size + wild.size + evolutions.size + trainers.size,
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  const va = new DataView(a.buffer, a.byteOffset, a.byteLength)
  const vb = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const words = a.length >>> 2
  for (let i = 0; i < words; i++) {
    if (va.getUint32(i * 4) !== vb.getUint32(i * 4)) return false
  }
  for (let i = words * 4; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function triggerDownload(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Save in place through the file handle. Transactional: edits are applied to
 * a copy, verified, guarded against on-disk changes, backed up, then written
 * (createWritable itself is atomic — swap happens on close). On success the
 * app rebases onto the saved bytes; undo history survives content-wise.
 */
export async function saveInPlace(): Promise<void> {
  const { loaded, romHandle, tomlText } = useRomStore.getState()
  if (!loaded || !romHandle) return
  const { edits, count } = buildEdits()
  if (count === 0) return

  setSaveState({ status: 'saving', message: 'Saving…' })
  try {
    const { bytes, ops } = applyRomEdits(loaded.rom, loaded.anchors, edits)

    // Changed-on-disk guard (e.g. HMA touched the file while we were editing).
    const onDisk = new Uint8Array(await (await romHandle.getFile()).arrayBuffer())
    if (!bytesEqual(onDisk, loaded.rom.bytes)) {
      setSaveState({
        status: 'error',
        message: 'The ROM changed on disk since it was loaded (another tool?). Re-open it before saving.',
      })
      return
    }

    let backupOk = true
    try {
      await stashBackup(loaded.fileName, loaded.rom.bytes)
    } catch {
      backupOk = false
    }

    const writable = await romHandle.createWritable()
    await writable.write(bytes)
    await writable.close()

    // Rebase the app onto the saved bytes. Drafts are baked in; undo/redo
    // stacks stay valid because they hold content, not offsets.
    useRomStore.setState({ loaded: loadRom(bytes, loaded.fileName, tomlText) })
    useEditStore.setState({
      drafts: {},
      tmDrafts: {},
      tutorDrafts: {},
      wildDrafts: {},
      evoDrafts: {},
      trainerDrafts: {},
    })

    const inPlace = ops.filter((o) => o.kind === 'in-place').length
    const repointed = ops.filter((o) => o.kind === 'repointed').length
    const wildOps = ops.filter((o) => o.kind === 'wild').length
    const evoOps = ops.filter((o) => o.kind === 'evolution').length
    const trainerOps = ops.filter((o) => o.kind === 'trainer' || o.kind === 'trainer-repointed').length
    const trainerRepointed = ops.filter((o) => o.kind === 'trainer-repointed').length
    const learnsetOps = inPlace + repointed
    const compat = ops.length - learnsetOps - wildOps - evoOps - trainerOps
    const parts = [
      learnsetOps > 0 ? `Saved ${learnsetOps} learnset${learnsetOps === 1 ? '' : 's'}` : null,
      repointed > 0 ? `${repointed} repointed to free space` : null,
      compat > 0 ? `${compat} compatibility row${compat === 1 ? '' : 's'}` : null,
      wildOps > 0 ? `${wildOps} wild group${wildOps === 1 ? '' : 's'}` : null,
      evoOps > 0 ? `${evoOps} evolution set${evoOps === 1 ? '' : 's'}` : null,
      trainerOps > 0
        ? `${trainerOps} trainer${trainerOps === 1 ? '' : 's'}${
            trainerRepointed > 0 ? ` (${trainerRepointed} party repointed)` : ''
          }`
        : null,
      backupOk ? 'backup kept' : '⚠ backup failed',
    ].filter(Boolean)
    setSaveState({ status: 'saved', message: parts.join(' · ') })
  } catch (e) {
    setSaveState({
      status: 'error',
      message: `Save failed: ${e instanceof Error ? e.message : String(e)} — the file on disk was not modified.`,
    })
  }
}

/** Download the ROM with current edits applied. Does not touch the original or rebase state. */
export function downloadModifiedCopy(): void {
  const { loaded } = useRomStore.getState()
  if (!loaded) return
  try {
    const { bytes } = applyRomEdits(loaded.rom, loaded.anchors, buildEdits().edits)
    triggerDownload(bytes, loaded.fileName)
    setSaveState({ status: 'saved', message: 'Downloaded modified copy — the original file is untouched.' })
  } catch (e) {
    setSaveState({ status: 'error', message: `Download failed: ${e instanceof Error ? e.message : String(e)}` })
  }
}

/** Download the most recent pre-save backup for the loaded file. */
export async function downloadLastBackup(): Promise<void> {
  const { loaded } = useRomStore.getState()
  if (!loaded) return
  const record = await latestBackup(loaded.fileName)
  if (!record) return
  const stamp = new Date(record.when).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  triggerDownload(record.bytes, loaded.fileName.replace(/\.gba$/i, '') + `.backup-${stamp}.gba`)
}
