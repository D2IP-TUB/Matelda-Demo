import type { PipelineConfig } from '../lib/api'

const DEFAULT_BUDGET = 10

/** Integer in 1..100; empty or non-numeric input falls back to the Streamlit default (10). */
export function clampBudget(value: unknown): number {
  const text = typeof value === 'string' ? value.trim() : value
  const n = text === '' || text === null || text === undefined ? NaN : Number(text)
  if (!Number.isFinite(n)) return DEFAULT_BUDGET
  return Math.min(100, Math.max(1, Math.trunc(n)))
}

export function ensureSuffix(name: string, suffix: string): string {
  return name.endsWith(`-${suffix}`) ? name : `${name}-${suffix}`
}

interface PipelineApi {
  createPipeline(name: string, config: PipelineConfig): Promise<string>
  updatePipeline(name: string, config: PipelineConfig): Promise<void>
  copyPipeline(name: string, newName: string): Promise<string>
}

export interface SaveArgs {
  mode: 'new' | 'existing'
  /** New: the pipeline name. Existing: the optional "save as" name (blank = overwrite). */
  name: string
  originalName?: string
  suffix: string
  config: PipelineConfig
  api: PipelineApi
}

/** Saves the form to the API and returns the name of the pipeline that now holds it. */
export async function savePipelineChoice(args: SaveArgs): Promise<string> {
  const { mode, name, originalName, suffix, config, api } = args
  if (mode === 'new') {
    return api.createPipeline(ensureSuffix(name, suffix), config)
  }
  if (!originalName) throw new Error('No existing pipeline selected')
  const target = name.trim() === '' ? originalName : ensureSuffix(name.trim(), suffix)
  if (target === originalName) {
    await api.updatePipeline(originalName, config)
    return originalName
  }
  const copied = await api.copyPipeline(originalName, target)
  await api.updatePipeline(copied, config)
  return copied
}
