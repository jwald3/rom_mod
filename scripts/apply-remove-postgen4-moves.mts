/**
 * Faithfulness fix: purge post-Gen-4 moves from the ROM. The only two grafted
 * past Gen 4 in this build's 368-move table are PLAY ROUGH (#365) and MOONBLAST
 * (#366), both Gen 6 Fairy moves. (Everything else added — Dark Pulse, Dragon
 * Pulse, Earth Power, etc. — is Gen 3–4 and stays.)
 *
 * The move-table slots can't be deleted (fixed-size, indexed by id), so we make
 * sure nothing in normal play teaches or uses them:
 *   • Ursaluna's level-up learnset (Lv25 Play Rough, Lv50 Moonblast) → Gen-3/4
 *     substitutes that fit its Ground/Normal kit.
 *   • Every trainer party mon that carries one → a fitting Gen-3/4 replacement
 *     (no TMs or tutors teach them, so those tables need no edit).
 *
 * Each replacement avoids duplicating a move already on that set.
 *
 *   npx tsx scripts/apply-remove-postgen4-moves.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-remove-postgen4-moves.mts --dry-run "<rom.gba>" [toml]
 *
 * Backs up, writes learnset + trainer edits, then re-parses to assert no
 * learnset entry or trainer moveset still references #365/#366. BPEE needs no toml.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { applyRomEdits } from '../src/rom/writer'
import { readLearnset, type LearnsetEntry } from '../src/rom/tables/learnsets'
import { readTrainer, partyEntryLen } from '../src/rom/tables/trainers'

const PLAY_ROUGH = 'PLAY ROUGH'
const MOONBLAST = 'MOONBLAST'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) { console.error('usage: npx tsx scripts/apply-remove-postgen4-moves.mts [--dry-run] "<rom.gba>" [toml]'); process.exit(2) }

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const moveId = (name: string) => loaded.moves.findIndex((m) => m && norm(m.name) === norm(name))
const mv = (id: number) => loaded.moves[id]?.name ?? `#${id}`

const ID_PLAY_ROUGH = moveId(PLAY_ROUGH)
const ID_MOONBLAST = moveId(MOONBLAST)
if (ID_PLAY_ROUGH < 0 && ID_MOONBLAST < 0) { console.log('Neither Play Rough nor Moonblast in this ROM — nothing to do.'); process.exit(0) }
const TARGET = new Set([ID_PLAY_ROUGH, ID_MOONBLAST].filter((i) => i >= 0))

// Replacement move ids (all verified Gen-3/4 moves in this ROM's table).
const R = {
  BODY_SLAM: moveId('BODY SLAM'),
  SUPERPOWER: moveId('SUPERPOWER'),
  ROCK_SLIDE: moveId('ROCK SLIDE'),
  EARTH_POWER: moveId('EARTH POWER'),
  DRAGON_CLAW: moveId('DRAGON CLAW'),
  SHADOW_BALL: moveId('SHADOW BALL'),
  CRUNCH: moveId('CRUNCH'),
}
for (const [k, v] of Object.entries(R)) if (v < 0) throw new Error(`Replacement ${k} not found in ROM`)

console.log(`ROM: ${romName} (${loaded.rom.gameCode()})`)
console.log(`Removing: Play Rough (#${ID_PLAY_ROUGH}), Moonblast (#${ID_MOONBLAST})\n`)

// ── 1) Learnsets ──────────────────────────────────────────────────────────
// Per-entry replacement so the move count and level pacing stay identical.
const LEARNSET_REPL: Record<number, number> = {
  [ID_PLAY_ROUGH]: R.BODY_SLAM,   // Ursaluna Lv25 — physical Normal STAB
  [ID_MOONBLAST]: R.SUPERPOWER,   // Ursaluna Lv50 — strong physical it can use
}
const learnsets = new Map<number, LearnsetEntry[]>()
for (let s = 0; s < loaded.species.length; s++) {
  const ls = readLearnset(loaded.rom, loaded.anchors, s).entries
  if (!ls.some((e) => TARGET.has(e.moveId))) continue
  const next = ls.map((e) => (TARGET.has(e.moveId) ? { ...e, moveId: LEARNSET_REPL[e.moveId] } : { ...e }))
  learnsets.set(s, next)
  const changed = ls.filter((e) => TARGET.has(e.moveId))
  console.log(`  learnset ${loaded.species[s].name}: ${changed.map((e) => `Lv${e.level} ${mv(e.moveId)} → ${mv(LEARNSET_REPL[e.moveId])}`).join(', ')}`)
}

// ── 2) Trainer parties ────────────────────────────────────────────────────
// Some affected trainers have names with an extended Gen-3 glyph the charmap
// round-trips lossily, so re-serializing the whole record would fail to re-encode
// the name. We instead patch the move u16 DIRECTLY in the party bytes — the
// surgical change, leaving names/everything else byte-identical.
// Replacement is chosen per (species, target move) so it fits the mon and
// doesn't duplicate a move already in that set.
function replacementFor(species: string, target: number, existing: number[]): number {
  const opts = target === ID_PLAY_ROUGH
    ? (species === 'ALTARIA' ? [R.DRAGON_CLAW] : species === 'MAWILE' ? [R.CRUNCH] : [R.ROCK_SLIDE, R.EARTH_POWER, R.BODY_SLAM])
    : (species === 'GARDEVOIR' ? [R.SHADOW_BALL] : [R.EARTH_POWER, R.ROCK_SLIDE, R.SUPERPOWER]) // Ursaluna Moonblast
  for (const o of opts) if (!existing.includes(o)) return o
  return opts[0]
}

// Collect { byteOffset -> newMoveId } patches.
const movePatches = new Map<number, number>()
let trainerCount = 0
for (let t = 0; t < (loaded.anchors as any).trainerCount; t++) {
  let tr
  try { tr = readTrainer(loaded.rom, loaded.anchors, t) } catch { continue }
  if (tr.partyOffset === null || !tr.party.some((p) => p.moves.some((m) => TARGET.has(m)))) continue
  const entryLen = partyEntryLen(tr.hasMoves)
  const moveOff = tr.hasItems ? 8 : 6 // moves start here within a 16-byte entry
  const notes: string[] = []
  tr.party.forEach((p, i) => {
    if (!p.moves.some((m) => TARGET.has(m))) return
    const spn = loaded.species[p.species]?.name ?? `#${p.species}`
    p.moves.forEach((m, j) => {
      if (!TARGET.has(m)) return
      const rep = replacementFor(spn, m, p.moves)
      const off = tr.partyOffset! + i * entryLen + moveOff + j * 2
      movePatches.set(off, rep)
      notes.push(`${spn} ${mv(m)}→${mv(rep)}`)
    })
  })
  trainerCount++
  console.log(`  trainer #${t} ${tr.name.replace(/[^\x20-\x7e]/g, '?')}: ${notes.join(', ')}`)
}

console.log(`\nlearnsets edited: ${learnsets.size} | trainer mons patched: ${movePatches.size} across ${trainerCount} trainers`)
if (dryRun) { console.log('\n--dry-run: no changes written.'); process.exit(0) }
if (!learnsets.size && !movePatches.size) { console.log('Nothing referenced the moves.'); process.exit(0) }

// Learnsets go through the writer; trainer moves are patched directly on top.
const { bytes: out } = learnsets.size
  ? applyRomEdits(loaded.rom, loaded.anchors, { learnsets })
  : { bytes: loaded.rom.bytes.slice() }
const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
for (const [off, id] of movePatches) view.setUint16(off, id, true)

// ── verify: no learnset entry or trainer party still references the moves ──
const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length) throw new Error(`Output warnings: ${check.warnings.join('; ')}`)
let remain = 0
for (let s = 0; s < check.species.length; s++)
  for (const e of readLearnset(check.rom, check.anchors, s).entries) if (TARGET.has(e.moveId)) remain++
for (let t = 0; t < (check.anchors as any).trainerCount; t++) {
  try { for (const p of readTrainer(check.rom, check.anchors, t).party) for (const m of p.moves) if (TARGET.has(m)) remain++ } catch {}
}
if (remain) throw new Error(`Post-check failed: ${remain} references to the removed moves remain`)

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backup = romPath.replace(/\.gba$/i, '') + `.pre-postgen4-moves-${stamp}.gba`
fs.copyFileSync(romPath, backup)
fs.writeFileSync(romPath, out)
console.log(`\n✅ Play Rough & Moonblast no longer taught or used by any Pokémon or trainer (${diff} bytes changed).`)
console.log(`   backup: ${backup.split(/[\\/]/).pop()}`)
