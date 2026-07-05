import type { RomBuffer } from '../buffer'
import type { AnchorMap } from '../anchors'
import { encode, TERMINATOR } from '../charmap'

/**
 * In-game NPC trades (`data.pokemon.trades`). Each entry is a fixed 60-byte
 * (0x3C) `struct IngameTrade`; the table is `tradeCount` entries long, so every
 * edit is written in place — no repointing.
 *
 * Field layout (matches HMA's format string and pokefirered's struct):
 *   0x00 nickname[12]     name of the Pokémon you receive (11 usable + pad)
 *   0x0C receivedSpecies  u16 — the Pokémon the NPC gives you
 *   0x0E ivs[6]           u8×6 — HP, Atk, Def, Speed, Sp.Atk, Sp.Def
 *   0x14 abilityNum       u8 (+3 pad) — which ability slot
 *   0x18 otId             u32 — original trainer id
 *   0x1C conditions[5]    u8×5 — contest: Cool, Tough, Beauty, Smart, Cute
 *   0x24 personality      u32 (+3 pad after conditions) — nature/gender/shininess
 *   0x28 heldItem         u16 — item the received Pokémon holds
 *   0x2A mailNum          u8
 *   0x2B otName[11]       original trainer name (7 usable + pad)
 *   0x36 otGender         u8 — 0 male, 1 female
 *   0x37 sheen            u8 — contest sheen
 *   0x38 requestedSpecies u16 (+2 pad) — the Pokémon you must hand over
 */

export const TRADE_ENTRY_LEN = 0x3c
export const TRADE_NICKNAME_LEN = 12
export const TRADE_OT_NAME_LEN = 11
/** Player-facing character limits (game name lengths). */
export const MAX_NICKNAME_CHARS = 10
export const MAX_OT_NAME_CHARS = 7
export const IV_COUNT = 6
export const CONDITION_COUNT = 5
export const MAX_IV = 31

export const IV_LABELS = ['HP', 'Atk', 'Def', 'Speed', 'Sp.Atk', 'Sp.Def'] as const
export const CONDITION_LABELS = ['Cool', 'Tough', 'Beauty', 'Smart', 'Cute'] as const

/** Nature index = personality % 25. */
export const NATURE_NAMES = [
  'Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty',
  'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax',
  'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive',
  'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash',
  'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky',
] as const

export interface Trade {
  nickname: string
  receivedSpecies: number
  ivs: number[]
  abilityNum: number
  otId: number
  conditions: number[]
  personality: number
  heldItem: number
  mailNum: number
  otName: string
  otGender: number
  sheen: number
  requestedSpecies: number
}

const OFF = {
  nickname: 0x00,
  received: 0x0c,
  ivs: 0x0e,
  abilityNum: 0x14,
  otId: 0x18,
  conditions: 0x1c,
  personality: 0x24,
  heldItem: 0x28,
  mailNum: 0x2a,
  otName: 0x2b,
  otGender: 0x36,
  sheen: 0x37,
  requested: 0x38,
} as const

export function readTrade(rom: RomBuffer, a: AnchorMap, index: number): Trade {
  const base = a.trades + index * TRADE_ENTRY_LEN
  const ivs: number[] = []
  for (let i = 0; i < IV_COUNT; i++) ivs.push(rom.u8(base + OFF.ivs + i))
  const conditions: number[] = []
  for (let i = 0; i < CONDITION_COUNT; i++) conditions.push(rom.u8(base + OFF.conditions + i))
  return {
    nickname: rom.text(base + OFF.nickname, TRADE_NICKNAME_LEN),
    receivedSpecies: rom.u16(base + OFF.received),
    ivs,
    abilityNum: rom.u8(base + OFF.abilityNum),
    otId: rom.u32(base + OFF.otId),
    conditions,
    personality: rom.u32(base + OFF.personality),
    heldItem: rom.u16(base + OFF.heldItem),
    mailNum: rom.u8(base + OFF.mailNum),
    otName: rom.text(base + OFF.otName, TRADE_OT_NAME_LEN),
    otGender: rom.u8(base + OFF.otGender),
    sheen: rom.u8(base + OFF.sheen),
    requestedSpecies: rom.u16(base + OFF.requested),
  }
}

export function readAllTrades(rom: RomBuffer, a: AnchorMap): Trade[] {
  const out: Trade[] = []
  for (let i = 0; i < a.tradeCount; i++) out.push(readTrade(rom, a, i))
  return out
}

/** Encode `text` into a fixed-width name field: chars, 0xFF terminator, 0x00 pad. */
function writeName(out: Uint8Array, offset: number, width: number, text: string): void {
  const enc = encode(text) // throws on unmappable characters
  if (enc.length > width) {
    throw new Error(`text “${text}” needs ${enc.length} bytes, field holds ${width}`)
  }
  out.set(enc, offset)
  for (let i = enc.length; i < width; i++) {
    out[offset + i] = i === enc.length ? TERMINATOR : 0x00
  }
}

/**
 * Serialize a trade into its 60-byte block. Starts from the original bytes so
 * the struct's padding/unused regions are preserved, then overwrites every
 * editable field. Throws if a name field can't be encoded or doesn't fit.
 */
export function serializeTrade(t: Trade, original: Uint8Array): Uint8Array {
  const out = original.slice(0, TRADE_ENTRY_LEN)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  writeName(out, OFF.nickname, TRADE_NICKNAME_LEN, t.nickname)
  view.setUint16(OFF.received, t.receivedSpecies, true)
  for (let i = 0; i < IV_COUNT; i++) out[OFF.ivs + i] = t.ivs[i] & 0xff
  out[OFF.abilityNum] = t.abilityNum & 0xff
  view.setUint32(OFF.otId, t.otId >>> 0, true)
  for (let i = 0; i < CONDITION_COUNT; i++) out[OFF.conditions + i] = t.conditions[i] & 0xff
  view.setUint32(OFF.personality, t.personality >>> 0, true)
  view.setUint16(OFF.heldItem, t.heldItem, true)
  out[OFF.mailNum] = t.mailNum & 0xff
  writeName(out, OFF.otName, TRADE_OT_NAME_LEN, t.otName)
  out[OFF.otGender] = t.otGender & 0xff
  out[OFF.sheen] = t.sheen & 0xff
  view.setUint16(OFF.requested, t.requestedSpecies, true)
  return out
}

export function tradesEqual(a: Trade, b: Trade): boolean {
  return (
    a.nickname === b.nickname &&
    a.receivedSpecies === b.receivedSpecies &&
    a.ivs.length === b.ivs.length &&
    a.ivs.every((v, i) => v === b.ivs[i]) &&
    a.abilityNum === b.abilityNum &&
    a.otId === b.otId &&
    a.conditions.length === b.conditions.length &&
    a.conditions.every((v, i) => v === b.conditions[i]) &&
    a.personality === b.personality &&
    a.heldItem === b.heldItem &&
    a.mailNum === b.mailNum &&
    a.otName === b.otName &&
    a.otGender === b.otGender &&
    a.sheen === b.sheen &&
    a.requestedSpecies === b.requestedSpecies
  )
}

export function natureName(personality: number): string {
  return NATURE_NAMES[(personality >>> 0) % 25]
}

/** "Get NIDORINA for NIDORINO" style summary for the trade list. */
export function describeTrade(t: Trade, speciesNames: (id: number) => string): string {
  return `${speciesNames(t.receivedSpecies)} for ${speciesNames(t.requestedSpecies)}`
}
