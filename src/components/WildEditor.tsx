import { useEffect, useMemo, useRef, useState } from 'react'
import { useRomStore } from '../state/romStore'
import { useEditStore, computeWildDirtyAreas, effectiveWildGroup } from '../state/editStore'
import {
  FISH_ROD_FOR_SLOT,
  WILD_KINDS,
  WILD_KIND_LABELS,
  WILD_SLOT_PERCENTS,
  type WildGroupEdit,
  type WildKind,
} from '../rom/tables/wild'
import { LevelInput } from './LevelInput'
import { SpeciesPicker } from './SpeciesPicker'
import { TypeBadge } from './TypeBadge'

/** Commit-on-blur encounter-rate field (0–255 covers every sane value). */
function RateInput({ rate, onCommit }: { rate: number; onCommit: (rate: number) => void }) {
  const [value, setValue] = useState(String(rate))
  useEffect(() => setValue(String(rate)), [rate])
  const commit = () => {
    const n = parseInt(value, 10)
    if (Number.isNaN(n)) {
      setValue(String(rate))
      return
    }
    const clamped = Math.max(0, Math.min(255, n))
    setValue(String(clamped))
    if (clamped !== rate) onCommit(clamped)
  }
  return (
    <input
      type="number"
      min={0}
      max={255}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-0.5 text-right font-mono text-sm text-slate-200 outline-none focus:border-emerald-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
    />
  )
}

export function WildEditor() {
  const loaded = useRomStore((s) => s.loaded)!
  const selectedArea = useRomStore((s) => s.selectedArea)
  const wildDrafts = useEditStore((s) => s.wildDrafts)
  const { applyWild, revertWild } = useEditStore.getState()

  const [picker, setPicker] = useState<{ kind: WildKind; slot: number } | null>(null)
  const scrollRef = useRef<HTMLElement>(null)

  const area = loaded.wildAreas[selectedArea]
  const dirty = useMemo(
    () => computeWildDirtyAreas(wildDrafts, loaded).has(selectedArea),
    [wildDrafts, loaded, selectedArea],
  )

  useEffect(() => {
    setPicker(null)
    scrollRef.current?.scrollTo(0, 0)
  }, [selectedArea])

  if (!area) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center text-slate-500">
        No wild encounter data in this ROM.
      </main>
    )
  }

  const update = (kind: WildKind, mutate: (g: WildGroupEdit) => WildGroupEdit) => {
    const current = effectiveWildGroup(wildDrafts, loaded, selectedArea, kind)
    if (current) applyWild(selectedArea, kind, mutate(current))
  }

  const setSlot = (kind: WildKind, slot: number, patch: Partial<WildGroupEdit['slots'][number]>) => {
    update(kind, (g) => ({
      ...g,
      slots: g.slots.map((s, i) => {
        if (i !== slot) return s
        const next = { ...s, ...patch }
        // Keep the range coherent from either end.
        if (patch.low !== undefined && next.low > next.high) next.high = next.low
        if (patch.high !== undefined && next.high < next.low) next.low = next.high
        return next
      }),
    }))
  }

  return (
    <main ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
        <span className="font-mono text-slate-500">
          {area.bank}.{area.map}
        </span>
        <h2 className="text-lg font-semibold text-slate-100">{area.name}</h2>
        {dirty && (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300">
            ● modified
          </span>
        )}
        <span className="ml-auto text-xs text-slate-500">
          click any species, level, or rate to edit
        </span>
        <button
          onClick={() => revertWild(selectedArea)}
          disabled={!dirty}
          className="rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          title="Discard changes to this area"
        >
          Revert
        </button>
      </header>

      <div className="space-y-8 p-6">
        {WILD_KINDS.map((kind) => {
          const group = effectiveWildGroup(wildDrafts, loaded, selectedArea, kind)
          if (!group) return null
          return (
            <section key={kind} className="max-w-3xl">
              <div className="mb-2 flex items-center gap-3">
                <h3 className="font-semibold text-slate-100">{WILD_KIND_LABELS[kind]}</h3>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  encounter rate
                  <RateInput rate={group.rate} onCommit={(rate) => update(kind, (g) => ({ ...g, rate }))} />
                </label>
              </div>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="w-24 px-3 py-1.5">Odds</th>
                    <th className="px-3 py-1.5">Species</th>
                    <th className="w-20 px-3 py-1.5">Type</th>
                    <th className="w-44 whitespace-nowrap px-3 py-1.5 text-right">Levels</th>
                  </tr>
                </thead>
                <tbody>
                  {group.slots.map((slot, i) => {
                    const sp = loaded.species[slot.species]
                    return (
                      <tr
                        key={i}
                        className="border-t border-slate-800/70 odd:bg-slate-900/40 hover:bg-slate-800/50"
                      >
                        <td className="px-3 py-1 font-mono text-xs text-slate-500">
                          {WILD_SLOT_PERCENTS[kind][i]}%
                          {kind === 'fish' && (
                            <span className="ml-1 text-slate-600">{FISH_ROD_FOR_SLOT(i)}</span>
                          )}
                        </td>
                        <td className="px-3 py-1">
                          <div className="relative">
                            <button
                              onClick={() => setPicker({ kind, slot: i })}
                              className="flex w-52 items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-left font-medium text-slate-100 hover:border-slate-500 hover:text-emerald-300"
                              title="Change species"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {sp ? sp.name : `species #${slot.species}`}
                              </span>
                              <span className="font-mono text-xs text-slate-600">
                                #{slot.species}
                              </span>
                              <span className="text-xs text-slate-500">▾</span>
                            </button>
                            {picker?.kind === kind && picker.slot === i && (
                              <SpeciesPicker
                                species={loaded.species}
                                typeNames={loaded.typeNames}
                                onSelect={(id) => {
                                  setSlot(kind, i, { species: id })
                                  setPicker(null)
                                }}
                                onClose={() => setPicker(null)}
                              />
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-1">
                          {sp && <TypeBadge typeId={sp.type1} typeNames={loaded.typeNames} />}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1 text-right">
                          <LevelInput level={slot.low} onCommit={(low) => setSlot(kind, i, { low })} />
                          <span className="text-slate-600">–</span>
                          <LevelInput level={slot.high} onCommit={(high) => setSlot(kind, i, { high })} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )
        })}
        {WILD_KINDS.every((k) => !area.groups[k]) && (
          <p className="text-slate-500">This area has no encounter groups.</p>
        )}
      </div>
    </main>
  )
}
