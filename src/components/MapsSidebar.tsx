import { useMemo } from 'react'
import { useRomStore } from '../state/romStore'
import { useEditStore, computeWildDirtyAreas } from '../state/editStore'
import { ViewSwitch } from './ViewSwitch'

export function MapsSidebar() {
  const loaded = useRomStore((s) => s.loaded)!
  const selectedArea = useRomStore((s) => s.selectedArea)
  const selectArea = useRomStore((s) => s.selectArea)
  const mapSearch = useRomStore((s) => s.mapSearch)
  const setMapSearch = useRomStore((s) => s.setMapSearch)
  const wildDrafts = useEditStore((s) => s.wildDrafts)

  const dirtyAreas = useMemo(
    () => computeWildDirtyAreas(wildDrafts, loaded),
    [wildDrafts, loaded],
  )

  const visible = useMemo(() => {
    const q = mapSearch.trim().toUpperCase()
    if (!q) return loaded.wildAreas
    return loaded.wildAreas.filter(
      (a) => a.name.toUpperCase().includes(q) || `${a.bank}.${a.map}`.includes(q),
    )
  }, [loaded, mapSearch])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      <ViewSwitch />
      <div className="p-3">
        <input
          id="map-search"
          value={mapSearch}
          onChange={(e) => setMapSearch(e.target.value)}
          placeholder="Search maps…"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-emerald-500"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.map((a) => (
          <button
            key={a.index}
            onClick={() => selectArea(a.index)}
            className={`flex w-full items-baseline gap-2 px-3 py-1 text-left text-sm ${
              a.index === selectedArea
                ? 'bg-emerald-600/20 text-emerald-300'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <span className="w-9 shrink-0 font-mono text-xs text-slate-500">
              {a.bank}.{a.map}
            </span>
            <span className="truncate">{a.name}</span>
            {dirtyAreas.has(a.index) && <span className="ml-auto text-xs text-amber-400">●</span>}
          </button>
        ))}
        {visible.length === 0 && <p className="px-3 py-4 text-sm text-slate-500">No maps match.</p>}
      </div>
      <div className="border-t border-slate-800 p-3 text-xs text-slate-500">
        {loaded.wildAreas.length} areas with wild encounters
      </div>
    </aside>
  )
}
