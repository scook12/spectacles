import { z } from 'zod'

export type AnySchema = z.ZodTypeAny
export type Infer<S extends AnySchema> = z.infer<S>
export type MaybePromise<T> = T | Promise<T>

export type LawVarSchemas = Record<string, AnySchema>
export type InferLawVars<V extends LawVarSchemas> = {
  [K in keyof V]: Infer<V[K]>
}

export type ComparisonOperator = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'
export type PresenceOperator = 'defined' | 'undefined'

export interface BaseWhereClause {
  readonly kind: string
  readonly description?: string
}

export interface FieldRef<Path extends string = string> {
  readonly kind: 'field-ref'
  readonly path: Path

  eq(value: unknown | FieldRef): ComparisonWhereClause
  ne(value: unknown | FieldRef): ComparisonWhereClause

  lt(value: number | FieldRef): ComparisonWhereClause
  lte(value: number | FieldRef): ComparisonWhereClause
  gt(value: number | FieldRef): ComparisonWhereClause
  gte(value: number | FieldRef): ComparisonWhereClause

  defined(): PresenceWhereClause
  undefined(): PresenceWhereClause
}

export interface ComparisonWhereClause extends BaseWhereClause {
  readonly kind: 'comparison'
  readonly left: FieldRef
  readonly operator: ComparisonOperator
  readonly right: unknown | FieldRef
}

export interface PresenceWhereClause extends BaseWhereClause {
  readonly kind: 'presence'
  readonly field: FieldRef
  readonly operator: PresenceOperator
}

export interface ExactlyOneWhereClause extends BaseWhereClause {
  readonly kind: 'exactly-one'
  readonly fields: readonly string[]
}

export interface UniqueByWhereClause extends BaseWhereClause {
  readonly kind: 'unique-by'
  readonly path: string
  readonly key: string
}

export interface NonEmptyWhereClause extends BaseWhereClause {
  readonly kind: 'non-empty'
  readonly path: string
}

export type WhereClause =
  | ComparisonWhereClause
  | PresenceWhereClause
  | ExactlyOneWhereClause
  | UniqueByWhereClause
  | NonEmptyWhereClause

export interface ContractLike {
  readonly args: AnySchema
  readonly returns: AnySchema
  readonly input?: AnySchema | undefined
  readonly output: AnySchema
  readonly argNames?: readonly string[] | undefined
}

export type ContractArgs<C extends ContractLike> = Infer<C['args']> extends readonly unknown[] ? Infer<C['args']> : never
export type ContractReturn<C extends ContractLike> = Infer<C['returns']>
export type ContractInput<C extends ContractLike> = ContractArgs<C> extends readonly [infer Only] ? Only : never
export type ContractOutput<C extends ContractLike> = ContractReturn<C>

export type UnaryInputAlias<C extends ContractLike> = ContractArgs<C> extends readonly [infer Only]
  ? { readonly input: Only }
  : {}

export interface Contract<
  Name extends string = string,
  ArgsSchema extends AnySchema = AnySchema,
  ReturnSchema extends AnySchema = AnySchema,
  InputSchema extends AnySchema | undefined = AnySchema | undefined,
> {
  readonly kind: 'contract'
  readonly name: Name
  readonly args: ArgsSchema
  readonly returns: ReturnSchema
  readonly input?: InputSchema
  readonly output: ReturnSchema
  readonly argNames?: readonly string[]

  readonly wheres: readonly WhereClause[]
  readonly pres: readonly PreClause<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>>[]
  readonly posts: readonly PostClause<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>>[]
  readonly laws: readonly LawClause<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>, any>[]
  readonly examples: readonly ExampleClause<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>>[]

  where(...clauses: readonly WhereClause[]): Contract<Name, ArgsSchema, ReturnSchema, InputSchema>

  pre(
    name: string,
    predicate: PrePredicate<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>>,
  ): Contract<Name, ArgsSchema, ReturnSchema, InputSchema>

  post(
    name: string,
    predicate: PostPredicate<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>>,
  ): Contract<Name, ArgsSchema, ReturnSchema, InputSchema>

  law<V extends LawVarSchemas>(
    name: string,
    vars: V,
    predicate: LawPredicate<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>, V>,
  ): Contract<Name, ArgsSchema, ReturnSchema, InputSchema>

  example(
    name: string,
    example: ExampleCase<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>>,
  ): Contract<Name, ArgsSchema, ReturnSchema, InputSchema>
}

export type AnyContract = Contract<any, AnySchema, AnySchema, AnySchema | undefined>

export type ImplementationFn<C extends ContractLike> = (
  ...args: ContractArgs<C>
) => MaybePromise<ContractReturn<C>>

export type PreContext<C extends ContractLike> = {
  readonly contract: C
  readonly args: ContractArgs<C>
} & UnaryInputAlias<C>

export type PostContext<C extends ContractLike> = {
  readonly contract: C
  readonly args: ContractArgs<C>
  readonly result: ContractReturn<C>
  readonly output: ContractReturn<C>
} & UnaryInputAlias<C>

export type LawContext<C extends ContractLike, V extends LawVarSchemas> = {
  readonly contract: C
  readonly args: ContractArgs<C>
  readonly impl: ImplementationFn<C>
} & UnaryInputAlias<C> & InferLawVars<V>

export type PrePredicate<C extends ContractLike> = (
  ctx: PreContext<C>,
) => MaybePromise<boolean | void>

export type PostPredicate<C extends ContractLike> = (
  ctx: PostContext<C>,
) => MaybePromise<boolean | void>

export type LawPredicate<
  C extends ContractLike,
  V extends LawVarSchemas = LawVarSchemas,
> = (ctx: LawContext<C, V>) => MaybePromise<boolean | void>

export type VariadicExampleCase<C extends ContractLike> = {
  readonly args: ContractArgs<C>
  readonly result?: ContractReturn<C>
}

export type UnaryExampleCase<C extends ContractLike> = ContractArgs<C> extends readonly [infer Only]
  ? {
      readonly input: Only
      readonly output?: ContractReturn<C>
    }
  : never

export type ExampleCase<C extends ContractLike> = VariadicExampleCase<C> | UnaryExampleCase<C>

export interface NormalizedExampleCase<C extends ContractLike> {
  readonly args: ContractArgs<C>
  readonly result?: ContractReturn<C>
}

export interface PreClause<C extends ContractLike> {
  readonly kind: 'pre'
  readonly name: string
  readonly predicate: PrePredicate<C>
}

export interface PostClause<C extends ContractLike> {
  readonly kind: 'post'
  readonly name: string
  readonly predicate: PostPredicate<C>
}

export interface LawClause<
  C extends ContractLike,
  V extends LawVarSchemas = LawVarSchemas,
> {
  readonly kind: 'law'
  readonly name: string
  readonly vars: V
  readonly predicate: LawPredicate<C, V>
}

export interface ExampleClause<C extends ContractLike> {
  readonly kind: 'example'
  readonly name: string
  readonly example: ExampleCase<C>
}

export interface UnaryContractSpec<
  InSchema extends AnySchema,
  OutSchema extends AnySchema,
> {
  readonly input: InSchema
  readonly output: OutSchema
}

export interface VariadicContractSpec<
  ArgsSchema extends AnySchema,
  ReturnSchema extends AnySchema,
> {
  readonly args: ArgsSchema
  readonly returns: ReturnSchema
  readonly argNames?: readonly string[]
}

export type ContractSpec<
  InSchema extends AnySchema,
  OutSchema extends AnySchema,
  ArgsSchema extends AnySchema = z.ZodTuple<[InSchema], null>,
  ReturnSchema extends AnySchema = OutSchema,
> = UnaryContractSpec<InSchema, OutSchema> | VariadicContractSpec<ArgsSchema, ReturnSchema>

export type AnyContractSpec = UnaryContractSpec<AnySchema, AnySchema> | VariadicContractSpec<AnySchema, AnySchema>

export type ContractFromSpec<Name extends string, Spec extends AnyContractSpec> =
  Spec extends UnaryContractSpec<infer InSchema, infer OutSchema>
    ? Contract<Name, z.ZodTuple<[InSchema], null>, OutSchema, InSchema>
    : Spec extends VariadicContractSpec<infer ArgsSchema, infer ReturnSchema>
      ? Contract<Name, ArgsSchema, ReturnSchema, AnySchema | undefined>
      : never

export type BoundImplementation<C extends ContractLike> =
  & ImplementationFn<C>
  & {
    readonly [IMPLEMENTS]: C
  }

interface NormalizedContractSpec<
  ArgsSchema extends AnySchema,
  ReturnSchema extends AnySchema,
  InputSchema extends AnySchema | undefined,
> {
  readonly args: ArgsSchema
  readonly returns: ReturnSchema
  readonly input?: InputSchema
  readonly output: ReturnSchema
  readonly argNames?: readonly string[]
}

interface ContractState<
  Name extends string,
  ArgsSchema extends AnySchema,
  ReturnSchema extends AnySchema,
  InputSchema extends AnySchema | undefined,
> {
  readonly wheres: readonly WhereClause[]
  readonly pres: readonly PreClause<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>>[]
  readonly posts: readonly PostClause<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>>[]
  readonly laws: readonly LawClause<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>, any>[]
  readonly examples: readonly ExampleClause<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>>[]
}

export const IMPLEMENTS: unique symbol = Symbol.for('@spectacles/implements') as any

function freezeArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values])
}

function comparisonClause(
  left: FieldRef,
  operator: ComparisonOperator,
  right: unknown | FieldRef,
): ComparisonWhereClause {
  return Object.freeze({
    kind: 'comparison',
    left,
    operator,
    right,
  })
}

function presenceClause(
  fieldRef: FieldRef,
  operator: PresenceOperator,
): PresenceWhereClause {
  return Object.freeze({
    kind: 'presence',
    field: fieldRef,
    operator,
  })
}

function isContract(value: unknown): value is AnyContract {
  return !!value && typeof value === 'object' && (value as { kind?: unknown }).kind === 'contract'
}

function isUnaryContractSpec(value: unknown): value is UnaryContractSpec<AnySchema, AnySchema> {
  return !!value && typeof value === 'object' && 'input' in (value as object) && 'output' in (value as object)
}

function isVariadicContractSpec(value: unknown): value is VariadicContractSpec<AnySchema, AnySchema> {
  return !!value && typeof value === 'object' && 'args' in (value as object) && 'returns' in (value as object)
}

export function field<Path extends string>(path: Path): FieldRef<Path> {
  const ref: FieldRef<Path> = {
    kind: 'field-ref',
    path,

    eq(value) {
      return comparisonClause(ref, 'eq', value)
    },

    ne(value) {
      return comparisonClause(ref, 'ne', value)
    },

    lt(value) {
      return comparisonClause(ref, 'lt', value)
    },

    lte(value) {
      return comparisonClause(ref, 'lte', value)
    },

    gt(value) {
      return comparisonClause(ref, 'gt', value)
    },

    gte(value) {
      return comparisonClause(ref, 'gte', value)
    },

    defined() {
      return presenceClause(ref, 'defined')
    },

    undefined() {
      return presenceClause(ref, 'undefined')
    },
  }

  return Object.freeze(ref)
}

export function arg(indexOrName: number | string, path?: string): FieldRef {
  const basePath = `args.${indexOrName}`
  return field(path ? `${basePath}.${path}` : basePath)
}

export function exactlyOne(...paths: readonly string[]): ExactlyOneWhereClause {
  return Object.freeze({
    kind: 'exactly-one',
    fields: Object.freeze([...paths]),
  })
}

export function uniqueBy(path: string, key: string): UniqueByWhereClause {
  return Object.freeze({
    kind: 'unique-by',
    path,
    key,
  })
}

export function nonEmpty(path: string): NonEmptyWhereClause {
  return Object.freeze({
    kind: 'non-empty',
    path,
  })
}

export function normalizeExampleCase<C extends ContractLike>(example: ExampleCase<C>): NormalizedExampleCase<C> {
  if ('args' in example) {
    return {
      args: example.args,
      ...(example.result !== undefined ? { result: example.result } : {}),
    } as NormalizedExampleCase<C>
  }

  return {
    args: [example.input] as ContractArgs<C>,
    ...(example.output !== undefined ? { result: example.output } : {}),
  } as NormalizedExampleCase<C>
}

function normalizeContractSpec<
  InSchema extends AnySchema,
  OutSchema extends AnySchema,
  ArgsSchema extends AnySchema,
  ReturnSchema extends AnySchema,
>(
  spec: ContractSpec<InSchema, OutSchema, ArgsSchema, ReturnSchema>,
): NormalizedContractSpec<AnySchema, AnySchema, AnySchema | undefined> {
  if (isUnaryContractSpec(spec)) {
    return {
      args: z.tuple([spec.input]) as z.ZodTuple<[typeof spec.input], null>,
      returns: spec.output,
      input: spec.input,
      output: spec.output,
    }
  }

  return {
    args: spec.args,
    returns: spec.returns,
    output: spec.returns,
    ...(spec.argNames !== undefined ? { argNames: Object.freeze([...spec.argNames]) } : {}),
  }
}

function createContract<
  const Name extends string,
  ArgsSchema extends AnySchema,
  ReturnSchema extends AnySchema,
  InputSchema extends AnySchema | undefined,
>(
  name: Name,
  spec: NormalizedContractSpec<ArgsSchema, ReturnSchema, InputSchema>,
  state?: ContractState<Name, ArgsSchema, ReturnSchema, InputSchema>,
): Contract<Name, ArgsSchema, ReturnSchema, InputSchema> {
  const nextState: ContractState<Name, ArgsSchema, ReturnSchema, InputSchema> = state ?? {
    wheres: [],
    pres: [],
    posts: [],
    laws: [],
    examples: [],
  }

  const contractValue: Contract<Name, ArgsSchema, ReturnSchema, InputSchema> = {
    kind: 'contract',
    name,
    args: spec.args,
    returns: spec.returns,
    output: spec.output,
    ...(spec.input !== undefined ? { input: spec.input } : {}),
    ...(spec.argNames !== undefined ? { argNames: spec.argNames } : {}),

    wheres: freezeArray(nextState.wheres),
    pres: freezeArray(nextState.pres),
    posts: freezeArray(nextState.posts),
    laws: freezeArray(nextState.laws),
    examples: freezeArray(nextState.examples),

    where(...clauses) {
      return createContract(name, spec, {
        ...nextState,
        wheres: [...nextState.wheres, ...clauses],
      })
    },

    pre(clauseName, predicate) {
      return createContract(name, spec, {
        ...nextState,
        pres: [
          ...nextState.pres,
          Object.freeze({
            kind: 'pre',
            name: clauseName,
            predicate,
          }),
        ],
      })
    },

    post(clauseName, predicate) {
      return createContract(name, spec, {
        ...nextState,
        posts: [
          ...nextState.posts,
          Object.freeze({
            kind: 'post',
            name: clauseName,
            predicate,
          }),
        ],
      })
    },

    law<V extends LawVarSchemas>(
      clauseName: string,
      vars: V,
      predicate: LawPredicate<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>, V>,
    ) {
      return createContract(name, spec, {
        ...nextState,
        laws: [
          ...nextState.laws,
          Object.freeze({
            kind: 'law',
            name: clauseName,
            vars,
            predicate,
          }),
        ],
      })
    },

    example(clauseName, example) {
      return createContract(name, spec, {
        ...nextState,
        examples: [
          ...nextState.examples,
          Object.freeze({
            kind: 'example',
            name: clauseName,
            example,
          }),
        ],
      })
    },
  }

  return Object.freeze(contractValue)
}

export function contract<
  const Name extends string,
  Spec extends AnyContractSpec,
>(
  name: Name,
  spec: Spec,
): ContractFromSpec<Name, Spec> {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('contract(name, spec): name must be a non-empty string')
  }

  if (!spec || typeof spec !== 'object') {
    throw new TypeError('contract(name, spec): spec must be an object')
  }

  if (!isUnaryContractSpec(spec) && !isVariadicContractSpec(spec)) {
    throw new TypeError('contract(name, spec): spec must include input/output or args/returns schemas')
  }

  return createContract(name, normalizeContractSpec(spec)) as ContractFromSpec<Name, Spec>
}

export function implement<
  const Name extends string,
  ArgsSchema extends AnySchema,
  ReturnSchema extends AnySchema,
  InputSchema extends AnySchema | undefined,
>(
  contractValue: Contract<Name, ArgsSchema, ReturnSchema, InputSchema>,
  fn: ImplementationFn<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>>,
): BoundImplementation<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>> {
  if (!isContract(contractValue)) {
    throw new TypeError('implement(contract, fn): contract must be a contract created by contract()')
  }

  if (typeof fn !== 'function') {
    throw new TypeError('implement(contract, fn): fn must be a function')
  }

  Object.defineProperty(fn, IMPLEMENTS, {
    value: contractValue,
    enumerable: false,
    configurable: false,
    writable: false,
  })

  return fn as BoundImplementation<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>>
}
