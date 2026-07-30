/**
 * Remove the "????????" placeholder items (Gen 3's unused item-table slots)
 * from Poké Mart lists, so no mart shows a blank/garbage entry in its menu.
 * Every other item in each list is preserved, in order.
 *
 *   npx tsx scripts/apply-strip-mart-dummies.mts "<rom.gba>" [toml]
 *   npx tsx scripts/apply-strip-mart-dummies.mts --dry-run "<rom.gba>" [toml]
 *
 * Dummies are identified by name (the item table decodes them as "????????"),
 * not by hard-coded id, so this is robust across builds. Each edited list is
 * rewritten to free space and repointed via the normal shop-save path; the
 * output is re-parsed to assert the dummies are gone and the surviving items
 * are unchanged. Backs the ROM up first. BPEE/H&S needs no toml.
 */
import * as fs from 'node:fs'
import { loadRom } from '../src/rom/loadRom'
import { applyRomEdits } from '../src/rom/writer'
import { readShops } from '../src/rom/tables/shops'

const DUMMY_NAME = '????????'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const romPath = positional[0]
const tomlPath = positional[1]
if (!romPath) {
  console.error('usage: npx tsx scripts/apply-strip-mart-dummies.mts [--dry-run] "<rom.gba>" [toml]')
  process.exit(2)
}

const bytes = new Uint8Array(fs.readFileSync(romPath))
const toml = tomlPath ? fs.readFileSync(tomlPath, 'utf8') : undefined
const romName = romPath.split(/[\\/]/).pop()!
const loaded = loadRom(bytes, romName, toml)
if (loaded.warnings.length > 0) throw new Error(`ROM warnings: ${loaded.warnings.join('; ')}`)

const isDummy = (id: number) => (loaded.itemNames[id] ?? '') === DUMMY_NAME
const nm = (id: number) => loaded.itemNames[id] ?? `#${id}`

const shops = readShops(loaded.rom, loaded.anchors)
const edits = new Map<number, number[]>()
const report: { cmd: number; removed: number; before: string[]; after: string[] }[] = []

for (const s of shops) {
  const dummies = s.items.filter(isDummy)
  if (dummies.length === 0) continue
  const kept = s.items.filter((id) => !isDummy(id))
  if (kept.length < 1) {
    // A mart that is ALL dummies would be left empty — skip it and warn rather
    // than write an illegal zero-item shop.
    console.warn(`⚠ skipping 0x${s.cmdOffset.toString(16)}: every item is a dummy (would empty the shop)`)
    continue
  }
  edits.set(s.cmdOffset, kept)
  report.push({
    cmd: s.cmdOffset,
    removed: dummies.length,
    before: s.items.map(nm),
    after: kept.map(nm),
  })
}

console.log(`ROM: ${romName}  (${loaded.rom.gameCode()}, anchors ${loaded.anchorSource})`)
if (edits.size === 0) {
  console.log('No marts contain "????????" dummy items — nothing to do.')
  process.exit(0)
}
console.log(`\n${edits.size} mart${edits.size > 1 ? 's' : ''} with dummy items:`)
for (const r of report) {
  console.log(`  @0x${r.cmd.toString(16)}  (−${r.removed})`)
  console.log(`     before: ${r.before.join(', ')}`)
  console.log(`     after:  ${r.after.join(', ')}`)
}

if (dryRun) {
  console.log('\n--dry-run: no changes written.')
  process.exit(0)
}

const { bytes: out, ops } = applyRomEdits(loaded.rom, loaded.anchors, { shops: edits })

// Independent re-parse: every edited shop must now match the dummy-free list.
const check = loadRom(out, 'check.gba', toml)
if (check.warnings.length > 0) throw new Error(`Output ROM has warnings: ${check.warnings.join('; ')}`)
const checkShops = readShops(check.rom, check.anchors)
for (const [cmd, want] of edits) {
  const got = checkShops.find((s) => s.cmdOffset === cmd)
  if (!got || got.items.length !== want.length || got.items.some((id, i) => id !== want[i])) {
    throw new Error(`Post-check failed at 0x${cmd.toString(16)}: got ${JSON.stringify(got?.items)}, want ${JSON.stringify(want)}`)
  }
}
let remaining = 0
for (const s of checkShops) for (const id of s.items) if ((check.itemNames[id] ?? '') === DUMMY_NAME) remaining++
if (remaining > 0) throw new Error(`Post-check failed: ${remaining} dummy items still present in some mart`)

let diff = 0
for (let i = 0; i < out.length; i++) if (out[i] !== bytes[i]) diff++

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const backupPath = romPath.replace(/\.gba$/i, '') + `.pre-mart-dummies-${stamp}.gba`
fs.copyFileSync(romPath, backupPath)
fs.writeFileSync(romPath, out)

const removedTotal = report.reduce((n, r) => n + r.removed, 0)
console.log(`\n✅ removed ${removedTotal} dummy item${removedTotal > 1 ? 's' : ''} from ${edits.size} mart(s) (${ops.length} write op(s), ${diff} bytes changed).`)
console.log(`   backup: ${backupPath.split(/[\\/]/).pop()}`)
