import { makeRng, type Rng } from './rng'
import { applyStage, clampStage, stageMultiplier } from './statCalc'
import {
  accuracyOf,
  calcDamage,
  critRate,
  freshStages,
  ohkoAccuracy,
  rollDamage,
  typeEffectiveness,
  type SideState,
} from './damage'
import {
  blocksOhko,
  blocksSecondaries,
  blocksStatDrops,
  hasIntimidate,
  hasSpeedBoost,
  ignoresRecoil,
  statusImmunity,
} from './abilities'
import { berryHeal, hasLeftovers } from './items'
import { STRUGGLE } from './effects'
import { chooseMove } from './ai'
import type { BoostableStat, Combatant, SimContext, SimMove, Status } from './types'

/**
 * Layer 2: a full 1v1 battle loop. Everything the matchup calculator averages
 * out — misses, crits, status, stat stages, PP — actually happens here, so a
 * batch of seeded runs gives a win rate rather than a ratio of damage numbers.
 *
 * Out of scope by design (and stated in the reports): weather, screens,
 * Protect/Counter, switching, semi-invulnerable turns, badge boosts.
 */

export interface Fighter {
  c: Combatant
  hp: number
  status: Status
  stages: Record<BoostableStat, number>
  /** Turns of sleep left (0 = awake). */
  sleepTurns: number
  /** Toxic damage counter, n/16. */
  toxicTurns: number
  /** Turns of confusion left. */
  confusedTurns: number
  /** Remaining PP, indexed like `c.moves`. */
  pp: number[]
  berryUsed: boolean
  /** A two-turn move part-way through its charge. */
  charging: SimMove | null
  flinched: boolean
  /** Move ids already used, so the AI doesn't loop on setup/status. */
  usedSetup: Set<number>
  usedStatus: Set<number>
}

export function makeFighter(c: Combatant): Fighter {
  return {
    c,
    hp: c.stats.hp,
    status: 'none',
    stages: freshStages(),
    sleepTurns: 0,
    toxicTurns: 0,
    confusedTurns: 0,
    pp: c.moves.map((m) => m.pp),
    berryUsed: false,
    charging: null,
    flinched: false,
    usedSetup: new Set(),
    usedStatus: new Set(),
  }
}

/** The static+live view `calcDamage` wants. */
function sideOf(f: Fighter): SideState {
  return { hp: f.hp, status: f.status, stages: f.stages }
}

export interface BattleLogEntry {
  turn: number
  actor: string
  text: string
}

export interface BattleResult {
  /** 'a' | 'b' | 'draw' — who was left standing. */
  winner: 'a' | 'b' | 'draw'
  turns: number
  /** Winner's remaining HP as a percentage of max. */
  winnerHpPercent: number
  log: BattleLogEntry[]
}

export interface BattleOptions {
  /** Stop and call it a draw after this many turns. */
  maxTurns?: number
  /** Collect a turn-by-turn log (off by default — it's per-run garbage). */
  log?: boolean
}

const DEFAULT_MAX_TURNS = 300
const TYPE_NORMAL = 0

/** Effective Speed: stage, then paralysis' quarter. */
function speedOf(f: Fighter): number {
  let spe = applyStage(f.c.stats.spe, f.stages.spe, 'spe')
  if (f.status === 'par') spe = Math.floor(spe / 4)
  return Math.max(1, spe)
}

function hitChance(attacker: Fighter, defender: Fighter, move: SimMove): number {
  if (move.effect.kind === 'always-hit') return 100
  const base = accuracyOf(move)
  const acc = stageMultiplier(attacker.stages.acc, 'acc')
  const eva = stageMultiplier(defender.stages.eva, 'eva')
  return Math.max(1, Math.min(100, (base * acc) / eva))
}

function applyBoosts(
  target: Fighter,
  boosts: { stat: BoostableStat; stages: number }[],
  fromFoe: boolean,
  log: (text: string) => void,
): void {
  if (fromFoe && blocksStatDrops(target.c) && boosts.some((b) => b.stages < 0)) {
    log(`${target.c.species}'s ${target.c.abilityName} blocked the stat drop`)
    return
  }
  for (const b of boosts) {
    const before = target.stages[b.stat]
    target.stages[b.stat] = clampStage(before + b.stages)
    if (target.stages[b.stat] !== before) {
      log(`${target.c.species}'s ${b.stat} ${b.stages > 0 ? 'rose' : 'fell'}`)
    }
  }
}

/** Try to inflict a status; returns true when it stuck. */
function applyStatus(target: Fighter, status: Status, rng: Rng, log: (t: string) => void): boolean {
  if (status === 'none') return false
  if (target.status !== 'none') return false
  if (statusImmunity(target.c) === status) {
    log(`${target.c.species}'s ${target.c.abilityName} prevented ${status}`)
    return false
  }
  // Type immunities the engine enforces regardless of the move's own typing.
  if ((status === 'psn' || status === 'tox') && target.c.types.includes(3)) return false
  if (status === 'brn' && target.c.types.includes(10)) return false
  if (status === 'frz' && target.c.types.includes(15)) return false
  if (status === 'par' && target.c.types.includes(13)) return false

  target.status = status
  if (status === 'slp') target.sleepTurns = rng.range(1, 4)
  if (status === 'tox') target.toxicTurns = 1
  log(`${target.c.species} was ${status}`)
  return true
}

/** Damage from one landed hit, applied to the defender. Returns HP removed. */
function dealDamage(
  ctx: SimContext,
  attacker: Fighter,
  defender: Fighter,
  move: SimMove,
  rng: Rng,
): number {
  const crit = rng.next() < critRate(move, defender.c)
  const result = rollDamage(ctx, attacker.c, sideOf(attacker), defender.c, sideOf(defender), move, rng, crit)
  const dealt = Math.min(defender.hp, result.damage)
  defender.hp -= dealt
  return dealt
}

/** Special-cased damage forms that skip the main formula. */
function fixedDamage(
  attacker: Fighter,
  defender: Fighter,
  move: SimMove,
  rng: Rng,
): number | null {
  const e = move.effect
  switch (e.kind) {
    case 'fixed-damage':
      return e.amount ?? 0
    case 'level-damage':
      return attacker.c.level
    case 'psywave':
      return Math.max(1, Math.floor((attacker.c.level * rng.range(5, 15)) / 10))
    case 'super-fang':
      return Math.max(1, Math.floor(defender.hp / 2))
    case 'ohko':
      if (blocksOhko(defender.c)) return 0
      return rng.chance(ohkoAccuracy(attacker.c, defender.c)) ? defender.hp : 0
    default:
      return null
  }
}

/** One combatant's action for the turn. Returns false if the battle is over. */
function takeTurn(
  ctx: SimContext,
  attacker: Fighter,
  defender: Fighter,
  rng: Rng,
  log: (text: string, actor: string) => void,
): void {
  const say = (t: string): void => log(t, attacker.c.species)

  if (attacker.hp <= 0) return

  // Flinch — set by the defender's move earlier this turn.
  if (attacker.flinched) {
    say('flinched')
    return
  }

  // Sleep / freeze / paralysis.
  if (attacker.status === 'slp') {
    if (attacker.sleepTurns > 0) {
      attacker.sleepTurns--
      say('is fast asleep')
      return
    }
    attacker.status = 'none'
    say('woke up')
  }
  if (attacker.status === 'frz') {
    if (!rng.chance(20)) {
      say('is frozen solid')
      return
    }
    attacker.status = 'none'
    say('thawed out')
  }
  if (attacker.status === 'par' && rng.chance(25)) {
    say('is paralyzed and cannot move')
    return
  }

  // Confusion: 50% to hit itself with a 40-power typeless physical attack.
  if (attacker.confusedTurns > 0) {
    attacker.confusedTurns--
    if (rng.chance(50)) {
      const selfHit: SimMove = {
        ...STRUGGLE,
        name: 'confusion',
        power: 40,
        type: TYPE_NORMAL,
        effect: { kind: 'hit', modeled: true, label: '' },
      }
      const result = calcDamage(
        ctx,
        attacker.c,
        sideOf(attacker),
        attacker.c,
        sideOf(attacker),
        { ...selfHit, category: 'physical' },
        { randomPercent: rng.range(85, 100) },
      )
      attacker.hp = Math.max(0, attacker.hp - result.damage)
      say(`hurt itself in confusion (${result.damage})`)
      return
    }
  }

  // Finish a two-turn move, or start one.
  let move: SimMove
  let index = -1
  if (attacker.charging) {
    move = attacker.charging
    attacker.charging = null
  } else {
    const usable = attacker.c.moves.filter((_, i) => attacker.pp[i] > 0)
    const choice = chooseMove(ctx, attacker, defender, usable.length ? usable : [])
    move = choice?.move ?? STRUGGLE
    index = attacker.c.moves.indexOf(move)
    if (index >= 0) attacker.pp[index]--
    if (choice?.reason === 'setup') attacker.usedSetup.add(move.id)
    if (choice?.reason === 'status') attacker.usedStatus.add(move.id)
    if (move.effect.kind === 'charge') {
      attacker.charging = move
      say(`is charging ${move.name}`)
      return
    }
  }

  const effect = move.effect

  // Accuracy.
  if (!rng.chance(hitChance(attacker, defender, move))) {
    say(`${move.name} missed`)
    if (effect.kind === 'recoil' && move.effectId === 45) {
      // Jump Kick family: crash damage on a miss.
      const crash = Math.max(1, Math.floor(attacker.c.stats.hp / 8))
      attacker.hp = Math.max(0, attacker.hp - crash)
      say(`kept going and crashed (${crash})`)
    }
    return
  }

  // Immunity check before anything else fires.
  const { immune } = typeEffectiveness(ctx, move, defender.c)
  const damaging = move.power > 0 || move.effect.kind === 'fixed-damage' ||
    move.effect.kind === 'level-damage' || move.effect.kind === 'psywave' ||
    move.effect.kind === 'super-fang' || move.effect.kind === 'ohko'
  if (immune && damaging) {
    say(`${move.name} had no effect`)
    return
  }

  // Dream Eater fails unless the target is asleep.
  if (effect.requiresSleep && defender.status !== 'slp') {
    say(`${move.name} failed (target isn't asleep)`)
    return
  }

  let dealt = 0
  const fixed = fixedDamage(attacker, defender, move, rng)
  if (fixed !== null) {
    dealt = Math.min(defender.hp, fixed)
    defender.hp -= dealt
    say(`${move.name} dealt ${dealt}`)
  } else if (move.power > 0) {
    let hits = 1
    if (effect.kind === 'multi-hit') hits = [2, 2, 3, 3, 4, 5][rng.int(6)]
    if (effect.kind === 'double-hit') hits = 2
    for (let h = 0; h < hits && defender.hp > 0; h++) {
      dealt += dealDamage(ctx, attacker, defender, move, rng)
    }
    say(`${move.name} dealt ${dealt}${hits > 1 ? ` (${hits} hits)` : ''}`)
  } else {
    say(`used ${move.name}`)
  }

  // Drain / recoil / self-KO.
  if (effect.kind === 'drain' && dealt > 0) {
    const healed = Math.max(1, Math.floor((dealt * (effect.fraction ?? 50)) / 100))
    attacker.hp = Math.min(attacker.c.stats.hp, attacker.hp + healed)
  }
  if (effect.kind === 'recoil' && dealt > 0 && !ignoresRecoil(attacker.c)) {
    const recoil = Math.max(1, Math.floor((dealt * (effect.fraction ?? 25)) / 100))
    attacker.hp = Math.max(0, attacker.hp - recoil)
    say(`was hit by recoil (${recoil})`)
  }
  if (effect.kind === 'explosion') {
    attacker.hp = 0
    say('fainted from the explosion')
  }
  if (effect.kind === 'heal' || effect.kind === 'rest') {
    const healed = Math.floor((attacker.c.stats.hp * (effect.healPercent ?? 50)) / 100)
    attacker.hp = Math.min(attacker.c.stats.hp, attacker.hp + healed)
    if (effect.kind === 'rest') {
      attacker.status = 'slp'
      attacker.sleepTurns = 2
    }
    say(`restored ${healed} HP`)
  }

  // Secondary effects — skipped entirely against Shield Dust.
  const secondariesBlocked = blocksSecondaries(defender.c) && move.power > 0
  if (!secondariesBlocked) {
    const chance = effect.chance ?? 100
    const fires = effect.kind === 'status' || effect.kind === 'boost' ? true : rng.chance(chance)
    if (fires) {
      if (effect.status && effect.status !== 'none') {
        applyStatus(defender, effect.status, rng, say)
      }
      if (effect.confuses && defender.confusedTurns === 0) {
        defender.confusedTurns = rng.range(2, 5)
        say(`${defender.c.species} became confused`)
      }
      if (effect.boosts) {
        const target = effect.boostTarget === 'self' ? attacker : defender
        applyBoosts(target, effect.boosts, target === defender, say)
      }
      if (effect.kind === 'flinch-hit' && defender.hp > 0) defender.flinched = true
    }
  }
}

/** End-of-turn chip damage, healing and Speed Boost. */
function endOfTurn(f: Fighter, log: (t: string, actor: string) => void): void {
  if (f.hp <= 0) return
  const max = f.c.stats.hp
  if (f.status === 'brn' || f.status === 'psn') {
    const chip = Math.max(1, Math.floor(max / 8))
    f.hp = Math.max(0, f.hp - chip)
    log(`took ${chip} from ${f.status}`, f.c.species)
  } else if (f.status === 'tox') {
    const chip = Math.max(1, Math.floor((max * f.toxicTurns) / 16))
    f.hp = Math.max(0, f.hp - chip)
    f.toxicTurns++
    log(`took ${chip} from poison`, f.c.species)
  }
  if (f.hp > 0 && hasLeftovers(f.c)) {
    f.hp = Math.min(max, f.hp + Math.max(1, Math.floor(max / 16)))
  }
  if (f.hp > 0 && !f.berryUsed && f.hp <= max / 2) {
    const heal = berryHeal(f.c)
    if (heal > 0) {
      f.berryUsed = true
      f.hp = Math.min(max, f.hp + heal)
      log(`ate its ${f.c.itemName} (+${heal})`, f.c.species)
    }
  }
  if (f.hp > 0 && hasSpeedBoost(f.c)) f.stages.spe = clampStage(f.stages.spe + 1)
}

/** Run one battle to a conclusion. */
export function simulateBattle(
  ctx: SimContext,
  a: Combatant,
  b: Combatant,
  rng: Rng,
  opts: BattleOptions = {},
): BattleResult {
  const fa = makeFighter(a)
  const fb = makeFighter(b)
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS
  const entries: BattleLogEntry[] = []
  let turn = 0
  const log = (text: string, actor: string): void => {
    if (opts.log) entries.push({ turn, actor, text })
  }

  // Entry abilities.
  if (hasIntimidate(a)) applyBoosts(fb, [{ stat: 'atk', stages: -1 }], true, (t) => log(t, a.species))
  if (hasIntimidate(b)) applyBoosts(fa, [{ stat: 'atk', stages: -1 }], true, (t) => log(t, b.species))

  while (turn < maxTurns && fa.hp > 0 && fb.hp > 0) {
    turn++
    fa.flinched = false
    fb.flinched = false

    // Order: priority first, then Speed, then a coin flip.
    const aMove = fa.charging ?? null
    const bMove = fb.charging ?? null
    const aPriority = aMove?.priority ?? bestPriority(ctx, fa, fb)
    const bPriority = bMove?.priority ?? bestPriority(ctx, fb, fa)
    let aFirst: boolean
    if (aPriority !== bPriority) aFirst = aPriority > bPriority
    else {
      const sa = speedOf(fa)
      const sb = speedOf(fb)
      aFirst = sa === sb ? rng.chance(50) : sa > sb
    }

    const first = aFirst ? fa : fb
    const second = aFirst ? fb : fa
    takeTurn(ctx, first, second, rng, log)
    if (second.hp > 0 && first.hp > 0) takeTurn(ctx, second, first, rng, log)

    endOfTurn(fa, log)
    endOfTurn(fb, log)
  }

  let winner: BattleResult['winner'] = 'draw'
  if (fa.hp > 0 && fb.hp <= 0) winner = 'a'
  else if (fb.hp > 0 && fa.hp <= 0) winner = 'b'
  const survivor = winner === 'a' ? fa : winner === 'b' ? fb : null
  return {
    winner,
    turns: turn,
    winnerHpPercent: survivor ? (survivor.hp / survivor.c.stats.hp) * 100 : 0,
    log: entries,
  }
}

/**
 * The priority of the move this side is most likely to pick — used only for
 * turn order before the choice is made, so a Quick Attack user doesn't lose
 * the ordering coin flip it should win.
 */
function bestPriority(ctx: SimContext, self: Fighter, foe: Fighter): number {
  const usable = self.c.moves.filter((_, i) => self.pp[i] > 0)
  const choice = chooseMove(ctx, self, foe, usable)
  return choice?.move.priority ?? 0
}

export interface BatchResult {
  runs: number
  wins: number
  losses: number
  draws: number
  /** Wins as a percentage of runs. */
  winRate: number
  avgTurns: number
  /** Average remaining HP % across the runs `a` won. */
  avgWinHpPercent: number
}

/**
 * Run the same matchup `runs` times from one seed. The seed is folded with the
 * run index so each battle differs while the batch as a whole is reproducible.
 */
export function simulateMany(
  ctx: SimContext,
  a: Combatant,
  b: Combatant,
  runs: number,
  seed: number,
  opts: BattleOptions = {},
): BatchResult {
  let wins = 0
  let losses = 0
  let draws = 0
  let turns = 0
  let winHp = 0
  for (let i = 0; i < runs; i++) {
    const result = simulateBattle(ctx, a, b, makeRng(seed + i * 0x9e3779b1), opts)
    turns += result.turns
    if (result.winner === 'a') {
      wins++
      winHp += result.winnerHpPercent
    } else if (result.winner === 'b') losses++
    else draws++
  }
  return {
    runs,
    wins,
    losses,
    draws,
    winRate: runs === 0 ? 0 : (wins / runs) * 100,
    avgTurns: runs === 0 ? 0 : turns / runs,
    avgWinHpPercent: wins === 0 ? 0 : winHp / wins,
  }
}
