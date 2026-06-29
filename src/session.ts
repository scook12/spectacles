import { Project } from 'ts-morph'

import { discoverProject, type DiscoveryResult } from './discovery.js'
import {
  generateVitestContractFiles,
  type GenerateVitestContractFilesOptions,
  type GenerateVitestContractFilesResult,
} from './generation.js'
import {
  generateContractTestPlan,
  type GenerateContractTestPlanOptions,
  type GeneratedContractTestPlan,
  type ProjectAnalysis,
} from './planning.js'

export type SpectaclesSessionSource =
  | { readonly project: Project }
  | { readonly tsConfigFilePath: string }

export interface SpectaclesSession {
  readonly project: () => Project
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
  let cachedProject: Project | undefined = 'project' in source ? source.project : undefined
  let cachedDiscovery: DiscoveryResult | undefined
  const planCache = new Map<string, GeneratedContractTestPlan>()

  function getProject(): Project {
    if (!cachedProject) {
      if (!isTsConfigSource(source)) {
        throw new TypeError('createSpectaclesSession(source): no project or tsConfigFilePath available')
      }

      cachedProject = new Project({ tsConfigFilePath: source.tsConfigFilePath })
    }

    return cachedProject
  }

  function getDiscovery(): DiscoveryResult {
    if (!cachedDiscovery) {
      cachedDiscovery = discoverProject(getProject())
    }

    return cachedDiscovery
  }

  function getPlan(options?: GenerateContractTestPlanOptions): GeneratedContractTestPlan {
    const key = planCacheKey(options)
    const cachedPlan = planCache.get(key)
    if (cachedPlan) {
      return cachedPlan
    }

    const analysis: ProjectAnalysis = {
      project: getProject(),
      discovery: getDiscovery(),
    }
    const plan = generateContractTestPlan(analysis, options)
    planCache.set(key, plan)
    return plan
  }

  function generate(options: GenerateVitestContractFilesOptions): GenerateVitestContractFilesResult {
    const invalidArgs = options.runOptions?.invalidArgs
    const plan = getPlan(invalidArgs !== undefined ? { invalidArgs } : undefined)

    return generateVitestContractFiles(getProject(), {
      ...options,
      plan,
    })
  }

  return {
    project: getProject,
    discovery: getDiscovery,
    plan: getPlan,
    generate,
  }
}
