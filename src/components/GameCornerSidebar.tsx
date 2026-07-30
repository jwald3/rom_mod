import { useMemo } from 'react'
import { useRomStore } from '../state/romStore'
import { useEditStore, computeGcDirty } from '../state/editStore'
import { PRIZE_KINDS, PRIZE_KIND_LABELS } from '../rom/tables/gameCorner'
import { ViewSwitch } from './ViewSwitch'

export function GameCornerSidebar() {
  const loaded = useRomStore((s) => s.loaded)!
  const selectedPrizeKind = useRomStore((s) => s.selectedPrizeKind)
  const selectPrizeKind = useRomStore((s) => s.selectPrizeKind)
  const gcDrafts = useEditStore((s) => s.gcDrafts)

  const dirty = useMemo(() => computeGcDirty(gcDrafts, loaded), [gcDrafts, loaded])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      <ViewSwitch />
      <div className="px-3 pb-2 pt-3 text-xs uppercase tracking-wide text-slate-500">
        Celadon Game Corner
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {PRIZE_KINDS.map((kind) => {
          const list = loaded.prizeLists[kind]
          const count = (gcDrafts[kind] ?? list.entries).length
          return (
            <button
              key={kind}
              onClick={() => selectPrizeKind(kind)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                kind === selectedPrizeKind
                  ? 'bg-emerald-600/20 text-emerald-300'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-medium">
                {PRIZE_KIND_LABELS[kind]} prizes
              </span>
              <span className="font-mono text-xs text-slate-500">{count}</span>
              {!list.regenerable && (
                <span title="Unsupported layout — read-only" className="text-xs text-amber-500">
                  ⚠
                </span>
              )}
              {dirty.has(kind) && <span className="text-xs text-amber-400">●</span>}
            </button>
          )
        })}
      </div>
      <div className="border-t border-slate-800 p-3 text-xs text-slate-500">
        Add, remove, or edit the prizes players redeem coins for.
      </div>
    </aside>
  )
}
