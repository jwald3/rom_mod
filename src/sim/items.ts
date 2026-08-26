import { norm } from '../lib/names'
import type { Combatant, SimContext, SimMove } from './types'

/**
 * Held items, matched by name. Deliberately minimal: the gym leaders in this
 * build hold Sitrus Berry / Berry Juice and little else, so the engine models
 * the type-boost plates/incenses, Leftovers, and the one-shot healing berries.
 * Everything else is a no-op and shows up in `unmodeledItems` for the report.
 */

/** Type-boosting items: normalized name → the type they add 10% to. */
const TYPE_BOOST: Record<string, number> = {
  SILKSCARF: 0,
  BLACKBELT: 1,
  SHARPBEAK: 2,
  POISONBARB: 3,
  SOFTSAND: 4,
  HARDSTONE: 5,
  SILVERPOWDER: 6,
  SPELLTAG: 7,
  METALCOAT: 8,
  CHARCOAL: 10,
  MYSTICWATER: 11,
  MIRACLESEED: 12,
  MAGNET: 13,
  TWISTEDSPOON: 14,
  NEVERMELTICE: 15,
  DRAGONFANG: 16,
  BLACKGLASSES: 17,
  SEAINCENSE: 11,
  ODDINCENSE: 14,
  ROSEINCENSE: 12,
  WAVEINCENSE: 11,
}

/** One-shot healing berries: name → HP restored (flat) or percent of max. */
const HEAL_ITEMS: Record<string, { flat?: number; percent?: number }> = {
  ORANBERRY: { flat: 10 },
  SITRUSBERRY: { percent: 25 },
  BERRYJUICE: { flat: 20 },
  LEPPABERRY: {}, // restores PP, not HP — modeled as no heal
}

const LEFTOVERS = 'LEFTOVERS'

/** The item's display name for a combatant, or '' when it holds nothing. */
export function itemNameOf(ctx: SimContext, itemId: number): string {
  return itemId > 0 ? (ctx.itemNames[itemId] ?? `item#${itemId}`) : ''
}

/** Damage multiplier from the attacker's item, as a numerator over 100. */
export function itemDamageBoost(attacker: Combatant, move: SimMove): number {
  if (!attacker.item) return 100
  const boostType = TYPE_BOOST[norm(attacker.itemName)]
  return boostType === move.type ? 110 : 100
}

/** Leftovers: 1/16 max HP at the end of each turn. */
export function hasLeftovers(c: Combatant): boolean {
  return norm(c.itemName) === LEFTOVERS
}

/**
 * How much a held healing berry restores at ≤50% HP, or 0 if the item isn't
 * one. Each berry fires once per battle — the caller tracks that.
 */
export function berryHeal(c: Combatant): number {
  const entry = HEAL_ITEMS[norm(c.itemName)]
  if (!entry) return 0
  if (entry.percent) return Math.max(1, Math.floor((c.stats.hp * entry.percent) / 100))
  return entry.flat ?? 0
}

/** True when we recognize the item at all (so the report can list the rest). */
export function isModeledItem(name: string): boolean {
  const key = norm(name)
  return key === '' || key === LEFTOVERS || key in TYPE_BOOST || key in HEAL_ITEMS
}
