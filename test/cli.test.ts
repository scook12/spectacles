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

      export const Unused = contract('Unused', {
        input: z.number(),
        output: z.number(),
      })
    `,
  )

  writeFileSync(
    join(srcDir, 'implementations.ts'),
    `
      import { implement } from 'spectacles'
      import { Echo } from './contracts'

      export const echo = implement(Echo, (input) => input)
      export const unresolved = implement(MissingContract, (input) => input)
    `,
  )

  return {
    rootDir,
    tsConfigFilePath: join(rootDir, 'tsconfig.json'),
  }
}

describe('generateVitestContractFilesFromTsConfig()', () => {
  it('uses the default tsconfig analysis path and writes generated files by default', () => {
    const fixture = createFixtureProject()

    try {
      const result = generateVitestContractFilesFromTsConfig(fixture.tsConfigFilePath, {
        outputDir: join(fixture.rootDir, 'test/generated'),
        runOptions: { numRuns: 10 },
      })

      expect(result.files).toHaveLength(1)
      const generatedPath = join(fixture.rootDir, 'test/generated/echo--echo.contract.test.ts')
      expect(readFileSync(generatedPath, 'utf8')).toBe(result.files[0]?.content)
      expect(result.analysis.workspace.tsConfigFilePath).toBe(fixture.tsConfigFilePath)
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
      '--invalid',
      'reject',
      '--no-comments',
      '--dry-run',
    ])).toEqual({
      kind: 'generate',
      tsConfigFilePath: 'tsconfig.json',
      outputDir: 'test/generated',
      numRuns: 25,
      timeoutMs: 1000,
      seed: 7,
      invalidArgs: 'reject',
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
      expect(out.some((line) => line.includes('Contracts without implementations: 1'))).toBe(true)
      expect(out.some((line) => line.includes('Unused'))).toBe(true)
      expect(out.some((line) => line.includes('Unresolved implementations: 1'))).toBe(true)
      expect(out.some((line) => line.includes('unresolved'))).toBe(true)
      expect(err).toEqual([])
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true })
    }
  })

  it('covers parse and run error paths', async () => {
    expect(() => parseCliArgs(['wat'])).toThrow('Unknown command: wat')
    expect(() => parseCliArgs(['generate', '--project'])).toThrow('Missing required option: --project')
    expect(() => parseCliArgs(['generate', '--out', 'test/generated'])).toThrow('Missing required option: --project')
    expect(() => parseCliArgs(['generate', '--project', 'tsconfig.json', '--out', 'out', '--runs', 'abc'])).toThrow(
      'Invalid integer for --runs: abc',
    )
    expect(() => parseCliArgs(['generate', '--project', 'tsconfig.json', '--out', 'out', '--timeout'])).toThrow(
      'Missing value for --timeout',
    )
    expect(() => parseCliArgs(['generate', '--project', 'tsconfig.json', '--out', 'out', '--invalid', 'boom'])).toThrow(
      'Invalid value for --invalid: boom',
    )
    expect(() => parseCliArgs(['generate', '--project', 'tsconfig.json', '--out', 'out', '--mystery'])).toThrow(
      'Unknown option: --mystery',
    )

    const out: string[] = []
    const err: string[] = []
    const exitCode = await runCli(['wat'], {
      out: (message) => out.push(message),
      err: (message) => err.push(message),
    })
    expect(exitCode).toBe(1)
    expect(out).toEqual([])
    expect(err[0]).toContain('Unknown command: wat')
    expect(err.at(-1)).toContain('spectacles --help')

    const helpOut: string[] = []
    const helpErr: string[] = []
    const helpExitCode = await runCli(['--help'], {
      out: (message) => helpOut.push(message),
      err: (message) => helpErr.push(message),
    })
    expect(helpExitCode).toBe(0)
    expect(helpOut[0]).toContain('spectacles generate')
    expect(helpErr).toEqual([])
  })
})
