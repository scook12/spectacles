import { expect, it } from 'vitest'

import type { AnySchema, Contract, RunContractSuiteOptions } from './index.js'
import { runContractSuite as runContractSuiteBase } from './index.js'

export * from './index.js'

export function runContractSuite<
  const Name extends string,
  ArgsSchema extends AnySchema,
  ReturnSchema extends AnySchema,
  InputSchema extends AnySchema | undefined,
>(
  options: RunContractSuiteOptions<Contract<Name, ArgsSchema, ReturnSchema, InputSchema>>,
): void {
  runContractSuiteBase(options, { it, expect })
}
