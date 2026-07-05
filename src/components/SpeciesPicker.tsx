import { useMemo, useState } from 'react'
import type { SpeciesInfo } from '../rom/tables/species'
import { isGapSpecies } from '../rom/tables/species'
import { fuzzyScore } from '../lib/fuzzy'
import { TypeBadge } from './TypeBadge'

const MAX_RESULTS = 40

export function SpeciesPicker({
  species,
  typeNames,
  onSelect,
  onClose,
}: {
  species: SpeciesInfo[]
  typeNames: string[]
  onSelect: (speciesId: number) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  const results = useMemo(() => {
    const q = query.trim()
    const pool = species.filter((s) => s.id !== 0 && (!isGapSpecies(s) || /^\d+$/.test(q)))
    if (!q) return pool.slice(0, MAX_RESULTS)
    if (/^\d+$/.test(q)) return pool.filter((s) => String(s.id).startsWith(q)).slice(0, MAX_RESULTS)
    return pool
      .map((s) => ({ s, score: fuzzyScore(q, s.name) }))
      .filter((x): x is { s: SpeciesInfo; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
      .slice(0, MAX_RESULTS)
      .map((x) => x.s)
  }, [query, species])

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
      <div className="absolute left-0 top-full z-20 mt-1 w-96 rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search species… (name or #)"
          className="w-full rounded-t-lg border-b border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none"
        />
        <ul className="max-h-72 overflow-y-auto py-1">
          {results.map((s, i) => (
            <li
              key={s.id}
              ref={(el) => {
                if (el && i === highlight) el.scrollIntoView({ block: 'nearest' })
              }}
            >
              <button
                onClick={() => onSelect(s.id)}
                onMouseMove={() => setHighlight(i)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  i === highlight ? 'bg-emerald-600/25 text-emerald-200' : 'text-slate-200'
                }`}
              >
                <span className="w-10 font-mono text-xs text-slate-500">
                  #{String(s.id).padStart(3, '0')}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                <TypeBadge typeId={s.type1} typeNames={typeNames} />
                {s.type2 !== s.type1 && <TypeBadge typeId={s.type2} typeNames={typeNames} />}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-3 text-sm text-slate-500">No species match “{query}”.</li>
          )}
        </ul>
      </div>
    </>
  )
}
