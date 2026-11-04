import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { clampBudget } from '../configurations/pipelineFlow'
import { Loading, Notice } from './ui'

export function BudgetField({ value, onChange }: { value: number; onChange: (budget: number) => void }) {
  const tr = useT().ui
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <div className="row">
      <input
        type="range"
        aria-label={tr.budgetSlider}
        min={1}
        max={100}
        value={value}
        onChange={(e) => onChange(clampBudget(e.target.value))}
      />
      <label htmlFor="budget">{tr.budget}</label>
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
  loading,
}: {
  strategies: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  error?: boolean
  loading?: boolean
}) {
  const tr = useT().ui
  const toggle = (s: string) =>
    onChange(selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s])
  return (
    <>
      {error && <Notice kind="error">{tr.strategiesError}</Notice>}
      {loading && <Loading>{tr.strategiesLoading}</Loading>}
      <div className="checks">
        {strategies.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={selected.includes(s)} onChange={() => toggle(s)} />
            {s}
          </label>
        ))}
      </div>
      {!error && !loading && selected.length === 0 && <Notice kind="warn">{tr.selectStrategy}</Notice>}
    </>
  )
}
