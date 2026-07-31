/**
 * Generate the Items reference section HTML from scripts/items-data.json,
 * matching the guide's design system. Writes scripts/items-section.html (the
 * <section> to splice in) and scripts/items-styles.css (CSS for the <style>).
 *
 *   npx tsx scripts/gen-items-html.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const data: any[] = JSON.parse(readFileSync(resolve(here, 'items-data.json'), 'utf8'))

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// item names are ALLCAPS in the ROM; title-case for display, but keep TM/HM ids upper
const tcase = (s: string) =>
  /^(TM|HM)\d/i.test(s)
    ? s.toUpperCase()
    : s.toLowerCase().replace(/(^|[ '’.\-/])([a-z])/g, (_, a, b) => a + b.toUpperCase())
        .replace(/\bPp\b/g, 'PP').replace(/\bHp\b/g, 'HP').replace(/\bGs\b/g, 'GS').replace(/\bExp\b/g, 'EXP')

// category → accent color (reuse the guide's palette family)
const CAT_COLOR: Record<string, string> = {
  'TMs & HMs': '#5c53c9',
  'Poké Balls': '#c0552f',
  'Medicine': '#3f7d47',
  'Vitamins & boosters': '#e05a8a',
  'Evolution & stones': '#b0862f',
  'Battle items': '#c0392b',
  'Field items': '#3d8bd4',
  'Held items & berries': '#8aa93a',
  'Mail': '#6f7885',
  'Valuables': '#d0a44a',
  'Other items': '#8a8a8a',
}
const catColor = (c: string) => CAT_COLOR[c] ?? '#8a8a8a'

// Order categories for the page.
const CAT_ORDER = [
  'Poké Balls', 'Medicine', 'Vitamins & boosters', 'Evolution & stones',
  'Held items & berries', 'Battle items', 'Field items', 'TMs & HMs',
  'Valuables', 'Mail', 'Other items',
]

// Shorten a shop descriptor to its leading category tag (before the "—"),
// falling back to a compact contents preview. The ROM has no town names.
function shortShop(desc: string): string {
  const dash = desc.indexOf('—')
  if (dash > 0) return desc.slice(0, dash).trim()
  // no category prefix: use first two item names
  const parts = desc.split(',').map((s) => s.trim())
  return parts.slice(0, 2).map(tcase).join(', ') + (parts.length > 2 ? ' …' : '')
}

function priceStr(p: number): string {
  if (!p) return 'Not for sale'
  return '₽' + p.toLocaleString('en-US')
}

function sourceLine(it: any): string {
  const bits: string[] = []
  if (it.shops.length) {
    // dedupe short labels
    const labels = [...new Set(it.shops.map(shortShop))]
    bits.push(`<div class="it-src"><span class="it-src-tag">Sold at</span>${labels.map((l: string) => `<span class="it-shop">${esc(l)}</span>`).join('')}</div>`)
  }
  if (it.heldBy.length) {
    const mons = it.heldBy.map((m: string) => tcase(m))
    bits.push(`<div class="it-src"><span class="it-src-tag">Held by</span>${mons.map((m: string) => `<span class="it-mon">${esc(m)}</span>`).join('')}</div>`)
  }
  if (it.tmMove) {
    bits.push(`<div class="it-src"><span class="it-src-tag">Teaches</span><span class="it-move">${esc(tcase(it.tmMove))}</span></div>`)
  }
  if (!bits.length) bits.push(`<div class="it-src it-src-none">Found in the field or as a gift</div>`)
  return bits.join('')
}

function card(it: any): string {
  const c = catColor(it.category)
  return `<article class="it-card" style="--ic:${c}">
<div class="it-head"><h4 class="it-name">${esc(tcase(it.name))}</h4><span class="it-price">${priceStr(it.price)}</span></div>
${sourceLine(it)}
</article>`
}

// group by category
const groups = new Map<string, any[]>()
for (const it of data) {
  if (!groups.has(it.category)) groups.set(it.category, [])
  groups.get(it.category)!.push(it)
}
const orderedCats = [...CAT_ORDER.filter((c) => groups.has(c)), ...[...groups.keys()].filter((c) => !CAT_ORDER.includes(c))]

const blocks = orderedCats.map((cat) => {
  const items = groups.get(cat)!.slice()
  // TMs by slot number; everything else alphabetical
  if (cat === 'TMs & HMs') items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  else items.sort((a, b) => tcase(a.name).localeCompare(tcase(b.name)))
  const cards = items.map(card).join('\n')
  const c = catColor(cat)
  return `<div class="it-group">
<h3 class="it-cat" style="--ic:${c}"><span class="it-cat-dot"></span>${esc(cat)} <span class="it-cat-n">${items.length}</span></h3>
<div class="it-grid">
${cards}
</div>
</div>`
}).join('\n')

const soldCount = data.filter((i) => i.shops.length).length
const heldCount = data.filter((i) => i.heldBy.length).length
const tmCount = data.filter((i) => i.tmMove).length

const section = `  <section id="items" class="chapter">
    <div class="chapter-head"><span class="ch-mark">§I</span><h2>Items</h2></div>
    <p class="lead">Every obtainable item in this build and where it comes from — ${soldCount} sold in shops, ${heldCount} carried by wild Pokémon, and all ${tmCount} TMs &amp; HMs with the move each one teaches. Shops in the ROM aren't tied to town names, so each is labelled by its counter type (Poké Mart, Dept. Store stone counter, battle-item stand, and so on).</p>
    <div class="callout fact"><div class="c-label"><span class="c-ico">◆</span>Reading the shops</div><p>A “Sold at” tag names the <strong>kind</strong> of counter that stocks the item (the ROM stores shop inventories, not the town they sit in). Cross-reference the walkthrough above to place them on the map — a “Vitamins” counter is the Goldenrod/Celadon Dept. Store, an “Evolution stones” counter is the department-store stone floor, and so on.</p></div>
${blocks}
  </section>`

const css = `
/* ── Items ── */
.it-group{margin-top:34px}
.it-cat{--ic:#8a8a8a;font-family:var(--sans);font-size:15px;font-weight:800;letter-spacing:.01em;
  margin:0 0 14px;display:flex;align-items:center;gap:10px;color:var(--text)}
.it-cat-dot{width:11px;height:11px;flex:none;border-radius:3px;transform:rotate(45deg);background:var(--ic);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--ic) 20%,transparent)}
.it-cat-n{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--muted);
  background:var(--panel-2);border:1px solid var(--line);border-radius:100px;padding:1px 9px;font-variant-numeric:tabular-nums}
.it-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}
.it-card{--ic:#8a8a8a;background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--ic);
  border-radius:10px;padding:12px 14px;box-shadow:var(--shadow)}
.it-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:9px}
.it-name{font-family:var(--serif);font-size:16px;font-weight:800;letter-spacing:-.01em;margin:0}
.it-price{font-family:var(--mono);font-size:11.5px;font-weight:600;color:var(--gold-deep);white-space:nowrap;
  font-variant-numeric:tabular-nums}
.it-src{font-family:var(--sans);font-size:12px;color:var(--muted);line-height:1.5;margin-top:6px;
  display:flex;flex-wrap:wrap;gap:5px;align-items:baseline}
.it-src-tag{font-family:var(--mono);font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
  color:var(--gold-deep);flex:none;align-self:center}
.it-src-none{font-style:italic;color:var(--faint)}
.it-shop,.it-mon,.it-move{display:inline-block;border-radius:5px;padding:2px 8px;font-size:11px;line-height:1.4;
  background:var(--panel-2);border:1px solid var(--line);color:var(--text)}
.it-mon{color:color-mix(in srgb,var(--ic) 55%,var(--text));border-color:color-mix(in srgb,var(--ic) 30%,var(--line))}
.it-move{font-family:var(--mono);font-size:10.5px;color:color-mix(in srgb,var(--ic) 60%,var(--text));
  background:color-mix(in srgb,var(--ic) 10%,var(--panel-2));border-color:color-mix(in srgb,var(--ic) 35%,var(--line))}
`

writeFileSync(resolve(here, 'items-section.html'), section)
writeFileSync(resolve(here, 'items-styles.css'), css)
console.log(`wrote items-section.html (${(section.length / 1024).toFixed(0)}KB, ${data.length} items in ${orderedCats.length} groups) + items-styles.css`)
