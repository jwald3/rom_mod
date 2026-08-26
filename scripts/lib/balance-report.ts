import type { BatchResult, Combatant, Matchup } from '../../src/sim'

/**
 * Standalone HTML report for a balance run — same shape as the guide's other
 * generated pages (self-contained, no assets, dark-friendly). One row per
 * opponent with a win-rate bar; with `--overrides`, each row shows
 * baseline → modified and the delta.
 */

export interface ReportRow {
  group: string
  opponent: Combatant
  matchup: Matchup
  batch: BatchResult | null
}

export interface ReportRun {
  label: string
  subject: Combatant
  rows: ReportRow[]
  viability: number
  meanWinRate: number
  record: { wins: number; losses: number; draws: number }
  coveragePercent: number
  unmodeledMoves: string[]
}

export interface ReportInput {
  romName: string
  cohort: string
  sims: number
  seed: number
  typeNames: string[]
  notes: string[]
  overrideNotes: string[]
  baseline: ReportRun
  modified: ReportRun | null
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const pct = (n: number): string => `${n.toFixed(0)}%`
const ttk = (n: number): string => (Number.isFinite(n) ? String(n) : '—')

/** Win rate 0–100 → a red→amber→green hue. */
const rateColor = (rate: number): string => `hsl(${Math.round((rate / 100) * 120)} 70% 45%)`

function subjectCard(run: ReportRun, typeNames: string[]): string {
  const s = run.subject
  const types =
    s.types[0] === s.types[1]
      ? typeNames[s.types[0]]
      : `${typeNames[s.types[0]]} / ${typeNames[s.types[1]]}`
  const st = s.stats
  return `
    <div class="card">
      <h2>${esc(s.species)} <span class="lv">L${s.level}</span></h2>
      <p class="meta">${esc(types)} · ${esc(s.abilityName)}${s.itemName ? ` · @${esc(s.itemName)}` : ''}</p>
      <table class="stats">
        <tr><th>HP</th><th>Atk</th><th>Def</th><th>SpA</th><th>SpD</th><th>Spe</th></tr>
        <tr><td>${st.hp}</td><td>${st.atk}</td><td>${st.def}</td><td>${st.spa}</td><td>${st.spd}</td><td>${st.spe}</td></tr>
      </table>
      <p class="moves">${s.moves.map((m) => `<span class="move">${esc(m.name)}</span>`).join('')}</p>
    </div>`
}

function rowHtml(row: ReportRow, modifiedRow: ReportRow | null, showWinRate: boolean): string {
  const m = row.matchup
  const best = m.selfSide.best
  const speed = m.speedTie ? '=' : m.outspeeds ? '▲' : '▼'
  const rate = row.batch?.winRate ?? (m.score + 1) * 50
  const modRate = modifiedRow ? (modifiedRow.batch?.winRate ?? (modifiedRow.matchup.score + 1) * 50) : null
  const delta = modRate === null ? null : modRate - rate
  return `
    <tr>
      <td class="name">${esc(row.opponent.species)} <span class="lv">L${row.opponent.level}</span></td>
      <td class="speed ${m.outspeeds ? 'fast' : m.speedTie ? 'tie' : 'slow'}">${speed}</td>
      <td>${esc(best?.move.name ?? '—')}</td>
      <td class="num">${best ? pct(best.fraction * 100) : '—'}</td>
      <td class="num">${ttk(m.selfSide.turnsToKo)}</td>
      <td class="num">${ttk(m.foeSide.turnsToKo)}</td>
      <td class="num">${m.score.toFixed(2)}</td>
      ${
        showWinRate
          ? `<td class="bar-cell">
               <div class="bar"><span style="width:${rate.toFixed(1)}%;background:${rateColor(rate)}"></span></div>
               <span class="rate">${pct(rate)}</span>
             </td>`
          : ''
      }
      ${
        delta === null
          ? ''
          : `<td class="num delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}">${
              delta > 0 ? '+' : ''
            }${delta.toFixed(0)}</td>`
      }
    </tr>`
}

export function renderHtmlReport(input: ReportInput): string {
  const { baseline, modified } = input
  const showWinRate = input.sims > 0
  const groups: string[] = []
  let lastGroup = ''
  baseline.rows.forEach((row, i) => {
    if (row.group !== lastGroup) {
      lastGroup = row.group
      groups.push(`<tr class="group"><td colspan="9">${esc(row.group)}</td></tr>`)
    }
    groups.push(rowHtml(row, modified ? modified.rows[i] : null, showWinRate))
  })

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(baseline.subject.species)} — balance report</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfbfa; --fg: #1c1b1a; --muted: #6b6a67; --line: #e3e1dd; --card: #fff;
    --accent: #2f6f4f;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #17171a; --fg: #e9e8e6; --muted: #9a9895; --line: #2e2e33; --card: #1f1f23; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2rem 1.25rem 4rem; background: var(--bg); color: var(--fg);
         font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 60rem; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.15rem; margin: 0 0 .35rem; }
  .sub { color: var(--muted); margin: 0 0 1.5rem; font-size: .9rem; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: .6rem;
          padding: 1rem 1.1rem; margin-bottom: 1.25rem; }
  .lv { color: var(--muted); font-weight: 400; }
  .meta { color: var(--muted); margin: 0 0 .6rem; font-size: .9rem; }
  table { border-collapse: collapse; width: 100%; }
  .stats { width: auto; margin-bottom: .6rem; }
  .stats th, .stats td { padding: .1rem .7rem .1rem 0; text-align: left; font-variant-numeric: tabular-nums; }
  .stats th { color: var(--muted); font-weight: 500; font-size: .8rem; }
  .moves { margin: 0; display: flex; flex-wrap: wrap; gap: .35rem; }
  .move { border: 1px solid var(--line); border-radius: .3rem; padding: .1rem .45rem; font-size: .85rem; }
  .scroll { overflow-x: auto; }
  .matchups { font-size: .9rem; }
  .matchups th { text-align: left; color: var(--muted); font-weight: 500; font-size: .78rem;
                 text-transform: uppercase; letter-spacing: .04em; padding: .4rem .5rem; border-bottom: 1px solid var(--line); }
  .matchups td { padding: .35rem .5rem; border-bottom: 1px solid var(--line); white-space: nowrap; }
  .matchups .num { text-align: right; font-variant-numeric: tabular-nums; }
  .group td { font-weight: 600; padding-top: .8rem; border-bottom: 1px solid var(--line); }
  .speed.fast { color: var(--accent); } .speed.slow { color: #b4483c; } .speed.tie { color: var(--muted); }
  .bar-cell { display: flex; align-items: center; gap: .5rem; min-width: 9rem; }
  .bar { flex: 1; height: .55rem; background: var(--line); border-radius: .3rem; overflow: hidden; }
  .bar span { display: block; height: 100%; }
  .rate { font-variant-numeric: tabular-nums; width: 2.6rem; text-align: right; }
  .delta.up { color: var(--accent); } .delta.down { color: #b4483c; }
  .summary { display: flex; gap: 2rem; flex-wrap: wrap; margin: 1rem 0 0; }
  .summary div { }
  .summary b { display: block; font-size: 1.35rem; }
  .summary span { color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
  footer { margin-top: 2rem; color: var(--muted); font-size: .82rem; }
  footer li { margin-bottom: .25rem; }
  code { background: var(--line); padding: .05rem .3rem; border-radius: .2rem; font-size: .85em; }
</style>
</head>
<body>
<main>
  <h1>${esc(baseline.subject.species)} — balance report</h1>
  <p class="sub">${esc(input.romName)} · cohort <code>${esc(input.cohort)}</code> ·
     ${showWinRate ? `${input.sims} battles per matchup, seed ${input.seed}` : 'matchup calculator only'}</p>

  ${subjectCard(baseline, input.typeNames)}

  <div class="summary card">
    <div><b>${baseline.viability.toFixed(2)}</b><span>viability −1…+1</span></div>
    ${showWinRate ? `<div><b>${pct(baseline.meanWinRate)}</b><span>mean win rate</span></div>` : ''}
    ${
      showWinRate
        ? `<div><b>${baseline.record.wins}–${baseline.record.losses}–${baseline.record.draws}</b><span>W–L–D</span></div>`
        : ''
    }
    <div><b>${baseline.coveragePercent}%</b><span>move effects modeled</span></div>
    ${
      modified
        ? `<div><b>${modified.viability >= baseline.viability ? '+' : ''}${(modified.viability - baseline.viability).toFixed(2)}</b><span>viability Δ with overrides</span></div>`
        : ''
    }
  </div>

  ${
    input.overrideNotes.length
      ? `<div class="card"><h2>Overrides applied</h2><ul>${input.overrideNotes
          .map((n) => `<li>${esc(n)}</li>`)
          .join('')}</ul></div>`
      : ''
  }

  <div class="card scroll">
    <table class="matchups">
      <thead><tr>
        <th>Opponent</th><th>Spd</th><th>Best move</th><th>%/turn</th>
        <th>TTK</th><th>Their TTK</th><th>Score</th>
        ${showWinRate ? '<th>Win rate</th>' : ''}
        ${modified ? '<th>Δ</th>' : ''}
      </tr></thead>
      <tbody>${groups.join('')}</tbody>
    </table>
  </div>

  <footer>
    <p><b>What this does and doesn't model.</b> Gen-3 damage maths with the engine's
    integer truncation, stat stages, status, crits, accuracy, PP and Struggle, a
    greedy move-choice AI on both sides, and the ability/held-item effects listed in
    <code>src/sim/abilities.ts</code> and <code>src/sim/items.ts</code>.
    Not modeled: weather, screens, Protect/Counter, switching, natures, EV spreads
    beyond a flat value, semi-invulnerable turns, badge boosts.</p>
    ${
      baseline.unmodeledMoves.length
        ? `<p>Move effects without a handler (played as a plain hit):
           ${baseline.unmodeledMoves.map((m) => esc(m)).join(', ')}.</p>`
        : ''
    }
    ${input.notes.length ? `<ul>${input.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  </footer>
</main>
</body>
</html>
`
}
