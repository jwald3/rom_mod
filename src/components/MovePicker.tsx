import { useMemo, useRef, useState } from 'react'
import type { MoveInfo } from '../rom/tables/moves'
import { fuzzyScore } from '../lib/fuzzy'
import { TypeBadge } from './TypeBadge'

const MAX_RESULTS = 40

export function MovePicker({
  moves,
  typeNames,
  recentMoves,
  onSelect,
  onClose,
}: {
  moves: MoveInfo[]
  typeNames: string[]
  recentMoves: number[]
  onSelect: (moveId: number) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) {
      const recent = recentMoves
        .map((id) => moves[id])
        .filter((m): m is MoveInfo => m !== undefined)
      const rest = moves.slice(1).filter((m) => !recentMoves.includes(m.id))
      return [...recent, ...rest].slice(0, MAX_RESULTS)
    }
    return moves
      .slice(1) // move 0 is the empty placeholder
      .map((m) => ({ m, score: fuzzyScore(q, m.name) }))
      .filter((x): x is { m: MoveInfo; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score || a.m.name.localeCompare(b.m.name))
      .slice(0, MAX_RESULTS)
      .map((x) => x.m)
  }, [query, moves, recentMoves])

  const pick = (m: MoveInfo | undefined) => {
    if (m) onSelect(m.id)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(results[highlight])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute left-0 top-full z-20 mt-1 w-96 rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search moves… (fuzzy: “thbolt”)"
          className="w-full rounded-t-lg border-b border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none"
        />
        <ul ref={listRef} className="max-h-72 overflow-y-auto py-1">
          {results.map((m, i) => (
            <li
              key={m.id}
              ref={(el) => {
                if (el && i === highlight) el.scrollIntoView({ block: 'nearest' })
              }}
            >
              <button
                onClick={() => pick(m)}
                onMouseMove={() => setHighlight(i)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  i === highlight ? 'bg-emerald-600/25 text-emerald-200' : 'text-slate-200'
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                {!query && recentMoves.includes(m.id) && (
                  <span className="text-[10px] uppercase text-slate-500">recent</span>
                )}
                <TypeBadge typeId={m.type} typeNames={typeNames} />
                <span className="w-8 text-right font-mono text-xs text-slate-400">
                  {m.power || '—'}
                </span>
                <span className="w-8 text-right font-mono text-xs text-slate-500">
                  {m.accuracy || '—'}
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-3 text-sm text-slate-500">No moves match “{query}”.</li>
          )}
        </ul>
      </div>
    </>
  )
}
