import { useMemo, useRef } from 'react'
import { useRomStore } from '../state/romStore'
import { useEditStore, effectiveEntries } from '../state/editStore'
import { diffAllLearnsets } from '../lib/diff'
import type { LearnsetEntry } from '../rom/tables/learnsets'

export function DiffPanel() {
  const loaded = useRomStore((s) => s.loaded)!
  const baseline = useRomStore((s) => s.baseline)
  const baselineError = useRomStore((s) => s.baselineError)
  const loadBaseline = useRomStore((s) => s.loadBaseline)
  const setDiffOpen = useRomStore((s) => s.setDiffOpen)
  const select = useRomStore((s) => s.select)
  const drafts = useEditStore((s) => s.drafts)
  const inputRef = useRef<HTMLInputElement>(null)

  const diffs = useMemo(() => {
    if (!baseline) return []
    const current = loaded.species.map((s) =>
      effectiveEntries(drafts, loaded.learnsets, s.id),
    )
    const base = baseline.learnsets.map((l) => l.entries)
    return diffAllLearnsets(current, base)
  }, [baseline, loaded, drafts])

  const moveName = (e: LearnsetEntry) => loaded.moves[e.moveId]?.name ?? `#${e.moveId}`

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-slate-800 bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
        <h3 className="font-semibold text-slate-100">Learnset diff</h3>
        {baseline && (
          <span className="truncate text-xs text-slate-500" title={baseline.fileName}>
            vs {baseline.fileName}
          </span>
        )}
        <button
          onClick={() => setDiffOpen(false)}
          className="ml-auto rounded px-2 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          title="Close"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!baseline ? (
          <div className="flex flex-col items-start gap-3 text-sm text-slate-400">
            <p>
              Pick a baseline ROM (e.g. your unmodified base) to see every learnset difference —
              including unsaved edits.
            </p>
            <button
              onClick={() => inputRef.current?.click()}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 font-medium text-white hover:bg-emerald-500"
            >
              Choose baseline…
            </button>
            <p className="text-xs text-slate-500">Select the .gba and its .toml together.</p>
            {baselineError && <p className="text-red-400">{baselineError}</p>}
            <input
              ref={inputRef}
              type="file"
              accept=".gba,.toml"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && loadBaseline([...e.target.files])}
            />
          </div>
        ) : diffs.length === 0 ? (
          <p className="text-sm text-slate-500">No learnset differences. 🎉</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">
              {diffs.length} species differ · click a name to jump
            </p>
            {diffs.map((d) => (
              <div key={d.species} className="mb-3">
                <button
                  onClick={() => select(d.species)}
                  className="font-medium text-slate-100 hover:text-emerald-300"
                >
                  <span className="mr-1 font-mono text-xs text-slate-500">
                    #{String(d.species).padStart(3, '0')}
                  </span>
                  {loaded.species[d.species]?.name}
                </button>
                <ul className="mt-0.5 space-y-0.5 pl-4 font-mono text-xs">
                  {d.removed.map((e, i) => (
                    <li key={`r${i}`} className="text-red-400/90">
                      − Lv{e.level} {moveName(e)}
                    </li>
                  ))}
                  {d.added.map((e, i) => (
                    <li key={`a${i}`} className="text-emerald-400/90">
                      + Lv{e.level} {moveName(e)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  )
}
