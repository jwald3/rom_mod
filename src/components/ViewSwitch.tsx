import { useRomStore } from '../state/romStore'

export function ViewSwitch() {
  const viewMode = useRomStore((s) => s.viewMode)
  const setViewMode = useRomStore((s) => s.setViewMode)
  // No Celadon Game Corner on this ROM (e.g. Emerald/H&S) → drop the Prizes tab.
  const gameCornerAvailable = useRomStore((s) => s.loaded?.gameCornerAvailable ?? false)

  const tabs = (
    [
      ['species', 'Pokémon'],
      ['maps', 'Maps'],
      ['trainers', 'Trainers'],
      ['gamecorner', 'Prizes'],
      ['shops', 'Shops'],
    ] as const
  ).filter(([mode]) => mode !== 'gamecorner' || gameCornerAvailable)

  return (
    <div className="flex flex-wrap gap-1 p-2 pb-0">
      {tabs.map(([mode, label]) => (
        <button
          key={mode}
          onClick={() => setViewMode(mode)}
          className={`flex-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium ${
            viewMode === mode
              ? 'bg-emerald-600/20 text-emerald-300'
              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
