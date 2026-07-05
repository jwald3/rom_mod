import { useCallback, useRef, useState } from 'react'
import { useRomStore } from '../state/romStore'

export function OpenScreen() {
  const loadFiles = useRomStore((s) => s.loadFiles)
  const loadError = useRomStore((s) => s.loadError)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const openPicker = useCallback(async () => {
    if (window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: 'GBA ROM + HMA metadata',
              accept: { 'application/octet-stream': ['.gba', '.toml'] },
            },
          ],
        })
        const files = await Promise.all(handles.map((h) => h.getFile()))
        await loadFiles(files, handles)
      } catch {
        // user cancelled the picker
      }
    } else {
      inputRef.current?.click()
    }
  }, [loadFiles])

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      await loadFiles([...e.dataTransfer.files])
    },
    [loadFiles],
  )

  return (
    <div className="flex h-screen items-center justify-center p-8">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-16 text-center transition-colors ${
          dragging ? 'border-emerald-400 bg-emerald-950/30' : 'border-slate-700 bg-slate-900/50'
        }`}
      >
        <div className="text-5xl">🎮</div>
        <h1 className="text-xl font-semibold text-slate-100">FireRed Moveset Editor</h1>
        <p className="text-sm text-slate-400">
          Drop your <span className="font-mono text-slate-300">.gba</span> ROM here — include the
          matching <span className="font-mono text-slate-300">.toml</span> (Hex Maniac Advance
          sidecar) so repointed tables are found automatically.
        </p>
        <button
          onClick={openPicker}
          className="rounded-lg bg-emerald-600 px-5 py-2 font-medium text-white hover:bg-emerald-500"
        >
          Open files…
        </button>
        {loadError && <p className="text-sm text-red-400">{loadError}</p>}
        <input
          ref={inputRef}
          type="file"
          accept=".gba,.toml"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && loadFiles([...e.target.files])}
        />
      </div>
    </div>
  )
}
