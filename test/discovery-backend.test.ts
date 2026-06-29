import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { Project } from 'ts-morph'

import {
  buildDiscoveryIndex,
  createDiscoveryWorkspace,
  createEmptyScannedContractClauseSummary,
  createTypeScriptDiscoveryWorkspace,
  createTsMorphDiscoveryBackend,
  createTsMorphDiscoveryWorkspace,
  createWorkspaceDiscoveryBackend,
  describeOxcDiscoveryBackendPlan,
  pairDiscoveryWorkspaceScan,
  summarizeScannedContractClauses,
  type DiscoveryAstScanner,
} from '../discovery-backend.ts'

function createDiscoveryProject(): Project {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
  })

  project.createSourceFile(
    '/src/contracts.ts',
    `
      import { contract } from 'spectacles'
      import { z } from 'zod'

      export const Echo = contract('Echo', {
        input: z.string(),
        output: z.string(),
      })

      export const Length = contract('Length', {
        input: z.string(),
        output: z.number(),
      })
    `,
  )

  project.createSourceFile(
    '/src/implementations.ts',
    `
      import { implement } from 'spectacles'
      import { Echo } from './contracts'

      export const echo = implement(Echo, (input) => input)
      export const unresolved = implement(MissingContract, (input) => input)
    `,
  )

  return project
}

function createTsConfigWorkspaceFixture(): { rootDir: string; tsConfigFilePath: string } {
  const rootDir = mkdtempSync(join(tmpdir(), 'spectacles-tsconfig-workspace-'))
  const srcDir = join(rootDir, 'src')
  const ignoredDir = join(rootDir, 'ignored')
  mkdirSync(srcDir, { recursive: true })
  mkdirSync(ignoredDir, { recursive: true })

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
      exclude: ['ignored/**'],
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
      import { Echo } from '@/contracts'

      export const echo = implement(Echo, (input) => input)
    `,
  )

  writeFileSync(
    join(ignoredDir, 'ignored.ts'),
    `
      export const ignored = true
    `,
  )

  return {
    rootDir,
    tsConfigFilePath: join(rootDir, 'tsconfig.json'),
  }
}

describe('discovery backend sketch', () => {
  it('adapts the existing ts-morph discovery path behind a backend interface', () => {
    const backend = createTsMorphDiscoveryBackend()
    const result = backend.discover(createDiscoveryProject())

    expect(backend.name).toBe('ts-morph')
    expect(backend.capabilities.supportsModuleResolution).toBe(true)
    expect(result.contracts).toHaveLength(2)
    expect(result.implementations).toHaveLength(2)
  })

  it('builds a compact discovery index for agent-friendly traversal', () => {
    const backend = createTsMorphDiscoveryBackend()
    const result = backend.discover(createDiscoveryProject())
    const index = buildDiscoveryIndex(result)

    expect(index.contracts).toHaveLength(2)
    expect(index.implementations).toHaveLength(2)
    expect(index.unresolvedImplementationIds).toHaveLength(1)
    expect(index.unimplementedContractIds).toHaveLength(1)

    const implementedContract = index.contracts.find((contract) => contract.runtimeName === 'Echo')
    expect(implementedContract?.implementationIds).toHaveLength(1)

    const unresolvedImplementation = index.implementations.find((implementation) => implementation.localName === 'unresolved')
    expect(unresolvedImplementation?.contractId).toBeNull()
  })

  it('summarizes scanned contract clauses for planning and agent navigation', () => {
    expect(summarizeScannedContractClauses([
      { kind: 'where', argumentCount: 2 },
      { kind: 'pre', name: 'precondition A', argumentCount: 2 },
      { kind: 'post', name: 'postcondition A', argumentCount: 2 },
      { kind: 'law', name: 'law A', argumentCount: 3 },
      { kind: 'example', name: 'example A', argumentCount: 2 },
    ])).toEqual({
      whereCount: 2,
      preNames: ['precondition A'],
      postNames: ['postcondition A'],
      lawNames: ['law A'],
      exampleNames: ['example A'],
    })

    expect(createEmptyScannedContractClauseSummary()).toEqual({
      whereCount: 0,
      preNames: [],
      postNames: [],
      lawNames: [],
      exampleNames: [],
    })
  })

  it('creates a resolver-backed workspace from ts-morph project files', () => {
    const workspace = createTsMorphDiscoveryWorkspace(createDiscoveryProject())

    expect(workspace.files).toHaveLength(2)
    expect(workspace.getFile('/src/contracts.ts')?.text).toContain("export const Echo = contract('Echo'")
    expect(workspace.resolver.resolveModule('/src/implementations.ts', './contracts')).toEqual({
      fromFilePath: '/src/implementations.ts',
      specifier: './contracts',
      resolvedFilePath: '/src/contracts.ts',
      resolutionKind: 'source-file',
    })
    expect(workspace.resolver.resolveModule('/src/contracts.ts', 'zod').resolutionKind).toBe('external')
  })

  it('creates a resolver-backed workspace from tsconfig file-set and TypeScript module resolution', () => {
    const fixture = createTsConfigWorkspaceFixture()

    try {
      const workspace = createTypeScriptDiscoveryWorkspace(fixture.tsConfigFilePath)

      expect(workspace.tsConfigFilePath).toBe(fixture.tsConfigFilePath)
      expect(workspace.files.some((file) => file.filePath.endsWith('/src/contracts.ts'))).toBe(true)
      expect(workspace.files.some((file) => file.filePath.endsWith('/src/implementations.ts'))).toBe(true)
      expect(workspace.files.some((file) => file.filePath.endsWith('/ignored/ignored.ts'))).toBe(false)

      const implementationsFilePath = join(fixture.rootDir, 'src', 'implementations.ts')
      expect(workspace.resolver.resolveModule(implementationsFilePath, '@/contracts')).toEqual({
        fromFilePath: implementationsFilePath,
        specifier: '@/contracts',
        resolvedFilePath: join(fixture.rootDir, 'src', 'contracts.ts'),
        resolutionKind: 'source-file',
      })
      expect(workspace.resolver.resolveModule(implementationsFilePath, 'zod').resolutionKind).toBe('external')
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true })
    }
  })

  it('pairs a scanned source-text workspace into contracts and implementations', () => {
    const workspace = createDiscoveryWorkspace([
      {
        filePath: '/src/contracts.ts',
        text: 'contracts source',
      },
      {
        filePath: '/src/implementations.ts',
        text: 'implementations source',
      },
    ])

    const result = pairDiscoveryWorkspaceScan(workspace, [
      {
        filePath: '/src/contracts.ts',
        imports: [],
        reExports: [],
        diagnostics: [],
        contracts: [
          {
            kind: 'contract',
            filePath: '/src/contracts.ts',
            export: {
              localName: 'Echo',
              exportNames: ['Echo'],
              isDefaultExport: false,
              sourceSpan: { start: 0, end: 4 },
            },
            runtimeName: 'Echo',
            clauses: [
              { kind: 'where', argumentCount: 1, sourceSpan: { start: 5, end: 10 } },
              { kind: 'post', name: 'echoes input', argumentCount: 2, sourceSpan: { start: 11, end: 20 } },
            ],
            clauseSummary: summarizeScannedContractClauses([
              { kind: 'where', argumentCount: 1 },
              { kind: 'post', name: 'echoes input', argumentCount: 2 },
            ]),
            sourceSpan: { start: 0, end: 20 },
          },
        ],
        implementations: [],
      },
      {
        filePath: '/src/implementations.ts',
        imports: [
          {
            kind: 'named',
            specifier: './contracts',
            localName: 'EchoAlias',
            importedName: 'Echo',
            sourceSpan: { start: 0, end: 10 },
          },
        ],
        diagnostics: [],
        reExports: [],
        contracts: [],
        implementations: [
          {
            kind: 'implementation',
            filePath: '/src/implementations.ts',
            export: {
              localName: 'echo',
              exportNames: ['echo'],
              isDefaultExport: false,
              sourceSpan: { start: 11, end: 15 },
            },
            contractReference: {
              kind: 'identifier',
              name: 'EchoAlias',
              sourceSpan: { start: 16, end: 25 },
            },
            sourceSpan: { start: 11, end: 25 },
          },
        ],
      },
    ])

    expect(result.contracts).toHaveLength(1)
    expect(result.implementations).toContainEqual({
      kind: 'implementation',
      filePath: '/src/implementations.ts',
      localName: 'echo',
      exportNames: ['echo'],
      isDefaultExport: false,
      contract: {
        filePath: '/src/contracts.ts',
        localName: 'Echo',
        exportName: 'Echo',
        runtimeName: 'Echo',
      },
    })
  })

  it('supports workspace discovery backends built around parsed file scanners', () => {
    const workspace = createDiscoveryWorkspace([
      {
        filePath: '/src/contracts.ts',
        text: 'contract-file',
      },
      {
        filePath: '/src/implementations.ts',
        text: 'implementation-file',
      },
    ])

    const scanner: DiscoveryAstScanner<{ readonly upper: string }> = {
      name: 'fake-scanner',
      parse(_filePath, text) {
        return { upper: text.toUpperCase() }
      },
      scanParsedFile(file) {
        if (file.ast.upper === 'CONTRACT-FILE') {
          return {
            filePath: file.filePath,
            imports: [],
            reExports: [],
            diagnostics: [],
            contracts: [
              {
                kind: 'contract',
                filePath: file.filePath,
                export: {
                  localName: 'Echo',
                  exportNames: ['Echo'],
                  isDefaultExport: false,
                  sourceSpan: { start: 0, end: 4 },
                },
                runtimeName: 'Echo',
                clauses: [
                  { kind: 'example', name: 'round-trip', argumentCount: 2, sourceSpan: { start: 5, end: 15 } },
                ],
                clauseSummary: summarizeScannedContractClauses([
                  { kind: 'example', name: 'round-trip', argumentCount: 2 },
                ]),
                sourceSpan: { start: 0, end: 15 },
              },
            ],
            implementations: [],
          }
        }

        return {
          filePath: file.filePath,
          imports: [
            {
              kind: 'named',
              specifier: './contracts',
              localName: 'Echo',
              importedName: 'Echo',
              sourceSpan: { start: 0, end: 10 },
            },
          ],
          reExports: [],
          diagnostics: [
            {
              severity: 'info',
              message: 'implementation scanned successfully',
              sourceSpan: { start: 11, end: 20 },
            },
          ],
          contracts: [],
          implementations: [
            {
              kind: 'implementation',
              filePath: file.filePath,
              export: {
                localName: 'echo',
                exportNames: ['echo'],
                isDefaultExport: false,
                sourceSpan: { start: 11, end: 15 },
              },
              contractReference: {
                kind: 'identifier',
                name: 'Echo',
                sourceSpan: { start: 16, end: 20 },
              },
              sourceSpan: { start: 11, end: 20 },
            },
          ],
        }
      },
    }

    const backend = createWorkspaceDiscoveryBackend({
      name: 'fake-oxc-ready-backend',
      scanner,
    })
    const result = backend.discover(workspace)

    expect(backend.capabilities.supportsSourceTextWorkspaces).toBe(true)
    expect(result.contracts).toHaveLength(1)
    expect(result.implementations[0]?.contract?.runtimeName).toBe('Echo')
  })

  it('describes the planned oxc backend layers', () => {
    const plan = describeOxcDiscoveryBackendPlan()

    expect(plan.name).toBe('oxc')
    expect(plan.capabilities.supportsSourceTextWorkspaces).toBe(true)
    expect(plan.requiredLayers).toContain('module-resolution')
    expect(plan.notes.some((note) => note.includes('AI agents') || note.includes('agent'))).toBe(true)
  })
})
