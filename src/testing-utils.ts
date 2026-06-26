import * as fc from 'fast-check'

import type {
  AnySchema,
  ContractLike,
  ContractInput,
  FieldRef,
  InferLawVars,
  LawVarSchemas,
  MaybePromise,
  PreClause,
  WhereClause,
} from './contract.js'

interface ZodDefLike {
  readonly type?: string
  readonly checks?: readonly unknown[]
  readonly shape?: (() => Record<string, AnySchema>) | Record<string, AnySchema>
  readonly innerType?: AnySchema
  readonly options?: readonly AnySchema[]
  readonly element?: AnySchema
  readonly items?: readonly AnySchema[]
  readonly valueType?: AnySchema
}

function isFieldRef(value: unknown): value is FieldRef {
  return !!value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'field-ref'
}

function getSchemaDef(schema: AnySchema): ZodDefLike {
  return (((schema as any)?._zod?.def ?? (schema as any)?.def) ?? {}) as ZodDefLike
}

function isOptionalSchema(schema: AnySchema): boolean {
  return getSchemaDef(schema).type === 'optional'
}

function getShape(schema: AnySchema): Record<string, AnySchema> {
  const def = getSchemaDef(schema)
  if (typeof def.shape === 'function') {
    return def.shape()
  }

  if (def.shape && typeof def.shape === 'object') {
    return def.shape
  }

  return ((schema as any).shape ?? {}) as Record<string, AnySchema>
}

function getPathValue(target: unknown, path: string): unknown {
  const segments = path.split('.').filter(Boolean)
  let current = target as any

  for (const segment of segments) {
    if (current == null) {
      return undefined
    }

    current = current[segment]
  }

  return current
}

function resolveWhereValue(root: unknown, value: unknown | FieldRef): unknown {
  if (isFieldRef(value)) {
    return getPathValue(root, value.path)
  }

  return value
}

function compareValues(left: unknown, operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte', right: unknown): boolean {
  switch (operator) {
    case 'eq':
      return Object.is(left, right)
    case 'ne':
      return !Object.is(left, right)
    case 'lt':
      return typeof left === 'number' && typeof right === 'number' && left < right
    case 'lte':
      return typeof left === 'number' && typeof right === 'number' && left <= right
    case 'gt':
      return typeof left === 'number' && typeof right === 'number' && left > right
    case 'gte':
      return typeof left === 'number' && typeof right === 'number' && left >= right
  }
}

export function evaluateWhereClause(root: unknown, clause: WhereClause): boolean {
  switch (clause.kind) {
    case 'comparison': {
      const left = getPathValue(root, clause.left.path)
      const right = resolveWhereValue(root, clause.right)
      return compareValues(left, clause.operator, right)
    }
    case 'presence': {
      const value = getPathValue(root, clause.field.path)
      return clause.operator === 'defined' ? value !== undefined : value === undefined
    }
    case 'exactly-one': {
      const count = clause.fields.reduce((total, path) => {
        return getPathValue(root, path) !== undefined ? total + 1 : total
      }, 0)
      return count === 1
    }
    case 'unique-by': {
      const value = getPathValue(root, clause.path)
      if (!Array.isArray(value)) {
        return false
      }

      const seen = new Set<unknown>()
      for (const item of value) {
        const keyValue = item != null && typeof item === 'object' ? (item as Record<string, unknown>)[clause.key] : undefined
        if (seen.has(keyValue)) {
          return false
        }
        seen.add(keyValue)
      }
      return true
    }
    case 'non-empty': {
      const value = getPathValue(root, clause.path)
      if (typeof value === 'string' || Array.isArray(value)) {
        return value.length > 0
      }
      if (value && typeof value === 'object') {
        return Object.keys(value).length > 0
      }
      return false
    }
  }
}

function getCheckDef(check: unknown): Record<string, unknown> {
  return (((check as any)?._zod?.def ?? (check as any)?.def) ?? {}) as Record<string, unknown>
}

function getChecks(schema: AnySchema): readonly unknown[] {
  return (getSchemaDef(schema).checks ?? []) as readonly unknown[]
}

function getMinLength(schema: AnySchema): number | undefined {
  if ((schema as any).minLength != null) {
    return (schema as any).minLength as number
  }

  for (const check of getChecks(schema)) {
    const def = getCheckDef(check)
    if (def.check === 'min_length' && typeof def.minimum === 'number') {
      return def.minimum
    }
  }

  return undefined
}

function getMaxLength(schema: AnySchema): number | undefined {
  if ((schema as any).maxLength != null) {
    return (schema as any).maxLength as number
  }

  for (const check of getChecks(schema)) {
    const def = getCheckDef(check)
    if (def.check === 'max_length' && typeof def.maximum === 'number') {
      return def.maximum
    }
  }

  return undefined
}

function getNumericBounds(schema: AnySchema): { min?: number; max?: number; integer: boolean } {
  const baseSchema = schema as any
  let min = Number.isFinite(baseSchema.minValue) ? (baseSchema.minValue as number) : undefined
  let max = Number.isFinite(baseSchema.maxValue) ? (baseSchema.maxValue as number) : undefined
  let integer = !!baseSchema.isInt || baseSchema.format === 'safeint'

  for (const check of getChecks(schema)) {
    const def = getCheckDef(check)

    if (def.check === 'greater_than' && typeof def.value === 'number') {
      const candidate = def.inclusive === true ? def.value : def.value + 1
      min = min == null ? candidate : Math.max(min, candidate)
    }

    if (def.check === 'less_than' && typeof def.value === 'number') {
      const candidate = def.inclusive === true ? def.value : def.value - 1
      max = max == null ? candidate : Math.min(max, candidate)
    }

    if (def.check === 'number_format' && def.format === 'safeint') {
      integer = true
    }
  }

  const bounds: { min?: number; max?: number; integer: boolean } = { integer }
  if (min !== undefined) {
    bounds.min = min
  }
  if (max !== undefined) {
    bounds.max = max
  }
  return bounds
}

function withSchemaFilter<T>(schema: AnySchema, arbitrary: fc.Arbitrary<T>): fc.Arbitrary<T> {
  return arbitrary.filter((value) => schema.safeParse(value).success)
}

function arbitraryForString(schema: AnySchema): fc.Arbitrary<string> {
  const stringSchema = schema as any
  const minLength = Math.max(0, getMinLength(schema) ?? 0)
  const rawMaxLength = getMaxLength(schema)
  const maxLength = Math.max(minLength, Math.min(rawMaxLength ?? 32, 128))

  if (stringSchema.format === 'email') {
    return withSchemaFilter(schema, fc.emailAddress())
  }

  if (stringSchema.format === 'uuid' || stringSchema.format === 'guid') {
    return withSchemaFilter(schema, fc.uuid())
  }

  return withSchemaFilter(schema, fc.string({ minLength, maxLength }))
}

function arbitraryForNumber(schema: AnySchema): fc.Arbitrary<number> {
  const bounds = getNumericBounds(schema)
  const min = Math.max(bounds.min ?? -1000, -1_000_000)
  const max = Math.min(bounds.max ?? 1000, 1_000_000)

  if (bounds.integer) {
    return withSchemaFilter(
      schema,
      fc.integer({
        min: Math.ceil(min),
        max: Math.floor(max),
      }),
    )
  }

  return withSchemaFilter(
    schema,
    fc.double({
      min,
      max,
      noNaN: true,
      noDefaultInfinity: true,
    }),
  )
}

function arbitraryForArray(schema: AnySchema, depth: number): fc.Arbitrary<unknown[]> {
  const def = getSchemaDef(schema)
  const element = def.element
  if (!element) {
    return withSchemaFilter(schema, fc.array(fc.anything({ maxDepth: 1 }), { maxLength: 4 }))
  }

  const minLength = Math.max(0, getMinLength(schema) ?? 0)
  const rawMaxLength = getMaxLength(schema)
  const maxLength = Math.max(minLength, Math.min(rawMaxLength ?? 4, 12))

  return withSchemaFilter(
    schema,
    fc.array(arbitraryFromSchema(element, depth + 1), {
      minLength,
      maxLength,
    }),
  )
}

function arbitraryForTuple(schema: AnySchema, depth: number): fc.Arbitrary<unknown[]> {
  const def = getSchemaDef(schema)
  const items = def.items ?? []
  const tupleArbs = items.map((item) => arbitraryFromSchema(item, depth + 1))
  return withSchemaFilter(schema, fc.tuple(...tupleArbs))
}

function arbitraryForObject(schema: AnySchema, depth: number): fc.Arbitrary<Record<string, unknown>> {
  const shape = getShape(schema)
  const entries = Object.entries(shape)
  const recordModel: Record<string, fc.Arbitrary<unknown>> = {}

  for (const [key, childSchema] of entries) {
    if (isOptionalSchema(childSchema)) {
      const inner = getSchemaDef(childSchema).innerType
      recordModel[key] = inner
        ? fc.oneof(fc.constant(undefined), arbitraryFromSchema(inner, depth + 1))
        : fc.constant(undefined)
    } else {
      recordModel[key] = arbitraryFromSchema(childSchema, depth + 1)
    }
  }

  return withSchemaFilter(
    schema,
    fc.record(recordModel).map((value) => {
      const normalized: Record<string, unknown> = {}
      for (const [key, childSchema] of entries) {
        const item = value[key]
        if (isOptionalSchema(childSchema) && item === undefined) {
          continue
        }
        normalized[key] = item
      }
      return normalized
    }),
  )
}

function arbitraryForRecord(schema: AnySchema, depth: number): fc.Arbitrary<Record<string, unknown>> {
  const def = getSchemaDef(schema)
  const valueType = def.valueType

  return withSchemaFilter(
    schema,
    fc.dictionary(
      fc.string({ minLength: 1, maxLength: 12 }),
      valueType ? arbitraryFromSchema(valueType, depth + 1) : fc.anything({ maxDepth: 1 }),
      { maxKeys: 6 },
    ),
  )
}

function arbitraryForUnion(schema: AnySchema, depth: number): fc.Arbitrary<unknown> {
  const options = getSchemaDef(schema).options ?? []
  if (options.length === 0) {
    return withSchemaFilter(schema, fc.anything({ maxDepth: 2 }))
  }

  const arbs = options.map((option) => arbitraryFromSchema(option, depth + 1))
  return withSchemaFilter(schema, fc.oneof(...arbs))
}

function arbitraryForLiteral(schema: AnySchema): fc.Arbitrary<unknown> {
  const values = [...((((schema as any).values ?? (getSchemaDef(schema) as any).values) ?? []) as Iterable<unknown>)]
  if (values.length === 0) {
    return withSchemaFilter(schema, fc.constant(undefined))
  }
  return withSchemaFilter(schema, fc.constantFrom(...values))
}

function arbitraryForEnum(schema: AnySchema): fc.Arbitrary<unknown> {
  const options = (((schema as any).options ?? []) as readonly unknown[])
  if (options.length === 0) {
    return withSchemaFilter(schema, fc.constant(undefined))
  }
  return withSchemaFilter(schema, fc.constantFrom(...options))
}

export function arbitraryFromSchema(schema: AnySchema, depth = 0): fc.Arbitrary<any> {
  if (depth > 4) {
    return withSchemaFilter(schema, fc.anything({ maxDepth: 1 }))
  }

  const def = getSchemaDef(schema)

  switch (def.type) {
    case 'string':
      return arbitraryForString(schema)
    case 'number':
      return arbitraryForNumber(schema)
    case 'boolean':
      return withSchemaFilter(schema, fc.boolean())
    case 'literal':
      return arbitraryForLiteral(schema)
    case 'enum':
      return arbitraryForEnum(schema)
    case 'object':
      return arbitraryForObject(schema, depth)
    case 'array':
      return arbitraryForArray(schema, depth)
    case 'tuple':
      return arbitraryForTuple(schema, depth)
    case 'record':
      return arbitraryForRecord(schema, depth)
    case 'union':
      return arbitraryForUnion(schema, depth)
    case 'optional': {
      const inner = def.innerType
      return inner
        ? withSchemaFilter(schema, fc.oneof(fc.constant(undefined), arbitraryFromSchema(inner, depth + 1)))
        : withSchemaFilter(schema, fc.constant(undefined))
    }
    case 'nullable': {
      const inner = def.innerType
      return inner
        ? withSchemaFilter(schema, fc.oneof(fc.constant(null), arbitraryFromSchema(inner, depth + 1)))
        : withSchemaFilter(schema, fc.constant(null))
    }
    default:
      return withSchemaFilter(schema, fc.anything({ maxDepth: 2 }))
  }
}

export function lawVarsArbitrary<V extends LawVarSchemas>(vars: V): fc.Arbitrary<InferLawVars<V>> {
  const entries = Object.entries(vars) as [keyof V, AnySchema][]
  if (entries.length === 0) {
    return fc.constant({} as InferLawVars<V>)
  }

  const valuesArb = fc.tuple(...entries.map(([, schema]) => arbitraryFromSchema(schema)))
  return valuesArb.map((values) => {
    const result: Record<string, unknown> = {}
    entries.forEach(([key], index) => {
      result[key as string] = values[index]
    })
    return result as InferLawVars<V>
  })
}

export function validInputArbitrary<C extends ContractLike>(
  contract: C,
  wheres: readonly WhereClause[],
): fc.Arbitrary<ContractInput<C>> {
  return arbitraryFromSchema(contract.input).filter((input) => {
    if (!contract.input.safeParse(input).success) {
      return false
    }

    const root = { input }
    return wheres.every((clause) => evaluateWhereClause(root, clause))
  }) as fc.Arbitrary<ContractInput<C>>
}

export async function assertSchema(schema: AnySchema, value: unknown, label: string): Promise<void> {
  const result = await schema.safeParseAsync(value)
  if (!result.success) {
    throw new Error(`${label} failed schema validation: ${result.error.message}`)
  }
}

export async function assertPredicateResult(
  label: string,
  result: MaybePromise<boolean | void>,
): Promise<void> {
  const resolved = await result
  if (resolved === false) {
    throw new Error(label)
  }
}

export async function preconditionsHold<C extends ContractLike>(
  contract: C,
  pres: readonly PreClause<C>[],
  input: ContractInput<C>,
): Promise<boolean> {
  for (const pre of pres) {
    const result = await pre.predicate({ contract, input })
    if (result === false) {
      return false
    }
  }

  return true
}

export async function validateExampleInput<C extends ContractLike>(
  contract: C,
  wheres: readonly WhereClause[],
  pres: readonly PreClause<C>[],
  input: ContractInput<C>,
): Promise<void> {
  await assertSchema(contract.input, input, 'example input')

  const root = { input }
  for (const clause of wheres) {
    if (!evaluateWhereClause(root, clause)) {
      throw new Error(`example input violated where-clause: ${clause.kind}`)
    }
  }

  const presOkay = await preconditionsHold(contract, pres, input)
  if (!presOkay) {
    throw new Error('example input violated a precondition')
  }
}

export function fcOptions(options: { readonly numRuns?: number; readonly seed?: number }): { numRuns: number; seed?: number } {
  const params: { numRuns: number; seed?: number } = {
    numRuns: options.numRuns ?? 100,
  }

  if (options.seed !== undefined) {
    params.seed = options.seed
  }

  return params
}
