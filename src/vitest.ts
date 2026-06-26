import { expect, it } from 'vitest'

import type { AnySchema, Contract, RunContractSuiteOptions } from './index.js'
import { runContractSuite as runContractSuiteBase } from './index.js'

export * from './index.js'

export function runContractSuite<
  const Name extends string,
  InSchema extends AnySchema,
  OutSchema extends AnySchema,
>(
  options: RunContractSuiteOptions<Contract<Name, InSchema, OutSchema>>,
): void {
  runContractSuiteBase(options, { it, expect })
}
