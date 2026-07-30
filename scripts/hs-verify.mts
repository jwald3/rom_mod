/**
 * Verify the Heart & Soul (BPEE) profile end-to-end through the real editor
 * readers. Run: npx tsx scripts/hs-verify.mts "<path to Pokemon Heart & Soul.gba>"
 */
import { readFileSync } from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { readEvolutionsFor } from '../src/rom/tables/evolutions'
import { describeEvolution } from '../src/rom/tables/evolutions'

const path = process.argv[2] || 'C:/Users/Waldo/Downloads/H&S/Pokemon Heart & Soul.gba'
const tomlPath = process.argv[3] // optional
const bytes = new Uint8Array(readFileSync(path))
const toml = tomlPath ? readFileSync(tomlPath, 'utf8') : undefined

const r = loadRom(bytes, path.split(/[\\/]/).pop()!, toml)
const pass: string[] = []
const fail: string[] = []
const check = (label: string, got: unknown, want: unknown) => {
  ;(String(got) === String(want) ? pass : fail).push(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

console.log('game code   :', r.rom.gameCode())
console.log('anchorSource:', r.anchorSource)
console.log('warnings    :', r.warnings.length ? r.warnings : '(none)')
console.log('counts      : species', r.species.length, 'moves', r.moves.length, 'items', r.itemNames.length,
  'types', r.typeNames.length, 'abilities', r.abilityNames.length, 'trainers', r.trainers.length,
  'classes', r.trainerClassNames.length, 'wild', r.wildAreas.length)
console.log('TM/tutor    :', r.tmMoves.length, 'TMs /', r.tutorMoves.length, 'tutors')

// --- species / stats ---
check('species #1 name', r.species[1]?.name, 'BULBASAUR')
check('species #4 name', r.species[4]?.name, 'CHARMANDER')
check('bulbasaur HP', r.species[1]?.stats.hp, 45)
check('bulbasaur SpA', r.species[1]?.stats.spa, 65)
check('bulbasaur type1', r.typeNames[r.species[1].type1], 'GRASS')
check('bulbasaur type2', r.typeNames[r.species[1].type2], 'POISON')
check('pikachu ability1', r.abilityNames[r.species[25].ability1], 'STATIC')
check('type #18', r.typeNames[18], 'FAIRY')

// --- moves ---
check('move #1 name', r.moves[1]?.name, 'POUND')
check('move #1 power', r.moves[1]?.power, 40)
check('move #2 name', r.moves[2]?.name, 'KARATE CHOP')
check('move #367 name', r.moves[367]?.name, 'POISON JAB')

// --- learnsets ---
const bulba = r.learnsets[1].entries.slice(0, 3).map((e) => `L${e.level}:${r.moves[e.moveId]?.name}`)
check('bulbasaur 1st move', r.moves[r.learnsets[1].entries[0].moveId]?.name, 'TACKLE')
const char = r.learnsets[4].entries.map((e) => r.moves[e.moveId]?.name)
check('charmander knows EMBER', char.includes('EMBER'), true)
console.log('bulbasaur learnset:', bulba.join(' '))

// --- evolutions (stride/slot-count correctness across the dex) ---
const evoOf = (sp: number) => readEvolutionsFor(r.rom, r.anchors, sp)
check('slots per species', r.anchors.evosPerSpecies, 8)
check('bulbasaur → IVYSAUR Lv16', describeEvolution(evoOf(1)[0], r.itemNames) + ' ' + r.species[evoOf(1)[0].target].name, 'Lv 16 IVYSAUR')
check('charmander → CHARMELEON Lv16', r.species[evoOf(4)[0].target]?.name, 'CHARMELEON')
check('squirtle → WARTORTLE', r.species[evoOf(7)[0].target]?.name, 'WARTORTLE')
check('wartortle → BLASTOISE Lv36', describeEvolution(evoOf(8)[0], r.itemNames), 'Lv 36')
check('pikachu → RAICHU via stone', r.species[evoOf(25)[0].target]?.name, 'RAICHU')
check('eevee has 8 evolutions', evoOf(133).length, 8)
check('eevee → all distinct targets', new Set(evoOf(133).map((e) => e.target)).size, 8)
console.log('eevee:', evoOf(133).map((e) => `${describeEvolution(e, r.itemNames)}→${r.species[e.target]?.name}`).join(', '))

// --- items ---
check('item #1', r.itemNames[1], 'MASTER BALL')
check('item #625', r.itemNames[625], 'RARECANDY BOX')

// --- TMs / tutors ---
check('TM01 move', r.moves[r.tmMoves[0]]?.name, 'FOCUS PUNCH')
check('bulbasaur TM count', r.tmCompat[1].filter(Boolean).length > 0, true)
check('bulbasaur tutor row width', r.tutorCompat[1].length, 30)

// --- trainers ---
const named = r.trainers.find((t) => t.name === 'SAWYER')
check('SAWYER exists', !!named, true)
if (named) {
  check('SAWYER party[0] species', r.species[named.party[0]?.species]?.name, 'GEODUDE')
  console.log('SAWYER:', 'class', r.trainerClassNames[named.cls], 'party',
    named.party.map((m) => `L${m.level} ${r.species[m.species]?.name}`).join(', '))
}

// --- wild + map names ---
const wa = r.wildAreas[0]
console.log('wild area 0:', wa.name, 'grass[0]:', wa.groups.grass && r.species[wa.groups.grass.slots[0].species]?.name)
check('wild has areas', r.wildAreas.length > 100, true)
const namedAreas = r.wildAreas.filter((w) => !/^Map \d/.test(w.name))
check('wild areas resolve to real names', namedAreas.length > 300, true)
check('a wild area is a Johto/Kanto town', r.wildAreas.some((w) => w.name === 'ROUTE 29' || w.name === 'CHERRYGROVE CITY'), true)
console.log('sample map names:', [...new Set(namedAreas.map((w) => w.name))].slice(0, 10).join(', '))

console.log('\n== PASS ==')
for (const p of pass) console.log('  ✓', p)
if (fail.length) {
  console.log('\n== FAIL ==')
  for (const f of fail) console.log('  ✗', f)
  process.exit(1)
} else {
  console.log(`\nAll ${pass.length} checks passed.`)
}
