import { describe, expect, it } from 'vitest'

import { createDiscoveryWorkspace } from '../discovery-backend.ts'
import { navigateSpectaclesCodebase } from '../navigation.ts'

function createNavigationWorkspace() {
  return createDiscoveryWorkspace([
    {
      filePath: '/src/contracts.ts',
      text: `
        import { contract, field } from 'spectacles'
        import { z } from 'zod'

        export const RangeLength = contract('RangeLength', {
          input: z.object({ start: z.number().int(), end: z.number().int() }),
          output: z.number().int(),
        })
          .where(field('input.start').lte(field('input.end')))
          .post('difference', ({ input, output }) => output === input.end - input.start)
          .example('simple range', {
            input: { start: 2, end: 5 },
            output: 3,
          })

        export const UnimplementedThing = contract('UnimplementedThing', {
          input: z.string(),
          output: z.string(),
        })
      `,
    },
    {
      filePath: '/src/implementations.ts',
      text: `
        import { implement } from 'spectacles'
        import { RangeLength } from './contracts'

        export const rangeLength = implement(RangeLength, ({ start, end }) => end - start)
        export const unresolved = implement(MissingContract, (input) => input)
      `,
    },
  ])
}

describe('navigateSpectaclesCodebase()', () => {
  it('returns a compact summary and issue lists', () => {
    const workspace = createNavigationWorkspace()
    const summary = navigateSpectaclesCodebase(workspace)
    const issues = navigateSpectaclesCodebase(workspace, { action: 'issues' })

    expect(summary.action).toBe('summary')
    expect(summary.summary).toEqual({
      contractCount: 2,
      implementationCount: 2,
      unimplementedContractCount: 1,
      unresolvedImplementationCount: 1,
    })

    expect(issues.unimplementedContracts?.map((contract) => contract.name)).toEqual(['UnimplementedThing'])
    expect(issues.unresolvedImplementations?.map((implementation) => implementation.name)).toEqual(['unresolved'])
  })

  it('describes a contract with clause summaries and linked implementations', () => {
    const workspace = createNavigationWorkspace()
    const result = navigateSpectaclesCodebase(workspace, {
      action: 'contract',
      name: 'RangeLength',
    })

    expect(result.matched).toBe(true)
    expect(result.contract?.name).toBe('RangeLength')
    expect(result.contract?.clauseSummary).toEqual({
      whereCount: 1,
      preNames: [],
      postNames: ['difference'],
      lawNames: [],
      exampleNames: ['simple range'],
    })
    expect(result.contract?.location?.filePath).toBe('/src/contracts.ts')
    expect(result.contract?.location?.startLine).toBeTypeOf('number')
    expect(result.implementations?.map((implementation) => implementation.name)).toEqual(['rangeLength'])
  })

  it('supports search and implementation detail lookups', () => {
    const workspace = createNavigationWorkspace()
    const search = navigateSpectaclesCodebase(workspace, {
      action: 'search',
      query: 'range',
    })
    const implementation = navigateSpectaclesCodebase(workspace, {
      action: 'implementation',
      name: 'rangeLength',
    })

    expect(search.matches?.map((match) => match.name)).toEqual(['RangeLength', 'rangeLength'])
    expect(implementation.matched).toBe(true)
    expect(implementation.implementation?.contractId).toBeTypeOf('string')
    expect(implementation.contract?.name).toBe('RangeLength')
  })

  it('supports contract and implementation list filters', () => {
    const workspace = createNavigationWorkspace()
    const unimplementedContracts = navigateSpectaclesCodebase(workspace, {
      action: 'contracts',
      implemented: 'unimplemented',
    })
    const unresolvedImplementations = navigateSpectaclesCodebase(workspace, {
      action: 'implementations',
      resolved: 'unresolved',
    })

    expect(unimplementedContracts.contracts?.map((contract) => contract.name)).toEqual(['UnimplementedThing'])
    expect(unresolvedImplementations.implementations?.map((implementation) => implementation.name)).toEqual(['unresolved'])
  })

  it('reports missing or ambiguous lookups without throwing', () => {
    const workspace = createNavigationWorkspace()
    const missing = navigateSpectaclesCodebase(workspace, {
      action: 'contract',
      name: 'MissingThing',
    })

    expect(missing.matched).toBe(false)
    expect(missing.reason).toBe('not-found')
  })
})
