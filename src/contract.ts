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
  readonly input: AnySchema
  readonly output: AnySchema
}

export interface Contract<
  Name extends string = string,
  InSchema extends AnySchema = AnySchema,
  OutSchema extends AnySchema = AnySchema,
> {
  readonly kind: 'contract'
  readonly name: Name
  readonly input: InSchema
  readonly output: OutSchema

  readonly wheres: readonly WhereClause[]
  readonly pres: readonly PreClause<Contract<Name, InSchema, OutSchema>>[]
  readonly posts: readonly PostClause<Contract<Name, InSchema, OutSchema>>[]
  readonly laws: readonly LawClause<Contract<Name, InSchema, OutSchema>, any>[]
  readonly examples: readonly ExampleClause<Contract<Name, InSchema, OutSchema>>[]

  where(...clauses: readonly WhereClause[]): Contract<Name, InSchema, OutSchema>

  pre(
    name: string,
    predicate: PrePredicate<Contract<Name, InSchema, OutSchema>>,
  ): Contract<Name, InSchema, OutSchema>

  post(
    name: string,
    predicate: PostPredicate<Contract<Name, InSchema, OutSchema>>,
  ): Contract<Name, InSchema, OutSchema>

  law<V extends LawVarSchemas>(
    name: string,
    vars: V,
    predicate: LawPredicate<Contract<Name, InSchema, OutSchema>, V>,
  ): Contract<Name, InSchema, OutSchema>

  example(
    name: string,
    example: ExampleCase<Contract<Name, InSchema, OutSchema>>,
  ): Contract<Name, InSchema, OutSchema>
}

export type AnyContract = Contract<any, AnySchema, AnySchema>

export type ContractInput<C extends ContractLike> = Infer<C['input']>
export type ContractOutput<C extends ContractLike> = Infer<C['output']>

export type ImplementationFn<C extends ContractLike> = (
  input: ContractInput<C>,
) => MaybePromise<ContractOutput<C>>

export interface PreContext<C extends ContractLike> {
  readonly contract: C
  readonly input: ContractInput<C>
}

export interface PostContext<C extends ContractLike> {
  readonly contract: C
  readonly input: ContractInput<C>
  readonly output: ContractOutput<C>
}

export type LawContext<C extends ContractLike, V extends LawVarSchemas> = {
  readonly contract: C
  readonly input: ContractInput<C>
  readonly impl: ImplementationFn<C>
} & InferLawVars<V>

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

export interface ExampleCase<C extends ContractLike> {
  readonly input: ContractInput<C>
  readonly output?: ContractOutput<C>
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

export interface ContractSpec<
  InSchema extends AnySchema,
  OutSchema extends AnySchema,
> {
  readonly input: InSchema
  readonly output: OutSchema
}

export type BoundImplementation<C extends ContractLike> =
  & ImplementationFn<C>
  & {
    readonly [IMPLEMENTS]: C
  }

interface ContractState<
  Name extends string,
  InSchema extends AnySchema,
  OutSchema extends AnySchema,
> {
  readonly wheres: readonly WhereClause[]
  readonly pres: readonly PreClause<Contract<Name, InSchema, OutSchema>>[]
  readonly posts: readonly PostClause<Contract<Name, InSchema, OutSchema>>[]
  readonly laws: readonly LawClause<Contract<Name, InSchema, OutSchema>, any>[]
  readonly examples: readonly ExampleClause<Contract<Name, InSchema, OutSchema>>[]
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

function createContract<
  const Name extends string,
  InSchema extends AnySchema,
  OutSchema extends AnySchema,
>(
  name: Name,
  spec: ContractSpec<InSchema, OutSchema>,
  state?: ContractState<Name, InSchema, OutSchema>,
): Contract<Name, InSchema, OutSchema> {
  const nextState: ContractState<Name, InSchema, OutSchema> = state ?? {
    wheres: [],
    pres: [],
    posts: [],
    laws: [],
    examples: [],
  }

  const contractValue: Contract<Name, InSchema, OutSchema> = {
    kind: 'contract',
    name,
    input: spec.input,
    output: spec.output,

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

    law<V extends LawVarSchemas>(clauseName: string, vars: V, predicate: LawPredicate<Contract<Name, InSchema, OutSchema>, V>) {
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
  InSchema extends AnySchema,
  OutSchema extends AnySchema,
>(
  name: Name,
  spec: ContractSpec<InSchema, OutSchema>,
): Contract<Name, InSchema, OutSchema> {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('contract(name, spec): name must be a non-empty string')
  }

  if (!spec || typeof spec !== 'object') {
    throw new TypeError('contract(name, spec): spec must be an object')
  }

  if (!('input' in spec) || !('output' in spec)) {
    throw new TypeError('contract(name, spec): spec must include input and output schemas')
  }

  return createContract(name, spec)
}

export function implement<
  const Name extends string,
  InSchema extends AnySchema,
  OutSchema extends AnySchema,
>(
  contractValue: Contract<Name, InSchema, OutSchema>,
  fn: ImplementationFn<Contract<Name, InSchema, OutSchema>>,
): BoundImplementation<Contract<Name, InSchema, OutSchema>> {
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

  return fn as BoundImplementation<Contract<Name, InSchema, OutSchema>>
}
