import { describe, expect, it } from 'vitest'

import { renderVitestContractSuite } from '../rendering.ts'
import type { PlannedSuite } from '../planning.ts'

describe('renderVitestContractSuite()', () => {
  it('renders a vitest suite with relative imports and plan comments', () => {
    const suite: PlannedSuite = {
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
      ],
      checks: [
        {
          kind: 'return-schema',
          phase: 'property',
          source: 'engine',
          confidence: 'sound',
          description: 'Assert that returned values conform to the contract return schema',
        },
      ],
    }

    const rendered = renderVitestContractSuite(suite, {
      outputFilePath: '/test/generated/range-length.test.ts',
      runOptions: {
        numRuns: 250,
        timeoutMs: 10_000,
        seed: 123,
        invalidArgs: 'reject',
      },
    })

    expect(rendered).toContain("import { describe } from 'vitest'")
    expect(rendered).toContain("import { runContractSuite } from 'spectacles/vitest'")
    expect(rendered).toContain("import { RangeLength } from '../../src/contracts.js'")
    expect(rendered).toContain("import { rangeLength } from '../../src/implementations.js'")
    expect(rendered).toContain("describe(\"RangeLength / rangeLength\", () => {")
    expect(rendered).toContain('    numRuns: 250,')
    expect(rendered).toContain('    timeoutMs: 10000,')
    expect(rendered).toContain('    seed: 123,')
    expect(rendered).toContain('    invalidArgs: "reject",')
    expect(rendered).toContain('Generated contract suite for RangeLength / rangeLength.')
  })

  it('handles default exports and local name collisions', () => {
    const suite: PlannedSuite = {
      kind: 'suite',
      suiteName: 'Normalizer / Normalizer',
      contract: {
        filePath: '/src/contract.ts',
        exportName: 'default',
        localName: 'Normalizer',
        runtimeName: 'Normalizer',
      },
      implementation: {
        filePath: '/src/impl.ts',
        exportName: 'default',
        localName: 'Normalizer',
      },
      generation: [],
      checks: [],
    }

    const rendered = renderVitestContractSuite(suite, {
      outputFilePath: '/test/generated/normalizer.test.ts',
      includePlanComments: false,
      spectaclesVitestModuleSpecifier: '@scope/spectacles/vitest',
    })

    expect(rendered).toContain("import Normalizer from '../../src/contract.js'")
    expect(rendered).toContain("import NormalizerImpl from '../../src/impl.js'")
    expect(rendered).toContain("import { runContractSuite } from '@scope/spectacles/vitest'")
    expect(rendered).not.toContain('Generated contract suite')
    expect(rendered).toContain('    contract: Normalizer,')
    expect(rendered).toContain('    impl: NormalizerImpl,')
  })

  it('rejects invalid input', () => {
    expect(() => renderVitestContractSuite(null as any, {
      outputFilePath: '/test/generated/example.test.ts',
    })).toThrow('suite must be a planned suite')

    expect(() => renderVitestContractSuite({ kind: 'suite' } as any, null as any)).toThrow('options must be an object')
    expect(() => renderVitestContractSuite({ kind: 'suite' } as any, { outputFilePath: '' })).toThrow(
      'options.outputFilePath must be a non-empty string',
    )
  })
})
