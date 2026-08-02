/**
 * Splice the generated Trades section + styles into the guide.
 *
 * Idempotent: if the guide already has a #trades section (and its CSS block),
 * both are replaced in place, so re-running after gen-trades-html.mts updates
 * the chapter instead of duplicating it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const gp = resolve(here, '..', 'heart-and-soul-guide.html')
let g = readFileSync(gp, 'utf8')
const css = readFileSync(resolve(here, 'trades-styles.css'), 'utf8')
const section = readFileSync(resolve(here, 'trades-section.html'), 'utf8')

if (!g.includes('id="items"')) { console.error('ABORT: expected the Items section to exist first'); process.exit(1) }
const hadSection = g.includes('id="trades"')

// 1) CSS: replace the previous Trades block if present, else insert before </style>
const CSS_MARK = '/* ── In-game Trades ── */'
const cssStart = g.indexOf(CSS_MARK)
if (cssStart >= 0) {
  // the block ends at the next top-level comment banner, or at </style>
  const styleEnd = g.lastIndexOf('</style>')
  const nextBanner = g.indexOf('\n/* ', cssStart + CSS_MARK.length)
  const cssEnd = nextBanner >= 0 && nextBanner < styleEnd ? nextBanner + 1 : styleEnd
  g = g.slice(0, cssStart) + css.trim() + '\n' + g.slice(cssEnd)
} else {
  const styleClose = g.lastIndexOf('</style>')
  g = g.slice(0, styleClose) + css.trim() + '\n' + g.slice(styleClose)
}

// 2) TOC link after the Items link, if it isn't already there
if (!/href="#trades"/.test(g)) {
  g = g.replace(
    '<a href="#items">Items</a>',
    '<a href="#items">Items</a>\n    <a href="#trades">Trades</a>'
  )
}

// 3) Section: replace in place when present, else insert before the footer so
//    the order stays Pokédex -> Items -> Trades -> ... -> footer.
if (hadSection) {
  const secStart = g.indexOf('<section id="trades"')
  const lineStart = g.lastIndexOf('\n', secStart) + 1
  const secEnd = g.indexOf('</section>', secStart)
  if (secEnd < 0) { console.error('ABORT: could not bound the existing #trades section'); process.exit(1) }
  g = g.slice(0, lineStart) + section.trim() + g.slice(secEnd + '</section>'.length)
} else {
  const insertAt = g.indexOf('  <footer class="foot">')
  if (insertAt < 0) { console.error('ABORT: no footer'); process.exit(1) }
  g = g.slice(0, insertAt) + section.trim() + '\n\n' + g.slice(insertAt)
}

writeFileSync(gp, g)

const footIdx = g.indexOf('  <footer class="foot">')
const opens = (g.match(/<div\b/g) || []).length
const closes = (g.match(/<\/div>/g) || []).length
const sections = (g.match(/<section\b/g) || []).length
const secClose = (g.match(/<\/section>/g) || []).length
console.log(`spliced (${hadSection ? 'replaced' : 'inserted'}). size=${(g.length / 1024 / 1024).toFixed(2)}MB`)
console.log(`<div> ${opens} / </div> ${closes}  ${opens === closes ? 'OK' : 'MISMATCH'}`)
console.log(`<section> ${sections} / </section> ${secClose}  ${sections === secClose ? 'OK' : 'MISMATCH'}`)
console.log(`charset meta present: ${/<meta charset="utf-8">/.test(g.slice(0, 600))}`)
console.log(`Trades TOC link: ${/href="#trades"/.test(g)}`)
console.log(`trade cards: ${(g.match(/class="tr-card/g) || []).length}`)
const pIdx = g.indexOf('id="pokedex"'), iIdx = g.indexOf('id="items"'), tIdx = g.indexOf('id="trades"')
console.log(`order pokedex<items<trades<footer: ${pIdx < iIdx && iIdx < tIdx && tIdx < footIdx}`)
