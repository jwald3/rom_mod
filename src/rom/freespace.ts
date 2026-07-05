export const FREE_BYTE = 0xff

/**
 * Free space in a GBA ROM is a run of 0xFF bytes. We scan for real runs
 * instead of trusting HMA's FreeSpaceSearch hint (proven stale on this ROM).
 * The floor keeps allocations in the high region where HMA also appends,
 * away from any small 0xFF padding runs inside original data.
 */
export const DEFAULT_FLOOR = 0x700000

/** Padding kept free after each allocation (HMA keeps gaps between objects too). */
const DEFAULT_SLACK = 16

export class FreeSpaceAllocator {
  private cursor: number

  constructor(
    private bytes: Uint8Array,
    floor = DEFAULT_FLOOR,
    private slack = DEFAULT_SLACK,
  ) {
    this.cursor = Math.max(0, floor)
  }

  /**
   * Find (and advance past) a 4-aligned run of 0xFF holding `size` bytes plus
   * slack. The caller must write its data before the next allocate() call —
   * the scan itself is the only reservation.
   */
  allocate(size: number): number {
    const len = this.bytes.length
    let i = this.cursor
    while (i < len) {
      if (this.bytes[i] !== FREE_BYTE) {
        i++
        continue
      }
      const aligned = (i + 3) & ~3
      const end = aligned + size + this.slack
      let j = i
      while (j < len && j < end && this.bytes[j] === FREE_BYTE) j++
      if (j >= end) {
        this.cursor = end // keep the slack free — don't hand it to the next allocation
        return aligned
      }
      i = j + 1
    }
    throw new Error(
      `No free space for ${size} bytes (+${this.slack} padding) above 0x${this.cursor.toString(16).toUpperCase()}`,
    )
  }
}
