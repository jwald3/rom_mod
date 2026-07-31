import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const gp = resolve(here, '..', 'heart-and-soul-guide.html')
let g = readFileSync(gp, 'utf8')
const css = readFileSync(resolve(here, 'items-styles.css'), 'utf8')
const section = readFileSync(resolve(here, 'items-section.html'), 'utf8')

if (g.includes('id="items"')) { console.error('ABORT: guide already has an #items section'); process.exit(1) }
if (!g.includes('id="pokedex"')) { console.error('ABORT: expected the Pokédex section to exist first'); process.exit(1) }

// 1) CSS before the closing </style>
const styleClose = g.lastIndexOf('</style>')
g = g.slice(0, styleClose) + css.trim() + '\n' + g.slice(styleClose)

// 2) TOC link after the Pokédex link
g = g.replace(
  '<a href="#pokedex">Pokédex</a>',
  '<a href="#pokedex">Pokédex</a>\n    <a href="#items">Items</a>'
)

// 3) Section: insert immediately BEFORE the footer (after the Pokédex section,
//    which sits just before the footer).
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
console.log(`Items TOC link: ${/href="#items"/.test(g)}`)
console.log(`item cards: ${(g.match(/class="it-card"/g) || []).length}`)
console.log(`#items before footer: ${g.indexOf('id="items"') < footIdx || g.indexOf('id="items"') < g.indexOf('<footer')}`)
