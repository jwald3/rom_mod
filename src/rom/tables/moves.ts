import type { RomBuffer } from '../buffer'
import { type AnchorMap, MOVE_NAME_LEN, MOVE_STATS_LEN } from '../anchors'

export interface MoveInfo {
  id: number
  name: string
  effect: number
  power: number
  type: number
  accuracy: number
  pp: number
  priority: number
}

// Move battle stats struct (12 bytes):
// effect, power, type, accuracy, pp, effectAccuracy, target, priority, flags, unused×3
export function readMoves(rom: RomBuffer, a: AnchorMap): MoveInfo[] {
  const out: MoveInfo[] = []
  for (let i = 0; i < a.moveCount; i++) {
    const s = a.moveStats + i * MOVE_STATS_LEN
    out.push({
      id: i,
      name: rom.text(a.moveNames + i * MOVE_NAME_LEN, MOVE_NAME_LEN),
      effect: rom.u8(s),
      power: rom.u8(s + 1),
      type: rom.u8(s + 2),
      accuracy: rom.u8(s + 3),
      pp: rom.u8(s + 4),
      priority: rom.i8(s + 7),
    })
  }
  return out
}
