import { useMemo } from 'react'
import { useRomStore } from '../state/romStore'
import { useEditStore, computeAllDirty, computeWildSpeciesPresence } from '../state/editStore'
import { isGapSpecies } from '../rom/tables/species'
import { evoCategory, EVO_CATEGORIES, type EvoCategory } from '../rom/tables/evolutions'
import { ViewSwitch } from './ViewSwitch'

const EVO_FILTER_LABELS: Record<string, string> = {
  any: 'any evolution method',
  level: 'evolves by level',
  stone: 'evolves by stone',
  friendship: 'evolves by friendship',
  trade: 'evolves by trade',
  special: 'evolves by special method',
  none: 'does not evolve',
}

export function SpeciesSidebar() {
  const loaded = useRomStore((s) => s.loaded)!
  const selected = useRomStore((s) => s.selected)
  const select = useRomStore((s) => s.select)
  const search = useRomStore((s) => s.search)
  const setSearch = useRomStore((s) => s.setSearch)
  const showGaps = useRomStore((s) => s.showGaps)
  const setShowGaps = useRomStore((s) => s.setShowGaps)
  const filterNoWild = useRomStore((s) => s.filterNoWild)
  const setFilterNoWild = useRomStore((s) => s.setFilterNoWild)
  const evoFilter = useRomStore((s) => s.evoFilter)
  const setEvoFilter = useRomStore((s) => s.setEvoFilter)
  const drafts = useEditStore((s) => s.drafts)
  const tmDrafts = useEditStore((s) => s.tmDrafts)
  const tutorDrafts = useEditStore((s) => s.tutorDrafts)
  const wildDrafts = useEditStore((s) => s.wildDrafts)
  const evoDrafts = useEditStore((s) => s.evoDrafts)
  const baseStatsDrafts = useEditStore((s) => s.baseStatsDrafts)

  const dirtySet = useMemo(
    () => computeAllDirty({ drafts, tmDrafts, tutorDrafts, evoDrafts, baseStatsDrafts }, loaded),
    [drafts, tmDrafts, tutorDrafts, evoDrafts, baseStatsDrafts, loaded],
  )

  const wildPresence = useMemo(
    () => computeWildSpeciesPresence(wildDrafts, loaded),
    [wildDrafts, loaded],
  )

  const evoCats = useMemo(() => {
    const map = new Map<number, Set<EvoCategory>>()
    loaded.evolutions.forEach((list, id) => {
      const effective = evoDrafts[id] ?? list
      map.set(id, new Set(effective.map((e) => evoCategory(e.method))))
    })
    return map
  }, [loaded, evoDrafts])

  const { visible, gapCount, noWildCount } = useMemo(() => {
    const all = loaded.species.slice(1) // species 0 is the “??????????” placeholder
    const gaps = all.filter(isGapSpecies).length
    const noWild = all.filter((s) => !isGapSpecies(s) && !wildPresence.has(s.id)).length
    const q = search.trim().toUpperCase()
    const visible = all.filter((s) => {
      if (!showGaps && isGapSpecies(s)) return false
      if (filterNoWild && wildPresence.has(s.id)) return false
      if (evoFilter !== 'any') {
        const cats = evoCats.get(s.id)
        if (evoFilter === 'none') {
          if ((cats?.size ?? 0) > 0) return false
        } else if (!cats?.has(evoFilter as EvoCategory)) {
          return false
        }
      }
      if (!q) return true
      return s.name.toUpperCase().includes(q) || String(s.id) === q
    })
    return { visible, gapCount: gaps, noWildCount: noWild }
  }, [loaded, search, showGaps, filterNoWild, wildPresence, evoFilter, evoCats])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      <ViewSwitch />
      <div className="p-3">
        <input
          id="species-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search species… (name or #)"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-emerald-500"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.map((s) => (
          <button
            key={s.id}
            onClick={() => select(s.id)}
            className={`flex w-full items-baseline gap-2 px-3 py-1 text-left text-sm ${
              s.id === selected
                ? 'bg-emerald-600/20 text-emerald-300'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <span className="font-mono text-xs text-slate-500">
              #{String(s.id).padStart(3, '0')}
            </span>
            <span className="truncate">{s.name}</span>
            {dirtySet.has(s.id) && <span className="ml-auto text-xs text-amber-400">●</span>}
          </button>
        ))}
        {visible.length === 0 && (
          <p className="px-3 py-4 text-sm text-slate-500">No species match.</p>
        )}
      </div>
      <div className="border-t border-slate-800 p-3 text-xs text-slate-500">
        <select
          value={evoFilter}
          onChange={(e) => setEvoFilter(e.target.value)}
          className="mb-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300 outline-none focus:border-emerald-500"
          title="Filter by evolution method"
        >
          {['any', ...EVO_CATEGORIES, 'none'].map((f) => (
            <option key={f} value={f}>
              {EVO_FILTER_LABELS[f]}
            </option>
          ))}
        </select>
        <label
          className="flex cursor-pointer items-center gap-2"
          title="Show only Pokémon that appear in zero wild encounter slots (evolutions, starters, gifts, …)"
        >
          <input
            type="checkbox"
            checked={filterNoWild}
            onChange={(e) => setFilterNoWild(e.target.checked)}
          />
          only no-wild-location ({noWildCount})
        </label>
        <label className="mt-1 flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={showGaps}
            onChange={(e) => setShowGaps(e.target.checked)}
          />
          show {gapCount} “?” gap species
        </label>
        <p className="mt-2 truncate" title={loaded.fileName}>
          {loaded.fileName}
        </p>
        <p>
          {loaded.species.length} species · {loaded.moves.length} moves ·{' '}
          {loaded.anchorSource === 'toml' ? 'HMA toml' : 'vanilla offsets'}
        </p>
      </div>
    </aside>
  )
}
