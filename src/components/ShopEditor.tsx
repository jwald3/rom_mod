import { useMemo, useState } from 'react'
import { useRomStore } from '../state/romStore'
import { useEditStore, computeShopDirty, effectiveShop } from '../state/editStore'
import { describeShop } from '../rom/tables/shops'
import { ItemPicker } from './ItemPicker'

export function ShopEditor() {
  const loaded = useRomStore((s) => s.loaded)!
  const selectedShop = useRomStore((s) => s.selectedShop)
  const shopDrafts = useEditStore((s) => s.shopDrafts)
  const { applyShop } = useEditStore.getState()

  const [picker, setPicker] = useState<number | null>(null)

  // Default to the first shop if none selected yet.
  const shop =
    loaded.shops.find((s) => s.cmdOffset === selectedShop) ?? loaded.shops[0]

  const cmd = shop?.cmdOffset
  const items = shop ? effectiveShop(shopDrafts, loaded, cmd) : []
  const dirty = useMemo(
    () => (cmd !== undefined ? computeShopDirty(shopDrafts, loaded).has(cmd) : false),
    [shopDrafts, loaded, cmd],
  )

  if (!shop) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center text-slate-500">
        No Poké Mart shops found in this ROM.
      </main>
    )
  }

  const commit = (next: number[]) => applyShop(cmd, next)
  const setRow = (i: number, id: number) => commit(items.map((it, idx) => (idx === i ? id : it)))
  const removeRow = (i: number) => {
    if (items.length <= 1) return // a shop must sell at least one item
    commit(items.filter((_, idx) => idx !== i))
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next)
  }
  const addRow = () => commit([...items, 1])
  const revert = () => applyShop(cmd, shop.items)

  return (
    <main className="min-w-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
        <h2 className="min-w-0 truncate text-lg font-semibold text-slate-100">
          {describeShop({ ...shop, items }, loaded.itemNames)}
        </h2>
        {dirty && (
          <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300">
            ● modified
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs text-slate-500">{items.length} items</span>
        <button
          onClick={revert}
          disabled={!dirty}
          className="shrink-0 rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          title="Discard changes to this shop"
        >
          Revert
        </button>
      </header>

      <div className="max-w-2xl p-6">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="w-10 px-3 py-1.5">#</th>
              <th className="px-3 py-1.5">Item</th>
              <th className="w-24 px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {items.map((id, i) => (
              <tr key={i} className="border-t border-slate-800/70 odd:bg-slate-900/40 hover:bg-slate-800/50">
                <td className="px-3 py-1 font-mono text-xs text-slate-500">{i + 1}</td>
                <td className="px-3 py-1">
                  <div className="relative">
                    <button
                      onClick={() => setPicker(i)}
                      className="flex w-72 items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-left font-medium text-slate-100 hover:border-slate-500 hover:text-emerald-300"
                      title="Change item"
                    >
                      <span className="min-w-0 flex-1 truncate">{loaded.itemNames[id] ?? `#${id}`}</span>
                      <span className="font-mono text-xs text-slate-600">#{id}</span>
                      <span className="text-xs text-slate-500">▾</span>
                    </button>
                    {picker === i && (
                      <ItemPicker
                        itemNames={loaded.itemNames}
                        onSelect={(newId) => {
                          setRow(i, newId)
                          setPicker(null)
                        }}
                        onClose={() => setPicker(null)}
                      />
                    )}
                  </div>
                </td>
                <td className="px-3 py-1 text-right">
                  <button
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="rounded px-1 text-slate-500 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-30"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === items.length - 1}
                    className="rounded px-1 text-slate-500 hover:bg-slate-700 hover:text-slate-200 disabled:opacity-30"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removeRow(i)}
                    disabled={items.length <= 1}
                    className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-red-900/40 hover:text-red-300 disabled:opacity-30"
                    title="Remove item"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={addRow}
            className="rounded-lg border border-emerald-700 bg-emerald-600/10 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-600/20"
          >
            + Add item
          </button>
          <span className="text-xs text-slate-500">Order here is the order shown in the shop menu.</span>
        </div>
      </div>
    </main>
  )
}
