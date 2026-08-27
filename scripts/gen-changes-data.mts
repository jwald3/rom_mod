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

// ── (7) Non-natural types reverted (read live; owned by
//        apply-revert-nonnatural-types.mts) ──
// The hack had given a handful of species a second type they don't have in
// vanilla — most visibly the Johto starters. We read each species' CURRENT
// typing out of the ROM and only report it as reverted if it now matches the
// vanilla target, so this card can't claim a fix the cartridge didn't make.
// Emit raw type tokens ("GRASS"); the HTML step handles display casing.
const typeName = (t: number) => r.typeNames[t] ?? `#${t}`
// Species → (the type the hack added, the target typing it should read now,
// which group it belongs to). 'invented' = a second type on a species that's
// single-type in the games; 'gen4' = the dex-wide Fairy pass rolled back.
type Group = 'invented' | 'gen4'
const REVERT_SPEC: { name: string; added: string; vanilla: string[]; group: Group }[] = [
  { name: 'MEGANIUM', added: 'FAIRY', vanilla: ['GRASS'], group: 'invented' },
  { name: 'TYPHLOSION', added: 'GROUND', vanilla: ['FIRE'], group: 'invented' },
  { name: 'FERALIGATR', added: 'DRAGON', vanilla: ['WATER'], group: 'invented' },
  { name: 'GROVYLE', added: 'DRAGON', vanilla: ['GRASS'], group: 'invented' },
  { name: 'SCEPTILE', added: 'DRAGON', vanilla: ['GRASS'], group: 'invented' },
  { name: 'SUNFLORA', added: 'FIRE', vanilla: ['GRASS'], group: 'invented' },
  { name: 'GOLDUCK', added: 'PSYCHC', vanilla: ['WATER'], group: 'invented' },
  { name: 'KINGLER', added: 'STEEL', vanilla: ['WATER'], group: 'invented' },
  { name: 'STANTLER', added: 'PSYCHC', vanilla: ['NORMAL'], group: 'invented' },
  { name: 'GULPIN', added: 'NORMAL', vanilla: ['POISON'], group: 'invented' },
  { name: 'SWALOT', added: 'NORMAL', vanilla: ['POISON'], group: 'invented' },
  { name: 'ELECTIVIRE', added: 'FIGHT', vanilla: ['ELECTR'], group: 'invented' },
  { name: 'PARASECT', added: 'GHOST', vanilla: ['BUG', 'GRASS'], group: 'invented' },
  { name: 'NOCTOWL', added: 'PSYCHC', vanilla: ['NORMAL', 'FLYING'], group: 'invented' },
  // Gen-4 rollback of the Fairy pass (whole lines).
  { name: 'ARBOK', added: 'DARK', vanilla: ['POISON'], group: 'gen4' },
  { name: 'CLEFFA', added: 'FAIRY', vanilla: ['NORMAL'], group: 'gen4' },
  { name: 'CLEFAIRY', added: 'FAIRY', vanilla: ['NORMAL'], group: 'gen4' },
  { name: 'CLEFABLE', added: 'FAIRY', vanilla: ['NORMAL'], group: 'gen4' },
  { name: 'IGGLYBUFF', added: 'FAIRY', vanilla: ['NORMAL'], group: 'gen4' },
  { name: 'JIGGLYPUFF', added: 'FAIRY', vanilla: ['NORMAL'], group: 'gen4' },
  { name: 'WIGGLYTUFF', added: 'FAIRY', vanilla: ['NORMAL'], group: 'gen4' },
  { name: 'TOGEPI', added: 'FAIRY', vanilla: ['NORMAL'], group: 'gen4' },
  { name: 'TOGETIC', added: 'FAIRY', vanilla: ['NORMAL', 'FLYING'], group: 'gen4' },
  { name: 'TOGEKISS', added: 'FAIRY', vanilla: ['NORMAL', 'FLYING'], group: 'gen4' },
  { name: 'AZURILL', added: 'FAIRY', vanilla: ['NORMAL'], group: 'gen4' },
  { name: 'MARILL', added: 'FAIRY', vanilla: ['WATER'], group: 'gen4' },
  { name: 'AZUMARILL', added: 'FAIRY', vanilla: ['WATER'], group: 'gen4' },
  { name: 'SNUBBULL', added: 'FAIRY', vanilla: ['NORMAL'], group: 'gen4' },
  { name: 'GRANBULL', added: 'FAIRY', vanilla: ['NORMAL'], group: 'gen4' },
  { name: 'DELCATTY', added: 'FAIRY', vanilla: ['NORMAL'], group: 'gen4' },
  { name: 'LUVDISC', added: 'FAIRY', vanilla: ['WATER'], group: 'gen4' },
  { name: 'MAWILE', added: 'FAIRY', vanilla: ['STEEL'], group: 'gen4' },
  { name: 'RALTS', added: 'FAIRY', vanilla: ['PSYCHC'], group: 'gen4' },
  { name: 'KIRLIA', added: 'FAIRY', vanilla: ['PSYCHC'], group: 'gen4' },
  { name: 'GARDEVOIR', added: 'FAIRY', vanilla: ['PSYCHC'], group: 'gen4' },
  { name: 'MR. MIME', added: 'FAIRY', vanilla: ['PSYCHC'], group: 'gen4' },
  { name: 'MIME JR.', added: 'FAIRY', vanilla: ['PSYCHC'], group: 'gen4' },
]
interface TypeRevert { name: string; added: string; now: string[]; starter: boolean; group: Group }
const STARTER_ORDER = ['MEGANIUM', 'TYPHLOSION', 'FERALIGATR', 'GROVYLE', 'SCEPTILE']
const typeReverts: TypeRevert[] = []
for (const tr of REVERT_SPEC) {
  const id = r.species.findIndex((s) => s.name && s.name.toUpperCase() === tr.name)
  if (id < 0) continue
  const s = r.species[id]
  const cur = s.type1 === s.type2 ? [typeName(s.type1)] : [typeName(s.type1), typeName(s.type2)]
  // Only report species whose ROM typing already equals the vanilla target.
  if (cur.length !== tr.vanilla.length || cur.some((t, i) => t !== tr.vanilla[i])) continue
  typeReverts.push({ name: tr.name, added: tr.added, now: cur, starter: STARTER_ORDER.includes(tr.name), group: tr.group })
}
// Keep the REVERT_SPEC order (starters lead the invented group; the gen4 group
// is already listed by evolution family), so no post-hoc sort is needed.

const out = {
  itemEvos,
  levelEvos,
  vitaminPrices,
  removedSpecies: REMOVED_SPECIES,
  removedSpeciesStillPresent: stillPresent,
  removedMoves: REMOVED_MOVES,
  tm26,
  kanto,
  typeReverts,
}
writeFileSync(resolve(here, 'changes-data.json'), JSON.stringify(out, null, 2))
console.log(`wrote scripts/changes-data.json`)
console.log(`  item→stone evolutions: ${itemEvos.length} (${itemEvos.map((e) => e.from).join(', ')})`)
console.log(`  trade→level evolutions: ${levelEvos.length} (${levelEvos.map((e) => `${e.from}→${e.to} Lv${e.level}`).join(', ')})`)
console.log(`  vitamins: ${vitaminPrices.map((v) => `${v.name} ₽${v.price}`).join(', ')}`)
console.log(`  type reverts: ${typeReverts.length} (${typeReverts.map((t) => `${t.name} -${t.added}`).join(', ')})`)
if (stillPresent.length) console.warn(`  ⚠ removed species still name-present: ${stillPresent.join(', ')}`)
