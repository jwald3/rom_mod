/**
 * Splice the generated Tier List section + styles into the guide, right after
 * the Pokédex (both are back-of-book reference chapters).
 *
 * Idempotent: if the guide already has a #tierlist section (and its CSS block),
 * both are replaced in place, so re-running after gen-tierlist-html.mts updates
 * the chapter instead of duplicating it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const gp = resolve(here, '..', 'heart-and-soul-guide.html')
let g = readFileSync(gp, 'utf8')
const css = readFileSync(resolve(here, 'tierlist-styles.css'), 'utf8')
const section = readFileSync(resolve(here, 'tierlist-section.html'), 'utf8')

if (!g.includes('id="pokedex"')) { console.error('ABORT: expected the Pokédex section to exist'); process.exit(1) }
const hadSection = g.includes('id="tierlist"')

// 1) CSS: replace the previous Tier List block if present, else insert before </style>
const CSS_MARK = '/* ── Tier List ── */'
const cssStart = g.indexOf(CSS_MARK)
if (cssStart >= 0) {
  const styleEnd = g.lastIndexOf('</style>')
  const nextBanner = g.indexOf('\n/* ', cssStart + CSS_MARK.length)
  const cssEnd = nextBanner >= 0 && nextBanner < styleEnd ? nextBanner + 1 : styleEnd
  g = g.slice(0, cssStart) + css.trim() + '\n' + g.slice(cssEnd)
} else {
  const styleClose = g.lastIndexOf('</style>')
  g = g.slice(0, styleClose) + css.trim() + '\n' + g.slice(styleClose)
}

// 2) TOC link right after the Pokédex link
if (!/href="#tierlist"/.test(g)) {
  g = g.replace(
    '<a href="#pokedex">Pokédex</a>',
    '<a href="#pokedex">Pokédex</a>\n    <a href="#tierlist">Tier List</a>',
  )
}

// 3) Section: replace in place when present, else insert right after the
//    Pokédex section so the order stays … red -> pokedex -> tierlist -> items …
if (hadSection) {
  const secStart = g.indexOf('<section id="tierlist"')
  const lineStart = g.lastIndexOf('\n', secStart) + 1
  const secEnd = g.indexOf('</section>', secStart)
  if (secEnd < 0) { console.error('ABORT: could not bound the existing #tierlist section'); process.exit(1) }
  g = g.slice(0, lineStart) + section.trim() + g.slice(secEnd + '</section>'.length)
} else {
  const pokeStart = g.indexOf('<section id="pokedex"')
  const pokeEnd = g.indexOf('</section>', pokeStart) + '</section>'.length
  g = g.slice(0, pokeEnd) + '\n\n' + section.trim() + g.slice(pokeEnd)
}

writeFileSync(gp, g)

const opens = (g.match(/<div\b/g) || []).length
const closes = (g.match(/<\/div>/g) || []).length
const sections = (g.match(/<section\b/g) || []).length
const secClose = (g.match(/<\/section>/g) || []).length
console.log(`spliced (${hadSection ? 'replaced' : 'inserted'}). size=${(g.length / 1024 / 1024).toFixed(2)}MB`)
console.log(`<div> ${opens} / </div> ${closes}  ${opens === closes ? 'OK' : 'MISMATCH'}`)
console.log(`<section> ${sections} / </section> ${secClose}  ${sections === secClose ? 'OK' : 'MISMATCH'}`)
console.log(`Tier List TOC link: ${/href="#tierlist"/.test(g)}`)
console.log(`table rows: ${(g.match(/class="tl-rank"/g) || []).length}`)
const pIdx = g.indexOf('id="pokedex"'), tIdx = g.indexOf('id="tierlist"'), iIdx = g.indexOf('id="items"')
console.log(`order pokedex<tierlist<items: ${pIdx < tIdx && tIdx < iIdx}`)
