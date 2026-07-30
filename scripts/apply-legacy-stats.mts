/**
 * Apply the poke-emerald-legacy base-stat and ability changes
 * (https://mryakobo.github.io/poke-emerald-legacy-docs/) to the ROM.
 *
 *   npx tsx scripts/apply-legacy-stats.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-legacy-stats.mts --dry-run "<rom.gba>" [toml]
 *
 * Stats come from scripts/legacy-stats.json (absolute new HP/Atk/Def/Spe/SpA/SpD,
 * extracted verbatim from the doc's table). Base-stats records are fixed-size, so
 * every write is in place at these struct offsets:
 *   0 HP  1 Atk  2 Def  3 Spe  4 SpA  5 SpD   (u8 each; note Spe precedes SpA/SpD)
 *   22 ability1  23 ability2  (u8 ability ids)
 * The 7 ability changes are applied from ABILITY_CHANGES below. Species are keyed
 * by name (case-insensitive) → the ROM's species id; a name not in the ROM is
 * reported and skipped, never guessed. Backs up, writes, and re-reads to verify
 * every value. BPEE needs no toml.
 */
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadRom } from '../src/rom/loadRom'

const here = dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) {
  console.error('usage: npx tsx scripts/apply-legacy-stats.mts [--dry-run] "<rom.gba>" [toml]')
  process.exit(2)
}

interface StatRow { name: string; hp: number; atk: number; def: number; spe: number; spa: number; spd: number }
const stats: StatRow[] = JSON.parse(fs.readFileSync(resolve(here, 'legacy-stats.json'), 'utf8'))

// Ability changes from the doc's "Ability Changes" table. slot1/slot2 by NAME
// (matched to the ROM's ability table). null = leave that slot unchanged;
// '' (empty) = clear the slot (ability id 0).
const ABILITY_CHANGES: { name: string; ability1?: string | null; ability2?: string | null }[] = [
  { name: 'Meowth', ability2: 'Hustle' },     // Pickup / Hustle(new)
  { name: 'Persian', ability2: 'Hustle' },    // Limber / Hustle(new)
  { name: 'Wailord', ability1: 'Water Veil', ability2: 'Rain Dish' }, // was Oblivious
  { name: 'Camerupt', ability1: 'Flame Body' }, // was Magma Armor
  { name: 'Glalie', ability1: 'Levitate', ability2: 'Intimidate' }, // was Inner Focus / new Intimidate
  { name: 'Tropius', ability1: 'Thick Fat', ability2: 'Chlorophyll' }, // Thick Fat new, Chlorophyll moved to slot2
  { name: 'Seviper', ability2: 'Hustle' },    // Shed Skin / Hustle(new)
]

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length > 0) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)
const a = loaded.anchors

const idByName = new Map<string, number>()
loaded.species.forEach((s, i) => { if (s.name) idByName.set(s.name.toUpperCase(), i) })
const abilityByName = new Map<string, number>()
loaded.abilityNames.forEach((n, i) => { if (n) abilityByName.set(n.toUpperCase().replace(/\s+/g, ''), i) })
const abilId = (name: string): number => {
  const id = abilityByName.get(name.toUpperCase().replace(/\s+/g, ''))
  if (id === undefined) throw new Error(`Ability not in ROM: ${name}`)
  return id
}

// Working copy for writes.
const out = new Uint8Array(bytes)
const STAT_OFF = [0, 1, 2, 3, 4, 5] as const // hp,atk,def,spe,spa,spd
const A1 = 22, A2 = 23

const statChanges: string[] = []
const missing: string[] = []
let statWrites = 0

for (const row of stats) {
  const id = idByName.get(row.name.toUpperCase())
  if (id === undefined) { missing.push(row.name); continue }
  const base = a.baseStats + id * a.baseStatsLen
  const cur = loaded.species[id].stats
  const next = { hp: row.hp, atk: row.atk, def: row.def, spe: row.spe, spa: row.spa, spd: row.spd }
  const vals = [next.hp, next.atk, next.def, next.spe, next.spa, next.spd]
  for (const v of vals) if (v < 1 || v > 255) throw new Error(`${row.name}: stat ${v} out of range`)
  const changed = cur.hp !== next.hp || cur.atk !== next.atk || cur.def !== next.def ||
    cur.spe !== next.spe || cur.spa !== next.spa || cur.spd !== next.spd
  if (!changed) continue
  STAT_OFF.forEach((o, k) => { out[base + o] = vals[k] })
  statWrites++
  statChanges.push(
    `${row.name.padEnd(12)} ` +
    `HP ${cur.hp}→${next.hp}  Atk ${cur.atk}→${next.atk}  Def ${cur.def}→${next.def}  ` +
    `Spe ${cur.spe}→${next.spe}  SpA ${cur.spa}→${next.spa}  SpD ${cur.spd}→${next.spd}`,
  )
}

const abilityChangeLog: string[] = []
let abilityWrites = 0
for (const ch of ABILITY_CHANGES) {
  const id = idByName.get(ch.name.toUpperCase())
  if (id === undefined) { missing.push(ch.name + ' (ability)'); continue }
  const base = a.baseStats + id * a.baseStatsLen
  const parts: string[] = []
  if (ch.ability1 !== undefined) {
    const v = ch.ability1 === '' ? 0 : abilId(ch.ability1!)
    if (out[base + A1] !== v) { parts.push(`slot1 ${loaded.abilityNames[out[base + A1]] || '—'}→${ch.ability1 || '—'}`); out[base + A1] = v }
  }
  if (ch.ability2 !== undefined) {
    const v = ch.ability2 === '' ? 0 : abilId(ch.ability2!)
    if (out[base + A2] !== v) { parts.push(`slot2 ${loaded.abilityNames[out[base + A2]] || '—'}→${ch.ability2 || '—'}`); out[base + A2] = v }
  }
  if (parts.length) { abilityWrites++; abilityChangeLog.push(`${ch.name.padEnd(12)} ${parts.join('  ')}`) }
}

console.log(`ROM: ${romName}  (${loaded.rom.gameCode()}, anchors ${loaded.anchorSource})`)
console.log(`stat changes: ${statWrites} species  |  ability changes: ${abilityWrites} species`)
if (missing.length) console.log(`⚠ names not found in ROM (skipped): ${missing.join(', ')}`)
console.log()
statChanges.forEach((l) => console.log('  ' + l))
if (abilityChangeLog.length) { console.log('\n  — abilities —'); abilityChangeLog.forEach((l) => console.log('  ' + l)) }

if (dryRun) { console.log('\n--dry-run: no changes written.'); process.exit(0) }
if (statWrites === 0 && abilityWrites === 0) { console.log('\nNothing to change.'); process.exit(0) }

// Independent re-parse: every changed species must read back the target values.
const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length > 0) throw new Error(`Output ROM has warnings: ${check.warnings.join('; ')}`)
for (const row of stats) {
  const id = idByName.get(row.name.toUpperCase())
  if (id === undefined) continue
  const s = check.species[id].stats
  if (s.hp !== row.hp || s.atk !== row.atk || s.def !== row.def || s.spe !== row.spe || s.spa !== row.spa || s.spd !== row.spd) {
    throw new Error(`Post-check failed for ${row.name}: got ${JSON.stringify(s)}`)
  }
}
for (const ch of ABILITY_CHANGES) {
  const id = idByName.get(ch.name.toUpperCase())
  if (id === undefined) continue
  if (ch.ability1 !== undefined) {
    const want = ch.ability1 === '' ? 0 : abilId(ch.ability1!)
    if (check.species[id].ability1 !== want) throw new Error(`Post-check ability1 failed for ${ch.name}`)
  }
  if (ch.ability2 !== undefined) {
    const want = ch.ability2 === '' ? 0 : abilId(ch.ability2!)
    if (check.species[id].ability2 !== want) throw new Error(`Post-check ability2 failed for ${ch.name}`)
  }
}

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = romPath.replace(/\.gba$/i, '') + `.pre-legacy-stats-${stamp}.gba`
fs.copyFileSync(romPath, backupPath)
fs.writeFileSync(romPath, out)

console.log(`\n✅ ${statWrites} stat + ${abilityWrites} ability species written (${diff} bytes changed).`)
console.log(`   backup: ${backupPath.split(/[\\/]/).pop()}`)
