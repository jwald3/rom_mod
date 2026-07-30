import { GBA_ROM_BASE, type RomBuffer } from '../buffer'
import type { AnchorMap } from '../anchors'
import { encode } from '../charmap'

/**
 * Celadon Game Corner prize editor support.
 *
 * FireRed does NOT store prizes as a data table. Each of the three prize
 * counters (Pokémon / TM / item) is driven by three coordinated structures:
 *
 *  1. A **multichoice set** (the visible menu) in the table at `anchors.multichoice`.
 *     Set = [optionsPtr u32, count u32]; option = [textPtr u32, unused u32].
 *     Prize labels are pre-formatted strings, e.g. "ABRA<align>180 COINS".
 *  2. A **dispatch chain** of `compare VAR_0x8000,<index>` + `goto_if EQ,<routine>`
 *     script pairs, one per visible prize (index 0..n-1), then two exit-sentinel
 *     pairs (index 5 and 0x7f) and an `end`.
 *  3. Per-prize **routines**: `setvar VAR_0x4001,<id>` `setvar VAR_0x4002,<cost>`
 *     `goto <buyHandler>` `end` (16 bytes). The buy handler is shared per list.
 *
 * The Pokémon list additionally has a **species-keyed secondary chain** inside its
 * handler (`compare VAR_0x8000,<species>` → a per-species give-message routine that
 * bakes in the prize's level). We capture it verbatim so add/remove can regenerate
 * it in lockstep.
 *
 * Editing model: parse into a normalized {id,cost} list; on save, regenerate the
 * whole menu+dispatch+routines (+ Pokémon secondary chain) into free space and
 * repoint the one script entry pointer + the multichoice options pointer.
 */

export type PrizeKind = 'pokemon' | 'tm' | 'item'
export const PRIZE_KINDS: PrizeKind[] = ['pokemon', 'tm', 'item']

export const PRIZE_KIND_LABELS: Record<PrizeKind, string> = {
  pokemon: 'Pokémon',
  tm: 'TMs',
  item: 'Items',
}

/** Which multichoice set index each list's menu lives at (vanilla BPRE). */
export const PRIZE_MC_INDEX: Record<PrizeKind, number> = {
  pokemon: 14,
  tm: 30,
  item: 41,
}

/**
 * Dispatch-chain start offsets relative to `anchors.gcScript` (the Pokémon menu
 * script entry). These are the fall-through dispatch chains for each list.
 * Vanilla BPRE: pokemon 0x16cbc2, tm 0x16ce57, item 0x16cfc2; gcScript 0x16cb75.
 */
const DISPATCH_REL: Record<PrizeKind, number> = {
  pokemon: 0x16cbc2 - 0x16cb75,
  tm: 0x16ce57 - 0x16cb75,
  item: 0x16cfc2 - 0x16cb75,
}

export interface Prize {
  /** Species id (pokemon) or item id (tm/item). */
  id: number
  cost: number
  /** Pokémon prizes bake a level into their give-message routine; kept for round-trip. */
  level?: number
}

export interface PrizeList {
  kind: PrizeKind
  /** False → structure didn't match the expected signature; UI stays read-only. */
  regenerable: boolean
  entries: Prize[]
  /** Shared buy-handler goto target for this list's routines. */
  handlerOffset: number
  /**
   * Start of the dispatch chain. Reached by fall-through from the menu-draw code,
   * so we redirect by overwriting its first bytes with `goto <regenerated chain>`
   * (a 5-byte hook that fits inside the ≥12-byte first dispatch pair).
   */
  dispatchOffset: number
  /** Exit sentinel routine (index 5 / 0x7f point here). */
  exitTarget: number
  /** Multichoice set: [optionsPtr u32, count u32] location, and current values. */
  mcSetOffset: number
  mcOptionsOffset: number
  mcCount: number
  /** Preserved trailing "NO THANKS" row text pointer (ROM offset). */
  noThanksTextPtr: number
  /** The x pixel from the label's `FC 13 <x>` right-align control code. */
  labelRightAlignX: number
  /** Verbatim bytes some lists (TMs) insert between the cost setvar and the goto. */
  routineExtra: Uint8Array
  /** Pokémon only: per-species give-message routine bytes (verbatim), keyed by species. */
  secondaryRoutines?: Array<{ species: number; level: number; bytes: Uint8Array }>
  /** Pokémon only: the common tail the secondary routines `goto` (e.g. 0x16cd52). */
  secondaryTail?: number
  /** Pokémon only: start offset of the original secondary dispatch chain (hook site). */
  secondaryDispatchOffset?: number
  /** Pokémon only: the secondary chain's own 0x7f-sentinel target ("prize not found"). */
  secondarySentinelTarget?: number
}

// ── Script opcode constants ───────────────────────────────────────────────
const OP_SETVAR = 0x16
const OP_COMPARE = 0x21
const OP_GOTO = 0x05
const OP_GOTO_IF = 0x06
const OP_END = 0x02
const VAR_ITEM = 0x4001 // VAR_0x4001 — prize id
const VAR_COST = 0x4002 // VAR_0x4002 — coin cost
const VAR_SELECT = 0x8000 // VAR_0x8000 — menu selection / dispatch key
const SENTINEL_B = 0x7f
const OP_BUFFER = 0x79 // give-message buffer opcode in the Pokémon secondary routine

function toPtr(off: number): number {
  return (GBA_ROM_BASE + off) >>> 0
}

/** If `off` starts with a `goto <ptr>`, return the target; otherwise return `off`. */
function followGoto(rom: RomBuffer, off: number): number {
  if (rom.u8(off) === OP_GOTO) {
    const t = rom.pointer(off + 1)
    if (t !== null) return t
  }
  return off
}

/** Read the [optionsPtr, count] of one multichoice set. */
function readMcSet(rom: RomBuffer, anchors: AnchorMap, index: number) {
  const setOffset = anchors.multichoice + index * 8
  return {
    setOffset,
    optionsOffset: rom.pointer(setOffset),
    count: rom.u32(setOffset + 4),
  }
}

/**
 * Parse the primary dispatch chain starting at `dispatchOffset`: a run of
 * (compare VAR_0x8000,i ; goto_if EQ,ptr) pairs with ascending i, terminated by
 * the two sentinel pairs (i = 5, then 0x7f) and an `end`. Returns the ordered
 * routine offsets and the exit-sentinel target, or null if the shape is wrong.
 */
function parseDispatch(
  rom: RomBuffer,
  dispatchOffset: number,
): { routines: number[]; exitTarget: number } | null {
  let o = dispatchOffset
  const routines: number[] = []
  let index = 0
  // Each pair: 21 00 80 <i:u16>  06 01 <ptr:u32>  (5 + 6 = 11 bytes).
  // Real entries have compare value == running index. The chain ends with two
  // sentinel pairs whose value is `index` (== entry count) then 0x7f, both jumping
  // to the exit routine, followed by `end`. (Vanilla uses index 5 because it has 5
  // prizes; we key off index equality, not a fixed constant, so add/remove works.)
  for (let guard = 0; guard < 64; guard++) {
    if (rom.u8(o) !== OP_COMPARE || rom.u16(o + 1) !== VAR_SELECT) return null
    const cmpVal = rom.u16(o + 3)
    if (rom.u8(o + 5) !== OP_GOTO_IF) return null
    const target = rom.pointer(o + 7)
    if (target === null) return null
    // Sentinel pair: value is the end-of-list marker (== index) and the NEXT pair is 0x7f.
    const next = o + 11
    const nextIsSentinelB =
      rom.u8(next) === OP_COMPARE && rom.u16(next + 1) === VAR_SELECT && rom.u16(next + 3) === SENTINEL_B
    if (cmpVal === index && nextIsSentinelB) {
      const exitTarget = target
      let p = next + 11
      if (rom.u8(p) !== OP_END) return null
      return { routines, exitTarget }
    }
    if (cmpVal !== index) return null
    routines.push(target)
    index++
    o += 11
  }
  return null
}

/**
 * Parse one prize routine. Always begins `setvar VAR_0x4001,<id>` then
 * `setvar VAR_0x4002,<cost>`, but some lists (TMs) insert an extra command
 * before the trailing `goto <handler>` `end`. We capture the id/cost and the
 * verbatim "extra" bytes between the cost setvar and the goto so add can clone
 * the list's routine shape.
 */
function parseRoutine(
  rom: RomBuffer,
  off: number,
): { id: number; cost: number; handler: number; extra: Uint8Array } | null {
  if (rom.u8(off) !== OP_SETVAR || rom.u16(off + 1) !== VAR_ITEM) return null
  const id = rom.u16(off + 3)
  if (rom.u8(off + 5) !== OP_SETVAR || rom.u16(off + 6) !== VAR_COST) return null
  const cost = rom.u16(off + 8)
  // Scan for the trailing `goto <handler>` `end` within a small window.
  for (let p = off + 10; p < off + 10 + 16; p++) {
    if (rom.u8(p) === OP_GOTO && rom.u8(p + 5) === OP_END) {
      const handler = rom.pointer(p + 1)
      if (handler === null) return null
      return { id, cost, handler, extra: rom.slice(off + 10, p - (off + 10)) }
    }
  }
  return null
}

/** Comma-group an integer the way the label strings do (e.g. 2800 → "2,800"). */
export function commaGroup(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const CTRL_RIGHT_ALIGN = 0x13 // FC 13 <x>: right-align cursor to pixel x
const CTRL_SHIFT = 0x06 // FC 06 xx yy: font shift
const CTRL_ESC = 0xfc
const TERMINATOR = 0xff

/**
 * Rebuild a prize label string: "<name><FC 13 x><FC 06 0 0><cost> COINS".
 * Mirrors the vanilla format (cost is literal text). Names longer than the
 * vanilla ones will still render; the right-align keeps the cost column fixed.
 */
export function makePrizeLabel(name: string, cost: number, alignX: number): Uint8Array {
  const parts: number[] = []
  const push = (bytes: Uint8Array) => parts.push(...bytes)
  push(encode(name.toUpperCase()))
  parts.push(CTRL_ESC, CTRL_RIGHT_ALIGN, alignX)
  parts.push(CTRL_ESC, CTRL_SHIFT, 0x00, 0x00)
  push(encode(commaGroup(cost)))
  parts.push(0x00) // space
  push(encode('COINS'))
  parts.push(TERMINATOR)
  return Uint8Array.from(parts)
}

/** Read the right-align x from an existing label, or a sane default. */
function parseAlignX(rom: RomBuffer, textOffset: number): number {
  for (let i = 0; i < 40; i++) {
    if (rom.u8(textOffset + i) === CTRL_ESC && rom.u8(textOffset + i + 1) === CTRL_RIGHT_ALIGN) {
      return rom.u8(textOffset + i + 2)
    }
    if (rom.u8(textOffset + i) === TERMINATOR) break
  }
  return 0x55 // observed vanilla value
}

/**
 * Parse the Pokémon secondary species-keyed chain that lives in the buy handler:
 * `copyvar VAR_0x8000,VAR_0x4001` then per-species compare/goto_if → give-message
 * routines (each `79 01 40 <level:u16> …pad… goto <tail> end`). Returns the routines
 * keyed by species plus the shared tail, or null if not found.
 */
function parsePokemonSecondary(
  rom: RomBuffer,
  handlerOffset: number,
): {
  routines: Array<{ species: number; level: number; bytes: Uint8Array }>
  tail: number
  dispatchOffset: number
  sentinelTarget: number
} | null {
  // Scan the handler for `copyvar VAR_0x8000, VAR_0x4001` (19 00 80 01 40).
  let o = handlerOffset
  let found = -1
  for (let i = 0; i < 64; i++, o++) {
    if (rom.u8(o) === 0x19 && rom.u16(o + 1) === VAR_SELECT && rom.u16(o + 3) === VAR_ITEM) {
      found = o + 5
      break
    }
  }
  if (found < 0) return null
  const dispatchOffset = found
  // Now a chain of compare VAR_0x8000,<species> / goto_if -> msgRoutine, ending 0x7f then end.
  // (Follow a hook goto if this list was already regenerated.)
  o = followGoto(rom, found)
  const targets: Array<{ species: number; target: number }> = []
  let sentinelTarget = -1
  for (let guard = 0; guard < 32; guard++) {
    if (rom.u8(o) !== OP_COMPARE || rom.u16(o + 1) !== VAR_SELECT) return null
    const species = rom.u16(o + 3)
    if (rom.u8(o + 5) !== OP_GOTO_IF) return null
    const target = rom.pointer(o + 7)
    if (target === null) return null
    o += 11
    if (species === SENTINEL_B) {
      if (rom.u8(o) !== OP_END) return null
      sentinelTarget = target
      break
    }
    targets.push({ species, target })
  }
  if (sentinelTarget < 0) return null
  // Each give-message routine: starts 79 01 40 <level:u16>, ends `goto <tail> end`.
  const routines: Array<{ species: number; level: number; bytes: Uint8Array }> = []
  let tail = -1
  for (const { species, target } of targets) {
    if (rom.u8(target) !== OP_BUFFER) return null
    const level = rom.u16(target + 3)
    // Find the routine's `goto <tail>` (05 ptr) then end (02).
    let end = target
    for (let i = 0; i < 40; i++) {
      if (rom.u8(target + i) === OP_GOTO && rom.u8(target + i + 5) === OP_END) {
        tail = rom.pointer(target + i + 1) ?? tail
        end = target + i + 6
        break
      }
    }
    routines.push({ species, level, bytes: rom.slice(target, end - target) })
  }
  if (tail < 0) return null
  return { routines, tail, dispatchOffset, sentinelTarget }
}

/**
 * Parse one prize list from its multichoice set. The menu's option textPtrs are
 * only used for the align-x and the trailing NO-THANKS row; the {id,cost} truth
 * comes from the script routines. Returns a non-regenerable stub on any mismatch.
 */
function parseList(rom: RomBuffer, anchors: AnchorMap, kind: PrizeKind, dispatchOffset: number): PrizeList {
  const mcIndex = PRIZE_MC_INDEX[kind]
  const mc = readMcSet(rom, anchors, mcIndex)
  // If we previously hooked this list, the dispatch start is a `goto <realchain>`;
  // follow it so a re-parse sees the regenerated chain.
  const chainOffset = followGoto(rom, dispatchOffset)
  const dispatch = parseDispatch(rom, chainOffset)

  const stub = (): PrizeList => ({
    kind,
    regenerable: false,
    entries: [],
    handlerOffset: -1,
    dispatchOffset,
    exitTarget: -1,
    mcSetOffset: mc.setOffset,
    mcOptionsOffset: mc.optionsOffset ?? -1,
    mcCount: mc.count,
    noThanksTextPtr: -1,
    labelRightAlignX: 0x55,
    routineExtra: new Uint8Array(0),
  })

  if (!dispatch || mc.optionsOffset === null) return stub()

  const entries: Prize[] = []
  let handlerOffset = -1
  let routineExtra = new Uint8Array(0)
  for (const routineOff of dispatch.routines) {
    const r = parseRoutine(rom, routineOff)
    if (!r) return stub()
    entries.push({ id: r.id, cost: r.cost })
    handlerOffset = r.handler
    routineExtra = r.extra
  }
  if (handlerOffset < 0) return stub()

  // Menu label align-x + NO THANKS row (the last option row).
  const lastOptOff = mc.optionsOffset + (mc.count - 1) * 8
  const noThanksTextPtr = rom.pointer(lastOptOff) ?? -1
  const firstTextPtr = rom.pointer(mc.optionsOffset)
  const labelRightAlignX = firstTextPtr !== null ? parseAlignX(rom, firstTextPtr) : 0x55

  const list: PrizeList = {
    kind,
    regenerable: true,
    entries,
    handlerOffset,
    dispatchOffset,
    exitTarget: dispatch.exitTarget,
    mcSetOffset: mc.setOffset,
    mcOptionsOffset: mc.optionsOffset,
    mcCount: mc.count,
    noThanksTextPtr,
    labelRightAlignX,
    routineExtra,
  }

  if (kind === 'pokemon') {
    const secondary = parsePokemonSecondary(rom, handlerOffset)
    if (!secondary) {
      list.regenerable = false
    } else {
      list.secondaryRoutines = secondary.routines
      list.secondaryTail = secondary.tail
      list.secondaryDispatchOffset = secondary.dispatchOffset
      list.secondarySentinelTarget = secondary.sentinelTarget
      // Backfill each entry's level from the secondary routine matching its species.
      for (const e of entries) {
        const m = secondary.routines.find((r) => r.species === e.id)
        if (m) e.level = m.level
      }
    }
  }

  return list
}

/** Parse all three Game Corner prize lists. */
export function readPrizeLists(rom: RomBuffer, anchors: AnchorMap): Record<PrizeKind, PrizeList> {
  const out = {} as Record<PrizeKind, PrizeList>
  for (const kind of PRIZE_KINDS) {
    const dispatchOffset = anchors.gcScript + DISPATCH_REL[kind]
    out[kind] = parseList(rom, anchors, kind, dispatchOffset)
  }
  return out
}

/**
 * Placeholder prize lists for ROMs without a Celadon Game Corner (anchors with
 * multichoice/gcScript = 0, e.g. Emerald/H&S). All non-regenerable so the UI
 * treats the feature as absent rather than reading garbage from offset 0.
 */
export function emptyPrizeLists(): Record<PrizeKind, PrizeList> {
  const out = {} as Record<PrizeKind, PrizeList>
  for (const kind of PRIZE_KINDS) {
    out[kind] = {
      kind,
      regenerable: false,
      entries: [],
      handlerOffset: -1,
      dispatchOffset: -1,
      exitTarget: -1,
      mcSetOffset: -1,
      mcOptionsOffset: -1,
      mcCount: 0,
      noThanksTextPtr: -1,
      labelRightAlignX: 0x55,
      routineExtra: new Uint8Array(0),
    }
  }
  return out
}

export function prizesEqual(a: Prize[], b: Prize[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => p.id === b[i].id && p.cost === b[i].cost && (p.level ?? 0) === (b[i].level ?? 0))
  )
}

// ── Serialization ─────────────────────────────────────────────────────────

/** A byte blob to place at a freshly-allocated offset, or an absolute pointer to write. */
export interface PrizeEdit {
  /** Blobs written verbatim at their allocated offset (offset filled in by the allocator). */
  blobs: Array<{ offset: number; bytes: Uint8Array }>
  /** u32 GBA pointers to write: at `at`, store GBA_ROM_BASE + `target`. */
  pointers: Array<{ at: number; target: number }>
  /** u32 values to write directly (e.g. the multichoice count). */
  words: Array<{ at: number; value: number }>
}

/** Emit a `setvar var,value` (5 bytes). */
function setvar(varId: number, value: number): number[] {
  return [OP_SETVAR, varId & 0xff, (varId >> 8) & 0xff, value & 0xff, (value >> 8) & 0xff]
}
/** Emit a `compare var,value` (5 bytes). */
function compare(varId: number, value: number): number[] {
  return [OP_COMPARE, varId & 0xff, (varId >> 8) & 0xff, value & 0xff, (value >> 8) & 0xff]
}
/** Emit a `goto <ptr>` (5 bytes) with the pointer as a placeholder to be filled. */
function gotoBytes(target: number): number[] {
  const p = toPtr(target)
  return [OP_GOTO, p & 0xff, (p >> 8) & 0xff, (p >> 16) & 0xff, (p >> 24) & 0xff]
}
/** Emit a `goto_if EQ,<ptr>` (6 bytes). */
function gotoIf(target: number): number[] {
  const p = toPtr(target)
  return [OP_GOTO_IF, 0x01, p & 0xff, (p >> 8) & 0xff, (p >> 16) & 0xff, (p >> 24) & 0xff]
}

/**
 * Build the write-plan to regenerate one prize list with `newEntries`.
 *
 * Strategy (all new bytes go to free space via `allocate`):
 *  1. Emit each prize routine: `setvar id / setvar cost / <routineExtra> / goto handler / end`.
 *  2. Emit the dispatch chain: for i in 0..n-1 `compare VAR_0x8000,i ; goto_if routine[i]`,
 *     then the two sentinel pairs (5, 0x7f) → exitTarget, then `end`.
 *  3. Overwrite the original dispatch start with `goto <new dispatch>` (the fall-through hook).
 *  4. For Pokémon: regenerate the species-keyed secondary chain + per-species give routines,
 *     and hook the original secondary chain the same way.
 *  5. Rebuild the multichoice options array (labels + trailing NO THANKS), repoint the set's
 *     optionsPtr, and set its count.
 *
 * Offsets inside emitted blobs are resolved in two passes: first we lay out blob sizes to
 * learn their offsets, then fill in inter-blob pointers.
 */
export function buildPrizeListEdit(
  list: PrizeList,
  newEntries: Prize[],
  ctx: {
    allocate: (size: number) => number
    speciesName: (id: number) => string
    itemName: (id: number) => string
  },
): PrizeEdit {
  const edit: PrizeEdit = { blobs: [], pointers: [], words: [] }
  const n = newEntries.length

  // --- 1+2: routines then dispatch, in one contiguous blob so offsets are known. ---
  // Lay out routine bytes; remember each routine's start offset within the blob.
  const routineChunks: number[][] = []
  for (const e of newEntries) {
    const chunk = [...setvar(VAR_ITEM, e.id), ...setvar(VAR_COST, e.cost), ...list.routineExtra, ...gotoBytes(list.handlerOffset), OP_END]
    routineChunks.push(chunk)
  }
  // Dispatch chain size: n pairs (11 each) + 2 sentinel pairs (11 each) + end (1).
  const dispatchSize = n * 11 + 2 * 11 + 1
  const routinesSize = routineChunks.reduce((s, c) => s + c.length, 0)
  const scriptBlob = new Uint8Array(dispatchSize + routinesSize)
  const scriptBase = ctx.allocate(scriptBlob.length)

  // Dispatch goes first; routines after it.
  let ro = scriptBase + dispatchSize // absolute offset of first routine
  const routineOffsets: number[] = []
  for (const chunk of routineChunks) {
    routineOffsets.push(ro)
    ro += chunk.length
  }

  // Write dispatch chain into scriptBlob[0..dispatchSize).
  let w = 0
  const put = (bytes: number[]) => {
    scriptBlob.set(bytes, w)
    w += bytes.length
  }
  for (let i = 0; i < n; i++) {
    put(compare(VAR_SELECT, i))
    put(gotoIf(routineOffsets[i]))
  }
  // Exit sentinels: value `n` (end-of-list marker) then 0x7f, both → exit routine.
  put(compare(VAR_SELECT, n))
  put(gotoIf(list.exitTarget))
  put(compare(VAR_SELECT, SENTINEL_B))
  put(gotoIf(list.exitTarget))
  scriptBlob[w++] = OP_END
  // Append routines.
  for (const chunk of routineChunks) {
    scriptBlob.set(chunk, w)
    w += chunk.length
  }
  edit.blobs.push({ offset: scriptBase, bytes: scriptBlob })

  // --- 3: hook the original dispatch with `goto <new dispatch (scriptBase)>`. ---
  edit.blobs.push({ offset: list.dispatchOffset, bytes: Uint8Array.from(gotoBytes(scriptBase)) })

  // --- 4: Pokémon secondary chain regeneration. ---
  if (list.kind === 'pokemon' && list.secondaryRoutines && list.secondaryTail !== undefined) {
    const tmpl = list.secondaryRoutines[0].bytes // template give-message routine
    // Build per-entry give routines (clone template, patch level u16 at offset 3).
    const giveChunks = newEntries.map((e) => {
      const bytes = tmpl.slice()
      const lvl = e.level ?? 5
      bytes[3] = lvl & 0xff
      bytes[4] = (lvl >> 8) & 0xff
      return bytes
    })
    const secDispatchSize = n * 11 + 11 + 1 // n species pairs + sentinel(0x7f) pair + end
    const secGiveSize = giveChunks.reduce((s, c) => s + c.length, 0)
    const secBlob = new Uint8Array(secDispatchSize + secGiveSize)
    const secBase = ctx.allocate(secBlob.length)

    let go = secBase + secDispatchSize
    const giveOffsets: number[] = []
    for (const c of giveChunks) {
      giveOffsets.push(go)
      go += c.length
    }
    let sw = 0
    const sput = (bytes: number[]) => {
      secBlob.set(bytes, sw)
      sw += bytes.length
    }
    // copyvar VAR_0x8000, VAR_0x4001 (19 00 80 01 40) precedes in the original; the original
    // secondary dispatch starts right after it. We hook the original secondary dispatch too.
    const secSentinel = list.secondarySentinelTarget ?? list.exitTarget
    for (let i = 0; i < n; i++) {
      sput(compare(VAR_SELECT, newEntries[i].id))
      sput(gotoIf(giveOffsets[i]))
    }
    sput(compare(VAR_SELECT, SENTINEL_B))
    sput(gotoIf(secSentinel))
    secBlob[sw++] = OP_END
    for (const c of giveChunks) {
      secBlob.set(c, sw)
      sw += c.length
    }
    edit.blobs.push({ offset: secBase, bytes: secBlob })

    // Hook: overwrite the original secondary dispatch start with `goto <secBase>`.
    // The original secondary dispatch begins just after `copyvar V8000,V4001` in the handler.
    const secDispatchOrig = list.secondaryDispatchOffset ?? -1
    if (secDispatchOrig >= 0) {
      edit.blobs.push({ offset: secDispatchOrig, bytes: Uint8Array.from(gotoBytes(secBase)) })
    }
  }

  // --- 5: multichoice options array + labels. ---
  // Options: one {textPtr, unused} per entry + trailing NO THANKS row.
  const rowCount = n + 1
  const optionsBlob = new Uint8Array(rowCount * 8)
  const optionsBase = ctx.allocate(optionsBlob.length)
  const labelBytes: Array<{ offset: number; bytes: Uint8Array }> = []
  for (let i = 0; i < n; i++) {
    const e = newEntries[i]
    const name = list.kind === 'pokemon' ? ctx.speciesName(e.id) : ctx.itemName(e.id)
    const label = makePrizeLabel(name, e.cost, list.labelRightAlignX)
    const labelOff = ctx.allocate(label.length)
    labelBytes.push({ offset: labelOff, bytes: label })
    edit.pointers.push({ at: optionsBase + i * 8, target: labelOff })
    // unused u32 stays 0
  }
  // Trailing NO THANKS row reuses the preserved text pointer.
  edit.pointers.push({ at: optionsBase + n * 8, target: list.noThanksTextPtr })
  edit.blobs.push({ offset: optionsBase, bytes: optionsBlob })
  for (const lb of labelBytes) edit.blobs.push(lb)

  // Repoint the multichoice set's optionsPtr and set its count.
  edit.pointers.push({ at: list.mcSetOffset, target: optionsBase })
  edit.words.push({ at: list.mcSetOffset + 4, value: rowCount })

  return edit
}
