/**
 * One-off: make evolution items renewable by putting them on wild Pokémon as
 * 5%-slot held items (farmable with Thief/Covet, GSC-style):
 *   KING'S ROCK  → Slowpoke, Poliwhirl        (GSC-canonical holders)
 *   METAL COAT   → Magnemite, Magneton        (DPP-canonical holders)
 *   DRAGON SCALE → Horsea, Seadra             (GSC-canonical; current holders aren't wild)
 *   DEEPSEATOOTH → first wild of Sharpedo/Carvanha/Gyarados
 *   DEEPSEASCALE → first wild of Shellder/Cloyster/Seel
 *   UP-GRADE     → Voltorb, Electrode         (Porygon2 holds it but isn't wild)
 * Only the 5% slot (item2) is written; the 50% slot is preserved. Aborts if a
 * target's 5% slot is already occupied. Backup first, verify after.
 * Run: npx tsx scripts/apply-held-items.mts
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { applyRomEdits, type HeldItemsEdit } from '../src/rom/writer'
import { WILD_KINDS } from '../src/rom/tables/wild'

const DIR = 'C:/Users/Waldo/Downloads/Pokemon - Fire Red Version [a1] (U) (Squirrels) (2)'
const ROM_PATH = `${DIR}/20260426__GPT_Mods.gba`
const TOML_PATH = `${DIR}/20260426__GPT_Mods.toml`

const bytes = new Uint8Array(fs.readFileSync(ROM_PATH))
const toml = fs.readFileSync(TOML_PATH, 'utf8')
const loaded = loadRom(bytes, 'GPT_Mods.gba', toml)
if (loaded.warnings.length > 0) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)

const speciesId = (name: string): number => {
  const s = loaded.species.find((x) => x.name === name)
  if (!s) throw new Error(`Species ${name} not found`)
  return s.id
}
// Gen 3 text decodes apostrophes as ’ (U+2019) — normalize both sides.
const ascii = (s: string) => s.replace(/’/g, "'")
const itemId = (name: string): number => {
  const i = loaded.itemNames.findIndex((n) => ascii(n) === name)
  if (i < 0) throw new Error(`Item ${name} not found`)
  return i
}

const wild = new Set<number>()
for (const area of loaded.wildAreas) {
  for (const kind of WILD_KINDS) {
    for (const slot of area.groups[kind]?.slots ?? []) wild.add(slot.species)
  }
}
/** First candidate that is wild AND has an empty 5% held slot. */
const firstAvailable = (...names: string[]): string => {
  const hit = names.find((n) => {
    const sp = loaded.species[speciesId(n)]
    return wild.has(sp.id) && sp.heldItem2 === 0
  })
  if (!hit) throw new Error(`No wild holder with a free 5% slot among ${names.join('/')}`)
  return hit
}

const PLAN: Array<[holder: string, item: string]> = [
  ['SLOWPOKE', "KING'S ROCK"],
  ['POLIWHIRL', "KING'S ROCK"],
  ['MAGNEMITE', 'METAL COAT'],
  ['SCYTHER', 'METAL COAT'], // Magneton holds MAGNET, Onix holds HARD STONE in this mod
  ['HORSEA', 'DRAGON SCALE'],
  ['SEADRA', 'DRAGON SCALE'],
  [firstAvailable('SHARPEDO', 'CARVANHA', 'GYARADOS'), 'DEEPSEATOOTH'],
  // Shellder/Cloyster carry Pearls in this mod — fall through to other sea life.
  [firstAvailable('SHELLDER', 'CLOYSTER', 'SEEL', 'DEWGONG', 'KRABBY', 'TENTACRUEL'), 'DEEPSEASCALE'],
  ['VOLTORB', 'UP-GRADE'],
  ['ELECTRODE', 'UP-GRADE'],
]

const heldItems = new Map<number, HeldItemsEdit>()
for (const [holderName, itemName] of PLAN) {
  const sp = loaded.species[speciesId(holderName)]
  if (!wild.has(sp.id)) throw new Error(`${holderName} is not wild — pick another holder`)
  if (sp.heldItem2 !== 0) {
    throw new Error(
      `${holderName} already holds ${loaded.itemNames[sp.heldItem2]} in its 5% slot — aborting`,
    )
  }
  heldItems.set(sp.id, { item1: sp.heldItem1, item2: itemId(itemName) })
}

const { bytes: out, ops } = applyRomEdits(loaded.rom, loaded.anchors, { heldItems })

// Independent post-check on a fresh parse.
const check = loadRom(out, 'check.gba', toml)
for (const [holderName, itemName] of PLAN) {
  const sp = check.species[speciesId(holderName)]
  if (ascii(check.itemNames[sp.heldItem2]) !== itemName) {
    throw new Error(`Post-check failed: ${holderName} holds ${check.itemNames[sp.heldItem2]}`)
  }
}
if (check.warnings.length > 0) throw new Error('Output ROM has warnings — aborting')

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = `${DIR}/20260426__GPT_Mods.pre-helditems-${stamp}.gba`
fs.copyFileSync(ROM_PATH, backupPath)
fs.writeFileSync(ROM_PATH, out)

console.log(`✅ ${ops.length} held-item assignments written (${diff} bytes changed)`)
for (const [holder, item] of PLAN) console.log(`   ${holder} now holds ${item} (5%)`)
console.log(`   backup: ${backupPath}`)
