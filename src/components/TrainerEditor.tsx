import { useEffect, useMemo, useRef, useState } from 'react'
import { useRomStore } from '../state/romStore'
import { useEditStore, computeTrainerDirtySet, effectiveTrainer } from '../state/editStore'
import {
  MAX_PARTY,
  blankMon,
  type TrainerEdit,
  type TrainerMon,
} from '../rom/tables/trainers'
import { defaultMovesAtLevel } from '../rom/tables/learnsets'
import { LevelInput } from './LevelInput'
import { SpeciesPicker } from './SpeciesPicker'
import { MovePicker } from './MovePicker'
import { ItemPicker } from './ItemPicker'
import { TypeBadge } from './TypeBadge'

type Picker =
  | { kind: 'species'; slot: number }
  | { kind: 'item'; slot: number }
  | { kind: 'move'; slot: number; move: number }
  | { kind: 'aiitem'; slot: number }
  | null

/** Editable trainer name — commit on blur/Enter. */
function NameInput({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const [value, setValue] = useState(name)
  useEffect(() => setValue(name), [name])
  return (
    <input
      value={value}
      maxLength={12}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value !== name && onCommit(value)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      placeholder="(no name)"
      className="w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none focus:border-emerald-500"
    />
  )
}

export function TrainerEditor() {
  const loaded = useRomStore((s) => s.loaded)!
  const selectedTrainer = useRomStore((s) => s.selectedTrainer)
  const trainerDrafts = useEditStore((s) => s.trainerDrafts)
  const { applyTrainer, revertTrainer } = useEditStore.getState()

  const [picker, setPicker] = useState<Picker>(null)
  const [showDetails, setShowDetails] = useState(false)
  const scrollRef = useRef<HTMLElement>(null)

  const trainer = loaded.trainers[selectedTrainer]
  const edit = effectiveTrainer(trainerDrafts, loaded, selectedTrainer)
  const dirty = useMemo(
    () => computeTrainerDirtySet(trainerDrafts, loaded).has(selectedTrainer),
    [trainerDrafts, loaded, selectedTrainer],
  )

  useEffect(() => {
    setPicker(null)
    scrollRef.current?.scrollTo(0, 0)
  }, [selectedTrainer])

  if (!trainer || !edit) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center text-slate-500">
        No trainer data in this ROM.
      </main>
    )
  }

  const update = (mutate: (e: TrainerEdit) => TrainerEdit) => applyTrainer(selectedTrainer, mutate(edit))

  /** The four moves this species would know at `level` (game's default moveset). */
  const defaultMovesFor = (species: number, level: number): number[] =>
    defaultMovesAtLevel(loaded.learnsets[species]?.entries ?? [], level)

  const setMon = (slot: number, patch: Partial<TrainerMon>) =>
    update((e) => ({
      ...e,
      party: e.party.map((m, i) => (i === slot ? { ...m, ...patch } : m)),
    }))

  const setMove = (slot: number, moveIdx: number, moveId: number) =>
    update((e) => ({
      ...e,
      party: e.party.map((m, i) =>
        i === slot ? { ...m, moves: m.moves.map((mv, j) => (j === moveIdx ? moveId : mv)) } : m,
      ),
    }))

  const movesEqual = (a: number[], b: number[]) => a.length === b.length && a.every((x, k) => x === b[k])

  /** A Pokémon's moves are "auto" (follow its level) until a slot is customized. */
  const monIsAuto = (m: TrainerMon) =>
    !edit.hasMoves || movesEqual(m.moves, defaultMovesFor(m.species, m.level))

  // Changing the level re-derives an auto Pokémon's moveset; a customized
  // (locked) Pokémon keeps its moves. With custom moves off, the shown moves
  // are computed live, so only the stored (locked) case needs updating here.
  const setLevel = (slot: number, level: number) =>
    update((e) => ({
      ...e,
      party: e.party.map((m, i) => {
        if (i !== slot) return m
        const wasAuto = e.hasMoves && movesEqual(m.moves, defaultMovesFor(m.species, m.level))
        return { ...m, level, moves: wasAuto ? defaultMovesFor(m.species, level) : m.moves }
      }),
    }))

  /** Re-lock a customized Pokémon to its level-up moveset (follows level again). */
  const resetMoves = (slot: number) =>
    update((e) => ({
      ...e,
      party: e.party.map((m, i) => (i === slot ? { ...m, moves: defaultMovesFor(m.species, m.level) } : m)),
    }))

  // Picking a move when custom moves is off flips it on, baking each Pokémon's
  // currently-shown level-up defaults in first so nothing changes but this slot.
  const pickMove = (slot: number, moveIdx: number, moveId: number) => {
    if (edit.hasMoves) {
      setMove(slot, moveIdx, moveId)
      return
    }
    update((e) => ({
      ...e,
      hasMoves: true,
      party: e.party.map((m, i) => {
        const moves = defaultMovesFor(m.species, m.level)
        if (i === slot) moves[moveIdx] = moveId
        return { ...m, moves }
      }),
    }))
  }

  const addMon = () => {
    if (edit.party.length >= MAX_PARTY) return
    const mon = blankMon()
    // Start from the species' natural moveset at its level (edit from there).
    if (edit.hasMoves) mon.moves = defaultMovesFor(mon.species, mon.level)
    update((e) => ({ ...e, party: [...e.party, mon] }))
  }

  const removeMon = (slot: number) =>
    edit.party.length > 1 && update((e) => ({ ...e, party: e.party.filter((_, i) => i !== slot) }))

  // Toggling a struct flag off zeroes the now-unused fields so drafts stay
  // canonical (matching how the ROM reads them back).
  // Enabling custom moves seeds every Pokémon with its natural level-up moveset
  // (instead of blanks); disabling clears the now-unused move fields.
  const setHasMoves = (on: boolean) =>
    update((e) => ({
      ...e,
      hasMoves: on,
      party: e.party.map((m) => ({
        ...m,
        moves: on ? defaultMovesFor(m.species, m.level) : [0, 0, 0, 0],
      })),
    }))
  const setHasItems = (on: boolean) =>
    update((e) => ({
      ...e,
      hasItems: on,
      party: on ? e.party : e.party.map((m) => ({ ...m, heldItem: 0 })),
    }))

  const setAiItem = (slot: number, id: number) =>
    update((e) => ({ ...e, items: e.items.map((it, i) => (i === slot ? id : it)) }))

  return (
    <main ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
        <span className="font-mono text-slate-500">#{trainer.index}</span>
        <select
          value={edit.cls}
          onChange={(e) => update((t) => ({ ...t, cls: Number(e.target.value) }))}
          className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none focus:border-emerald-500"
          title="Trainer class"
        >
          {loaded.trainerClassNames.map((name, id) => (
            <option key={id} value={id}>
              {name.trim() || `class #${id}`}
            </option>
          ))}
          {edit.cls >= loaded.trainerClassNames.length && (
            // Preserve a class byte that lies beyond the named-class table.
            <option value={edit.cls}>class #{edit.cls}</option>
          )}
        </select>
        <NameInput name={edit.name} onCommit={(name) => update((t) => ({ ...t, name }))} />
        {dirty && (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300">
            ● modified
          </span>
        )}
        <label className="flex items-center gap-1.5 text-xs text-slate-400" title="Two Pokémon out at once">
          <input
            type="checkbox"
            checked={edit.doubleBattle !== 0}
            onChange={(e) => update((t) => ({ ...t, doubleBattle: e.target.checked ? 1 : 0 }))}
          />
          Double battle
        </label>
        <button
          onClick={() => revertTrainer(selectedTrainer)}
          disabled={!dirty}
          className="ml-auto rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          title="Discard changes to this trainer"
        >
          Revert
        </button>
      </header>

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <label className="flex items-center gap-1.5" title="Give each Pokémon four explicit moves (otherwise the game uses its level-up moveset)">
            <input type="checkbox" checked={edit.hasMoves} onChange={(e) => setHasMoves(e.target.checked)} />
            Custom moves
          </label>
          <label className="flex items-center gap-1.5" title="Give each Pokémon a held item">
            <input type="checkbox" checked={edit.hasItems} onChange={(e) => setHasItems(e.target.checked)} />
            Held items
          </label>
          <span className="text-slate-600">
            {edit.party.length}/{MAX_PARTY} Pokémon
          </span>
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="ml-auto rounded border border-slate-700 px-2 py-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            title="Battle items the AI can use, plus intro presentation"
          >
            {showDetails ? '▾' : '▸'} Trainer details
          </button>
        </div>

        {showDetails && (
          <div className="grid gap-4 rounded-lg border border-slate-800 bg-slate-900/40 p-4 sm:grid-cols-2">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                AI battle items
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {edit.items.map((it, i) => (
                  <div key={i} className="relative">
                    <button
                      onClick={() => setPicker({ kind: 'aiitem', slot: i })}
                      className="flex w-full items-center gap-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-left text-xs text-slate-200 hover:border-slate-500"
                      title={`Item slot ${i + 1} the trainer's AI may use in battle`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {it ? loaded.itemNames[it] ?? `item #${it}` : '— none —'}
                      </span>
                      <span className="text-slate-600">▾</span>
                    </button>
                    {picker?.kind === 'aiitem' && picker.slot === i && (
                      <ItemPicker
                        itemNames={loaded.itemNames}
                        noneLabel="— no item —"
                        onSelect={(id) => {
                          setAiItem(i, id)
                          setPicker(null)
                        }}
                        onClose={() => setPicker(null)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Presentation
              </h4>
              <label className="flex items-center gap-2 text-xs text-slate-400" title="Front-sprite index (graphics.trainers.sprites.front)">
                <span className="w-16">Sprite</span>
                <LevelInput level={edit.sprite} min={0} max={255} onCommit={(sprite) => update((t) => ({ ...t, sprite }))} />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-400" title="Intro music / encounter song index (0–127)">
                <span className="w-16">Music</span>
                <LevelInput level={edit.music} min={0} max={127} onCommit={(music) => update((t) => ({ ...t, music }))} />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-400" title="Gender shown in the trainer's intro/defeat text">
                <span className="w-16">Gender</span>
                <select
                  value={edit.gender}
                  onChange={(e) => update((t) => ({ ...t, gender: Number(e.target.value) }))}
                  className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100 outline-none focus:border-emerald-500"
                >
                  <option value={0}>Male</option>
                  <option value={1}>Female</option>
                </select>
              </label>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {edit.party.map((mon, i) => {
            const sp = loaded.species[mon.species]
            return (
              <section
                key={i}
                className="rounded-lg border border-slate-800 bg-slate-900/40 p-3"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-xs text-slate-600">{i + 1}</span>
                  {/* Species */}
                  <div className="relative">
                    <button
                      onClick={() => setPicker({ kind: 'species', slot: i })}
                      className="flex w-52 items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-left font-medium text-slate-100 hover:border-slate-500 hover:text-emerald-300"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {sp ? sp.name : `species #${mon.species}`}
                      </span>
                      {sp && <TypeBadge typeId={sp.type1} typeNames={loaded.typeNames} />}
                      <span className="text-xs text-slate-500">▾</span>
                    </button>
                    {picker?.kind === 'species' && picker.slot === i && (
                      <SpeciesPicker
                        species={loaded.species}
                        typeNames={loaded.typeNames}
                        onSelect={(id) => {
                          // Picking a species refreshes its default moveset to edit from.
                          setMon(
                            i,
                            edit.hasMoves
                              ? { species: id, moves: defaultMovesFor(id, mon.level) }
                              : { species: id },
                          )
                          setPicker(null)
                        }}
                        onClose={() => setPicker(null)}
                      />
                    )}
                  </div>
                  {/* Level */}
                  <label className="flex items-center gap-1.5 text-xs text-slate-500">
                    Lv
                    <LevelInput level={mon.level} onCommit={(level) => setLevel(i, level)} />
                  </label>
                  {/* Difficulty / IV */}
                  <label
                    className="flex items-center gap-1.5 text-xs text-slate-500"
                    title="Difficulty byte the engine scales into IVs (0 = min, 255 = max)"
                  >
                    IV
                    <LevelInput
                      level={mon.iv}
                      min={0}
                      max={255}
                      onCommit={(iv) => setMon(i, { iv })}
                    />
                  </label>
                  {/* Held item */}
                  {edit.hasItems && (
                    <div className="relative">
                      <button
                        onClick={() => setPicker({ kind: 'item', slot: i })}
                        className="flex w-40 items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-left text-sm text-slate-200 hover:border-slate-500"
                        title="Held item"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {mon.heldItem
                            ? loaded.itemNames[mon.heldItem] ?? `item #${mon.heldItem}`
                            : '— no item —'}
                        </span>
                        <span className="text-xs text-slate-500">▾</span>
                      </button>
                      {picker?.kind === 'item' && picker.slot === i && (
                        <ItemPicker
                          itemNames={loaded.itemNames}
                          onSelect={(id) => {
                            setMon(i, { heldItem: id })
                            setPicker(null)
                          }}
                          onClose={() => setPicker(null)}
                        />
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => removeMon(i)}
                    disabled={edit.party.length <= 1}
                    className="ml-auto rounded px-2 py-1 text-slate-500 hover:bg-slate-800 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                    title="Remove this Pokémon"
                  >
                    ✕
                  </button>
                </div>

                {/* Moves — explicit when custom moves is on, otherwise a live
                    preview of the level-up moveset this Pokémon would know. */}
                {(() => {
                  const auto = monIsAuto(mon)
                  const shown = edit.hasMoves ? mon.moves : defaultMovesFor(mon.species, mon.level)
                  return (
                    <div className="mt-3">
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
                        <span>
                          {auto ? 'Level-up moves (auto — follow level)' : 'Custom moves (locked)'}
                        </span>
                        {edit.hasMoves && !auto && (
                          <button
                            onClick={() => resetMoves(i)}
                            className="rounded border border-slate-700 px-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                            title="Reset to the level-up moveset so it follows the level again"
                          >
                            ↻ reset to level moves
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {shown.map((mv, j) => (
                          <div key={j} className="relative">
                            <button
                              onClick={() => setPicker({ kind: 'move', slot: i, move: j })}
                              className={`flex w-full items-center gap-1 rounded border border-slate-800 bg-slate-950 px-2 py-1 text-left text-xs hover:border-slate-600 ${
                                edit.hasMoves ? 'text-slate-200' : 'text-slate-400'
                              }`}
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {mv ? loaded.moves[mv]?.name ?? `move #${mv}` : '—'}
                              </span>
                              <span className="text-slate-600">▾</span>
                            </button>
                            {picker?.kind === 'move' && picker.slot === i && picker.move === j && (
                              <MovePicker
                                moves={loaded.moves}
                                typeNames={loaded.typeNames}
                                recentMoves={useEditStore.getState().recentMoves}
                                allowNone
                                onSelect={(id) => {
                                  pickMove(i, j, id)
                                  if (id !== 0) useEditStore.getState().noteRecentMove(id)
                                  setPicker(null)
                                }}
                                onClose={() => setPicker(null)}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </section>
            )
          })}
        </div>

        <button
          onClick={addMon}
          disabled={edit.party.length >= MAX_PARTY}
          className="rounded-lg border border-dashed border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-emerald-600 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          + Add Pokémon
        </button>

        <p className="text-xs text-slate-600">
          Moves follow each Pokémon’s level automatically; picking a move locks that Pokémon’s
          set (↻ reset re-enables auto). Growing a team repoints its party to free space on
          save. Difficulty 0 gives 0 IVs, 255 gives max.
        </p>
      </div>
    </main>
  )
}
