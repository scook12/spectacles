import {
  CallExpression,
  ExportAssignment,
  Node,
  Project,
  SourceFile,
  VariableDeclaration,
} from 'ts-morph'

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

interface ExportedVariableInfo {
  readonly declaration: VariableDeclaration
  readonly filePath: string
  readonly localName: string
  readonly exportNames: readonly string[]
  readonly isDefaultExport: boolean
}

interface ExportedDefaultCallInfo {
  readonly exportAssignment: ExportAssignment
  readonly callExpression: CallExpression
  readonly filePath: string
  readonly exportNames: readonly ['default']
  readonly isDefaultExport: true
}

interface ImportedBinding {
  readonly filePath: string
  readonly exportName: string
}

interface SourceFileScan {
  readonly sourceFile: SourceFile
  readonly filePath: string
  readonly contractFactoryNames: ReadonlySet<string>
  readonly implementFactoryNames: ReadonlySet<string>
  readonly namespaceImportSourceFiles: ReadonlyMap<string, string>
  readonly importedBindingsByLocal: ReadonlyMap<string, ImportedBinding>
  readonly exportedVariables: readonly ExportedVariableInfo[]
  readonly defaultExportCalls: readonly ExportedDefaultCallInfo[]
}

interface ImplementationCandidate {
  readonly filePath: string
  readonly localName?: string
  readonly exportNames: readonly string[]
  readonly isDefaultExport: boolean
  readonly contractExpression: Node | null
  readonly scan: SourceFileScan
}

interface ProjectScan {
  readonly contracts: readonly DiscoveredContract[]
  readonly implementationCandidates: readonly ImplementationCandidate[]
}

interface ContractIndexes {
  readonly byFileAndExport: Map<string, DiscoveredContract>
  readonly byFileAndLocal: Map<string, DiscoveredContract>
}

function exportKey(filePath: string, exportName: string): string {
  return `${filePath}::${exportName}`
}

function localKey(filePath: string, localName: string): string {
  return `${filePath}::${localName}`
}

function getFactoryRootCall(
  callExpression: CallExpression,
  directNames: ReadonlySet<string>,
  namespaceImportNames: ReadonlySet<string>,
  expectedPropertyName: string,
): CallExpression | null {
  let current: CallExpression | null = callExpression

  while (current) {
    const expression = current.getExpression()

    if (Node.isIdentifier(expression)) {
      return directNames.has(expression.getText()) ? current : null
    }

    if (!Node.isPropertyAccessExpression(expression)) {
      return null
    }

    const left = expression.getExpression()
    if (
      Node.isIdentifier(left)
      && namespaceImportNames.has(left.getText())
      && expression.getName() === expectedPropertyName
    ) {
      return current
    }

    if (!Node.isCallExpression(left)) {
      return null
    }

    current = left
  }

  return null
}

function isMatchingFactoryCall(
  callExpression: CallExpression,
  directNames: ReadonlySet<string>,
  namespaceImportNames: ReadonlySet<string>,
  expectedPropertyName: string,
): boolean {
  return getFactoryRootCall(callExpression, directNames, namespaceImportNames, expectedPropertyName) !== null
}

function getRuntimeName(callExpression: CallExpression): string | undefined {
  const firstArgument = callExpression.getArguments()[0]
  if (!firstArgument) {
    return undefined
  }

  if (Node.isStringLiteral(firstArgument) || Node.isNoSubstitutionTemplateLiteral(firstArgument)) {
    return firstArgument.getLiteralValue()
  }

  return undefined
}

function collectExportedVariableInfos(sourceFile: SourceFile): ExportedVariableInfo[] {
  const byDeclaration = new Map<VariableDeclaration, { localName: string; exportNames: string[] }>()

  for (const [exportName, declarations] of sourceFile.getExportedDeclarations()) {
    for (const declaration of declarations) {
      if (!Node.isVariableDeclaration(declaration)) {
        continue
      }

      const current = byDeclaration.get(declaration)
      if (current) {
        current.exportNames.push(exportName)
        continue
      }

      byDeclaration.set(declaration, {
        localName: declaration.getName(),
        exportNames: [exportName],
      })
    }
  }

  return [...byDeclaration.entries()].map(([declaration, info]) => ({
    declaration,
    filePath: sourceFile.getFilePath(),
    localName: info.localName,
    exportNames: Object.freeze([...info.exportNames]),
    isDefaultExport: info.exportNames.includes('default'),
  }))
}

function scanSourceFile(sourceFile: SourceFile): SourceFileScan {
  const contractFactoryNames = new Set<string>(['contract'])
  const implementFactoryNames = new Set<string>(['implement'])
  const namespaceImportSourceFiles = new Map<string, string>()
  const importedBindingsByLocal = new Map<string, ImportedBinding>()

  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const importedSourceFile = importDeclaration.getModuleSpecifierSourceFile()
    const importedFilePath = importedSourceFile?.getFilePath()

    const defaultImport = importDeclaration.getDefaultImport()
    if (defaultImport && importedFilePath) {
      importedBindingsByLocal.set(defaultImport.getText(), {
        filePath: importedFilePath,
        exportName: 'default',
      })
    }

    const namespaceImport = importDeclaration.getNamespaceImport()
    if (namespaceImport && importedFilePath) {
      namespaceImportSourceFiles.set(namespaceImport.getText(), importedFilePath)
    }

    for (const namedImport of importDeclaration.getNamedImports()) {
      const importedName = namedImport.getNameNode().getText()
      const localName = namedImport.getAliasNode()?.getText() ?? importedName

      if (importedFilePath) {
        importedBindingsByLocal.set(localName, {
          filePath: importedFilePath,
          exportName: importedName,
        })
      }

      if (importedName === 'contract') {
        contractFactoryNames.add(localName)
      }

      if (importedName === 'implement') {
        implementFactoryNames.add(localName)
      }
    }
  }

  const defaultExportCalls: ExportedDefaultCallInfo[] = []
  for (const exportAssignment of sourceFile.getExportAssignments()) {
    if (exportAssignment.isExportEquals()) {
      continue
    }

    const expression = exportAssignment.getExpression()
    if (!expression || !Node.isCallExpression(expression)) {
      continue
    }

    defaultExportCalls.push({
      exportAssignment,
      callExpression: expression,
      filePath: sourceFile.getFilePath(),
      exportNames: ['default'],
      isDefaultExport: true,
    })
  }

  return {
    sourceFile,
    filePath: sourceFile.getFilePath(),
    contractFactoryNames,
    implementFactoryNames,
    namespaceImportSourceFiles,
    importedBindingsByLocal,
    exportedVariables: collectExportedVariableInfos(sourceFile),
    defaultExportCalls: Object.freeze(defaultExportCalls),
  }
}

function toDiscoveredContract(args: {
  filePath: string
  exportNames: readonly string[]
  isDefaultExport: boolean
  localName?: string | undefined
  runtimeName?: string | undefined
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

function toDiscoveredImplementation(args: {
  filePath: string
  exportNames: readonly string[]
  isDefaultExport: boolean
  localName?: string | undefined
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

function buildContractIndexes(contracts: readonly DiscoveredContract[]): ContractIndexes {
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

function resolveContractReference(
  scan: SourceFileScan,
  expression: Node,
  indexes: ContractIndexes,
): DiscoveredContract | null {
  if (Node.isIdentifier(expression)) {
    const localName = expression.getText()
    const importedBinding = scan.importedBindingsByLocal.get(localName)
    if (importedBinding) {
      return indexes.byFileAndExport.get(exportKey(importedBinding.filePath, importedBinding.exportName)) ?? null
    }

    return indexes.byFileAndLocal.get(localKey(scan.filePath, localName)) ?? null
  }

  if (Node.isPropertyAccessExpression(expression)) {
    const left = expression.getExpression()
    if (!Node.isIdentifier(left)) {
      return null
    }

    const sourceFilePath = scan.namespaceImportSourceFiles.get(left.getText())
    if (!sourceFilePath) {
      return null
    }

    return indexes.byFileAndExport.get(exportKey(sourceFilePath, expression.getName())) ?? null
  }

  return null
}

function scanProject(project: Project): ProjectScan {
  const contracts: DiscoveredContract[] = []
  const implementationCandidates: ImplementationCandidate[] = []

  for (const sourceFile of project.getSourceFiles()) {
    const scan = scanSourceFile(sourceFile)
    const namespaceImportNames = new Set(scan.namespaceImportSourceFiles.keys())

    for (const exportedVariable of scan.exportedVariables) {
      const initializer = exportedVariable.declaration.getInitializer()
      if (!initializer || !Node.isCallExpression(initializer)) {
        continue
      }

      const contractRoot = getFactoryRootCall(
        initializer,
        scan.contractFactoryNames,
        namespaceImportNames,
        'contract',
      )
      if (contractRoot) {
        contracts.push(toDiscoveredContract({
          filePath: exportedVariable.filePath,
          localName: exportedVariable.localName,
          exportNames: exportedVariable.exportNames,
          isDefaultExport: exportedVariable.isDefaultExport,
          runtimeName: getRuntimeName(contractRoot),
        }))
        continue
      }

      const implementRoot = getFactoryRootCall(
        initializer,
        scan.implementFactoryNames,
        namespaceImportNames,
        'implement',
      )
      if (!implementRoot) {
        continue
      }

      implementationCandidates.push({
        filePath: exportedVariable.filePath,
        localName: exportedVariable.localName,
        exportNames: exportedVariable.exportNames,
        isDefaultExport: exportedVariable.isDefaultExport,
        contractExpression: initializer.getArguments()[0] ?? null,
        scan,
      })
    }

    for (const exportedDefaultCall of scan.defaultExportCalls) {
      const contractRoot = getFactoryRootCall(
        exportedDefaultCall.callExpression,
        scan.contractFactoryNames,
        namespaceImportNames,
        'contract',
      )
      if (contractRoot) {
        contracts.push(toDiscoveredContract({
          filePath: exportedDefaultCall.filePath,
          exportNames: exportedDefaultCall.exportNames,
          isDefaultExport: exportedDefaultCall.isDefaultExport,
          runtimeName: getRuntimeName(contractRoot),
        }))
        continue
      }

      const implementRoot = getFactoryRootCall(
        exportedDefaultCall.callExpression,
        scan.implementFactoryNames,
        namespaceImportNames,
        'implement',
      )
      if (!implementRoot) {
        continue
      }

      implementationCandidates.push({
        filePath: exportedDefaultCall.filePath,
        exportNames: exportedDefaultCall.exportNames,
        isDefaultExport: exportedDefaultCall.isDefaultExport,
        contractExpression: exportedDefaultCall.callExpression.getArguments()[0] ?? null,
        scan,
      })
    }
  }

  return {
    contracts: Object.freeze(contracts),
    implementationCandidates: Object.freeze(implementationCandidates),
  }
}

function resolveImplementationCandidates(
  candidates: readonly ImplementationCandidate[],
  contracts: readonly DiscoveredContract[],
): DiscoveredImplementation[] {
  const indexes = buildContractIndexes(contracts)

  return candidates.map((candidate) => {
    const resolvedContract = candidate.contractExpression
      ? resolveContractReference(candidate.scan, candidate.contractExpression, indexes)
      : null

    return toDiscoveredImplementation({
      filePath: candidate.filePath,
      localName: candidate.localName,
      exportNames: candidate.exportNames,
      isDefaultExport: candidate.isDefaultExport,
      contract: resolvedContract,
    })
  })
}

export function discoverContracts(project: Project): DiscoveredContract[] {
  return [...scanProject(project).contracts]
}

export function discoverImplementations(
  project: Project,
  contracts?: readonly DiscoveredContract[],
): DiscoveredImplementation[] {
  const scan = scanProject(project)
  return resolveImplementationCandidates(scan.implementationCandidates, contracts ?? scan.contracts)
}

export function discoverProject(project: Project): DiscoveryResult {
  const scan = scanProject(project)
  const implementations = resolveImplementationCandidates(scan.implementationCandidates, scan.contracts)

  return {
    contracts: scan.contracts,
    implementations,
  }
}
