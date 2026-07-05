import type { RomBuffer } from '../buffer'

/**
 * TM/HM and tutor compatibility are bitfield rows, one per species:
 * bit i (byte i>>3, mask 1<<(i&7)) = species can learn the i-th move of the
 * corresponding move-id table (58 TM/HM slots → 8 bytes, 15 tutors → 2 bytes).
 */

export function compatRowBytes(moveCount: number): number {
  return Math.ceil(moveCount / 8)
}

/** Read a u16 move-id table (the TM or tutor move lists). */
export function readMoveIdTable(rom: RomBuffer, offset: number, count: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(rom.u16(offset + i * 2))
  return out
}

export function readCompatRow(
  rom: RomBuffer,
  tableOffset: number,
  species: number,
  moveCount: number,
): boolean[] {
  const rowBytes = compatRowBytes(moveCount)
  const base = tableOffset + species * rowBytes
  const out: boolean[] = []
  for (let i = 0; i < moveCount; i++) {
    out.push((rom.u8(base + (i >> 3)) & (1 << (i & 7))) !== 0)
  }
  return out
}

export function readAllCompat(
  rom: RomBuffer,
  tableOffset: number,
  speciesCount: number,
  moveCount: number,
): boolean[][] {
  const out: boolean[][] = []
  for (let s = 0; s < speciesCount; s++) out.push(readCompatRow(rom, tableOffset, s, moveCount))
  return out
}

export function serializeCompatRow(flags: boolean[]): Uint8Array {
  const out = new Uint8Array(compatRowBytes(flags.length))
  flags.forEach((set, i) => {
    if (set) out[i >> 3] |= 1 << (i & 7)
  })
  return out
}

export function flagsEqual(a: boolean[], b: boolean[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** Display label for the i-th TM/HM slot: TM01–TM50, then HM01+. */
export function tmSlotLabel(index: number): string {
  return index < 50
    ? `TM${String(index + 1).padStart(2, '0')}`
    : `HM${String(index - 49).padStart(2, '0')}`
}
