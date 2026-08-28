import { useEffect, useRef, useState } from 'react'
import type { LoadedRom } from '../rom/loadRom'
import type { SpeciesInfo } from '../rom/tables/species'
import type { BaseStatsEdit } from '../rom/writer'
import { quickRate, type QuickRateResult } from '../sim'

/**
 * Live win-rate for a species against the benchmark cohort, recomputed
 * (debounced) whenever the draft changes. Runs on a timeout so a burst of
 * keystrokes only rates once the edits settle, and a stale run can't overwrite
 * a newer result.
 */
export function useQuickRate(
  rom: LoadedRom,
  species: SpeciesInfo,
  draft: BaseStatsEdit,
  enabled: boolean,
  /** Forced moveset (move ids); empty/undefined = auto-pick. */
  moveOverride?: readonly number[],
  delayMs = 250,
): { result: QuickRateResult | null; pending: boolean } {
  const [result, setResult] = useState<QuickRateResult | null>(null)
  const [pending, setPending] = useState(true)
  const runId = useRef(0)

  // A stable key so the effect only re-fires when a rated value actually changes.
  const key = JSON.stringify([
    species.id,
    draft.stats,
    draft.type1,
    draft.type2,
    draft.ability1,
    moveOverride ?? [],
  ])

  useEffect(() => {
    if (!enabled) return
    setPending(true)
    const id = ++runId.current
    const timer = setTimeout(() => {
      // Yield first so the "…" state paints before the (synchronous) sim runs.
      const rated = quickRate(rom, species, draft, { moveOverride })
      if (id === runId.current) {
        setResult(rated)
        setPending(false)
      }
    }, delayMs)
    return () => clearTimeout(timer)
    // draft + moveOverride are captured via `key`; species/rom identity also matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rom, species, enabled, delayMs])

  return { result, pending }
}
