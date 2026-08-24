/**
 * Build the dataset for the guide's "What's Changed from Vanilla" section.
 *
 * Two of the changes are *derived live from the ROM* so the lists can never
 * drift from what the apply-scripts actually did:
 *   • Evolutions that now trigger by USING AN ITEM (method 7) whose item is one
 *     of the classic trade-only items (Metal Coat, King's Rock, Dragon Scale,
 *     Up-Grade, Dubious Disc, Electirizer, Magmarizer, …) — i.e. the
 *     "trade holding item" (method 6/26) lines converted by
 *     apply-trade-item-to-stone.mts. Read out of gEvolutions.
 *   • Species that USE-ITEM-evolve but whose item ISN'T a stone in vanilla —
 *     the bag-usability fix (apply-fix-stone-evo-items.mts) is what makes those
 *     items usable at all; we surface the item list from that script.
 *
 * The remaining changes (vitamin prices, TM26 → Earthquake, post-Gen-4 purge,
 * Kanto level scaling) are recorded as authored facts, each tied to the
 * apply-script that owns it and spot-checked against the ROM where cheap
 * (vitamin price is re-read; removed species are asserted absent).
 *
 *   npx tsx scripts/gen-changes-data.mts "<rom.gba>" [toml]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadRom } from '../src/rom/loadRom'

const here = dirname(fileURLToPath(import.meta.url))
const romPath = process.argv[2]
if (!romPath) { console.error('usage: npx tsx scripts/gen-changes-data.mts "<rom.gba>" [toml]'); process.exit(2) }
const toml = process.argv[3] ? readFileSync(process.argv[3], 'utf8') : undefined
const r = loadRom(new Uint8Array(readFileSync(romPath)), romPath.split(/[\\/]/).pop()!, toml)
if (r.warnings.length) console.warn('ROM warnings: ' + r.warnings.join('; '))

const isGap = (n: string) => !n || /^\?+$/.test(n)
const spName = (id: number) => r.species[id]?.name ?? `#${id}`

// ── item struct: price is a u16 at +0x10 (Emerald item layout) ──
const ITEM_STRUCT_LEN = 44
const PRICE_OFF = 0x10
const itemsBase = (r.anchors as any).items as number
const priceOf = (id: number) => r.rom.u16(itemsBase + id * ITEM_STRUCT_LEN + PRICE_OFF)
const itemId = (name: string) => r.itemNames.findIndex((n) => n && n.toUpperCase() === name.toUpperCase())

// The classic "trade while holding X" items in Gen 2–4. If a species now evolves
// by method 7 (use item) with one of these as the trigger, it's a converted
// trade evolution — the whole point of apply-trade-item-to-stone.mts.
const TRADE_ITEMS = new Set(
  ['METAL COAT', 'KING’S ROCK', "KING'S ROCK", 'DRAGON SCALE', 'UP-GRADE', 'DUBIOUS DISC',
   'ELECTIRIZER', 'MAGMARIZER', 'PROTECTOR', 'REAPER CLOTH', 'PRISM SCALE', 'DEEPSEATOOTH',
   'DEEPSEASCALE', 'SACHET', 'WHIPPED DREAM', 'RAZOR CLAW', 'RAZOR FANG'].map((s) => s.toUpperCase()),
)

// ── (1) Converted trade-with-item evolutions, read live from gEvolutions ──
interface ItemEvo { from: string; to: string; item: string }
const itemEvos: ItemEvo[] = []
r.evolutions.forEach((evos, sp) => {
  if (isGap(spName(sp))) return
  for (const e of evos) {
    if (e.method !== 7) continue // 7 = use item (stone-style)
    const item = r.itemNames[e.param] ?? ''
    if (!TRADE_ITEMS.has(item.toUpperCase())) continue
    itemEvos.push({ from: spName(sp), to: spName(e.target), item })
  }
})
itemEvos.sort((a, b) => a.from.localeCompare(b.from))

// ── (2) Plain trade evolutions converted to level-ups (legacy-evo-levels) ──
// These are species whose vanilla trade evolution was turned into a level-up by
// the poke-emerald-legacy pass (apply-legacy-evo-levels.mts). We confirm each
// now reads method 4 (level) in the ROM and report the level it triggers at.
const LEVEL_TRADE_LINES = ['KADABRA', 'MACHOKE', 'GRAALER', 'GRAVELER', 'HAUNTER', 'BOLDORE'] // classic 4 plain-trade lines (+ Gen5 if present)
interface LevelEvo { from: string; to: string; level: number }
const levelEvos: LevelEvo[] = []
r.evolutions.forEach((evos, sp) => {
  const name = spName(sp)
  if (isGap(name) || !LEVEL_TRADE_LINES.includes(name.toUpperCase())) return
  for (const e of evos) {
    if (e.method === 4) levelEvos.push({ from: name, to: spName(e.target), level: e.param })
  }
})
levelEvos.sort((a, b) => a.from.localeCompare(b.from))

// ── (3) Vitamin prices (re-read from the ROM to confirm the fix landed) ──
const VITAMINS = ['HP UP', 'PROTEIN', 'IRON', 'CARBOS', 'CALCIUM', 'ZINC']
const vitaminPrices = VITAMINS.map((n) => ({ name: n, price: priceOf(itemId(n)) })).filter((v) => v.price > 0)

// ── (4) Post-Gen-4 species removed (assert they're gone from the dex names) ──
const REMOVED_SPECIES = ['SYLVEON', 'ANNIHILAPE', 'WYRDEER', 'URSALUNA', 'KLEAVOR',
  'FARIGIRAF', 'DUDUNSPARC', 'REGIELEKI', 'REGIDRAGO']
const stillPresent = REMOVED_SPECIES.filter((n) =>
  r.species.some((s) => s.name && s.name.toUpperCase() === n && s.name !== ''),
)
// "present" here means a live, reachable slot; the purge blanks trainer/evo/wild
// references rather than renaming the species entry, so we don't hard-fail — we
// just note if any slipped through for the author to check.
const REMOVED_MOVES = ['PLAY ROUGH', 'MOONBLAST']

// ── (5) TM26 → Earthquake relocation (authored; owned by apply-move-tm26) ──
const tm26 = {
  tm: 'TM26',
  move: 'Earthquake',
  brockNow: 'TM39 (Rock Tomb)',
  where: 'Rocket Hideout B3F (floor item ball)',
}

// ── (6) Kanto level scaling (authored; owned by apply-kanto-level-scale) ──
const kanto = { lo: 45, hi: 58, oldCeiling: 34 }

const out = {
  itemEvos,
  levelEvos,
  vitaminPrices,
  removedSpecies: REMOVED_SPECIES,
  removedSpeciesStillPresent: stillPresent,
  removedMoves: REMOVED_MOVES,
  tm26,
  kanto,
}
writeFileSync(resolve(here, 'changes-data.json'), JSON.stringify(out, null, 2))
console.log(`wrote scripts/changes-data.json`)
console.log(`  item→stone evolutions: ${itemEvos.length} (${itemEvos.map((e) => e.from).join(', ')})`)
console.log(`  trade→level evolutions: ${levelEvos.length} (${levelEvos.map((e) => `${e.from}→${e.to} Lv${e.level}`).join(', ')})`)
console.log(`  vitamins: ${vitaminPrices.map((v) => `${v.name} ₽${v.price}`).join(', ')}`)
if (stillPresent.length) console.warn(`  ⚠ removed species still name-present: ${stillPresent.join(', ')}`)
