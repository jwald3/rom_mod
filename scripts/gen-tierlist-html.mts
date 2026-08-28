/**
 * Generate the guide's "Tier List" chapter from scripts/tierlist-data.json
 * (see gen-tierlist-data.mts). Writes scripts/tierlist-section.html + tierlist-
 * styles.css, which splice-tierlist.mjs inserts after the Pokédex.
 *
 * Sprites are reused from the guide by species name, same as the Pokédex.
 *
 *   npx tsx scripts/gen-tierlist-html.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

interface Entry {
  id: number
  name: string
  types: string[]
  ability: string
  moves: string[]
  win: number
  viability: number
}
interface Data {
  rom: string
  level: number
  sims: number
  seed: number
  cohort: string[]
  meanWin: number
  entries: Entry[]
}

const here = dirname(fileURLToPath(import.meta.url))
const d: Data = JSON.parse(readFileSync(resolve(here, 'tierlist-data.json'), 'utf8'))
const guide = readFileSync(resolve(here, '..', 'heart-and-soul-guide.html'), 'utf8')

// type → color (same palette as the Pokédex chapter)
const TC: Record<string, string> = {
  NORMAL: '#9099a1', FIGHT: '#c0392b', FLYING: '#8aa6d6', POISON: '#9b59b6',
  GROUND: '#d0a44a', ROCK: '#b09150', BUG: '#8aa93a', GHOST: '#6a5a9e',
  STEEL: '#8fa3b0', FIRE: '#e6602f', WATER: '#3d8bd4', GRASS: '#4a9d52',
  ELECTR: '#e0b62c', PSYCHC: '#e05a8a', ICE: '#5fc4c9', DRAGON: '#5c53c9',
  DARK: '#5a5250', FAIRY: '#e08ab0', '???': '#8a8a8a',
}
const tc = (t: string) => TC[t] ?? '#8a8a8a'

const sprites = new Map<string, string>()
for (const m of guide.matchAll(/<img[^>]*?src="(data:image\/png;base64,[^"]+)"[^>]*?alt="([^"]+)"/g)) {
  const key = m[2].toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!sprites.has(key)) sprites.set(key, m[1])
}
const spriteFor = (name: string) => sprites.get(name.toUpperCase().replace(/[^A-Z0-9]/g, '')) ?? null

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const tcase = (s: string) => s.toLowerCase().replace(/(^|[ '’.-])([a-z])/g, (_, a, b) => a + b.toUpperCase())
const typeLabel = (t: string) => ({ FIGHT: 'Fighting', PSYCHC: 'Psychic', ELECTR: 'Electric' } as Record<string, string>)[t] ?? tcase(t)

// ── tiers by win-rate band ──
interface Tier { key: string; label: string; min: number; blurb: string; color: string }
const TIERS: Tier[] = [
  { key: 'S', label: 'S', min: 58, color: '#e05a8a', blurb: 'Carries a run. Sweeps the gauntlet — legendaries and the best sleepers/attackers.' },
  { key: 'A', label: 'A', min: 50, color: '#e6602f', blurb: 'Strong picks. A solid backbone for any team.' },
  { key: 'B', label: 'B', min: 42, color: '#e0b62c', blurb: 'Serviceable. Pulls its weight with the right coverage.' },
  { key: 'C', label: 'C', min: 32, color: '#4a9d52', blurb: 'Situational. Fine early, fades against the back half.' },
  { key: 'D', label: 'D', min: 22, color: '#3d8bd4', blurb: 'Struggles. Needs support to contribute.' },
  { key: 'F', label: 'F', min: 0, color: '#5a5250', blurb: 'Route filler and unevolved forms — little to offer a serious team.' },
]
const tierOf = (win: number) => TIERS.find((t) => win >= t.min)!

const num = (id: number) => `#${String(id).padStart(3, '0')}`

function chip(name: string, types: string[]): string {
  const spr = spriteFor(name)
  const img = spr
    ? `<img class="tl-spr" src="${spr}" alt="${esc(tcase(name))}" loading="lazy" width="40" height="40">`
    : `<span class="tl-spr tl-noimg" style="--tc:${tc(types[0])}">${esc(tcase(name).slice(0, 3))}</span>`
  const grad = types.length === 2
    ? `linear-gradient(135deg, ${tc(types[0])} 60%, ${tc(types[1])})`
    : tc(types[0])
  return `<span class="tl-chip" style="--edge:${grad}" title="${esc(tcase(name))} · ${types.map(typeLabel).join('/')}">${img}<span class="tl-cn">${esc(tcase(name))}</span></span>`
}

// ── tier rows (visual tier list) ──
const byTier = TIERS.map((t) => ({
  t,
  mons: d.entries.filter((e) => tierOf(e.win).key === t.key),
}))
const tierRows = byTier
  .map(({ t, mons }) => {
    if (!mons.length) return ''
    return `      <div class="tl-row">
        <div class="tl-badge" style="--tier:${t.color}"><span class="tl-letter">${t.label}</span><span class="tl-range">${t.min}%+</span></div>
        <div class="tl-body">
          <p class="tl-blurb">${esc(t.blurb)} <span class="tl-count">${mons.length}</span></p>
          <div class="tl-mons">${mons.map((e) => chip(e.name, e.types)).join('')}</div>
        </div>
      </div>`
  })
  .join('\n')

// ── full table (every mon, ranked) ──
const typeChips = (types: string[]) =>
  types.map((t) => `<span class="tl-type" style="--tc:${tc(t)}">${esc(typeLabel(t))}</span>`).join('')
const tableRows = d.entries
  .map((e, i) => {
    const t = tierOf(e.win)
    return `<tr>
      <td class="tl-rank">${i + 1}</td>
      <td class="tl-tcell"><span class="tl-tbadge" style="--tier:${t.color}">${t.key}</span></td>
      <td class="tl-win">${e.win}%</td>
      <td class="tl-dexno">${num(e.id)}</td>
      <td class="tl-name">${esc(tcase(e.name))}</td>
      <td class="tl-types">${typeChips(e.types)}</td>
      <td class="tl-moves">${esc(e.moves.map(tcase).join(', '))}</td>
    </tr>`
  })
  .join('\n')

const cohortList = d.cohort.join(', ')

const section = `  <section id="tierlist" class="chapter">
    <div class="chapter-head"><span class="ch-mark">§★</span><h2>Tier List</h2></div>
    <p class="lead">Every obtainable Pokémon ranked by how it actually performs — not by base stats, but by simulated battles against this build's real bosses. Each one is given its best level-up-plus-TM/tutor moveset and run through <strong>${d.sims} battles per opponent</strong> against all ${d.cohort.length} benchmark fights (${esc(cohortList)}) at their in-game levels. The number is its mean win rate across that gauntlet at <strong>Lv ${d.level}</strong>.</p>
    <div class="callout fact"><div class="c-label"><span class="c-ico">◆</span>How this was made</div><p>Produced by the repo's balance harness (<code>scripts/balance.mts</code>) driving the same Gen-3 damage engine the editor uses — seeded, so the ranking is reproducible from the ROM. It models damage, stats, status, crits, PP and Struggle, plus the abilities and items the bosses carry; it does <em>not</em> model weather, screens, switching or team synergy, so read a single-number ranking as a strong signal, not gospel. Mean win rate across the dex is <strong>${d.meanWin}%</strong> — think of that as the "average teammate" line.</p></div>

    <div class="tl-tiers">
${tierRows}
    </div>

    <h3 class="sub-head">Full ranking</h3>
    <p>All ${d.entries.length} ranked, best to worst. "Moveset" is what the harness picked for each — its level-up pool widened with every TM, HM and move tutor the species can legally use.</p>
    <div class="tl-tablewrap">
      <table class="tl-table">
        <thead><tr><th>#</th><th>Tier</th><th>Win</th><th>Dex</th><th>Pokémon</th><th>Type</th><th>Moveset</th></tr></thead>
        <tbody>
${tableRows}
        </tbody>
      </table>
    </div>
  </section>`

const css = `
/* ── Tier List ── */
.tl-tiers{display:flex;flex-direction:column;gap:10px;margin:18px 0 8px}
.tl-row{display:grid;grid-template-columns:64px 1fr;gap:12px;align-items:stretch;
  background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:var(--shadow)}
.tl-badge{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  background:color-mix(in srgb,var(--tier) 22%,var(--panel-2));border-right:1px solid var(--line)}
.tl-letter{font-family:var(--sans);font-weight:900;font-size:26px;line-height:1;color:var(--tier)}
.tl-range{font-family:var(--mono);font-size:9px;font-weight:700;color:var(--muted)}
.tl-body{padding:10px 12px;min-width:0}
.tl-blurb{font-family:var(--sans);font-size:12.5px;color:var(--muted);margin:0 0 8px;line-height:1.5}
.tl-count{display:inline-block;font-family:var(--mono);font-size:10px;font-weight:700;color:var(--text);
  background:var(--panel-2);border:1px solid var(--line);border-radius:100px;padding:1px 7px;margin-left:4px}
.tl-mons{display:flex;flex-wrap:wrap;gap:6px}
.tl-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 9px 2px 2px;border-radius:100px;
  background:var(--panel-2);border:1px solid var(--line);position:relative}
.tl-chip::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;border-radius:100px 0 0 100px;background:var(--edge)}
.tl-spr{width:30px;height:30px;flex:none;image-rendering:pixelated;filter:drop-shadow(0 1px 1px rgba(0,0,0,.25))}
.tl-noimg{display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--tc);
  color:#fff;font-family:var(--sans);font-weight:800;font-size:9px;text-transform:uppercase}
.tl-cn{font-family:var(--sans);font-weight:700;font-size:12px;color:var(--text);white-space:nowrap}
.tl-tablewrap{overflow-x:auto;margin-top:12px;border:1px solid var(--line);border-radius:12px}
.tl-table{border-collapse:collapse;width:100%;font-family:var(--sans);font-size:12.5px;min-width:640px}
.tl-table thead th{position:sticky;top:0;background:var(--panel-2);text-align:left;padding:8px 10px;
  font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line)}
.tl-table td{padding:6px 10px;border-bottom:1px solid color-mix(in srgb,var(--line) 55%,transparent);vertical-align:middle}
.tl-table tbody tr:last-child td{border-bottom:none}
.tl-rank{font-family:var(--mono);color:var(--muted);font-size:11px}
.tl-tbadge{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;
  font-family:var(--sans);font-weight:900;font-size:11px;color:#fff;background:var(--tier)}
.tl-win{font-family:var(--mono);font-weight:700;color:var(--text)}
.tl-dexno{font-family:var(--mono);color:var(--muted);font-size:11px}
.tl-name{font-weight:700;color:var(--text);white-space:nowrap}
.tl-types{white-space:nowrap}
.tl-type{display:inline-block;font-family:var(--sans);font-size:9px;font-weight:800;letter-spacing:.04em;
  text-transform:uppercase;color:#fff;background:var(--tc);padding:1px 6px;border-radius:100px;margin-right:3px}
.tl-moves{color:var(--muted);font-size:11.5px;min-width:220px}
`

writeFileSync(resolve(here, 'tierlist-section.html'), section)
writeFileSync(resolve(here, 'tierlist-styles.css'), css)
const withSprite = d.entries.filter((e) => spriteFor(e.name)).length
console.log(`wrote tierlist-section.html + tierlist-styles.css`)
console.log(`  ${d.entries.length} mons · ${byTier.filter((b) => b.mons.length).map((b) => `${b.t.key}:${b.mons.length}`).join(' ')}`)
console.log(`  sprites reused: ${withSprite}/${d.entries.length}`)
