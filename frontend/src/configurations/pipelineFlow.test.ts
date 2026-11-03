import { clampBudget, ensureSuffix, savePipelineChoice } from './pipelineFlow'

describe('clampBudget', () => {
  it.each([
    [0, 1],
    [1, 1],
    [55, 55],
    [101, 100],
    ['', 10],
    ['abc', 10],
    ['7', 7],
    [7.9, 7],
    [-5, 1],
  ])('%s -> %s', (input, expected) => {
    expect(clampBudget(input)).toBe(expected)
  })
})

describe('ensureSuffix', () => {
  it('adds the suffix once', () => {
    expect(ensureSuffix('a', 'x1')).toBe('a-x1')
    expect(ensureSuffix('a-x1', 'x1')).toBe('a-x1')
  })
})

const config = { selected_dataset: 'd', labeling_budget: 10, selected_strategies: ['s'] }

function fakeApi() {
  const calls: string[] = []
  return {
    calls,
    api: {
      createPipeline: vi.fn(async (name: string) => {
        calls.push(`create:${name}`)
        return name
      }),
      updatePipeline: vi.fn(async (name: string) => {
        calls.push(`update:${name}`)
      }),
      copyPipeline: vi.fn(async (_from: string, to: string) => {
        calls.push(`copy:${to}`)
        return to
      }),
    },
  }
}

describe('savePipelineChoice', () => {
  it('creates a new pipeline with the suffixed name', async () => {
    const { api, calls } = fakeApi()
    const name = await savePipelineChoice({ mode: 'new', name: 'p', suffix: 'x1', config, api })
    expect(name).toBe('p-x1')
    expect(calls).toEqual(['create:p-x1'])
    expect(api.createPipeline).toHaveBeenCalledWith('p-x1', config)
  })

  it('overwrites an existing pipeline when the name is unchanged', async () => {
    const { api, calls } = fakeApi()
    const name = await savePipelineChoice({
      mode: 'existing', name: 'old-x1', originalName: 'old-x1', suffix: 'x1', config, api,
    })
    expect(name).toBe('old-x1')
    expect(calls).toEqual(['update:old-x1'])
  })

  it('overwrites when the save-as name is blank', async () => {
    const { api, calls } = fakeApi()
    await savePipelineChoice({
      mode: 'existing', name: '', originalName: 'old-x1', suffix: 'x1', config, api,
    })
    expect(calls).toEqual(['update:old-x1'])
  })

  it('copies first and then updates the copy when renamed', async () => {
    const { api, calls } = fakeApi()
    const name = await savePipelineChoice({
      mode: 'existing', name: 'new', originalName: 'old-x1', suffix: 'x1', config, api,
    })
    expect(name).toBe('new-x1')
    expect(calls).toEqual(['copy:new-x1', 'update:new-x1'])
  })

  it('does not update when the copy fails', async () => {
    const { api } = fakeApi()
    api.copyPipeline.mockRejectedValue(new Error('exists'))
    await expect(
      savePipelineChoice({
        mode: 'existing', name: 'new', originalName: 'old-x1', suffix: 'x1', config, api,
      }),
    ).rejects.toThrow('exists')
    expect(api.updatePipeline).not.toHaveBeenCalled()
  })
})
