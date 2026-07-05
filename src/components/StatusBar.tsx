import { useEffect, useMemo, useState } from 'react'
import { useRomStore } from '../state/romStore'
import {
  useEditStore,
  computeDirtySet,
  computeAllDirty,
  computeWildDirtyAreas,
} from '../state/editStore'
import { validateLearnset } from '../rom/validate'
import { saveInPlace, downloadModifiedCopy, downloadLastBackup } from '../files/save'
import { latestBackup } from '../files/backup'

export function StatusBar() {
  const loaded = useRomStore((s) => s.loaded)!
  const romHandle = useRomStore((s) => s.romHandle)
  const saveState = useRomStore((s) => s.saveState)
  const drafts = useEditStore((s) => s.drafts)
  const tmDrafts = useEditStore((s) => s.tmDrafts)
  const tutorDrafts = useEditStore((s) => s.tutorDrafts)
  const wildDrafts = useEditStore((s) => s.wildDrafts)
  const evoDrafts = useEditStore((s) => s.evoDrafts)
  const undoDepth = useEditStore((s) => s.undoStack.length)
  const diffOpen = useRomStore((s) => s.diffOpen)
  const setDiffOpen = useRomStore((s) => s.setDiffOpen)

  const [backupAvailable, setBackupAvailable] = useState(false)
  useEffect(() => {
    latestBackup(loaded.fileName)
      .then((b) => setBackupAvailable(b !== null))
      .catch(() => setBackupAvailable(false))
  }, [loaded.fileName, saveState.status])

  const { dirtyCount, dirtyLabel } = useMemo(() => {
    const speciesCount = computeAllDirty({ drafts, tmDrafts, tutorDrafts, evoDrafts }, loaded).size
    const areaCount = computeWildDirtyAreas(wildDrafts, loaded).size
    const parts = [
      speciesCount > 0 ? `${speciesCount} species` : null,
      areaCount > 0 ? `${areaCount} area${areaCount === 1 ? '' : 's'}` : null,
    ].filter(Boolean)
    return {
      dirtyCount: speciesCount + areaCount,
      dirtyLabel: parts.length > 0 ? `${parts.join(' · ')} modified` : 'No changes',
    }
  }, [drafts, tmDrafts, tutorDrafts, wildDrafts, evoDrafts, loaded])

  // Hard validation failures block saving (soft warnings like duplicates don't).
  const hardInvalid = useMemo(() => {
    for (const species of computeDirtySet(drafts, loaded.learnsets)) {
      const warns = validateLearnset(drafts[species], loaded.moves.length)
      if (warns.some((w) => w.kind === 'badMove' || w.kind === 'level')) return true
    }
    return false
  }, [drafts, loaded])

  const saving = saveState.status === 'saving'

  return (
    <footer className="flex items-center gap-4 border-t border-slate-800 bg-slate-900 px-4 py-2 text-sm">
      <span className={dirtyCount > 0 ? 'text-amber-300' : 'text-slate-500'}>{dirtyLabel}</span>
      {saveState.message && (
        <span
          className={
            saveState.status === 'error'
              ? 'text-red-400'
              : saveState.status === 'saved'
                ? 'text-emerald-400'
                : 'text-slate-400'
          }
        >
          {saveState.message}
        </span>
      )}
      <span className="ml-auto text-xs text-slate-600">
        Ctrl+S save · Ctrl+Z undo{undoDepth > 0 && ` (${undoDepth})`} · Ctrl+K search
      </span>
      <button
        onClick={() => setDiffOpen(!diffOpen)}
        className={`rounded-lg border px-3 py-1 hover:bg-slate-800 ${
          diffOpen ? 'border-emerald-700 text-emerald-300' : 'border-slate-700 text-slate-300'
        }`}
        title="Compare learnsets against a baseline ROM"
      >
        Diff
      </button>
      {backupAvailable && (
        <button
          onClick={() => void downloadLastBackup()}
          className="rounded-lg border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
          title="Download the most recent pre-save backup"
        >
          Backup
        </button>
      )}
      <button
        onClick={downloadModifiedCopy}
        className="rounded-lg border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
        title="Download a copy with your edits — the original file stays untouched"
      >
        Download copy
      </button>
      {romHandle ? (
        <button
          onClick={() => void saveInPlace()}
          disabled={dirtyCount === 0 || hardInvalid || saving}
          title={hardInvalid ? 'Fix the ⚠ invalid rows first' : 'Write edits into the ROM file'}
          className="rounded-lg bg-emerald-600 px-4 py-1 font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-800/40 disabled:text-emerald-200/40"
        >
          {saving ? 'Saving…' : `Save to ROM${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
        </button>
      ) : (
        dirtyCount > 0 && (
          <span className="text-xs text-slate-500">
            drag-drop can’t save in place — use “Download copy”, or reopen via “Open files…”
          </span>
        )
      )}
    </footer>
  )
}
