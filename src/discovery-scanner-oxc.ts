import {
  parseSync,
  type CallExpression,
  type Expression,
  type ParseResult,
  type ParserOptions,
  type Program,
} from 'oxc-parser'

import {
  analyzeDiscoveryWorkspaceWithAstScanner,
  createEmptyScannedContractClauseSummary,
  createWorkspaceDiscoveryBackend,
  summarizeScannedContractClauses,
  type DiscoveryAstScanner,
  type DiscoveryBackend,
  type DiscoveryParsedFile,
  type DiscoverySourceSpan,
  type DiscoveryWorkspace,
  type DiscoveryWorkspaceAnalysis,
  type ScannedContractCandidate,
  type ScannedContractClause,
  type ScannedContractReference,
  type ScannedDiscoveryDiagnostic,
  type ScannedExportBinding,
  type ScannedImportBinding,
  type ScannedImplementationCandidate,
  type ScannedSourceFile,
} from './discovery-backend.js'

export interface CreateOxcDiscoveryAstScannerOptions {
  readonly parserOptions?: Omit<ParserOptions, 'range'>
}

interface MutableExportedLocalBinding {
  readonly localName: string
  readonly exportNames: string[]
  readonly sourceSpan?: DiscoverySourceSpan
}

interface ExportedLocalBinding {
  readonly localName: string
  readonly export: ScannedExportBinding
}

interface VariableInitializerRecord {
  readonly localName: string
  readonly init: Expression
  readonly sourceSpan?: DiscoverySourceSpan
}

function toSourceSpan(value: { start: number; end: number } | null | undefined): DiscoverySourceSpan | undefined {
  if (!value) {
    return undefined
  }

  return {
    start: value.start,
    end: value.end,
  }
}

function withOptionalSpan<T extends object>(value: T, sourceSpan: DiscoverySourceSpan | undefined): T & { sourceSpan?: DiscoverySourceSpan } {
  if (sourceSpan === undefined) {
    return value
  }

  return {
    ...value,
    sourceSpan,
  }
}

function asExpressionArgument(argument: CallExpression['arguments'][number] | undefined): Expression | null {
  if (!argument || argument.type === 'SpreadElement') {
    return null
  }

  return argument
}

function unwrapExpression(expression: Expression): Expression {
  switch (expression.type) {
    case 'ParenthesizedExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'TSTypeAssertion':
      return unwrapExpression(expression.expression)
    default:
      return expression
  }
}

function asCallExpression(expression: Expression | null | undefined): CallExpression | null {
  if (!expression) {
    return null
  }

  const unwrapped = unwrapExpression(expression)
  return unwrapped.type === 'CallExpression' ? unwrapped : null
}

function getStaticMemberPropertyName(expression: Expression): string | undefined {
  const unwrapped = unwrapExpression(expression)
  if (unwrapped.type !== 'MemberExpression' || unwrapped.computed || unwrapped.property.type !== 'Identifier') {
    return undefined
  }

  return unwrapped.property.name
}

function getFactoryRootCall(
  callExpression: CallExpression,
  directNames: ReadonlySet<string>,
  namespaceImportNames: ReadonlySet<string>,
  expectedPropertyName: string,
): CallExpression | null {
  let current: CallExpression | null = callExpression

  while (current) {
    const callee = unwrapExpression(current.callee)

    if (callee.type === 'Identifier') {
      return directNames.has(callee.name) ? current : null
    }

    const propertyName = getStaticMemberPropertyName(callee)
    if (!propertyName || callee.type !== 'MemberExpression') {
      return null
    }

    const object = unwrapExpression(callee.object)
    if (object.type === 'Identifier' && namespaceImportNames.has(object.name) && propertyName === expectedPropertyName) {
      return current
    }

    if (object.type !== 'CallExpression') {
      return null
    }

    current = object
  }

  return null
}

function getStringArgumentValue(callExpression: CallExpression): string | undefined {
  const firstArgument = asExpressionArgument(callExpression.arguments[0])
  if (!firstArgument) {
    return undefined
  }

  const unwrapped = unwrapExpression(firstArgument)
  if (unwrapped.type === 'Literal' && typeof unwrapped.value === 'string') {
    return unwrapped.value
  }

  if (unwrapped.type === 'TemplateLiteral' && unwrapped.expressions.length === 0 && unwrapped.quasis.length === 1) {
    return unwrapped.quasis[0]?.value.cooked ?? unwrapped.quasis[0]?.value.raw ?? undefined
  }

  return undefined
}

function isClauseKind(name: string): name is ScannedContractClause['kind'] {
  return name === 'where' || name === 'pre' || name === 'post' || name === 'law' || name === 'example'
}

function collectContractClauses(expression: Expression): readonly ScannedContractClause[] {
  const clauses: ScannedContractClause[] = []
  let current = asCallExpression(expression)

  while (current) {
    const callee = unwrapExpression(current.callee)
    const propertyName = getStaticMemberPropertyName(callee)
    if (!propertyName || callee.type !== 'MemberExpression') {
      break
    }

    if (isClauseKind(propertyName)) {
      const clauseBase: {
        kind: ScannedContractClause['kind']
        argumentCount: number
        name?: string
      } = {
        kind: propertyName,
        argumentCount: current.arguments.length,
      }
      const clauseName = getStringArgumentValue(current)
      if (clauseName !== undefined) {
        clauseBase.name = clauseName
      }

      clauses.push(withOptionalSpan(clauseBase, toSourceSpan(current)))
    }

    current = asCallExpression(callee.object)
  }

  return Object.freeze(clauses.reverse())
}

function extractContractReference(expression: Expression | null | undefined): ScannedContractReference | null {
  if (!expression) {
    return null
  }

  const unwrapped = unwrapExpression(expression)
  if (unwrapped.type === 'Identifier') {
    return withOptionalSpan({
      kind: 'identifier' as const,
      name: unwrapped.name,
    }, toSourceSpan(unwrapped))
  }

  if (
    unwrapped.type === 'MemberExpression'
    && !unwrapped.computed
    && unwrapped.object.type === 'Identifier'
    && unwrapped.property.type === 'Identifier'
  ) {
    return withOptionalSpan({
      kind: 'namespace' as const,
      namespaceName: unwrapped.object.name,
      exportName: unwrapped.property.name,
    }, toSourceSpan(unwrapped))
  }

  return null
}

function createImportBindings(result: ParseResult): readonly ScannedImportBinding[] {
  const bindings: ScannedImportBinding[] = []

  for (const staticImport of result.module.staticImports) {
    for (const entry of staticImport.entries) {
      if (entry.isType) {
        continue
      }

      if (entry.importName.kind === 'Default') {
        bindings.push(withOptionalSpan({
          kind: 'default' as const,
          specifier: staticImport.moduleRequest.value,
          localName: entry.localName.value,
        }, toSourceSpan(entry.localName)))
        continue
      }

      if (entry.importName.kind === 'Name' && entry.importName.name) {
        bindings.push(withOptionalSpan({
          kind: 'named' as const,
          specifier: staticImport.moduleRequest.value,
          localName: entry.localName.value,
          importedName: entry.importName.name,
        }, toSourceSpan(entry.localName)))
        continue
      }

      if (entry.importName.kind === 'NamespaceObject') {
        bindings.push(withOptionalSpan({
          kind: 'namespace' as const,
          specifier: staticImport.moduleRequest.value,
          localName: entry.localName.value,
        }, toSourceSpan(entry.localName)))
      }
    }
  }

  return Object.freeze(bindings)
}

function collectFactoryLocalNames(imports: readonly ScannedImportBinding[], importedName: string): ReadonlySet<string> {
  const names = new Set<string>([importedName])

  for (const binding of imports) {
    if (binding.kind === 'named' && binding.importedName === importedName) {
      names.add(binding.localName)
    }
  }

  return names
}

function collectNamespaceImportNames(imports: readonly ScannedImportBinding[]): ReadonlySet<string> {
  const names = new Set<string>()

  for (const binding of imports) {
    if (binding.kind === 'namespace') {
      names.add(binding.localName)
    }
  }

  return names
}

function collectExportedLocalBindings(result: ParseResult): ReadonlyMap<string, ExportedLocalBinding> {
  const mutableBindings = new Map<string, MutableExportedLocalBinding>()

  for (const staticExport of result.module.staticExports) {
    for (const entry of staticExport.entries) {
      if (entry.isType || entry.moduleRequest !== null) {
        continue
      }

      if (entry.exportName.kind !== 'Name' || !entry.exportName.name) {
        continue
      }

      if (entry.localName.kind !== 'Name' || !entry.localName.name) {
        continue
      }

      const current = mutableBindings.get(entry.localName.name)
      if (current) {
        if (!current.exportNames.includes(entry.exportName.name)) {
          current.exportNames.push(entry.exportName.name)
        }
        continue
      }

      const bindingBase: {
        localName: string
        exportNames: string[]
        sourceSpan?: DiscoverySourceSpan
      } = {
        localName: entry.localName.name,
        exportNames: [entry.exportName.name],
      }
      const sourceSpan = toSourceSpan({ start: entry.start, end: entry.end })
      if (sourceSpan !== undefined) {
        bindingBase.sourceSpan = sourceSpan
      }

      mutableBindings.set(entry.localName.name, bindingBase)
    }
  }

  const bindings = new Map<string, ExportedLocalBinding>()
  for (const binding of mutableBindings.values()) {
    bindings.set(binding.localName, {
      localName: binding.localName,
      export: withOptionalSpan({
        localName: binding.localName,
        exportNames: Object.freeze([...binding.exportNames]),
        isDefaultExport: false,
      }, binding.sourceSpan),
    })
  }

  return bindings
}

function collectVariableInitializers(program: Program): ReadonlyMap<string, VariableInitializerRecord> {
  const initializers = new Map<string, VariableInitializerRecord>()

  for (const statement of program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration'
      ? statement.declaration
      : statement

    if (!declaration || declaration.type !== 'VariableDeclaration') {
      continue
    }

    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== 'Identifier' || !declarator.init) {
        continue
      }

      const initializerBase: {
        localName: string
        init: Expression
        sourceSpan?: DiscoverySourceSpan
      } = {
        localName: declarator.id.name,
        init: declarator.init,
      }
      const sourceSpan = toSourceSpan(declarator)
      if (sourceSpan !== undefined) {
        initializerBase.sourceSpan = sourceSpan
      }

      initializers.set(declarator.id.name, initializerBase)
    }
  }

  return initializers
}

function createDiagnostics(result: ParseResult): readonly ScannedDiscoveryDiagnostic[] {
  return Object.freeze(result.errors.map((error) => {
    const label = error.labels[0]
    const diagnosticBase: {
      severity: 'info' | 'warning'
      message: string
      sourceSpan?: DiscoverySourceSpan
    } = {
      severity: error.severity === 'Advice' ? 'info' : 'warning',
      message: error.message,
    }

    if (label) {
      diagnosticBase.sourceSpan = {
        start: label.start,
        end: label.end,
      }
    }

    return diagnosticBase
  }))
}

function createScannedContract(args: {
  filePath: string
  exportBinding: ScannedExportBinding
  rootCall: CallExpression
  fullExpression: Expression
  sourceSpan: DiscoverySourceSpan | undefined
}): ScannedContractCandidate {
  const clauses = collectContractClauses(args.fullExpression)
  const candidateBase: {
    kind: 'contract'
    filePath: string
    export: ScannedExportBinding
    runtimeName?: string
    clauses: readonly ScannedContractClause[]
    clauseSummary: ReturnType<typeof summarizeScannedContractClauses>
  } = {
    kind: 'contract',
    filePath: args.filePath,
    export: args.exportBinding,
    clauses,
    clauseSummary: clauses.length > 0
      ? summarizeScannedContractClauses(clauses)
      : createEmptyScannedContractClauseSummary(),
  }
  const runtimeName = getStringArgumentValue(args.rootCall)
  if (runtimeName !== undefined) {
    candidateBase.runtimeName = runtimeName
  }

  return withOptionalSpan(candidateBase, args.sourceSpan)
}

function createScannedImplementation(args: {
  filePath: string
  exportBinding: ScannedExportBinding
  rootCall: CallExpression
  sourceSpan: DiscoverySourceSpan | undefined
}): ScannedImplementationCandidate {
  return withOptionalSpan({
    kind: 'implementation',
    filePath: args.filePath,
    export: args.exportBinding,
    contractReference: extractContractReference(asExpressionArgument(args.rootCall.arguments[0])),
  }, args.sourceSpan)
}

function scanOxcParsedFile(file: DiscoveryParsedFile<ParseResult>): ScannedSourceFile {
  const imports = createImportBindings(file.ast)
  const contractFactoryNames = collectFactoryLocalNames(imports, 'contract')
  const implementFactoryNames = collectFactoryLocalNames(imports, 'implement')
  const namespaceImportNames = collectNamespaceImportNames(imports)
  const exportedLocals = collectExportedLocalBindings(file.ast)
  const variableInitializers = collectVariableInitializers(file.ast.program)
  const contracts: ScannedContractCandidate[] = []
  const implementations: ScannedImplementationCandidate[] = []

  for (const exportedLocal of exportedLocals.values()) {
    const initializerRecord = variableInitializers.get(exportedLocal.localName)
    const callExpression = asCallExpression(initializerRecord?.init)
    if (!callExpression || !initializerRecord) {
      continue
    }

    const contractRoot = getFactoryRootCall(callExpression, contractFactoryNames, namespaceImportNames, 'contract')
    if (contractRoot) {
      contracts.push(createScannedContract({
        filePath: file.filePath,
        exportBinding: exportedLocal.export,
        rootCall: contractRoot,
        fullExpression: initializerRecord.init,
        sourceSpan: initializerRecord.sourceSpan ?? toSourceSpan(callExpression),
      }))
      continue
    }

    const implementRoot = getFactoryRootCall(callExpression, implementFactoryNames, namespaceImportNames, 'implement')
    if (implementRoot) {
      implementations.push(createScannedImplementation({
        filePath: file.filePath,
        exportBinding: exportedLocal.export,
        rootCall: implementRoot,
        sourceSpan: initializerRecord.sourceSpan ?? toSourceSpan(callExpression),
      }))
    }
  }

  for (const statement of file.ast.program.body) {
    if (statement.type !== 'ExportDefaultDeclaration') {
      continue
    }

    const declaration = statement.declaration
    if (!declaration || typeof declaration !== 'object' || !('type' in declaration)) {
      continue
    }

    const callExpression = asCallExpression(declaration as Expression)
    if (!callExpression) {
      continue
    }

    const exportBinding = withOptionalSpan({
      exportNames: Object.freeze(['default']),
      isDefaultExport: true,
    }, toSourceSpan(statement))

    const contractRoot = getFactoryRootCall(callExpression, contractFactoryNames, namespaceImportNames, 'contract')
    if (contractRoot) {
      contracts.push(createScannedContract({
        filePath: file.filePath,
        exportBinding,
        rootCall: contractRoot,
        fullExpression: declaration as Expression,
        sourceSpan: toSourceSpan(declaration as Expression) ?? toSourceSpan(statement),
      }))
      continue
    }

    const implementRoot = getFactoryRootCall(callExpression, implementFactoryNames, namespaceImportNames, 'implement')
    if (implementRoot) {
      implementations.push(createScannedImplementation({
        filePath: file.filePath,
        exportBinding,
        rootCall: implementRoot,
        sourceSpan: toSourceSpan(declaration as Expression) ?? toSourceSpan(statement),
      }))
    }
  }

  return {
    filePath: file.filePath,
    imports,
    contracts: Object.freeze(contracts),
    implementations: Object.freeze(implementations),
    diagnostics: createDiagnostics(file.ast),
  }
}

export function createOxcDiscoveryAstScanner(
  options: CreateOxcDiscoveryAstScannerOptions = {},
): DiscoveryAstScanner<ParseResult> {
  return {
    name: 'oxc',
    parse(filePath, text) {
      return parseSync(filePath, text, {
        sourceType: 'module',
        preserveParens: true,
        ...options.parserOptions,
        range: true,
      })
    },
    scanParsedFile: scanOxcParsedFile,
  }
}

export function analyzeOxcDiscoveryWorkspace(
  workspace: DiscoveryWorkspace,
  options: CreateOxcDiscoveryAstScannerOptions = {},
): DiscoveryWorkspaceAnalysis {
  return analyzeDiscoveryWorkspaceWithAstScanner(workspace, createOxcDiscoveryAstScanner(options))
}

export function createOxcDiscoveryBackend(
  options: CreateOxcDiscoveryAstScannerOptions = {},
): DiscoveryBackend<DiscoveryWorkspace> {
  return createWorkspaceDiscoveryBackend({
    name: 'oxc',
    scanner: createOxcDiscoveryAstScanner(options),
    capabilities: {
      supportsTsConfigProjects: false,
      supportsModuleResolution: true,
      supportsSourceTextWorkspaces: true,
      preservesOperationalImports: true,
      intendedConsumers: ['library', 'agent-tool'],
    },
  })
}
