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
npm test                    # 132 tests incl. real-ROM integration (skipped if ROM absent)
node scripts/smoke.mjs      # 19-step headless drive of the Heart & Soul ROM (dev server must be up)
```

`PLAN.md` documents the architecture, the ROM's verified table layout, and the
phase history. `scripts/apply-*.mts` are examples of scripting the ROM library
directly (fossil/Staryu wild placement, held-item availability).
