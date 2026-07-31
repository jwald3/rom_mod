/**
 * Extract a full per-species dataset from the ROM for the guide's Pokédex
 * section: type, abilities, stats+BST, wild held items, evolutions, complete
 * level-up learnset, and in-game locations (derived from the verified wild
 * encounter tables). Writes scripts/pokedex-data.json.
 *
 *   npx tsx scripts/gen-pokedex-data.mts "<rom.gba>" [toml]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { loadRom } from '../src/rom/loadRom'
import { readEvolutionsFor, describeEvolution } from '../src/rom/tables/evolutions'
import { readLearnset } from '../src/rom/tables/learnsets'
import { WILD_KIND_LABELS, type WildKind } from '../src/rom/tables/wild'

const here = dirname(fileURLToPath(import.meta.url))
const romPath = process.argv[2]
if (!romPath) { console.error('usage: npx tsx scripts/gen-pokedex-data.mts "<rom.gba>" [toml]'); process.exit(2) }
const toml = process.argv[3] ? readFileSync(process.argv[3], 'utf8') : undefined
const r = loadRom(new Uint8Array(readFileSync(romPath)), romPath.split(/[\\/]/).pop()!, toml)
const sp = (id: number) => r.species[id]?.name ?? `#${id}`
const isGap = (n: string) => !n || /^\?+$/.test(n)

// ── location index: species → { zoneName → Set(methods) } ──
const loc = new Map<number, Map<string, Set<WildKind>>>()
for (const a of r.wildAreas) {
  if (/^Map \d/.test(a.name)) continue // skip unresolved vestigial maps
  for (const k of ['grass', 'surf', 'fish', 'tree'] as const) {
    const g = a.groups[k]; if (!g) continue
    for (const s of g.slots) {
      if (s.species <= 0) continue
      if (!loc.has(s.species)) loc.set(s.species, new Map())
      const m = loc.get(s.species)!
      if (!m.has(a.name)) m.set(a.name, new Set())
      m.get(a.name)!.add(k)
    }
  }
}
// species obtained by evolving FROM something (so we can note "evolve X")
const evoFrom = new Map<number, number[]>()
for (let s = 0; s < r.species.length; s++) {
  for (const e of readEvolutionsFor(r.rom, r.anchors, s)) {
    if (e.target > 0) { if (!evoFrom.has(e.target)) evoFrom.set(e.target, []); evoFrom.get(e.target)!.push(s) }
  }
}

const out: any[] = []
for (let id = 0; id < r.species.length; id++) {
  const s = r.species[id]
  if (isGap(s.name)) continue
  const st = s.stats
  const bst = st.hp + st.atk + st.def + st.spa + st.spd + st.spe
  const evos = readEvolutionsFor(r.rom, r.anchors, id).filter((e) => e.target > 0).map((e) => ({
    to: sp(e.target), toId: e.target, how: describeEvolution(e, r.itemNames),
  }))
  const learn = readLearnset(r.rom, r.anchors, id).entries.map((e) => ({ lv: e.level, move: r.moves[e.moveId]?.name ?? `#${e.moveId}` }))
  // locations
  const wild: { zone: string; methods: string[] }[] = []
  const lm = loc.get(id)
  if (lm) for (const [zone, methods] of lm) wild.push({ zone, methods: [...methods].map((k) => WILD_KIND_LABELS[k]) })
  wild.sort((a, b) => a.zone.localeCompare(b.zone))
  const from = (evoFrom.get(id) ?? []).map(sp)
  out.push({
    id, name: s.name,
    types: s.type2 !== s.type1 ? [r.typeNames[s.type1], r.typeNames[s.type2]] : [r.typeNames[s.type1]],
    abilities: [s.ability1, s.ability2].filter((a, i) => i === 0 || a).map((a) => r.abilityNames[a]).filter(Boolean),
    stats: { hp: st.hp, atk: st.atk, def: st.def, spa: st.spa, spd: st.spd, spe: st.spe, bst },
    heldItems: [s.heldItem1, s.heldItem2].filter((x) => x).map((x) => r.itemNames[x]),
    evolves: evos,
    evolvesFrom: from,
    learnset: learn,
    wild,
  })
}

writeFileSync(resolve(here, 'pokedex-data.json'), JSON.stringify(out))
console.log(`wrote ${out.length} species profiles → scripts/pokedex-data.json`)
const withLoc = out.filter((o) => o.wild.length).length
console.log(`  with a wild location: ${withLoc} | with a sprite in guide: (resolved at render)`)
