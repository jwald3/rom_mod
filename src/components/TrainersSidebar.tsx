import { useMemo } from 'react'
import { useRomStore } from '../state/romStore'
import { useEditStore, computeTrainerDirtySet, effectiveTrainer } from '../state/editStore'
import { ViewSwitch } from './ViewSwitch'

/** Sidebar label: "CLASS · NAME" (or just the class when the name is blank). */
function trainerLabel(cls: string, name: string): string {
  const c = cls.trim()
  const n = name.trim()
  if (n && c) return `${c} · ${n}`
  return n || c || '(unnamed)'
}

export function TrainersSidebar() {
  const loaded = useRomStore((s) => s.loaded)!
  const selectedTrainer = useRomStore((s) => s.selectedTrainer)
  const selectTrainer = useRomStore((s) => s.selectTrainer)
  const trainerSearch = useRomStore((s) => s.trainerSearch)
  const setTrainerSearch = useRomStore((s) => s.setTrainerSearch)
  const trainerDrafts = useEditStore((s) => s.trainerDrafts)

  const dirty = useMemo(
    () => computeTrainerDirtySet(trainerDrafts, loaded),
    [trainerDrafts, loaded],
  )

  const visible = useMemo(() => {
    // Skip #0 (the dummy trainer) unless searched by number.
    const all = loaded.trainers.filter((t) => t.index !== 0)
    const q = trainerSearch.trim().toUpperCase()
    if (!q) return all
    if (/^\d+$/.test(q)) return loaded.trainers.filter((t) => String(t.index).startsWith(q))
    return all.filter((t) => {
      const edit = effectiveTrainer(trainerDrafts, loaded, t.index)
      const cls = loaded.trainerClassNames[edit?.cls ?? t.cls] ?? ''
      const name = edit?.name ?? t.name
      return `${cls} ${name}`.toUpperCase().includes(q)
    })
  }, [loaded, trainerSearch, trainerDrafts])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      <ViewSwitch />
      <div className="p-3">
        <input
          id="trainer-search"
          value={trainerSearch}
          onChange={(e) => setTrainerSearch(e.target.value)}
          placeholder="Search trainers… (name, class, #)"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-emerald-500"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.map((t) => {
          const edit = effectiveTrainer(trainerDrafts, loaded, t.index)
          const cls = loaded.trainerClassNames[edit?.cls ?? t.cls] ?? ''
          const name = edit?.name ?? t.name
          return (
            <button
              key={t.index}
              onClick={() => selectTrainer(t.index)}
              className={`flex w-full items-baseline gap-2 px-3 py-1 text-left text-sm ${
                t.index === selectedTrainer
                  ? 'bg-emerald-600/20 text-emerald-300'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span className="w-9 shrink-0 font-mono text-xs text-slate-500">{t.index}</span>
              <span className="truncate">{trainerLabel(cls, name)}</span>
              {dirty.has(t.index) && <span className="ml-auto text-xs text-amber-400">●</span>}
            </button>
          )
        })}
        {visible.length === 0 && <p className="px-3 py-4 text-sm text-slate-500">No trainers match.</p>}
      </div>
      <div className="border-t border-slate-800 p-3 text-xs text-slate-500">
        {loaded.trainers.length - 1} trainers · {loaded.trainerClassNames.length} classes
      </div>
    </aside>
  )
}
