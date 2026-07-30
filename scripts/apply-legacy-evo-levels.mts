/**
 * Apply the poke-emerald-legacy evolution LEVEL tweaks (evolve-earlier QoL):
 * Goldeen 28, Spinarak 21, Pineco 25, Slugma 27, Ralts 16, Aron 28, Meditite 33,
 * Trapinch 32, Vibrava 42, Snorunt 36. https://mryakobo.github.io/poke-emerald-legacy-docs/
 *
 *   npx tsx scripts/apply-legacy-evo-levels.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-legacy-evo-levels.mts --dry-run "<rom.gba>" [toml]
 *
 * For each species we retarget the level (param) of its level-up evolution
 * (method 4). Only the level changes; the target species and any other branches
 * (e.g. Snorunt's Froslass item branch) are preserved. Backup + re-read verify.
 * The trade→item conversions from the doc were already applied separately
 * (apply-trade-item-to-stone.mts); Haunter/Kadabra/Graveler/Machoke already
 * evolve by level in this ROM base, matching the doc.
 */
import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadRom } from '../src/rom/loadRom'
import { applyRomEdits } from '../src/rom/writer'
import { readEvolutionsFor, type Evolution } from '../src/rom/tables/evolutions'

const here = dirname(fileURLToPath(import.meta.url))
interface EvoLvl { name: string; level: number }
const tweaks: EvoLvl[] = JSON.parse(fs.readFileSync(resolve(here, 'legacy-evo-levels.json'), 'utf8'))

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) {
  console.error('usage: npx tsx scripts/apply-legacy-evo-levels.mts [--dry-run] "<rom.gba>" [toml]')
  process.exit(2)
}

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length > 0) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)

const idByName = new Map<string, number>()
loaded.species.forEach((s, i) => { if (s.name) idByName.set(s.name.toUpperCase(), i) })
const sp = (id: number) => loaded.species[id]?.name ?? `#${id}`

const LEVEL_METHOD = 4
const evolutions = new Map<number, Evolution[]>()
const changes: string[] = []
const missing: string[] = []

for (const t of tweaks) {
  const id = idByName.get(t.name.toUpperCase())
  if (id === undefined) { missing.push(t.name); continue }
  const evos = readEvolutionsFor(loaded.rom, loaded.anchors, id)
  const lvlEvo = evos.find((e) => e.method === LEVEL_METHOD)
  if (!lvlEvo) { missing.push(`${t.name} (no level-up evolution)`); continue }
  if (lvlEvo.param === t.level) continue // already correct
  const next = evos.map((e) => (e === lvlEvo ? { ...e, param: t.level } : e))
  evolutions.set(id, next)
  changes.push(`${t.name.padEnd(10)} → ${sp(lvlEvo.target).padEnd(11)} Lv ${lvlEvo.param} → ${t.level}`)
}

console.log(`ROM: ${romName}  (${loaded.rom.gameCode()}, anchors ${loaded.anchorSource})`)
console.log(`evolution level tweaks: ${changes.length}`)
if (missing.length) console.log(`⚠ not applied: ${missing.join(', ')}`)
console.log()
changes.forEach((l) => console.log('  ' + l))

if (dryRun) { console.log('\n--dry-run: no changes written.'); process.exit(0) }
if (evolutions.size === 0) { console.log('\nNothing to change.'); process.exit(0) }

const { bytes: out } = applyRomEdits(loaded.rom, loaded.anchors, { evolutions })

const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length > 0) throw new Error(`Output ROM has warnings: ${check.warnings.join('; ')}`)
for (const t of tweaks) {
  const id = idByName.get(t.name.toUpperCase())
  if (id === undefined) continue
  const lvlEvo = readEvolutionsFor(check.rom, check.anchors, id).find((e) => e.method === LEVEL_METHOD)
  if (lvlEvo && lvlEvo.param !== t.level) throw new Error(`Post-check failed for ${t.name}: level ${lvlEvo.param} ≠ ${t.level}`)
}

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = romPath.replace(/\.gba$/i, '') + `.pre-evo-levels-${stamp}.gba`
fs.copyFileSync(romPath, backupPath)
fs.writeFileSync(romPath, out)

console.log(`\n✅ ${changes.length} evolution levels updated (${diff} bytes changed).`)
console.log(`   backup: ${backupPath.split(/[\\/]/).pop()}`)
