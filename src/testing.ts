import * as fc from 'fast-check'

import type {
  AnyContract,
  AnySchema,
  Contract,
  ContractLike,
  ImplementationFn,
  MaybePromise,
} from './contract.js'
import {
  assertPredicateResult,
  assertSchema,
  fcOptions,
  lawVarsArbitrary,
  preconditionsHold,
  validInputArbitrary,
  validateExampleInput,
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
  InSchema extends AnySchema,
  OutSchema extends AnySchema,
>(
  options: RunContractSuiteOptions<Contract<Name, InSchema, OutSchema>>,
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
  const inputArbitrary = validInputArbitrary(contractValue, contractValue.wheres)

  for (const example of contractValue.examples) {
    api.it(`example: ${example.name}`, async () => {
      const input = example.example.input
      await validateExampleInput(contractValue, contractValue.wheres, contractValue.pres, input)

      const output = await impl(input)
      await assertSchema(contractValue.output, output, 'example output')

      if (example.example.output !== undefined) {
        api.expect(output).toStrictEqual(example.example.output)
      }

      for (const post of contractValue.posts) {
        await assertPredicateResult(
          `postcondition failed: ${post.name}`,
          post.predicate({ contract: contractValue, input, output }),
        )
      }
    }, timeout)
  }

  api.it('property: output satisfies schema and postconditions', async () => {
    await fc.assert(
      fc.asyncProperty(inputArbitrary, async (input) => {
        const shouldRun = await preconditionsHold(contractValue, contractValue.pres, input)
        if (!shouldRun) {
          return
        }

        const output = await impl(input)
        await assertSchema(contractValue.output, output, 'property output')

        for (const post of contractValue.posts) {
          await assertPredicateResult(
            `postcondition failed: ${post.name}`,
            post.predicate({ contract: contractValue, input, output }),
          )
        }
      }),
      fcOptions(options),
    )
  }, timeout)

  for (const law of contractValue.laws) {
    api.it(`law: ${law.name}`, async () => {
      await fc.assert(
        fc.asyncProperty(inputArbitrary, lawVarsArbitrary(law.vars), async (input, vars) => {
          const shouldRun = await preconditionsHold(contractValue, contractValue.pres, input)
          if (!shouldRun) {
            return
          }

          await assertPredicateResult(
            `law failed: ${law.name}`,
            law.predicate({
              contract: contractValue,
              input,
              impl,
              ...vars,
            }),
          )
        }),
        fcOptions(options),
      )
    }, timeout)
  }
}

export type { AnyContract }
