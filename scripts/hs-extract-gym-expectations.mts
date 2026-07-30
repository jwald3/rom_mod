/**
 * Regenerate scripts/hs-gym-expectations.json — the gym/E4/Red rosters the
 * guide claims — by parsing heart-and-soul-guide.html. Run this whenever the
 * guide's boss cards change, then re-run hs-verify-gyms.mts against the ROM.
 *
 *   npx tsx scripts/hs-extract-gym-expectations.mts
 *
 * Each boss card is <h3 class="boss-name">NAME[…type]</h3> followed by a
 * .party of .mon cards; every .mon carries a name, level, optional @held item,
 * and a .moves list. Party sizes are the first-encounter teams as drawn (e.g.
 * Falkner 2) — the verifier disambiguates rematch trainers by best-fit.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const guidePath = resolve(here, '..', 'heart-and-soul-guide.html')
const outPath = resolve(here, 'hs-gym-expectations.json')

const WANTED = new Set([
  'Falkner', 'Bugsy', 'Whitney', 'Morty', 'Chuck', 'Jasmine', 'Pryce', 'Clair',
  'Brock', 'Misty', 'Ltsurge', 'Erika', 'Janine', 'Sabrina', 'Blaine', 'Blue',
  'Will', 'Koga', 'Bruno', 'Karen', 'Lance', 'Red',
])

const h = readFileSync(guidePath, 'utf8')

// Boss headings, with the trailing inline type span (present on gym leaders,
// absent on E4/Red) made optional.
const nameRe = /<h3 class="boss-name">([^<]+?)(?:\s*<span class="type"[^>]*>[^<]*<\/span>)?<\/h3>/g
const heads = [...h.matchAll(nameRe)]

interface ExpectedMon { name: string; level: number; held: string | null; moves: string[] }
interface ExpectedRoster { leader: string; party: ExpectedMon[] }

const out: ExpectedRoster[] = []
for (let i = 0; i < heads.length; i++) {
  const leader = heads[i][1].trim()
  if (!WANTED.has(leader)) continue
  const start = heads[i].index!
  const end = i + 1 < heads.length ? heads[i + 1].index! : h.length
  const seg = h.slice(start, end)

  const cardRe =
    /<span class="mon-name">([^<]+)<\/span><span class="lvl">([^<]+)<\/span>[\s\S]*?(?:<div class="held">@ ([^<]+)<\/div>)?<div class="moves">([\s\S]*?)<\/div>/g
  const party: ExpectedMon[] = [...seg.matchAll(cardRe)].map((cm) => ({
    name: cm[1].trim(),
    level: parseInt(cm[2].replace(/[^0-9]/g, ''), 10),
    held: (cm[3] || '').trim() || null,
    moves: [...cm[4].matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1].trim()),
  }))
  out.push({ leader, party })
}

writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')
console.log(
  `wrote ${out.length} rosters → ${outPath}\n  ` +
    out.map((o) => `${o.leader}(${o.party.length})`).join(', '),
)
