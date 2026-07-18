import { useRomStore } from '../state/romStore'

export function ViewSwitch() {
  const viewMode = useRomStore((s) => s.viewMode)
  const setViewMode = useRomStore((s) => s.setViewMode)

  return (
    <div className="flex gap-1 p-2 pb-0">
      {(
        [
          ['species', 'Pokémon'],
          ['maps', 'Maps'],
          ['trainers', 'Trainers'],
        ] as const
      ).map(([mode, label]) => (
        <button
          key={mode}
          onClick={() => setViewMode(mode)}
          className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
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
