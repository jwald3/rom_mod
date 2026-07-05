import type { MoveInfo } from '../rom/tables/moves'
import { TypeBadge } from './TypeBadge'

export interface CompatItem {
  slotLabel: string // "TM06", "HM01", or "" for tutors
  moveId: number
}

export function CompatGrid({
  items,
  moves,
  typeNames,
  flags,
  originalFlags,
  onToggle,
}: {
  items: CompatItem[]
  moves: MoveInfo[]
  typeNames: string[]
  flags: boolean[]
  originalFlags: boolean[]
  onToggle: (index: number) => void
}) {
  const learned = flags.filter(Boolean).length
  return (
    <div>
      <p className="mb-3 text-xs text-slate-500">
        {learned} of {items.length} learnable — click to toggle
      </p>
      <div className="grid max-w-4xl grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item, i) => {
          const move = moves[item.moveId]
          const changed = flags[i] !== (originalFlags[i] ?? false)
          return (
            <label
              key={i}
              className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-800/60 ${
                flags[i] ? 'text-slate-100' : 'text-slate-500'
              }`}
            >
              <input
                type="checkbox"
                checked={flags[i]}
                onChange={() => onToggle(i)}
                className="accent-emerald-500"
              />
              {item.slotLabel && (
                <span className="w-11 font-mono text-xs text-slate-500">{item.slotLabel}</span>
              )}
              <span className="min-w-0 flex-1 truncate font-medium">
                {move ? move.name : `move #${item.moveId}`}
              </span>
              {changed && <span className="text-xs text-amber-400">●</span>}
              {move && flags[i] && <TypeBadge typeId={move.type} typeNames={typeNames} />}
            </label>
          )
        })}
      </div>
    </div>
  )
}
