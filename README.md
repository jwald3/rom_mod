# rom_mod — FireRed mod + moveset editor

Two things live here:

1. **`rom/`** — the mod itself, distributed as an IPS patch (no copyrighted
   ROM in this repo):
   - `GPT_Mods.ips` — apply to the `GPT_Fresh.gba` base with
     [Floating IPS](https://www.smwcentral.net/?p=section&a=details&id=11474),
     Lunar IPS, or any online IPS tool to reconstruct the modded ROM
     byte-for-byte.
   - `GPT_Mods.toml` — the Hex Maniac Advance sidecar (table anchors). Keep it
     next to the reconstructed `.gba`; the editor and HMA both use it.
   - Regenerate the patch after new edits: `npx tsx scripts/make-patch.mts`

2. **The editor** — a browser-based editor for Hex Maniac Advance–modified
   Pokémon FireRed (BPRE) ROMs. Everything runs client-side; the ROM never
   leaves your machine. Edits level-up movesets, TM/HM + tutor compatibility,
   evolutions (all 15 methods), and wild encounters (grass/surf/rock-smash/
   fishing, rates, levels, species), with undo/redo, a diff view against a
   baseline ROM, reverse "Locations" lookup, and in-place saving with
   free-space repointing, backups, and write verification.

## Editor usage

```sh
npm install
npm run dev
```

Open the printed URL, then load the `.gba` **and** its `.toml` together via
"Open files…" (grants the file handle so Ctrl+S saves in place). Without the
toml, vanilla FireRed 1.0 offsets are used as a fallback.

## Tests

```sh
npm test                    # 86 tests incl. real-ROM integration (skipped if ROM absent)
node scripts/smoke.mjs      # headless browser drive of the running dev server
```

`PLAN.md` documents the architecture, the ROM's verified table layout, and the
phase history. `scripts/apply-*.mts` are examples of scripting the ROM library
directly (fossil/Staryu wild placement, held-item availability).
