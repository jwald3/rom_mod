import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const gp = resolve(here, '..', 'heart-and-soul-guide.html')
let g = readFileSync(gp, 'utf8')
const css = readFileSync(resolve(here, 'trades-styles.css'), 'utf8')
const section = readFileSync(resolve(here, 'trades-section.html'), 'utf8')

if (g.includes('id="trades"')) { console.error('ABORT: guide already has a #trades section'); process.exit(1) }
if (!g.includes('id="items"')) { console.error('ABORT: expected the Items section to exist first'); process.exit(1) }

// 1) CSS before the closing </style>
const styleClose = g.lastIndexOf('</style>')
g = g.slice(0, styleClose) + css.trim() + '\n' + g.slice(styleClose)

// 2) TOC link after the Items link
g = g.replace(
  '<a href="#items">Items</a>',
  '<a href="#items">Items</a>\n    <a href="#trades">Trades</a>'
)

// 3) Section: insert immediately before the footer (after Items, which sits
//    right before the footer) so order is Pokédex -> Items -> Trades -> footer.
const footIdx = g.indexOf('  <footer class="foot">')
if (footIdx < 0) { console.error('ABORT: no footer'); process.exit(1) }
g = g.slice(0, footIdx) + section.trim() + '\n\n' + g.slice(footIdx)

writeFileSync(gp, g)

const opens = (g.match(/<div\b/g) || []).length
const closes = (g.match(/<\/div>/g) || []).length
const sections = (g.match(/<section\b/g) || []).length
const secClose = (g.match(/<\/section>/g) || []).length
console.log(`spliced. size=${(g.length / 1024 / 1024).toFixed(2)}MB`)
console.log(`<div> ${opens} / </div> ${closes}  ${opens === closes ? 'OK' : 'MISMATCH'}`)
console.log(`<section> ${sections} / </section> ${secClose}  ${sections === secClose ? 'OK' : 'MISMATCH'}`)
console.log(`charset meta present: ${/<meta charset="utf-8">/.test(g.slice(0, 600))}`)
console.log(`Trades TOC link: ${/href="#trades"/.test(g)}`)
console.log(`trade cards: ${(g.match(/class="tr-card"/g) || []).length}`)
const pIdx = g.indexOf('id="pokedex"'), iIdx = g.indexOf('id="items"'), tIdx = g.indexOf('id="trades"')
console.log(`order pokedex<items<trades<footer: ${pIdx < iIdx && iIdx < tIdx && tIdx < footIdx}`)
