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
  readonly filePath: string
  readonly exportNames: readonly ['default']
  readonly isDefaultExport: true
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

function getImportedFunctionLocalNames(sourceFile: SourceFile, importedName: string): Set<string> {
  const names = new Set<string>([importedName])

  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    for (const namedImport of importDeclaration.getNamedImports()) {
      if (namedImport.getNameNode().getText() !== importedName) {
        continue
      }

      names.add(namedImport.getAliasNode()?.getText() ?? importedName)
    }
  }

  return names
}

function getNamespaceImportNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>()

  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const namespaceImport = importDeclaration.getNamespaceImport()
    if (namespaceImport) {
      names.add(namespaceImport.getText())
    }
  }

  return names
}

function isMatchingFactoryCall(
  callExpression: CallExpression,
  directNames: Set<string>,
  namespaceImportNames: Set<string>,
  expectedPropertyName: string,
): boolean {
  const expression = callExpression.getExpression()

  if (Node.isIdentifier(expression)) {
    return directNames.has(expression.getText())
  }

  if (Node.isPropertyAccessExpression(expression)) {
    const left = expression.getExpression()
    return (
      Node.isIdentifier(left)
      && namespaceImportNames.has(left.getText())
      && expression.getName() === expectedPropertyName
    )
  }

  return false
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

function collectDefaultExportedCallInfos(
  sourceFile: SourceFile,
  directNames: Set<string>,
  namespaceImportNames: Set<string>,
  expectedPropertyName: string,
): ExportedDefaultCallInfo[] {
  const results: ExportedDefaultCallInfo[] = []

  for (const exportAssignment of sourceFile.getExportAssignments()) {
    if (exportAssignment.isExportEquals()) {
      continue
    }

    const expression = exportAssignment.getExpression()
    if (!expression || !Node.isCallExpression(expression)) {
      continue
    }

    if (!isMatchingFactoryCall(expression, directNames, namespaceImportNames, expectedPropertyName)) {
      continue
    }

    results.push({
      exportAssignment,
      filePath: sourceFile.getFilePath(),
      exportNames: ['default'],
      isDefaultExport: true,
    })
  }

  return results
}

function buildContractIndexes(contracts: readonly DiscoveredContract[]): ContractIndexes {
  const byFileAndExport = new Map<string, DiscoveredContract>()
  const byFileAndLocal = new Map<string, DiscoveredContract>()

  for (const contract of contracts) {
    for (const exportName of contract.exportNames) {
      byFileAndExport.set(exportKey(contract.filePath, exportName), contract)
    }

    if (contract.localName) {
      byFileAndLocal.set(localKey(contract.filePath, contract.localName), contract)
    }
  }

  return { byFileAndExport, byFileAndLocal }
}

function resolveImportedContract(
  sourceFile: SourceFile,
  localName: string,
  indexes: ContractIndexes,
): DiscoveredContract | null {
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const importedSourceFile = importDeclaration.getModuleSpecifierSourceFile()
    if (!importedSourceFile) {
      continue
    }

    const defaultImport = importDeclaration.getDefaultImport()
    if (defaultImport && defaultImport.getText() === localName) {
      return indexes.byFileAndExport.get(exportKey(importedSourceFile.getFilePath(), 'default')) ?? null
    }

    for (const namedImport of importDeclaration.getNamedImports()) {
      const importedLocalName = namedImport.getAliasNode()?.getText() ?? namedImport.getNameNode().getText()
      if (importedLocalName !== localName) {
        continue
      }

      return indexes.byFileAndExport.get(
        exportKey(importedSourceFile.getFilePath(), namedImport.getNameNode().getText()),
      ) ?? null
    }
  }

  return null
}

function resolveNamespaceImportedContract(
  sourceFile: SourceFile,
  namespaceName: string,
  exportName: string,
  indexes: ContractIndexes,
): DiscoveredContract | null {
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const namespaceImport = importDeclaration.getNamespaceImport()
    if (!namespaceImport || namespaceImport.getText() !== namespaceName) {
      continue
    }

    const importedSourceFile = importDeclaration.getModuleSpecifierSourceFile()
    if (!importedSourceFile) {
      continue
    }

    return indexes.byFileAndExport.get(exportKey(importedSourceFile.getFilePath(), exportName)) ?? null
  }

  return null
}

function resolveContractReference(
  sourceFile: SourceFile,
  expression: Node,
  indexes: ContractIndexes,
): DiscoveredContract | null {
  if (Node.isIdentifier(expression)) {
    return (
      resolveImportedContract(sourceFile, expression.getText(), indexes)
      ?? indexes.byFileAndLocal.get(localKey(sourceFile.getFilePath(), expression.getText()))
      ?? null
    )
  }

  if (Node.isPropertyAccessExpression(expression)) {
    const left = expression.getExpression()
    if (!Node.isIdentifier(left)) {
      return null
    }

    return resolveNamespaceImportedContract(sourceFile, left.getText(), expression.getName(), indexes)
  }

  return null
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

function getCallExpressionFromExportAssignment(exportAssignment: ExportAssignment): CallExpression {
  const expression = exportAssignment.getExpression()
  if (!expression || !Node.isCallExpression(expression)) {
    throw new TypeError('Expected export assignment to contain a call expression')
  }

  return expression
}

export function discoverContracts(project: Project): DiscoveredContract[] {
  const results: DiscoveredContract[] = []

  for (const sourceFile of project.getSourceFiles()) {
    const directNames = getImportedFunctionLocalNames(sourceFile, 'contract')
    const namespaceImportNames = getNamespaceImportNames(sourceFile)

    for (const exportedVariable of collectExportedVariableInfos(sourceFile)) {
      const initializer = exportedVariable.declaration.getInitializer()
      if (!initializer || !Node.isCallExpression(initializer)) {
        continue
      }

      if (!isMatchingFactoryCall(initializer, directNames, namespaceImportNames, 'contract')) {
        continue
      }

      results.push(toDiscoveredContract({
        filePath: exportedVariable.filePath,
        localName: exportedVariable.localName,
        exportNames: exportedVariable.exportNames,
        isDefaultExport: exportedVariable.isDefaultExport,
        runtimeName: getRuntimeName(initializer),
      }))
    }

    for (const exportedDefaultCall of collectDefaultExportedCallInfos(
      sourceFile,
      directNames,
      namespaceImportNames,
      'contract',
    )) {
      results.push(toDiscoveredContract({
        filePath: exportedDefaultCall.filePath,
        exportNames: exportedDefaultCall.exportNames,
        isDefaultExport: exportedDefaultCall.isDefaultExport,
        runtimeName: getRuntimeName(getCallExpressionFromExportAssignment(exportedDefaultCall.exportAssignment)),
      }))
    }
  }

  return results
}

export function discoverImplementations(
  project: Project,
  contracts: readonly DiscoveredContract[] = discoverContracts(project),
): DiscoveredImplementation[] {
  const indexes = buildContractIndexes(contracts)
  const results: DiscoveredImplementation[] = []

  for (const sourceFile of project.getSourceFiles()) {
    const directNames = getImportedFunctionLocalNames(sourceFile, 'implement')
    const namespaceImportNames = getNamespaceImportNames(sourceFile)

    for (const exportedVariable of collectExportedVariableInfos(sourceFile)) {
      const initializer = exportedVariable.declaration.getInitializer()
      if (!initializer || !Node.isCallExpression(initializer)) {
        continue
      }

      if (!isMatchingFactoryCall(initializer, directNames, namespaceImportNames, 'implement')) {
        continue
      }

      const contractArgument = initializer.getArguments()[0]
      const resolvedContract = contractArgument
        ? resolveContractReference(sourceFile, contractArgument, indexes)
        : null

      results.push(toDiscoveredImplementation({
        filePath: exportedVariable.filePath,
        localName: exportedVariable.localName,
        exportNames: exportedVariable.exportNames,
        isDefaultExport: exportedVariable.isDefaultExport,
        contract: resolvedContract,
      }))
    }

    for (const exportedDefaultCall of collectDefaultExportedCallInfos(
      sourceFile,
      directNames,
      namespaceImportNames,
      'implement',
    )) {
      const callExpression = getCallExpressionFromExportAssignment(exportedDefaultCall.exportAssignment)
      const contractArgument = callExpression.getArguments()[0]
      const resolvedContract = contractArgument
        ? resolveContractReference(sourceFile, contractArgument, indexes)
        : null

      results.push(toDiscoveredImplementation({
        filePath: exportedDefaultCall.filePath,
        exportNames: exportedDefaultCall.exportNames,
        isDefaultExport: exportedDefaultCall.isDefaultExport,
        contract: resolvedContract,
      }))
    }
  }

  return results
}

export function discoverProject(project: Project): DiscoveryResult {
  const contracts = discoverContracts(project)
  const implementations = discoverImplementations(project, contracts)

  return {
    contracts,
    implementations,
  }
}
