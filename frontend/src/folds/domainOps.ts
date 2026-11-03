export type Folds = Record<string, string[]>

export function toLocations(folds: Folds): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [fold, tables] of Object.entries(folds)) for (const t of tables) out[t] = fold
  return out
}

export function toFolds(locations: Record<string, string>): Folds {
  const out: Folds = {}
  for (const [table, fold] of Object.entries(locations)) (out[fold] ??= []).push(table)
  return out
}

const clone = (folds: Folds): Folds =>
  Object.fromEntries(Object.entries(folds).map(([f, t]) => [f, [...t]]))

export function moveTable(folds: Folds, table: string, toFold: string): Folds {
  if (!(toFold in folds) || !Object.values(folds).some((t) => t.includes(table))) return folds
  const out: Folds = {}
  for (const [fold, tables] of Object.entries(folds)) {
    const kept = tables.filter((t) => t !== table)
    const next = fold === toFold ? [...kept, table] : kept
    if (next.length > 0) out[fold] = next
  }
  return out
}

/** The first selected fold becomes the target; its tables stay first. */
export function mergeFolds(folds: Folds, selected: string[]): Folds {
  const distinct = [...new Set(selected)].filter((f) => f in folds)
  if (distinct.length < 2) return folds
  const [target, ...sources] = distinct
  const out: Folds = {}
  for (const [fold, tables] of Object.entries(clone(folds))) {
    if (sources.includes(fold)) continue
    out[fold] = fold === target ? [...tables, ...sources.flatMap((s) => folds[s])] : tables
  }
  return out
}

/** Splits each fold after every selected table; new folds are named "<fold> - Split N". */
export function splitFolds(folds: Folds, selectedTables: Record<string, string[]>): Folds {
  const out: Folds = {}
  for (const [fold, tables] of Object.entries(folds)) {
    const picked = selectedTables[fold] ?? []
    const segments: string[][] = []
    let start = 0
    tables.forEach((table, i) => {
      if (picked.includes(table)) {
        segments.push(tables.slice(start, i + 1))
        start = i + 1
      }
    })
    if (start < tables.length) segments.push(tables.slice(start))
    if (segments.length <= 1) {
      out[fold] = [...tables]
    } else {
      segments.forEach((segment, n) => (out[`${fold} - Split ${n + 1}`] = segment))
    }
  }
  return out
}
