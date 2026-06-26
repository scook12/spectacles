import * as fc from 'fast-check'

import type {
  AnyContract,
  AnySchema,
  Contract,
  ContractLike,
  ImplementationFn,
  MaybePromise,
} from './contract.js'
import { normalizeExampleCase } from './contract.js'
import {
  assertPredicateResult,
  assertSchema,
  createLawContext,
  createPostContext,
  fcOptions,
  lawVarsArbitrary,
  preconditionsHold,
  validArgsArbitrary,
  validateExampleArgs,
} from './testing-utils.js'

export interface RunContractSuiteOptions<C extends ContractLike> {
  readonly contract: C
  readonly impl: ImplementationFn<C>
  readonly numRuns?: number
  readonly timeoutMs?: number
  readonly seed?: number
}

export interface AssertionLike {
  toStrictEqual(expected: unknown): void
}

export interface ExpectLike {
  (actual: unknown): AssertionLike
}

export interface TestRegistrar {
  (name: string, fn: () => MaybePromise<void>, timeout?: number): void
}

export interface RunContractSuiteApi {
  readonly it: TestRegistrar
  readonly expect: ExpectLike
}

export function runContractSuite<
  const Name extends string,
  ArgsSchema extends AnySchema,
  ReturnSchema extends AnySchema,
  InputSchema extends AnySchema | undefined,
>(
  options: RunContractSuiteOptions<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>>,
  api: RunContractSuiteApi,
): void {
  if (!options || typeof options !== 'object') {
    throw new TypeError('runContractSuite(options): options must be an object')
  }

  const { contract: contractValue, impl } = options

  if (!contractValue || contractValue.kind !== 'contract') {
    throw new TypeError('runContractSuite(options): options.contract must be a contract')
  }

  if (typeof impl !== 'function') {
    throw new TypeError('runContractSuite(options): options.impl must be a function')
  }

  if (!api || typeof api !== 'object') {
    throw new TypeError('runContractSuite(options, api): api must be an object')
  }

  if (typeof api.it !== 'function') {
    throw new TypeError('runContractSuite(options, api): api.it must be a function')
  }

  if (typeof api.expect !== 'function') {
    throw new TypeError('runContractSuite(options, api): api.expect must be a function')
  }

  const timeout = options.timeoutMs
  const argsArbitrary = validArgsArbitrary(contractValue, contractValue.wheres)

  for (const example of contractValue.examples) {
    api.it(`example: ${example.name}`, async () => {
      const normalizedExample = normalizeExampleCase(example.example)
      const args = normalizedExample.args
      await validateExampleArgs(contractValue, contractValue.wheres, contractValue.pres, args)

      const result = await impl(...args)
      await assertSchema(contractValue.returns, result, 'example result')

      if (normalizedExample.result !== undefined) {
        api.expect(result).toStrictEqual(normalizedExample.result)
      }

      for (const post of contractValue.posts) {
        await assertPredicateResult(
          `postcondition failed: ${post.name}`,
          post.predicate(createPostContext(contractValue, args, result)),
        )
      }
    }, timeout)
  }

  api.it('property: return satisfies schema and postconditions', async () => {
    await fc.assert(
      fc.asyncProperty(argsArbitrary, async (args) => {
        const shouldRun = await preconditionsHold(contractValue, contractValue.pres, args)
        if (!shouldRun) {
          return
        }

        const result = await impl(...args)
        await assertSchema(contractValue.returns, result, 'property result')

        for (const post of contractValue.posts) {
          await assertPredicateResult(
            `postcondition failed: ${post.name}`,
            post.predicate(createPostContext(contractValue, args, result)),
          )
        }
      }),
      fcOptions(options),
    )
  }, timeout)

  for (const law of contractValue.laws) {
    api.it(`law: ${law.name}`, async () => {
      await fc.assert(
        fc.asyncProperty(argsArbitrary, lawVarsArbitrary(law.vars), async (args, vars) => {
          const shouldRun = await preconditionsHold(contractValue, contractValue.pres, args)
          if (!shouldRun) {
            return
          }

          await assertPredicateResult(
            `law failed: ${law.name}`,
            law.predicate(createLawContext(contractValue, args, impl, vars)),
          )
        }),
        fcOptions(options),
      )
    }, timeout)
  }
}

export type { AnyContract }
