/**
 * URGENT crash fix. The port copied FireRed's trainer BATTLE-sprite index verbatim
 * into H&S records (record byte +0x03). FireRed's sprite table ≠ H&S's, so many
 * ported trainers reference a sprite H&S never loads (e.g. Biker 0x5b) — the game
 * CRASHES when that battle starts.
 *
 * Remaps every ported trainer's battle sprite to a KNOWN-VALID H&S sprite (one the
 * game itself ships and uses), chosen to fit the class. Only OUR trainer records
 * are touched; H&S's own trainers are left alone.
 *
 *   npx tsx scripts/fix-ported-battlesprites.mts [--dry-run] ["<rom.gba>"]
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { RomBuffer } from '../src/rom/buffer'
import { readAllTrainers } from '../src/rom/tables/trainers'

const DEFAULT_ROM = 'C:/Users/Jordan/Downloads/Pokemon H&S/Pokemon Heart & Soul.gba'
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const romPath = args.filter((s) => !s.startsWith('--'))[0] ?? DEFAULT_ROM

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

// Class NAME → a KNOWN-VALID H&S battle sprite index (verified in H&S's own trainer
// table; see the sprite catalog). Chosen to fit the class; female classes get a
// female sprite. Every value is in H&S's 79-index known-good set → no crashes.
const CLASS_SPRITE: Record<string, number> = {
  'BIKER': 0x08,        // H&S biker
  'BLACK BELT': 0x05,   // H&S black belt
  'TWINS': 0x3e,        // H&S twins
  'YOUNG COUPLE': 0x46, // H&S young couple
  'SIS AND BRO': 0x49,  // → Old Couple sprite (a paired-siblings stand-in; valid)
  'ENGINEER': 0x0f,     // H&S engineer
  'BUG CATCHER': 0x43,  // H&S bug catcher
  'CAMPER': 0x16,       // H&S camper
  'PICNICKER': 0x36,    // → Battle Girl (female outdoorsy; valid)
  'ROCKET': 0x6e,       // H&S rocket
  'RUIN MANIAC': 0x33,  // → Dragon Tamer (rugged male; valid) — H&S has no Ruin Maniac sprite
  'BIRD KEEPER': 0x0a,  // → generic Youngster male (H&S battle set has no bird keeper)
  'YOUNGSTER': 0x0a,    // H&S youngster
  'LASS': 0x36,         // → Battle Girl (female; H&S battle set has no lass sprite)
  'SUPER NERD': 0x14,   // → Expert (bookish male; valid)
  'POKéMANIAC': 0x19,   // → Bug Maniac (enthusiast; valid)
  'GUITARIST': 0x0c,    // → Mystery Man (performer stand-in; valid)
  'FISHERMAN': 0x08,    // → Biker (rugged male stand-in; H&S battle set has no fisherman)
  'SWIMMER♂': 0x0a,     // → Youngster (male athlete stand-in)
  'SWIMMER♀': 0x36,     // → Battle Girl (female athlete)
  'BEAUTY': 0x37,       // → Parasol Lady (elegant female; valid)
}

const bytes = new Uint8Array(fs.readFileSync(romPath))
const hs = loadRom(bytes, romPath.split(/[\\/]/).pop()!, undefined)
if (hs.rom.gameCode() !== 'BPEE') throw new Error(`expected BPEE, got ${hs.rom.gameCode()}`)
const rom = new RomBuffer(bytes)
const a = hs.anchors
const all = readAllTrainers(rom, a)

let fixed = 0
const changes: string[] = []
for (const t of all) {
  if (!OUR_SLOTS.has(t.index)) continue
  const clsName = hs.trainerClassNames[t.cls] ?? `class#${t.cls}`
  const want = CLASS_SPRITE[clsName]
  if (want === undefined) { console.warn(`  ! no sprite mapping for class "${clsName}" (#${t.index} ${t.name})`); continue }
  const off = a.trainers + t.index * 40 + 0x03
  const cur = rom.u8(off)
  if (cur === want) continue
  changes.push(`  #${t.index} ${clsName} "${t.name}": sprite 0x${cur.toString(16)} → 0x${want.toString(16)}`)
  bytes[off] = want
  fixed++
}

for (const c of changes.slice(0, 40)) console.log(c)
if (changes.length > 40) console.log(`  … and ${changes.length - 40} more`)
console.log(`\n${fixed} battle-sprite bytes ${dryRun ? 'would be' : ''} fixed.`)

if (dryRun) { console.log('(dry run — nothing written)'); process.exit(0) }
if (!fixed) { console.log('nothing to fix.'); process.exit(0) }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
fs.copyFileSync(romPath, romPath.replace(/\.gba$/i, '') + `.pre-battlespritefix-${stamp}.gba`)
fs.writeFileSync(romPath, bytes)
console.log(`✅ written (backup .pre-battlespritefix-${stamp}.gba)`)
