# rom_mod — FireRed mod + moveset editor

Two things live here:

1. **`rom/`** — the mod itself, distributed as an IPS patch (no copyrighted
   ROM in this repo):
   - `GPT_Mods.ips` — reconstruct the modded ROM byte-for-byte with one
     command (no external tools):

     ```sh
     npx tsx scripts/apply-patch.mts path/to/GPT_Fresh.gba
     ```

     (Floating IPS / Lunar IPS / online IPS tools work too.)
   - `GPT_Mods.toml` — the Hex Maniac Advance sidecar (table anchors). Keep it
     next to the reconstructed `.gba`; the editor and HMA both use it.
   - Regenerate the patch after new edits: `npx tsx scripts/make-patch.mts`

2. **The editor** — a browser-based editor for Hex Maniac Advance–modified
   Pokémon FireRed (BPRE) ROMs, plus the **Pokémon Heart & Soul** Emerald hack
   (BPEE, pokéemerald-expansion). Everything runs client-side; the ROM never
   leaves your machine. Edits level-up movesets, TM/HM + tutor compatibility
   (and the tutor move roster itself — which move each tutor slot teaches),
   evolutions (vanilla's 15 methods plus expansion's such as "knows move"; up
   to 8 branches per species on Heart & Soul), wild encounters (grass/surf/rock-smash/
   fishing, rates, levels, species), and NPC trainer teams (class, name,
   double-battle, per-Pokémon species/level/difficulty/held-item/moves), with
   undo/redo, a diff view against a baseline ROM, reverse "Locations" lookup,
   and in-place saving with free-space repointing, backups, and write
   verification.

   The editor picks its table layout from the ROM's game code. Heart & Soul
   repointed every table into expanded space and ships a stale `.toml`, so its
   addresses are **built in** (`HS_BPEE` in `src/rom/anchors.ts`, reverse-
   engineered and verified by `scripts/hs-locate.mjs`); base-stats structs are
   40 bytes there vs. 28 in FireRed, and its Emerald-style region-map name table
   (8-byte entries) resolves wild-area labels to the Johto/Kanto town and route
   names. Verify a build against the ROM with
   `npx tsx scripts/hs-verify.mts <rom> [toml]` (reads) and
   `npx tsx scripts/hs-writetest.mts <rom> [toml]` (write round-trip).
   Spot-check the `heart-and-soul-guide.html` gym/E4/Red rosters against the
   ROM with `npm run verify:gyms -- <rom>` (diffs species/level/held-item/moves;
   `npm run verify:gyms:extract` rebuilds the ground-truth JSON from the guide).

### Balance harness (`scripts/balance.mts`)

A read-only simulator for answering "is this Pokémon any good, and would this
change help?" without playing the game. Two layers over the same ROM readers
the editor uses: a deterministic matchup calculator (damage both ways, turns to
KO, speed) and a seeded Monte Carlo 1v1 battle sim on top of it.

```sh
npm run balance -- "<rom.gba>" --mon Feraligatr
npm run balance -- "<rom.gba>" --mon Typhlosion --gyms "Bugsy,Pryce" --no-mc
npm run balance -- "<rom.gba>" --mon Ampharos --overrides whatif.json --html report.html
```

The default cohort is the gym leaders, Elite Four and Red, read out of the
ROM's own trainer table at their real levels and movesets; `--cohort band|dex`
swaps in BST neighbours or the fully-evolved dex. `--overrides` takes a
name-keyed JSON of hypothetical stat/type/ability/move/learnset changes,
applies them to an **in-memory** copy, and prints baseline → modified with the
per-matchup delta — so a change can be judged before an `apply-*` script
commits it to the ROM:

```json
{
  "species": { "AMPHAROS": { "stats": { "spe": 95 }, "addMoves": ["40:THUNDER WAVE"] } },
  "moves": { "THUNDERBOLT": { "power": 105 } }
}
```

Runs are reproducible: same seed and same inputs give byte-identical output.
The engine (`src/sim/`) is pure — no filesystem, no argv, no console — so the
React editor can drive it later.

The same harness backs the guide's **Tier List** chapter, which ranks the whole
reachable dex by simulated win rate against the benchmark cohort. Regenerate it
with `npx tsx scripts/gen-tierlist-data.mts <rom>` (ROM → `tierlist-data.json`)
→ `gen-tierlist-html.mts` → `node scripts/splice-tierlist.mjs`.
 It models the Gen-3 damage formula with the
engine's integer truncation, stat stages, status, crits, accuracy, PP and
Struggle, plus the abilities and held items listed in `src/sim/abilities.ts` and
`src/sim/items.ts`; every report footer states its move-effect coverage and what
it didn't model (weather, screens, Protect/Counter, switching, natures, badge
boosts).

The type chart it needs isn't in the HMA sidecar — it was located structurally
at `0x6E13BC` (120 rows). Heart & Soul carries **two** such tables, both
referenced from adjacent literal-pool words; the neighbour at `0x6E1258` is
missing six standard matchups (Ground→Rock ×2, Rock→Ground ×½, Ice→Water ×½,
Steel→Ice ×2, Bug→Ghost ×½, Bug→Fairy ×½) and adds a non-canonical
Rock→Rock ×½, so the reader validates the canonical matchups before trusting an
address and scans nearby if they fail.

### Heart & Soul base version

The ROM carries no readable version string (only the vanilla
`"pokemon emerald version"` header), so the base was identified structurally:
**pokeemerald-expansion, battle-engine-v2 era (~1.x, pre-2.0, roughly 2020)**,
heavily customized. Fingerprints:

- `struct BaseStats` = **40 bytes** (vanilla Emerald is 28) — expansion battle-engine era
- Evolutions = **8 slots / 64-byte blocks** per species (vanilla 5)
- Types = 19, with **Fairy at index 18 and the vanilla `???` slot retained at 9**
  — this is **pre-2.0** (2.0+ dropped `???` and reordered the type enum)
- 462 species, 82 abilities, 368 moves — a small hand-curated set, not the
  modern full dex (abilities end Transistor/Dragon's Maw/Pixilate; moves end
  Play Rough/Moonblast/Poison Jab)

**In-game trades: found and extracted.** `gIngameTrades` sits at
**`0xD1C104`** with **64-byte records** — not the vanilla 60, which is why every
earlier pointer-walk for 60-byte runs missed it. The extra 4 bytes land in the
middle block, shifting the tail: species@`0x0C`, ivs@`0x0E`, heldItem@`0x2C`,
otName@`0x2F`, requestedSpecies@`0x3C`. The table was located by seeding a byte
search with one in-game-confirmed trade (Violet City: Bellsprout → an Onix
nicknamed "ROCKY" from OT "RUDY"), exactly the seed this section used to call
for. See `src/rom/tables/ingameTrades.ts`.

13 records are authored, every one with flawless 31 IVs, but only **6 are wired
to a script** and only **4 of those sit on a live Johto/Kanto map** (Violet,
Goldenrod, Olivine, Blackthorn — the other two are triggered by NPCs left over
from the Emerald base). NPC scripts stage the index in `VAR_0x8008`, copy it to
`VAR_0x8004`, then call `special 0xA8`; gym scripts reuse `VAR_0x8008` as a
leader index, so the copyvar+special pair is the discriminator.
`scripts/gen-trades-data.mts` writes the table plus its per-trade town to
`scripts/trades-data.json`, which feeds the guide's **In-Game Trades** section.

**Egg moves** are at **`0x749188`** in the vanilla `gEggMoves` shape — a flat
u16 array of `species + 20000` markers followed by move ids, with no count
field, so the reader stops on the first word that is neither a valid marker nor
a valid move. Heart & Soul has **166 species / 991 moves**
(`src/rom/tables/eggMoves.ts`).

## Editor usage

```sh
npm install
npm run dev
```

Open the printed URL, then load the `.gba` (and, for FireRed mods, its `.toml`)
together via "Open files…" (grants the file handle so Ctrl+S saves in place).
Without a toml, FireRed ROMs fall back to vanilla 1.0 offsets; Heart & Soul
(BPEE) uses its built-in profile and needs no toml.

## Tests

```sh
npm test                    # 202 tests incl. real-ROM integration (skipped if the ROM's absent)
node scripts/smoke.mjs      # 19-step headless drive of the Heart & Soul ROM (dev server must be up)
```

The real-ROM integration suites need the (non-repo) ROMs. `tests/romPath.ts`
checks a few known locations and, failing that, the `HS_ROM` / `FR_ROM`+`FR_TOML`
env vars — set those to run the suites on a fresh checkout; otherwise they skip.

`PLAN.md` documents the architecture, the ROM's verified table layout, and the
phase history. `scripts/apply-*.mts` are examples of scripting the ROM library
directly (fossil/Staryu wild placement, held-item availability).
