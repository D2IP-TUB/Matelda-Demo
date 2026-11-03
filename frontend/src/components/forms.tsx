import { useEffect, useState } from 'react'
import { clampBudget } from '../configurations/pipelineFlow'
import { Notice } from './ui'

export function BudgetField({ value, onChange }: { value: number; onChange: (budget: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <div className="row">
      <input
        type="range"
        aria-label="Labeling budget slider"
        min={1}
        max={100}
        value={value}
        onChange={(e) => onChange(clampBudget(e.target.value))}
      />
      <label htmlFor="budget">Labeling budget</label>
      <input
        id="budget"
        type="number"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (e.target.value.trim() !== '') onChange(clampBudget(e.target.value))
        }}
        onBlur={() => setText(String(value))}
      />
    </div>
  )
}

export function StrategyChecklist({
  strategies,
  selected,
  onChange,
  error,
}: {
  strategies: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  error?: boolean
}) {
  const toggle = (s: string) =>
    onChange(selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s])
  return (
    <>
      {error && <Notice kind="error">Could not load strategies</Notice>}
      <div className="checks">
        {strategies.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={selected.includes(s)} onChange={() => toggle(s)} />
            {s}
          </label>
        ))}
      </div>
      {!error && selected.length === 0 && <Notice kind="warn">Select at least one strategy.</Notice>}
    </>
  )
}
