import { create } from 'zustand'
import { loadRom, type LoadedRom } from '../rom/loadRom'

export interface SaveState {
  status: 'idle' | 'saving' | 'saved' | 'error'
  message?: string
}

interface RomStore {
  loaded: LoadedRom | null
  /** File handle for the ROM when opened via picker — enables in-place save. */
  romHandle: FileSystemFileHandle | null
  /** Kept so post-save rebases re-resolve anchors the same way. */
  tomlText: string | undefined
  saveState: SaveState
  loadError: string | null
  selected: number
  search: string
  showGaps: boolean
  /** Filter the species list to Pokémon with no wild location. */
  filterNoWild: boolean
  /** Filter by evolution method category ('any' = off, 'none' = doesn't evolve). */
  evoFilter: string
  /** Pokémon editing vs wild-encounter (map) vs NPC trainer editing. */
  viewMode: 'species' | 'maps' | 'trainers'
  selectedArea: number
  mapSearch: string
  selectedTrainer: number
  trainerSearch: string
  /** Second ROM (e.g. the unmodified base) for the diff view. */
  baseline: LoadedRom | null
  baselineError: string | null
  diffOpen: boolean

  loadFiles(files: File[], handles?: FileSystemFileHandle[]): Promise<void>
  loadBaseline(files: File[]): Promise<void>
  select(id: number): void
  setSearch(s: string): void
  setShowGaps(b: boolean): void
  setFilterNoWild(b: boolean): void
  setEvoFilter(f: string): void
  setViewMode(mode: 'species' | 'maps' | 'trainers'): void
  selectArea(index: number): void
  setMapSearch(s: string): void
  selectTrainer(index: number): void
  setTrainerSearch(s: string): void
  setDiffOpen(open: boolean): void
}

export const useRomStore = create<RomStore>((set) => ({
  loaded: null,
  romHandle: null,
  tomlText: undefined,
  saveState: { status: 'idle' },
  loadError: null,
  selected: 1,
  search: '',
  showGaps: false,
  filterNoWild: false,
  evoFilter: 'any',
  viewMode: 'species',
  selectedArea: 0,
  mapSearch: '',
  selectedTrainer: 1,
  trainerSearch: '',
  baseline: null,
  baselineError: null,
  diffOpen: false,

  async loadFiles(files, handles) {
    try {
      const romFile = files.find((f) => f.name.toLowerCase().endsWith('.gba'))
      if (!romFile) {
        set({ loadError: 'No .gba file found — drop your ROM (the .toml sidecar is optional but recommended).' })
        return
      }
      // Prefer a .toml matching the ROM's basename; otherwise take any .toml given.
      const base = romFile.name.replace(/\.gba$/i, '')
      const tomls = files.filter((f) => f.name.toLowerCase().endsWith('.toml'))
      const tomlFile = tomls.find((f) => f.name.replace(/\.toml$/i, '') === base) ?? tomls[0]

      const bytes = new Uint8Array(await romFile.arrayBuffer())
      const tomlText = tomlFile ? await tomlFile.text() : undefined
      const loaded = loadRom(bytes, romFile.name, tomlText)

      const romHandle = handles?.find((h) => h.name === romFile.name) ?? null
      set({ loaded, romHandle, tomlText, saveState: { status: 'idle' }, loadError: null, selected: 1 })

      // Fresh ROM → fresh drafts/undo. Dynamic import avoids a store cycle
      // (editStore imports romStore for originals).
      const { useEditStore } = await import('./editStore')
      useEditStore.getState().reset()
    } catch (e) {
      set({ loadError: `Failed to load ROM: ${e instanceof Error ? e.message : String(e)}` })
    }
  },

  async loadBaseline(files) {
    try {
      const romFile = files.find((f) => f.name.toLowerCase().endsWith('.gba'))
      if (!romFile) {
        set({ baselineError: 'No .gba file selected for the baseline.' })
        return
      }
      const base = romFile.name.replace(/\.gba$/i, '')
      const tomls = files.filter((f) => f.name.toLowerCase().endsWith('.toml'))
      const tomlFile = tomls.find((f) => f.name.replace(/\.toml$/i, '') === base) ?? tomls[0]
      const bytes = new Uint8Array(await romFile.arrayBuffer())
      const tomlText = tomlFile ? await tomlFile.text() : undefined
      set({ baseline: loadRom(bytes, romFile.name, tomlText), baselineError: null, diffOpen: true })
    } catch (e) {
      set({ baselineError: `Failed to load baseline: ${e instanceof Error ? e.message : String(e)}` })
    }
  },

  select: (id) => set({ selected: id, viewMode: 'species' }),
  setSearch: (search) => set({ search }),
  setShowGaps: (showGaps) => set({ showGaps }),
  setFilterNoWild: (filterNoWild) => set({ filterNoWild }),
  setEvoFilter: (evoFilter) => set({ evoFilter }),
  setViewMode: (viewMode) => set({ viewMode }),
  selectArea: (selectedArea) => set({ selectedArea, viewMode: 'maps' }),
  setMapSearch: (mapSearch) => set({ mapSearch }),
  selectTrainer: (selectedTrainer) => set({ selectedTrainer, viewMode: 'trainers' }),
  setTrainerSearch: (trainerSearch) => set({ trainerSearch }),
  setDiffOpen: (diffOpen) => set({ diffOpen }),
}))
