import { describe, expect, it } from 'vitest'
import { Project } from 'ts-morph'

import {
  discoverContracts,
  discoverImplementations,
  discoverProject,
} from '../discovery.ts'

function createDiscoveryProject(): Project {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
  })

  project.createSourceFile(
    '/src/contracts.ts',
    `
      import { contract as defineContract } from 'spectacles'
      import { z } from 'zod'

      export const NamedContract = defineContract('NamedContract', {
        input: z.string(),
        output: z.number(),
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
  )

  project.createSourceFile(
    '/src/implementations.ts',
    `
      import DefaultContract, { NamedContract as AliasNamed, RenamedContract } from './contracts'
      import * as defs from './contracts'
      import { implement as bind } from 'spectacles'

      export const namedImpl = bind(AliasNamed, (input) => input.length)
      export const renamedImpl = bind(RenamedContract, (input) => input)
      export const namespaceImpl = bind(defs.NamedContract, (input) => input.length)
      export default bind(DefaultContract, (input) => input)
    `,
  )

  project.createSourceFile(
    '/src/same-file.ts',
    `
      import { contract, implement } from 'spectacles'
      import { z } from 'zod'

      export const LocalContract = contract('LocalContract', {
        input: z.string(),
        output: z.string(),
      })

      export const localImpl = implement(LocalContract, (input) => input)
    `,
  )

  project.createSourceFile(
    '/src/unresolved.ts',
    `
      import { implement } from 'spectacles'

      export const unknownImpl = implement(MissingContract, (input) => input)
    `,
  )

  return project
}

describe('discovery', () => {
  it('discovers exported contracts, including aliased and default exports', () => {
    const contracts = discoverContracts(createDiscoveryProject())

    expect(contracts).toHaveLength(4)

    expect(contracts).toContainEqual({
      kind: 'contract',
      filePath: '/src/contracts.ts',
      localName: 'NamedContract',
      exportNames: ['NamedContract'],
      isDefaultExport: false,
      runtimeName: 'NamedContract',
    })

    expect(contracts).toContainEqual({
      kind: 'contract',
      filePath: '/src/contracts.ts',
      localName: 'RenamedLocal',
      exportNames: ['RenamedContract'],
      isDefaultExport: false,
      runtimeName: 'RenamedRuntime',
    })

    expect(contracts).toContainEqual({
      kind: 'contract',
      filePath: '/src/contracts.ts',
      exportNames: ['default'],
      isDefaultExport: true,
      runtimeName: 'DefaultContract',
    })

    expect(contracts).toContainEqual({
      kind: 'contract',
      filePath: '/src/same-file.ts',
      localName: 'LocalContract',
      exportNames: ['LocalContract'],
      isDefaultExport: false,
      runtimeName: 'LocalContract',
    })
  })

  it('discovers exported implementations and resolves their contracts', () => {
    const project = createDiscoveryProject()
    const contracts = discoverContracts(project)
    const implementations = discoverImplementations(project, contracts)

    expect(implementations).toHaveLength(6)

    expect(implementations).toContainEqual({
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

    expect(implementations).toContainEqual({
      kind: 'implementation',
      filePath: '/src/implementations.ts',
      localName: 'renamedImpl',
      exportNames: ['renamedImpl'],
      isDefaultExport: false,
      contract: {
        filePath: '/src/contracts.ts',
        localName: 'RenamedLocal',
        exportName: 'RenamedContract',
        runtimeName: 'RenamedRuntime',
      },
    })

    expect(implementations).toContainEqual({
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

    expect(implementations).toContainEqual({
      kind: 'implementation',
      filePath: '/src/implementations.ts',
      exportNames: ['default'],
      isDefaultExport: true,
      contract: {
        filePath: '/src/contracts.ts',
        exportName: 'default',
        runtimeName: 'DefaultContract',
      },
    })

    expect(implementations).toContainEqual({
      kind: 'implementation',
      filePath: '/src/same-file.ts',
      localName: 'localImpl',
      exportNames: ['localImpl'],
      isDefaultExport: false,
      contract: {
        filePath: '/src/same-file.ts',
        localName: 'LocalContract',
        exportName: 'LocalContract',
        runtimeName: 'LocalContract',
      },
    })

    expect(implementations).toContainEqual({
      kind: 'implementation',
      filePath: '/src/unresolved.ts',
      localName: 'unknownImpl',
      exportNames: ['unknownImpl'],
      isDefaultExport: false,
      contract: null,
    })
  })

  it('discovers contracts and implementations together', () => {
    const result = discoverProject(createDiscoveryProject())

    expect(result.contracts).toHaveLength(4)
    expect(result.implementations).toHaveLength(6)
  })
})
