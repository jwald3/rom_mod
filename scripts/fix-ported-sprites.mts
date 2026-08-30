/**
 * Fix overworld sprite/class mismatches on the ported trainers. The map-object
 * port carried FireRed's gfxId verbatim (FR and H&S sprite tables differ) and the
 * hand-built rosters guessed sprites, so several classes got the wrong sprite
 * (e.g. Bug Catcher, Super Nerd, Camper, Twins, Sis and Bro, Black Belt).
 *
 * Derives the canonical sprite for each trainer CLASS from H&S's OWN trainers
 * (dominant gfx that class uses game-wide = ground truth), then rewrites the 1-byte
 * gfxId (object offset +1) of every OUR-ported trainer object to match. Only
 * objects whose trainer record is one WE claimed are touched — H&S's own trainers
 * (including its leftover Emerald "Aqua Admin" flavor trainers) are left alone.
 *
 *   npx tsx scripts/fix-ported-sprites.mts [--dry-run] ["<rom.gba>"]
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { RomBuffer } from '../src/rom/buffer'
import { readEvents } from '../src/rom/tables/mapEvents'
import { readTrainer } from '../src/rom/tables/trainers'

const DEFAULT_ROM = 'C:/Users/Jordan/Downloads/Pokemon H&S/Pokemon Heart & Soul.gba'
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const romPath = args.filter((s) => !s.startsWith('--'))[0] ?? DEFAULT_ROM

// Every trainer-record slot the port scripts claimed (see FLOORS in
// apply-rocktunnel-trainers.mts). Only objects pointing at these are ours.
const OUR_SLOTS = new Set([
  11, 30, 31, 35, 39, 40, 41, 42, 43, 57, 60, 61, 62, 63, 64, 67, 68, 69, 70, 78, 82, 84, 85, 86,
  87, 93, 105, 106, 107, 108, 109, 110, 111, 112, 113, 119, 124, 125, 133, 134, 135, 136, 137, 138,
  139, 140, 141, 142, 143, 144, 147, 148, 149, 150, 151, 155, 157, 161, 168, 175, 176, 177, 178, 179,
  182, 183, 184, 185, 186, 187, 188, 201, 205, 218, 225, 230, 246, 247, 254, 255, 257, 258, 259, 260,
  262, 263, 264, 265, 267, 269, 270, 271, 272, 280, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292,
  293, 295, 296, 297, 298, 300, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 324, 325, 334,
  335, 338, 342, 353, 354, 355, 356, 357, 359, 369, 370, 371, 372, 373, 377, 385, 386, 388, 389, 390,
  391, 392, 393, 394, 395, 396, 403, 406, 409, 410, 411, 412, 415, 416, 418, 419, 421, 422, 423, 424,
  425, 434, 437,
])

const bytes = new Uint8Array(fs.readFileSync(romPath))
const hs = loadRom(bytes, romPath.split(/[\\/]/).pop()!, undefined)
if (hs.rom.gameCode() !== 'BPEE') throw new Error(`expected BPEE, got ${hs.rom.gameCode()}`)
const rom = new RomBuffer(bytes)
const a = hs.anchors

// ---- derive canonical class → gfx from H&S's own trainers (ground truth) ----
// Exclude OUR objects from the tally so our (currently-wrong) sprites don't skew it.
const tally = new Map<number, Map<number, number>>()
type Obj = { hp: number; objOff: number; gfx: number; cls: number; slot: number; name: string }
const allObjs: Obj[] = []
for (let bank = 0; bank < 40; bank++) {
  const bp = rom.pointer(a.mapBanks + bank * 4)
  if (bp === null) continue
  for (let map = 0; map < 80; map++) {
    const hp = rom.pointer(bp + map * 4)
    if (hp === null) break
    let ev
    try { ev = readEvents(rom, hp) } catch { continue }
    for (const o of ev.objects) {
      if (o.trainerType === 0 || o.scriptOffset === null || rom.u8(o.scriptOffset) !== 0x5c) continue
      const slot = rom.u16(o.scriptOffset + 2)
      let t
      try { t = readTrainer(rom, a, slot) } catch { continue }
      allObjs.push({ hp, objOff: o.offset, gfx: o.gfxId, cls: t.cls, slot, name: t.name })
      if (!OUR_SLOTS.has(slot)) { // ground truth = H&S's own trainers only
        if (!tally.has(t.cls)) tally.set(t.cls, new Map())
        const m = tally.get(t.cls)!
        m.set(o.gfxId, (m.get(o.gfxId) ?? 0) + 1)
      }
    }
  }
}
// Only fix classes where H&S has a CLEAR dominant sprite (≥50% share, ≥3 uses,
// ≥2 margin). Scattered classes (Youngster/Biker/Camper/Young Couple/Engineer —
// H&S itself uses many sprites for them) and classes H&S doesn't have at all
// (Bird Keeper/Lass/Swimmer/… — our trainers are the only ones, so nothing to
// match) are left untouched to avoid making them look worse.
const canonical = new Map<number, number>()
for (const [cls, m] of tally) {
  const s = [...m.entries()].sort((x, y) => y[1] - x[1])
  const total = s.reduce((z, [, c]) => z + c, 0)
  const share = s[0][1] / total
  const margin = s[0][1] - (s[1]?.[1] ?? 0)
  if (share >= 0.5 && s[0][1] >= 3 && margin >= 2) canonical.set(cls, s[0][0])
}

// ---- rewrite gfx byte for our objects whose sprite disagrees ----
let fixed = 0
const changes: string[] = []
for (const o of allObjs) {
  if (!OUR_SLOTS.has(o.slot)) continue
  const want = canonical.get(o.cls)
  if (want === undefined || want === o.gfx) continue
  const clsName = hs.trainerClassNames[o.cls] ?? `class#${o.cls}`
  changes.push(`  #${o.slot} ${clsName} "${o.name}": gfx 0x${o.gfx.toString(16)} → 0x${want.toString(16)}`)
  bytes[o.objOff + 1] = want // gfxId is object byte +1
  fixed++
}

for (const c of changes.slice(0, 60)) console.log(c)
if (changes.length > 60) console.log(`  … and ${changes.length - 60} more`)
console.log(`\n${fixed} sprite bytes ${dryRun ? 'would be' : ''} fixed across ${new Set(allObjs.filter((o) => OUR_SLOTS.has(o.slot)).map((o) => o.hp)).size} maps.`)

if (dryRun) { console.log('(dry run — nothing written)'); process.exit(0) }
if (!fixed) { console.log('nothing to fix.'); process.exit(0) }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
fs.copyFileSync(romPath, romPath.replace(/\.gba$/i, '') + `.pre-spritefix-${stamp}.gba`)
fs.writeFileSync(romPath, bytes)
console.log(`✅ written (backup .pre-spritefix-${stamp}.gba)`)
