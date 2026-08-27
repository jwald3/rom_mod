/**
 * Generate the guide's "What's Changed from Vanilla" section from
 * scripts/changes-data.json (see gen-changes-data.mts). Writes
 * scripts/changes-section.html + scripts/changes-styles.css, which
 * splice-changes.mjs inserts near the top of the guide (right after Getting
 * Started) so a returning HG/SS player can see the house rules at a glance.
 *
 * Sprites are reused from the guide by species name, same as the Trades section.
 *
 *   npx tsx scripts/gen-changes-html.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

interface Data {
  itemEvos: { from: string; to: string; item: string }[]
  levelEvos: { from: string; to: string; level: number }[]
  vitaminPrices: { name: string; price: number }[]
  removedSpecies: string[]
  removedMoves: string[]
  tm26: { tm: string; move: string; brockNow: string; where: string }
  kanto: { lo: number; hi: number; oldCeiling: number }
  typeReverts: { name: string; added: string; now: string[]; starter: boolean; group: 'invented' | 'gen4' }[]
}

const here = dirname(fileURLToPath(import.meta.url))
const d: Data = JSON.parse(readFileSync(resolve(here, 'changes-data.json'), 'utf8'))
const guide = readFileSync(resolve(here, '..', 'heart-and-soul-guide.html'), 'utf8')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const title = (s: string) => s.toLowerCase().replace(/(^|[\s.'’-])([a-z])/g, (_, p, c) => p + c.toUpperCase())

// harvest sprites from the guide by alt name (same approach as the Pokédex/Trades)
const sprites = new Map<string, string>()
for (const m of guide.matchAll(/<img[^>]*?src="(data:image\/png;base64,[^"]+)"[^>]*?alt="([^"]+)"/g)) {
  const key = m[2].toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!sprites.has(key)) sprites.set(key, m[1])
}
const spriteFor = (name: string) => sprites.get(name.toUpperCase().replace(/[^A-Z0-9]/g, '')) ?? null

function mon(name: string): string {
  const spr = spriteFor(name)
  const img = spr
    ? `<img class="cg-sprite" src="${spr}" alt="${esc(title(name))}" loading="lazy" width="48" height="48">`
    : `<div class="cg-sprite cg-noimg">${esc(name.slice(0, 3))}</div>`
  return `<span class="cg-mon">${img}<span class="cg-mon-name">${esc(title(name))}</span></span>`
}

// ── Evolution cards: item-triggered (former trade-item) + trade→level ──
function itemEvoRow(e: Data['itemEvos'][number]): string {
  return `<li class="cg-evo">
  ${mon(e.from)}
  <span class="cg-evo-mid"><span class="cg-evo-arrow">→</span><span class="cg-evo-trig">use ${esc(title(e.item))}</span></span>
  ${mon(e.to)}
</li>`
}
function levelEvoRow(e: Data['levelEvos'][number]): string {
  return `<li class="cg-evo">
  ${mon(e.from)}
  <span class="cg-evo-mid"><span class="cg-evo-arrow">→</span><span class="cg-evo-trig">Lv ${e.level}</span></span>
  ${mon(e.to)}
</li>`
}

// Type tokens as the ROM stores them → display labels.
const typeLabel = (t: string) =>
  ({ FIGHT: 'Fighting', PSYCHC: 'Psychic', ELECTR: 'Electric' } as Record<string, string>)[t] ?? title(t)
const typingOf = (now: string[]) => now.map(typeLabel).join('/')
const addedLabel = (t: string) => typeLabel(t)

// ── "invented second type" card (starters etc.) ──
// The starters lead the copy; mono-type reverts get a one-line summary; the two
// dual-type corrections (which stay dual) get their own clause in the card.
const invented = d.typeReverts.filter((t) => t.group === 'invented')
const starterReverts = invented.filter((t) => t.starter)
const monoReverts = invented.filter((t) => !t.starter && t.now.length === 1)
const dualCorrections = invented.filter((t) => !t.starter && t.now.length === 2)
const starterSentence = starterReverts
  .map((t) => `${title(t.name)} back to pure ${typingOf(t.now)}`)
  .join(', ')
  .replace(/,([^,]*)$/, ' and$1')
const otherSentence = monoReverts
  .map((t) => `${title(t.name)} −${addedLabel(t.added)}`)
  .join(', ')
const correctionSentence = dualCorrections
  .map((t) => `${title(t.name)} to ${typingOf(t.now)}`)
  .join(' and ')

// ── Gen-4 Fairy-rollback card ──
// The Fairy-pass lines get grouped by resulting typing ("Normal — Clefairy,
// Jigglypuff, …"); Arbok (which lost Dark, not Fairy) gets its own clause.
const gen4 = d.typeReverts.filter((t) => t.group === 'gen4')
const fairyReverts = gen4.filter((t) => t.added === 'FAIRY')
const gen4ByTyping = new Map<string, string[]>()
for (const t of fairyReverts) {
  const key = typingOf(t.now)
  if (!gen4ByTyping.has(key)) gen4ByTyping.set(key, [])
  gen4ByTyping.get(key)!.push(title(t.name))
}
const gen4Groups = [...gen4ByTyping.entries()]
  .map(([typing, names]) => `<strong>${esc(typing)}</strong> — ${esc(names.join(', '))}`)
  .join('; ')
// A trailing "Mime Jr." already ends the list in a period; don't add a second.
const gen4GroupsDot = gen4Groups.endsWith('.') ? gen4Groups : `${gen4Groups}.`
const arbokReverted = gen4.some((t) => t.name === 'ARBOK')

const vitPrice = d.vitaminPrices[0]?.price ?? 9800
const vitList = d.vitaminPrices.map((v) => title(v.name)).join(', ')
const removedSpeciesList = d.removedSpecies.map((s) => title(s)).join(', ')
const removedMovesList = d.removedMoves.map((m) => title(m)).join(' and ')

const section = `  <section id="changes" class="chapter">
    <div class="chapter-head"><span class="ch-mark">§Δ</span><h2>What's Changed from Vanilla</h2></div>
    <p class="lead">Heart &amp; Soul keeps the shape of Johto and Kanto but rewrites a handful of the rules — mostly so you never have to trade to complete an evolution, and so the back half of the game actually fights back. If you've played HG/SS, these are the house rules worth knowing before you start.</p>
    <div class="callout fact"><div class="c-label"><span class="c-ico">◆</span>Read from the ROM</div><p>The evolution lists below are pulled straight out of this build's <code>gEvolutions</code> table, and the vitamin prices out of the item table — so they match exactly what the cartridge does, not what a design doc intended.</p></div>

    <h3 class="sub-head">Trade evolutions are gone — everything evolves solo</h3>
    <p>No link cable, no second console. The two classic trade paths were both rewritten so a single player can finish every line.</p>

    <div class="cg-cols">
      <div class="cg-col">
        <h4 class="cg-h4">Trade-item lines → <em>use the item</em></h4>
        <p class="cg-note">The species that used to need a held item <em>and</em> a trade now evolve the moment you use that same item from the bag, exactly like an Everstone or a Fire Stone. The item is unchanged — only the trade requirement is dropped.</p>
        <ul class="cg-evo-list">
${d.itemEvos.map(itemEvoRow).join('\n')}
        </ul>
      </div>
      <div class="cg-col">
        <h4 class="cg-h4">Plain trade lines → <em>level up</em></h4>
        <p class="cg-note">The four Pokémon that evolved on a bare trade now evolve by levelling, at the levels below — no item, no trade.</p>
        <ul class="cg-evo-list">
${d.levelEvos.map(levelEvoRow).join('\n')}
        </ul>
      </div>
    </div>
    <div class="callout tip"><div class="c-label"><span class="c-ico">✦</span>Bag-usable evolution items</div><p>Because those items now trigger evolutions directly, every one of them — <strong>Metal Coat, King's Rock, Dragon Scale, Up-Grade, DeepSeaTooth, DeepSeaScale</strong> — is usable straight from your bag. In vanilla several of these did nothing when used; here they behave like stones.</p></div>

    <h3 class="sub-head">Other rule changes</h3>
    <div class="cg-grid">
      <article class="cg-card">
        <div class="cg-card-h"><span class="cg-badge cg-badge-price">₽</span><h4>Vitamins cost full price</h4></div>
        <p>${esc(vitList)} are priced at the standard <strong>₽${vitPrice.toLocaleString('en-US')}</strong> each (they were mistakenly discounted to ₽1,350 in an earlier build). Sell value is half, ₽${Math.floor(vitPrice / 2).toLocaleString('en-US')}.</p>
      </article>
      <article class="cg-card">
        <div class="cg-card-h"><span class="cg-badge cg-badge-tm">TM</span><h4>${esc(d.tm26.move)} moved off Brock</h4></div>
        <p><strong>${esc(d.tm26.tm)}</strong> now teaches <strong>${esc(d.tm26.move)}</strong>, and it's a floor pickup in the <strong>${esc(d.tm26.where)}</strong> rather than a gym reward. Brock hands out <strong>${esc(d.tm26.brockNow)}</strong> instead, so the strongest Ground TM is something you earn by exploring mid-game.</p>
      </article>
      <article class="cg-card">
        <div class="cg-card-h"><span class="cg-badge cg-badge-scale">↑</span><h4>Kanto fights at post-game levels</h4></div>
        <p>Kanto is badges 9–16 here, so its wild Pokémon were scaled up from their old Gen-1 levels into a <strong>Lv ${d.kanto.lo}–${d.kanto.hi}</strong> band, and any line that would have evolved by then is promoted to match. Slots already above Lv ${d.kanto.oldCeiling} (Cerulean Cave, the deep Seafoam/Cinnabar routes) were left alone.</p>
      </article>
      <article class="cg-card">
        <div class="cg-card-h"><span class="cg-badge cg-badge-cut">✕</span><h4>Roster held to Gen 1–4</h4></div>
        <p>Species and moves introduced after Gen 4 were pulled from every trainer team, evolution and wild slot, so nothing in a normal run will fight or become one of them — including ${esc(removedSpeciesList)}. The fairy-era moves ${esc(removedMovesList)} were removed too; this is the <em>no-fairy</em> build.</p>
      </article>
${
  invented.length
    ? `      <article class="cg-card">
        <div class="cg-card-h"><span class="cg-badge cg-badge-type">◈</span><h4>Starters back to their real types</h4></div>
        <p>An earlier build had bolted a second type onto several Pokémon that are single-type in the games — most obviously the Johto starters. Those are reverted: <strong>${esc(starterSentence)}</strong>.${
        otherSentence ? ` A few others lost an invented second type as well (${esc(otherSentence)}).` : ''
      }${
        correctionSentence ? ` Two dual-types were also corrected to their canon pairing — ${esc(correctionSentence)}.` : ''
      }</p>
      </article>`
    : ''
}${
  gen4.length
    ? `
      <article class="cg-card">
        <div class="cg-card-h"><span class="cg-badge cg-badge-type">◈</span><h4>Fairy types rolled back to Gen 4</h4></div>
        <p>These lines predate the Fairy type, so they're back to their Gen-4 typings: ${gen4GroupsDot} Gallade keeps its usual Psychic/Fighting.${
        arbokReverted ? ' Arbok also drops its Dark half back to pure Poison.' : ''
      }</p>
      </article>`
    : ''
}
    </div>
  </section>`

const css = `
/* ── What's Changed ── */
.cg-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:22px;margin:18px 0 6px}
.cg-h4{font-family:var(--sans);font-size:15px;font-weight:800;letter-spacing:.01em;margin:0 0 4px;color:var(--text)}
.cg-h4 em{font-style:italic;color:var(--gold-deep)}
.cg-note{font-family:var(--sans);font-size:13px;color:var(--muted);line-height:1.55;margin:0 0 12px;max-width:52ch}
.cg-evo-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.cg-evo{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;
  background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 12px;box-shadow:var(--shadow)}
.cg-mon{display:flex;align-items:center;gap:8px;min-width:0}
.cg-evo>.cg-mon:last-child{justify-content:flex-end;text-align:right}
.cg-sprite{width:48px;height:48px;flex:none;image-rendering:pixelated;filter:drop-shadow(0 1px 2px rgba(0,0,0,.2))}
.cg-noimg{display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--panel-2);
  border:1px solid var(--line);font-family:var(--sans);font-weight:800;font-size:12px;color:var(--muted);text-transform:uppercase}
.cg-mon-name{font-family:var(--sans);font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cg-evo-mid{display:flex;flex-direction:column;align-items:center;gap:1px;flex:none}
.cg-evo-arrow{font-size:16px;line-height:1;color:var(--gold-deep)}
.cg-evo-trig{font-family:var(--mono);font-size:9.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;
  color:var(--good);white-space:nowrap}
.cg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-top:16px}
.cg-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 17px;box-shadow:var(--shadow)}
.cg-card-h{display:flex;align-items:center;gap:11px;margin-bottom:9px}
.cg-card-h h4{font-family:var(--sans);font-size:15px;font-weight:800;letter-spacing:.01em;margin:0;color:var(--text)}
.cg-badge{flex:none;width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;
  font-family:var(--sans);font-weight:800;font-size:12px;letter-spacing:.02em}
.cg-badge-price{background:color-mix(in srgb,var(--gold) 16%,var(--panel-2));color:var(--gold-deep);
  border:1px solid color-mix(in srgb,var(--gold) 34%,var(--line));font-size:15px}
.cg-badge-tm{background:color-mix(in srgb,var(--silver) 16%,var(--panel-2));color:var(--silver);
  border:1px solid color-mix(in srgb,var(--silver) 34%,var(--line));font-size:10px}
.cg-badge-scale{background:color-mix(in srgb,var(--ember) 14%,var(--panel-2));color:var(--ember);
  border:1px solid color-mix(in srgb,var(--ember) 32%,var(--line));font-size:15px}
.cg-badge-cut{background:color-mix(in srgb,var(--ember) 14%,var(--panel-2));color:var(--ember);
  border:1px solid color-mix(in srgb,var(--ember) 32%,var(--line));font-size:14px}
.cg-badge-type{background:color-mix(in srgb,var(--gold) 16%,var(--panel-2));color:var(--gold-deep);
  border:1px solid color-mix(in srgb,var(--gold) 34%,var(--line));font-size:14px}
.cg-card p{font-family:var(--sans);font-size:13px;color:var(--muted);line-height:1.58;margin:0;max-width:none}
`

writeFileSync(resolve(here, 'changes-section.html'), section)
writeFileSync(resolve(here, 'changes-styles.css'), css)
const withSprite = [...d.itemEvos, ...d.levelEvos].filter((e) => spriteFor(e.from) && spriteFor(e.to)).length
console.log(`wrote changes-section.html + changes-styles.css`)
console.log(`  ${d.itemEvos.length} item→stone + ${d.levelEvos.length} trade→level evolution rows`)
console.log(`  both sprites reused: ${withSprite}/${d.itemEvos.length + d.levelEvos.length}`)
