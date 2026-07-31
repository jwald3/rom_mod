# FireRed Moveset Editor — Execution Plan

A client-side web app for quickly editing Pokémon level-up movesets in a
Hex Maniac Advance–modified FireRed ROM. Faster and more intuitive than HMA's
table editor for this one job.

## Verified ground truth (recon done 2026-07-05 against `20260426__GPT_Mods.gba`)

All of the following was confirmed by reading real bytes, not assumed:

| Fact | Value |
|---|---|
| ROM | `BPRE` v1.0, 16 MB (16,777,216 bytes) |
| Species names table | `0x245EE0`, 412 entries × 11 bytes, Gen 3 charmap |
| Move names table | `0x71A780` (repointed), **356 entries** × 13 bytes — #355 is custom move `CARVE` |
| Move battle stats | `0x71C600` (repointed): effect, power, type, accuracy, PP, … per move |
| Learnset pointer table | `0x25D7B4`, 412 × 4-byte pointers |
| Learnset entry format | packed `u16` LE: `level = v >> 9`, `move = v & 0x1FF`, list ends with `0xFFFF` |
| Sanity check | Species[1] decodes to `BULBASAUR`; learnset ptr `0x08257494` → Lv1 TACKLE, Lv4 GROWL, … Lv46 SOLARBEAM (11 moves) ✓ |
| Base stats | `0x254784` |
| TM list / TM compat | `0x45A80C` (58 moves) / `0x252BC8` (bitfield per species) |
| Tutors / tutor compat | `0x459B60` (15) / `0x459B7E` |
| HMA sidecar | `20260426__GPT_Mods.toml` — `[[NamedAnchors]]` blocks record every (re)pointed table |
| Free space | HMA's `FreeSpaceSearch = 0x71DA00` hint is **stale** (that region is now used). Actual large `0xFF` runs: `~0x71DC00–0xD00000` (~6 MB) and `~0xEB0C00–0x1000000` (~1.3 MB) |
| GBA pointer format | 4-byte LE, `0x08000000 + offset` |

Companion baseline ROM `GPT_Fresh.gba` (+ its toml) sits in the same folder — usable for diffing.

## Heart & Soul ground truth (BPEE, recon against `Pokemon Heart & Soul (no-fairy).gba`)

A separate target: the **Pokémon Heart & Soul** Emerald hack (`BPEE`, 32 MB). Its
tables are repointed into expanded space and it ships a stale `.toml`, so the
addresses are built into `HS_BPEE` in `src/rom/anchors.ts`. The **base version
carries no readable string** (only the vanilla `"pokemon emerald version"`
header), so it was identified structurally:

| Fact | Value |
|---|---|
| Base | **pokeemerald-expansion, battle-engine-v2 era (~1.x, pre-2.0, ~2020)**, heavily customized |
| `struct BaseStats` | **40 bytes** (vanilla Emerald 28) — expansion battle-engine era |
| Evolutions | **8 slots / 64-byte blocks** per species (vanilla 5); methods used ≤ 27 |
| Types | 19 — **Fairy at index 18, vanilla `???` retained at 9** → pre-2.0 (2.0+ dropped `???`, reordered) |
| Counts | 462 species, 82 abilities, 368 moves — small hand-curated set, not the modern full dex |
| Sanity check | Bulbasaur base stats decode 45/49/49/45(spe)/65/65, types 12/3 (Grass/Poison) ✓ |
| Region-map names | Emerald-style 8-byte entries (`0x96db40`), resolves wild areas to Johto/Kanto town/route labels |

**In-game trades are not machine-readable here.** The `InGameTrade` struct is
the standard 60 bytes (species@`0x0C`, heldItem@`0x28`, otName@`0x2B`,
requestedSpecies@`0x38`), but `gIngameTrades` was **relocated** out of the
vanilla Emerald address (`0x615a08`, now garbage) into expanded space and can't
be isolated by scanning — walking every `0x08` pointer for runs of valid records
yields only coincidental matches (garbage charmap nicknames). The trades exist
in-game (guide notes the Cerulean gatehouse + Cianwood-area NPC trades), so the
guide's **In-Game Trades** section uses the canonical HG/SS list, every
species/item ROM-validated and flagged "confirm in-game." Real extraction needs
the hack's `.sym`/`.map`, or one in-game-confirmed trade (town + give→get +
nickname) to seed a byte-exact search.

## Architecture

- **Fully client-side SPA. No backend.** The ROM never leaves the machine.
- **Stack:** Vite + React 18 + TypeScript + Tailwind CSS. Zustand for state.
- **File I/O:** File System Access API (Chrome/Edge) for open-and-save-in-place with a
  timestamped `.bak` written on first save per session. Fallback: `<input type=file>` +
  download for other browsers.
- **Parsing:** `DataView` over one `ArrayBuffer`; edits applied to a working copy,
  committed transactionally on save.
- **Address resolution:** parse the HMA `.toml` sidecar when present (drag both files, or
  auto-pick the matching `.toml` via directory handle); fall back to vanilla BPRE offsets
  with a sanity check (species[1] must decode to `BULBASAUR` — if not, prompt for the toml).

## Project structure

```
moveset-editor/
  PLAN.md                      ← this file
  src/
    rom/
      buffer.ts                RomBuffer: DataView wrappers, ptr<->offset math
      charmap.ts               full Gen 3 text codec (decode + encode w/ validation)
      anchors.ts               AnchorMap type + vanilla BPRE defaults
      hmaToml.ts               [[NamedAnchors]] parser → AnchorMap (Name/Address/count)
      tables/
        species.ts             names, count detection, base-stat context (types)
        moves.ts               names + battle stats (type/power/acc/pp)
        learnsets.ts           read, serialize, capacity tracking
        freespace.ts           0xFF-run allocator (scan, verify, reserve)
      writer.ts                transactional write-back: in-place | repoint, old-data erase
    state/
      romStore.ts              loaded ROM, parsed tables, file handles
      editStore.ts             per-species draft learnsets, dirty set, undo/redo stack
    components/
      SpeciesSidebar.tsx       fuzzy-search list, dirty markers, gap-species toggle
      LearnsetEditor.tsx       the main table
      MoveRow.tsx              level input + move cell + remove
      MovePicker.tsx           fuzzy autocomplete w/ type·power·acc·pp columns
      SaveBar.tsx              modified count, Save to ROM, Download copy
      DiffView.tsx             (phase 4) vs GPT_Fresh.gba
    App.tsx
  tests/                       vitest; synthetic mini-ROM fixture built in-code
```

## Core types

```ts
interface LearnsetEntry { level: number; moveId: number }        // level 1–100, move 1–511
interface Learnset {
  species: number
  entries: LearnsetEntry[]
  origOffset: number          // where the list currently lives in ROM
  origCapacity: number        // u16 slots available at origOffset (incl. terminator)
}
interface MoveInfo { id: number; name: string; type: number; power: number; accuracy: number; pp: number }
interface AnchorMap { speciesNames: Addr; speciesCount: number; moveNames: Addr; moveCount: number;
                      moveStats: Addr; learnsets: Addr; baseStats: Addr; /* tm/tutor later */ }
```

## Key algorithms

### HMA toml parsing (`hmaToml.ts`)
Only `Name`, `Address`, and the trailing count of `Format` are needed. Counts are either
literal (`[name""13]356` → 356) or a reference (`]data.pokemon.names` → resolve to that
anchor's count, 412). Regex-per-block parsing is sufficient; unknown anchors ignored.
Element sizes (11 for species names, 13 for move names, etc.) are hardcoded per anchor —
we don't need a full HMA format-string interpreter.

### Free-space allocator (`freespace.ts`)
1. Never trust `FreeSpaceSearch` (proven stale). Scan for `0xFF` runs starting at a floor
   of `0x700000`, requiring `neededBytes + 16` slack and 4-byte alignment.
2. Track in-session reservations so two grown learnsets in one save don't collide.
3. Re-verify the target region is still all `0xFF` immediately before writing.

### Write-back (`writer.ts`)
Per modified species, against a **copy** of the buffer:
- Serialize: entries sorted by level (stable — same-level order is meaningful in-game),
  each `u16 = (level << 9) | moveId`, append `0xFFFF`.
- If `newSize <= origCapacity` → write in place, fill remaining slots with `0xFF`.
- Else → allocate free space, write there, update the species' pointer at
  `learnsets + 4*species`, erase the old list to `0xFF` **only if no other species points
  at it** (see shared-pointer edge case).
Then write the whole buffer to disk once (after `.bak`). On success, re-read learnsets so
`origOffset/origCapacity` reflect the new reality.

## UI spec

```
┌────────────────┬───────────────────────────────────────────────────┐
│ 🔍 bulb▏       │  #001 BULBASAUR   GRASS/POISON            ● dirty │
│ ▸ BULBASAUR ●  │ ┌─ Lv ─┬─ Move ─────────┬ Type ─┬ Pow ┬ Acc ┬───┐ │
│   IVYSAUR      │ │  1   │ TACKLE         │ NORMAL│  35 │  95 │ ✕ │ │
│   VENUSAUR     │ │  4   │ GROWL          │ NORMAL│   — │ 100 │ ✕ │ │
│   ...          │ │  7   │ LEECH SEED     │ GRASS │   — │  90 │ ✕ │ │
│                │ │ 46   │ SOLARBEAM      │ GRASS │ 120 │ 100 │ ✕ │ │
│ ☐ show ? gaps  │ └──────┴────────────────┴───────┴─────┴─────┴───┘ │
│                │  + Add move (Enter)   [Copy] [Paste] [Revert]     │
├────────────────┴───────────────────────────────────────────────────┤
│  3 species modified                 [ Save to ROM ]  [ Download ]   │
└─────────────────────────────────────────────────────────────────────┘
```

Keyboard model (the whole point — faster than HMA):
- `↑/↓` move between rows; `Enter` new row → focus move autocomplete; `Tab` level ↔ move
- `Del` remove row; `Ctrl+Z / Ctrl+Y` undo/redo; `Ctrl+S` save; `Ctrl+K` jump to species search
- Move picker: fuzzy match ("thbolt" → THUNDERBOLT), arrow+Enter select, shows
  type/power/acc/pp inline, recently-used moves float to top
- Auto-resort by level on row blur; duplicate (level, move) pairs flagged

Validation (inline, non-blocking warnings unless marked ✋hard):
- ✋ move ID 0 or ≥ moveCount; ✋ level > 100
- ⚠ level 0 (technically encodable, almost certainly a mistake)
- ⚠ duplicate move in the same learnset; ⚠ > 25 moves (relearner UI limits)

## Edge cases

- **Species 0 (`??????????`) and gap species 252–276** (`?` placeholders between Celebi
  and Treecko): hidden behind the "show ? gaps" toggle, still editable.
- **Shared learnset pointers:** if ≥2 species point at the same list, editing one does
  clone-on-write (allocate new space for the edited species) and surfaces a notice.
- **Empty learnset** (immediate `0xFFFF`): render empty table, allow adds.
- **Move field is 9 bits** → hard cap at move ID 511; guard in picker if the mod ever
  expands past that.
- **Concurrent HMA use:** app detects file changed-on-disk before save (compare a hash of
  the originally loaded bytes vs. re-read) and refuses to clobber; tell user to reload.
- **No toml / wrong toml:** vanilla-offset fallback + `BULBASAUR` sanity check; on
  failure, ask the user to supply the sidecar.

## Testing & verification

- **Unit (vitest):** charmap round-trip incl. every mapped byte; learnset decode/encode
  round-trip; writer in-place vs. repoint paths; allocator collision + reservation;
  toml count-reference resolution. Fixture = synthetic ~64KB mini-ROM constructed in
  test code (no copyrighted bytes in the repo).
- **Milestone verification (manual, per phase):**
  1. Phase 1: app's Bulbasaur learnset matches HMA's view exactly, custom move CARVE
     renders by name.
  2. Phase 3: edit → save → open in HMA (data intact, no corruption warnings) → run in
     mGBA, level up, see the new move.

## Phases

### Phase 1 — ROM core + read-only viewer  *(≈ one session)* — **DONE 2026-07-05**
- [x] Scaffold Vite+React+TS+Tailwind, Zustand
- [x] `buffer.ts`, `charmap.ts` (+tests), `hmaToml.ts` (+tests), `anchors.ts`
- [x] `species.ts`, `moves.ts`, `learnsets.ts` readers
- [x] File open (FS Access API + fallback), auto-load sibling `.toml`
      (note: picker/drop can't see sibling files — user selects both together)
- [x] Sidebar + read-only learnset table with move stats columns
- [x] Gate: 21 tests pass incl. real-ROM integration suite (BULBASAUR learnset
      exact match, custom move CARVE, types, all 412 learnsets scan cleanly)

### Phase 2 — Editing  *(≈ one session)* — **DONE 2026-07-05**
- [x] editStore with snapshot undo/redo (cap 200), per-species drafts, dirty tracking
      (drafts auto-drop when edits return to the original)
- [x] LevelInput commit-on-blur/Enter with sort-on-commit; MovePicker fuzzy
      autocomplete (prefix > substring > subsequence) with recent-moves section
- [x] Keyboard: Ctrl+Z/Y/Shift+Z undo/redo (jumps to affected species), Ctrl+K search,
      Enter in picker, Esc closes
- [x] Validation warnings: duplicates, bad levels/moves, >25 relearner cap;
      "will repoint on save" indicator when learnset outgrows its slot
- [x] Copy/Paste between species, Revert per species (all undoable)
- [x] 18 new tests (39 total)

### Phase 3 — Write-back & save  *(≈ one session)* — **DONE 2026-07-05 (code + tests)**
- [x] `freespace.ts` allocator: 0xFF-run scan, 4-aligned, 16B slack, cursor-based
- [x] `writer.ts`: in-place vs repoint, clone-on-write for shared pointers with
      owner-count cascade (second co-owner can reclaim the slot), erase-on-repoint
      when sole owner, post-write read-back verification, never mutates source
- [x] Backups: IndexedDB (last 3 per file — FS Access API can't create sibling
      .bak files without directory permission), downloadable from the status bar
- [x] Save flow: changed-on-disk guard (full byte compare vs load-time bytes),
      atomic write via createWritable, post-save rebase keeping undo history
- [x] UI: Save to ROM (blocked on hard-invalid rows), Download copy (no rebase —
      drag-drop flow stays “dirty” since the original file is untouched), Ctrl+S
- [x] 15 new tests (54 total), incl. in-memory saves against the real ROM with
      byte-diff audits (in-place edit diffs ≤ 2 bytes)
- **Discovery:** in this ROM (vanilla quirk), species #0 shares Bulbasaur's
  learnset pointer — clone-on-write correctly fires on real data. Bulbasaur
  edits always repoint; the old list stays for species #0.
- ☐ Manual gate remains: save in the app → open in HMA (clean) → level up in mGBA

### Phase 4 — Quality of life  *(à la carte)* — **core DONE 2026-07-05**
- [x] TM/HM (58 slots incl. HM08 DIVE, unused in FR) + tutor (15) checkbox grids
      as tabs, fully editable, on the shared undo stack, saved as in-place
      bitfield rows (verified bit order LSB-first vs vanilla Bulbasaur data)
- [x] Diff view vs a baseline ROM (e.g. `GPT_Fresh.gba`): per-species +/− move
      lists incl. unsaved edits, click-to-jump, toggled from the status bar
- [x] Species header context: base stats + BST + abilities (from `0x24FC40`)
- [x] 17 new tests (71 total); revert now restores learnset + both compat rows
- [ ] Later, on demand: bulk ops (level shift, mass-assign), JSON/CSV
      export-import, egg moves

### Phase 5 — Wild encounters  *(requested 2026-07-05)*
Verified ground truth (recon against the real ROM):
- `data.pokemon.wild` @ `0x3C9CB8`: 20-byte headers `[bank, map, u16 pad,
  grass<>, surf<>, tree<>, fish<>]`, `0xFFFF`-terminated — **132 areas** in this ROM.
- Each group: `u32 rate` + pointer to fixed slot list — grass 12, surf 5,
  rock-smash (tree) 5, fishing 10 slots of `[u8 low, u8 high, u16 species]`.
- Slot odds: grass 20/20/10/10/10/10/5/5/4/4/1/1 · surf & rock 60/30/5/4/1 ·
  fish = Old Rod 70/30, Good Rod 60/20/20, Super Rod 40/40/15/4/1.
- Map display names: `data.maps.banks` @ `0x3526A8` → map header `+0x14` mapsec
  → `data.maps.names` @ `0x3F1CAC` (109 ptr entries, index = mapsec − 0x58).
  Verified: bank 2 map 27 → “MONEAN CHAMBER”.
- All wild data is fixed-size → every write is in-place, no repointing.

**DONE 2026-07-05:**
- [x] `tables/wild.ts` reader + map-name resolution; anchors + toml mappings
- [x] Writer: in-place group writes (rate + slots), validation (species range,
      level 1–100, low ≤ high, slot counts), read-back verification
- [x] editStore: wild drafts on the shared undo stack (keyed `area:kind`);
      undo/redo now return the full record so the UI jumps to species OR map
- [x] UI: Pokémon/Maps view switcher, WildEditor (rate + species picker + level
      ranges, odds labels incl. rod grouping), SpeciesPicker, Locations tab
      (live reverse lookup incl. unsaved edits), save + status bar integration
- [x] Tests: 75 total; real-ROM reads (132 areas, MONEAN CHAMBER/Unown), wild
      write diff ≤ 5 bytes, validation rejects; smoke extended to 10 steps
      (Maps view, MEW into Viridian Forest, Locations lookup, undo jump-back)

### Phase 6 — Evolutions  *(requested 2026-07-05)* — **DONE 2026-07-05**
- `data.pokemon.evolutions` @ `0x259754`: 5 × [method u16, param u16, target u16,
  pad u16] per species, fixed 40-byte blocks → in-place writes. Methods 1–15
  (level/stone/trade/friendship/specials); stone & held-item params are item ids
  (item structs @ `0x3DB028`, 44 bytes, name first, count 375).
- **Mod facts pinned by tests:** trade evolutions converted to level-ups
  (Haunter→Gengar Lv42); Eevee has 5 branches incl. day/night friendship.
- [x] Read/serialize + item names; header shows ⇢ evolutions & ⇠ pre-evolutions
  (clickable, draft-aware); Evolution tab edits target/method/param (contextual
  control: level, item dropdown, beauty, none) with add/remove, max 5
- [x] Sidebar filter: evolves by level/stone/friendship/trade/special/none (live)
- [x] Writer validation (method range, target species, level 1–100, item id)
  + read-back verification; shared undo stack; revert covers evolutions
- [x] 84 tests; smoke step 12 edits Bulbasaur's evo level and undoes it

### Phase 7 — NPC trainer teams  *(requested 2026-07-18)* — **DONE 2026-07-18**
Verified ground truth (recon against the real ROM, reading real bytes):
- `data.trainers.stats` @ `0x23EAC8`: **743** fixed 40-byte records:
  `[structType u8, class u8, music/gender u8, sprite u8, name""12,
   items u16×4, doubleBattle u32, aiFlags u32, partyCount u32, party ptr]`.
  `structType` bit0 = custom moves, bit1 = held items; gender = bit7 of the
  music byte.
- `data.trainers.classes.names` @ `0x23E558`: 107 × 13-byte text entries.
- Party entry stride is **8 bytes** without custom moves, **16 with** —
  confirmed 90/90 and 15/15 valid across every custom-move trainer (stride 14,
  the strict decomp sizeof, fails). Layout: `iv u16, level u16, species u16`,
  then held item (if bit1) and/or four move u16s (moves at +6 with no item,
  +8 with an item); the `iv` byte is the difficulty the engine scales into IVs.
- Sanity anchors pinned by tests: rival TERRY (#326, class RIVAL), Elite Four
  LORELEI (#410, structType 3) → DEWGONG Lv52 ICE BEAM…, LAPRAS holding item
  #142. structType distribution 0:591 / 1:103 / 2:33 / 3:15; party sizes 1–6.
- The 40-byte records are fixed-size (in-place writes); a party block is
  relocated to free space only when the edited team outgrows its slot, mirroring
  the learnset repoint / erase / clone-on-write path (owner census included).

**DONE 2026-07-18:**
- [x] `tables/trainers.ts` reader + serializer (all four struct layouts),
  name codec, per-field validation, structType derived from two flags
- [x] Writer: in-place vs repointed party blocks, erase-on-repoint when sole
  owner, full-record rewrite, read-back verification; anchors + toml mappings
- [x] editStore: trainer drafts on the shared undo stack (undo jumps to the
  trainer); romStore Trainers view + search; save-flow + status-bar wiring
- [x] UI: Trainers tab, TrainersSidebar (name/class/# search), TrainerEditor
  (class · name · double-battle, custom-moves/held-items toggles, per-mon
  species/level/difficulty/item/4-move editors, add/remove up to 6), ItemPicker
- [x] Tests: 103 total; unit round-trips per struct layout, writer in-place +
  repoint + validation, real-ROM reads (743 trainers, TERRY/LORELEI) and a
  save round-trip growing TERRY's team 1→2 (repoint) then reload; smoke
  extended to 15 steps (edit LORELEI's lead → MEW, add a 6th mon, undo)

### Phase 8 — Tutor move-slot editor  *(requested 2026-07-30)* — **DONE 2026-07-30**
Reassign *which move* each tutor slot teaches — a global edit to the `tutorMoves`
u16 id table (`anchors.tutors`), distinct from the existing per-species tutor
**compatibility** grid.

- Writer `'tutor-moves'` edit-kind writes the fixed-size u16 table in place
  (validates length == `tutorCount`, every id < `moveCount`); mirrors the
  compat-row in-place pattern, no repointing.
- editStore: a single global `tutorMovesDraft` (not per-species) on the shared
  undo stack; `applyTutorMoves`, `effectiveTutorMoves`/`isTutorMovesDirty`.
- UI: "Tutor move roster" panel in the Tutors tab (click a slot → MovePicker;
  edited slots highlighted; reset-to-ROM). StatusBar counts it toward the dirty
  total so Save is enabled for a roster-only edit. 8 new tests (118 total).
- Smoke retargeted to the **Heart & Soul (BPEE)** ROM (env-overridable via
  `SMOKE_ROM`; H&S needs no toml) and grown to 19 steps: reassign tutor slot 1
  Mega Punch → Thunderbolt, then a **save step** — "Download copy" runs the full
  `applyRomEdits` write-back to a blob (in-place save needs a File System Access
  handle `setInputFiles` can't grant, and a headless run shouldn't clobber the
  real ROM), asserts the download is the exact 32 MB size, then reopens the
  saved `.gba` and confirms slot 1 persisted as Thunderbolt — proving the edit
  was written, not just held in memory.

**Slot count stays fixed** — the per-species compat rows and the in-ROM tutor
menu are both keyed by slot *index*, so we only change what an existing slot
teaches, never the number of slots. Growing the roster would need the ROM's
tutor-menu scripts, which this data-editor doesn't touch.

⚠️ **Menu cost/label caveat.** Editing `tutorMoves` changes the move the tutor
actually *teaches*, but each tutor NPC's **displayed move name and BP/coin cost**
live in **map/menu scripts**, not this table. A reassigned slot can still show
the *old* move name and price in the tutor's dialogue while correctly teaching
the new move. The taught move is right; only the cosmetic menu text can lag.
Fixing the label/cost is script-side work, out of scope for the table editor.

## Out of scope (deliberately)

Egg moves (separate packed table, low value for this workflow), evolution editing,
writing back to the HMA toml (HMA re-derives everything from ROM bytes), non-BPRE ROMs.
**Adding** tutor slots or changing a tutor's menu cost/label (both live in ROM
scripts, not data tables — see the Phase 8 caveat).
