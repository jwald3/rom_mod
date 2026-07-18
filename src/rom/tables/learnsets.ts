import type { RomBuffer } from '../buffer'
import type { AnchorMap } from '../anchors'

export interface LearnsetEntry {
  level: number // 1–100 (7 bits)
  moveId: number // 1–511 (9 bits)
}

export interface Learnset {
  species: number
  entries: LearnsetEntry[]
  /** ROM offset of the current list, or -1 if the pointer was invalid. */
  origOffset: number
  /** u16 slots available at origOffset, including the 0xFFFF terminator. */
  origCapacity: number
}

export const LEARNSET_TERMINATOR = 0xffff
/** Safety cap while scanning — real learnsets are ≤ ~25 moves. */
const MAX_ENTRIES = 128

export function packEntry(e: LearnsetEntry): number {
  return ((e.level & 0x7f) << 9) | (e.moveId & 0x1ff)
}

export function unpackEntry(v: number): LearnsetEntry {
  return { level: v >> 9, moveId: v & 0x1ff }
}

/** Serialize to ROM bytes (u16 LE entries + 0xFFFF terminator). Throws on out-of-range values. */
export function serializeLearnset(entries: LearnsetEntry[]): Uint8Array {
  const out = new Uint8Array((entries.length + 1) * 2)
  const view = new DataView(out.buffer)
  entries.forEach((e, i) => {
    if (e.level < 1 || e.level > 100) {
      throw new Error(`row ${i + 1}: level ${e.level} out of range (1–100)`)
    }
    if (e.moveId < 1 || e.moveId > 511) {
      throw new Error(`row ${i + 1}: move #${e.moveId} out of range (1–511)`)
    }
    view.setUint16(i * 2, packEntry(e), true)
  })
  view.setUint16(entries.length * 2, LEARNSET_TERMINATOR, true)
  return out
}

/** Sort by level, preserving relative order of same-level moves (it matters in-game). */
export function sortEntries(entries: LearnsetEntry[]): LearnsetEntry[] {
  return [...entries].sort((a, b) => a.level - b.level)
}

/**
 * The four moves a Pokémon would know if it grew to `level` — the same result
 * the engine produces for a trainer's default-move party member. Learns moves
 * in level order, skips ones already known, and drops the oldest once four are
 * held. Returns exactly four move ids, 0-padded.
 */
export function defaultMovesAtLevel(entries: LearnsetEntry[], level: number): number[] {
  const learned: number[] = []
  for (const e of sortEntries(entries)) {
    if (e.level > level) break
    if (e.moveId === 0 || learned.includes(e.moveId)) continue
    if (learned.length >= 4) learned.shift()
    learned.push(e.moveId)
  }
  while (learned.length < 4) learned.push(0)
  return learned
}

export function entriesEqual(a: LearnsetEntry[], b: LearnsetEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => e.level === b[i].level && e.moveId === b[i].moveId)
}

export function readLearnset(rom: RomBuffer, a: AnchorMap, species: number): Learnset {
  const ptrOffset = a.learnsets + species * 4
  const offset = rom.pointer(ptrOffset)
  if (offset === null) {
    return { species, entries: [], origOffset: -1, origCapacity: 0 }
  }
  const entries: LearnsetEntry[] = []
  let o = offset
  while (o + 1 < rom.length && entries.length < MAX_ENTRIES) {
    const v = rom.u16(o)
    if (v === LEARNSET_TERMINATOR) break
    entries.push(unpackEntry(v))
    o += 2
  }
  return { species, entries, origOffset: offset, origCapacity: entries.length + 1 }
}

export function readAllLearnsets(rom: RomBuffer, a: AnchorMap): Learnset[] {
  const out: Learnset[] = []
  for (let i = 0; i < a.speciesCount; i++) out.push(readLearnset(rom, a, i))
  return out
}
