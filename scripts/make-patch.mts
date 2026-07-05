/**
 * Generate an IPS patch capturing all mod work: GPT_Fresh.gba (base) →
 * 20260426__GPT_Mods.gba (current). Anyone with the base ROM applies the
 * patch (Floating IPS, Lunar IPS, or any online IPS tool) to reconstruct the
 * modded ROM byte-for-byte — no copyrighted ROM needs to be distributed.
 * Output: rom/GPT_Mods.ips. Verifies by applying the patch in memory.
 * Run: npx tsx scripts/make-patch.mts
 */
import * as fs from 'node:fs'

const DIR = 'C:/Users/Waldo/Downloads/Pokemon - Fire Red Version [a1] (U) (Squirrels) (2)'
const BASE = `${DIR}/GPT_Fresh.gba`
const MOD = `${DIR}/20260426__GPT_Mods.gba`
const OUT = 'rom/GPT_Mods.ips'

const base = new Uint8Array(fs.readFileSync(BASE))
const mod = new Uint8Array(fs.readFileSync(MOD))
if (base.length !== mod.length) throw new Error('Base and modded ROM sizes differ')
if (mod.length > 0x1000000) throw new Error('ROM too large for IPS offsets')

const MAX_RECORD = 0xffff
const EOF_MARKER = 0x454f46 // a record starting exactly here would read as "EOF"

interface Record_ {
  offset: number
  data: Uint8Array
}

const records: Record_[] = []
let i = 0
while (i < mod.length) {
  if (base[i] === mod[i]) {
    i++
    continue
  }
  let start = i
  let end = i
  // Extend through the diff run, absorbing gaps of ≤4 equal bytes so nearby
  // changes share one record.
  let scan = i
  while (scan < mod.length) {
    if (base[scan] !== mod[scan]) {
      end = scan + 1
      scan++
    } else {
      let gap = 0
      while (scan + gap < mod.length && base[scan + gap] === mod[scan + gap] && gap <= 4) gap++
      if (gap > 4 || scan + gap >= mod.length || base[scan + gap] === mod[scan + gap]) break
      scan += gap
    }
  }
  if (start === EOF_MARKER) start-- // dodge the "EOF" offset collision
  for (let o = start; o < end; o += MAX_RECORD) {
    const chunkEnd = Math.min(o + MAX_RECORD, end)
    records.push({ offset: o, data: mod.slice(o, chunkEnd) })
  }
  i = end
}

const parts: Uint8Array[] = [new TextEncoder().encode('PATCH')]
for (const r of records) {
  const head = new Uint8Array(5)
  head[0] = (r.offset >> 16) & 0xff
  head[1] = (r.offset >> 8) & 0xff
  head[2] = r.offset & 0xff
  head[3] = (r.data.length >> 8) & 0xff
  head[4] = r.data.length & 0xff
  parts.push(head, r.data)
}
parts.push(new TextEncoder().encode('EOF'))
const patch = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
let pos = 0
for (const p of parts) {
  patch.set(p, pos)
  pos += p.length
}

// Verify: apply the patch to a copy of the base, must equal the mod exactly.
const check = base.slice()
for (const r of records) check.set(r.data, r.offset)
for (let j = 0; j < mod.length; j++) {
  if (check[j] !== mod[j]) throw new Error(`Patch verification failed at 0x${j.toString(16)}`)
}

fs.mkdirSync('rom', { recursive: true })
fs.writeFileSync(OUT, patch)
const changed = records.reduce((n, r) => n + r.data.length, 0)
console.log(`✅ ${OUT}: ${records.length} records, ${changed} bytes of changes, ${patch.length} bytes total`)
console.log('   apply to GPT_Fresh.gba with Floating IPS / Lunar IPS to reconstruct the modded ROM')
