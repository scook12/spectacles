import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { Project } from 'ts-morph'

import { createDiscoveryWorkspace } from '../discovery-backend.ts'
import { analyzeOxcDiscoveryWorkspace } from '../discovery-scanner-oxc.ts'
import {
  generateVitestContractFiles,
  generateVitestContractFilesFromAnalysis,
  generateVitestContractFilesFromPlan,
  writeGeneratedVitestContractFiles,
} from '../generation.ts'

function createGenerationProject(): Project {
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
        .post('difference', ({ input, output }) => output === input.end - input.start)
    `,
  )

  project.createSourceFile(
    '/src/implementations.ts',
    `
      import { implement } from 'spectacles'
      import { RangeLength } from './contracts'

      export const rangeLength = implement(RangeLength, ({ start, end }) => end - start)
    `,
  )

  return project
}

function createGenerationWorkspace() {
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
          .post('difference', ({ input, output }) => output === input.end - input.start)
      `,
    },
    {
      filePath: '/src/implementations.ts',
      text: `
        import { implement } from 'spectacles'
        import { RangeLength } from './contracts'

        export const rangeLength = implement(RangeLength, ({ start, end }) => end - start)
      `,
    },
  ])
}

function createCollisionProject(): Project {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
  })

  project.createSourceFile(
    '/src/contracts.ts',
    `
      import { contract } from 'spectacles'
      import { z } from 'zod'

      export const Alpha = contract('Alpha', { input: z.string(), output: z.string() })
      export const Beta = contract('Beta', { input: z.string(), output: z.string() })
    `,
  )

  project.createSourceFile(
    '/src/implementations.ts',
    `
      import { implement } from 'spectacles'
      import { Alpha, Beta } from './contracts'

      export const alpha = implement(Alpha, (input) => input)
      export const beta = implement(Beta, (input) => input)
    `,
  )

  return project
}

describe('generateVitestContractFiles()', () => {
  it('generates and adds vitest contract files to the project', () => {
    const project = createGenerationProject()
    const result = generateVitestContractFiles(project, {
      outputDir: '/test/generated',
      runOptions: { numRuns: 50, invalidArgs: 'reject' },
    })

    expect(result.plan.suites).toHaveLength(1)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.outputFilePath).toBe('/test/generated/range-length--range-length.contract.test.ts')
    expect(result.files[0]?.content).toContain("import { RangeLength } from '../../src/contracts.js'")
    expect(result.files[0]?.content).toContain("import { rangeLength } from '../../src/implementations.js'")
    expect(result.files[0]?.content).toContain('    numRuns: 50,')
    expect(result.files[0]?.content).toContain('    invalidArgs: "reject",')

    const generatedSourceFile = project.getSourceFile('/test/generated/range-length--range-length.contract.test.ts')
    expect(generatedSourceFile?.getFullText()).toBe(result.files[0]?.content)
  })

  it('supports custom naming and skipping project writes', () => {
    const project = createGenerationProject()
    const result = generateVitestContractFiles(project, {
      outputDir: '/test/generated',
      fileName: () => 'custom-suite.spec.ts',
      writeToProject: false,
      includePlanComments: false,
    })

    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.outputFilePath).toBe('/test/generated/custom-suite.spec.ts')
    expect(result.files[0]?.content).not.toContain('Generated contract suite')
    expect(project.getSourceFile('/test/generated/custom-suite.spec.ts')).toBeUndefined()
  })

  it('generates files from discovery analysis without requiring a ts-morph project', () => {
    const analysis = analyzeOxcDiscoveryWorkspace(createGenerationWorkspace())
    const result = generateVitestContractFilesFromAnalysis(analysis, {
      outputDir: '/test/generated',
      runOptions: { numRuns: 25, invalidArgs: 'reject' },
    })

    expect(result.plan.suites).toHaveLength(1)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.outputFilePath).toBe('/test/generated/range-length--range-length.contract.test.ts')
    expect(result.files[0]?.content).toContain("import { RangeLength } from '../../src/contracts.js'")
    expect(result.files[0]?.content).toContain("import { rangeLength } from '../../src/implementations.js'")
    expect(result.files[0]?.content).toContain('Check 1 postcondition over generated valid argument lists')
    expect(result.files[0]?.content).toContain('    numRuns: 25,')
    expect(result.files[0]?.content).toContain('    invalidArgs: "reject",')
  })

  it('renders from a precomputed plan and can write generated files to the filesystem', () => {
    const analysis = analyzeOxcDiscoveryWorkspace(createGenerationWorkspace())
    const plan = generateVitestContractFilesFromAnalysis(analysis, {
      outputDir: '/unused',
    }).plan
    const rendered = generateVitestContractFilesFromPlan(plan, {
      outputDir: '/virtual/generated',
      fileName: () => 'contract-suite.test.ts',
      includePlanComments: false,
    })

    expect(rendered.files).toHaveLength(1)
    expect(rendered.files[0]?.outputFilePath).toBe('/virtual/generated/contract-suite.test.ts')
    expect(rendered.files[0]?.content).not.toContain('Generated contract suite')

    const tempDir = mkdtempSync(join(tmpdir(), 'spectacles-generation-'))
    try {
      const writableFiles = rendered.files.map((file) => ({
        ...file,
        outputFilePath: join(tempDir, 'nested', 'suite.test.ts'),
      }))
      writeGeneratedVitestContractFiles(writableFiles)
      expect(readFileSync(join(tempDir, 'nested', 'suite.test.ts'), 'utf8')).toBe(writableFiles[0]?.content)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('deduplicates colliding file names', () => {
    const project = createCollisionProject()
    const result = generateVitestContractFiles(project, {
      outputDir: '/test/generated',
      fileName: () => 'suite.test.ts',
    })

    expect(result.files).toHaveLength(2)
    expect(result.files.map((file) => file.outputFilePath)).toEqual([
      '/test/generated/suite.test.ts',
      '/test/generated/suite-2.test.ts',
    ])
  })

  it('rejects invalid options', () => {
    const project = createGenerationProject()

    expect(() => generateVitestContractFiles(null as any, { outputDir: '/test/generated' })).toThrow(
      'project must be a ts-morph Project',
    )
    expect(() => generateVitestContractFiles(project, null as any)).toThrow('options must be an object')
    expect(() => generateVitestContractFiles(project, { outputDir: '' })).toThrow(
      'options.outputDir must be a non-empty string',
    )
    expect(() => generateVitestContractFiles(project, { outputDir: '/test/generated', fileName: 'bad' as any })).toThrow(
      'options.fileName must be a function',
    )
    expect(() => generateVitestContractFilesFromAnalysis(null as any, { outputDir: '/test/generated' })).toThrow(
      'analysis must include discovery data',
    )
    expect(() => generateVitestContractFilesFromPlan({ suites: [], contractsWithoutImplementations: [], unresolvedImplementations: [] }, null as any)).toThrow(
      'options must be an object',
    )
  })
})
