/**
 * Name helpers shared by the guide generators, ROM verifiers and the balance
 * harness — every one of those had re-derived `norm` inline.
 *
 * `norm` folds a display name to a comparison key: uppercase, drop everything
 * but A–Z/0–9, so "Mud-Slap" ≡ "MUD-SLAP", "Ancientpower" ≡ "ANCIENTPOWER" and
 * "NIDORAN♀" folds to "NIDORAN".
 */
export const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** True for the ROM's placeholder slots — blank, or all question marks. */
export const isGapName = (n: string): boolean => !n || /^\?+$/.test(n)

/**
 * normalized name → id, over a ROM name table (species, moves, items…).
 * Placeholder slots are skipped and the *first* id wins, so a later duplicate
 * (NIDORAN♀ and NIDORAN♂ fold to the same key) can't shadow the earlier one.
 */
export function nameIndex(names: readonly string[]): Map<string, number> {
  const index = new Map<string, number>()
  names.forEach((name, id) => {
    if (isGapName(name)) return
    const key = norm(name)
    if (!key || index.has(key)) return
    index.set(key, id)
  })
  return index
}

/** Names whose key contains, or is contained by, `raw` — for "did you mean". */
export function suggestNames(
  index: ReadonlyMap<string, number>,
  raw: string,
  limit = 4,
): string[] {
  const key = norm(raw)
  if (!key) return []
  const hits: string[] = []
  for (const candidate of index.keys()) {
    if (candidate.startsWith(key) || key.startsWith(candidate) || candidate.includes(key)) {
      hits.push(candidate)
      if (hits.length >= limit) break
    }
  }
  return hits
}

/**
 * Look up `raw` in a name index, throwing a message that names the closest
 * matches. `what` is the noun used in the error ("species", "move", …).
 */
export function resolveName(index: ReadonlyMap<string, number>, raw: string, what: string): number {
  const id = index.get(norm(raw))
  if (id !== undefined) return id
  const near = suggestNames(index, raw)
  throw new Error(
    `unknown ${what} “${raw}”` + (near.length ? ` — did you mean ${near.join(', ')}?` : ''),
  )
}
