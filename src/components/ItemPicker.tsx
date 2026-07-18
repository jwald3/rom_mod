import { useMemo, useState } from 'react'
import { fuzzyScore } from '../lib/fuzzy'

const MAX_RESULTS = 40

/** Searchable dropdown over the item-name table. id 0 = "none". */
export function ItemPicker({
  itemNames,
  onSelect,
  onClose,
  noneLabel = '— no held item —',
}: {
  itemNames: string[]
  onSelect: (itemId: number) => void
  onClose: () => void
  noneLabel?: string
}) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  const results = useMemo(() => {
    const q = query.trim()
    const pool = itemNames.map((name, id) => ({ id, name }))
    if (!q) return pool.slice(0, MAX_RESULTS)
    if (/^\d+$/.test(q)) return pool.filter((x) => String(x.id).startsWith(q)).slice(0, MAX_RESULTS)
    return pool
      .map((x) => ({ x, score: fuzzyScore(q, x.name) }))
      .filter((r): r is { x: { id: number; name: string }; score: number } => r.score !== null)
      .sort((a, b) => b.score - a.score || a.x.name.localeCompare(b.x.name))
      .slice(0, MAX_RESULTS)
      .map((r) => r.x)
  }, [query, itemNames])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[highlight]) onSelect(results[highlight].id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search items… (name or #)"
          className="w-full rounded-t-lg border-b border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none"
        />
        <ul className="max-h-72 overflow-y-auto py-1">
          <li>
            <button
              onClick={() => onSelect(0)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm italic text-slate-400"
            >
              {noneLabel}
            </button>
          </li>
          {results
            .filter((x) => x.id !== 0)
            .map((x, i) => (
              <li
                key={x.id}
                ref={(el) => {
                  if (el && i === highlight) el.scrollIntoView({ block: 'nearest' })
                }}
              >
                <button
                  onClick={() => onSelect(x.id)}
                  onMouseMove={() => setHighlight(i)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    i === highlight ? 'bg-emerald-600/25 text-emerald-200' : 'text-slate-200'
                  }`}
                >
                  <span className="w-10 font-mono text-xs text-slate-500">#{x.id}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{x.name}</span>
                </button>
              </li>
            ))}
          {results.length === 0 && (
            <li className="px-3 py-3 text-sm text-slate-500">No items match “{query}”.</li>
          )}
        </ul>
      </div>
    </>
  )
}
