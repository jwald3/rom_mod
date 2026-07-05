/**
 * Score a query against a target name. Higher is better; null means no match.
 * Spaces/punctuation are ignored so "vinewhip" matches "VINE WHIP" and
 * "thbolt" (subsequence) matches "THUNDERBOLT".
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const t = target.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!q) return 0
  if (t.startsWith(q)) return 1000 - t.length
  const idx = t.indexOf(q)
  if (idx >= 0) return 500 - idx
  // subsequence match — penalize gaps
  let pos = 0
  let gaps = 0
  let last = -1
  for (const ch of q) {
    const found = t.indexOf(ch, pos)
    if (found < 0) return null
    if (last >= 0) gaps += found - last - 1
    last = found
    pos = found + 1
  }
  return 100 - gaps
}
