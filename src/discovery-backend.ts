import { dirname, isAbsolute, normalize, resolve } from 'node:path'

import { Project, ts } from 'ts-morph'

import {
  discoverProject,
  type DiscoveredContract,
  type DiscoveredImplementation,
  type DiscoveryResult,
  type ResolvedContractReference,
} from './discovery.js'

export interface DiscoveryBackendCapabilities {
  readonly supportsTsConfigProjects: boolean
  readonly supportsModuleResolution: boolean
  readonly supportsSourceTextWorkspaces: boolean
  readonly preservesOperationalImports: boolean
  readonly intendedConsumers: readonly ('library' | 'agent-tool')[]
}

export interface DiscoveryBackend<Input> {
  readonly name: string
  readonly capabilities: DiscoveryBackendCapabilities
  discover(input: Input): DiscoveryResult
}

export interface DiscoveryWorkspaceFile {
  readonly filePath: string
  readonly text: string
}

export interface DiscoveryModuleResolution {
  readonly fromFilePath: string
  readonly specifier: string
  readonly resolvedFilePath: string | null
  readonly resolutionKind: 'source-file' | 'external' | 'unresolved'
}

export interface DiscoveryResolver {
  resolveModule(fromFilePath: string, specifier: string): DiscoveryModuleResolution
}

export interface DiscoveryWorkspace {
  readonly rootDir?: string
  readonly files: readonly DiscoveryWorkspaceFile[]
  readonly resolver: DiscoveryResolver
  getFile(filePath: string): DiscoveryWorkspaceFile | undefined
}

export interface TypeScriptDiscoveryWorkspace extends DiscoveryWorkspace {
  readonly tsConfigFilePath: string
}

export interface TsMorphDiscoveryWorkspace extends DiscoveryWorkspace {
  readonly project: Project
}

export interface DiscoverySourceSpan {
  readonly start: number
  readonly end: number
}

export interface ScannedExportBinding {
  readonly localName?: string
  readonly exportNames: readonly string[]
  readonly isDefaultExport: boolean
  readonly sourceSpan?: DiscoverySourceSpan
}

export interface ScannedImportBinding {
  readonly kind: 'default' | 'named' | 'namespace'
  readonly specifier: string
  readonly localName: string
  readonly importedName?: string
  readonly sourceSpan?: DiscoverySourceSpan
}

export type DiscoveryImportBinding = ScannedImportBinding

export type ScannedContractReference =
  | { readonly kind: 'identifier'; readonly name: string; readonly sourceSpan?: DiscoverySourceSpan }
  | {
    readonly kind: 'namespace'
    readonly namespaceName: string
    readonly exportName: string
    readonly sourceSpan?: DiscoverySourceSpan
  }

export type ScannedContractClauseKind = 'where' | 'pre' | 'post' | 'law' | 'example'

export interface ScannedContractClause {
  readonly kind: ScannedContractClauseKind
  readonly name?: string
  readonly argumentCount: number
  readonly sourceSpan?: DiscoverySourceSpan
}

export interface ScannedContractClauseSummary {
  readonly whereCount: number
  readonly preNames: readonly string[]
  readonly postNames: readonly string[]
  readonly lawNames: readonly string[]
  readonly exampleNames: readonly string[]
}

export interface ScannedDiscoveryDiagnostic {
  readonly severity: 'info' | 'warning'
  readonly message: string
  readonly sourceSpan?: DiscoverySourceSpan
}

export interface ScannedContractCandidate {
  readonly kind: 'contract'
  readonly filePath: string
  readonly export: ScannedExportBinding
  readonly runtimeName?: string
  readonly clauses: readonly ScannedContractClause[]
  readonly clauseSummary: ScannedContractClauseSummary
  readonly sourceSpan?: DiscoverySourceSpan
}

export interface ScannedImplementationCandidate {
  readonly kind: 'implementation'
  readonly filePath: string
  readonly export: ScannedExportBinding
  readonly contractReference: ScannedContractReference | null
  readonly sourceSpan?: DiscoverySourceSpan
}

export type ScannedReExportBinding =
  | {
    readonly kind: 'named'
    readonly specifier: string
    readonly importedName: string
    readonly exportName: string
    readonly sourceSpan?: DiscoverySourceSpan
  }
  | {
    readonly kind: 'all'
    readonly specifier: string
    readonly sourceSpan?: DiscoverySourceSpan
  }

export interface ScannedSourceFile {
  readonly filePath: string
  readonly imports: readonly ScannedImportBinding[]
  readonly reExports: readonly ScannedReExportBinding[]
  readonly contracts: readonly ScannedContractCandidate[]
  readonly implementations: readonly ScannedImplementationCandidate[]
  readonly diagnostics: readonly ScannedDiscoveryDiagnostic[]
}

export interface DiscoveryParsedFile<Ast = unknown> {
  readonly filePath: string
  readonly text: string
  readonly ast: Ast
}

export interface DiscoveryAstScanner<Ast = unknown> {
  readonly name: string
  parse(filePath: string, text: string): Ast
  scanParsedFile(file: DiscoveryParsedFile<Ast>): ScannedSourceFile
}

export interface OxcParserAdapter<Ast = unknown> {
  parse(filePath: string, text: string): Ast
}

export interface OxcDiscoveryBackendOptions<Ast = unknown> {
  readonly parser: OxcParserAdapter<Ast>
}

export type TsMorphDiscoveryBackendInput =
  | Project
  | { readonly tsConfigFilePath: string }

export interface DiscoveryIndexContractNode extends DiscoveredContract {
  readonly id: string
  readonly implementationIds: readonly string[]
}

export interface DiscoveryIndexImplementationNode extends DiscoveredImplementation {
  readonly id: string
  readonly contractId: string | null
}

export interface DiscoveryIndex {
  readonly contracts: readonly DiscoveryIndexContractNode[]
  readonly implementations: readonly DiscoveryIndexImplementationNode[]
  readonly contractsById: Readonly<Record<string, DiscoveryIndexContractNode>>
  readonly implementationsById: Readonly<Record<string, DiscoveryIndexImplementationNode>>
  readonly unresolvedImplementationIds: readonly string[]
  readonly unimplementedContractIds: readonly string[]
}

export interface DiscoveryWorkspaceAnalysis {
  readonly discovery: DiscoveryResult
  readonly scannedFiles: readonly ScannedSourceFile[]
}

const SOURCE_FILE_RESOLUTION_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '/index.ts',
  '/index.tsx',
  '/index.mts',
  '/index.cts',
  '/index.js',
  '/index.jsx',
  '/index.mjs',
  '/index.cjs',
] as const

function exportKey(filePath: string, exportName: string): string {
  return `${filePath}::${exportName}`
}

function localKey(filePath: string, localName: string): string {
  return `${filePath}::${localName}`
}

function createStableNodeId(kind: 'contract' | 'implementation', filePath: string, exportNames: readonly string[]): string {
  return `${kind}:${filePath}:${exportNames.join('|')}`
}

export function summarizeScannedContractClauses(
  clauses: readonly ScannedContractClause[],
): ScannedContractClauseSummary {
  let whereCount = 0
  const preNames: string[] = []
  const postNames: string[] = []
  const lawNames: string[] = []
  const exampleNames: string[] = []

  for (const clause of clauses) {
    switch (clause.kind) {
      case 'where':
        whereCount += clause.argumentCount
        break
      case 'pre':
        if (clause.name) {
          preNames.push(clause.name)
        }
        break
      case 'post':
        if (clause.name) {
          postNames.push(clause.name)
        }
        break
      case 'law':
        if (clause.name) {
          lawNames.push(clause.name)
        }
        break
      case 'example':
        if (clause.name) {
          exampleNames.push(clause.name)
        }
        break
    }
  }

  return {
    whereCount,
    preNames: Object.freeze(preNames),
    postNames: Object.freeze(postNames),
    lawNames: Object.freeze(lawNames),
    exampleNames: Object.freeze(exampleNames),
  }
}

export function createEmptyScannedContractClauseSummary(): ScannedContractClauseSummary {
  return {
    whereCount: 0,
    preNames: Object.freeze([]),
    postNames: Object.freeze([]),
    lawNames: Object.freeze([]),
    exampleNames: Object.freeze([]),
  }
}

function normalizeFilePath(filePath: string, rootDir?: string): string {
  const normalizedRoot = rootDir ? normalize(rootDir) : undefined
  const resolvedPath = normalizedRoot && !isAbsolute(filePath)
    ? resolve(normalizedRoot, filePath)
    : filePath

  return normalize(resolvedPath)
}

function createResolutionKey(fromFilePath: string, specifier: string): string {
  return `${fromFilePath}::${specifier}`
}

function isLikelyExternalSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !isAbsolute(specifier)
}

function defaultResolution(fromFilePath: string, specifier: string): DiscoveryModuleResolution {
  return {
    fromFilePath,
    specifier,
    resolvedFilePath: null,
    resolutionKind: isLikelyExternalSpecifier(specifier) ? 'external' : 'unresolved',
  }
}

function toDiscoveredContract(args: {
  filePath: string
  exportNames: readonly string[]
  isDefaultExport: boolean
  localName?: string
  runtimeName?: string
}): DiscoveredContract {
  const result: {
    kind: 'contract'
    filePath: string
    exportNames: readonly string[]
    isDefaultExport: boolean
    localName?: string
    runtimeName?: string
  } = {
    kind: 'contract',
    filePath: args.filePath,
    exportNames: args.exportNames,
    isDefaultExport: args.isDefaultExport,
  }

  if (args.localName !== undefined) {
    result.localName = args.localName
  }

  if (args.runtimeName !== undefined) {
    result.runtimeName = args.runtimeName
  }

  return result
}

function toDiscoveredImplementation(args: {
  filePath: string
  exportNames: readonly string[]
  isDefaultExport: boolean
  localName?: string
  contract: DiscoveredContract | null
}): DiscoveredImplementation {
  const result: {
    kind: 'implementation'
    filePath: string
    exportNames: readonly string[]
    isDefaultExport: boolean
    localName?: string
    contract: ResolvedContractReference | null
  } = {
    kind: 'implementation',
    filePath: args.filePath,
    exportNames: args.exportNames,
    isDefaultExport: args.isDefaultExport,
    contract: args.contract ? toResolvedContractReference(args.contract) : null,
  }

  if (args.localName !== undefined) {
    result.localName = args.localName
  }

  return result
}

function toResolvedContractReference(contract: DiscoveredContract): ResolvedContractReference {
  const result: {
    filePath: string
    exportName: string
    localName?: string
    runtimeName?: string
  } = {
    filePath: contract.filePath,
    exportName: contract.exportNames[0] ?? 'default',
  }

  if (contract.localName !== undefined) {
    result.localName = contract.localName
  }

  if (contract.runtimeName !== undefined) {
    result.runtimeName = contract.runtimeName
  }

  return result
}

function buildContractIndexes(contracts: readonly DiscoveredContract[]): {
  readonly byFileAndExport: Map<string, DiscoveredContract>
  readonly byFileAndLocal: Map<string, DiscoveredContract>
} {
  const byFileAndExport = new Map<string, DiscoveredContract>()
  const byFileAndLocal = new Map<string, DiscoveredContract>()

  for (const contract of contracts) {
    for (const exportName of contract.exportNames) {
      byFileAndExport.set(exportKey(contract.filePath, exportName), contract)
    }

    if (contract.localName !== undefined) {
      byFileAndLocal.set(localKey(contract.filePath, contract.localName), contract)
    }
  }

  return { byFileAndExport, byFileAndLocal }
}

export function createDiscoveryWorkspace(
  files: readonly DiscoveryWorkspaceFile[],
  options: {
    readonly rootDir?: string
    readonly resolver?: DiscoveryResolver
  } = {},
): DiscoveryWorkspace {
  const normalizedFiles = files.map((file) => ({
    filePath: normalizeFilePath(file.filePath, options.rootDir),
    text: file.text,
  }))
  const filesByPath = new Map(normalizedFiles.map((file) => [file.filePath, file]))
  const resolver = options.resolver ?? createInMemoryDiscoveryResolver(normalizedFiles)

  const workspace: {
    rootDir?: string
    files: readonly DiscoveryWorkspaceFile[]
    resolver: DiscoveryResolver
    getFile(filePath: string): DiscoveryWorkspaceFile | undefined
  } = {
    files: Object.freeze(normalizedFiles),
    resolver,
    getFile(filePath: string) {
      return filesByPath.get(normalizeFilePath(filePath, options.rootDir))
    },
  }

  if (options.rootDir !== undefined) {
    workspace.rootDir = normalize(options.rootDir)
  }

  return workspace
}

export function createInMemoryDiscoveryResolver(
  files: readonly DiscoveryWorkspaceFile[],
): DiscoveryResolver {
  const filePaths = new Set(files.map((file) => normalize(file.filePath)))

  function resolveLocalModule(fromFilePath: string, specifier: string): DiscoveryModuleResolution {
    const basePath = isAbsolute(specifier)
      ? normalize(specifier)
      : normalize(resolve(dirname(fromFilePath), specifier))

    for (const suffix of SOURCE_FILE_RESOLUTION_SUFFIXES) {
      const candidate = `${basePath}${suffix}`
      if (!filePaths.has(candidate)) {
        continue
      }

      return {
        fromFilePath,
        specifier,
        resolvedFilePath: candidate,
        resolutionKind: 'source-file',
      }
    }

    return defaultResolution(fromFilePath, specifier)
  }

  return {
    resolveModule(fromFilePath: string, specifier: string): DiscoveryModuleResolution {
      const normalizedFromFilePath = normalize(fromFilePath)
      if (isLikelyExternalSpecifier(specifier)) {
        return defaultResolution(normalizedFromFilePath, specifier)
      }

      return resolveLocalModule(normalizedFromFilePath, specifier)
    },
  }
}

function formatTypeScriptDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  if (!diagnostic.file || diagnostic.start === undefined) {
    return message
  }

  const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
  return `${diagnostic.file.fileName}:${location.line + 1}:${location.character + 1} ${message}`
}

function formatTypeScriptDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics.map((diagnostic) => formatTypeScriptDiagnostic(diagnostic)).join('\n')
}

export function createTypeScriptDiscoveryWorkspace(tsConfigFilePath: string): TypeScriptDiscoveryWorkspace {
  if (typeof tsConfigFilePath !== 'string' || tsConfigFilePath.length === 0) {
    throw new TypeError(
      'createTypeScriptDiscoveryWorkspace(tsConfigFilePath): tsConfigFilePath must be a non-empty string',
    )
  }

  const absoluteTsConfigFilePath = normalize(resolve(tsConfigFilePath))
  const readResult = ts.readConfigFile(absoluteTsConfigFilePath, ts.sys.readFile)
  if (readResult.error) {
    throw new TypeError(
      `createTypeScriptDiscoveryWorkspace(tsConfigFilePath): ${formatTypeScriptDiagnostic(readResult.error)}`,
    )
  }

  const configDirectoryPath = dirname(absoluteTsConfigFilePath)
  const parsedConfig = ts.parseJsonConfigFileContent(
    readResult.config,
    ts.sys,
    configDirectoryPath,
    undefined,
    absoluteTsConfigFilePath,
  )
  if (parsedConfig.errors.length > 0) {
    throw new TypeError(
      `createTypeScriptDiscoveryWorkspace(tsConfigFilePath): ${formatTypeScriptDiagnostics(parsedConfig.errors)}`,
    )
  }

  const files = parsedConfig.fileNames.flatMap((filePath) => {
    const text = ts.sys.readFile(filePath)
    if (text === undefined) {
      return []
    }

    return [{
      filePath: normalize(filePath),
      text,
    }]
  })
  const filePaths = new Set(files.map((file) => file.filePath))
  const moduleResolutionCache = ts.createModuleResolutionCache(
    configDirectoryPath,
    (fileName) => ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(),
    parsedConfig.options,
  )

  const workspace = createDiscoveryWorkspace(files, {
    rootDir: parsedConfig.options.rootDir ? normalize(parsedConfig.options.rootDir) : configDirectoryPath,
    resolver: {
      resolveModule(fromFilePath: string, specifier: string): DiscoveryModuleResolution {
        const normalizedFromFilePath = normalize(fromFilePath)
        const resolvedModule = ts.resolveModuleName(
          specifier,
          normalizedFromFilePath,
          parsedConfig.options,
          ts.sys,
          moduleResolutionCache,
        ).resolvedModule

        if (!resolvedModule) {
          return defaultResolution(normalizedFromFilePath, specifier)
        }

        const resolvedFilePath = normalize(resolvedModule.resolvedFileName)
        if (filePaths.has(resolvedFilePath)) {
          return {
            fromFilePath: normalizedFromFilePath,
            specifier,
            resolvedFilePath,
            resolutionKind: 'source-file',
          }
        }

        if (resolvedModule.isExternalLibraryImport || resolvedFilePath.includes('/node_modules/')) {
          return {
            fromFilePath: normalizedFromFilePath,
            specifier,
            resolvedFilePath,
            resolutionKind: 'external',
          }
        }

        return {
          fromFilePath: normalizedFromFilePath,
          specifier,
          resolvedFilePath: null,
          resolutionKind: 'unresolved',
        }
      },
    },
  })

  return {
    ...workspace,
    tsConfigFilePath: absoluteTsConfigFilePath,
  }
}

export function createTsMorphDiscoveryWorkspace(input: TsMorphDiscoveryBackendInput): TsMorphDiscoveryWorkspace {
  const project = input instanceof Project
    ? input
    : new Project({ tsConfigFilePath: input.tsConfigFilePath })

  const files = project.getSourceFiles().map((sourceFile) => ({
    filePath: sourceFile.getFilePath(),
    text: sourceFile.getFullText(),
  }))
  const resolutions = new Map<string, DiscoveryModuleResolution>()

  for (const sourceFile of project.getSourceFiles()) {
    for (const importDeclaration of sourceFile.getImportDeclarations()) {
      const specifier = importDeclaration.getModuleSpecifierValue()
      const importedSourceFile = importDeclaration.getModuleSpecifierSourceFile()
      resolutions.set(
        createResolutionKey(sourceFile.getFilePath(), specifier),
        importedSourceFile
          ? {
            fromFilePath: sourceFile.getFilePath(),
            specifier,
            resolvedFilePath: importedSourceFile.getFilePath(),
            resolutionKind: 'source-file',
          }
          : defaultResolution(sourceFile.getFilePath(), specifier),
      )
    }
  }

  const workspace = createDiscoveryWorkspace(files, {
    rootDir: project.getDirectoryOrThrow(project.getCompilerOptions().rootDir ?? '.').getPath(),
    resolver: {
      resolveModule(fromFilePath: string, specifier: string): DiscoveryModuleResolution {
        return resolutions.get(createResolutionKey(fromFilePath, specifier))
          ?? defaultResolution(fromFilePath, specifier)
      },
    },
  })

  return {
    ...workspace,
    project,
  }
}

export function scanDiscoveryWorkspace<Ast>(
  workspace: DiscoveryWorkspace,
  scanner: DiscoveryAstScanner<Ast>,
): ScannedSourceFile[] {
  return workspace.files.map((file) => {
    const ast = scanner.parse(file.filePath, file.text)
    return scanner.scanParsedFile({
      filePath: file.filePath,
      text: file.text,
      ast,
    })
  })
}

function resolveScannedContractReference(
  workspace: DiscoveryWorkspace,
  importsByFile: ReadonlyMap<string, readonly ScannedImportBinding[]>,
  reference: ScannedContractReference | null,
  filePath: string,
  contractIndexes: {
    readonly byFileAndExport: Map<string, DiscoveredContract>
    readonly byFileAndLocal: Map<string, DiscoveredContract>
  },
): DiscoveredContract | null {
  if (!reference) {
    return null
  }

  if (reference.kind === 'identifier') {
    const localContract = contractIndexes.byFileAndLocal.get(localKey(filePath, reference.name))
    if (localContract) {
      return localContract
    }

    const importBinding = importsByFile
      .get(filePath)
      ?.find((candidate) => candidate.localName === reference.name && candidate.kind !== 'namespace')

    if (!importBinding) {
      return null
    }

    const resolution = workspace.resolver.resolveModule(filePath, importBinding.specifier)
    if (resolution.resolutionKind !== 'source-file' || !resolution.resolvedFilePath) {
      return null
    }

    const exportName = importBinding.kind === 'default'
      ? 'default'
      : importBinding.importedName ?? importBinding.localName

    return contractIndexes.byFileAndExport.get(exportKey(resolution.resolvedFilePath, exportName)) ?? null
  }

  const namespaceImport = importsByFile
    .get(filePath)
    ?.find((candidate) => candidate.kind === 'namespace' && candidate.localName === reference.namespaceName)

  if (!namespaceImport) {
    return null
  }

  const resolution = workspace.resolver.resolveModule(filePath, namespaceImport.specifier)
  if (resolution.resolutionKind !== 'source-file' || !resolution.resolvedFilePath) {
    return null
  }

  return contractIndexes.byFileAndExport.get(exportKey(resolution.resolvedFilePath, reference.exportName)) ?? null
}

interface MutableDiscoveredContract {
  readonly filePath: string
  readonly exportNames: Set<string>
  localName?: string
  runtimeName?: string
}

interface MutableDiscoveredImplementation {
  readonly filePath: string
  readonly exportNames: Set<string>
  localName?: string
  contract: ResolvedContractReference | null
}

function contractIdentityKey(filePath: string, contract: DiscoveredContract): string {
  return `${filePath}::${contract.localName ?? preferredExportName(contract.exportNames, contract.isDefaultExport)}::${contract.runtimeName ?? ''}`
}

function implementationIdentityKey(filePath: string, implementation: DiscoveredImplementation): string {
  const contractKey = implementation.contract
    ? `${implementation.contract.filePath}::${implementation.contract.exportName}`
    : 'unresolved'
  return `${filePath}::${implementation.localName ?? preferredExportName(implementation.exportNames, implementation.isDefaultExport)}::${contractKey}`
}

function preferredExportName(exportNames: readonly string[], isDefaultExport: boolean): string {
  if (isDefaultExport && exportNames.includes('default')) {
    return 'default'
  }

  return exportNames[0] ?? 'default'
}

function mutableContractToDiscoveredContract(contract: MutableDiscoveredContract): DiscoveredContract {
  return toDiscoveredContract({
    filePath: contract.filePath,
    exportNames: Object.freeze([...contract.exportNames]),
    isDefaultExport: contract.exportNames.has('default'),
    ...(contract.localName !== undefined ? { localName: contract.localName } : {}),
    ...(contract.runtimeName !== undefined ? { runtimeName: contract.runtimeName } : {}),
  })
}

function mutableImplementationToDiscoveredImplementation(
  implementation: MutableDiscoveredImplementation,
): DiscoveredImplementation {
  return {
    kind: 'implementation',
    filePath: implementation.filePath,
    exportNames: Object.freeze([...implementation.exportNames]),
    isDefaultExport: implementation.exportNames.has('default'),
    ...(implementation.localName !== undefined ? { localName: implementation.localName } : {}),
    contract: implementation.contract,
  }
}

function projectReExportedContracts(
  workspace: DiscoveryWorkspace,
  scannedFiles: readonly ScannedSourceFile[],
  localContracts: readonly DiscoveredContract[],
): DiscoveredContract[] {
  const mutableContracts = new Map<string, MutableDiscoveredContract>()

  function addAlias(filePath: string, source: DiscoveredContract, exportName: string): boolean {
    const identityKey = contractIdentityKey(filePath, source)
    const existing = mutableContracts.get(identityKey)
    if (existing) {
      const sizeBefore = existing.exportNames.size
      existing.exportNames.add(exportName)
      return existing.exportNames.size !== sizeBefore
    }

    const mutableContract: MutableDiscoveredContract = {
      filePath,
      exportNames: new Set([exportName]),
    }
    if (source.localName !== undefined) {
      mutableContract.localName = source.localName
    }
    if (source.runtimeName !== undefined) {
      mutableContract.runtimeName = source.runtimeName
    }

    mutableContracts.set(identityKey, mutableContract)
    return true
  }

  for (const contract of localContracts) {
    const identityKey = contractIdentityKey(contract.filePath, contract)
    const mutableContract: MutableDiscoveredContract = {
      filePath: contract.filePath,
      exportNames: new Set(contract.exportNames),
    }
    if (contract.localName !== undefined) {
      mutableContract.localName = contract.localName
    }
    if (contract.runtimeName !== undefined) {
      mutableContract.runtimeName = contract.runtimeName
    }
    mutableContracts.set(identityKey, mutableContract)
  }

  let changed = true
  while (changed) {
    changed = false
    const discoveredContracts = [...mutableContracts.values()].map(mutableContractToDiscoveredContract)
    const byExport = buildContractIndexes(discoveredContracts).byFileAndExport
    const byFile = new Map<string, DiscoveredContract[]>()

    for (const contract of discoveredContracts) {
      const fileContracts = byFile.get(contract.filePath)
      if (fileContracts) {
        fileContracts.push(contract)
      } else {
        byFile.set(contract.filePath, [contract])
      }
    }

    for (const file of scannedFiles) {
      for (const reExport of file.reExports) {
        const resolution = workspace.resolver.resolveModule(file.filePath, reExport.specifier)
        if (resolution.resolutionKind !== 'source-file' || !resolution.resolvedFilePath) {
          continue
        }

        if (reExport.kind === 'named') {
          const sourceContract = byExport.get(exportKey(resolution.resolvedFilePath, reExport.importedName))
          if (sourceContract && addAlias(file.filePath, sourceContract, reExport.exportName)) {
            changed = true
          }
          continue
        }

        for (const sourceContract of byFile.get(resolution.resolvedFilePath) ?? []) {
          for (const exportName of sourceContract.exportNames) {
            if (exportName === 'default') {
              continue
            }

            if (addAlias(file.filePath, sourceContract, exportName)) {
              changed = true
            }
          }
        }
      }
    }
  }

  return [...mutableContracts.values()].map(mutableContractToDiscoveredContract)
}

function projectReExportedImplementations(
  workspace: DiscoveryWorkspace,
  scannedFiles: readonly ScannedSourceFile[],
  localImplementations: readonly DiscoveredImplementation[],
): DiscoveredImplementation[] {
  const mutableImplementations = new Map<string, MutableDiscoveredImplementation>()

  function addAlias(filePath: string, source: DiscoveredImplementation, exportName: string): boolean {
    const identityKey = implementationIdentityKey(filePath, source)
    const existing = mutableImplementations.get(identityKey)
    if (existing) {
      const sizeBefore = existing.exportNames.size
      existing.exportNames.add(exportName)
      return existing.exportNames.size !== sizeBefore
    }

    const mutableImplementation: MutableDiscoveredImplementation = {
      filePath,
      exportNames: new Set([exportName]),
      contract: source.contract,
    }
    if (source.localName !== undefined) {
      mutableImplementation.localName = source.localName
    }

    mutableImplementations.set(identityKey, mutableImplementation)
    return true
  }

  for (const implementation of localImplementations) {
    const identityKey = implementationIdentityKey(implementation.filePath, implementation)
    const mutableImplementation: MutableDiscoveredImplementation = {
      filePath: implementation.filePath,
      exportNames: new Set(implementation.exportNames),
      contract: implementation.contract,
    }
    if (implementation.localName !== undefined) {
      mutableImplementation.localName = implementation.localName
    }

    mutableImplementations.set(identityKey, mutableImplementation)
  }

  let changed = true
  while (changed) {
    changed = false
    const discoveredImplementations = [...mutableImplementations.values()].map(mutableImplementationToDiscoveredImplementation)
    const byExport = new Map<string, DiscoveredImplementation>()
    const byFile = new Map<string, DiscoveredImplementation[]>()

    for (const implementation of discoveredImplementations) {
      for (const exportName of implementation.exportNames) {
        byExport.set(exportKey(implementation.filePath, exportName), implementation)
      }

      const fileImplementations = byFile.get(implementation.filePath)
      if (fileImplementations) {
        fileImplementations.push(implementation)
      } else {
        byFile.set(implementation.filePath, [implementation])
      }
    }

    for (const file of scannedFiles) {
      for (const reExport of file.reExports) {
        const resolution = workspace.resolver.resolveModule(file.filePath, reExport.specifier)
        if (resolution.resolutionKind !== 'source-file' || !resolution.resolvedFilePath) {
          continue
        }

        if (reExport.kind === 'named') {
          const sourceImplementation = byExport.get(exportKey(resolution.resolvedFilePath, reExport.importedName))
          if (sourceImplementation && addAlias(file.filePath, sourceImplementation, reExport.exportName)) {
            changed = true
          }
          continue
        }

        for (const sourceImplementation of byFile.get(resolution.resolvedFilePath) ?? []) {
          for (const exportName of sourceImplementation.exportNames) {
            if (exportName === 'default') {
              continue
            }

            if (addAlias(file.filePath, sourceImplementation, exportName)) {
              changed = true
            }
          }
        }
      }
    }
  }

  return [...mutableImplementations.values()].map(mutableImplementationToDiscoveredImplementation)
}

export function pairDiscoveryWorkspaceScan(
  workspace: DiscoveryWorkspace,
  scannedFiles: readonly ScannedSourceFile[],
): DiscoveryResult {
  const localContracts = scannedFiles.flatMap((file) => file.contracts).map((contract) => {
    const discoveredContract: {
      filePath: string
      exportNames: readonly string[]
      isDefaultExport: boolean
      localName?: string
      runtimeName?: string
    } = {
      filePath: contract.filePath,
      exportNames: contract.export.exportNames,
      isDefaultExport: contract.export.isDefaultExport,
    }

    if (contract.export.localName !== undefined) {
      discoveredContract.localName = contract.export.localName
    }

    if (contract.runtimeName !== undefined) {
      discoveredContract.runtimeName = contract.runtimeName
    }

    return toDiscoveredContract(discoveredContract)
  })
  const contracts = projectReExportedContracts(workspace, scannedFiles, localContracts)
  const contractIndexes = buildContractIndexes(contracts)
  const importsByFile = new Map<string, readonly ScannedImportBinding[]>(
    scannedFiles.map((file) => [file.filePath, file.imports]),
  )

  const localImplementations = scannedFiles.flatMap((file) => file.implementations).map((implementation) => {
    const resolvedContract = resolveScannedContractReference(
      workspace,
      importsByFile,
      implementation.contractReference,
      implementation.filePath,
      contractIndexes,
    )

    const discoveredImplementation: {
      filePath: string
      exportNames: readonly string[]
      isDefaultExport: boolean
      localName?: string
      contract: DiscoveredContract | null
    } = {
      filePath: implementation.filePath,
      exportNames: implementation.export.exportNames,
      isDefaultExport: implementation.export.isDefaultExport,
      contract: resolvedContract,
    }

    if (implementation.export.localName !== undefined) {
      discoveredImplementation.localName = implementation.export.localName
    }

    return toDiscoveredImplementation(discoveredImplementation)
  })
  const implementations = projectReExportedImplementations(workspace, scannedFiles, localImplementations)

  return {
    contracts,
    implementations,
  }
}

export function analyzeDiscoveryWorkspaceWithAstScanner<Ast>(
  workspace: DiscoveryWorkspace,
  scanner: DiscoveryAstScanner<Ast>,
): DiscoveryWorkspaceAnalysis {
  const scannedFiles = Object.freeze(scanDiscoveryWorkspace(workspace, scanner))

  return {
    scannedFiles,
    discovery: pairDiscoveryWorkspaceScan(workspace, scannedFiles),
  }
}

export function discoverWorkspaceWithAstScanner<Ast>(
  workspace: DiscoveryWorkspace,
  scanner: DiscoveryAstScanner<Ast>,
): DiscoveryResult {
  return analyzeDiscoveryWorkspaceWithAstScanner(workspace, scanner).discovery
}

export function createWorkspaceDiscoveryBackend<Ast>(args: {
  readonly name: string
  readonly scanner: DiscoveryAstScanner<Ast>
  readonly capabilities?: Partial<DiscoveryBackendCapabilities>
}): DiscoveryBackend<DiscoveryWorkspace> {
  return {
    name: args.name,
    capabilities: {
      supportsTsConfigProjects: args.capabilities?.supportsTsConfigProjects ?? false,
      supportsModuleResolution: args.capabilities?.supportsModuleResolution ?? true,
      supportsSourceTextWorkspaces: args.capabilities?.supportsSourceTextWorkspaces ?? true,
      preservesOperationalImports: args.capabilities?.preservesOperationalImports ?? true,
      intendedConsumers: args.capabilities?.intendedConsumers ?? ['library', 'agent-tool'],
    },
    discover(workspace) {
      return discoverWorkspaceWithAstScanner(workspace, args.scanner)
    },
  }
}

export function buildDiscoveryIndex(result: DiscoveryResult): DiscoveryIndex {
  const contractIdsByKey = new Map<string, string>()
  const implementationIdsByContractId = new Map<string, string[]>()
  const contractsById: Record<string, DiscoveryIndexContractNode> = {}
  const implementationsById: Record<string, DiscoveryIndexImplementationNode> = {}

  for (const contract of result.contracts) {
    const id = createStableNodeId('contract', contract.filePath, contract.exportNames)
    contractIdsByKey.set(`${contract.filePath}::${contract.exportNames[0] ?? 'default'}`, id)
    implementationIdsByContractId.set(id, [])
    contractsById[id] = {
      ...contract,
      id,
      implementationIds: [],
    }
  }

  const implementations = result.implementations.map((implementation) => {
    const id = createStableNodeId('implementation', implementation.filePath, implementation.exportNames)
    const contractId = implementation.contract
      ? contractIdsByKey.get(`${implementation.contract.filePath}::${implementation.contract.exportName}`) ?? null
      : null

    if (contractId) {
      implementationIdsByContractId.get(contractId)?.push(id)
    }

    const indexedImplementation: DiscoveryIndexImplementationNode = {
      ...implementation,
      id,
      contractId,
    }
    implementationsById[id] = indexedImplementation
    return indexedImplementation
  })

  const contracts = Object.values(contractsById).map((contract) => ({
    ...contract,
    implementationIds: Object.freeze([...(implementationIdsByContractId.get(contract.id) ?? [])]),
  }))

  const finalizedContractsById: Record<string, DiscoveryIndexContractNode> = {}
  for (const contract of contracts) {
    finalizedContractsById[contract.id] = contract
  }

  const unresolvedImplementationIds = implementations
    .filter((implementation) => implementation.contractId === null)
    .map((implementation) => implementation.id)

  const unimplementedContractIds = contracts
    .filter((contract) => contract.implementationIds.length === 0)
    .map((contract) => contract.id)

  return {
    contracts,
    implementations,
    contractsById: Object.freeze(finalizedContractsById),
    implementationsById: Object.freeze(implementationsById),
    unresolvedImplementationIds: Object.freeze(unresolvedImplementationIds),
    unimplementedContractIds: Object.freeze(unimplementedContractIds),
  }
}

export function createTsMorphDiscoveryBackend(): DiscoveryBackend<TsMorphDiscoveryBackendInput> {
  return {
    name: 'ts-morph',
    capabilities: {
      supportsTsConfigProjects: true,
      supportsModuleResolution: true,
      supportsSourceTextWorkspaces: true,
      preservesOperationalImports: true,
      intendedConsumers: ['library', 'agent-tool'],
    },
    discover(input) {
      const project = input instanceof Project
        ? input
        : new Project({ tsConfigFilePath: input.tsConfigFilePath })

      return discoverProject(project)
    },
  }
}

export function describeOxcDiscoveryBackendPlan(): {
  readonly name: 'oxc'
  readonly capabilities: DiscoveryBackendCapabilities
  readonly requiredLayers: readonly [
    'tsconfig-file-set',
    'module-resolution',
    'syntax-scan',
    'pairing-index',
  ]
  readonly notes: readonly string[]
} {
  return {
    name: 'oxc',
    capabilities: {
      supportsTsConfigProjects: true,
      supportsModuleResolution: true,
      supportsSourceTextWorkspaces: true,
      preservesOperationalImports: true,
      intendedConsumers: ['library', 'agent-tool'],
    },
    requiredLayers: [
      'tsconfig-file-set',
      'module-resolution',
      'syntax-scan',
      'pairing-index',
    ],
    notes: [
      'Use a TS-backed resolver layer to enumerate files and resolve imports before or during OXC scanning.',
      'Keep discovery syntax-first: explicit contract(...) and implement(...) bindings should remain the primary source of truth.',
      'Produce a compact pairing index so AI agents can traverse contract/implementation relationships with fewer tokens than raw source navigation.',
      'Preserve canonical source file paths so rendering can keep generating operational imports without AST-to-AST rewriting.',
      'Model the scanner around per-file parsed AST inputs so an OXC walker can plug into discoverWorkspaceWithAstScanner(...) directly.',
    ],
  }
}
