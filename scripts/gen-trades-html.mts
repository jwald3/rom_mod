/**
 * Generate the in-game Trades section from scripts/trades-canon.json.
 *
 * IMPORTANT: this list is the canonical HeartGold/SoulSilver in-game trade set,
 * NOT extracted from this ROM's trade table (that table couldn't be located in
 * the pokéemerald-expansion build). Every species/item in the list *is*
 * validated to exist in this ROM, and the section says plainly that the exact
 * partners should be confirmed in-game. Sprites are reused from the guide where
 * present (same harvest as the Pokédex).
 *
 *   npx tsx scripts/gen-trades-html.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const trades: any[] = JSON.parse(readFileSync(resolve(here, 'trades-canon.json'), 'utf8'))
const guide = readFileSync(resolve(here, '..', 'heart-and-soul-guide.html'), 'utf8')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// harvest sprites from the guide by alt name (same approach as the Pokédex)
const sprites = new Map<string, string>()
for (const m of guide.matchAll(/<img[^>]*?src="(data:image\/png;base64,[^"]+)"[^>]*?alt="([^"]+)"/g)) {
  const key = m[2].toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!sprites.has(key)) sprites.set(key, m[1])
}
const spriteFor = (name: string) => sprites.get(name.toUpperCase().replace(/[^A-Z0-9]/g, '')) ?? null

function mon(name: string, role: 'give' | 'get'): string {
  const spr = spriteFor(name)
  const img = spr
    ? `<img class="tr-sprite" src="${spr}" alt="${esc(name)}" loading="lazy" width="56" height="56">`
    : `<div class="tr-sprite tr-noimg">${esc(name.slice(0, 3))}</div>`
  return `<div class="tr-mon tr-${role}">${img}<span class="tr-mon-name">${esc(name)}</span></div>`
}

function card(t: any): string {
  const held = t.heldItem ? `<span class="tr-held">holds ${esc(t.heldItem)}</span>` : ''
  const nick = t.nickname ? `<span class="tr-nick">“${esc(t.nickname)}”</span>` : ''
  return `<article class="tr-card">
<div class="tr-loc"><span class="tr-loc-dot"></span>${esc(t.location)}</div>
<div class="tr-swap">
${mon(t.give, 'give')}
<div class="tr-arrow"><span class="tr-arrow-give">give</span><span class="tr-arrow-ico">⇄</span><span class="tr-arrow-get">get</span></div>
${mon(t.get, 'get')}
</div>
<div class="tr-meta">${nick}${held}</div>
<p class="tr-note">${esc(t.note)}</p>
</article>`
}

const cards = trades.map(card).join('\n')
const section = `  <section id="trades" class="chapter">
    <div class="chapter-head"><span class="ch-mark">§T</span><h2>In-Game Trades</h2></div>
    <p class="lead">The NPC trades scattered across the region — hand over a common catch, walk away with something rarer, higher-levelled, or holding a prize. A traded Pokémon also gains bonus experience and obeys past the badge cap, so an early Onix or Machop can carry you for hours.</p>
    <div class="callout warn"><div class="c-label"><span class="c-ico">⚠</span>Canon list — confirm in-game</div><p>This ROM's trade table couldn't be read directly, so the entries below are the <strong>standard HeartGold/SoulSilver trades</strong> this hack is built on. Every Pokémon and item shown <strong>does exist in this build</strong>, but a given NPC's exact ask/offer may have been tweaked — treat the table as a guide and verify the partner when you reach each town.</p></div>
    <div class="tr-grid">
${cards}
    </div>
  </section>`

const css = `
/* ── In-game Trades ── */
.tr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;margin-top:20px}
.tr-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:15px 16px;box-shadow:var(--shadow)}
.tr-loc{font-family:var(--sans);font-size:12px;font-weight:800;letter-spacing:.02em;color:var(--gold-deep);
  text-transform:uppercase;letter-spacing:.08em;display:flex;align-items:center;gap:8px;margin-bottom:12px}
.tr-loc-dot{width:9px;height:9px;flex:none;border-radius:2px;transform:rotate(45deg);background:var(--gold);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--gold) 20%,transparent)}
.tr-swap{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin-bottom:10px}
.tr-mon{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;text-align:center;
  padding:10px 6px;border-radius:10px;background:var(--panel-2);border:1px solid var(--line)}
.tr-give{border-color:color-mix(in srgb,var(--ember) 30%,var(--line))}
.tr-get{border-color:color-mix(in srgb,var(--good) 34%,var(--line));
  background:color-mix(in srgb,var(--good) 7%,var(--panel-2))}
.tr-sprite{width:56px;height:56px;image-rendering:pixelated;filter:drop-shadow(0 2px 3px rgba(0,0,0,.22))}
.tr-noimg{display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--panel);
  border:1px solid var(--line);font-family:var(--sans);font-weight:800;font-size:14px;color:var(--muted);
  text-transform:uppercase;letter-spacing:.02em}
.tr-mon-name{font-family:var(--sans);font-weight:700;font-size:13px;letter-spacing:.01em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.tr-arrow{display:flex;flex-direction:column;align-items:center;gap:2px;flex:none;padding:0 2px}
.tr-arrow-ico{font-size:19px;line-height:1;color:var(--gold-deep)}
.tr-arrow-give{font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--ember-soft)}
.tr-arrow-get{font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--good)}
.tr-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px;min-height:1px}
.tr-nick{font-family:var(--serif);font-style:italic;font-size:12.5px;color:var(--muted)}
.tr-held{font-family:var(--sans);font-size:10.5px;font-weight:700;color:var(--ember);
  background:color-mix(in srgb,var(--ember) 10%,var(--panel-2));border:1px solid color-mix(in srgb,var(--ember) 30%,var(--line));
  border-radius:100px;padding:2px 9px}
.tr-note{font-family:var(--sans);font-size:12.5px;color:var(--muted);line-height:1.55;margin:0;max-width:none}
`

writeFileSync(resolve(here, 'trades-section.html'), section)
writeFileSync(resolve(here, 'trades-styles.css'), css)
const withSprite = trades.filter((t) => spriteFor(t.give) && spriteFor(t.get)).length
console.log(`wrote trades-section.html (${trades.length} trades) + trades-styles.css`)
console.log(`  both sprites reused: ${withSprite}/${trades.length}`)
