import type { RomBuffer } from '../buffer'
import { GBA_ROM_BASE } from '../buffer'
import type { AnchorMap } from '../anchors'
import { encode } from '../charmap'

/**
 * Trainer data (verified against the real modded ROM, 2026-07-18).
 *
 * `data.trainers.stats` is a fixed array of 40-byte records:
 *   0x00 u8  structType   bit0 = custom moves, bit1 = held items
 *   0x01 u8  class        index into data.trainers.classes.names
 *   0x02 u8  music/gender bit7 = female, low 7 bits = intro music
 *   0x03 u8  sprite       front-sprite index
 *   0x04 char name[12]    0xFF-terminated
 *   0x10 u16 items[4]     the AI's usable battle items (potions, …)
 *   0x18 u32 doubleBattle
 *   0x1C u32 aiFlags
 *   0x20 u32 partyCount
 *   0x24 ptr party        → the party block
 *
 * Each party entry is `iv, level, species` (u16 each) followed by, depending
 * on structType: nothing (8-byte entry, 2 bytes padding), a held item (8-byte),
 * four moves (16-byte entry, 2 bytes padding), or a held item + four moves
 * (16-byte). Entry stride is 8 when structType has no custom moves, else 16 —
 * confirmed 90/90 and 15/15 valid across every custom-move trainer.
 *
 * The 40-byte records are fixed-size (written in place); a party block is
 * relocated to free space only when the edited party no longer fits its slot.
 */

export const TRAINER_STRUCT_LEN = 40
export const TRAINER_NAME_LEN = 12
export const TRAINER_CLASS_NAME_LEN = 13
export const MAX_PARTY = 6
export const TRAINER_ITEM_COUNT = 4
export const MOVES_PER_MON = 4
export const MAX_IV = 255

// Field offsets within a trainer record.
const O_STRUCT = 0
const O_CLASS = 1
const O_MUSIC = 2
const O_SPRITE = 3
const O_NAME = 4
const O_ITEMS = 0x10
const O_DOUBLE = 0x18
const O_AI = 0x1c
const O_COUNT = 0x20
const O_PARTY = 0x24

const GENDER_BIT = 0x80
const STRUCT_MOVES = 1
const STRUCT_ITEMS = 2

/** One Pokémon on a trainer's team (normalized: 0 = no item / no move). */
export interface TrainerMon {
  /** Difficulty byte the engine scales into IVs (0–255). */
  iv: number
  level: number
  species: number
  heldItem: number
  /** Always length 4; 0 = empty slot (engine fills defaults when custom moves off). */
  moves: number[]
}

/** The editable value half of a trainer (offsets are re-resolved at write time). */
export interface TrainerEdit {
  name: string
  cls: number
  gender: number // 0 = male, 1 = female
  music: number // 0–127
  sprite: number
  items: number[] // length 4 — trainer battle items
  doubleBattle: number
  aiFlags: number
  /** structType bit0 — party entries carry four explicit moves. */
  hasMoves: boolean
  /** structType bit1 — party entries carry a held item. */
  hasItems: boolean
  party: TrainerMon[]
}

export interface Trainer extends TrainerEdit {
  index: number
  structType: number
  recordOffset: number
  /** Where the party block currently lives, and its byte capacity there. */
  partyOffset: number | null
  partyCapacity: number
}

export function partyEntryLen(hasMoves: boolean): number {
  return hasMoves ? 16 : 8
}

export function structTypeOf(e: Pick<TrainerEdit, 'hasMoves' | 'hasItems'>): number {
  return (e.hasMoves ? STRUCT_MOVES : 0) | (e.hasItems ? STRUCT_ITEMS : 0)
}

function readMon(rom: RomBuffer, base: number, hasMoves: boolean, hasItems: boolean): TrainerMon {
  const iv = rom.u16(base)
  const level = rom.u16(base + 2)
  const species = rom.u16(base + 4)
  const heldItem = hasItems ? rom.u16(base + 6) : 0
  const moves = [0, 0, 0, 0]
  if (hasMoves) {
    const mo = hasItems ? base + 8 : base + 6
    for (let i = 0; i < MOVES_PER_MON; i++) moves[i] = rom.u16(mo + i * 2)
  }
  return { iv, level, species, heldItem, moves }
}

export function readTrainer(rom: RomBuffer, a: AnchorMap, index: number): Trainer {
  const o = a.trainers + index * TRAINER_STRUCT_LEN
  const structType = rom.u8(o + O_STRUCT)
  const hasMoves = (structType & STRUCT_MOVES) !== 0
  const hasItems = (structType & STRUCT_ITEMS) !== 0
  const musicGender = rom.u8(o + O_MUSIC)
  const count = rom.u32(o + O_COUNT)
  const partyOffset = rom.pointer(o + O_PARTY)
  const entryLen = partyEntryLen(hasMoves)
  const party: TrainerMon[] = []
  if (partyOffset !== null) {
    for (let i = 0; i < count && i <= MAX_PARTY; i++) {
      party.push(readMon(rom, partyOffset + i * entryLen, hasMoves, hasItems))
    }
  }
  return {
    index,
    structType,
    recordOffset: o,
    partyOffset,
    partyCapacity: partyOffset === null ? 0 : count * entryLen,
    name: rom.text(o + O_NAME, TRAINER_NAME_LEN),
    cls: rom.u8(o + O_CLASS),
    gender: musicGender & GENDER_BIT ? 1 : 0,
    music: musicGender & ~GENDER_BIT,
    sprite: rom.u8(o + O_SPRITE),
    items: [0, 1, 2, 3].map((i) => rom.u16(o + O_ITEMS + i * 2)),
    doubleBattle: rom.u32(o + O_DOUBLE),
    aiFlags: rom.u32(o + O_AI),
    hasMoves,
    hasItems,
    party,
  }
}

export function readAllTrainers(rom: RomBuffer, a: AnchorMap): Trainer[] {
  const out: Trainer[] = []
  for (let i = 0; i < a.trainerCount; i++) out.push(readTrainer(rom, a, i))
  return out
}

export function readTrainerClassNames(rom: RomBuffer, a: AnchorMap): string[] {
  const out: string[] = []
  for (let i = 0; i < a.trainerClassCount; i++) {
    out.push(rom.text(a.trainerClasses + i * TRAINER_CLASS_NAME_LEN, TRAINER_CLASS_NAME_LEN))
  }
  return out
}

/** Strip a Trainer down to its editable value (drops offsets/index/structType). */
export function trainerToEdit(t: Trainer): TrainerEdit {
  return {
    name: t.name,
    cls: t.cls,
    gender: t.gender,
    music: t.music,
    sprite: t.sprite,
    items: [...t.items],
    doubleBattle: t.doubleBattle,
    aiFlags: t.aiFlags,
    hasMoves: t.hasMoves,
    hasItems: t.hasItems,
    party: t.party.map((m) => ({ ...m, moves: [...m.moves] })),
  }
}

/** Serialize just the party block (variable length). Throws on invalid values. */
export function serializeParty(e: TrainerEdit, speciesCount: number, moveCount: number, itemCount: number): Uint8Array {
  const entryLen = partyEntryLen(e.hasMoves)
  const out = new Uint8Array(e.party.length * entryLen)
  const view = new DataView(out.buffer)
  e.party.forEach((m, i) => {
    const where = `party slot ${i + 1}`
    if (m.iv < 0 || m.iv > MAX_IV) throw new Error(`${where}: IV ${m.iv} out of range (0–${MAX_IV})`)
    if (m.level < 1 || m.level > 100) throw new Error(`${where}: level ${m.level} out of range (1–100)`)
    if (m.species < 1 || m.species >= speciesCount) throw new Error(`${where}: invalid species #${m.species}`)
    const base = i * entryLen
    view.setUint16(base, m.iv, true)
    view.setUint16(base + 2, m.level, true)
    view.setUint16(base + 4, m.species, true)
    if (e.hasItems) {
      if (m.heldItem < 0 || m.heldItem >= itemCount) throw new Error(`${where}: invalid held item #${m.heldItem}`)
      view.setUint16(base + 6, m.heldItem, true)
    }
    if (e.hasMoves) {
      const mo = e.hasItems ? base + 8 : base + 6
      for (let j = 0; j < MOVES_PER_MON; j++) {
        const mv = m.moves[j] ?? 0
        if (mv < 0 || mv >= moveCount) throw new Error(`${where}: invalid move #${mv}`)
        view.setUint16(mo + j * 2, mv, true)
      }
    }
  })
  return out
}

/** Serialize the fixed 40-byte record. `partyPtr` is a GBA address (0x08…). */
export function serializeTrainerRecord(e: TrainerEdit, partyPtr: number, classCount: number, itemCount: number): Uint8Array {
  if (e.party.length < 1 || e.party.length > MAX_PARTY) {
    throw new Error(`party size ${e.party.length} out of range (1–${MAX_PARTY})`)
  }
  if (e.cls < 0 || e.cls >= classCount) throw new Error(`invalid class #${e.cls}`)
  for (const it of e.items) {
    if (it < 0 || it >= itemCount) throw new Error(`invalid trainer item #${it}`)
  }
  const out = new Uint8Array(TRAINER_STRUCT_LEN)
  const view = new DataView(out.buffer)
  out[O_STRUCT] = structTypeOf(e)
  out[O_CLASS] = e.cls
  out[O_MUSIC] = (e.music & ~GENDER_BIT) | (e.gender ? GENDER_BIT : 0)
  out[O_SPRITE] = e.sprite
  writeName(out, O_NAME, e.name)
  e.items.forEach((it, i) => view.setUint16(O_ITEMS + i * 2, it, true))
  view.setUint32(O_DOUBLE, e.doubleBattle >>> 0, true)
  view.setUint32(O_AI, e.aiFlags >>> 0, true)
  view.setUint32(O_COUNT, e.party.length, true)
  view.setUint32(O_PARTY, partyPtr >>> 0, true)
  return out
}

function writeName(out: Uint8Array, offset: number, name: string): void {
  let bytes: Uint8Array
  try {
    bytes = encode(name)
  } catch (err) {
    throw new Error(`name “${name}”: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (bytes.length > TRAINER_NAME_LEN) throw new Error(`name “${name}” exceeds ${TRAINER_NAME_LEN} characters`)
  out.fill(0xff, offset, offset + TRAINER_NAME_LEN)
  out.set(bytes, offset)
}

export function monsEqual(a: TrainerMon, b: TrainerMon): boolean {
  return (
    a.iv === b.iv &&
    a.level === b.level &&
    a.species === b.species &&
    a.heldItem === b.heldItem &&
    a.moves.every((m, i) => m === b.moves[i])
  )
}

export function trainersEqual(a: TrainerEdit, b: TrainerEdit): boolean {
  return (
    a.name === b.name &&
    a.cls === b.cls &&
    a.gender === b.gender &&
    a.music === b.music &&
    a.sprite === b.sprite &&
    a.doubleBattle === b.doubleBattle &&
    a.aiFlags === b.aiFlags &&
    a.hasMoves === b.hasMoves &&
    a.hasItems === b.hasItems &&
    a.items.every((it, i) => it === b.items[i]) &&
    a.party.length === b.party.length &&
    a.party.every((m, i) => monsEqual(m, b.party[i]))
  )
}

/** A fresh Pokémon for the "add" button (level-5 Bulbasaur, no item/moves). */
export function blankMon(): TrainerMon {
  return { iv: 0, level: 5, species: 1, heldItem: 0, moves: [0, 0, 0, 0] }
}

/** GBA address of a party block given its file offset. */
export function partyGbaPointer(offset: number): number {
  return GBA_ROM_BASE + offset
}
