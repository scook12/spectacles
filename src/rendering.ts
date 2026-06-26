import type { PlannedReference, PlannedSuite } from './planning.js'

export interface RenderVitestContractSuiteOptions {
  readonly outputFilePath: string
  readonly includePlanComments?: boolean
  readonly vitestModuleSpecifier?: string
  readonly spectaclesVitestModuleSpecifier?: string
  readonly runOptions?: {
    readonly numRuns?: number
    readonly timeoutMs?: number
    readonly seed?: number
  }
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function dirname(filePath: string): string {
  const normalized = normalizePath(filePath)
  const lastSlash = normalized.lastIndexOf('/')

  if (lastSlash < 0) {
    return '.'
  }

  if (lastSlash === 0) {
    return '/'
  }

  return normalized.slice(0, lastSlash)
}

function splitSegments(filePath: string): string[] {
  return normalizePath(filePath).split('/').filter(Boolean)
}

function toImportPath(filePath: string): string {
  const normalized = normalizePath(filePath)

  if (normalized.endsWith('.d.ts')) {
    return `${normalized.slice(0, -5)}.js`
  }

  if (normalized.endsWith('.ts') || normalized.endsWith('.tsx')) {
    return `${normalized.slice(0, normalized.lastIndexOf('.'))}.js`
  }

  if (normalized.endsWith('.mts')) {
    return `${normalized.slice(0, -4)}.mjs`
  }

  if (normalized.endsWith('.cts')) {
    return `${normalized.slice(0, -4)}.cjs`
  }

  return normalized
}

function relativeModuleSpecifier(fromFilePath: string, toFilePath: string): string {
  const fromSegments = splitSegments(dirname(fromFilePath))
  const toSegments = splitSegments(toImportPath(toFilePath))

  let index = 0
  while (
    index < fromSegments.length
    && index < toSegments.length
    && fromSegments[index] === toSegments[index]
  ) {
    index += 1
  }

  const upSegments = new Array(fromSegments.length - index).fill('..')
  const downSegments = toSegments.slice(index)
  const relativeSegments = [...upSegments, ...downSegments]
  const relativePath = relativeSegments.join('/')

  if (relativePath.length === 0) {
    return './'
  }

  return relativePath.startsWith('../') ? relativePath : `./${relativePath}`
}

function sanitizeIdentifier(value: string, fallback: string): string {
  const replaced = value.replace(/[^A-Za-z0-9_$]/g, '_')
  const normalized = replaced.length > 0 ? replaced : fallback
  return /^[A-Za-z_$]/.test(normalized) ? normalized : `_${normalized}`
}

function uniqueIdentifier(base: string, used: Set<string>, suffix: string): string {
  let candidate = sanitizeIdentifier(base, suffix)
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }

  candidate = sanitizeIdentifier(`${base}${suffix}`, suffix)
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }

  let index = 2
  while (used.has(`${candidate}${index}`)) {
    index += 1
  }

  const numbered = `${candidate}${index}`
  used.add(numbered)
  return numbered
}

function referenceIdentifier(
  reference: PlannedReference,
  used: Set<string>,
  roleSuffix: string,
): string {
  return uniqueIdentifier(reference.localName, used, roleSuffix)
}

function renderImport(reference: PlannedReference, localIdentifier: string, outputFilePath: string): string {
  const moduleSpecifier = relativeModuleSpecifier(outputFilePath, reference.filePath)

  if (reference.exportName === 'default') {
    return `import ${localIdentifier} from '${moduleSpecifier}'`
  }

  if (reference.exportName === localIdentifier) {
    return `import { ${reference.exportName} } from '${moduleSpecifier}'`
  }

  return `import { ${reference.exportName} as ${localIdentifier} } from '${moduleSpecifier}'`
}

function renderRunOptions(options: RenderVitestContractSuiteOptions['runOptions']): string[] {
  if (!options) {
    return []
  }

  const lines: string[] = []
  if (options.numRuns !== undefined) {
    lines.push(`    numRuns: ${options.numRuns},`)
  }
  if (options.timeoutMs !== undefined) {
    lines.push(`    timeoutMs: ${options.timeoutMs},`)
  }
  if (options.seed !== undefined) {
    lines.push(`    seed: ${options.seed},`)
  }
  return lines
}

function renderPlanComments(suite: PlannedSuite): string[] {
  const lines = [
    '/**',
    ` * Generated contract suite for ${suite.suiteName}.`,
    ' *',
    ' * Generation plan:',
  ]

  for (const step of suite.generation) {
    lines.push(` * - [${step.source}/${step.confidence}] ${step.description}`)
  }

  lines.push(' *', ' * Checks:')

  for (const check of suite.checks) {
    lines.push(` * - [${check.phase}][${check.source}/${check.confidence}] ${check.description}`)
  }

  lines.push(' */', '')
  return lines
}

export function renderVitestContractSuite(
  suite: PlannedSuite,
  options: RenderVitestContractSuiteOptions,
): string {
  if (!suite || suite.kind !== 'suite') {
    throw new TypeError('renderVitestContractSuite(suite, options): suite must be a planned suite')
  }

  if (!options || typeof options !== 'object') {
    throw new TypeError('renderVitestContractSuite(suite, options): options must be an object')
  }

  if (typeof options.outputFilePath !== 'string' || options.outputFilePath.length === 0) {
    throw new TypeError('renderVitestContractSuite(suite, options): options.outputFilePath must be a non-empty string')
  }

  const vitestModuleSpecifier = options.vitestModuleSpecifier ?? 'vitest'
  const spectaclesVitestModuleSpecifier = options.spectaclesVitestModuleSpecifier ?? 'spectacles/vitest'
  const includePlanComments = options.includePlanComments ?? true

  const usedIdentifiers = new Set<string>(['describe', 'runContractSuite'])
  const contractIdentifier = referenceIdentifier(suite.contract, usedIdentifiers, 'Contract')
  const implementationIdentifier = referenceIdentifier(suite.implementation, usedIdentifiers, 'Impl')

  const lines: string[] = []

  if (includePlanComments) {
    lines.push(...renderPlanComments(suite))
  }

  lines.push(`import { describe } from '${vitestModuleSpecifier}'`)
  lines.push(`import { runContractSuite } from '${spectaclesVitestModuleSpecifier}'`)
  lines.push(renderImport(suite.contract, contractIdentifier, options.outputFilePath))
  lines.push(renderImport(suite.implementation, implementationIdentifier, options.outputFilePath))
  lines.push('')
  lines.push(`describe(${JSON.stringify(suite.suiteName)}, () => {`)
  lines.push('  runContractSuite({')
  lines.push(`    contract: ${contractIdentifier},`)
  lines.push(`    impl: ${implementationIdentifier},`)
  lines.push(...renderRunOptions(options.runOptions))
  lines.push('  })')
  lines.push('})')
  lines.push('')

  return lines.join('\n')
}
