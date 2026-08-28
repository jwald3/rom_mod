import { useEffect, useMemo, useState } from 'react'
import { useRomStore } from '../state/romStore'
import {
  useEditStore,
  effectiveEntries,
  effectiveWildGroup,
  effectiveBaseStats,
  computeAllDirty,
} from '../state/editStore'
import type { BaseStatsEdit } from '../rom/writer'
import { quickRate } from '../sim'
import { useQuickRate } from './useQuickRate'
import { sortEntries, type LearnsetEntry } from '../rom/tables/learnsets'
import { tmSlotLabel } from '../rom/tables/compat'
import { WILD_KINDS, WILD_KIND_LABELS, WILD_SLOT_PERCENTS } from '../rom/tables/wild'
import {
  describeEvolution,
  evoParamKind,
  evoMethodLabel,
  EVO_METHOD_LABELS,
  type Evolution,
} from '../rom/tables/evolutions'
import { SpeciesPicker } from './SpeciesPicker'
import { validateLearnset } from '../rom/validate'
import type { MoveInfo } from '../rom/tables/moves'
import { TypeBadge } from './TypeBadge'
import { MovePicker } from './MovePicker'
import { CompatGrid } from './CompatGrid'
import { LevelInput } from './LevelInput'

type Tab = 'levelup' | 'tm' | 'tutor' | 'evo' | 'stats' | 'locations'

const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const
const STAT_LABELS: Record<(typeof STAT_KEYS)[number], string> = {
  hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
}

function stat(v: number): string {
  return v === 0 ? '—' : String(v)
}

export function LearnsetEditor() {
  const loaded = useRomStore((s) => s.loaded)!
  const selected = useRomStore((s) => s.selected)
  const selectArea = useRomStore((s) => s.selectArea)
  const drafts = useEditStore((s) => s.drafts)
  const tmDrafts = useEditStore((s) => s.tmDrafts)
  const tutorDrafts = useEditStore((s) => s.tutorDrafts)
  const tutorMovesDraft = useEditStore((s) => s.tutorMovesDraft)
  const wildDrafts = useEditStore((s) => s.wildDrafts)
  const evoDrafts = useEditStore((s) => s.evoDrafts)
  const baseStatsDrafts = useEditStore((s) => s.baseStatsDrafts)
  const clipboard = useEditStore((s) => s.clipboard)
  const recentMoves = useEditStore((s) => s.recentMoves)
  const { apply, applyCompat, applyTutorMoves, applyEvos, applyBaseStats, revert, copy, paste, noteRecentMove } =
    useEditStore.getState()

  const [tab, setTab] = useState<Tab>('levelup')
  const [picker, setPicker] = useState<number | 'add' | null>(null)
  const [evoPicker, setEvoPicker] = useState<number | 'add' | null>(null)
  /** Which tutor slot is having its move reassigned (global roster edit). */
  const [tutorSlotPicker, setTutorSlotPicker] = useState<number | null>(null)
  const [focusLevel, setFocusLevel] = useState<number | null>(null)
  /** Forced sim moveset (4 slots) for the win-rate readout; null = auto-pick. */
  const [simMoves, setSimMoves] = useState<number[] | null>(null)
  /** Which sim move slot is being edited (0–3), or null. */
  const [simMovePicker, setSimMovePicker] = useState<number | null>(null)
  /** True while the (slow) optimize search runs. */
  const [optimizing, setOptimizing] = useState(false)

  const species = loaded.species[selected]
  const entries = effectiveEntries(drafts, loaded.learnsets, selected)
  const bs = effectiveBaseStats(baseStatsDrafts, loaded, selected)
  const bst = STAT_KEYS.reduce((n, k) => n + bs.stats[k], 0)
  /** Apply one field of the base-stats draft, leaving the rest untouched. */
  const patchBaseStats = (
    change: Partial<Omit<BaseStatsEdit, 'stats'>> & { stats?: Partial<BaseStatsEdit['stats']> },
  ) =>
    applyBaseStats(selected, {
      ...bs,
      ...change,
      stats: { ...bs.stats, ...(change.stats ?? {}) },
    })
  const dirty = useMemo(
    () => computeAllDirty({ drafts, tmDrafts, tutorDrafts, evoDrafts, baseStatsDrafts }, loaded).has(selected),
    [drafts, tmDrafts, tutorDrafts, evoDrafts, baseStatsDrafts, loaded, selected],
  )
  // Live "how good is it" readout for the Stats tab. Baseline = the ROM as-is
  // (memoized per species); the draft rate re-runs debounced as you edit.
  const statsTab = tab === 'stats'
  const baseline = useMemo(
    () => (statsTab ? quickRate(loaded, species) : null),
    [statsTab, loaded, species],
  )
  const { result: draftRate, pending: ratePending } = useQuickRate(
    loaded,
    species,
    bs,
    statsTab,
    simMoves ?? undefined,
  )
  // The moves currently driving the rate: the forced set, else what the harness
  // auto-picked (shown so you can see and then override them).
  const simMoveIds = simMoves ?? draftRate?.moveIds ?? []
  const tmFlags = tmDrafts[selected] ?? loaded.tmCompat[selected] ?? []
  const tutorFlags = tutorDrafts[selected] ?? loaded.tutorCompat[selected] ?? []
  const tmItems = useMemo(
    () => loaded.tmMoves.map((moveId, i) => ({ slotLabel: tmSlotLabel(i), moveId })),
    [loaded],
  )
  // The tutor roster is global (shared across species). Show the draft when the
  // move list has been edited, so both the compat grid and the slot editor agree.
  const effectiveTutorMoveIds = tutorMovesDraft ?? loaded.tutorMoves
  const tutorRosterDirty = tutorMovesDraft !== null
  const tutorItems = useMemo(
    () => effectiveTutorMoveIds.map((moveId) => ({ slotLabel: '', moveId })),
    [effectiveTutorMoveIds],
  )

  const select = useRomStore((s) => s.select)

  // Evolution context (drafts included): what this species evolves into, and
  // what evolves into it.
  const effectiveEvoLists = useMemo(
    () => loaded.evolutions.map((list, id) => evoDrafts[id] ?? list),
    [loaded, evoDrafts],
  )
  const evolutions = effectiveEvoLists[selected] ?? []
  const preEvolutions = useMemo(
    () =>
      effectiveEvoLists.flatMap((list, from) =>
        list.filter((e) => e.target === selected).map((e) => ({ from, evo: e })),
      ),
    [effectiveEvoLists, selected],
  )

  const setEvo = (index: number, patch: Partial<Evolution>) => {
    applyEvos(
      selected,
      evolutions.map((e, i) => {
        if (i !== index) return e
        const next = { ...e, ...patch }
        // Method changes can invalidate the param — reset to a sane default.
        if (patch.method !== undefined && evoParamKind(patch.method) !== evoParamKind(e.method)) {
          const kind = evoParamKind(patch.method)
          next.param =
            kind === 'level' ? 20 : kind === 'beauty' ? 170 : kind === 'item' ? 0 : 0
        }
        return next
      }),
    )
  }

  // Reverse lookup: everywhere this species appears in the wild (drafts included).
  const locations = useMemo(() => {
    const out: { area: number; name: string; kind: string; percent: number; low: number; high: number }[] = []
    for (const area of loaded.wildAreas) {
      for (const kind of WILD_KINDS) {
        const group = effectiveWildGroup(wildDrafts, loaded, area.index, kind)
        if (!group) continue
        let percent = 0
        let low = 101
        let high = 0
        group.slots.forEach((s, i) => {
          if (s.species !== selected) return
          percent += WILD_SLOT_PERCENTS[kind][i]
          low = Math.min(low, s.low)
          high = Math.max(high, s.high)
        })
        if (percent > 0) {
          out.push({ area: area.index, name: area.name, kind: WILD_KIND_LABELS[kind], percent, low, high })
        }
      }
    }
    return out
  }, [loaded, wildDrafts, selected])
  const warnings = useMemo(() => validateLearnset(entries, loaded.moves.length), [entries, loaded])
  const rowWarnings = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const w of warnings) {
      if (w.index >= 0) map.set(w.index, [...(map.get(w.index) ?? []), w.message])
    }
    return map
  }, [warnings])

  // Reset transient UI state when switching species.
  useEffect(() => {
    setPicker(null)
    setEvoPicker(null)
    setFocusLevel(null)
    setSimMoves(null) // sim moveset override is per-species; back to auto-pick
    setSimMovePicker(null)
    setOptimizing(false)
  }, [selected])

  if (!species) return null

  const setLevel = (index: number, level: number) => {
    const next = entries.map((e, i) => (i === index ? { ...e, level } : e))
    apply(selected, sortEntries(next))
    setFocusLevel(null)
  }

  const setMove = (index: number, moveId: number) => {
    apply(selected, entries.map((e, i) => (i === index ? { ...e, moveId } : e)))
    noteRecentMove(moveId)
    setPicker(null)
  }

  const addMove = (moveId: number) => {
    const level = entries.length > 0 ? entries[entries.length - 1].level : 1
    const next: LearnsetEntry[] = [...entries, { level, moveId }]
    apply(selected, next)
    noteRecentMove(moveId)
    setPicker(null)
    setFocusLevel(next.length - 1) // focus the new row's level; sorts on commit
  }

  const remove = (index: number) => {
    apply(selected, entries.filter((_, i) => i !== index))
  }

  const moveCell = (e: LearnsetEntry, i: number) => {
    const move: MoveInfo | undefined = loaded.moves[e.moveId]
    return (
      <div className="relative">
        <button
          onClick={() => setPicker(i)}
          className="rounded px-1 py-0.5 text-left font-medium text-slate-100 hover:bg-slate-700/50 hover:text-emerald-300"
          title="Change move"
        >
          {move ? move.name : `⚠ move #${e.moveId}`}
          <span className="ml-2 font-mono text-xs text-slate-600">#{e.moveId}</span>
        </button>
        {picker === i && (
          <MovePicker
            moves={loaded.moves}
            typeNames={loaded.typeNames}
            recentMoves={recentMoves}
            onSelect={(id) => setMove(i, id)}
            onClose={() => setPicker(null)}
          />
        )}
      </div>
    )
  }

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
        <span className="font-mono text-slate-500">#{String(species.id).padStart(3, '0')}</span>
        <h2 className="text-lg font-semibold text-slate-100">{species.name}</h2>
        <TypeBadge typeId={species.type1} typeNames={loaded.typeNames} />
        {species.type2 !== species.type1 && (
          <TypeBadge typeId={species.type2} typeNames={loaded.typeNames} />
        )}
        {dirty && (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300">
            ● modified
          </span>
        )}
        <div className="ml-auto flex items-center gap-2 text-sm">
          <button
            onClick={() => copy(selected)}
            className="rounded-lg border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
            title="Copy this learnset"
          >
            Copy
          </button>
          <button
            onClick={() => paste(selected)}
            disabled={!clipboard}
            className="rounded-lg border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            title={clipboard ? `Paste ${clipboard.length} moves (replaces this learnset)` : 'Copy a learnset first'}
          >
            Paste
          </button>
          <button
            onClick={() => revert(selected)}
            disabled={!dirty}
            className="rounded-lg border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            title="Discard changes to this species"
          >
            Revert
          </button>
        </div>
        </div>

        <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
          <span className="font-mono">
            HP {bs.stats.hp} · ATK {bs.stats.atk} · DEF {bs.stats.def} · SPA {bs.stats.spa} · SPD{' '}
            {bs.stats.spd} · SPE {bs.stats.spe} · BST {bst}
          </span>
          <span>
            {loaded.abilityNames[bs.ability1] ?? `ability #${bs.ability1}`}
            {bs.ability2 !== 0 &&
              bs.ability2 !== bs.ability1 &&
              ` / ${loaded.abilityNames[bs.ability2] ?? `ability #${bs.ability2}`}`}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
          {preEvolutions.map(({ from, evo }) => (
            <button
              key={`pre-${from}`}
              onClick={() => select(from)}
              className="text-slate-500 hover:text-emerald-300"
              title="Go to pre-evolution"
            >
              ⇠ from {loaded.species[from]?.name} ({describeEvolution(evo, loaded.itemNames)})
            </button>
          ))}
          {evolutions.map((evo, i) => (
            <button
              key={`evo-${i}`}
              onClick={() => select(evo.target)}
              className="text-slate-300 hover:text-emerald-300"
              title="Go to evolution"
            >
              ⇢ {loaded.species[evo.target]?.name ?? `#${evo.target}`}{' '}
              <span className="text-slate-500">({describeEvolution(evo, loaded.itemNames)})</span>
            </button>
          ))}
          {evolutions.length === 0 && preEvolutions.length === 0 && (
            <span className="text-slate-600">does not evolve</span>
          )}
        </div>

        <nav className="mt-3 flex gap-1">
          {(
            [
              ['levelup', `Level-up (${entries.length})`],
              ['tm', `TM/HM (${tmFlags.filter(Boolean).length})`],
              ['tutor', `Tutors (${tutorFlags.filter(Boolean).length})`],
              ['evo', `Evolution (${evolutions.length})`],
              ['stats', 'Stats & Types'],
              ['locations', `Locations (${locations.length})`],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-t-lg px-4 py-1.5 text-sm font-medium ${
                tab === id
                  ? 'bg-slate-800 text-emerald-300'
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'tm' && (
        <div className="p-6">
          <CompatGrid
            items={tmItems}
            moves={loaded.moves}
            typeNames={loaded.typeNames}
            flags={tmFlags}
            originalFlags={loaded.tmCompat[selected] ?? []}
            onToggle={(i) => {
              const next = [...tmFlags]
              next[i] = !next[i]
              applyCompat('tm', selected, next)
            }}
          />
        </div>
      )}

      {tab === 'tutor' && (
        <div className="p-6">
          <details className="mb-6 rounded-lg border border-slate-700 bg-slate-800/40">
            <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-slate-200">
              Tutor move roster
              <span className="ml-2 text-xs text-slate-400">
                ({effectiveTutorMoveIds.length} slots — sets what every tutor teaches)
              </span>
              {tutorRosterDirty && (
                <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                  edited
                </span>
              )}
            </summary>
            <div className="border-t border-slate-700 px-4 py-3">
              <p className="mb-3 text-xs text-slate-400">
                Reassign which move each tutor slot teaches. This is a{' '}
                <strong className="text-slate-300">global</strong> change — it affects the move
                offered by that tutor for <em>every</em> species. Slot count is fixed; the per-species
                checkboxes below decide who can learn each slot.
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-1.5">
                {effectiveTutorMoveIds.map((moveId, i) => {
                  const changed = moveId !== (loaded.tutorMoves[i] ?? -1)
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setTutorSlotPicker(i)}
                      className={`flex items-center gap-2 rounded border px-2 py-1.5 text-left text-sm transition-colors ${
                        changed
                          ? 'border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20'
                          : 'border-slate-700 bg-slate-800/60 hover:border-slate-500 hover:bg-slate-700/60'
                      }`}
                      title={changed ? `was ${loaded.moves[loaded.tutorMoves[i]]?.name ?? '—'}` : 'Change this tutor move'}
                    >
                      <span className="w-8 shrink-0 font-mono text-[11px] text-slate-500">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="truncate text-slate-100">
                        {loaded.moves[moveId]?.name ?? `#${moveId}`}
                      </span>
                    </button>
                  )
                })}
              </div>
              {tutorRosterDirty && (
                <button
                  type="button"
                  onClick={() => applyTutorMoves([...loaded.tutorMoves])}
                  className="mt-3 text-xs text-slate-400 underline underline-offset-2 hover:text-slate-200"
                >
                  Reset roster to ROM
                </button>
              )}
            </div>
          </details>
          <CompatGrid
            items={tutorItems}
            moves={loaded.moves}
            typeNames={loaded.typeNames}
            flags={tutorFlags}
            originalFlags={loaded.tutorCompat[selected] ?? []}
            onToggle={(i) => {
              const next = [...tutorFlags]
              next[i] = !next[i]
              applyCompat('tutor', selected, next)
            }}
          />
        </div>
      )}

      {tab === 'evo' && (
        <div className="max-w-3xl p-6">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Evolves into</th>
                <th className="w-52 px-3 py-2">Method</th>
                <th className="w-56 px-3 py-2">Condition</th>
                <th className="w-10 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {evolutions.map((evo, i) => {
                const kind = evoParamKind(evo.method)
                return (
                  <tr
                    key={i}
                    className="group border-t border-slate-800/70 odd:bg-slate-900/40 hover:bg-slate-800/50"
                  >
                    <td className="px-3 py-1.5">
                      <div className="relative">
                        <button
                          onClick={() => setEvoPicker(i)}
                          className="flex w-52 items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-left font-medium text-slate-100 hover:border-slate-500 hover:text-emerald-300"
                          title="Change target species"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {loaded.species[evo.target]?.name ?? `#${evo.target}`}
                          </span>
                          <span className="font-mono text-xs text-slate-600">#{evo.target}</span>
                          <span className="text-xs text-slate-500">▾</span>
                        </button>
                        {evoPicker === i && (
                          <SpeciesPicker
                            species={loaded.species}
                            typeNames={loaded.typeNames}
                            onSelect={(id) => {
                              setEvo(i, { target: id })
                              setEvoPicker(null)
                            }}
                            onClose={() => setEvoPicker(null)}
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        value={evo.method}
                        onChange={(e) => setEvo(i, { method: Number(e.target.value) })}
                        className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-emerald-500"
                      >
                        {Object.entries(EVO_METHOD_LABELS).map(([m, label]) => (
                          <option key={m} value={m}>
                            {label}
                          </option>
                        ))}
                        {!(evo.method in EVO_METHOD_LABELS) && (
                          <option value={evo.method}>{evoMethodLabel(evo.method)}</option>
                        )}
                      </select>
                    </td>
                    <td className="px-3 py-1.5">
                      {kind === 'level' && (
                        <label className="flex items-center gap-2 text-xs text-slate-500">
                          at level
                          <LevelInput level={evo.param} onCommit={(param) => setEvo(i, { param })} />
                        </label>
                      )}
                      {kind === 'beauty' && (
                        <label className="flex items-center gap-2 text-xs text-slate-500">
                          beauty ≥
                          <LevelInput
                            level={evo.param}
                            min={0}
                            max={255}
                            onCommit={(param) => setEvo(i, { param })}
                          />
                        </label>
                      )}
                      {kind === 'item' && (
                        <select
                          value={evo.param}
                          onChange={(e) => setEvo(i, { param: Number(e.target.value) })}
                          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-emerald-500"
                        >
                          {loaded.itemNames.map((name, id) => (
                            <option key={id} value={id}>
                              {name || `item #${id}`}
                            </option>
                          ))}
                        </select>
                      )}
                      {kind === 'move' && (
                        <select
                          value={evo.param}
                          onChange={(e) => setEvo(i, { param: Number(e.target.value) })}
                          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-emerald-500"
                          title="Evolves upon knowing this move"
                        >
                          {loaded.moves.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name || `move #${m.id}`}
                            </option>
                          ))}
                        </select>
                      )}
                      {kind === 'none' && <span className="text-xs text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        onClick={() => applyEvos(selected, evolutions.filter((_, j) => j !== i))}
                        className="rounded px-1.5 text-slate-600 opacity-0 hover:bg-red-900/40 hover:text-red-300 group-hover:opacity-100"
                        title="Remove evolution"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
              {evolutions.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                    Does not evolve — add a branch below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="relative mt-2">
            <button
              onClick={() => setEvoPicker('add')}
              disabled={evolutions.length >= loaded.anchors.evosPerSpecies}
              className="w-full rounded-lg border border-dashed border-slate-700 px-3 py-2 text-left text-sm text-slate-400 hover:border-emerald-600 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
              title={
                evolutions.length >= loaded.anchors.evosPerSpecies
                  ? `The ROM supports at most ${loaded.anchors.evosPerSpecies} evolutions per species`
                  : 'Add an evolution branch'
              }
            >
              + Add evolution… ({evolutions.length}/{loaded.anchors.evosPerSpecies})
            </button>
            {evoPicker === 'add' && (
              <SpeciesPicker
                species={loaded.species}
                typeNames={loaded.typeNames}
                onSelect={(id) => {
                  applyEvos(selected, [...evolutions, { method: 4, param: 20, target: id }])
                  setEvoPicker(null)
                }}
                onClose={() => setEvoPicker(null)}
              />
            )}
          </div>

          <p className="mt-4 text-xs text-slate-600">
            Written in place (fixed 5-slot table). Branch methods like Atk/Def splits and
            Silcoon/Cascoon halves only fire correctly on species the engine expects, but levels,
            stones, friendship, and trade work anywhere.
          </p>
        </div>
      )}

      {tab === 'stats' && (
        <div className="space-y-6 p-6">
          {/* Live win-rate readout */}
          <section className="rounded-lg border border-slate-700 bg-slate-900/60 p-4">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-slate-200">
                Win rate vs. gyms, Elite Four &amp; Red
              </h3>
              <span className="text-[11px] text-slate-500">
                simulated at level parity{ratePending ? ' · rating…' : ''}
              </span>
            </div>
            {draftRate ? (
              <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-2">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-3xl font-bold text-emerald-300">
                      {draftRate.winRate}%
                    </span>
                    {baseline && draftRate.winRate !== baseline.winRate && (
                      <span
                        className={`font-mono text-sm font-semibold ${
                          draftRate.winRate > baseline.winRate ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {draftRate.winRate > baseline.winRate ? '▲ +' : '▼ '}
                        {draftRate.winRate - baseline.winRate}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    mean win rate{baseline ? ` · ROM baseline ${baseline.winRate}%` : ''}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-lg text-slate-200">
                    {draftRate.viability > 0 ? '+' : ''}
                    {draftRate.viability.toFixed(2)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    viability (−1…+1) · {draftRate.opponents} opponents
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                {ratePending ? 'Rating…' : 'No type chart in this ROM — can’t simulate.'}
              </p>
            )}

            {/* Editable simulation moveset */}
            <div className="mt-3 border-t border-slate-800 pt-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Moves used {simMoves ? '(custom)' : '(auto-picked)'}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    disabled={optimizing}
                    onClick={() => {
                      setOptimizing(true)
                      // Let the "Optimizing…" label paint before the blocking search.
                      setTimeout(() => {
                        const best = quickRate(loaded, species, bs, { optimize: true })
                        if (best) setSimMoves(best.moveIds)
                        setOptimizing(false)
                      }, 20)
                    }}
                    className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 disabled:text-slate-500"
                    title="Search for the moveset that wins the most battles (a few seconds)"
                  >
                    {optimizing ? 'Optimizing…' : '✨ Optimize'}
                  </button>
                  {simMoves && (
                    <button
                      onClick={() => setSimMoves(null)}
                      className="text-[11px] text-slate-400 hover:text-emerald-300"
                    >
                      reset to auto
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {[0, 1, 2, 3].map((slot) => {
                  const id = simMoveIds[slot] ?? 0
                  const mv = id ? loaded.moves[id] : null
                  return (
                    <button
                      key={slot}
                      onClick={() => setSimMovePicker(slot)}
                      className="flex items-center justify-between gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-left text-xs text-slate-200 hover:border-emerald-500/60"
                    >
                      <span className="truncate">{mv ? mv.name : <span className="text-slate-600">+ add</span>}</span>
                      {mv && <TypeBadge typeId={mv.type} typeNames={loaded.typeNames} />}
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          {/* Base stats */}
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Base stats</h3>
              <span className="font-mono text-xs text-slate-400">
                BST <span className="text-emerald-300">{bst}</span>
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {STAT_KEYS.map((k) => (
                <label key={k} className="flex items-center gap-3">
                  <span className="w-8 shrink-0 text-xs font-medium text-slate-400">
                    {STAT_LABELS[k]}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={255}
                    value={bs.stats[k]}
                    onChange={(e) => {
                      const v = Math.max(1, Math.min(255, Math.round(Number(e.target.value) || 0)))
                      patchBaseStats({ stats: { [k]: v } as Partial<BaseStatsEdit['stats']> })
                    }}
                    className="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right font-mono text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="h-1.5 flex-1 overflow-hidden rounded bg-slate-800">
                    <span
                      className="block h-full bg-emerald-500/70"
                      style={{ width: `${Math.min(100, (bs.stats[k] / 200) * 100)}%` }}
                    />
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* Types */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-200">Types</h3>
            <div className="flex items-center gap-3">
              {(['type1', 'type2'] as const).map((field) => (
                <select
                  key={field}
                  value={bs[field]}
                  onChange={(e) => patchBaseStats({ [field]: Number(e.target.value) })}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  {loaded.typeNames.map((name, id) => (
                    <option key={id} value={id}>
                      {name || `#${id}`}
                    </option>
                  ))}
                </select>
              ))}
              <span className="text-xs text-slate-500">
                {bs.type1 === bs.type2 ? 'single type — set both the same' : 'dual type'}
              </span>
            </div>
          </section>

          {/* Abilities */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-200">Abilities</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['ability1', 'ability2'] as const).map((field, i) => (
                <label key={field} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-slate-400">
                    {i === 0 ? 'Slot 1' : 'Slot 2'}
                  </span>
                  <select
                    value={bs[field]}
                    onChange={(e) => patchBaseStats({ [field]: Number(e.target.value) })}
                    className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                  >
                    {loaded.abilityNames.map((name, id) => (
                      <option key={id} value={id}>
                        {id === 0 ? '— none —' : name || `#${id}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Slot 2 “none” means the species has a single ability.
            </p>
          </section>

          {dirty && (
            <button
              onClick={() => revert(selected)}
              className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-rose-500/60 hover:text-rose-300"
            >
              Revert this species to ROM
            </button>
          )}
        </div>
      )}

      {tab === 'locations' && (
        <div className="p-6">
          {locations.length === 0 ? (
            <p className="text-sm text-slate-500">
              {species.name} does not appear in the wild. Change that from the Maps view.
            </p>
          ) : (
            <table className="w-full max-w-2xl border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Location</th>
                  <th className="w-28 px-3 py-2">Method</th>
                  <th className="w-20 px-3 py-2 text-right">Odds</th>
                  <th className="w-24 px-3 py-2 text-right">Levels</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((l, i) => (
                  <tr
                    key={i}
                    className="border-t border-slate-800/70 odd:bg-slate-900/40 hover:bg-slate-800/50"
                  >
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => selectArea(l.area)}
                        className="font-medium text-slate-100 hover:text-emerald-300"
                        title="Open in Maps view"
                      >
                        {l.name}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-slate-400">{l.kind}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-400">{l.percent}%</td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-400">
                      {l.low === l.high ? l.low : `${l.low}–${l.high}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'levelup' && (
      <div className="p-6">
        <table className="w-full max-w-3xl border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-16 px-3 py-2 text-right">Lv</th>
              <th className="px-3 py-2">Move</th>
              <th className="w-24 px-3 py-2">Type</th>
              <th className="w-14 px-3 py-2 text-right">Pow</th>
              <th className="w-14 px-3 py-2 text-right">Acc</th>
              <th className="w-14 px-3 py-2 text-right">PP</th>
              <th className="w-16 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const move: MoveInfo | undefined = loaded.moves[e.moveId]
              const warns = rowWarnings.get(i)
              return (
                <tr
                  key={i}
                  className="group border-t border-slate-800/70 odd:bg-slate-900/40 hover:bg-slate-800/50"
                >
                  <td className="px-3 py-1 text-right">
                    <LevelInput
                      level={e.level}
                      autoFocus={focusLevel === i}
                      subtle
                      onCommit={(lv) => setLevel(i, lv)}
                    />
                  </td>
                  <td className="px-3 py-1">{moveCell(e, i)}</td>
                  <td className="px-3 py-1">
                    {move && <TypeBadge typeId={move.type} typeNames={loaded.typeNames} />}
                  </td>
                  <td className="px-3 py-1 text-right font-mono text-slate-400">
                    {move ? stat(move.power) : ''}
                  </td>
                  <td className="px-3 py-1 text-right font-mono text-slate-400">
                    {move ? stat(move.accuracy) : ''}
                  </td>
                  <td className="px-3 py-1 text-right font-mono text-slate-400">
                    {move ? String(move.pp) : ''}
                  </td>
                  <td className="px-3 py-1 text-right">
                    {warns && (
                      <span title={warns.join('\n')} className="mr-1 cursor-help text-amber-400">
                        ⚠
                      </span>
                    )}
                    <button
                      onClick={() => remove(i)}
                      className="rounded px-1.5 text-slate-600 opacity-0 hover:bg-red-900/40 hover:text-red-300 group-hover:opacity-100"
                      title="Remove move"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              )
            })}
            {entries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  No level-up moves — add one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="relative mt-2 max-w-3xl">
          <button
            onClick={() => setPicker('add')}
            className="w-full rounded-lg border border-dashed border-slate-700 px-3 py-2 text-left text-sm text-slate-400 hover:border-emerald-600 hover:text-emerald-300"
          >
            + Add move…
          </button>
          {picker === 'add' && (
            <MovePicker
              moves={loaded.moves}
              typeNames={loaded.typeNames}
              recentMoves={recentMoves}
              onSelect={addMove}
              onClose={() => setPicker(null)}
            />
          )}
        </div>

        {warnings.some((w) => w.index === -1) && (
          <div className="mt-4 max-w-3xl rounded-lg border border-amber-900 bg-amber-950/40 px-4 py-2 text-sm text-amber-300">
            {warnings
              .filter((w) => w.index === -1)
              .map((w, i) => (
                <p key={i}>⚠ {w.message}</p>
              ))}
          </div>
        )}

        <p className="mt-4 font-mono text-xs text-slate-600">
          {entries.length} moves · learnset @ 0x
          {loaded.learnsets[selected].origOffset.toString(16).toUpperCase().padStart(6, '0')} ·{' '}
          {loaded.learnsets[selected].origCapacity} u16 slots in place
          {entries.length + 1 > loaded.learnsets[selected].origCapacity && ' · will repoint on save'}
        </p>
      </div>
      )}

      {tutorSlotPicker !== null && (
        <MovePicker
          moves={loaded.moves}
          typeNames={loaded.typeNames}
          recentMoves={recentMoves}
          onSelect={(id) => {
            const next = [...effectiveTutorMoveIds]
            next[tutorSlotPicker] = id
            applyTutorMoves(next)
            noteRecentMove(id)
            setTutorSlotPicker(null)
          }}
          onClose={() => setTutorSlotPicker(null)}
        />
      )}

      {simMovePicker !== null && (
        <MovePicker
          moves={loaded.moves}
          typeNames={loaded.typeNames}
          recentMoves={recentMoves}
          allowNone
          onSelect={(id) => {
            // Seed from the currently-shown moveset so editing one slot keeps
            // the others; drop empties so the harness sees a clean list.
            const next = [0, 1, 2, 3].map((s) => (s === simMovePicker ? id : simMoveIds[s] ?? 0))
            setSimMoves(next.filter((m) => m > 0).length ? next : null)
            if (id) noteRecentMove(id)
            setSimMovePicker(null)
          }}
          onClose={() => setSimMovePicker(null)}
        />
      )}
    </main>
  )
}
