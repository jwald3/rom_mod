/**
 * Splice the generated Items section + styles into the guide.
 *
 * Idempotent: if the guide already has a #items section (and its CSS block),
 * both are replaced in place, so re-running after gen-items-html.mts updates the
 * chapter instead of duplicating it or aborting.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const gp = resolve(here, '..', 'heart-and-soul-guide.html')
let g = readFileSync(gp, 'utf8')
const css = readFileSync(resolve(here, 'items-styles.css'), 'utf8')
const section = readFileSync(resolve(here, 'items-section.html'), 'utf8')

if (!g.includes('id="pokedex"')) { console.error('ABORT: expected the Pokédex section to exist first'); process.exit(1) }
const hadSection = g.includes('id="items"')

// 1) CSS: replace the previous Items block if present, else insert before </style>.
const CSS_MARK = '/* ── Items ── */'
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

// 2) TOC link after the Pokédex link, if not already present.
if (!/href="#items"/.test(g)) {
  g = g.replace(
    '<a href="#pokedex">Pokédex</a>',
    '<a href="#pokedex">Pokédex</a>\n    <a href="#items">Items</a>',
  )
}

// 3) Section: replace in place when present, else insert before the footer so the
//    order stays Pokédex -> Items -> ... -> footer.
if (hadSection) {
  const secStart = g.indexOf('<section id="items"')
  const lineStart = g.lastIndexOf('\n', secStart) + 1
  const secEnd = g.indexOf('</section>', secStart)
  if (secEnd < 0) { console.error('ABORT: could not bound the existing #items section'); process.exit(1) }
  g = g.slice(0, lineStart) + section.trim() + g.slice(secEnd + '</section>'.length)
} else {
  const footIdx = g.indexOf('  <footer class="foot">')
  if (footIdx < 0) { console.error('ABORT: no footer'); process.exit(1) }
  g = g.slice(0, footIdx) + section.trim() + '\n\n' + g.slice(footIdx)
}

writeFileSync(gp, g)

const opens = (g.match(/<div\b/g) || []).length
const closes = (g.match(/<\/div>/g) || []).length
const sections = (g.match(/<section\b/g) || []).length
const secClose = (g.match(/<\/section>/g) || []).length
console.log(`spliced (${hadSection ? 'replaced' : 'inserted'}). size=${(g.length / 1024 / 1024).toFixed(2)}MB`)
console.log(`<div> ${opens} / </div> ${closes}  ${opens === closes ? 'OK' : 'MISMATCH'}`)
console.log(`<section> ${sections} / </section> ${secClose}  ${sections === secClose ? 'OK' : 'MISMATCH'}`)
console.log(`Items TOC link: ${/href="#items"/.test(g)}`)
console.log(`item cards: ${(g.match(/class="it-card"/g) || []).length}`)
