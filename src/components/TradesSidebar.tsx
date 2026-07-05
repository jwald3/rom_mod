import { useMemo } from 'react'
import { useRomStore } from '../state/romStore'
import { useEditStore, computeTradeDirtySet, effectiveTrade } from '../state/editStore'
import { ViewSwitch } from './ViewSwitch'

export function TradesSidebar() {
  const loaded = useRomStore((s) => s.loaded)!
  const selectedTrade = useRomStore((s) => s.selectedTrade)
  const selectTrade = useRomStore((s) => s.selectTrade)
  const tradeDrafts = useEditStore((s) => s.tradeDrafts)

  const dirty = useMemo(
    () => computeTradeDirtySet(tradeDrafts, loaded),
    [tradeDrafts, loaded],
  )

  const name = (id: number) => loaded.species[id]?.name ?? `#${id}`

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      <ViewSwitch />
      <div className="min-h-0 flex-1 overflow-y-auto pt-2">
        {loaded.trades.map((_, i) => {
          const trade = effectiveTrade(tradeDrafts, loaded, i)!
          return (
            <button
              key={i}
              onClick={() => selectTrade(i)}
              className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm ${
                i === selectedTrade
                  ? 'bg-emerald-600/20 text-emerald-300'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span className="w-6 shrink-0 font-mono text-xs text-slate-500">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {name(trade.receivedSpecies)}
                <span className="text-slate-500"> ← </span>
                {name(trade.requestedSpecies)}
              </span>
              {dirty.has(i) && <span className="ml-auto text-xs text-amber-400">●</span>}
            </button>
          )
        })}
        {loaded.trades.length === 0 && (
          <p className="px-3 py-4 text-sm text-slate-500">No in-game trades in this ROM.</p>
        )}
      </div>
      <div className="border-t border-slate-800 p-3 text-xs text-slate-500">
        {loaded.trades.length} in-game trade{loaded.trades.length === 1 ? '' : 's'} · you receive ←
        you give
      </div>
    </aside>
  )
}
