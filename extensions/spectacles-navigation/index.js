import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { Type } from 'typebox'

import { navigateSpectaclesCodebase } from '../../dist/navigation.js'

function normalizePathLike(value) {
  if (typeof value !== 'string') {
    return undefined
  }

  return value.startsWith('@') ? value.slice(1) : value
}

function findNearestTsConfig(startDir) {
  let currentDir = startDir

  while (true) {
    const candidate = resolve(currentDir, 'tsconfig.json')
    if (existsSync(candidate)) {
      return candidate
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      return undefined
    }

    currentDir = parentDir
  }
}

function resolveTsConfigFilePath(input, cwd) {
  const normalizedInput = normalizePathLike(input)
  if (normalizedInput) {
    return resolve(cwd, normalizedInput)
  }

  const discovered = findNearestTsConfig(cwd)
  if (!discovered) {
    throw new Error('Could not find tsconfig.json from the current working directory. Pass tsConfigFilePath explicitly.')
  }

  return discovered
}

function formatToolResult(result) {
  return JSON.stringify(result, null, 2)
}

export default function spectaclesNavigationExtension(pi) {
  pi.registerTool({
    name: 'spectacles_navigate',
    label: 'Spectacles Navigate',
    description: 'Inspect Spectacles contracts, implementations, unresolved links, and source locations in the current TypeScript workspace.',
    promptSnippet: 'Inspect Spectacles contract and implementation relationships through tsconfig-based discovery.',
    promptGuidelines: [
      'Use spectacles_navigate before broad source reads when the repository uses Spectacles and you need contract/implementation relationships or issue summaries.',
      'Use spectacles_navigate with action "search", "contract", or "implementation" to jump to relevant files before reading raw source.',
    ],
    parameters: Type.Object({
      action: Type.Optional(Type.String({
        description: 'Navigation action: summary, search, contracts, contract, implementations, implementation, or issues.',
      })),
      tsConfigFilePath: Type.Optional(Type.String({
        description: 'Optional path to tsconfig.json. Defaults to the nearest tsconfig.json from the current working directory.',
      })),
      query: Type.Optional(Type.String({
        description: 'Search text for actions like search, contracts, or implementations.',
      })),
      id: Type.Optional(Type.String({
        description: 'Stable node id for contract or implementation detail lookups.',
      })),
      name: Type.Optional(Type.String({
        description: 'Name lookup for contract or implementation detail actions when id is not known.',
      })),
      limit: Type.Optional(Type.Integer({
        minimum: 1,
        description: 'Maximum number of results to return for list or search actions.',
      })),
      implemented: Type.Optional(Type.String({
        description: 'Contract list filter: all, implemented, or unimplemented.',
      })),
      resolved: Type.Optional(Type.String({
        description: 'Implementation list filter: all, resolved, or unresolved.',
      })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) {
        return {
          content: [{ type: 'text', text: 'Cancelled' }],
          details: {},
        }
      }

      const tsConfigFilePath = resolveTsConfigFilePath(params.tsConfigFilePath, ctx.cwd)
      const result = navigateSpectaclesCodebase(tsConfigFilePath, {
        action: params.action,
        query: params.query,
        id: params.id,
        name: params.name,
        limit: params.limit,
        implemented: params.implemented,
        resolved: params.resolved,
      })

      return {
        content: [{
          type: 'text',
          text: formatToolResult(result),
        }],
        details: {
          tsConfigFilePath,
          result,
        },
      }
    },
  })
}
