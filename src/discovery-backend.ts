import { dirname, isAbsolute, normalize, resolve } from 'node:path'

import { Project } from 'ts-morph'

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

export interface ScannedSourceFile {
  readonly filePath: string
  readonly imports: readonly ScannedImportBinding[]
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

export function pairDiscoveryWorkspaceScan(
  workspace: DiscoveryWorkspace,
  scannedFiles: readonly ScannedSourceFile[],
): DiscoveryResult {
  const contracts = scannedFiles.flatMap((file) => file.contracts).map((contract) => {
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
  const contractIndexes = buildContractIndexes(contracts)
  const importsByFile = new Map<string, readonly ScannedImportBinding[]>(
    scannedFiles.map((file) => [file.filePath, file.imports]),
  )

  const implementations = scannedFiles.flatMap((file) => file.implementations).map((implementation) => {
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

  return {
    contracts,
    implementations,
  }
}

export function discoverWorkspaceWithAstScanner<Ast>(
  workspace: DiscoveryWorkspace,
  scanner: DiscoveryAstScanner<Ast>,
): DiscoveryResult {
  return pairDiscoveryWorkspaceScan(workspace, scanDiscoveryWorkspace(workspace, scanner))
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
