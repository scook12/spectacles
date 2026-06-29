import { describe, expect, it } from 'vitest'
import { Project } from 'ts-morph'

import { createDiscoveryWorkspace } from '../discovery-backend.ts'
import { discoverProject } from '../discovery.ts'
import { analyzeOxcDiscoveryWorkspace } from '../discovery-scanner-oxc.ts'
import { generateContractTestPlan } from '../planning.ts'

function createPlanningProject(): Project {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
  })

  project.createSourceFile(
    '/src/contracts.ts',
    `
      import { contract, field } from 'spectacles'
      import { z } from 'zod'

      export const RangeLength = contract('RangeLength', {
        input: z.object({ start: z.number(), end: z.number() }),
        output: z.number(),
      })
        .where(field('input.start').lte(field('input.end')))
        .pre('ordered', ({ input }) => input.start <= input.end)
        .post('difference', ({ input, output }) => output === input.end - input.start)
        .law('translation invariant', { delta: z.number() }, ({ input, delta, impl }) => {
          return impl(input) === impl({ start: input.start + delta, end: input.end + delta })
        })
        .example('simple range', { input: { start: 2, end: 5 }, output: 3 })

      export const NoImpl = contract('NoImpl', {
        input: z.string(),
        output: z.string(),
      })
    `,
  )

  project.createSourceFile(
    '/src/implementations.ts',
    `
      import { implement } from 'spectacles'
      import { RangeLength } from './contracts'

      export const rangeLength = implement(RangeLength, ({ start, end }) => end - start)
      export const unresolved = implement(MissingContract, (input) => input)
    `,
  )

  return project
}

function createPlanningWorkspace() {
  return createDiscoveryWorkspace([
    {
      filePath: '/src/contracts.ts',
      text: `
        import { contract, field } from 'spectacles'
        import { z } from 'zod'

        export const RangeLength = contract('RangeLength', {
          input: z.object({ start: z.number(), end: z.number() }),
          output: z.number(),
        })
          .where(field('input.start').lte(field('input.end')))
          .pre('ordered', ({ input }) => input.start <= input.end)
          .post('difference', ({ input, output }) => output === input.end - input.start)
          .law('translation invariant', { delta: z.number() }, ({ input, delta, impl }) => {
            return impl(input) === impl({ start: input.start + delta, end: input.end + delta })
          })
          .example('simple range', { input: { start: 2, end: 5 }, output: 3 })

        export const NoImpl = contract('NoImpl', {
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

describe('generateContractTestPlan()', () => {
  it('builds suites with explicit and engine-derived checks from a project', () => {
    const plan = generateContractTestPlan(createPlanningProject(), {
      invalidArgs: 'reject',
    })

    expect(plan.suites).toHaveLength(1)
    expect(plan.contractsWithoutImplementations).toEqual([
      {
        filePath: '/src/contracts.ts',
        exportName: 'NoImpl',
        localName: 'NoImpl',
        runtimeName: 'NoImpl',
      },
    ])
    expect(plan.unresolvedImplementations).toEqual([
      {
        filePath: '/src/implementations.ts',
        exportName: 'unresolved',
        localName: 'unresolved',
      },
    ])

    expect(plan.suites[0]).toEqual({
      kind: 'suite',
      suiteName: 'RangeLength / rangeLength',
      contract: {
        filePath: '/src/contracts.ts',
        exportName: 'RangeLength',
        localName: 'RangeLength',
        runtimeName: 'RangeLength',
      },
      implementation: {
        filePath: '/src/implementations.ts',
        exportName: 'rangeLength',
        localName: 'rangeLength',
      },
      generation: [
        {
          kind: 'args-schema',
          source: 'engine',
          confidence: 'sound',
          description: 'Generate valid argument lists from the contract args schema',
        },
        {
          kind: 'invalid-args',
          source: 'engine',
          confidence: 'derived',
          description: 'Generate invalid argument lists that violate the args schema or structured where-clauses',
        },
        {
          kind: 'where-clauses',
          source: 'contract',
          confidence: 'sound',
          count: 1,
          description: 'Constrain generated argument lists using 1 structured where-clause',
        },
        {
          kind: 'preconditions',
          source: 'contract',
          confidence: 'sound',
          count: 1,
          names: ['ordered'],
          description: 'Filter generated cases through 1 precondition',
        },
      ],
      checks: [
        {
          kind: 'valid-args-fuzz',
          phase: 'property',
          source: 'engine',
          confidence: 'derived',
          description: 'Exercise implementations across many generated valid argument lists',
        },
        {
          kind: 'return-schema',
          phase: 'property',
          source: 'engine',
          confidence: 'sound',
          description: 'Assert that returned values conform to the contract return schema',
        },
        {
          kind: 'invalid-args-rejection',
          phase: 'property',
          source: 'engine',
          confidence: 'derived',
          description: 'Assert that invalid argument lists are rejected by the implementation',
        },
        {
          kind: 'examples',
          phase: 'example',
          source: 'contract',
          confidence: 'sound',
          count: 1,
          names: ['simple range'],
          description: 'Run 1 contract example',
        },
        {
          kind: 'postconditions',
          phase: 'property',
          source: 'contract',
          confidence: 'sound',
          count: 1,
          names: ['difference'],
          description: 'Check 1 postcondition over generated valid argument lists',
        },
        {
          kind: 'laws',
          phase: 'property',
          source: 'contract',
          confidence: 'sound',
          count: 1,
          names: ['translation invariant'],
          description: 'Check 1 law with additional quantified data',
        },
      ],
    })
  })

  it('can plan from precomputed discovery data', () => {
    const project = createPlanningProject()
    const discovery = discoverProject(project)
    const plan = generateContractTestPlan(discovery)

    expect(plan.suites).toHaveLength(1)
    expect(plan.suites[0]?.generation).toEqual([
      {
        kind: 'args-schema',
        source: 'engine',
        confidence: 'sound',
        description: 'Generate valid argument lists from the contract args schema',
      },
    ])
    expect(plan.suites[0]?.checks).toEqual([
      {
        kind: 'valid-args-fuzz',
        phase: 'property',
        source: 'engine',
        confidence: 'derived',
        description: 'Exercise implementations across many generated valid argument lists',
      },
      {
        kind: 'return-schema',
        phase: 'property',
        source: 'engine',
        confidence: 'sound',
        description: 'Assert that returned values conform to the contract return schema',
      },
    ])
  })

  it('uses scanned clause summaries so planning no longer requires ts-morph for contract metadata', () => {
    const analysis = analyzeOxcDiscoveryWorkspace(createPlanningWorkspace())
    const plan = generateContractTestPlan(analysis, {
      invalidArgs: 'reject',
    })

    expect(plan.suites).toHaveLength(1)
    expect(plan.suites[0]?.generation).toEqual([
      {
        kind: 'args-schema',
        source: 'engine',
        confidence: 'sound',
        description: 'Generate valid argument lists from the contract args schema',
      },
      {
        kind: 'invalid-args',
        source: 'engine',
        confidence: 'derived',
        description: 'Generate invalid argument lists that violate the args schema or structured where-clauses',
      },
      {
        kind: 'where-clauses',
        source: 'contract',
        confidence: 'sound',
        count: 1,
        description: 'Constrain generated argument lists using 1 structured where-clause',
      },
      {
        kind: 'preconditions',
        source: 'contract',
        confidence: 'sound',
        count: 1,
        names: ['ordered'],
        description: 'Filter generated cases through 1 precondition',
      },
    ])
    expect(plan.suites[0]?.checks).toEqual([
      {
        kind: 'valid-args-fuzz',
        phase: 'property',
        source: 'engine',
        confidence: 'derived',
        description: 'Exercise implementations across many generated valid argument lists',
      },
      {
        kind: 'return-schema',
        phase: 'property',
        source: 'engine',
        confidence: 'sound',
        description: 'Assert that returned values conform to the contract return schema',
      },
      {
        kind: 'invalid-args-rejection',
        phase: 'property',
        source: 'engine',
        confidence: 'derived',
        description: 'Assert that invalid argument lists are rejected by the implementation',
      },
      {
        kind: 'examples',
        phase: 'example',
        source: 'contract',
        confidence: 'sound',
        count: 1,
        names: ['simple range'],
        description: 'Run 1 contract example',
      },
      {
        kind: 'postconditions',
        phase: 'property',
        source: 'contract',
        confidence: 'sound',
        count: 1,
        names: ['difference'],
        description: 'Check 1 postcondition over generated valid argument lists',
      },
      {
        kind: 'laws',
        phase: 'property',
        source: 'contract',
        confidence: 'sound',
        count: 1,
        names: ['translation invariant'],
        description: 'Check 1 law with additional quantified data',
      },
    ])
  })
})
