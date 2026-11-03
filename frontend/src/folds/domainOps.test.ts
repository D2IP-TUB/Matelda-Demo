import { mergeFolds, moveTable, splitFolds, toFolds, toLocations } from './domainOps'

const folds = { F0: ['a', 'b', 'c'], F1: ['d'], F2: ['e', 'f'] }

describe('domainOps', () => {
  it('converts folds to locations and back', () => {
    expect(toLocations(folds)).toEqual({ a: 'F0', b: 'F0', c: 'F0', d: 'F1', e: 'F2', f: 'F2' })
    expect(toFolds(toLocations(folds))).toEqual(folds)
  })

  it('moves a table and drops an emptied fold', () => {
    expect(moveTable(folds, 'd', 'F2')).toEqual({ F0: ['a', 'b', 'c'], F2: ['e', 'f', 'd'] })
  })

  it('moving to an unknown fold changes nothing', () => {
    expect(moveTable(folds, 'a', 'nope')).toEqual(folds)
  })

  it('merges folds into the first selected, keeping table order', () => {
    expect(mergeFolds(folds, ['F2', 'F0', 'F1'])).toEqual({ F2: ['e', 'f', 'a', 'b', 'c', 'd'] })
  })

  it('merging fewer than two folds changes nothing', () => {
    expect(mergeFolds(folds, ['F0'])).toEqual(folds)
    expect(mergeFolds(folds, [])).toEqual(folds)
  })

  it('splits a fold after every selected table', () => {
    expect(splitFolds(folds, { F0: ['b'] })).toEqual({
      'F0 - Split 1': ['a', 'b'],
      'F0 - Split 2': ['c'],
      F1: ['d'],
      F2: ['e', 'f'],
    })
  })

  it('selecting only the last table changes nothing', () => {
    expect(splitFolds(folds, { F0: ['c'] })).toEqual(folds)
  })

  it('does not mutate its input', () => {
    const copy = structuredClone(folds)
    moveTable(folds, 'a', 'F1')
    mergeFolds(folds, ['F0', 'F1'])
    splitFolds(folds, { F0: ['a'] })
    expect(folds).toEqual(copy)
  })
})
