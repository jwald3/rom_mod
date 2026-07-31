/**
 * Accuracy audit: extract the factual claims from heart-and-soul-guide.html's
 * prose and verify each against the actual ROM (evolution table + learnsets).
 * Read-only — never modifies anything.
 *
 *   npx tsx scripts/verify-guide-vs-rom.mts "<rom.gba>" [toml]
 *
 * Claim types checked:
 *   A. Evolution level:  "X → Y at Lv NN" / "evolves into Y at Lv NN" / "Y (Lv NN)"
 *   B. Move milestone:   "learns MOVE at Lv NN" / "MOVE at Lv NN"
 *   C. Evolution target: "X → Y" / "X evolves into Y" (species relationship)
 * Each is matched to the ROM and reported PASS / FAIL / UNVERIFIABLE.
 */
import { readFileSync } from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { readAllEvolutions } from '../src/rom/tables/evolutions'
import { readLearnset } from '../src/rom/tables/learnsets'

const romPath = process.argv[2]
if (!romPath) { console.error('usage: npx tsx scripts/verify-guide-vs-rom.mts "<rom.gba>" [toml]'); process.exit(2) }
const toml = process.argv[3] ? readFileSync(process.argv[3], 'utf8') : undefined
const r = loadRom(new Uint8Array(readFileSync(romPath)), romPath.split(/[\\/]/).pop()!, toml)

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
const spByName = new Map<string, number>()
r.species.forEach((s, i) => { if (s.name && !spByName.has(norm(s.name))) spByName.set(norm(s.name), i) })
const moveByName = new Map<string, number>()
r.moves.forEach((m) => { if (m.name) moveByName.set(norm(m.name), m.id) })

// Evolution index: species id → [{targetId, method, param}]
const allEvos = readAllEvolutions(r.rom, r.anchors)
// learnset index: species id → Map(normMoveName → [levels])
const learnCache = new Map<number, Map<string, number[]>>()
function learnFor(id: number): Map<string, number[]> {
  if (learnCache.has(id)) return learnCache.get(id)!
  const m = new Map<string, number[]>()
  for (const e of readLearnset(r.rom, r.anchors, id).entries) {
    const nm = norm(r.moves[e.moveId]?.name ?? '')
    if (!m.has(nm)) m.set(nm, [])
    m.get(nm)!.push(e.level)
  }
  learnCache.set(id, m)
  return m
}

// ── extract plain text from the guide ──
const html = readFileSync('heart-and-soul-guide.html', 'utf8')
// decode a few entities, drop tags, collapse space; keep → and Lv tokens
const text = html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#39;|&apos;|’/g, "'")
  .replace(/\s+/g, ' ')

interface Result { kind: string; claim: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail?: string }
const results: Result[] = []
const knownMon = (n: string) => spByName.has(norm(n))

// ── A. Evolution level claims ──
// e.g. "Geodude → Graveler ... at Lv 25", "evolves into Ampharos at Lv 30",
//      "hits Kingler at Lv 28", "Pupitar at Lv 30". Restrict to a mon token
//      immediately preceding "at Lv NN" (optionally with →/evolves phrasing).
// Require the Lv to sit within a tight window right after the evo target, and
// NOT be separated by another capitalized species (which would mean the level
// belongs to a different mon). e.g. accept "Graveler at Lv 25"; reject
// "Metapod (Lv 7) to Butterfree (Lv 10)" binding Metapod→Butterfree to 10.
const evoLvRe = /([A-Z][A-Za-z'.♀♂-]+)\s*(?:→|evolves into|hits|reaches|climbs to|becomes|into)\s*([A-Z][A-Za-z'.♀♂-]+)((?:\s+(?:at|by|around)?\s*(?:\()?\s*Lv\s*\d+)?)/g
let m: RegExpExecArray | null
while ((m = evoLvRe.exec(text))) {
  const [, pre, evo, lvTail] = m
  const lvMatch = lvTail.match(/Lv\s*(\d+)/)
  if (!lvMatch) continue // "X → Y" with no adjacent level — handled by target check
  const lv = parseInt(lvMatch[1], 10)
  if (!knownMon(evo)) continue // "evo" isn't a species — skip (probably a move)
  const preId = spByName.get(norm(pre))
  const claim = `${pre} → ${evo} @ Lv ${lv}`
  if (preId === undefined) { continue }
  const evoId = spByName.get(norm(evo))!
  const edge = allEvos[preId].find((e) => e.target === evoId)
  if (!edge) {
    // could be a two-hop mention ("Larvitar line ... Tyranitar Lv 55"); accept if
    // any mon in pre's line reaches evo at that level via a level method.
    let ok = false
    for (const e of allEvos[preId]) if (allEvos[e.target]?.some((e2) => e2.target === evoId && e2.param === lv && [4, 8, 9, 10, 18].includes(e2.method))) ok = true
    if (ok) results.push({ kind: 'evo-lv', claim, status: 'PASS', detail: '(2-hop)' })
    else results.push({ kind: 'evo-lv', claim, status: 'FAIL', detail: `${pre} does not evolve into ${evo} in ROM` })
    continue
  }
  // level methods: 4 (level), 8/9/10 (level+stats), 18
  if ([4, 8, 9, 10, 18].includes(edge.method)) {
    if (edge.param === lv) results.push({ kind: 'evo-lv', claim, status: 'PASS' })
    else results.push({ kind: 'evo-lv', claim, status: 'FAIL', detail: `ROM says Lv ${edge.param}, not ${lv}` })
  } else {
    results.push({ kind: 'evo-lv', claim, status: 'SKIP', detail: `ROM uses non-level method ${edge.method}` })
  }
}

// ── C. Evolution target claims: "X → Y" / "X evolves into Y" (no level) ──
const evoTgtRe = /([A-Z][A-Za-z'.♀♂-]+)\s*(?:→|evolves into|becomes)\s*([A-Z][A-Za-z'.♀♂-]+)/g
const seenEvoPair = new Set<string>()
while ((m = evoTgtRe.exec(text))) {
  const [, a, b] = m
  if (!knownMon(a) || !knownMon(b)) continue
  const key = norm(a) + '>' + norm(b)
  if (seenEvoPair.has(key)) continue
  seenEvoPair.add(key)
  const aId = spByName.get(norm(a))!, bId = spByName.get(norm(b))!
  if (aId === bId) continue
  const claim = `${a} → ${b}`
  // allow one hop (direct) or two hops (X → mid → Y) since guide chains "A → B → C"
  const direct = allEvos[aId].some((e) => e.target === bId)
  const twoHop = allEvos[aId].some((e) => allEvos[e.target]?.some((e2) => e2.target === bId))
  if (direct || twoHop) results.push({ kind: 'evo-target', claim, status: 'PASS' })
  else results.push({ kind: 'evo-target', claim, status: 'FAIL', detail: `${a} has no evolution path to ${b}` })
}

// ── B. Move milestone claims: "…MOVE at Lv NN" ──
// The move name is whatever ROM move (longest wins) immediately precedes "at Lv".
// This avoids the "Drill Peck"→"Peck", "Body Slam"→"Slam", "Dragon Rage"→"Rage"
// truncation. Species owner = nearest species mentioned earlier in the sentence
// OR, when the sentence uses a pronoun ("it learns…"), the species from the
// sentence(s) just before (the running subject).
const wordsUpper = new Set([...moveByName.keys()])
// Build a set of the max word-count of any move (to bound the lookbehind).
let maxMoveWords = 1
for (const m2 of r.moves) { if (m2.name) maxMoveWords = Math.max(maxMoveWords, m2.name.trim().split(/\s+/).length) }

const sentences = text.split(/(?<=[.!?])\s+/)
let runningSubject: string | null = null // last species that started/led a sentence
for (const sent of sentences) {
  const mons: { name: string; idx: number }[] = []
  const monRe = /([A-Z][A-Za-z'.♀♂-]+)/g
  let mm: RegExpExecArray | null
  while ((mm = monRe.exec(sent))) { if (knownMon(mm[1])) mons.push({ name: mm[1], idx: mm.index }) }
  if (mons.length) runningSubject = mons[0].name

  // find each "<words> at Lv NN"
  const atRe = /\bat\s+Lv\s*(\d+)/g
  let a: RegExpExecArray | null
  while ((a = atRe.exec(sent))) {
    const lv = parseInt(a[1], 10)
    // grab up to maxMoveWords capitalized-ish words immediately before "at Lv"
    const pre = sent.slice(0, a.index).trimEnd()
    const tail = pre.split(/\s+/).slice(-maxMoveWords)
    // try longest suffix that is a real move
    let moveName: string | null = null
    for (let k = 0; k < tail.length; k++) {
      const cand = tail.slice(k).join(' ')
      if (wordsUpper.has(norm(cand))) { moveName = cand; break }
    }
    if (!moveName) continue
    // owner: nearest species before this move mention, else running subject
    const before = mons.filter((x) => x.idx < a!.index)
    const owner = before.length ? before[before.length - 1].name : runningSubject
    if (!owner) continue
    const ownerId = spByName.get(norm(owner))!
    const claim = `${owner}: ${moveName} @ Lv ${lv}`
    const levels = learnFor(ownerId).get(norm(moveName))
    // The guide often names a base mon but describes the whole family's moves, so
    // accept the level if the owner OR any pre-evo/evo in its line learns it then.
    const family = new Set<number>([ownerId])
    allEvos[ownerId].forEach((e) => family.add(e.target))
    allEvos.forEach((evos, sid) => { if (evos.some((e) => e.target === ownerId)) family.add(sid) })
    let matched = false, romLevels: number[] = []
    for (const fid of family) {
      const ls = learnFor(fid).get(norm(moveName))
      if (ls) { romLevels = ls; if (ls.includes(lv)) { matched = true; break } }
    }
    if (matched) results.push({ kind: 'move-lv', claim, status: 'PASS' })
    else if (romLevels.length) results.push({ kind: 'move-lv', claim, status: 'FAIL', detail: `ROM (family): ${moveName} at Lv ${romLevels.join('/')}, not ${lv}` })
    else if (!levels) results.push({ kind: 'move-lv', claim, status: 'FAIL', detail: `${owner}'s line never learns ${moveName} by level-up` })
  }
}

// ── report ──
const by = (k: string) => results.filter((x) => x.kind === k)
const tally = (rs: Result[]) => `${rs.filter((x) => x.status === 'PASS').length} pass / ${rs.filter((x) => x.status === 'FAIL').length} FAIL / ${rs.filter((x) => x.status === 'SKIP').length} skip`
console.log(`ROM: ${romPath.split(/[\\/]/).pop()} (${r.rom.gameCode()})\n`)
console.log(`Evolution-level claims:  ${tally(by('evo-lv'))}`)
console.log(`Evolution-target claims: ${tally(by('evo-target'))}`)
console.log(`Move-milestone claims:   ${tally(by('move-lv'))}`)
const fails = results.filter((x) => x.status === 'FAIL')
console.log(`\n── ${fails.length} FAILURES ──`)
for (const f of fails) console.log(`  ✗ [${f.kind}] ${f.claim}  —  ${f.detail}`)
if (!fails.length) console.log('  (none — every extracted claim matches the ROM ✅)')
