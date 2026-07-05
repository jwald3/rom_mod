import type { AnchorMap } from './anchors'

/**
 * Parser for Hex Maniac Advance .toml sidecar files.
 *
 * HMA records every table it knows about (including ones it repointed) as
 * [[NamedAnchors]] blocks with a Name, Address, and Format string. We only
 * need addresses plus the trailing element count of each Format, e.g.
 *   [name""13]356                    → count 356
 *   [...]!FFFF>]data.pokemon.names   → count = count of that anchor
 *   [x.]data.pokemon.names-1+2       → simple +/- arithmetic on counts
 */

export interface NamedAnchor {
  name: string
  address: number
  format: string
}

export function parseNamedAnchors(text: string): Map<string, NamedAnchor> {
  const anchors = new Map<string, NamedAnchor>()
  const blocks = text.split('[[NamedAnchors]]').slice(1)
  for (const block of blocks) {
    const name = /Name\s*=\s*'''(.*?)'''/.exec(block)?.[1]
    const addr = /Address\s*=\s*(0x[0-9A-Fa-f]+|\d+)/.exec(block)?.[1]
    const format = /Format\s*=\s*'''(.*?)'''/.exec(block)?.[1] ?? ''
    if (name && addr !== undefined) {
      anchors.set(name, { name, address: Number(addr), format })
    }
  }
  return anchors
}

/** Element count of an anchor's table, from its Format's trailing expression. */
export function anchorCount(
  name: string,
  anchors: Map<string, NamedAnchor>,
  depth = 0,
): number | null {
  if (depth > 8) return null
  const anchor = anchors.get(name)
  if (!anchor) return null
  const idx = anchor.format.lastIndexOf(']')
  if (idx < 0) return null
  return evalCountExpr(anchor.format.slice(idx + 1), anchors, depth)
}

const TERM = /^([A-Za-z][\w.]*|\d+)/

function evalCountExpr(
  expr: string,
  anchors: Map<string, NamedAnchor>,
  depth: number,
): number | null {
  expr = expr.trim()
  const evalTerm = (t: string): number | null =>
    /^\d+$/.test(t) ? Number(t) : anchorCount(t, anchors, depth + 1)

  const first = TERM.exec(expr)
  if (!first) return null
  let total = evalTerm(first[1])
  if (total === null) return null

  let rest = expr.slice(first[1].length)
  while (rest.length > 0) {
    const m = /^([+-])([A-Za-z][\w.]*|\d+)/.exec(rest)
    if (!m) return null // trailing junk we don't understand — treat as unresolvable
    const v = evalTerm(m[2])
    if (v === null) return null
    total += m[1] === '+' ? v : -v
    rest = rest.slice(m[0].length)
  }
  return total
}

/** HMA anchor names → AnchorMap fields. */
const NAME_MAP: Record<string, { addr: keyof AnchorMap; count?: keyof AnchorMap }> = {
  'data.pokemon.names': { addr: 'speciesNames', count: 'speciesCount' },
  'data.pokemon.moves.names': { addr: 'moveNames', count: 'moveCount' },
  'data.pokemon.moves.stats.battle': { addr: 'moveStats' },
  'data.pokemon.moves.levelup': { addr: 'learnsets' },
  'data.pokemon.stats': { addr: 'baseStats' },
  'data.pokemon.type.names': { addr: 'typeNames', count: 'typeCount' },
  'data.abilities.names': { addr: 'abilityNames', count: 'abilityCount' },
  'data.pokemon.moves.tms': { addr: 'tms', count: 'tmCount' },
  'data.pokemon.moves.tutors': { addr: 'tutors', count: 'tutorCount' },
  'data.pokemon.moves.tmcompatibility': { addr: 'tmCompat' },
  'data.pokemon.moves.tutorcompatibility': { addr: 'tutorCompat' },
  'data.pokemon.evolutions': { addr: 'evolutions' },
  'data.items.stats': { addr: 'items' }, // count ref (data.items.count) is a MatchedWord — keep default
  'data.pokemon.wild': { addr: 'wild' },
  'data.maps.banks': { addr: 'mapBanks' },
  'data.maps.names': { addr: 'mapNames', count: 'mapNameCount' },
}

/**
 * Extract the anchors we care about from a .toml sidecar. Fields whose count
 * expression can't be resolved (e.g. references to HMA-internal constants
 * like data.pokemon.type.length) are simply omitted so callers keep defaults.
 */
export function anchorsFromToml(text: string): { anchors: Partial<AnchorMap>; found: string[] } {
  const parsed = parseNamedAnchors(text)
  const out: Partial<AnchorMap> = {}
  const found: string[] = []
  for (const [hmaName, fields] of Object.entries(NAME_MAP)) {
    const anchor = parsed.get(hmaName)
    if (!anchor) continue
    out[fields.addr] = anchor.address
    found.push(hmaName)
    if (fields.count) {
      const count = anchorCount(hmaName, parsed)
      if (count !== null && count > 0) out[fields.count] = count
    }
  }
  return { anchors: out, found }
}
