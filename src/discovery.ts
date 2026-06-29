import type { DiscoveryWorkspace } from './discovery-backend.js'
import {
  analyzeOxcDiscoveryTsConfig,
  analyzeOxcDiscoveryWorkspace,
} from './discovery-scanner-oxc.js'

export interface DiscoveredContract {
  readonly kind: 'contract'
  readonly filePath: string
  readonly localName?: string
  readonly exportNames: readonly string[]
  readonly isDefaultExport: boolean
  readonly runtimeName?: string
  readonly source?: ResolvedContractReference
}

export interface ResolvedContractReference {
  readonly filePath: string
  readonly localName?: string
  readonly exportName: string
  readonly runtimeName?: string
}

export interface DiscoveredImplementation {
  readonly kind: 'implementation'
  readonly filePath: string
  readonly localName?: string
  readonly exportNames: readonly string[]
  readonly isDefaultExport: boolean
  readonly contract: ResolvedContractReference | null
}

export interface DiscoveryResult {
  readonly contracts: readonly DiscoveredContract[]
  readonly implementations: readonly DiscoveredImplementation[]
}

export type DiscoveryInput = DiscoveryWorkspace | string

function isDiscoveryWorkspace(input: DiscoveryInput): input is DiscoveryWorkspace {
  return typeof input === 'object' && input !== null && 'files' in input && 'resolver' in input
}

function analyzeDiscoveryInput(input: DiscoveryInput) {
  if (typeof input === 'string') {
    return analyzeOxcDiscoveryTsConfig(input)
  }

  if (isDiscoveryWorkspace(input)) {
    return analyzeOxcDiscoveryWorkspace(input)
  }

  throw new TypeError('Expected a DiscoveryWorkspace or tsconfig file path')
}

export function discoverContracts(input: DiscoveryInput): DiscoveredContract[] {
  return [...analyzeDiscoveryInput(input).discovery.contracts]
}

export function discoverImplementations(
  input: DiscoveryInput,
  _contracts?: readonly DiscoveredContract[],
): DiscoveredImplementation[] {
  return [...analyzeDiscoveryInput(input).discovery.implementations]
}

export function discoverProject(input: DiscoveryInput): DiscoveryResult {
  return analyzeDiscoveryInput(input).discovery
}
