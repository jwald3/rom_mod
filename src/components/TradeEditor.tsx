import { useEffect, useMemo, useState } from 'react'
import { useRomStore } from '../state/romStore'
import { useEditStore, computeTradeDirtySet, effectiveTrade } from '../state/editStore'
import {
  CONDITION_LABELS,
  IV_LABELS,
  MAX_IV,
  MAX_NICKNAME_CHARS,
  MAX_OT_NAME_CHARS,
  NATURE_NAMES,
  natureName,
  type Trade,
} from '../rom/tables/trades'
import { encode } from '../rom/charmap'
import { LevelInput } from './LevelInput'
import { SpeciesPicker } from './SpeciesPicker'
import { TypeBadge } from './TypeBadge'

/** True when every character round-trips through the Gen 3 codec. */
function isEncodable(text: string): boolean {
  try {
    encode(text)
    return true
  } catch {
    return false
  }
}

/** Commit-on-blur text field for the fixed-width name fields. */
function NameField({
  value,
  maxLength,
  onCommit,
}: {
  value: string
  maxLength: number
  onCommit: (v: string) => void
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const bad = !isEncodable(text)
  const commit = () => {
    if (bad) {
      setText(value)
      return
    }
    if (text !== value) onCommit(text)
  }
  return (
    <input
      value={text}
      maxLength={maxLength}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      title={bad ? 'Contains characters the game font can’t store' : undefined}
      className={`w-40 rounded border bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none focus:border-emerald-500 ${
        bad ? 'border-red-600' : 'border-slate-700'
      }`}
    />
  )
}

/** Personality value (u32) as a hex field, with a decimal fallback. */
function PersonalityField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const asHex = (n: number) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0')
  const [text, setText] = useState(asHex(value))
  useEffect(() => setText(asHex(value)), [value])
  const commit = () => {
    const t = text.trim()
    const n = t.toLowerCase().startsWith('0x') ? parseInt(t, 16) : parseInt(t, 10)
    if (Number.isNaN(n) || n < 0 || n > 0xffffffff) {
      setText(asHex(value))
      return
    }
    const u = n >>> 0
    setText(asHex(u))
    if (u !== (value >>> 0)) onCommit(u)
  }
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-right font-mono text-sm text-slate-200 outline-none focus:border-emerald-500"
    />
  )
}

/** A species chooser button + popup, mirroring the wild/evolution editors. */
function SpeciesField({
  speciesId,
  label,
  onSelect,
}: {
  speciesId: number
  label: string
  onSelect: (id: number) => void
}) {
  const loaded = useRomStore((s) => s.loaded)!
  const [open, setOpen] = useState(false)
  const sp = loaded.species[speciesId]
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-left hover:border-slate-500"
        title={label}
      >
        <span className="min-w-0 flex-1 truncate text-lg font-semibold text-slate-100">
          {sp ? sp.name : `species #${speciesId}`}
        </span>
        {sp && <TypeBadge typeId={sp.type1} typeNames={loaded.typeNames} />}
        {sp && sp.type2 !== sp.type1 && (
          <TypeBadge typeId={sp.type2} typeNames={loaded.typeNames} />
        )}
        <span className="font-mono text-xs text-slate-600">#{speciesId}</span>
        <span className="text-xs text-slate-500">▾</span>
      </button>
      {open && (
        <SpeciesPicker
          species={loaded.species}
          typeNames={loaded.typeNames}
          onSelect={(id) => {
            onSelect(id)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className="text-slate-400">{label}</span>
      {children}
    </label>
  )
}

export function TradeEditor() {
  const loaded = useRomStore((s) => s.loaded)!
  const selectedTrade = useRomStore((s) => s.selectedTrade)
  const tradeDrafts = useEditStore((s) => s.tradeDrafts)
  const { applyTrade, revertTrade } = useEditStore.getState()

  const trade = effectiveTrade(tradeDrafts, loaded, selectedTrade)
  const dirty = useMemo(
    () => computeTradeDirtySet(tradeDrafts, loaded).has(selectedTrade),
    [tradeDrafts, loaded, selectedTrade],
  )

  if (!trade) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center text-slate-500">
        No in-game trade data in this ROM.
      </main>
    )
  }

  const set = (patch: Partial<Trade>) => applyTrade(selectedTrade, { ...trade, ...patch })
  const setIv = (i: number, v: number) =>
    set({ ivs: trade.ivs.map((iv, j) => (j === i ? v : iv)) })
  const setCondition = (i: number, v: number) =>
    set({ conditions: trade.conditions.map((c, j) => (j === i ? v : c)) })
  // Keep the rest of the personality but swap the nature (pid % 25) slot.
  const setNature = (n: number) =>
    set({ personality: ((trade.personality >>> 0) - ((trade.personality >>> 0) % 25) + n) >>> 0 })

  const recvName = loaded.species[trade.receivedSpecies]?.name ?? `#${trade.receivedSpecies}`
  const giveName = loaded.species[trade.requestedSpecies]?.name ?? `#${trade.requestedSpecies}`

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
        <span className="font-mono text-slate-500">Trade {selectedTrade + 1}</span>
        <h2 className="text-lg font-semibold text-slate-100">
          {recvName} <span className="text-slate-500">for</span> {giveName}
        </h2>
        {dirty && (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300">
            ● modified
          </span>
        )}
        <button
          onClick={() => revertTrade(selectedTrade)}
          disabled={!dirty}
          className="ml-auto rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          title="Discard changes to this trade"
        >
          Revert
        </button>
      </header>

      <div className="grid max-w-5xl gap-4 p-6 lg:grid-cols-2">
        <Panel title="You receive">
          <SpeciesField
            speciesId={trade.receivedSpecies}
            label="The Pokémon the NPC gives you"
            onSelect={(id) => set({ receivedSpecies: id })}
          />
          <div className="mt-3 space-y-1">
            <Field label="Nickname">
              <NameField
                value={trade.nickname}
                maxLength={MAX_NICKNAME_CHARS}
                onCommit={(nickname) => set({ nickname })}
              />
            </Field>
            <Field label="Held item">
              <select
                value={trade.heldItem}
                onChange={(e) => set({ heldItem: Number(e.target.value) })}
                className="w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-emerald-500"
              >
                {loaded.itemNames.map((name, id) => (
                  <option key={id} value={id}>
                    {name || `item #${id}`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Ability slot">
              <select
                value={trade.abilityNum}
                onChange={(e) => set({ abilityNum: Number(e.target.value) })}
                className="w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-emerald-500"
              >
                <option value={0}>
                  1 · {loaded.abilityNames[loaded.species[trade.receivedSpecies]?.ability1 ?? 0] ?? '—'}
                </option>
                <option value={1}>
                  2 ·{' '}
                  {loaded.abilityNames[loaded.species[trade.receivedSpecies]?.ability2 ?? 0] || '—'}
                </option>
              </select>
            </Field>
            <Field label={`Nature (${natureName(trade.personality)})`}>
              <select
                value={(trade.personality >>> 0) % 25}
                onChange={(e) => setNature(Number(e.target.value))}
                className="w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-emerald-500"
              >
                {NATURE_NAMES.map((name, i) => (
                  <option key={i} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Personality (PID)">
              <PersonalityField
                value={trade.personality}
                onCommit={(personality) => set({ personality })}
              />
            </Field>
          </div>

          <div className="mt-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">IVs</p>
            <div className="grid grid-cols-3 gap-x-4 gap-y-1">
              {IV_LABELS.map((label, i) => (
                <label key={label} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-400">{label}</span>
                  <LevelInput
                    level={trade.ivs[i]}
                    min={0}
                    max={MAX_IV}
                    onCommit={(v) => setIv(i, v)}
                  />
                </label>
              ))}
            </div>
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="You give (requested)">
            <SpeciesField
              speciesId={trade.requestedSpecies}
              label="The Pokémon the player must hand over"
              onSelect={(id) => set({ requestedSpecies: id })}
            />
            <p className="mt-2 text-xs text-slate-600">
              The NPC only completes the trade when you offer this species.
            </p>
          </Panel>

          <Panel title="Original trainer">
            <Field label="OT name">
              <NameField
                value={trade.otName}
                maxLength={MAX_OT_NAME_CHARS}
                onCommit={(otName) => set({ otName })}
              />
            </Field>
            <Field label="OT ID">
              <LevelInput
                level={trade.otId}
                min={0}
                max={0xffffffff}
                onCommit={(otId) => set({ otId })}
              />
            </Field>
            <Field label="OT gender">
              <select
                value={trade.otGender}
                onChange={(e) => set({ otGender: Number(e.target.value) })}
                className="w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-emerald-500"
              >
                <option value={0}>Male</option>
                <option value={1}>Female</option>
              </select>
            </Field>
          </Panel>

          <Panel title="Contest stats">
            <div className="grid grid-cols-3 gap-x-4 gap-y-1">
              {CONDITION_LABELS.map((label, i) => (
                <label key={label} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-400">{label}</span>
                  <LevelInput
                    level={trade.conditions[i]}
                    min={0}
                    max={255}
                    onCommit={(v) => setCondition(i, v)}
                  />
                </label>
              ))}
              <label className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-400">Sheen</span>
                <LevelInput
                  level={trade.sheen}
                  min={0}
                  max={255}
                  onCommit={(sheen) => set({ sheen })}
                />
              </label>
            </div>
          </Panel>
        </div>
      </div>

      <p className="max-w-5xl px-6 pb-6 text-xs text-slate-600">
        Written in place (fixed {loaded.trades.length}-entry table). The received Pokémon’s level
        in-game matches the level of the Pokémon you trade away.
      </p>
    </main>
  )
}
