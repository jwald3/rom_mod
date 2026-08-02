/**
 * Generate the in-game Trades section from scripts/trades-data.json — the real
 * `gIngameTrades` table read out of the ROM (see gen-trades-data.mts), not the
 * canonical HG/SS list the section used before the table was located.
 *
 * The section splits into two groups:
 *   • trades whose NPC sits on a live Johto/Kanto map (`live: true`)
 *   • records that exist in the table but nothing in this build triggers, either
 *     because no script sets their index or because the only script that does
 *     lives on a leftover Hoenn map
 *
 * Sprites are reused from the guide where present (same harvest as the Pokédex).
 *
 *   npx tsx scripts/gen-trades-html.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

interface TradeRow {
  index: number
  give: string
  get: string
  nickname: string
  otName: string
  heldItem: string | null
  ivs: number[]
  location: string | null
  npcMap: string | null
  reachable: boolean
  live: boolean
}

const here = dirname(fileURLToPath(import.meta.url))
const trades: TradeRow[] = JSON.parse(readFileSync(resolve(here, 'trades-data.json'), 'utf8'))
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

// Wild availability of the received species, so each card can say what the
// trade actually saves you — the Pokédex dataset is the same ROM extraction.
interface DexRow {
  name: string
  wild: { zone: string; methods: string[] }[]
}
const dex: DexRow[] = JSON.parse(readFileSync(resolve(here, 'pokedex-data.json'), 'utf8'))
const wildZones = new Map(dex.map((d) => [d.name.toUpperCase(), d.wild.map((w) => w.zone)]))

/** Where else you could get the received species, phrased for the card. */
function alternative(name: string): string {
  const zones = wildZones.get(name.toUpperCase()) ?? []
  if (zones.length === 0) return `No wild ${esc(name)} exists in this build, so the trade is the only way to own one.`
  const title = (z: string) => z.toLowerCase().replace(/(^|[\s.'’-])([a-z])/g, (_, p, c) => p + c.toUpperCase())
  const shown = zones.slice(0, 3).map(title)
  const more = zones.length > shown.length ? `, and ${zones.length - shown.length} more` : ''
  return `Otherwise you'd have to catch one in ${shown.join(', ')}${more}.`
}

/** One line of advice per trade, keyed on what the record actually contains. */
function note(t: TradeRow): string {
  const held = t.heldItem ? `, holding a <strong>${esc(t.heldItem)}</strong>` : ''
  if (!t.reachable) {
    return `Authored in the trade table but nothing in this build asks for it — the original trainer (<em>${esc(t.otName)}</em>) reads like a planned partner that never got wired up.`
  }
  if (!t.live) {
    return `The only script that triggers this trade sits on a leftover Hoenn map (${esc(t.npcMap ?? '')}) carried over from the Emerald base, so you can't reach the partner in a normal run.`
  }
  return `Give a ${esc(t.give)}, get “${esc(t.nickname)}” the ${esc(t.get)}${held}. ${alternative(t.get)}`
}

function card(t: TradeRow): string {
  const held = t.heldItem ? `<span class="tr-held">holds ${esc(t.heldItem)}</span>` : ''
  const nick = `<span class="tr-nick">“${esc(t.nickname)}”</span>`
  const ot = `<span class="tr-ot">OT ${esc(t.otName)}</span>`
  const loc = t.live ? esc(t.location ?? '') : t.reachable ? 'Unreachable map' : 'No partner in this build'
  const locClass = t.live ? 'tr-loc' : 'tr-loc tr-loc-dim'
  return `<article class="tr-card${t.live ? '' : ' tr-card-dim'}">
<div class="${locClass}"><span class="tr-loc-dot"></span>${loc}</div>
<div class="tr-swap">
${mon(t.give, 'give')}
<div class="tr-arrow"><span class="tr-arrow-give">give</span><span class="tr-arrow-ico">⇄</span><span class="tr-arrow-get">get</span></div>
${mon(t.get, 'get')}
</div>
<div class="tr-meta">${nick}${ot}${held}</div>
<p class="tr-note">${note(t)}</p>
</article>`
}

const live = trades.filter((t) => t.live)
const dormant = trades.filter((t) => !t.live)

const section = `  <section id="trades" class="chapter">
    <div class="chapter-head"><span class="ch-mark">§T</span><h2>In-Game Trades</h2></div>
    <p class="lead">Hand a trade partner the Pokémon they ask for and you walk away with something rarer, already holding an item, and carrying <strong>flawless 31 IVs in every stat</strong> — the best-statted Pokémon you can get without breeding. Traded Pokémon also earn bonus experience and obey past your badge cap. This build's trade table holds ${trades.length} records; <strong>${live.length}</strong> of them have a partner standing on a map you'll actually visit.</p>
    <div class="callout fact"><div class="c-label"><span class="c-ico">◆</span>Read from the ROM</div><p>These entries come straight out of this build's <code>gIngameTrades</code> table — nickname, original trainer, held item, IVs, and the species asked for and given. The town comes from the NPC script that triggers each trade, so the ${live.length} live entries below are the ones a script actually hooks up on a Johto or Kanto map.</p></div>
    <div class="tr-grid">
${live.map(card).join('\n')}
    </div>
    <h3 class="sub-head">In the Table, Not in the World</h3>
    <p>The other ${dormant.length} records are fully authored — species, nickname, original trainer, held item — but nothing in the current build lets you reach them. Two are triggered only by NPCs left over from the Emerald base; the rest have no script that names their index at all. The original-trainer names on the unwired set (Surge, Steven, Brock, Jasmine) read like a planned second wave.</p>
    <div class="tr-grid">
${dormant.map(card).join('\n')}
    </div>
  </section>`

const css = `
/* ── In-game Trades ── */
.tr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;margin-top:20px}
.tr-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:15px 16px;box-shadow:var(--shadow)}
.tr-card-dim{opacity:.72;box-shadow:none;border-style:dashed}
.tr-loc{font-family:var(--sans);font-size:12px;font-weight:800;letter-spacing:.02em;color:var(--gold-deep);
  text-transform:uppercase;letter-spacing:.08em;display:flex;align-items:center;gap:8px;margin-bottom:12px}
.tr-loc-dim{color:var(--faint)}
.tr-loc-dot{width:9px;height:9px;flex:none;border-radius:2px;transform:rotate(45deg);background:var(--gold);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--gold) 20%,transparent)}
.tr-loc-dim .tr-loc-dot{background:var(--faint);box-shadow:none}
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
.tr-ot{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.tr-held{font-family:var(--sans);font-size:10.5px;font-weight:700;color:var(--ember);
  background:color-mix(in srgb,var(--ember) 10%,var(--panel-2));border:1px solid color-mix(in srgb,var(--ember) 30%,var(--line));
  border-radius:100px;padding:2px 9px}
.tr-note{font-family:var(--sans);font-size:12.5px;color:var(--muted);line-height:1.55;margin:0;max-width:none}
`

writeFileSync(resolve(here, 'trades-section.html'), section)
writeFileSync(resolve(here, 'trades-styles.css'), css)
const withSprite = trades.filter((t) => spriteFor(t.give) && spriteFor(t.get)).length
console.log(`wrote trades-section.html (${live.length} live + ${dormant.length} dormant) + trades-styles.css`)
console.log(`  both sprites reused: ${withSprite}/${trades.length}`)
