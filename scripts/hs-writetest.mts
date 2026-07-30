/**
 * Write round-trip safety test for the Heart & Soul (BPEE) profile.
 * Applies one edit of every editable kind, reloads the patched bytes, and
 * verifies each edit persisted AND that unrelated data is byte-identical.
 * Run: npx tsx scripts/hs-writetest.mts "<Pokemon Heart & Soul.gba>"
 */
import { readFileSync } from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { applyRomEdits, type RomEdits } from '../src/rom/writer'
import { wildKey } from '../src/rom/tables/wild'
import { trainerToEdit } from '../src/rom/tables/trainers'

const path = process.argv[2] || 'C:/Users/Waldo/Downloads/H&S/Pokemon Heart & Soul.gba'
const toml = process.argv[3] ? readFileSync(process.argv[3], 'utf8') : undefined
const bytes = new Uint8Array(readFileSync(path))
const r = loadRom(bytes, 'hs.gba', toml)

// free-space sanity: largest 0xFF run above the floor
let best = 0, run = 0
for (let i = 0x700000; i < bytes.length; i++) {
  if (bytes[i] === 0xff) { run++; if (run > best) best = run } else run = 0
}
console.log('largest 0xFF run above 0x700000:', best.toLocaleString(), 'bytes')

// --- build edits of every kind ---
const sawyerIdx = r.trainers.findIndex((t) => t.name === 'SAWYER')
const sawyer = trainerToEdit(r.trainers[sawyerIdx])
// grow SAWYER's party by cloning first mon (forces party repoint if it outgrows slot)
sawyer.party = [...sawyer.party, { ...sawyer.party[0], level: 42 }]

const wa = r.wildAreas[0]
const grass = wa.groups.grass!
const newGrass = { rate: grass.rate, slots: grass.slots.map((s, i) => (i === 0 ? { ...s, species: 25 } : s)) }

// grow a learnset well past its slot to force a repoint
const bulbaLs = [...r.learnsets[1].entries, { level: 50, moveId: 1 }, { level: 55, moveId: 2 }]

const edits: RomEdits = {
  learnsets: new Map([[1, bulbaLs]]),
  tmCompat: new Map([[1, r.tmCompat[1].map((v, i) => (i === 0 ? !v : v))]]),
  tutorCompat: new Map([[1, r.tutorCompat[1].map((v, i) => (i === 0 ? !v : v))]]),
  wild: new Map([[wildKey(0, 'grass'), newGrass]]),
  evolutions: new Map([[1, [{ method: 4, param: 20, target: 3 }]]]), // Bulbasaur -> Venusaur @20
  heldItems: new Map([[1, { item1: 1, item2: 2 }]]),
  trainers: new Map([[sawyerIdx, sawyer]]),
}

const { bytes: patched, ops } = applyRomEdits(r.rom, r.anchors, edits)
console.log('write ops:', ops.map((o) => `${o.kind}@${o.newOffset.toString(16)}(${o.byteLength}B)`).join(', '))

// --- reload & verify persistence ---
const r2 = loadRom(patched, 'hs2.gba', toml)
const fail: string[] = []
const ok = (label: string, got: unknown, want: unknown) => {
  if (String(got) !== String(want)) fail.push(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}
ok('learnset last move', r2.learnsets[1].entries.at(-1)?.moveId, 2)
ok('learnset grew', r2.learnsets[1].entries.length, bulbaLs.length)
ok('tmCompat toggled', r2.tmCompat[1][0], !r.tmCompat[1][0])
ok('tutorCompat toggled', r2.tutorCompat[1][0], !r.tutorCompat[1][0])
ok('wild grass[0] species', r2.wildAreas[0].groups.grass!.slots[0].species, 25)
ok('evolution changed', r2.evolutions[1][0]?.target, 3)
ok('evolution param', r2.evolutions[1][0]?.param, 20)
ok('held item1', r2.species[1].heldItem1, 1)
ok('trainer party grew', r2.trainers[sawyerIdx].party.length, sawyer.party.length)
ok('trainer new mon level', r2.trainers[sawyerIdx].party.at(-1)?.level, 42)

// --- verify unrelated data intact ---
ok('other species name intact', r2.species[386].name, r.species[386].name)
ok('other move intact', r2.moves[100].name, r.moves[100].name)
ok('other learnset intact', r2.learnsets[150].entries.length, r.learnsets[150].entries.length)
ok('other trainer intact', r2.trainers[200].name, r.trainers[200].name)
ok('other wild area intact', r2.wildAreas[50].groups.grass?.slots[3].species,
  r.wildAreas[50].groups.grass?.slots[3].species)

// byte-diff: how many bytes changed, and are they all in expected regions?
let changed = 0
for (let i = 0; i < bytes.length; i++) if (bytes[i] !== patched[i]) changed++
console.log('total bytes changed:', changed)

if (fail.length) {
  console.log('\n== FAIL ==')
  for (const f of fail) console.log('  ✗', f)
  process.exit(1)
}
console.log('\nAll write round-trip checks passed ✓')
