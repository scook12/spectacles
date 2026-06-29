import { Node, Project, SourceFile } from 'ts-morph'

import type { ScannedSourceFile } from './discovery-backend.js'
import type {
  DiscoveredContract,
  DiscoveredImplementation,
  DiscoveryResult,
  ResolvedContractReference,
} from './discovery.js'
import { discoverProject } from './discovery.js'

export type PlanSource = 'engine' | 'contract'
export type PlanConfidence = 'sound' | 'derived'
export type PlanPhase = 'setup' | 'example' | 'property'

export interface PlannedReference {
  readonly filePath: string
  readonly exportName: string
  readonly localName: string
  readonly runtimeName?: string
}

export interface PlannedGenerationStep {
  readonly kind: 'args-schema' | 'invalid-args' | 'where-clauses' | 'preconditions'
  readonly source: PlanSource
  readonly confidence: PlanConfidence
  readonly description: string
  readonly count?: number
  readonly names?: readonly string[]
}

export interface PlannedCheck {
  readonly kind: 'valid-args-fuzz' | 'invalid-args-rejection' | 'return-schema' | 'examples' | 'postconditions' | 'laws'
  readonly phase: Exclude<PlanPhase, 'setup'>
  readonly source: PlanSource
  readonly confidence: PlanConfidence
  readonly description: string
  readonly count?: number
  readonly names?: readonly string[]
}

export interface PlannedSuite {
  readonly kind: 'suite'
  readonly suiteName: string
  readonly contract: PlannedReference
  readonly implementation: PlannedReference
  readonly generation: readonly PlannedGenerationStep[]
  readonly checks: readonly PlannedCheck[]
}

export interface ContractClauseSummary {
  readonly whereCount: number
  readonly preNames: readonly string[]
  readonly postNames: readonly string[]
  readonly lawNames: readonly string[]
  readonly exampleNames: readonly string[]
}

export interface GenerateContractTestPlanOptions {
  readonly invalidArgs?: 'skip' | 'reject'
}

export interface DiscoveryAnalysis {
  readonly discovery: DiscoveryResult
  readonly scannedFiles?: readonly ScannedSourceFile[]
}

export interface ProjectAnalysis extends DiscoveryAnalysis {
  readonly project: Project
}

export interface GeneratedContractTestPlan {
  readonly suites: readonly PlannedSuite[]
  readonly contractsWithoutImplementations: readonly PlannedReference[]
  readonly unresolvedImplementations: readonly PlannedReference[]
}

function preferredExportName(exportNames: readonly string[], isDefaultExport: boolean): string {
  if (isDefaultExport && exportNames.includes('default')) {
    return 'default'
  }

  return exportNames[0] ?? 'default'
}

function fileStem(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const tail = normalized.split('/').pop() ?? normalized
  const lastDot = tail.lastIndexOf('.')
  return lastDot >= 0 ? tail.slice(0, lastDot) : tail
}

function toSuggestedLocalName(args: {
  exportName: string
  localName?: string | undefined
  runtimeName?: string | undefined
  filePath: string
}): string {
  if (args.localName) {
    return args.localName
  }

  if (args.exportName !== 'default') {
    return args.exportName
  }

  if (args.runtimeName) {
    return args.runtimeName
  }

  return fileStem(args.filePath)
}

function toPlannedReference(contract: DiscoveredContract): PlannedReference
function toPlannedReference(implementation: DiscoveredImplementation): PlannedReference
function toPlannedReference(reference: ResolvedContractReference): PlannedReference
function toPlannedReference(
  value: DiscoveredContract | DiscoveredImplementation | ResolvedContractReference,
): PlannedReference {
  const exportName = 'exportNames' in value
    ? preferredExportName(value.exportNames, value.isDefaultExport)
    : value.exportName

  const localName = toSuggestedLocalName({
    exportName,
    localName: value.localName,
    runtimeName: 'runtimeName' in value ? value.runtimeName : undefined,
    filePath: value.filePath,
  })

  return {
    filePath: value.filePath,
    exportName,
    localName,
    ...('runtimeName' in value && value.runtimeName !== undefined ? { runtimeName: value.runtimeName } : {}),
  }
}

function findSourceFile(project: Project, filePath: string): SourceFile | undefined {
  return project.getSourceFile((candidate) => candidate.getFilePath() === filePath)
}

function findContractExpression(sourceFile: SourceFile, contract: DiscoveredContract) {
  if (contract.localName) {
    const declaration = sourceFile.getVariableDeclaration(contract.localName)
    const initializer = declaration?.getInitializer()
    return initializer && Node.isCallExpression(initializer) ? initializer : undefined
  }

  for (const exportAssignment of sourceFile.getExportAssignments()) {
    if (exportAssignment.isExportEquals()) {
      continue
    }

    const expression = exportAssignment.getExpression()
    if (expression && Node.isCallExpression(expression)) {
      return expression
    }
  }

  return undefined
}

function stringArgumentName(node: Node | undefined): string | undefined {
  if (!node) {
    return undefined
  }

  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue()
  }

  return undefined
}

function summarizeContractClausesFromExpression(expression: Node): ContractClauseSummary {
  let current: Node | undefined = expression
  const preNames: string[] = []
  const postNames: string[] = []
  const lawNames: string[] = []
  const exampleNames: string[] = []
  let whereCount = 0

  while (current && Node.isCallExpression(current)) {
    const callExpression = current as import('ts-morph').CallExpression
    const callee = callExpression.getExpression() as import('ts-morph').Node

    if (!Node.isPropertyAccessExpression(callee)) {
      break
    }

    const methodName = callee.getName()
    const firstArgumentName = stringArgumentName(callExpression.getArguments()[0])

    switch (methodName) {
      case 'where':
        whereCount += callExpression.getArguments().length
        break
      case 'pre':
        if (firstArgumentName) {
          preNames.push(firstArgumentName)
        }
        break
      case 'post':
        if (firstArgumentName) {
          postNames.push(firstArgumentName)
        }
        break
      case 'law':
        if (firstArgumentName) {
          lawNames.push(firstArgumentName)
        }
        break
      case 'example':
        if (firstArgumentName) {
          exampleNames.push(firstArgumentName)
        }
        break
    }

    current = callee.getExpression()
  }

  return {
    whereCount,
    preNames: Object.freeze(preNames.reverse()),
    postNames: Object.freeze(postNames.reverse()),
    lawNames: Object.freeze(lawNames.reverse()),
    exampleNames: Object.freeze(exampleNames.reverse()),
  }
}

function emptyContractClauseSummary(): ContractClauseSummary {
  return {
    whereCount: 0,
    preNames: Object.freeze([]),
    postNames: Object.freeze([]),
    lawNames: Object.freeze([]),
    exampleNames: Object.freeze([]),
  }
}

function summarizeContractClauses(project: Project, contract: DiscoveredContract): ContractClauseSummary {
  const sourceFile = findSourceFile(project, contract.filePath)
  if (!sourceFile) {
    return emptyContractClauseSummary()
  }

  const expression = findContractExpression(sourceFile, contract)
  if (!expression) {
    return emptyContractClauseSummary()
  }

  return summarizeContractClausesFromExpression(expression)
}

function contractReferenceKey(reference: PlannedReference): string {
  return `${reference.filePath}::${reference.exportName}`
}

function discoveredContractKey(contract: DiscoveredContract): string {
  return `${contract.filePath}::${preferredExportName(contract.exportNames, contract.isDefaultExport)}`
}

function describeCount(label: string, count: number): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`
}

function createGenerationSteps(
  summary: ContractClauseSummary,
  options: GenerateContractTestPlanOptions,
): PlannedGenerationStep[] {
  const steps: PlannedGenerationStep[] = [
    {
      kind: 'args-schema',
      source: 'engine',
      confidence: 'sound',
      description: 'Generate valid argument lists from the contract args schema',
    },
  ]

  if ((options.invalidArgs ?? 'skip') === 'reject') {
    steps.push({
      kind: 'invalid-args',
      source: 'engine',
      confidence: 'derived',
      description: 'Generate invalid argument lists that violate the args schema or structured where-clauses',
    })
  }

  if (summary.whereCount > 0) {
    steps.push({
      kind: 'where-clauses',
      source: 'contract',
      confidence: 'sound',
      count: summary.whereCount,
      description: `Constrain generated argument lists using ${describeCount('structured where-clause', summary.whereCount)}`,
    })
  }

  if (summary.preNames.length > 0) {
    steps.push({
      kind: 'preconditions',
      source: 'contract',
      confidence: 'sound',
      count: summary.preNames.length,
      names: summary.preNames,
      description: `Filter generated cases through ${describeCount('precondition', summary.preNames.length)}`,
    })
  }

  return steps
}

function createChecks(
  summary: ContractClauseSummary,
  options: GenerateContractTestPlanOptions,
): PlannedCheck[] {
  const checks: PlannedCheck[] = [
    {
      kind: 'valid-args-fuzz',
      phase: 'property',
      source: 'engine',
      confidence: 'derived',
      description: 'Exercise implementations across many generated valid argument lists',
    },
    {
      kind: 'return-schema',
      phase: 'property',
      source: 'engine',
      confidence: 'sound',
      description: 'Assert that returned values conform to the contract return schema',
    },
  ]

  if ((options.invalidArgs ?? 'skip') === 'reject') {
    checks.push({
      kind: 'invalid-args-rejection',
      phase: 'property',
      source: 'engine',
      confidence: 'derived',
      description: 'Assert that invalid argument lists are rejected by the implementation',
    })
  }

  if (summary.exampleNames.length > 0) {
    checks.push({
      kind: 'examples',
      phase: 'example',
      source: 'contract',
      confidence: 'sound',
      count: summary.exampleNames.length,
      names: summary.exampleNames,
      description: `Run ${describeCount('contract example', summary.exampleNames.length)}`,
    })
  }

  if (summary.postNames.length > 0) {
    checks.push({
      kind: 'postconditions',
      phase: 'property',
      source: 'contract',
      confidence: 'sound',
      count: summary.postNames.length,
      names: summary.postNames,
      description: `Check ${describeCount('postcondition', summary.postNames.length)} over generated valid argument lists`,
    })
  }

  if (summary.lawNames.length > 0) {
    checks.push({
      kind: 'laws',
      phase: 'property',
      source: 'contract',
      confidence: 'sound',
      count: summary.lawNames.length,
      names: summary.lawNames,
      description: `Check ${describeCount('law', summary.lawNames.length)} with additional quantified data`,
    })
  }

  return checks
}

function createSuiteName(contract: PlannedReference, implementation: PlannedReference): string {
  return `${contract.localName} / ${implementation.localName}`
}

function buildScannedContractClauseSummaryIndex(
  scannedFiles: readonly ScannedSourceFile[] | undefined,
): ReadonlyMap<string, ContractClauseSummary> {
  if (!scannedFiles) {
    return new Map()
  }

  const summaries = new Map<string, ContractClauseSummary>()

  for (const file of scannedFiles) {
    for (const contract of file.contracts) {
      summaries.set(
        `${contract.filePath}::${preferredExportName(contract.export.exportNames, contract.export.isDefaultExport)}`,
        {
          whereCount: contract.clauseSummary.whereCount,
          preNames: contract.clauseSummary.preNames,
          postNames: contract.clauseSummary.postNames,
          lawNames: contract.clauseSummary.lawNames,
          exampleNames: contract.clauseSummary.exampleNames,
        },
      )
    }
  }

  return summaries
}

function planFromDiscovery(
  discovery: DiscoveryResult,
  project: Project | undefined,
  scannedFiles: readonly ScannedSourceFile[] | undefined,
  options: GenerateContractTestPlanOptions,
): GeneratedContractTestPlan {
  const contractsByKey = new Map(discovery.contracts.map((contract) => [discoveredContractKey(contract), contract]))
  const clauseSummaries = buildScannedContractClauseSummaryIndex(scannedFiles)
  const implementationKeys = new Set<string>()
  const suites: PlannedSuite[] = []
  const unresolvedImplementations: PlannedReference[] = []

  for (const implementation of discovery.implementations) {
    if (!implementation.contract) {
      unresolvedImplementations.push(toPlannedReference(implementation))
      continue
    }

    const contractKey = `${implementation.contract.filePath}::${implementation.contract.exportName}`
    const contract = contractsByKey.get(contractKey)
    if (!contract) {
      unresolvedImplementations.push(toPlannedReference(implementation))
      continue
    }

    implementationKeys.add(contractKey)

    const contractReference = toPlannedReference(contract)
    const implementationReference = toPlannedReference(implementation)
    const summary = clauseSummaries.get(contractKey)
      ?? (project ? summarizeContractClauses(project, contract) : emptyContractClauseSummary())

    suites.push({
      kind: 'suite',
      suiteName: createSuiteName(contractReference, implementationReference),
      contract: contractReference,
      implementation: implementationReference,
      generation: Object.freeze(createGenerationSteps(summary, options)),
      checks: Object.freeze(createChecks(summary, options)),
    })
  }

  const contractsWithoutImplementations = discovery.contracts
    .filter((contract) => !implementationKeys.has(discoveredContractKey(contract)))
    .map((contract) => toPlannedReference(contract))

  return {
    suites: Object.freeze(suites),
    contractsWithoutImplementations: Object.freeze(contractsWithoutImplementations),
    unresolvedImplementations: Object.freeze(unresolvedImplementations),
  }
}

export function generateContractTestPlan(
  project: Project,
  options?: GenerateContractTestPlanOptions,
): GeneratedContractTestPlan
export function generateContractTestPlan(
  discovery: DiscoveryResult,
  options?: GenerateContractTestPlanOptions,
): GeneratedContractTestPlan
export function generateContractTestPlan(
  analysis: DiscoveryAnalysis,
  options?: GenerateContractTestPlanOptions,
): GeneratedContractTestPlan
export function generateContractTestPlan(
  analysis: ProjectAnalysis,
  options?: GenerateContractTestPlanOptions,
): GeneratedContractTestPlan
export function generateContractTestPlan(
  input: Project | DiscoveryResult | DiscoveryAnalysis | ProjectAnalysis,
  options: GenerateContractTestPlanOptions = {},
): GeneratedContractTestPlan {
  if (input instanceof Project) {
    return planFromDiscovery(discoverProject(input), input, undefined, options)
  }

  if ('discovery' in input) {
    return planFromDiscovery(
      input.discovery,
      'project' in input ? input.project : undefined,
      input.scannedFiles,
      options,
    )
  }

  return planFromDiscovery(input, undefined, undefined, options)
}
