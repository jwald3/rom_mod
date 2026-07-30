import { useEffect } from 'react'
import { useRomStore } from './state/romStore'
import { useEditStore } from './state/editStore'
import { saveInPlace, downloadModifiedCopy } from './files/save'
import { OpenScreen } from './components/OpenScreen'
import { SpeciesSidebar } from './components/SpeciesSidebar'
import { LearnsetEditor } from './components/LearnsetEditor'
import { MapsSidebar } from './components/MapsSidebar'
import { WildEditor } from './components/WildEditor'
import { TrainersSidebar } from './components/TrainersSidebar'
import { TrainerEditor } from './components/TrainerEditor'
import { GameCornerSidebar } from './components/GameCornerSidebar'
import { GameCornerEditor } from './components/GameCornerEditor'
import { ShopsSidebar } from './components/ShopsSidebar'
import { ShopEditor } from './components/ShopEditor'
import { StatusBar } from './components/StatusBar'
import { DiffPanel } from './components/DiffPanel'

export default function App() {
  const loaded = useRomStore((s) => s.loaded)
  const diffOpen = useRomStore((s) => s.diffOpen)
  const viewMode = useRomStore((s) => s.viewMode)

  // Global shortcuts: Ctrl+S save, Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo,
  // Ctrl+K species search.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'z' || key === 'y') {
        e.preventDefault()
        const { undo, redo } = useEditStore.getState()
        const record = key === 'y' || e.shiftKey ? redo() : undo()
        if (record !== null) {
          // Jump to what changed — a species, a map for wild edits, or a trainer.
          const rs = useRomStore.getState()
          if (record.field === 'wild') rs.selectArea(record.species)
          else if (record.field === 'trainer') rs.selectTrainer(record.species)
          else if (record.field === 'gamecorner') rs.selectPrizeKind(record.kind)
          else if (record.field === 'shop') rs.selectShop(record.cmdOffset)
          else rs.select(record.species)
        }
      } else if (key === 'k') {
        e.preventDefault()
        const searchId: Partial<Record<string, string>> = {
          maps: 'map-search',
          trainers: 'trainer-search',
          species: 'species-search',
        }
        const id = searchId[useRomStore.getState().viewMode]
        if (id) document.getElementById(id)?.focus()
      } else if (key === 's') {
        e.preventDefault()
        if (useRomStore.getState().romHandle) void saveInPlace()
        else downloadModifiedCopy()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!loaded) return <OpenScreen />

  return (
    <div className="flex h-screen flex-col">
      {loaded.warnings.length > 0 && (
        <div className="border-b border-amber-900 bg-amber-950/60 px-4 py-2 text-sm text-amber-300">
          {loaded.warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {viewMode === 'species' && (
          <>
            <SpeciesSidebar />
            <LearnsetEditor />
          </>
        )}
        {viewMode === 'maps' && (
          <>
            <MapsSidebar />
            <WildEditor />
          </>
        )}
        {viewMode === 'gamecorner' && loaded.gameCornerAvailable && (
          <>
            <GameCornerSidebar />
            <GameCornerEditor />
          </>
        )}
        {viewMode === 'shops' && (
          <>
            <ShopsSidebar />
            <ShopEditor />
          </>
        )}
        {viewMode === 'trainers' && (
          <>
            <TrainersSidebar />
            <TrainerEditor />
          </>
        )}
        {diffOpen && <DiffPanel />}
      </div>
      <StatusBar />
    </div>
  )
}
