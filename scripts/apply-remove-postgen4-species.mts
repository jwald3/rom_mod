/**
 * Faithfulness fix: purge post-Gen-4 SPECIES from the ROM. This build's dex has
 * ten Gen-5+ entries grafted in:
 *   Regidrago #439, Regieleki #440 (Gen 8) — unused slots, left dormant
 *   Sylveon   #444 (Gen 6)               — only reachable via Eevee's evo
 *   Annihilape#449, Farigiraf#450, Dudunsparce#451, Wyrdeer#452 (Gen 9)
 *   Ursaluna  #453/#454 (Gen 8), Kleavor #455 (Gen 8)
 *
 * Species slots can't be deleted, so we cut off all in-game access:
 *   1. Trainer parties carrying a Gen-5+ mon → its Gen-1/4 pre-evolution
 *      (Annihilape→Primeape, Kleavor→Scyther, Wyrdeer→Stantler,
 *       Dudunsparce→Dunsparce, Ursaluna→Ursaring).
 *   2. Every evolution that TARGETS a Gen-5+ species is removed, so the pre-evo
 *      (Primeape, Scyther, Eevee, Girafarig, Dunsparce, Ursaring, Stantler)
 *      becomes the final form and the Gen-5+ mon is unreachable.
 *   3. Wild slots holding a Gen-5+ species are swapped to the same pre-evolution.
 *      (An earlier revision of this script claimed no wild slot used one; that was
 *      wrong — Annihilape spawns in Cerulean Cave and on Mt. Silver.)
 * Regidrago/Regieleki have no pre-evo and nothing references them, so their
 * dormant slots are left as-is.
 *
 *   npx tsx scripts/apply-remove-postgen4-species.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-remove-postgen4-species.mts --dry-run "<rom.gba>" [toml]
 *
 * Trainer party species are byte-patched directly (some affected trainers have
 * names with an extended glyph the charmap can't re-encode). Evolutions go
 * through the writer. Backs up + re-verifies zero references remain.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { applyRomEdits } from '../src/rom/writer'
import { readTrainer, partyEntryLen } from '../src/rom/tables/trainers'
import { readEvolutionsFor, type Evolution } from '../src/rom/tables/evolutions'
import { WILD_KINDS } from '../src/rom/tables/wild'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) { console.error('usage: npx tsx scripts/apply-remove-postgen4-species.mts [--dry-run] "<rom.gba>" [toml]'); process.exit(2) }

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)

const sp = (id: number) => loaded.species[id]?.name ?? `#${id}`
const id = (name: string) => loaded.species.findIndex((s) => s && s.name === name)

// The Gen-5+ species entries (by name; two Ursaluna slots resolve to both indices).
const GEN5PLUS = ['REGIDRAGO', 'REGIELEKI', 'SYLVEON', 'ANNIHILAPE', 'FARIGIRAF', 'DUDUNSPARC', 'WYRDEER', 'URSALUNA', 'KLEAVOR']
const REMOVE = new Set<number>()
for (let i = 0; i < loaded.species.length; i++) if (loaded.species[i] && GEN5PLUS.includes(loaded.species[i].name)) REMOVE.add(i)

// Trainer-party replacement: Gen-5+ id → pre-evo id.
const PREEVO: Record<string, string> = {
  ANNIHILAPE: 'PRIMEAPE', KLEAVOR: 'SCYTHER', WYRDEER: 'STANTLER',
  DUDUNSPARC: 'DUNSPARCE', URSALUNA: 'URSARING',
}
const replForId = new Map<number, number>()
for (const [g5, pre] of Object.entries(PREEVO)) {
  const preId = id(pre)
  if (preId < 0) throw new Error(`Pre-evo ${pre} not found`)
  for (let i = 0; i < loaded.species.length; i++) if (loaded.species[i]?.name === g5) replForId.set(i, preId)
}

console.log(`ROM: ${romName} (${loaded.rom.gameCode()})`)
console.log(`Post-Gen-4 species to purge: ${[...REMOVE].map(sp).join(', ')}\n`)

// ── 1) Trainer party species (direct byte-patch) ──────────────────────────
const speciesPatches = new Map<number, number>() // byteOffset → new species id
let trainerCount = 0
for (let t = 0; t < (loaded.anchors as any).trainerCount; t++) {
  let tr
  try { tr = readTrainer(loaded.rom, loaded.anchors, t) } catch { continue }
  if (tr.partyOffset === null || !tr.party.some((p) => replForId.has(p.species))) continue
  const entryLen = partyEntryLen(tr.hasMoves)
  const notes: string[] = []
  tr.party.forEach((p, i) => {
    const rep = replForId.get(p.species)
    if (rep === undefined) return
    // species is a u16 at +4 within the mon entry
    speciesPatches.set(tr.partyOffset! + i * entryLen + 4, rep)
    notes.push(`${sp(p.species)}→${sp(rep)}`)
  })
  trainerCount++
  console.log(`  trainer #${t} ${tr.name.replace(/[^\x20-\x7e]/g, '?')}: ${notes.join(', ')}`)
}

// ── 2) Evolutions targeting a removed species → drop the entry ────────────
const evolutions = new Map<number, Evolution[]>()
for (let s = 0; s < loaded.species.length; s++) {
  const evs = readEvolutionsFor(loaded.rom, loaded.anchors, s)
  if (!evs.some((e) => REMOVE.has(e.target))) continue
  const kept = evs.filter((e) => !REMOVE.has(e.target))
  evolutions.set(s, kept)
  const dropped = evs.filter((e) => REMOVE.has(e.target))
  console.log(`  evolution ${sp(s)}: drop → ${dropped.map((e) => sp(e.target)).join(', ')} (now ${kept.length ? kept.map((e) => sp(e.target)).join('/') : 'final form'})`)
}

// ── 3) Wild slots holding a removed species → the same pre-evo ────────────
const wildPatches = new Map<number, number>() // byteOffset → new species id
for (const area of loaded.wildAreas) {
  for (const kind of WILD_KINDS) {
    const group = area.groups[kind]
    if (!group) continue
    group.slots.forEach((slot, i) => {
      const rep = replForId.get(slot.species)
      if (rep === undefined) return
      wildPatches.set(group.listOffset + i * 4 + 2, rep) // species u16 at slot+2
      console.log(`  wild ${area.name} (${area.bank}.${area.map}) ${kind} slot ${i}: ${sp(slot.species)}→${sp(rep)} Lv ${slot.low}-${slot.high}`)
    })
  }
}

console.log(`\ntrainer mons patched: ${speciesPatches.size} across ${trainerCount} trainers | evolution lists edited: ${evolutions.size} | wild slots patched: ${wildPatches.size}`)
if (dryRun) { console.log('\n--dry-run: no changes written.'); process.exit(0) }
if (!speciesPatches.size && !evolutions.size && !wildPatches.size) { console.log('Nothing referenced the removed species.'); process.exit(0) }

// Evolutions through the writer; trainer species byte-patched on top.
const { bytes: out } = evolutions.size
  ? applyRomEdits(loaded.rom, loaded.anchors, { evolutions })
  : { bytes: loaded.rom.bytes.slice() }
const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
for (const [off, id] of speciesPatches) view.setUint16(off, id, true)
for (const [off, id] of wildPatches) view.setUint16(off, id, true)

// ── verify: no trainer party, evolution target or wild slot references one
const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length) throw new Error(`Output warnings: ${check.warnings.join('; ')}`)
let remain = 0
for (let t = 0; t < (check.anchors as any).trainerCount; t++) {
  try { for (const p of readTrainer(check.rom, check.anchors, t).party) if (REMOVE.has(p.species)) remain++ } catch {}
}
for (let s = 0; s < check.species.length; s++)
  for (const e of readEvolutionsFor(check.rom, check.anchors, s)) if (REMOVE.has(e.target)) remain++
for (const area of check.wildAreas)
  for (const kind of WILD_KINDS)
    for (const slot of area.groups[kind]?.slots ?? []) if (REMOVE.has(slot.species)) remain++
if (remain) throw new Error(`Post-check failed: ${remain} references to removed species remain`)

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backup = romPath.replace(/\.gba$/i, '') + `.pre-postgen4-species-${stamp}.gba`
fs.copyFileSync(romPath, backup)
fs.writeFileSync(romPath, out)
console.log(`\n✅ Post-Gen-4 species no longer appear in any trainer party, evolution or wild slot (${diff} bytes changed).`)
console.log(`   backup: ${backup.split(/[\\/]/).pop()}`)
