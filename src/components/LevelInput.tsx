import { useEffect, useRef, useState } from 'react'

/**
 * Small commit-on-blur/Enter numeric field, clamped to [min, max] (default
 * 1–100 for levels). `subtle` blends into a table row (learnset view); the
 * default is a visibly editable box.
 */
export function LevelInput({
  level,
  autoFocus = false,
  subtle = false,
  min = 1,
  max = 100,
  onCommit,
}: {
  level: number
  autoFocus?: boolean
  subtle?: boolean
  min?: number
  max?: number
  onCommit: (level: number) => void
}) {
  const [value, setValue] = useState(String(level))
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => setValue(String(level)), [level])
  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [autoFocus])

  const commit = () => {
    const n = parseInt(value, 10)
    if (Number.isNaN(n)) {
      setValue(String(level))
      return
    }
    const clamped = Math.max(min, Math.min(max, n))
    setValue(String(clamped))
    if (clamped !== level) onCommit(clamped)
  }

  return (
    <input
      ref={ref}
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      className={`w-14 rounded px-1 py-0.5 text-right font-mono text-slate-200 outline-none [appearance:textfield] focus:border-emerald-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
        subtle
          ? 'border border-transparent bg-transparent hover:border-slate-700 focus:bg-slate-950'
          : 'border border-slate-700 bg-slate-950 hover:border-slate-500'
      }`}
    />
  )
}
