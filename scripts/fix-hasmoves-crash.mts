/**
 * Diagnostic/repair: our ported Bikers/Ruin-Maniacs/Super-Nerds carry custom
 * movesets copied from FireRed (structType bit0 = hasMoves). Two of them (Isaac,
 * Alex) crash the battle on a fresh ROM load even though every static check on the
 * record passes — the one property separating crashers from working trainers is
 * hasMoves=true. This flips those trainers to hasMoves=false so H&S assigns each
 * mon its natural level-up moves (no custom moves), keeping species + level.
 *
 * In place: clears structType bit0, re-serializes the party at the 8-byte (no-moves)
 * stride into the SAME party block (smaller → fits), and leaves the record's party
 * pointer/count unchanged. All 18 affected trainers are hasItems=false, so the
 * new entry is exactly {iv u16, level u16, species u16, pad u16} = 8 bytes.
 *
 *   npx tsx scripts/fix-hasmoves-crash.mts [--dry-run] ["<rom.gba>"]
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { RomBuffer } from '../src/rom/buffer'
import { readTrainer } from '../src/rom/tables/trainers'

const DEFAULT_ROM = 'C:/Users/Jordan/Downloads/Pokemon H&S/Pokemon Heart & Soul.gba'
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const romPath = args.filter((s) => !s.startsWith('--'))[0] ?? DEFAULT_ROM

// Our ported records that currently have hasMoves=true (all hasItems=false).
const TARGETS = [11, 39, 40, 43, 68, 69, 183, 218, 295, 296, 300, 310, 313, 324, 325, 416, 419, 422]

const bytes = new Uint8Array(fs.readFileSync(romPath))
const hs = loadRom(bytes, romPath.split(/[\\/]/).pop()!, undefined)
if (hs.rom.gameCode() !== 'BPEE') throw new Error(`expected BPEE, got ${hs.rom.gameCode()}`)
const rom = new RomBuffer(bytes)
const a = hs.anchors
const dv = new DataView(bytes.buffer)

let fixed = 0
for (const id of TARGETS) {
  const recOff = a.trainers + id * 40
  const struct = bytes[recOff]
  if ((struct & 1) === 0) { console.log(`  #${id} already hasMoves=false — skipped`); continue }
  const t = readTrainer(rom, a, id)
  if (t.hasItems) { console.warn(`  ! #${id} has items — needs manual handling, skipped`); continue }

  // read current party (16-byte stride), re-lay at 8-byte stride
  const partyOff = rom.u32(recOff + 0x24) - 0x08000000
  const count = rom.u32(recOff + 0x20)
  const mons = t.party // already decoded {iv, level, species}
  // clear moves bit
  bytes[recOff] = struct & ~1
  // rewrite party in place at 8-byte stride
  for (let i = 0; i < count; i++) {
    const e = partyOff + i * 8
    dv.setUint16(e, mons[i].iv, true)
    dv.setUint16(e + 2, mons[i].level, true)
    dv.setUint16(e + 4, mons[i].species, true)
    dv.setUint16(e + 6, 0, true) // pad
  }
  // zero the now-unused tail of the old (larger) block so no stale move bytes linger
  const oldEnd = partyOff + count * 16
  const newEnd = partyOff + count * 8
  for (let o = newEnd; o < oldEnd; o++) bytes[o] = 0

  console.log(`  #${id} ${hs.trainerClassNames[t.cls]} "${t.name}": hasMoves → false (${count} mons, engine-default moves)`)
  fixed++
}

console.log(`\n${fixed} trainers ${dryRun ? 'would be' : ''} converted to engine-default moves.`)
if (dryRun) { console.log('(dry run — nothing written)'); process.exit(0) }
if (!fixed) { console.log('nothing to do.'); process.exit(0) }

// re-parse sanity
const check = loadRom(bytes, 'check.gba', undefined)
if (check.warnings.length) throw new Error(`post-write warnings: ${check.warnings.join('; ')}`)
for (const id of TARGETS) {
  const t = readTrainer(new RomBuffer(bytes), a, id)
  if (t.hasMoves) throw new Error(`#${id} still hasMoves after conversion`)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
fs.copyFileSync(romPath, romPath.replace(/\.gba$/i, '') + `.pre-hasmovesfix-${stamp}.gba`)
fs.writeFileSync(romPath, bytes)
console.log(`✅ written (backup .pre-hasmovesfix-${stamp}.gba)`)
