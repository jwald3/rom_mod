import { RomBuffer, GBA_ROM_BASE } from './buffer'
import { type AnchorMap } from './anchors'
import {
  entriesEqual,
  readLearnset,
  serializeLearnset,
  type LearnsetEntry,
} from './tables/learnsets'
import { FreeSpaceAllocator, FREE_BYTE, DEFAULT_FLOOR } from './freespace'
import { compatRowBytes, flagsEqual, readCompatRow, serializeCompatRow } from './tables/compat'
import {
  parseWildKey,
  readWildArea,
  wildGroupsEqual,
  WILD_SLOT_COUNTS,
  type WildGroupEdit,
} from './tables/wild'
import {
  EVOS_PER_SPECIES,
  evoParamKind,
  evosEqual,
  readEvolutionsFor,
  serializeEvolutions,
  type Evolution,
} from './tables/evolutions'
import {
  TRAINER_STRUCT_LEN,
  partyGbaPointer,
  readTrainer,
  serializeParty,
  serializeTrainerRecord,
  trainerToEdit,
  trainersEqual,
  type TrainerEdit,
} from './tables/trainers'

export interface WriteOp {
  /** Species id — or the wild area index for kind 'wild'. */
  species: number
  kind:
    | 'in-place'
    | 'repointed'
    | 'tm-compat'
    | 'tutor-compat'
    | 'wild'
    | 'evolution'
    | 'held-items'
    | 'trainer'
    | 'trainer-repointed'
  oldOffset: number // -1 if the original pointer was invalid
  newOffset: number
  byteLength: number
  erasedOld: boolean
}

export interface WriteResult {
  bytes: Uint8Array
  ops: WriteOp[]
}

export interface RomEdits {
  learnsets?: Map<number, LearnsetEntry[]>
  tmCompat?: Map<number, boolean[]>
  tutorCompat?: Map<number, boolean[]>
  /** Keyed by wildKey(areaIndex, kind). */
  wild?: Map<string, WildGroupEdit>
  evolutions?: Map<number, Evolution[]>
  /** Wild held items (base stats +12/+14): item1 = 50% slot, item2 = 5% slot. */
  heldItems?: Map<number, HeldItemsEdit>
  /** NPC trainer teams, keyed by trainer index. */
  trainers?: Map<number, TrainerEdit>
}

export interface HeldItemsEdit {
  item1: number
  item2: number
}

const HELD_ITEMS_OFFSET = 12 // within the 28-byte base stats struct

/**
 * Apply learnset edits to a copy of the ROM. Never mutates the source.
 *
 * Per species: if the new list fits in the old slot (and no other species
 * shares that pointer), write in place and 0xFF-fill the tail. Otherwise
 * allocate free space, write there, update the pointer, and erase the old
 * list — but only when this species was its sole owner (clone-on-write for
 * shared learnsets). Every edit is re-read and verified before returning.
 */
export function applyLearnsetEdits(
  source: RomBuffer,
  anchors: AnchorMap,
  edits: Map<number, LearnsetEntry[]>,
  opts?: { freeSpaceFloor?: number },
): WriteResult {
  return applyRomEdits(source, anchors, { learnsets: edits }, opts)
}

export function applyRomEdits(
  source: RomBuffer,
  anchors: AnchorMap,
  romEdits: RomEdits,
  opts?: { freeSpaceFloor?: number },
): WriteResult {
  const edits = romEdits.learnsets ?? new Map<number, LearnsetEntry[]>()
  const out = source.bytes.slice()
  const rom = new RomBuffer(out) // live view over the working copy
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  const alloc = new FreeSpaceAllocator(out, opts?.freeSpaceFloor ?? DEFAULT_FLOOR)
  const ops: WriteOp[] = []

  // Census: how many species point at each learnset offset (shared-pointer detection).
  const owners = new Map<number, number>()
  for (let s = 0; s < anchors.speciesCount; s++) {
    const off = rom.pointer(anchors.learnsets + s * 4)
    if (off !== null) owners.set(off, (owners.get(off) ?? 0) + 1)
  }

  const sortedEdits = [...edits.entries()].sort((a, b) => a[0] - b[0])
  for (const [species, entries] of sortedEdits) {
    let data: Uint8Array
    try {
      data = serializeLearnset(entries)
    } catch (e) {
      throw new Error(`Species #${species}: ${e instanceof Error ? e.message : String(e)}`)
    }

    const ptrOffset = anchors.learnsets + species * 4
    const cur = rom.pointer(ptrOffset)
    // Capacity of the current slot, scanned just-in-time from the working copy.
    const capacityBytes = cur === null ? 0 : (readLearnset(rom, anchors, species).entries.length + 1) * 2
    const soleOwner = cur !== null && owners.get(cur) === 1

    if (cur !== null && soleOwner && data.length <= capacityBytes) {
      out.set(data, cur)
      out.fill(FREE_BYTE, cur + data.length, cur + capacityBytes)
      ops.push({
        species,
        kind: 'in-place',
        oldOffset: cur,
        newOffset: cur,
        byteLength: data.length,
        erasedOld: false,
      })
    } else {
      const newOffset = alloc.allocate(data.length)
      out.set(data, newOffset)
      view.setUint32(ptrOffset, GBA_ROM_BASE + newOffset, true)
      let erasedOld = false
      if (cur !== null) {
        if (soleOwner) {
          out.fill(FREE_BYTE, cur, cur + capacityBytes)
          erasedOld = true
        }
        // This species no longer points at cur; a later edit of a co-owner
        // may now be sole owner and reclaim the slot.
        owners.set(cur, (owners.get(cur) ?? 1) - 1)
      }
      owners.set(newOffset, 1)
      ops.push({
        species,
        kind: 'repointed',
        oldOffset: cur ?? -1,
        newOffset,
        byteLength: data.length,
        erasedOld,
      })
    }
  }

  // Compatibility bitfields are fixed-size rows — always written in place.
  const compatTables: Array<{
    edits: Map<number, boolean[]> | undefined
    table: number
    count: number
    kind: 'tm-compat' | 'tutor-compat'
    label: string
  }> = [
    { edits: romEdits.tmCompat, table: anchors.tmCompat, count: anchors.tmCount, kind: 'tm-compat', label: 'TM/HM' },
    { edits: romEdits.tutorCompat, table: anchors.tutorCompat, count: anchors.tutorCount, kind: 'tutor-compat', label: 'tutor' },
  ]
  for (const { edits: compatEdits, table, count, kind, label } of compatTables) {
    if (!compatEdits) continue
    const rowBytes = compatRowBytes(count)
    for (const [species, flags] of [...compatEdits.entries()].sort((a, b) => a[0] - b[0])) {
      if (flags.length !== count) {
        throw new Error(`Species #${species}: ${label} row has ${flags.length} flags, expected ${count}`)
      }
      const offset = table + species * rowBytes
      out.set(serializeCompatRow(flags), offset)
      ops.push({ species, kind, oldOffset: offset, newOffset: offset, byteLength: rowBytes, erasedOld: false })
    }
  }

  // Wild encounter groups: fixed-size [u32 rate] + slot arrays, always in place.
  if (romEdits.wild) {
    for (const [key, group] of [...romEdits.wild.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const { areaIndex, kind } = parseWildKey(key)
      const target = readWildArea(rom, anchors, areaIndex).groups[kind]
      if (!target) throw new Error(`Wild area #${areaIndex} has no ${kind} encounters`)
      if (group.slots.length !== WILD_SLOT_COUNTS[kind]) {
        throw new Error(
          `Wild area #${areaIndex} ${kind}: ${group.slots.length} slots, expected ${WILD_SLOT_COUNTS[kind]}`,
        )
      }
      group.slots.forEach((s, i) => {
        if (s.species < 0 || s.species >= anchors.speciesCount) {
          throw new Error(`Wild area #${areaIndex} ${kind} slot ${i + 1}: invalid species #${s.species}`)
        }
        if (s.low < 1 || s.high > 100 || s.low > s.high) {
          throw new Error(`Wild area #${areaIndex} ${kind} slot ${i + 1}: bad level range ${s.low}–${s.high}`)
        }
      })
      view.setUint32(target.infoOffset, group.rate >>> 0, true)
      group.slots.forEach((s, i) => {
        const o = target.listOffset + i * 4
        out[o] = s.low
        out[o + 1] = s.high
        view.setUint16(o + 2, s.species, true)
      })
      ops.push({
        species: areaIndex,
        kind: 'wild',
        oldOffset: target.infoOffset,
        newOffset: target.infoOffset,
        byteLength: 4 + group.slots.length * 4,
        erasedOld: false,
      })
    }
  }

  // Evolution lists: fixed 40-byte blocks per species, always in place.
  if (romEdits.evolutions) {
    for (const [species, evos] of [...romEdits.evolutions.entries()].sort((a, b) => a[0] - b[0])) {
      if (evos.length > EVOS_PER_SPECIES) {
        throw new Error(`Species #${species}: ${evos.length} evolutions, max ${EVOS_PER_SPECIES}`)
      }
      evos.forEach((e, i) => {
        const where = `Species #${species} evolution ${i + 1}`
        if (e.method < 1 || e.method > 15) throw new Error(`${where}: unknown method ${e.method}`)
        if (e.target < 1 || e.target >= anchors.speciesCount) {
          throw new Error(`${where}: invalid target species #${e.target}`)
        }
        const kind = evoParamKind(e.method)
        if (kind === 'level' && (e.param < 1 || e.param > 100)) {
          throw new Error(`${where}: level ${e.param} out of range (1–100)`)
        }
        if (kind === 'item' && (e.param < 0 || e.param >= anchors.itemCount)) {
          throw new Error(`${where}: invalid item #${e.param}`)
        }
      })
      const offset = anchors.evolutions + species * EVOS_PER_SPECIES * 8
      out.set(serializeEvolutions(evos), offset)
      ops.push({
        species,
        kind: 'evolution',
        oldOffset: offset,
        newOffset: offset,
        byteLength: EVOS_PER_SPECIES * 8,
        erasedOld: false,
      })
    }
  }

  // Held items: two u16s inside each species' base stats struct, in place.
  if (romEdits.heldItems) {
    for (const [species, items] of [...romEdits.heldItems.entries()].sort((a, b) => a[0] - b[0])) {
      if (species < 0 || species >= anchors.speciesCount) {
        throw new Error(`Held items: invalid species #${species}`)
      }
      for (const [label, id] of [
        ['item1', items.item1],
        ['item2', items.item2],
      ] as const) {
        if (id < 0 || id >= anchors.itemCount) {
          throw new Error(`Species #${species}: invalid held ${label} #${id}`)
        }
      }
      const offset = anchors.baseStats + species * anchors.baseStatsLen + HELD_ITEMS_OFFSET
      view.setUint16(offset, items.item1, true)
      view.setUint16(offset + 2, items.item2, true)
      ops.push({
        species,
        kind: 'held-items',
        oldOffset: offset,
        newOffset: offset,
        byteLength: 4,
        erasedOld: false,
      })
    }
  }

  // Trainer teams: the 40-byte record is fixed (written in place), but its
  // party block is relocated to free space when the edited team outgrows its
  // slot — mirroring the learnset repoint/erase/clone-on-write logic.
  if (romEdits.trainers) {
    // Census: how many trainers point at each party block (shared-block safety).
    const partyOwners = new Map<number, number>()
    for (let t = 0; t < anchors.trainers && t < anchors.trainerCount; t++) {
      const off = rom.pointer(anchors.trainers + t * TRAINER_STRUCT_LEN + 0x24)
      if (off !== null) partyOwners.set(off, (partyOwners.get(off) ?? 0) + 1)
    }

    for (const [index, edit] of [...romEdits.trainers.entries()].sort((a, b) => a[0] - b[0])) {
      if (index < 0 || index >= anchors.trainerCount) {
        throw new Error(`Trainer #${index}: out of range`)
      }
      const recordOffset = anchors.trainers + index * TRAINER_STRUCT_LEN
      let party: Uint8Array
      try {
        party = serializeParty(edit, anchors.speciesCount, anchors.moveCount, anchors.itemCount)
      } catch (e) {
        throw new Error(`Trainer #${index}: ${e instanceof Error ? e.message : String(e)}`)
      }

      const cur = rom.pointer(recordOffset + 0x24)
      const capacityBytes = readTrainer(rom, anchors, index).partyCapacity
      const soleOwner = cur !== null && partyOwners.get(cur) === 1

      let partyOffset: number
      let erasedOld = false
      let repointed = false
      if (cur !== null && soleOwner && party.length <= capacityBytes) {
        partyOffset = cur
        out.set(party, cur)
        out.fill(FREE_BYTE, cur + party.length, cur + capacityBytes)
      } else {
        repointed = true
        partyOffset = alloc.allocate(party.length)
        out.set(party, partyOffset)
        if (cur !== null) {
          if (soleOwner) {
            out.fill(FREE_BYTE, cur, cur + capacityBytes)
            erasedOld = true
          }
          partyOwners.set(cur, (partyOwners.get(cur) ?? 1) - 1)
        }
        partyOwners.set(partyOffset, 1)
      }

      let record: Uint8Array
      try {
        record = serializeTrainerRecord(edit, partyGbaPointer(partyOffset), anchors.trainerClassCount, anchors.itemCount)
      } catch (e) {
        throw new Error(`Trainer #${index}: ${e instanceof Error ? e.message : String(e)}`)
      }
      out.set(record, recordOffset)
      ops.push({
        species: index,
        kind: repointed ? 'trainer-repointed' : 'trainer',
        oldOffset: cur ?? -1,
        newOffset: partyOffset,
        byteLength: party.length,
        erasedOld,
      })
    }
  }

  // Paranoia: every edit must read back exactly as requested.
  for (const [species, entries] of sortedEdits) {
    const check = readLearnset(rom, anchors, species)
    if (!entriesEqual(check.entries, entries)) {
      throw new Error(`Write verification failed for species #${species} — aborting save`)
    }
  }
  for (const { edits: compatEdits, table, count, kind } of compatTables) {
    if (!compatEdits) continue
    for (const [species, flags] of compatEdits) {
      if (!flagsEqual(readCompatRow(rom, table, species, count), flags)) {
        throw new Error(`Write verification failed for species #${species} (${kind}) — aborting save`)
      }
    }
  }
  if (romEdits.wild) {
    for (const [key, group] of romEdits.wild) {
      const { areaIndex, kind } = parseWildKey(key)
      const check = readWildArea(rom, anchors, areaIndex).groups[kind]
      if (!check || !wildGroupsEqual({ rate: check.rate, slots: check.slots }, group)) {
        throw new Error(`Write verification failed for wild area #${areaIndex} (${kind}) — aborting save`)
      }
    }
  }
  if (romEdits.evolutions) {
    for (const [species, evos] of romEdits.evolutions) {
      if (!evosEqual(readEvolutionsFor(rom, anchors, species), evos)) {
        throw new Error(`Write verification failed for species #${species} (evolutions) — aborting save`)
      }
    }
  }
  if (romEdits.heldItems) {
    for (const [species, items] of romEdits.heldItems) {
      const offset = anchors.baseStats + species * anchors.baseStatsLen + HELD_ITEMS_OFFSET
      if (rom.u16(offset) !== items.item1 || rom.u16(offset + 2) !== items.item2) {
        throw new Error(`Write verification failed for species #${species} (held items) — aborting save`)
      }
    }
  }
  if (romEdits.trainers) {
    for (const [index, edit] of romEdits.trainers) {
      if (!trainersEqual(trainerToEdit(readTrainer(rom, anchors, index)), edit)) {
        throw new Error(`Write verification failed for trainer #${index} — aborting save`)
      }
    }
  }

  return { bytes: out, ops }
}
