import type {
  DiscoveryIndex,
  DiscoveryIndexContractNode,
  DiscoveryIndexImplementationNode,
  DiscoverySourceSpan,
  DiscoveryWorkspace,
  ScannedContractCandidate,
  ScannedContractClauseSummary,
  ScannedImplementationCandidate,
  ScannedSourceFile,
} from './discovery-backend.js'
import { buildDiscoveryIndex } from './discovery-backend.js'
import {
  analyzeOxcDiscoveryTsConfig,
  analyzeOxcDiscoveryWorkspace,
} from './discovery-scanner-oxc.js'

export type SpectaclesNavigationInput = DiscoveryWorkspace | string

export type SpectaclesNavigationAction =
  | 'summary'
  | 'search'
  | 'contracts'
  | 'contract'
  | 'implementations'
  | 'implementation'
  | 'issues'

export interface SpectaclesNavigationSummary {
  readonly contractCount: number
  readonly implementationCount: number
  readonly unimplementedContractCount: number
  readonly unresolvedImplementationCount: number
}

export interface SpectaclesNavigationLocation {
  readonly filePath: string
  readonly startLine?: number
  readonly startColumn?: number
  readonly endLine?: number
  readonly endColumn?: number
}

export interface SpectaclesNavigationContext {
  readonly rootDir?: string | undefined
  readonly tsConfigFilePath?: string | undefined
}

export interface SpectaclesNavigationMatch {
  readonly kind: 'contract' | 'implementation'
  readonly id: string
  readonly name: string
  readonly filePath: string
  readonly location?: SpectaclesNavigationLocation | undefined
}

export interface SpectaclesNavigationContractNode {
  readonly kind: 'contract'
  readonly id: string
  readonly name: string
  readonly runtimeName?: string | undefined
  readonly localName?: string | undefined
  readonly exportNames: readonly string[]
  readonly isDefaultExport: boolean
  readonly filePath: string
  readonly location?: SpectaclesNavigationLocation | undefined
  readonly source?: DiscoveryIndexContractNode['source'] | undefined
  readonly clauseSummary?: ScannedContractClauseSummary | undefined
  readonly implementationIds: readonly string[]
  readonly implementationCount: number
}

export interface SpectaclesNavigationImplementationNode {
  readonly kind: 'implementation'
  readonly id: string
  readonly name: string
  readonly localName?: string | undefined
  readonly exportNames: readonly string[]
  readonly isDefaultExport: boolean
  readonly filePath: string
  readonly location?: SpectaclesNavigationLocation | undefined
  readonly contract: DiscoveryIndexImplementationNode['contract']
  readonly contractId: string | null
}

export interface SpectaclesNavigationQuery {
  readonly action?: SpectaclesNavigationAction
  readonly query?: string
  readonly id?: string
  readonly name?: string
  readonly limit?: number
  readonly implemented?: 'all' | 'implemented' | 'unimplemented'
  readonly resolved?: 'all' | 'resolved' | 'unresolved'
}

export interface SpectaclesNavigationResult {
  readonly action: SpectaclesNavigationAction
  readonly context: SpectaclesNavigationContext
  readonly summary: SpectaclesNavigationSummary
  readonly contracts?: readonly SpectaclesNavigationContractNode[] | undefined
  readonly implementations?: readonly SpectaclesNavigationImplementationNode[] | undefined
  readonly contract?: SpectaclesNavigationContractNode | undefined
  readonly implementation?: SpectaclesNavigationImplementationNode | undefined
  readonly matches?: readonly SpectaclesNavigationMatch[] | undefined
  readonly unimplementedContracts?: readonly SpectaclesNavigationContractNode[] | undefined
  readonly unresolvedImplementations?: readonly SpectaclesNavigationImplementationNode[] | undefined
  readonly matched?: boolean | undefined
  readonly reason?: 'missing-identifier' | 'not-found' | 'ambiguous-name' | undefined
}

interface NavigationSnapshot {
  readonly context: SpectaclesNavigationContext
  readonly index: DiscoveryIndex
  readonly summary: SpectaclesNavigationSummary
  readonly contracts: readonly SpectaclesNavigationContractNode[]
  readonly implementations: readonly SpectaclesNavigationImplementationNode[]
  readonly contractsById: Readonly<Record<string, SpectaclesNavigationContractNode>>
  readonly implementationsById: Readonly<Record<string, SpectaclesNavigationImplementationNode>>
}

interface LineIndex {
  readonly filePath: string
  readonly starts: readonly number[]
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 20
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new TypeError('query.limit must be a positive integer when provided')
  }

  return limit
}

function buildLineIndex(text: string, filePath: string): LineIndex {
  const starts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      starts.push(index + 1)
    }
  }

  return {
    filePath,
    starts,
  }
}

function offsetToLineColumn(index: LineIndex, offset: number): { readonly line: number; readonly column: number } {
  let low = 0
  let high = index.starts.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const lineStart = index.starts[mid] ?? 0
    const nextLineStart = index.starts[mid + 1] ?? Number.POSITIVE_INFINITY

    if (offset < lineStart) {
      high = mid - 1
      continue
    }

    if (offset >= nextLineStart) {
      low = mid + 1
      continue
    }

    return {
      line: mid + 1,
      column: offset - lineStart + 1,
    }
  }

  const fallbackStart = index.starts[index.starts.length - 1] ?? 0
  return {
    line: index.starts.length,
    column: Math.max(1, offset - fallbackStart + 1),
  }
}

function toLocation(
  filePath: string,
  span: DiscoverySourceSpan | undefined,
  workspace: DiscoveryWorkspace,
  lineIndexCache: Map<string, LineIndex>,
): SpectaclesNavigationLocation | undefined {
  if (!span) {
    return undefined
  }

  const file = workspace.getFile(filePath)
  if (!file) {
    return { filePath }
  }

  let lineIndex = lineIndexCache.get(filePath)
  if (!lineIndex) {
    lineIndex = buildLineIndex(file.text, filePath)
    lineIndexCache.set(filePath, lineIndex)
  }

  const start = offsetToLineColumn(lineIndex, span.start)
  const end = offsetToLineColumn(lineIndex, Math.max(span.start, span.end - 1))

  return {
    filePath,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  }
}

function contractName(contract: DiscoveryIndexContractNode): string {
  return contract.runtimeName ?? contract.exportNames[0] ?? contract.localName ?? contract.filePath
}

function implementationName(implementation: DiscoveryIndexImplementationNode): string {
  return implementation.exportNames[0] ?? implementation.localName ?? implementation.filePath
}

function contractCandidateMatches(candidate: ScannedContractCandidate, contract: DiscoveryIndexContractNode): boolean {
  if (candidate.filePath !== contract.filePath) {
    return false
  }

  if (candidate.export.localName && contract.localName && candidate.export.localName === contract.localName) {
    return true
  }

  if (candidate.runtimeName && contract.runtimeName && candidate.runtimeName === contract.runtimeName) {
    return true
  }

  return contract.exportNames.some((exportName) => candidate.export.exportNames.includes(exportName))
}

function implementationCandidateMatches(
  candidate: ScannedImplementationCandidate,
  implementation: DiscoveryIndexImplementationNode,
): boolean {
  if (candidate.filePath !== implementation.filePath) {
    return false
  }

  if (candidate.export.localName && implementation.localName && candidate.export.localName === implementation.localName) {
    return true
  }

  return implementation.exportNames.some((exportName) => candidate.export.exportNames.includes(exportName))
}

function findContractCandidate(
  scannedFilesByPath: ReadonlyMap<string, ScannedSourceFile>,
  contract: DiscoveryIndexContractNode,
): ScannedContractCandidate | undefined {
  const scannedFile = scannedFilesByPath.get(contract.filePath)
  return scannedFile?.contracts.find((candidate) => contractCandidateMatches(candidate, contract))
}

function findImplementationCandidate(
  scannedFilesByPath: ReadonlyMap<string, ScannedSourceFile>,
  implementation: DiscoveryIndexImplementationNode,
): ScannedImplementationCandidate | undefined {
  const scannedFile = scannedFilesByPath.get(implementation.filePath)
  return scannedFile?.implementations.find((candidate) => implementationCandidateMatches(candidate, implementation))
}

function matchesNeedle(values: readonly string[], needle: string): boolean {
  return values.some((value) => value.toLowerCase().includes(needle))
}

function resolveContract(
  snapshot: NavigationSnapshot,
  query: SpectaclesNavigationQuery,
): {
  readonly contract: SpectaclesNavigationContractNode | undefined
  readonly reason?: SpectaclesNavigationResult['reason']
  readonly matches?: readonly SpectaclesNavigationMatch[] | undefined
} {
  if (query.id) {
    const contract = snapshot.contractsById[query.id]
    return contract ? { contract } : { contract: undefined, reason: 'not-found' }
  }

  if (!query.name) {
    return { contract: undefined, reason: 'missing-identifier' }
  }

  const needle = query.name.trim().toLowerCase()
  const matches = snapshot.contracts.filter((contract) => matchesNeedle([
    contract.name,
    contract.runtimeName ?? '',
    contract.localName ?? '',
    ...contract.exportNames,
    contract.filePath,
  ], needle))

  if (matches.length === 1) {
    return { contract: matches[0] }
  }

  if (matches.length === 0) {
    return { contract: undefined, reason: 'not-found' }
  }

  return {
    contract: undefined,
    reason: 'ambiguous-name',
    matches: matches.map((contract) => ({
      kind: 'contract',
      id: contract.id,
      name: contract.name,
      filePath: contract.filePath,
      location: contract.location,
    })),
  }
}

function resolveImplementation(
  snapshot: NavigationSnapshot,
  query: SpectaclesNavigationQuery,
): {
  readonly implementation: SpectaclesNavigationImplementationNode | undefined
  readonly reason?: SpectaclesNavigationResult['reason']
  readonly matches?: readonly SpectaclesNavigationMatch[] | undefined
} {
  if (query.id) {
    const implementation = snapshot.implementationsById[query.id]
    return implementation ? { implementation } : { implementation: undefined, reason: 'not-found' }
  }

  if (!query.name) {
    return { implementation: undefined, reason: 'missing-identifier' }
  }

  const needle = query.name.trim().toLowerCase()
  const matches = snapshot.implementations.filter((implementation) => matchesNeedle([
    implementation.name,
    implementation.localName ?? '',
    ...implementation.exportNames,
    implementation.filePath,
  ], needle))

  if (matches.length === 1) {
    return { implementation: matches[0] }
  }

  if (matches.length === 0) {
    return { implementation: undefined, reason: 'not-found' }
  }

  return {
    implementation: undefined,
    reason: 'ambiguous-name',
    matches: matches.map((implementation) => ({
      kind: 'implementation',
      id: implementation.id,
      name: implementation.name,
      filePath: implementation.filePath,
      location: implementation.location,
    })),
  }
}

function buildSnapshot(input: SpectaclesNavigationInput): NavigationSnapshot {
  const isTsConfigInput = typeof input === 'string'
  const tsConfigAnalysis = isTsConfigInput ? analyzeOxcDiscoveryTsConfig(input) : undefined
  const workspaceAnalysis = isTsConfigInput ? undefined : analyzeOxcDiscoveryWorkspace(input)
  const analysis = tsConfigAnalysis ?? workspaceAnalysis
  if (!analysis) {
    throw new TypeError('Unable to analyze navigation input')
  }

  const workspace: DiscoveryWorkspace = isTsConfigInput ? tsConfigAnalysis!.workspace : input
  const scannedFilesByPath = new Map(analysis.scannedFiles.map((file) => [file.filePath, file]))
  const lineIndexCache = new Map<string, LineIndex>()
  const index = buildDiscoveryIndex(analysis.discovery)

  const contracts = index.contracts.map((contract) => {
    const candidate = findContractCandidate(scannedFilesByPath, contract)
    const location = toLocation(contract.filePath, candidate?.sourceSpan, workspace, lineIndexCache)

    return {
      kind: 'contract' as const,
      id: contract.id,
      name: contractName(contract),
      runtimeName: contract.runtimeName,
      localName: contract.localName,
      exportNames: contract.exportNames,
      isDefaultExport: contract.isDefaultExport,
      filePath: contract.filePath,
      location,
      source: contract.source,
      clauseSummary: candidate?.clauseSummary,
      implementationIds: contract.implementationIds,
      implementationCount: contract.implementationIds.length,
    }
  })

  const implementations = index.implementations.map((implementation) => {
    const candidate = findImplementationCandidate(scannedFilesByPath, implementation)
    const location = toLocation(implementation.filePath, candidate?.sourceSpan, workspace, lineIndexCache)

    return {
      kind: 'implementation' as const,
      id: implementation.id,
      name: implementationName(implementation),
      localName: implementation.localName,
      exportNames: implementation.exportNames,
      isDefaultExport: implementation.isDefaultExport,
      filePath: implementation.filePath,
      location,
      contract: implementation.contract,
      contractId: implementation.contractId,
    }
  })

  const contractsById = Object.freeze(Object.fromEntries(contracts.map((contract) => [contract.id, contract])))
  const implementationsById = Object.freeze(Object.fromEntries(implementations.map((implementation) => [implementation.id, implementation])))

  return {
    context: {
      rootDir: workspace.rootDir,
      tsConfigFilePath: tsConfigAnalysis?.workspace.tsConfigFilePath,
    },
    index,
    summary: {
      contractCount: contracts.length,
      implementationCount: implementations.length,
      unimplementedContractCount: index.unimplementedContractIds.length,
      unresolvedImplementationCount: index.unresolvedImplementationIds.length,
    },
    contracts,
    implementations,
    contractsById,
    implementationsById,
  }
}

function createBaseResult(snapshot: NavigationSnapshot, action: SpectaclesNavigationAction): SpectaclesNavigationResult {
  return {
    action,
    context: snapshot.context,
    summary: snapshot.summary,
  }
}

export function navigateSpectaclesCodebase(
  input: SpectaclesNavigationInput,
  query: SpectaclesNavigationQuery = {},
): SpectaclesNavigationResult {
  if (typeof input !== 'string' && (!input || typeof input !== 'object' || !('files' in input))) {
    throw new TypeError('input must be a DiscoveryWorkspace or tsconfig file path')
  }

  if (!query || typeof query !== 'object') {
    throw new TypeError('query must be an object')
  }

  const action = query.action ?? 'summary'
  const snapshot = buildSnapshot(input)

  switch (action) {
    case 'summary':
      return createBaseResult(snapshot, action)

    case 'search': {
      if (!query.query || !query.query.trim()) {
        throw new TypeError('query.query must be a non-empty string for action "search"')
      }

      const needle = query.query.trim().toLowerCase()
      const limit = normalizeLimit(query.limit)
      const matches = [
        ...snapshot.contracts
          .filter((contract) => matchesNeedle([
            contract.name,
            contract.runtimeName ?? '',
            contract.localName ?? '',
            ...contract.exportNames,
            contract.filePath,
          ], needle))
          .map((contract) => ({
            kind: 'contract' as const,
            id: contract.id,
            name: contract.name,
            filePath: contract.filePath,
            location: contract.location,
          })),
        ...snapshot.implementations
          .filter((implementation) => matchesNeedle([
            implementation.name,
            implementation.localName ?? '',
            ...implementation.exportNames,
            implementation.filePath,
          ], needle))
          .map((implementation) => ({
            kind: 'implementation' as const,
            id: implementation.id,
            name: implementation.name,
            filePath: implementation.filePath,
            location: implementation.location,
          })),
      ].slice(0, limit)

      return {
        ...createBaseResult(snapshot, action),
        matches,
      }
    }

    case 'contracts': {
      const implemented = query.implemented ?? 'all'
      const needle = query.query?.trim().toLowerCase()
      const limit = normalizeLimit(query.limit)
      const contracts = snapshot.contracts
        .filter((contract) => {
          if (implemented === 'implemented' && contract.implementationCount === 0) {
            return false
          }

          if (implemented === 'unimplemented' && contract.implementationCount > 0) {
            return false
          }

          if (!needle) {
            return true
          }

          return matchesNeedle([
            contract.name,
            contract.runtimeName ?? '',
            contract.localName ?? '',
            ...contract.exportNames,
            contract.filePath,
          ], needle)
        })
        .slice(0, limit)

      return {
        ...createBaseResult(snapshot, action),
        contracts,
      }
    }

    case 'contract': {
      const resolved = resolveContract(snapshot, query)
      if (!resolved.contract) {
        return {
          ...createBaseResult(snapshot, action),
          matched: false,
          reason: resolved.reason,
          matches: resolved.matches,
        }
      }

      return {
        ...createBaseResult(snapshot, action),
        matched: true,
        contract: resolved.contract,
        implementations: resolved.contract.implementationIds
          .map((implementationId) => snapshot.implementationsById[implementationId])
          .filter((implementation): implementation is SpectaclesNavigationImplementationNode => implementation !== undefined),
      }
    }

    case 'implementations': {
      const resolvedState = query.resolved ?? 'all'
      const needle = query.query?.trim().toLowerCase()
      const limit = normalizeLimit(query.limit)
      const implementations = snapshot.implementations
        .filter((implementation) => {
          if (resolvedState === 'resolved' && implementation.contractId === null) {
            return false
          }

          if (resolvedState === 'unresolved' && implementation.contractId !== null) {
            return false
          }

          if (!needle) {
            return true
          }

          return matchesNeedle([
            implementation.name,
            implementation.localName ?? '',
            ...implementation.exportNames,
            implementation.filePath,
          ], needle)
        })
        .slice(0, limit)

      return {
        ...createBaseResult(snapshot, action),
        implementations,
      }
    }

    case 'implementation': {
      const resolved = resolveImplementation(snapshot, query)
      if (!resolved.implementation) {
        return {
          ...createBaseResult(snapshot, action),
          matched: false,
          reason: resolved.reason,
          matches: resolved.matches,
        }
      }

      return {
        ...createBaseResult(snapshot, action),
        matched: true,
        implementation: resolved.implementation,
        contract: resolved.implementation.contractId
          ? snapshot.contractsById[resolved.implementation.contractId]
          : undefined,
      }
    }

    case 'issues':
      return {
        ...createBaseResult(snapshot, action),
        unimplementedContracts: snapshot.index.unimplementedContractIds
          .map((contractId) => snapshot.contractsById[contractId])
          .filter((contract): contract is SpectaclesNavigationContractNode => contract !== undefined),
        unresolvedImplementations: snapshot.index.unresolvedImplementationIds
          .map((implementationId) => snapshot.implementationsById[implementationId])
          .filter((implementation): implementation is SpectaclesNavigationImplementationNode => implementation !== undefined),
      }

    default:
      throw new TypeError(`Unsupported navigation action: ${action satisfies never}`)
  }
}
