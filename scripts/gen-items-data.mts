/**
 * Extract a per-item availability dataset from the ROM for the guide's Items
 * section. For every *obtainable* item (sold in a shop, held by a wild Pokémon,
 * or a TM/HM) we record: display name, category, buy price, the move a TM/HM
 * teaches, which shops sell it (category-labelled — the ROM has no town names),
 * and which wild species carry it. Writes scripts/items-data.json.
 *
 *   npx tsx scripts/gen-items-data.mts "<rom.gba>" [toml]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadRom } from '../src/rom/loadRom'
import { describeShop } from '../src/rom/tables/shops'
import { readMoveIdTable, tmSlotLabel } from '../src/rom/tables/compat'

const here = dirname(fileURLToPath(import.meta.url))
const romPath = process.argv[2]
if (!romPath) { console.error('usage: npx tsx scripts/gen-items-data.mts "<rom.gba>" [toml]'); process.exit(2) }
const toml = process.argv[3] ? readFileSync(process.argv[3], 'utf8') : undefined
const r = loadRom(new Uint8Array(readFileSync(romPath)), romPath.split(/[\\/]/).pop()!, toml)

const isGap = (n: string) => !n || /^\?+$/.test(n)

// ── item struct: price is a u16 at +0x10 (Emerald item layout) ──
const ITEM_STRUCT_LEN = 44
const PRICE_OFF = 0x10
const itemsBase = (r.anchors as any).items as number
const price = (id: number) => r.rom.u16(itemsBase + id * ITEM_STRUCT_LEN + PRICE_OFF)

// ── TM/HM slot → move name ──
const tmMoveIds = readMoveIdTable(r.rom, (r.anchors as any).tms, (r.anchors as any).tmCount)
// map item id → { slot label, move name }  (item name is "TMxx"/"HMxx")
const tmByName = new Map<string, { slot: string; move: string }>()
tmMoveIds.forEach((mv, i) => {
  const slot = tmSlotLabel(i) // TM01.. then HM01..
  tmByName.set(slot, { slot, move: r.moves[mv]?.name ?? `#${mv}` })
})

// ── category from item name ──
function categorize(name: string): string {
  const n = name.toUpperCase()
  if (/^(TM|HM)\d/.test(n)) return 'TMs & HMs'
  if (/BALL$/.test(n) && !/SHADOW|IRON|LIGHT|SMOKE/.test(n)) return 'Poké Balls'
  if (/(POTION|REVIVE|HEAL|ANTIDOTE|AWAKENING|ELIXIR|ETHER|FULL RESTORE|BURN|ICE HEAL|PARLYZ|REVIVAL|FRESH WATER|SODA POP|LEMONADE|MILK|BERRY JUICE|ENERGY|SACRED ASH)/.test(n)) return 'Medicine'
  if (/(PROTEIN|IRON|CARBOS|CALCIUM|ZINC|HP UP|PP UP|PP MAX|RARE CANDY)/.test(n)) return 'Vitamins & boosters'
  if (/STONE|SHARD|MULCH/.test(n)) return 'Evolution & stones'
  if (/^X /.test(n) || /(GUARD SPEC|DIRE HIT)/.test(n)) return 'Battle items'
  if (/(REPEL)/.test(n)) return 'Field items'
  if (/MAIL$/.test(n)) return 'Mail'
  if (/(NUGGET|PEARL|STARDUST|MUSHROOM|GOLD LEAF|SILVER LEAF|HEART SCALE|RELIC)/.test(n)) return 'Valuables'
  if (/(INCENSE|BAND|SCARF|CHARM|LENS|SCOPE|SPECS|BELT|ORB|ROCK|MAGNET|MIRACLE|CHARCOAL|MYSTIC|TWISTEDSPOON|BLACKGLASSES|SILK|SOFT SAND|SHARP BEAK|POISON BARB|NEVERMELTICE|SPELL TAG|METAL COAT|LEFTOVERS|QUICK CLAW|KING|BRIGHTPOWDER|FOCUS|CHOICE|SHELL BELL|LUCKY|AMULET|EXP|MACHO|SMOKE|CLEANSE|SOOTHE|DRAGON SCALE|UP-GRADE|LIGHT BALL|LAX|SEA|BERRY)/.test(n)) return 'Held items & berries'
  return 'Other items'
}

// ── invert shops: item id → set of shop descriptor labels ──
const shopSell = new Map<number, Set<string>>()
for (const s of r.shops) {
  const label = describeShop(s, r.itemNames)
  for (const id of s.items) {
    if (!shopSell.has(id)) shopSell.set(id, new Set())
    shopSell.get(id)!.add(label)
  }
}

// ── wild-held: item id → set of species names ──
const heldBy = new Map<number, Set<string>>()
for (const sp of r.species) {
  if (isGap(sp.name)) continue
  for (const h of [sp.heldItem1, sp.heldItem2]) {
    if (!h) continue
    if (!heldBy.has(h)) heldBy.set(h, new Set())
    heldBy.get(h)!.add(sp.name)
  }
}

// ── build obtainable-item set ──
const itemCount = (r.anchors as any).itemCount as number
const out: any[] = []
for (let id = 1; id < itemCount; id++) {
  const name = r.itemNames[id]
  if (isGap(name)) continue
  const tm = tmByName.get(name.toUpperCase())
  const shops = shopSell.has(id) ? [...shopSell.get(id)!].sort() : []
  const held = heldBy.has(id) ? [...heldBy.get(id)!].sort() : []
  const isTm = /^(TM|HM)\d/i.test(name)
  // obtainable = sold, held, or a TM/HM (TMs are always earnable in-game)
  if (!shops.length && !held.length && !isTm) continue
  out.push({
    id,
    name,
    category: categorize(name),
    price: price(id),
    tmMove: tm ? tm.move : null,
    shops,
    heldBy: held,
  })
}

writeFileSync(resolve(here, 'items-data.json'), JSON.stringify(out))
const byCat = new Map<string, number>()
for (const it of out) byCat.set(it.category, (byCat.get(it.category) ?? 0) + 1)
console.log(`wrote ${out.length} obtainable items → scripts/items-data.json`)
console.log(`  sold in a shop: ${out.filter((i) => i.shops.length).length} | wild-held: ${out.filter((i) => i.heldBy.length).length} | TM/HM: ${out.filter((i) => i.tmMove).length}`)
console.log('  by category: ' + [...byCat].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', '))
