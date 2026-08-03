/**
 * Cross-check each zone's PROSE (not its encounter table) against the ROM's
 * actual encounters for that zone. The encounter tables are already verified by
 * verify-guide-encounters.mts; this catches the *narrative* drifting from the
 * data — e.g. prose claiming "a wild Tropius" in a zone whose grass has none.
 *
 * For every zone we:
 *   1. collect the species the ROM actually spawns there (grass/surf/fish/tree),
 *      unioned across banks + time-of-day variants,
 *   2. scan the zone's prose (<p> blocks) and featured <figcaption> for any
 *      species name from the ROM's full species list,
 *   3. flag a prose species as SUSPECT if it's presented as a wild catch in
 *      THIS zone but the ROM never spawns it here.
 *
 * Not every prose mention is an encounter claim (evolutions, counters, gift
 * mons, cross-zone references), so this reports candidates to eyeball, not hard
 * failures. The featured sprite IS an encounter claim, so those are flagged hard.
 *
 *   npx tsx scripts/verify-guide-prose.mts "<rom.gba>" [toml]
 */
import { readFileSync } from 'node:fs'
import { loadRom } from '../src/rom/loadRom'

const romPath = process.argv[2]
if (!romPath) { console.error('usage: npx tsx scripts/verify-guide-prose.mts "<rom.gba>" [toml]'); process.exit(2) }
const toml = process.argv[3] ? readFileSync(process.argv[3], 'utf8') : undefined
const r = loadRom(new Uint8Array(readFileSync(romPath)), romPath.split(/[\\/]/).pop()!, toml)
const sp = (id: number) => r.species[id]?.name ?? `#${id}`
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

// Full set of real species names (for prose scanning), + a display map.
const allSpecies = new Map<string, string>() // norm -> pretty (title case)
const title = (s: string) => s.toLowerCase().replace(/(^|[ '’.-])([a-z])/g, (_, a, b) => a + b.toUpperCase())
for (const s of r.species) {
  if (s?.name && !/^\?+$/.test(s.name) && s.name !== 'UNUSED') allSpecies.set(norm(s.name), title(s.name))
}

// ── ROM encounters per zone (norm name -> Set of norm species) ──
const romByZone = new Map<string, Set<string>>()
for (const a of r.wildAreas) {
  const key = norm(a.name)
  if (!romByZone.has(key)) romByZone.set(key, new Set())
  const set = romByZone.get(key)!
  for (const k of ['grass', 'surf', 'fish', 'tree'] as const) {
    const g = (a.groups as any)[k]; if (!g) continue
    for (const s of g.slots) if (s.species > 0) set.add(norm(sp(s.species)))
  }
}
// Combined-name zones ("Route 24 / 25", "Route 2 / Viridian Forest") union parts.
function romFor(zoneName: string): Set<string> | null {
  const direct = romByZone.get(norm(zoneName))
  if (direct) return direct
  const parts = zoneName.split('/').map((p) => p.trim())
  if (parts.length < 2) return null
  const base = (parts[0].match(/^(.*?)(\d+|[A-Za-z].*)$/) || [])[1] ?? ''
  const expanded = parts.map((p) => (/^\d+$/.test(p) ? base + p : p))
  const merged = new Set<string>()
  let any = false
  for (const p of expanded) { const s = romByZone.get(norm(p)); if (s) { any = true; s.forEach((v) => merged.add(v)) } }
  return any ? merged : null
}

// ── Walk each zone article: prose <p> + featured caption ──
const html = readFileSync('heart-and-soul-guide.html', 'utf8')
const zoneRe = /<h4 class="zone-name">([^<]+)<\/h4>([\s\S]*?)<\/aside>/g

// A species mention "reads as a wild-catch claim here" if the surrounding words
// suggest catching/spawning rather than evolution/counter/gift. We keep it simple:
// flag species that appear near catch verbs AND aren't a ROM encounter here.
const CATCH_CUES = /(wild|grass|catch|caught|spawns?|appears?|grazes?|found here|prowls?|lurks?|patrols?|roams?|swims?|fills? the|in the grass|in the water|hides?)/i

let zm: RegExpExecArray | null
let flagged = 0
let zonesChecked = 0
const report: string[] = []
while ((zm = zoneRe.exec(html))) {
  const zoneName = zm[1].trim()
  const body = zm[2]
  const rom = romFor(zoneName)
  if (!rom) continue // unmatched zone; encounter checker already reports these
  zonesChecked++

  // Featured caption species (hard claim — the sprite says "you'll find this here")
  const feat = body.match(/feat-tag">Featured<\/span>([^<]+)<\/figcaption>/)
  const featSpecies = feat ? norm(feat[1]) : null
  if (featSpecies && allSpecies.has(featSpecies) && !rom.has(featSpecies)) {
    report.push(`  ❌ ${zoneName}: FEATURED “${title(feat![1])}” is not in this zone's encounters`)
    flagged++
  }

  // Prose paragraphs
  const proseParas = [...body.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1])
  const suspects = new Set<string>()
  for (const para of proseParas) {
    const plain = para.replace(/<[^>]+>/g, ' ').replace(/&#39;|’/g, "'").replace(/&amp;/g, '&')
    // Only scan sentences that look like encounter claims.
    for (const sentence of plain.split(/(?<=[.!?])\s+/)) {
      if (!CATCH_CUES.test(sentence)) continue
      // Find species names present in the sentence.
      for (const [n, pretty] of allSpecies) {
        // word-ish boundary match on the pretty name
        const re = new RegExp(`\\b${pretty.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
        if (re.test(sentence) && !rom.has(n)) suspects.add(pretty)
      }
    }
  }
  if (suspects.size) {
    report.push(`  ⚠ ${zoneName}: prose names ${[...suspects].join(', ')} in a catch context, but the ROM doesn't spawn ${suspects.size === 1 ? 'it' : 'them'} here`)
    flagged += suspects.size
  }
}

console.log(`Prose vs ROM encounters — ${zonesChecked} zones scanned\n`)
if (report.length) {
  console.log(report.join('\n'))
  console.log(`\n${flagged} suspect mention(s). ❌ = featured sprite (hard); ⚠ = prose (verify by hand — may be an evolution/counter/gift reference).`)
} else {
  console.log('  no suspect prose encounter claims found ✅')
}
