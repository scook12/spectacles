import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createDiscoveryWorkspace } from '../discovery-backend.ts'
import {
  analyzeOxcDiscoveryTsConfig,
  createOxcDiscoveryAstScanner,
  createOxcDiscoveryBackend,
} from '../discovery-scanner-oxc.ts'

function createDiscoveryWorkspaceFixture() {
  return createDiscoveryWorkspace([
    {
      filePath: '/src/contracts.ts',
      text: `
        import { contract as defineContract } from 'spectacles'
        import { z } from 'zod'

        export const NamedContract = defineContract('NamedContract', {
          input: z.string(),
          output: z.number(),
        })
          .where(predicateA)
          .post('length result', predicateB)
          .example('abc', {
            input: 'abc',
            output: 3,
          })

        const RenamedLocal = defineContract('RenamedRuntime', {
          input: z.boolean(),
          output: z.boolean(),
        })
        export { RenamedLocal as RenamedContract }

        export default defineContract('DefaultContract', {
          input: z.number(),
          output: z.number(),
        })
      `,
    },
    {
      filePath: '/src/implementations.ts',
      text: `
        import DefaultContract, { NamedContract as AliasNamed, RenamedContract } from './contracts'
        import * as defs from './contracts'
        import { implement as bind } from 'spectacles'

        export const namedImpl = bind(AliasNamed, (input) => input.length)
        export const renamedImpl = bind(RenamedContract, (input) => input)
        export const namespaceImpl = bind(defs.NamedContract, (input) => input.length)
        export default bind(DefaultContract, (input) => input)
      `,
    },
    {
      filePath: '/src/same-file.ts',
      text: `
        import { contract, implement } from 'spectacles'
        import { z } from 'zod'

        export const LocalContract = contract('LocalContract', {
          input: z.string(),
          output: z.string(),
        })

        export const localImpl = implement(LocalContract, (input) => input)
      `,
    },
    {
      filePath: '/src/unresolved.ts',
      text: `
        import { implement } from 'spectacles'

        export const unknownImpl = implement(MissingContract, (input) => input)
      `,
    },
  ])
}

function createReExportWorkspaceFixture() {
  return createDiscoveryWorkspace([
    {
      filePath: '/src/contracts.ts',
      text: `
        import { contract } from 'spectacles'
        import { z } from 'zod'

        export const Echo = contract('Echo', {
          input: z.string(),
          output: z.string(),
        })
      `,
    },
    {
      filePath: '/src/contracts-barrel.ts',
      text: `
        export { Echo as EchoAlias } from './contracts'
        export * from './contracts'
      `,
    },
    {
      filePath: '/src/implementations.ts',
      text: `
        import { implement } from 'spectacles'
        import { EchoAlias } from './contracts-barrel'

        export const echo = implement(EchoAlias, (input) => input)
      `,
    },
    {
      filePath: '/src/implementations-barrel.ts',
      text: `
        export { echo as echoAlias } from './implementations'
      `,
    },
  ])
}

function createTsConfigScannerFixture(): { rootDir: string; tsConfigFilePath: string } {
  const rootDir = mkdtempSync(join(tmpdir(), 'spectacles-oxc-tsconfig-'))
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

      export const Echo = contract('Echo', {
        input: z.string(),
        output: z.string(),
      })
        .where(field('input').exists())
        .example('hello', { input: 'hello', output: 'hello' })
    `,
  )

  writeFileSync(
    join(srcDir, 'implementations.ts'),
    `
      import { implement } from 'spectacles'
      import { Echo } from '@/contracts'

      export const echo = implement(Echo, (input) => input)
    `,
  )

  return {
    rootDir,
    tsConfigFilePath: join(rootDir, 'tsconfig.json'),
  }
}

describe('oxc discovery scanner', () => {
  it('scans imports, exported call bindings, and contract clauses from a file', () => {
    const workspace = createDiscoveryWorkspaceFixture()
    const scanner = createOxcDiscoveryAstScanner()
    const file = workspace.getFile('/src/contracts.ts')
    expect(file).toBeDefined()

    const parsed = scanner.parse('/src/contracts.ts', file?.text ?? '')
    const scanned = scanner.scanParsedFile({
      filePath: '/src/contracts.ts',
      text: file?.text ?? '',
      ast: parsed,
    })

    expect(scanned.imports).toContainEqual({
      kind: 'named',
      specifier: 'spectacles',
      localName: 'defineContract',
      importedName: 'contract',
      sourceSpan: expect.any(Object),
    })

    expect(scanned.contracts).toContainEqual({
      kind: 'contract',
      filePath: '/src/contracts.ts',
      export: {
        localName: 'NamedContract',
        exportNames: ['NamedContract'],
        isDefaultExport: false,
        sourceSpan: expect.any(Object),
      },
      runtimeName: 'NamedContract',
      clauses: [
        {
          kind: 'where',
          argumentCount: 1,
          sourceSpan: expect.any(Object),
        },
        {
          kind: 'post',
          name: 'length result',
          argumentCount: 2,
          sourceSpan: expect.any(Object),
        },
        {
          kind: 'example',
          name: 'abc',
          argumentCount: 2,
          sourceSpan: expect.any(Object),
        },
      ],
      clauseSummary: {
        whereCount: 1,
        preNames: [],
        postNames: ['length result'],
        lawNames: [],
        exampleNames: ['abc'],
      },
      sourceSpan: expect.any(Object),
    })

    expect(scanned.contracts).toContainEqual({
      kind: 'contract',
      filePath: '/src/contracts.ts',
      export: {
        exportNames: ['default'],
        isDefaultExport: true,
        sourceSpan: expect.any(Object),
      },
      runtimeName: 'DefaultContract',
      clauses: [],
      clauseSummary: {
        whereCount: 0,
        preNames: [],
        postNames: [],
        lawNames: [],
        exampleNames: [],
      },
      sourceSpan: expect.any(Object),
    })

    expect(scanned.diagnostics).toEqual([])
  })

  it('discovers contracts and implementations across a workspace with operational resolution', () => {
    const backend = createOxcDiscoveryBackend()
    const result = backend.discover(createDiscoveryWorkspaceFixture())

    expect(result.contracts).toHaveLength(4)
    expect(result.implementations).toHaveLength(6)

    expect(result.contracts).toContainEqual({
      kind: 'contract',
      filePath: '/src/contracts.ts',
      localName: 'NamedContract',
      exportNames: ['NamedContract'],
      isDefaultExport: false,
      runtimeName: 'NamedContract',
    })

    expect(result.contracts).toContainEqual({
      kind: 'contract',
      filePath: '/src/contracts.ts',
      localName: 'RenamedLocal',
      exportNames: ['RenamedContract'],
      isDefaultExport: false,
      runtimeName: 'RenamedRuntime',
    })

    expect(result.implementations).toContainEqual({
      kind: 'implementation',
      filePath: '/src/implementations.ts',
      localName: 'namedImpl',
      exportNames: ['namedImpl'],
      isDefaultExport: false,
      contract: {
        filePath: '/src/contracts.ts',
        localName: 'NamedContract',
        exportName: 'NamedContract',
        runtimeName: 'NamedContract',
      },
    })

    expect(result.implementations).toContainEqual({
      kind: 'implementation',
      filePath: '/src/implementations.ts',
      localName: 'namespaceImpl',
      exportNames: ['namespaceImpl'],
      isDefaultExport: false,
      contract: {
        filePath: '/src/contracts.ts',
        localName: 'NamedContract',
        exportName: 'NamedContract',
        runtimeName: 'NamedContract',
      },
    })

    expect(result.implementations).toContainEqual({
      kind: 'implementation',
      filePath: '/src/unresolved.ts',
      localName: 'unknownImpl',
      exportNames: ['unknownImpl'],
      isDefaultExport: false,
      contract: null,
    })
  })

  it('projects named and export-all re-exports into discovered contracts and implementations', () => {
    const backend = createOxcDiscoveryBackend()
    const result = backend.discover(createReExportWorkspaceFixture())

    expect(result.contracts).toContainEqual({
      kind: 'contract',
      filePath: '/src/contracts-barrel.ts',
      localName: 'Echo',
      exportNames: ['EchoAlias', 'Echo'],
      isDefaultExport: false,
      runtimeName: 'Echo',
    })
    expect(result.implementations).toContainEqual({
      kind: 'implementation',
      filePath: '/src/implementations.ts',
      localName: 'echo',
      exportNames: ['echo'],
      isDefaultExport: false,
      contract: {
        filePath: '/src/contracts-barrel.ts',
        localName: 'Echo',
        exportName: 'EchoAlias',
        runtimeName: 'Echo',
      },
    })
    expect(result.implementations).toContainEqual({
      kind: 'implementation',
      filePath: '/src/implementations-barrel.ts',
      localName: 'echo',
      exportNames: ['echoAlias'],
      isDefaultExport: false,
      contract: {
        filePath: '/src/contracts-barrel.ts',
        localName: 'Echo',
        exportName: 'EchoAlias',
        runtimeName: 'Echo',
      },
    })
  })

  it('analyzes tsconfig-based workspaces using TypeScript file-set and module resolution', () => {
    const fixture = createTsConfigScannerFixture()

    try {
      const analysis = analyzeOxcDiscoveryTsConfig(fixture.tsConfigFilePath)

      expect(analysis.workspace.tsConfigFilePath).toBe(fixture.tsConfigFilePath)
      expect(analysis.discovery.contracts).toContainEqual({
        kind: 'contract',
        filePath: join(fixture.rootDir, 'src', 'contracts.ts'),
        localName: 'Echo',
        exportNames: ['Echo'],
        isDefaultExport: false,
        runtimeName: 'Echo',
      })
      expect(analysis.discovery.implementations).toContainEqual({
        kind: 'implementation',
        filePath: join(fixture.rootDir, 'src', 'implementations.ts'),
        localName: 'echo',
        exportNames: ['echo'],
        isDefaultExport: false,
        contract: {
          filePath: join(fixture.rootDir, 'src', 'contracts.ts'),
          localName: 'Echo',
          exportName: 'Echo',
          runtimeName: 'Echo',
        },
      })
      expect(analysis.scannedFiles.find((file) => file.filePath.endsWith('/contracts.ts'))?.contracts[0]?.clauseSummary).toEqual({
        whereCount: 1,
        preNames: [],
        postNames: [],
        lawNames: [],
        exampleNames: ['hello'],
      })
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true })
    }
  })
})
