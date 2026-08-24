/**
 * Splice the generated "What's Changed from Vanilla" section + styles into the
 * guide. Unlike the reference chapters (Pokédex/Items/Trades, which sit at the
 * back), this one goes up front — right after Getting Started, before Johto —
 * so a returning HG/SS player meets the house rules before the walkthrough.
 *
 * Idempotent: if the guide already has a #changes section (and its CSS block),
 * both are replaced in place, so re-running after gen-changes-html.mts updates
 * the chapter instead of duplicating it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const gp = resolve(here, '..', 'heart-and-soul-guide.html')
let g = readFileSync(gp, 'utf8')
const css = readFileSync(resolve(here, 'changes-styles.css'), 'utf8')
const section = readFileSync(resolve(here, 'changes-section.html'), 'utf8')

if (!g.includes('id="johto"')) { console.error('ABORT: expected the Johto section to exist'); process.exit(1) }
const hadSection = g.includes('id="changes"')

// 1) CSS: replace the previous Changes block if present, else insert before </style>
const CSS_MARK = "/* ── What's Changed ── */"
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

// 2) TOC link after the Getting Started link, if it isn't already there
if (!/href="#changes"/.test(g)) {
  g = g.replace(
    '<a href="#start">Getting Started</a>',
    '<a href="#start">Getting Started</a>\n    <a href="#changes">What’s Changed</a>',
  )
}

// 3) Section: replace in place when present, else insert right before Johto so
//    the order stays start -> changes -> johto -> ...
if (hadSection) {
  const secStart = g.indexOf('<section id="changes"')
  const lineStart = g.lastIndexOf('\n', secStart) + 1
  const secEnd = g.indexOf('</section>', secStart)
  if (secEnd < 0) { console.error('ABORT: could not bound the existing #changes section'); process.exit(1) }
  g = g.slice(0, lineStart) + section.trim() + g.slice(secEnd + '</section>'.length)
} else {
  const johtoIdx = g.indexOf('<section id="johto"')
  const lineStart = g.lastIndexOf('\n', johtoIdx) + 1
  g = g.slice(0, lineStart) + section.trim() + '\n\n' + g.slice(lineStart)
}

writeFileSync(gp, g)

const opens = (g.match(/<div\b/g) || []).length
const closes = (g.match(/<\/div>/g) || []).length
const sections = (g.match(/<section\b/g) || []).length
const secClose = (g.match(/<\/section>/g) || []).length
console.log(`spliced (${hadSection ? 'replaced' : 'inserted'}). size=${(g.length / 1024 / 1024).toFixed(2)}MB`)
console.log(`<div> ${opens} / </div> ${closes}  ${opens === closes ? 'OK' : 'MISMATCH'}`)
console.log(`<section> ${sections} / </section> ${secClose}  ${sections === secClose ? 'OK' : 'MISMATCH'}`)
console.log(`Changes TOC link: ${/href="#changes"/.test(g)}`)
console.log(`evolution rows: ${(g.match(/class="cg-evo"/g) || []).length}`)
const sIdx = g.indexOf('id="start"'), cIdx = g.indexOf('id="changes"'), jIdx = g.indexOf('id="johto"')
console.log(`order start<changes<johto: ${sIdx < cIdx && cIdx < jIdx}`)
