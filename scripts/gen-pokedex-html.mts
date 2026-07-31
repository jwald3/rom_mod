/**
 * Generate the Pokédex reference section HTML from scripts/pokedex-data.json,
 * reusing sprites already embedded in heart-and-soul-guide.html where available.
 * Writes scripts/pokedex-section.html (the <section> to splice into the guide)
 * and scripts/pokedex-styles.css (the CSS to add to the guide's <style>).
 *
 *   npx tsx scripts/gen-pokedex-html.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const data: any[] = JSON.parse(readFileSync(resolve(here, 'pokedex-data.json'), 'utf8'))
const guide = readFileSync(resolve(here, '..', 'heart-and-soul-guide.html'), 'utf8')

// type → color (from the guide + the missing ones filled in the same palette)
const TC: Record<string, string> = {
  NORMAL: '#9099a1', FIGHT: '#c0392b', FLYING: '#8aa6d6', POISON: '#9b59b6',
  GROUND: '#d0a44a', ROCK: '#b09150', BUG: '#8aa93a', GHOST: '#6a5a9e',
  STEEL: '#8fa3b0', FIRE: '#e6602f', WATER: '#3d8bd4', GRASS: '#4a9d52',
  ELECTR: '#e0b62c', PSYCHC: '#e05a8a', ICE: '#5fc4c9', DRAGON: '#5c53c9',
  DARK: '#5a5250', FAIRY: '#e08ab0', '???': '#8a8a8a',
}
const tc = (t: string) => TC[t] ?? '#8a8a8a'

// sprites: harvest data:image URIs from the guide by alt name
const sprites = new Map<string, string>()
for (const m of guide.matchAll(/<img[^>]*?src="(data:image\/png;base64,[^"]+)"[^>]*?alt="([^"]+)"/g)) {
  const key = m[2].toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!sprites.has(key)) sprites.set(key, m[1])
}
const spriteFor = (name: string) => sprites.get(name.toUpperCase().replace(/[^A-Z0-9]/g, '')) ?? null

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const tcase = (s: string) => s.toLowerCase().replace(/(^|[ '’.-])([a-z])/g, (_, a, b) => a + b.toUpperCase())
const typeLabel = (t: string) => ({ FIGHT: 'Fighting', PSYCHC: 'Psychic', ELECTR: 'Electric' } as Record<string, string>)[t] ?? tcase(t)

const STAT_LABELS: [keyof any, string][] = [['hp', 'HP'], ['atk', 'Atk'], ['def', 'Def'], ['spa', 'SpA'], ['spd', 'SpD'], ['spe', 'Spe']]

function typeChips(types: string[]): string {
  return types.map((t) => `<span class="dx-type" style="--tc:${tc(t)}">${esc(typeLabel(t))}</span>`).join('')
}

function statBars(st: any): string {
  const rows = STAT_LABELS.map(([k, lbl]) => {
    const v = st[k] as number
    const pct = Math.min(100, Math.round((v / 200) * 100))
    // color: red (low) → gold → green (high)
    const hue = v < 60 ? 'low' : v < 90 ? 'mid' : v < 120 ? 'high' : 'top'
    return `<div class="dx-stat"><span class="dx-stat-l">${lbl}</span><span class="dx-stat-n">${v}</span><span class="dx-bar"><i class="dx-fill dx-${hue}" style="width:${pct}%"></i></span></div>`
  }).join('')
  return `<div class="dx-stats">${rows}<div class="dx-bst">BST <b>${st.bst}</b></div></div>`
}

function evoLine(mon: any): string {
  const parts: string[] = []
  if (mon.evolvesFrom.length) parts.push(`<span class="dx-evo-from">from ${mon.evolvesFrom.map((f: string) => tcase(f)).join(' / ')}</span>`)
  if (mon.evolves.length) {
    parts.push(mon.evolves.map((e: any) => `<span class="dx-evo-to"><b>${tcase(e.to)}</b> <em>${esc(e.how)}</em></span>`).join(''))
  }
  if (!parts.length) return `<div class="dx-evo dx-evo-none">Does not evolve</div>`
  return `<div class="dx-evo">${parts.join('')}</div>`
}

function learnTable(ls: any[]): string {
  if (!ls.length) return ''
  const cells = ls.map((e) => `<tr><td class="dx-lv">${e.lv}</td><td>${tcase(e.move)}</td></tr>`).join('')
  return `<details class="dx-learn"><summary>Level-up moves (${ls.length})</summary><div class="dx-learn-wrap"><table><tbody>${cells}</tbody></table></div></details>`
}

function locations(mon: any): string {
  const bits: string[] = []
  if (mon.wild.length) {
    const list = mon.wild.map((w: any) => `${tcase(w.zone)} <span class="dx-loc-m">(${w.methods.join(', ')})</span>`).join(' · ')
    bits.push(`<div class="dx-loc"><span class="dx-loc-tag">Found</span>${list}</div>`)
  } else if (mon.evolvesFrom.length) {
    bits.push(`<div class="dx-loc"><span class="dx-loc-tag">Obtain</span>Evolve ${mon.evolvesFrom.map((f: string) => tcase(f)).join(' / ')}</div>`)
  } else {
    bits.push(`<div class="dx-loc"><span class="dx-loc-tag">Obtain</span>Gift, event, or trade (not a wild spawn)</div>`)
  }
  if (mon.heldItems.length) bits.push(`<div class="dx-loc"><span class="dx-loc-tag">Wild item</span>${mon.heldItems.map((i: string) => tcase(i)).join(', ')}</div>`)
  return bits.join('')
}

function card(mon: any): string {
  const spr = spriteFor(mon.name)
  const img = spr
    ? `<img class="dx-sprite" src="${spr}" alt="${esc(tcase(mon.name))}" loading="lazy" width="64" height="64">`
    : `<div class="dx-sprite dx-noimg" style="--tc:${tc(mon.types[0])}">${esc(tcase(mon.name).slice(0, 3))}</div>`
  const num = String(mon.id).padStart(3, '0')
  return `<article class="dx-card" id="dex-${mon.id}">
<div class="dx-head">${img}<div class="dx-id"><span class="dx-num">#${num}</span><h4 class="dx-name">${esc(tcase(mon.name))}</h4><div class="dx-types">${typeChips(mon.types)}</div></div></div>
<div class="dx-abil"><span class="dx-loc-tag">Ability</span>${mon.abilities.map((a: string) => tcase(a)).join(' / ') || '—'}</div>
${statBars(mon.stats)}
${evoLine(mon)}
${locations(mon)}
${learnTable(mon.learnset)}
</article>`
}

// Sort by dex id (national order as stored). Group into a simple grid.
const cards = data.slice().sort((a, b) => a.id - b.id).map(card).join('\n')
const section = `  <section id="pokedex" class="chapter">
    <div class="chapter-head"><span class="ch-mark">§P</span><h2>Pokédex</h2></div>
    <p class="lead">Every Pokémon in this build — types, abilities, base stats, evolutions, level-up moves, and where to find each one. Pulled straight from the ROM; ${data.filter((d) => d.wild.length).length} of the ${data.length} have a wild spawn, the rest are gifts, evolutions, or events.</p>
    <div class="dex-grid">
${cards}
    </div>
  </section>`

const css = `
/* ── Pokédex ── */
.dex-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-top:20px}
.dx-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 15px;box-shadow:var(--shadow);scroll-margin-top:70px}
.dx-head{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.dx-sprite{width:60px;height:60px;flex:none;image-rendering:pixelated;filter:drop-shadow(0 2px 3px rgba(0,0,0,.22))}
.dx-noimg{display:flex;align-items:center;justify-content:center;border-radius:9px;background:color-mix(in srgb,var(--tc) 18%,var(--panel-2));border:1px solid color-mix(in srgb,var(--tc) 40%,var(--line));font-family:var(--sans);font-weight:800;font-size:15px;color:color-mix(in srgb,var(--tc) 60%,var(--text));text-transform:uppercase;letter-spacing:.02em;filter:none}
.dx-id{min-width:0}
.dx-num{font-family:var(--mono);font-size:11px;color:var(--faint);font-variant-numeric:tabular-nums}
.dx-name{font-family:var(--serif);font-size:18px;font-weight:800;margin:1px 0 5px;letter-spacing:-.01em}
.dx-types{display:flex;gap:5px;flex-wrap:wrap}
.dx-type{font-family:var(--sans);font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--tc);padding:2px 8px;border-radius:100px;line-height:1.4;box-shadow:inset 0 -1px 0 rgba(0,0,0,.18)}
.dx-abil{font-family:var(--sans);font-size:12.5px;color:var(--text);margin-bottom:10px}
.dx-loc-tag{font-family:var(--mono);font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-deep);margin-right:7px}
.dx-stats{display:flex;flex-direction:column;gap:3px;margin-bottom:10px}
.dx-stat{display:grid;grid-template-columns:30px 26px 1fr;align-items:center;gap:7px}
.dx-stat-l{font-family:var(--mono);font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}
.dx-stat-n{font-family:var(--mono);font-size:12px;font-weight:600;color:var(--text);text-align:right;font-variant-numeric:tabular-nums}
.dx-bar{height:6px;border-radius:100px;background:var(--panel-2);overflow:hidden}
.dx-fill{display:block;height:100%;border-radius:100px}
.dx-low{background:var(--ember)}.dx-mid{background:var(--gold)}.dx-high{background:#7bb04a}.dx-top{background:var(--good)}
.dx-bst{font-family:var(--mono);font-size:11px;color:var(--muted);text-align:right;margin-top:2px}
.dx-bst b{color:var(--text);font-variant-numeric:tabular-nums}
.dx-evo{font-family:var(--sans);font-size:12.5px;color:var(--muted);margin-bottom:9px;display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
.dx-evo-none{font-style:italic;color:var(--faint)}
.dx-evo-from{color:var(--faint)}
.dx-evo-to b{color:var(--text)}.dx-evo-to em{color:var(--gold-deep);font-style:normal;font-family:var(--mono);font-size:10.5px}
.dx-loc{font-family:var(--sans);font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:5px}
.dx-loc-m{color:var(--faint);font-size:11px}
.dx-learn{margin-top:8px;border-top:1px solid var(--line);padding-top:8px}
.dx-learn summary{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--gold-deep);cursor:pointer;font-weight:700}
.dx-learn-wrap{margin-top:8px;max-height:220px;overflow-y:auto}
.dx-learn table{width:100%;border-collapse:collapse;font-size:12.5px;font-family:var(--sans)}
.dx-learn td{padding:3px 8px 3px 0;border-top:1px solid var(--line);color:var(--text)}
.dx-learn tr:first-child td{border-top:0}
.dx-learn .dx-lv{font-family:var(--mono);font-size:11px;color:var(--gold-deep);width:34px;font-variant-numeric:tabular-nums}
`

writeFileSync(resolve(here, 'pokedex-section.html'), section)
writeFileSync(resolve(here, 'pokedex-styles.css'), css)
console.log(`wrote pokedex-section.html (${(section.length / 1024).toFixed(0)}KB, ${data.length} cards) + pokedex-styles.css`)
console.log(`  sprites reused: ${data.filter((d) => spriteFor(d.name)).length}/${data.length}`)
