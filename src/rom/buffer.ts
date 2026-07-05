import { decode } from './charmap'

export const GBA_ROM_BASE = 0x08000000

/** Little-endian view over a GBA ROM with pointer helpers. */
export class RomBuffer {
  readonly bytes: Uint8Array
  private view: DataView

  constructor(data: ArrayBuffer | Uint8Array) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength)
  }

  get length(): number {
    return this.bytes.length
  }

  u8(offset: number): number {
    return this.view.getUint8(offset)
  }

  u16(offset: number): number {
    return this.view.getUint16(offset, true)
  }

  u32(offset: number): number {
    return this.view.getUint32(offset, true)
  }

  i8(offset: number): number {
    return this.view.getInt8(offset)
  }

  /**
   * Read a 4-byte GBA pointer and convert to a ROM file offset.
   * Returns null if the value is not a valid pointer into this ROM.
   */
  pointer(offset: number): number | null {
    const raw = this.u32(offset)
    if (raw < GBA_ROM_BASE) return null
    const off = raw - GBA_ROM_BASE
    return off < this.length ? off : null
  }

  slice(offset: number, len: number): Uint8Array {
    return this.bytes.subarray(offset, offset + len)
  }

  /** Decode a fixed-width Gen 3 text field at `offset`. */
  text(offset: number, maxLen: number): string {
    return decode(this.bytes, offset, maxLen)
  }

  /** ASCII game code at 0xAC (e.g. "BPRE" for FireRed US). */
  gameCode(): string {
    return String.fromCharCode(...this.bytes.subarray(0xac, 0xb0))
  }

  /** ASCII game title at 0xA0. */
  title(): string {
    return String.fromCharCode(...this.bytes.subarray(0xa0, 0xac)).replace(/\0+$/, '')
  }
}
