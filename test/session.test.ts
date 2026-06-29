import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { Project } from 'ts-morph'

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
  it('memoizes project, discovery, and plans for tsconfig-backed sessions', () => {
    const fixture = createFixtureProject()

    try {
      const session = createSpectaclesSession({ tsConfigFilePath: fixture.tsConfigFilePath })

      const projectA = session.project()
      const projectB = session.project()
      expect(projectA).toBe(projectB)

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
        writeToProject: false,
        save: false,
      })
      expect(generation.plan).toBe(planA)
      expect(generation.files).toHaveLength(1)
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true })
    }
  })

  it('supports wrapping an existing ts-morph project', () => {
    const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true })
    project.createSourceFile('/src/contracts.ts', `
      import { contract } from 'spectacles'
      import { z } from 'zod'
      export const Echo = contract('Echo', { input: z.string(), output: z.string() })
    `)
    project.createSourceFile('/src/implementations.ts', `
      import { implement } from 'spectacles'
      import { Echo } from './contracts'
      export const echo = implement(Echo, (input) => input)
    `)

    const session = createSpectaclesSession({ project })
    expect(session.project()).toBe(project)
    expect(session.discovery().contracts).toHaveLength(1)
    expect(session.generate({ outputDir: '/generated', writeToProject: false, save: false }).files).toHaveLength(1)
  })
})
