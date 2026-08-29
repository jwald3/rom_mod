/**
 * Read-only: dump the object events of one map, decoding each field, and for any
 * trainer object also decode the trainerbattle script it points at + the trainer
 * record + party it references. Nothing is written.
 *
 *   npx tsx scripts/inspect-map-objects.mts <bank> <map> ["<rom.gba>"]
 *   npx tsx scripts/inspect-map-objects.mts 24 59      # Rock Tunnel 1F (BRUNO)
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { RomBuffer } from '../src/rom/buffer'
import { readTrainer, readTrainerClassNames } from '../src/rom/tables/trainers'
import { resolveMapHeader, readEvents } from '../src/rom/tables/mapEvents'

const DEFAULT_ROM = 'C:/Users/Jordan/Downloads/Pokemon H&S/Pokemon Heart & Soul.gba'

const argv = process.argv.slice(2)
const bank = Number(argv[0] ?? 24)
const map = Number(argv[1] ?? 59)
const romPath = argv[2] ?? DEFAULT_ROM

const bytes = new Uint8Array(fs.readFileSync(romPath))
const { anchors, species, moves } = loadRom(bytes, romPath.split(/[\\/]/).pop()!, undefined)
const rom = new RomBuffer(bytes)
const classNames = readTrainerClassNames(rom, anchors)

const hex = (n: number | null) => (n === null ? 'null' : '0x' + (n >>> 0).toString(16))
const nameOf = (arr: { name: string }[], i: number) => arr[i]?.name ?? `#${i}`

const header = resolveMapHeader(rom, anchors, bank, map)
const events = readEvents(rom, header)

console.log(`Map ${bank}.${map}  header ${hex(header)}  events ${hex(events.eventsOffset)}`)
console.log(`  objects=${events.objectCount} warps=${events.warpCount} coord=${events.coordCount} bg=${events.bgCount}`)
console.log(`  object array @ ${hex(events.objectArrayOffset)}\n`)

/** Decode a 0xFF-terminated Gen-3 string via the ROM's charmap (through species text codec). */
function readDialogue(off: number | null): string {
  if (off === null) return '(null)'
  // rom.text stops at 0xFF; give it a generous width and collapse 0xFE→\n first.
  let s = ''
  for (let i = 0; i < 300; i++) {
    const b = rom.u8(off + i)
    if (b === 0xff) break
    if (b === 0xfe) { s += '\\n'; continue }
    s += rom.text(off + i, 1)
  }
  return s
}

for (const o of events.objects) {
  const tag = o.trainerType !== 0 ? `TRAINER(type ${o.trainerType}, sight ${o.sight})` : 'npc'
  console.log(`#${o.localId}  (${o.x},${o.y}) elev ${o.elevation}  gfx ${hex(o.gfxId)}  mv ${hex(o.movementType)}  flag ${o.flag}  ${tag}`)
  console.log(`     script ${hex(o.scriptOffset)}`)

  if (o.trainerType !== 0 && o.scriptOffset !== null && rom.u8(o.scriptOffset) === 0x5c) {
    const s = o.scriptOffset
    const trainerId = rom.u16(s + 2)
    const introPtr = rom.pointer(s + 6)
    const defeatPtr = rom.pointer(s + 10)
    const afterPtr = rom.pointer(s + 16)
    console.log(`     trainerbattle id=${trainerId}`)
    console.log(`       intro : "${readDialogue(introPtr)}"`)
    console.log(`       defeat: "${readDialogue(defeatPtr)}"`)
    console.log(`       after : "${readDialogue(afterPtr)}"`)

    const t = readTrainer(rom, anchors, trainerId)
    const cls = classNames[t.cls] ?? `class ${t.cls}`
    console.log(`     record #${trainerId}: ${cls} "${t.name}"  ai=${t.aiFlags}  ${t.party.length} mons` +
      `  (moves=${t.hasMoves} items=${t.hasItems})`)
    for (const m of t.party) {
      const mv = t.hasMoves ? '  [' + m.moves.filter(Boolean).map((id) => nameOf(moves, id)).join(', ') + ']' : ''
      console.log(`        L${m.level} ${nameOf(species, m.species)} (iv ${m.iv})${mv}`)
    }
  }
  console.log()
}
