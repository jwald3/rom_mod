/**
 * Spot-check the Heart & Soul guide's gym / Elite Four / Red rosters against
 * the actual ROM. Reads every trainer through the real editor readers, matches
 * each leader by name, and diffs species / level / held item / moves against
 * `scripts/hs-gym-expectations.json` (extracted from heart-and-soul-guide.html).
 *
 *   npx tsx scripts/hs-verify-gyms.mts "<path to Pokemon Heart & Soul.gba>" [toml]
 *
 * Options (env):
 *   HS_NO_MOVES=1   skip move-by-move checks (species + level + item only)
 *   HS_NO_ITEMS=1   skip held-item checks
 *   HS_SHOW_ALL=1   print full ROM roster for every matched leader, even on pass
 *
 * Exit code is 0 when every roster matches, 1 otherwise — so it can gate CI.
 * The ROM must be the BPEE Heart & Soul build (uses the built-in HS_BPEE
 * profile; no toml needed). Pointing it at the FireRed GPT_Mods ROM will match
 * nothing meaningful — that's the wrong game.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadRom } from '../src/rom/loadRom'
import type { Trainer, TrainerMon } from '../src/rom/tables/trainers'

const here = dirname(fileURLToPath(import.meta.url))

const romPath = process.argv[2]
const tomlPath = process.argv[3]
if (!romPath) {
  console.error('usage: npx tsx scripts/hs-verify-gyms.mts "<Pokemon Heart & Soul.gba>" [toml]')
  process.exit(2)
}

const CHECK_MOVES = process.env.HS_NO_MOVES !== '1'
const CHECK_ITEMS = process.env.HS_NO_ITEMS !== '1'
const SHOW_ALL = process.env.HS_SHOW_ALL === '1'

// ---- ground truth from the guide ----------------------------------------
interface ExpectedMon {
  name: string
  level: number
  held: string | null
  moves: string[]
}
interface ExpectedRoster {
  leader: string
  party: ExpectedMon[]
}
const expectations: ExpectedRoster[] = JSON.parse(
  readFileSync(resolve(here, 'hs-gym-expectations.json'), 'utf8'),
)

// Guide leader label → the name keyword(s) to look for in the ROM's trainer
// names. H&S/Emerald trainer names are ALLCAPS; a leader may have several
// trainer records (first battle + rematch), so we disambiguate by party size.
const NAME_KEYS: Record<string, string[]> = {
  Falkner: ['FALKNER'],
  Bugsy: ['BUGSY'],
  Whitney: ['WHITNEY'],
  Morty: ['MORTY'],
  Chuck: ['CHUCK'],
  Jasmine: ['JASMINE'],
  Pryce: ['PRYCE'],
  Clair: ['CLAIR', 'CLAIRE'],
  Brock: ['BROCK'],
  Misty: ['MISTY'],
  Ltsurge: ['SURGE'],
  Erika: ['ERIKA'],
  Janine: ['JANINE'],
  Sabrina: ['SABRINA'],
  Blaine: ['BLAINE'],
  Blue: ['BLUE', 'GARY'],
  Will: ['WILL'],
  Koga: ['KOGA'],
  Bruno: ['BRUNO'],
  Karen: ['KAREN'],
  Lance: ['LANCE'],
  Red: ['RED'],
}

// ---- helpers ------------------------------------------------------------
/** Uppercase, drop everything but A–Z/0–9 so "Mud-Slap" ≡ "MUD-SLAP" and
 *  "Ancientpower" ≡ "ANCIENTPOWER" and "Nidoran♀" folds to "NIDORAN". */
const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

// ---- load ROM -----------------------------------------------------------
const bytes = new Uint8Array(readFileSync(romPath))
const toml = tomlPath ? readFileSync(tomlPath, 'utf8') : undefined
const r = loadRom(bytes, romPath.split(/[\\/]/).pop()!, toml)

console.log(c.bold('Heart & Soul gym-roster verification'))
console.log(
  `game code ${r.rom.gameCode()} · anchors ${r.anchorSource} · ${r.trainers.length} trainers · ${r.species.length} species`,
)
if (r.rom.gameCode() !== 'BPEE') {
  console.log(
    c.yellow(
      `⚠ this ROM is ${r.rom.gameCode()}, not BPEE — the guide documents Heart & Soul (BPEE). ` +
        `Results below will not correspond to the guide.`,
    ),
  )
}
if (r.warnings.length) console.log(c.yellow('warnings: ' + r.warnings.join('; ')))
console.log()

const speciesName = (id: number): string => r.species[id]?.name ?? `#${id}`
const moveName = (id: number): string => (id === 0 ? '—' : (r.moves[id]?.name ?? `move#${id}`))
const itemName = (id: number): string => (id === 0 ? '' : (r.itemNames[id] ?? `item#${id}`))

const romMonLine = (m: TrainerMon): string => {
  const item = m.heldItem ? ` @${itemName(m.heldItem)}` : ''
  const mv = m.moves.some((x) => x) ? ` [${m.moves.map(moveName).join(', ')}]` : ''
  return `${speciesName(m.species)} L${m.level}${item}${mv}`
}

/** Find the ROM trainer(s) whose name matches a leader; prefer an exact
 *  party-size match with the guide, else return every candidate. */
function candidatesFor(keys: string[]): Trainer[] {
  return r.trainers.filter((t) => {
    const nm = norm(t.name)
    return keys.some((k) => nm.includes(norm(k)))
  })
}

// ---- compare ------------------------------------------------------------
interface Issue {
  slot: number
  kind: 'species' | 'level' | 'item' | 'move' | 'size' | 'nomatch'
  msg: string
}

function diffRoster(exp: ExpectedRoster, t: Trainer): Issue[] {
  const issues: Issue[] = []
  if (t.party.length !== exp.party.length) {
    issues.push({
      slot: -1,
      kind: 'size',
      msg: `party size ${t.party.length} (ROM) vs ${exp.party.length} (guide)`,
    })
  }
  const n = Math.max(t.party.length, exp.party.length)
  for (let i = 0; i < n; i++) {
    const e = exp.party[i]
    const m = t.party[i]
    if (!e || !m) continue // size diff already recorded
    if (norm(speciesName(m.species)) !== norm(e.name)) {
      issues.push({ slot: i, kind: 'species', msg: `species: ROM ${speciesName(m.species)} ≠ guide ${e.name}` })
    }
    if (m.level !== e.level) {
      issues.push({ slot: i, kind: 'level', msg: `${e.name} level: ROM ${m.level} ≠ guide ${e.level}` })
    }
    if (CHECK_ITEMS) {
      const romItem = itemName(m.heldItem)
      const expItem = e.held ?? ''
      if (norm(romItem) !== norm(expItem)) {
        issues.push({
          slot: i,
          kind: 'item',
          msg: `${e.name} item: ROM ${romItem || '(none)'} ≠ guide ${expItem || '(none)'}`,
        })
      }
    }
    if (CHECK_MOVES && t.hasMoves) {
      const romMoves = m.moves.filter((x) => x).map((id) => norm(moveName(id)))
      const expMoves = e.moves.map(norm)
      // order-insensitive set comparison
      const missing = expMoves.filter((mv) => !romMoves.includes(mv))
      const extra = romMoves.filter((mv) => !expMoves.includes(mv))
      if (missing.length || extra.length) {
        const parts: string[] = []
        if (missing.length) parts.push(`guide-only: ${missing.join(', ')}`)
        if (extra.length) parts.push(`ROM-only: ${extra.join(', ')}`)
        issues.push({ slot: i, kind: 'move', msg: `${e.name} moves — ${parts.join(' · ')}` })
      }
    }
  }
  return issues
}

/** Pick the best ROM candidate for a leader: the one with the fewest diffs
 *  (ties broken by exact party-size match), so a first-battle card matches the
 *  first-battle trainer rather than the rematch. */
function bestMatch(exp: ExpectedRoster, cands: Trainer[]): { t: Trainer; issues: Issue[] } | null {
  if (!cands.length) return null
  let best: { t: Trainer; issues: Issue[] } | null = null
  for (const t of cands) {
    const issues = diffRoster(exp, t)
    if (
      !best ||
      issues.length < best.issues.length ||
      (issues.length === best.issues.length &&
        Math.abs(t.party.length - exp.party.length) < Math.abs(best.t.party.length - exp.party.length))
    ) {
      best = { t, issues }
    }
  }
  return best
}

let totalIssues = 0
let matched = 0
let unmatched = 0
const summary: string[] = []

for (const exp of expectations) {
  const keys = NAME_KEYS[exp.leader] ?? [exp.leader.toUpperCase()]
  const cands = candidatesFor(keys)
  const hit = bestMatch(exp, cands)

  if (!hit) {
    unmatched++
    console.log(`${c.yellow('？')} ${c.bold(exp.leader)} — ${c.yellow('no ROM trainer matched')} (keys: ${keys.join('/')})`)
    console.log(c.dim(`   guide: ${exp.party.map((p) => `${p.name} L${p.level}`).join(', ')}`))
    summary.push(`${c.yellow('？')} ${exp.leader}: no match`)
    console.log()
    continue
  }

  matched++
  const { t, issues } = hit
  totalIssues += issues.length
  const tag = issues.length === 0 ? c.green('✓') : c.red('✗')
  const other = cands.length > 1 ? c.dim(` (+${cands.length - 1} other name match${cands.length - 1 > 1 ? 'es' : ''})`) : ''
  console.log(`${tag} ${c.bold(exp.leader)} → ROM #${t.index} "${t.name}"${other}`)

  if (issues.length === 0) {
    summary.push(`${c.green('✓')} ${exp.leader}`)
    if (SHOW_ALL) t.party.forEach((m, i) => console.log(c.dim(`   ${i + 1}. ${romMonLine(m)}`)))
  } else {
    summary.push(`${c.red('✗')} ${exp.leader} (${issues.length})`)
    for (const iss of issues) {
      const where = iss.slot >= 0 ? `slot ${iss.slot + 1}` : 'party'
      console.log(`   ${c.red('•')} ${where}: ${iss.msg}`)
    }
    // Print both rosters side by side for context.
    console.log(c.dim('   ROM  : ' + t.party.map(romMonLine).join(' | ')))
    console.log(
      c.dim(
        '   guide: ' +
          exp.party
            .map((p) => `${p.name} L${p.level}${p.held ? ' @' + p.held : ''}`)
            .join(' | '),
      ),
    )
  }
  console.log()
}

// ---- summary ------------------------------------------------------------
console.log(c.bold('── summary ──'))
console.log(summary.join('   '))
console.log(
  `\n${matched} matched · ${unmatched} unmatched · ${totalIssues} total diffs ` +
    `(moves ${CHECK_MOVES ? 'on' : 'off'}, items ${CHECK_ITEMS ? 'on' : 'off'})`,
)

process.exit(totalIssues === 0 && unmatched === 0 ? 0 : 1)
