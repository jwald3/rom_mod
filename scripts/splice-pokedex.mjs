import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const gp = resolve(here, '..', 'heart-and-soul-guide.html')
let g = readFileSync(gp, 'utf8')
const css = readFileSync(resolve(here, 'pokedex-styles.css'), 'utf8')
const section = readFileSync(resolve(here, 'pokedex-section.html'), 'utf8')

if (g.includes('id="pokedex"')) { console.error('ABORT: guide already has a #pokedex section'); process.exit(1) }

// 1) CSS: insert before the closing </style>
const styleClose = g.lastIndexOf('</style>')
if (styleClose < 0) { console.error('ABORT: no </style>'); process.exit(1) }
g = g.slice(0, styleClose) + css.trim() + '\n' + g.slice(styleClose)

// 2) TOC link: add after the Red link
g = g.replace(
  '<a href="#red">Mt. Silver &amp; Red</a>',
  '<a href="#red">Mt. Silver &amp; Red</a>\n    <a href="#pokedex">Pokédex</a>'
)

// 3) Section: insert before the footer
const footIdx = g.indexOf('  <footer class="foot">')
if (footIdx < 0) { console.error('ABORT: no footer'); process.exit(1) }
g = g.slice(0, footIdx) + section.trim() + '\n\n' + g.slice(footIdx)

writeFileSync(gp, g)

// div balance report
const opens = (g.match(/<div\b/g) || []).length
const closes = (g.match(/<\/div>/g) || []).length
const sections = (g.match(/<section\b/g) || []).length
const secClose = (g.match(/<\/section>/g) || []).length
console.log(`spliced. size=${(g.length/1024/1024).toFixed(2)}MB`)
console.log(`<div> ${opens} / </div> ${closes}  ${opens===closes?'OK':'MISMATCH'}`)
console.log(`<section> ${sections} / </section> ${secClose}  ${sections===secClose?'OK':'MISMATCH'}`)
console.log(`charset meta present: ${/<meta charset="utf-8">/.test(g.slice(0,600))}`)
console.log(`TOC link present: ${/href="#pokedex"/.test(g)}`)
console.log(`dx cards: ${(g.match(/class="dx-card"/g)||[]).length}`)
