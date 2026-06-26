import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatCliHelp, parseCliArgs, runCli } from '../src/cli.ts'
import { generateVitestContractFilesFromTsConfig } from '../generation.ts'

function createFixtureProject(): { rootDir: string; tsConfigFilePath: string } {
  const rootDir = mkdtempSync(join(tmpdir(), 'spectacles-'))
  const srcDir = join(rootDir, 'src')
  mkdirSync(srcDir, { recursive: true })

  writeFileSync(
    join(rootDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        target: 'esnext',
      },
      include: ['src/**/*.ts'],
    }, null, 2),
  )

  writeFileSync(
    join(srcDir, 'contracts.ts'),
    `
      import { contract } from 'spectacles'
      import { z } from 'zod'

      export const Echo = contract('Echo', {
        input: z.string(),
        output: z.string(),
      })
    `,
  )

  writeFileSync(
    join(srcDir, 'implementations.ts'),
    `
      import { implement } from 'spectacles'
      import { Echo } from './contracts'

      export const echo = implement(Echo, (input) => input)
    `,
  )

  return {
    rootDir,
    tsConfigFilePath: join(rootDir, 'tsconfig.json'),
  }
}

describe('generateVitestContractFilesFromTsConfig()', () => {
  it('creates a project from tsconfig and writes generated files by default', () => {
    const fixture = createFixtureProject()

    try {
      const result = generateVitestContractFilesFromTsConfig(fixture.tsConfigFilePath, {
        outputDir: join(fixture.rootDir, 'test/generated'),
        runOptions: { numRuns: 10 },
      })

      expect(result.files).toHaveLength(1)
      const generatedPath = join(fixture.rootDir, 'test/generated/echo--echo.contract.test.ts')
      expect(readFileSync(generatedPath, 'utf8')).toBe(result.files[0]?.content)
      expect(result.project.getSourceFile(generatedPath)).toBeDefined()
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true })
    }
  })
})

describe('cli', () => {
  it('parses generate arguments', () => {
    expect(parseCliArgs([
      'generate',
      '--project',
      'tsconfig.json',
      '--out',
      'test/generated',
      '--runs',
      '25',
      '--timeout',
      '1000',
      '--seed',
      '7',
      '--no-comments',
      '--dry-run',
    ])).toEqual({
      kind: 'generate',
      project: 'tsconfig.json',
      outputDir: 'test/generated',
      numRuns: 25,
      timeoutMs: 1000,
      seed: 7,
      includePlanComments: false,
      dryRun: true,
    })
  })

  it('formats help and can run in dry-run mode', async () => {
    const fixture = createFixtureProject()
    const out: string[] = []
    const err: string[] = []

    try {
      expect(formatCliHelp()).toContain('spectacles generate --project <tsconfig.json> --out <generated-test-dir>')

      const exitCode = await runCli([
        'generate',
        '--project',
        fixture.tsConfigFilePath,
        '--out',
        join(fixture.rootDir, 'test/generated'),
        '--dry-run',
      ], {
        out: (message) => out.push(message),
        err: (message) => err.push(message),
      })

      expect(exitCode).toBe(0)
      expect(out[0]).toBe('Generated 1 contract test file(s).')
      expect(out.some((line) => line.includes('echo--echo.contract.test.ts'))).toBe(true)
      expect(err).toEqual([])
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true })
    }
  })
})
