import { useMemo, useState } from 'react'
import { useRomStore } from '../state/romStore'
import { useEditStore, computeGcDirty, effectivePrizes } from '../state/editStore'
import { PRIZE_KIND_LABELS, type Prize } from '../rom/tables/gameCorner'
import { LevelInput } from './LevelInput'
import { SpeciesPicker } from './SpeciesPicker'
import { ItemPicker } from './ItemPicker'

/** Vanilla give-level used for a newly added Pokémon prize. */
const DEFAULT_PRIZE_LEVEL = 10

export function GameCornerEditor() {
  const loaded = useRomStore((s) => s.loaded)!
  const kind = useRomStore((s) => s.selectedPrizeKind)
  const gcDrafts = useEditStore((s) => s.gcDrafts)
  const { applyGameCorner } = useEditStore.getState()

  const [picker, setPicker] = useState<number | null>(null)

  const list = loaded.prizeLists[kind]
  const entries = effectivePrizes(gcDrafts, loaded, kind)
  const dirty = useMemo(() => computeGcDirty(gcDrafts, loaded).has(kind), [gcDrafts, loaded, kind])
  const isPokemon = kind === 'pokemon'

  const commit = (next: Prize[]) => applyGameCorner(kind, next)
  const setRow = (i: number, patch: Partial<Prize>) =>
    commit(entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  const removeRow = (i: number) => commit(entries.filter((_, idx) => idx !== i))
  const addRow = () => {
    const base: Prize = isPokemon ? { id: 1, cost: 100, level: DEFAULT_PRIZE_LEVEL } : { id: 1, cost: 100 }
    commit([...entries, base])
  }
  const revert = () => applyGameCorner(kind, list.entries)

  const nameOf = (id: number) =>
    isPokemon ? (loaded.species[id]?.name ?? `#${id}`) : (loaded.itemNames[id] ?? `#${id}`)

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
        <h2 className="text-lg font-semibold text-slate-100">{PRIZE_KIND_LABELS[kind]} prizes</h2>
        {dirty && (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300">
            ● modified
          </span>
        )}
        {!list.regenerable && (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
            unsupported layout — read-only
          </span>
        )}
        <span className="ml-auto text-xs text-slate-500">{entries.length} prizes</span>
        <button
          onClick={revert}
          disabled={!dirty}
          className="rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          title="Discard changes to this list"
        >
          Revert
        </button>
      </header>

      <div className="max-w-3xl p-6">
        {!list.regenerable ? (
          <p className="text-slate-400">
            This ROM’s {PRIZE_KIND_LABELS[kind]} prize layout wasn’t recognized, so it can’t be
            edited safely. (The prizes are stored in map script bytecode; a modded ROM may have
            repointed or restructured them.)
          </p>
        ) : (
          <>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="w-10 px-3 py-1.5">#</th>
                  <th className="px-3 py-1.5">{isPokemon ? 'Pokémon' : 'Item'}</th>
                  {isPokemon && <th className="w-20 px-3 py-1.5 text-right">Level</th>}
                  <th className="w-28 px-3 py-1.5 text-right">Cost (coins)</th>
                  <th className="w-10 px-3 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i} className="border-t border-slate-800/70 odd:bg-slate-900/40 hover:bg-slate-800/50">
                    <td className="px-3 py-1 font-mono text-xs text-slate-500">{i + 1}</td>
                    <td className="px-3 py-1">
                      <div className="relative">
                        <button
                          onClick={() => setPicker(i)}
                          className="flex w-64 items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-left font-medium text-slate-100 hover:border-slate-500 hover:text-emerald-300"
                          title={`Change ${isPokemon ? 'Pokémon' : 'item'}`}
                        >
                          <span className="min-w-0 flex-1 truncate">{nameOf(e.id)}</span>
                          <span className="font-mono text-xs text-slate-600">#{e.id}</span>
                          <span className="text-xs text-slate-500">▾</span>
                        </button>
                        {picker === i &&
                          (isPokemon ? (
                            <SpeciesPicker
                              species={loaded.species}
                              typeNames={loaded.typeNames}
                              onSelect={(id) => {
                                setRow(i, { id })
                                setPicker(null)
                              }}
                              onClose={() => setPicker(null)}
                            />
                          ) : (
                            <ItemPicker
                              itemNames={loaded.itemNames}
                              onSelect={(id) => {
                                setRow(i, { id })
                                setPicker(null)
                              }}
                              onClose={() => setPicker(null)}
                            />
                          ))}
                      </div>
                    </td>
                    {isPokemon && (
                      <td className="px-3 py-1 text-right">
                        <LevelInput
                          level={e.level ?? DEFAULT_PRIZE_LEVEL}
                          onCommit={(level) => setRow(i, { level })}
                        />
                      </td>
                    )}
                    <td className="px-3 py-1 text-right">
                      <LevelInput
                        level={e.cost}
                        min={0}
                        max={9999}
                        onCommit={(cost) => setRow(i, { cost })}
                      />
                    </td>
                    <td className="px-3 py-1 text-right">
                      <button
                        onClick={() => removeRow(i)}
                        className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-red-900/40 hover:text-red-300"
                        title="Remove this prize"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={addRow}
                className="rounded-lg border border-emerald-700 bg-emerald-600/10 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-600/20"
              >
                + Add prize
              </button>
              <span className="text-xs text-slate-500">
                The menu shows one “NO THANKS” row automatically; you don’t add it here.
              </span>
            </div>

            {isPokemon && (
              <p className="mt-6 text-xs text-slate-500">
                Level is the level of the Pokémon the player receives. Cost is the number of coins.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  )
}
