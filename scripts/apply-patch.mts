/**
 * Reconstruct the modded ROM from the base + rom/GPT_Mods.ips — no external
 * tools needed.
 *
 *   npx tsx scripts/apply-patch.mts <path-to-GPT_Fresh.gba> [output.gba]
 *
 * Output defaults to 20260426__GPT_Mods.gba next to the base ROM.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const PATCH_PATH = 'rom/GPT_Mods.ips'
const basePath = process.argv[2]
if (!basePath) {
  console.error('usage: npx tsx scripts/apply-patch.mts <GPT_Fresh.gba> [output.gba]')
  process.exit(1)
}
const outPath = process.argv[3] ?? path.join(path.dirname(basePath), '20260426__GPT_Mods.gba')

const rom = new Uint8Array(fs.readFileSync(basePath))
const ips = new Uint8Array(fs.readFileSync(PATCH_PATH))

const ascii = (o: number, n: number) => String.fromCharCode(...ips.subarray(o, o + n))
if (ascii(0, 5) !== 'PATCH') throw new Error('Not an IPS file')

let pos = 5
let records = 0
while (pos < ips.length) {
  if (ascii(pos, 3) === 'EOF' && pos + 3 >= ips.length) break
  const offset = (ips[pos] << 16) | (ips[pos + 1] << 8) | ips[pos + 2]
  const size = (ips[pos + 3] << 8) | ips[pos + 4]
  pos += 5
  if (size === 0) {
    // RLE record (we never emit these, but handle them for completeness)
    const rleSize = (ips[pos] << 8) | ips[pos + 1]
    rom.fill(ips[pos + 2], offset, offset + rleSize)
    pos += 3
  } else {
    rom.set(ips.subarray(pos, pos + size), offset)
    pos += size
  }
  records++
}

fs.writeFileSync(outPath, rom)
console.log(`✅ applied ${records} records → ${outPath}`)
console.log('   keep rom/GPT_Mods.toml next to it for the editor and HMA')
