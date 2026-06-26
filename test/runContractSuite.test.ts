import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { contract, field, implement, runContractSuite } from '../vitest.ts'

const RangeLength = contract('RangeLength', {
  input: z.object({
    start: z.number().int(),
    end: z.number().int(),
  }),
  output: z.number().int(),
})
  .where(field('input.start').lte(field('input.end')))
  .post('non-negative', ({ output }) => output >= 0)
  .post('difference', ({ input, output }) => output === input.end - input.start)
  .law('translation invariant', { delta: z.number().int() }, async ({ impl, input, delta }) => {
    const shifted = {
      start: input.start + delta,
      end: input.end + delta,
    }

    return (await impl(input)) === (await impl(shifted))
  })
  .example('simple', {
    input: { start: 2, end: 5 },
    output: 3,
  })

const rangeLength = implement(RangeLength, ({ start, end }) => end - start)

describe('runContractSuite()', () => {
  runContractSuite({
    contract: RangeLength,
    impl: rangeLength,
    numRuns: 25,
  })

  it('rejects invalid options eagerly', () => {
    expect(() => runContractSuite(null as any)).toThrow('options must be an object')
    expect(() => runContractSuite({ contract: {} as any, impl: rangeLength as any })).toThrow('options.contract must be a contract')
    expect(() => runContractSuite({ contract: RangeLength, impl: null as any })).toThrow('options.impl must be a function')
  })
})
