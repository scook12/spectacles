import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDiscoveryWorkspace } from '../discovery-backend.ts'
import { analyzeOxcDiscoveryTsConfig, analyzeOxcDiscoveryWorkspace } from '../discovery-scanner-oxc.ts'
import {
  generateVitestContractFiles,
  generateVitestContractFilesFromPlan,
  generateVitestContractFilesFromTsConfig,
  writeGeneratedVitestContractFiles,
} from '../generation.ts'

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

function createCollisionWorkspace() {
  return createDiscoveryWorkspace([
    {
      filePath: '/src/contracts.ts',
      text: `
        import { contract } from 'spectacles'
        import { z } from 'zod'

        export const Alpha = contract('Alpha', { input: z.string(), output: z.string() })
        export const Beta = contract('Beta', { input: z.string(), output: z.string() })
      `,
    },
    {
      filePath: '/src/implementations.ts',
      text: `
        import { implement } from 'spectacles'
        import { Alpha, Beta } from './contracts'

        export const alpha = implement(Alpha, (input) => input)
        export const beta = implement(Beta, (input) => input)
      `,
    },
  ])
}

function createGenerationTsConfigFixture(): { rootDir: string; tsConfigFilePath: string } {
  const rootDir = mkdtempSync(join(tmpdir(), 'spectacles-generation-tsconfig-'))
  const srcDir = join(rootDir, 'src')
  mkdirSync(srcDir, { recursive: true })

  writeFileSync(
    join(rootDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'esnext',
        baseUrl: '.',
        paths: {
          '@/*': ['src/*'],
        },
      },
      include: ['src/**/*.ts'],
    }, null, 2),
  )

  writeFileSync(
    join(srcDir, 'contracts.ts'),
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

  writeFileSync(
    join(srcDir, 'implementations.ts'),
    `
      import { implement } from 'spectacles'
      import { RangeLength } from '@/contracts'

      export const rangeLength = implement(RangeLength, ({ start, end }) => end - start)
    `,
  )

  return {
    rootDir,
    tsConfigFilePath: join(rootDir, 'tsconfig.json'),
  }
}

function createFailingGeneratedSuiteFixture(): { rootDir: string; tsConfigFilePath: string } {
  const tempRoot = resolve(process.cwd(), '.tmp')
  mkdirSync(tempRoot, { recursive: true })

  const rootDir = mkdtempSync(join(tempRoot, 'spectacles-generated-suite-failure-'))
  const srcDir = join(rootDir, 'src')
  mkdirSync(srcDir, { recursive: true })

  writeFileSync(
    join(rootDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'esnext',
      },
      include: ['src/**/*.ts', 'generated/**/*.ts'],
    }, null, 2),
  )

  writeFileSync(
    join(rootDir, 'vitest.config.ts'),
    `
      import { defineConfig } from 'vitest/config'

      export default defineConfig({
        test: {
          include: ['generated/**/*.test.ts'],
        },
      })
    `,
  )

  writeFileSync(
    join(srcDir, 'contracts.ts'),
    `
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
    `,
  )

  writeFileSync(
    join(srcDir, 'implementations.ts'),
    `
      import { implement } from 'spectacles'
      import { RangeLength } from './contracts'

      export const rangeLength = implement(RangeLength, () => 0)
    `,
  )

  return {
    rootDir,
    tsConfigFilePath: join(rootDir, 'tsconfig.json'),
  }
}

describe('generateVitestContractFiles()', () => {
  it('generates contract files from discovery analysis', () => {
    const analysis = analyzeOxcDiscoveryWorkspace(createGenerationWorkspace())
    const result = generateVitestContractFiles(analysis, {
      outputDir: '/test/generated',
      runOptions: { numRuns: 50, invalidArgs: 'reject' },
      writeFiles: false,
    })

    expect(result.plan.suites).toHaveLength(1)
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.outputFilePath).toBe('/test/generated/range-length--range-length.contract.test.ts')
    expect(result.files[0]?.content).toContain("import { RangeLength } from '../../src/contracts.js'")
    expect(result.files[0]?.content).toContain("import { rangeLength } from '../../src/implementations.js'")
    expect(result.files[0]?.content).toContain('Check 1 postcondition over generated valid argument lists')
    expect(result.files[0]?.content).toContain('    numRuns: 50,')
    expect(result.files[0]?.content).toContain('    invalidArgs: "reject",')
  })

  it('supports custom naming and skipping writes', () => {
    const analysis = analyzeOxcDiscoveryWorkspace(createGenerationWorkspace())
    const result = generateVitestContractFiles(analysis, {
      outputDir: '/test/generated',
      fileName: () => 'custom-suite.spec.ts',
      writeFiles: false,
      includePlanComments: false,
    })

    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.outputFilePath).toBe('/test/generated/custom-suite.spec.ts')
    expect(result.files[0]?.content).not.toContain('Generated contract suite')
  })

  it('generates files from tsconfig using the default TypeScript workspace + OXC path', () => {
    const fixture = createGenerationTsConfigFixture()

    try {
      const analysis = analyzeOxcDiscoveryTsConfig(fixture.tsConfigFilePath)
      expect(analysis.discovery.contracts).toHaveLength(1)

      const result = generateVitestContractFilesFromTsConfig(fixture.tsConfigFilePath, {
        outputDir: join(fixture.rootDir, 'test/generated'),
        runOptions: { invalidArgs: 'reject' },
      })

      expect(result.analysis.workspace.tsConfigFilePath).toBe(fixture.tsConfigFilePath)
      expect(result.files).toHaveLength(1)
      expect(readFileSync(join(fixture.rootDir, 'test/generated/range-length--range-length.contract.test.ts'), 'utf8')).toBe(
        result.files[0]?.content,
      )
      expect(result.files[0]?.content).toContain('Check 1 postcondition over generated valid argument lists')
      expect(result.files[0]?.content).toContain('    invalidArgs: "reject",')
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true })
    }
  })

  it('renders from a precomputed plan and can write generated files to the filesystem', () => {
    const analysis = analyzeOxcDiscoveryWorkspace(createGenerationWorkspace())
    const plan = generateVitestContractFiles(analysis, {
      outputDir: '/unused',
      writeFiles: false,
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
    const analysis = analyzeOxcDiscoveryWorkspace(createCollisionWorkspace())
    const result = generateVitestContractFiles(analysis, {
      outputDir: '/test/generated',
      fileName: () => 'suite.test.ts',
      writeFiles: false,
    })

    expect(result.files).toHaveLength(2)
    expect(result.files.map((file) => file.outputFilePath)).toEqual([
      '/test/generated/suite.test.ts',
      '/test/generated/suite-2.test.ts',
    ])
  })

  it('rejects invalid options', () => {
    const analysis = analyzeOxcDiscoveryWorkspace(createGenerationWorkspace())

    expect(() => generateVitestContractFiles(null as any, { outputDir: '/test/generated' })).toThrow(
      'analysis must include discovery data',
    )
    expect(() => generateVitestContractFiles(analysis, null as any)).toThrow('options must be an object')
    expect(() => generateVitestContractFiles(analysis, { outputDir: '' })).toThrow(
      'options.outputDir must be a non-empty string',
    )
    expect(() => generateVitestContractFiles(analysis, { outputDir: '/test/generated', fileName: 'bad' as any })).toThrow(
      'options.fileName must be a function',
    )
    expect(() => generateVitestContractFiles(null as any, { outputDir: '/test/generated' })).toThrow(
      'analysis must include discovery data',
    )
    expect(() => generateVitestContractFilesFromPlan({ suites: [], contractsWithoutImplementations: [], unresolvedImplementations: [] }, null as any)).toThrow(
      'options must be an object',
    )
  })

  it('produces generated suites that fail for incorrect implementations', () => {
    const fixture = createFailingGeneratedSuiteFixture()

    try {
      const result = generateVitestContractFilesFromTsConfig(fixture.tsConfigFilePath, {
        outputDir: join(fixture.rootDir, 'generated'),
      })

      expect(result.files).toHaveLength(1)

      const vitestCliPath = resolve(process.cwd(), 'node_modules/vitest/vitest.mjs')
      const completed = spawnSync(
        process.execPath,
        [vitestCliPath, 'run', '--config', join(fixture.rootDir, 'vitest.config.ts')],
        {
          cwd: fixture.rootDir,
          encoding: 'utf8',
          timeout: 20_000,
        },
      )

      expect(completed.error).toBeUndefined()
      expect(completed.status).not.toBe(0)

      const output = `${completed.stdout}\n${completed.stderr}`
      expect(output).toContain('example: simple range')
      expect(output).toContain('postcondition failed: difference')
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true })
    }
  }, 25_000)
})
