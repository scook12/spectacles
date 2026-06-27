import { isAbsolute, resolve } from 'node:path'

import { Project } from 'ts-morph'

import type { GeneratedContractTestPlan, PlannedSuite } from './planning.js'
import { generateContractTestPlan } from './planning.js'
import type { RenderVitestContractSuiteOptions } from './rendering.js'
import { renderVitestContractSuite } from './rendering.js'

export interface GeneratedVitestContractFile {
  readonly suite: PlannedSuite
  readonly outputFilePath: string
  readonly content: string
}

export interface GenerateVitestContractFilesOptions
  extends Omit<RenderVitestContractSuiteOptions, 'outputFilePath'> {
  readonly outputDir: string
  readonly fileName?: (suite: PlannedSuite, index: number) => string
  readonly writeToProject?: boolean
  readonly save?: boolean
}

export interface GenerateVitestContractFilesResult {
  readonly plan: GeneratedContractTestPlan
  readonly files: readonly GeneratedVitestContractFile[]
}

export interface GenerateVitestContractFilesFromTsConfigResult
  extends GenerateVitestContractFilesResult {
  readonly project: Project
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function trimTrailingSlash(filePath: string): string {
  const normalized = normalizePath(filePath)
  if (normalized.length <= 1) {
    return normalized
  }

  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

function joinPath(basePath: string, fileName: string): string {
  const base = trimTrailingSlash(basePath)
  const normalizedFileName = normalizePath(fileName).replace(/^\/+/, '')

  if (base === '' || base === '.') {
    return normalizedFileName
  }

  if (base === '/') {
    return `/${normalizedFileName}`
  }

  return `${base}/${normalizedFileName}`
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function sanitizeFileName(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9._-]+/g, '-')
  const trimmed = normalized.replace(/^-+|-+$/g, '')
  return trimmed.length > 0 ? trimmed : 'contract-suite'
}

function defaultFileName(suite: PlannedSuite): string {
  const contractPart = sanitizeFileName(toKebabCase(suite.contract.localName))
  const implementationPart = sanitizeFileName(toKebabCase(suite.implementation.localName))
  return `${contractPart}--${implementationPart}.contract.test.ts`
}

function splitExtension(fileName: string): { baseName: string; extension: string } {
  const testSuffixMatch = fileName.match(/(\.(?:contract\.)?(?:test|spec)\.[^.\/]+)$/)
  if (testSuffixMatch && typeof testSuffixMatch.index === 'number') {
    return {
      baseName: fileName.slice(0, testSuffixMatch.index),
      extension: testSuffixMatch[1] ?? '',
    }
  }

  const lastSlash = fileName.lastIndexOf('/')
  const lastDot = fileName.lastIndexOf('.')

  if (lastDot <= lastSlash) {
    return { baseName: fileName, extension: '' }
  }

  return {
    baseName: fileName.slice(0, lastDot),
    extension: fileName.slice(lastDot),
  }
}

function ensureUniquePath(filePath: string, usedPaths: Set<string>): string {
  if (!usedPaths.has(filePath)) {
    usedPaths.add(filePath)
    return filePath
  }

  const { baseName, extension } = splitExtension(filePath)
  let index = 2
  let candidate = `${baseName}-${index}${extension}`

  while (usedPaths.has(candidate)) {
    index += 1
    candidate = `${baseName}-${index}${extension}`
  }

  usedPaths.add(candidate)
  return candidate
}

function buildFilePath(
  outputDir: string,
  suite: PlannedSuite,
  index: number,
  fileNameFactory?: (suite: PlannedSuite, index: number) => string,
): string {
  const rawFileName = fileNameFactory?.(suite, index) ?? defaultFileName(suite)
  const absoluteOutputDir = isAbsolute(outputDir) ? outputDir : resolve(outputDir)
  return joinPath(absoluteOutputDir, rawFileName)
}

export function generateVitestContractFiles(
  project: Project,
  options: GenerateVitestContractFilesOptions,
): GenerateVitestContractFilesResult {
  if (!(project instanceof Project)) {
    throw new TypeError('generateVitestContractFiles(project, options): project must be a ts-morph Project')
  }

  if (!options || typeof options !== 'object') {
    throw new TypeError('generateVitestContractFiles(project, options): options must be an object')
  }

  if (typeof options.outputDir !== 'string' || options.outputDir.length === 0) {
    throw new TypeError('generateVitestContractFiles(project, options): options.outputDir must be a non-empty string')
  }

  if (options.fileName && typeof options.fileName !== 'function') {
    throw new TypeError('generateVitestContractFiles(project, options): options.fileName must be a function')
  }

  const plan = generateContractTestPlan(
    project,
    options.runOptions?.invalidArgs !== undefined
      ? { invalidArgs: options.runOptions.invalidArgs }
      : undefined,
  )
  const usedPaths = new Set<string>()
  const files: GeneratedVitestContractFile[] = []

  plan.suites.forEach((suite, index) => {
    const requestedPath = buildFilePath(options.outputDir, suite, index, options.fileName)
    const outputFilePath = ensureUniquePath(requestedPath, usedPaths)
    const renderOptions: {
      outputFilePath: string
      includePlanComments?: boolean
      vitestModuleSpecifier?: string
      spectaclesVitestModuleSpecifier?: string
      runOptions?: NonNullable<RenderVitestContractSuiteOptions['runOptions']>
    } = {
      outputFilePath,
    }

    if (options.includePlanComments !== undefined) {
      renderOptions.includePlanComments = options.includePlanComments
    }

    if (options.vitestModuleSpecifier !== undefined) {
      renderOptions.vitestModuleSpecifier = options.vitestModuleSpecifier
    }

    if (options.spectaclesVitestModuleSpecifier !== undefined) {
      renderOptions.spectaclesVitestModuleSpecifier = options.spectaclesVitestModuleSpecifier
    }

    if (options.runOptions !== undefined) {
      renderOptions.runOptions = options.runOptions
    }

    const content = renderVitestContractSuite(suite, renderOptions)

    files.push({
      suite,
      outputFilePath,
      content,
    })
  })

  if (options.writeToProject !== false) {
    for (const file of files) {
      project.createSourceFile(file.outputFilePath, file.content, { overwrite: true })
    }

    if (options.save === true) {
      project.saveSync()
    }
  }

  return {
    plan,
    files: Object.freeze(files),
  }
}

export function generateVitestContractFilesFromTsConfig(
  tsConfigFilePath: string,
  options: GenerateVitestContractFilesOptions,
): GenerateVitestContractFilesFromTsConfigResult {
  if (typeof tsConfigFilePath !== 'string' || tsConfigFilePath.length === 0) {
    throw new TypeError(
      'generateVitestContractFilesFromTsConfig(tsConfigFilePath, options): tsConfigFilePath must be a non-empty string',
    )
  }

  const project = new Project({
    tsConfigFilePath,
  })

  const result = generateVitestContractFiles(project, {
    ...options,
    save: options.save ?? true,
  })

  return {
    project,
    plan: result.plan,
    files: result.files,
  }
}
