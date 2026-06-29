import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDiscoveryWorkspace } from '../discovery-backend.ts'
import { createSpectaclesSession } from '../session.ts'

function createFixtureProject(): { rootDir: string; tsConfigFilePath: string } {
  const rootDir = mkdtempSync(join(tmpdir(), 'spectacles-session-'))
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

describe('createSpectaclesSession()', () => {
  it('memoizes analysis, discovery, plans, and generation for tsconfig-backed sessions', () => {
    const fixture = createFixtureProject()

    try {
      const session = createSpectaclesSession({ tsConfigFilePath: fixture.tsConfigFilePath })

      const analysisA = session.analysis()
      const analysisB = session.analysis()
      expect(analysisA).toBe(analysisB)

      const discoveryA = session.discovery()
      const discoveryB = session.discovery()
      expect(discoveryA).toBe(discoveryB)

      const planA = session.plan()
      const planB = session.plan()
      expect(planA).toBe(planB)

      const rejectPlanA = session.plan({ invalidArgs: 'reject' })
      const rejectPlanB = session.plan({ invalidArgs: 'reject' })
      expect(rejectPlanA).toBe(rejectPlanB)
      expect(rejectPlanA).not.toBe(planA)

      const generation = session.generate({
        outputDir: join(fixture.rootDir, 'test/generated'),
        writeFiles: false,
      })
      expect(generation.plan).toBe(planA)
      expect(generation.files).toHaveLength(1)
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true })
    }
  })

  it('supports wrapping an existing discovery workspace', () => {
    const workspace = createDiscoveryWorkspace([
      {
        filePath: '/src/contracts.ts',
        text: `
          import { contract } from 'spectacles'
          import { z } from 'zod'
          export const Echo = contract('Echo', { input: z.string(), output: z.string() })
        `,
      },
      {
        filePath: '/src/implementations.ts',
        text: `
          import { implement } from 'spectacles'
          import { Echo } from './contracts'
          export const echo = implement(Echo, (input) => input)
        `,
      },
    ])

    const session = createSpectaclesSession({ workspace })
    expect(session.analysis().discovery.contracts).toHaveLength(1)
    expect(session.discovery().contracts).toHaveLength(1)
    expect(session.generate({ outputDir: '/generated', writeFiles: false }).files).toHaveLength(1)
  })
})
