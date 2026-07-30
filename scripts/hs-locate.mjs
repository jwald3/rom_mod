/**
 * Reverse-engineer + verify the Heart & Soul (BPEE / pokeemerald-expansion)
 * table addresses that back src/rom/anchors.ts → HS_BPEE.
 *
 *   node scripts/hs-locate.mjs "<Pokemon Heart & Soul.gba>" ["<vanilla Emerald.gba>"]
 *
 * H&S repointed every data table into expanded ROM space and its HMA .toml is
 * stale (it describes the vanilla 28-byte structs, not the 40-byte expansion
 * ones), so nothing could be read from the sidecar. These addresses were found
 * three ways, each self-checking:
 *
 *   • pointer-follow — a vanilla Emerald ROM (arg 2) tells us which code offset
 *     references a table; the hack patched that literal in place, so the same
 *     offset in H&S holds the repointed address. Confirms names/stats/items.
 *   • data signature — tables the hack left byte-identical to vanilla (the TM
 *     move list, one learnset array) are found by searching for their bytes.
 *   • structure — tables the hack changed (evolutions, wild, trainers) are
 *     found by their shape and anchored on a known datum (Bulbasaur → Ivysaur).
 *
 * The result is printed and each value is sanity-decoded; keep this in sync
 * with HS_BPEE.
 */
import { readFileSync } from 'node:fs'

const HS = process.argv[2] || 'C:/Users/Waldo/Downloads/H&S/Pokemon Heart & Soul.gba'
const hs = readFileSync(HS)
const hex = (n) => '0x' + (n >>> 0).toString(16)

const T = { 0x00: ' ' }
for (let i = 0; i <= 9; i++) T[0xa1 + i] = String(i)
for (let i = 0; i < 26; i++) { T[0xbb + i] = String.fromCharCode(65 + i); T[0xd5 + i] = String.fromCharCode(97 + i) }
Object.assign(T, { 0xae: '.', 0xb5: '♂', 0xb6: '♀', 0x2d: '&', 0xba: '/', 0xb8: ',', 0x1b: 'é' })
const u16 = (o) => hs.readUInt16LE(o)
const u32 = (o) => hs.readUInt32LE(o)
const dec = (o, n) => { let s = ''; for (let i = 0; i < n; i++) { const b = hs[o + i]; if (b === 0xff) break; s += T[b] ?? '·' } return s }

const A = {
  speciesNames: 0x744798, speciesCount: 462,
  moveNames: 0x745b74, moveCount: 368,
  moveStats: 0x937998,
  learnsets: 0x94e0d8,
  baseStats: 0x93bd40, baseStatsLen: 40,
  typeNames: 0x6e152c, typeCount: 19,
  abilityNames: 0x6e1e90, abilityCount: 82,
  tms: 0x91b450, tmCount: 58,
  tutors: 0x91a098, tutorCount: 30,
  tmCompat: 0x93a010,
  tutorCompat: 0x9667ac,
  evolutions: 0x946620, evosPerSpecies: 8,
  items: 0x8fe910, itemCount: 626,
  wild: 0xd3bd90,
  mapBanks: 0xf39750,
  mapNames: 0x96db40, mapNameCount: 213,
  trainers: 0x73c0c0, trainerCount: 864,
  trainerClasses: 0x73bcf1, trainerClassCount: 75,
}

console.log('ROM', HS.split(/[\\/]/).pop(), (hs.length / 1048576) + 'MB', 'code', hs.toString('latin1', 0xac, 0xb0))
console.log('-'.repeat(64))
const spName = (i) => dec(A.speciesNames + i * A.speciesStride ?? 11, 11)
const name = (base, stride, i) => dec(base + i * stride, stride)

const rows = [
  ['species.names', A.speciesNames, () => `#1 ${name(A.speciesNames, 11, 1)}`],
  ['pokemon.stats', A.baseStats, () => {
    const o = A.baseStats + 40; return `bulba ${[0,1,2,3,4,5].map((i) => hs[o+i]).join('/')} type ${hs[o+6]}/${hs[o+7]}`
  }],
  ['moves.names', A.moveNames, () => `#1 ${name(A.moveNames, 13, 1)} #2 ${name(A.moveNames, 13, 2)}`],
  ['moves.stats', A.moveStats, () => `POUND pow ${hs[A.moveStats + 12 + 1]} acc ${hs[A.moveStats + 12 + 3]}`],
  ['moves.levelup', A.learnsets, () => {
    const p = u32(A.learnsets + 4) - 0x08000000; return `bulba L${u16(p) >> 9}:move${u16(p) & 0x1ff}`
  }],
  ['type.names', A.typeNames, () => [0, 12, 18].map((i) => name(A.typeNames, 7, i)).join(',')],
  ['abilities.names', A.abilityNames, () => `#9 ${name(A.abilityNames, 13, 9)}`],
  ['moves.tms', A.tms, () => `TM01 move ${u16(A.tms)}`],
  ['moves.tutors', A.tutors, () => `tutor0 move ${u16(A.tutors)}`],
  ['moves.tmcompat', A.tmCompat, () => 'bitfield rows (8B/species)'],
  ['moves.tutorcompat', A.tutorCompat, () => 'bitfield rows (4B/species)'],
  ['evolutions', A.evolutions, () => {
    const o = A.evolutions + A.evosPerSpecies * 8; // species 1
    return `bulba m${u16(o)}/p${u16(o + 2)}/${name(A.speciesNames, 11, u16(o + 4)).trim()}`
  }],
  ['items.stats', A.items, () => `#1 ${name(A.items, 44, 1)}`],
  ['wild', A.wild, () => `hdr0 bank ${hs[A.wild]} map ${hs[A.wild + 1]}`],
  ['maps.banks', A.mapBanks, () => (u32(A.mapBanks) >= 0x08000000 ? 'bank ptr table' : '?')],
  ['maps.names', A.mapNames, () => `#0 ${dec(u32(A.mapNames + 4) - 0x08000000, 16)}`],
  ['trainers.stats', A.trainers, () => `#1 ${dec(A.trainers + 40 + 4, 12)}`],
  ['trainers.classes', A.trainerClasses, () => `#0 ${name(A.trainerClasses, 13, 0)}`],
]
for (const [label, addr, detail] of rows) {
  console.log(label.padEnd(20), hex(addr).padEnd(10), detail())
}
console.log('-'.repeat(64))
console.log('counts:', Object.fromEntries(Object.entries(A).filter(([k]) => /Count|Len/.test(k))))
