import type { RomBuffer } from '../buffer'
import type { AnchorMap } from '../anchors'

/**
 * In-game trade table (`gIngameTrades`) support.
 *
 * Heart & Soul relocated the table out of the vanilla Emerald address and
 * **widened the record to 64 bytes** (vanilla is 60). The extra 4 bytes sit in
 * the middle block, so everything from `heldItem` on is shifted by +4 — which is
 * why a vanilla-layout scan for 60-byte records never matched anything here.
 *
 * Layout confirmed against the Violet City trade (nickname "ROCKY", OT "RUDY"):
 *
 *   0x00  nickname[12]        "ROCKY"
 *   0x0C  species u16         95 (ONIX)
 *   0x0E  ivs[6]              31/31/31/31/31/31 on every H&S trade
 *   0x14  otId / personality / contest block — not individually pinned; kept
 *         verbatim in `raw` so a record can be rewritten byte-exactly
 *   0x2C  heldItem u16
 *   0x2E  mailNum u8
 *   0x2F  otName[12]          "RUDY"      (vanilla: 0x2B)
 *   0x3C  requestedSpecies u16  69 (BELLSPROUT)   (vanilla: 0x38)
 *
 * Only 6 of the 13 records are reachable in the current build — the NPC scripts
 * that drive a trade do `setvar VAR_0x8008,<index>` / `copyvar VAR_0x8004,…` /
 * `special 0xA8`, and a ROM-wide sweep for that preamble finds indices 0, 1, 2,
 * 4, 5 and 6 only. The rest are authored but unwired; `findTradeScriptIndices`
 * reports which ones a given ROM actually hooks up.
 */

export const TRADE_RECORD_LEN = 0x40
const NICKNAME_LEN = 12
const OT_NAME_LEN = 12

const OFF_SPECIES = 0x0c
const OFF_IVS = 0x0e
const OFF_HELD_ITEM = 0x2c
const OFF_MAIL_NUM = 0x2e
const OFF_OT_NAME = 0x2f
const OFF_REQUESTED = 0x3c

export interface IngameTrade {
  /** Index into the table — also the value the NPC script puts in VAR_0x8008. */
  index: number
  /** ROM offset of this record. */
  offset: number
  /** Nickname the received Pokémon arrives with. */
  nickname: string
  /** Species the player receives. */
  species: number
  /** Species the player must hand over. */
  requestedSpecies: number
  /** HP/Atk/Def/Spe/SpA/SpD, in base-stats order. */
  ivs: number[]
  heldItem: number
  mailNum: number
  /** Original-trainer name shown on the summary screen. */
  otName: string
  /** The whole record, for byte-exact round-tripping of the unmapped middle. */
  raw: Uint8Array
}

/** Names terminate with 0xFF, but tolerate 0x00-padded fields too (0x00 decodes to a space). */
const trimField = (s: string) => s.replace(/\s+$/, '')

/** Read one record; returns null when it doesn't look like a trade at all. */
function readTrade(rom: RomBuffer, base: number, index: number, speciesCount: number): IngameTrade | null {
  const off = base + index * TRADE_RECORD_LEN
  if (off + TRADE_RECORD_LEN > rom.length) return null
  const species = rom.u16(off + OFF_SPECIES)
  const requestedSpecies = rom.u16(off + OFF_REQUESTED)
  if (species === 0 || species >= speciesCount) return null
  if (requestedSpecies === 0 || requestedSpecies >= speciesCount) return null
  const nickname = trimField(rom.text(off, NICKNAME_LEN))
  if (!nickname) return null
  return {
    index,
    offset: off,
    nickname,
    species,
    requestedSpecies,
    ivs: [...rom.slice(off + OFF_IVS, 6)],
    heldItem: rom.u16(off + OFF_HELD_ITEM),
    mailNum: rom.u8(off + OFF_MAIL_NUM),
    otName: trimField(rom.text(off + OFF_OT_NAME, OT_NAME_LEN)),
    raw: rom.slice(off, TRADE_RECORD_LEN),
  }
}

/**
 * Read the whole trade table. Stops at the first record that fails validation,
 * so a wrong/absent anchor yields `[]` rather than garbage.
 */
export function readIngameTrades(rom: RomBuffer, a: AnchorMap): IngameTrade[] {
  if (!a.ingameTrades) return []
  const out: IngameTrade[] = []
  for (let i = 0; i < a.ingameTradeCount; i++) {
    const t = readTrade(rom, a.ingameTrades, i, a.speciesCount)
    if (!t) break
    out.push(t)
  }
  return out
}

// ── which trades are actually reachable ───────────────────────────────────

const OP_SETVAR = 0x16
const OP_COPYVAR = 0x19
const OP_SPECIAL = 0x25
const VAR_TRADE_INDEX = 0x8008 // NPC scripts stage the trade index here
const VAR_SPECIAL_ARG = 0x8004 // …then copy it to the special's argument var
const SPECIAL_TRADE = 0x00a8

/**
 * Sweep the ROM for the trade-NPC preamble
 * (`setvar VAR_0x8008,<idx>` + `copyvar VAR_0x8004,VAR_0x8008`) and return the
 * indices that some script actually triggers, each with the offsets that do it.
 *
 * The `special 0xA8` that follows is checked within a short window: a few NPCs
 * put a message box between the copyvar and the special. Gym scripts reuse
 * VAR_0x8008 as a leader index (dispatching through a jump table instead), which
 * is exactly what the copyvar+special pair rejects.
 */
export function findTradeScriptIndices(rom: RomBuffer, maxIndex: number): Map<number, number[]> {
  const found = new Map<number, number[]>()
  const SPECIAL_WINDOW = 0x60
  for (let o = 0; o + 12 < rom.length; o++) {
    if (rom.u8(o) !== OP_SETVAR || rom.u16(o + 1) !== VAR_TRADE_INDEX) continue
    if (rom.u8(o + 5) !== OP_COPYVAR) continue
    if (rom.u16(o + 6) !== VAR_SPECIAL_ARG || rom.u16(o + 8) !== VAR_TRADE_INDEX) continue
    const index = rom.u16(o + 3)
    if (index >= maxIndex) continue
    let hasSpecial = false
    for (let p = o + 10; p < o + SPECIAL_WINDOW && p + 2 < rom.length; p++) {
      if (rom.u8(p) === OP_SPECIAL && rom.u16(p + 1) === SPECIAL_TRADE) {
        hasSpecial = true
        break
      }
    }
    if (!hasSpecial) continue
    const list = found.get(index) ?? []
    list.push(o)
    found.set(index, list)
  }
  return found
}
