import type { DiscoveryWorkspace } from './discovery-backend.js'
import type { DiscoveryResult } from './discovery.js'
import type { OxcTsConfigDiscoveryAnalysis } from './discovery-scanner-oxc.js'
import {
  analyzeOxcDiscoveryTsConfig,
  analyzeOxcDiscoveryWorkspace,
} from './discovery-scanner-oxc.js'
import {
  generateVitestContractFiles,
  type GenerateVitestContractFilesOptions,
  type GenerateVitestContractFilesResult,
} from './generation.js'
import {
  generateContractTestPlan,
  type DiscoveryAnalysis,
  type GenerateContractTestPlanOptions,
  type GeneratedContractTestPlan,
} from './planning.js'

export type SpectaclesSessionSource =
  | { readonly workspace: DiscoveryWorkspace }
  | { readonly tsConfigFilePath: string }

export interface SpectaclesSession {
  readonly analysis: () => DiscoveryAnalysis
  readonly discovery: () => DiscoveryResult
  readonly plan: (options?: GenerateContractTestPlanOptions) => GeneratedContractTestPlan
  readonly generate: (options: GenerateVitestContractFilesOptions) => GenerateVitestContractFilesResult
}

function planCacheKey(options: GenerateContractTestPlanOptions | undefined): string {
  return JSON.stringify({
    invalidArgs: options?.invalidArgs ?? 'skip',
  })
}

function isTsConfigSource(source: SpectaclesSessionSource): source is { readonly tsConfigFilePath: string } {
  return 'tsConfigFilePath' in source
}

export function createSpectaclesSession(source: SpectaclesSessionSource): SpectaclesSession {
  let cachedAnalysis: DiscoveryAnalysis | undefined
  let cachedTsConfigAnalysis: OxcTsConfigDiscoveryAnalysis | undefined
  const planCache = new Map<string, GeneratedContractTestPlan>()

  function getAnalysis(): DiscoveryAnalysis {
    if (cachedAnalysis) {
      return cachedAnalysis
    }

    if (isTsConfigSource(source)) {
      cachedTsConfigAnalysis ??= analyzeOxcDiscoveryTsConfig(source.tsConfigFilePath)
      cachedAnalysis = cachedTsConfigAnalysis
      return cachedAnalysis
    }

    cachedAnalysis = analyzeOxcDiscoveryWorkspace(source.workspace)
    return cachedAnalysis
  }

  function getDiscovery(): DiscoveryResult {
    return getAnalysis().discovery
  }

  function getPlan(options?: GenerateContractTestPlanOptions): GeneratedContractTestPlan {
    const key = planCacheKey(options)
    const cachedPlan = planCache.get(key)
    if (cachedPlan) {
      return cachedPlan
    }

    const plan = generateContractTestPlan(getAnalysis(), options)
    planCache.set(key, plan)
    return plan
  }

  function generate(options: GenerateVitestContractFilesOptions): GenerateVitestContractFilesResult {
    const invalidArgs = options.runOptions?.invalidArgs
    const plan = getPlan(invalidArgs !== undefined ? { invalidArgs } : undefined)

    return generateVitestContractFiles(getAnalysis(), {
      ...options,
      plan,
    })
  }

  return {
    analysis: getAnalysis,
    discovery: getDiscovery,
    plan: getPlan,
    generate,
  }
}
