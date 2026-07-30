import { useMemo } from 'react'
import { useRomStore } from '../state/romStore'
import { useEditStore, computeShopDirty } from '../state/editStore'
import { describeShop } from '../rom/tables/shops'
import { ViewSwitch } from './ViewSwitch'

export function ShopsSidebar() {
  const loaded = useRomStore((s) => s.loaded)!
  const selectedShop = useRomStore((s) => s.selectedShop)
  const selectShop = useRomStore((s) => s.selectShop)
  const shopDrafts = useEditStore((s) => s.shopDrafts)

  const dirty = useMemo(() => computeShopDirty(shopDrafts, loaded), [shopDrafts, loaded])

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      <ViewSwitch />
      <div className="px-3 pb-2 pt-3 text-xs uppercase tracking-wide text-slate-500">Poké Marts</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loaded.shops.map((shop, i) => {
          const items = shopDrafts[shop.cmdOffset] ?? shop.items
          return (
            <button
              key={shop.cmdOffset}
              onClick={() => selectShop(shop.cmdOffset)}
              className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm ${
                shop.cmdOffset === selectedShop
                  ? 'bg-emerald-600/20 text-emerald-300'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <span className="w-5 shrink-0 font-mono text-xs text-slate-500">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{describeShop({ ...shop, items }, loaded.itemNames)}</span>
              {dirty.has(shop.cmdOffset) && <span className="text-xs text-amber-400">●</span>}
            </button>
          )
        })}
      </div>
      <div className="border-t border-slate-800 p-3 text-xs text-slate-500">
        {loaded.shops.length} shops · edit what each Poké Mart sells
      </div>
    </aside>
  )
}
