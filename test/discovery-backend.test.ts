import { describe, expect, it } from 'vitest'
import { Project } from 'ts-morph'

import {
  buildDiscoveryIndex,
  createDiscoveryWorkspace,
  createTsMorphDiscoveryBackend,
  createTsMorphDiscoveryWorkspace,
  createWorkspaceDiscoveryBackend,
  describeOxcDiscoveryBackendPlan,
  pairDiscoveryWorkspaceScan,
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
        contracts: [
          {
            kind: 'contract',
            filePath: '/src/contracts.ts',
            localName: 'Echo',
            exportNames: ['Echo'],
            isDefaultExport: false,
            runtimeName: 'Echo',
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
          },
        ],
        contracts: [],
        implementations: [
          {
            kind: 'implementation',
            filePath: '/src/implementations.ts',
            localName: 'echo',
            exportNames: ['echo'],
            isDefaultExport: false,
            contractReference: {
              kind: 'identifier',
              name: 'EchoAlias',
            },
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
            contracts: [
              {
                kind: 'contract',
                filePath: file.filePath,
                localName: 'Echo',
                exportNames: ['Echo'],
                isDefaultExport: false,
                runtimeName: 'Echo',
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
            },
          ],
          contracts: [],
          implementations: [
            {
              kind: 'implementation',
              filePath: file.filePath,
              localName: 'echo',
              exportNames: ['echo'],
              isDefaultExport: false,
              contractReference: {
                kind: 'identifier',
                name: 'Echo',
              },
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
