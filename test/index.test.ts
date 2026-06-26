import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  IMPLEMENTS,
  arg,
  contract,
  exactlyOne,
  field,
  implement,
  nonEmpty,
  uniqueBy,
} from '../index.ts'

describe('field()', () => {
  it('creates frozen field refs with comparison and presence helpers', () => {
    const start = field('input.start')
    const end = field('input.end')

    expect(start.kind).toBe('field-ref')
    expect(start.path).toBe('input.start')
    expect(Object.isFrozen(start)).toBe(true)

    const lteClause = start.lte(end)
    expect(lteClause).toEqual({
      kind: 'comparison',
      left: start,
      operator: 'lte',
      right: end,
    })
    expect(Object.isFrozen(lteClause)).toBe(true)

    const definedClause = start.defined()
    expect(definedClause).toEqual({
      kind: 'presence',
      field: start,
      operator: 'defined',
    })
    expect(Object.isFrozen(definedClause)).toBe(true)
  })
})

describe('where helpers', () => {
  it('creates frozen helper clauses', () => {
    const xorClause = exactlyOne('input.email', 'input.phone')
    expect(xorClause).toEqual({
      kind: 'exactly-one',
      fields: ['input.email', 'input.phone'],
    })
    expect(Object.isFrozen(xorClause)).toBe(true)
    expect(Object.isFrozen(xorClause.fields)).toBe(true)

    const uniqueClause = uniqueBy('input.items', 'id')
    expect(uniqueClause).toEqual({
      kind: 'unique-by',
      path: 'input.items',
      key: 'id',
    })
    expect(Object.isFrozen(uniqueClause)).toBe(true)

    const nonEmptyClause = nonEmpty('input.items')
    expect(nonEmptyClause).toEqual({
      kind: 'non-empty',
      path: 'input.items',
    })
    expect(Object.isFrozen(nonEmptyClause)).toBe(true)
  })
})

describe('contract()', () => {
  it('creates an immutable base contract', () => {
    const rangeLength = contract('RangeLength', {
      input: z.object({
        start: z.number(),
        end: z.number(),
      }),
      output: z.number(),
    })

    expect(rangeLength.kind).toBe('contract')
    expect(rangeLength.name).toBe('RangeLength')
    expect(rangeLength.input).toBeTypeOf('object')
    expect(rangeLength.output).toBeTypeOf('object')

    expect(rangeLength.wheres).toEqual([])
    expect(rangeLength.pres).toEqual([])
    expect(rangeLength.posts).toEqual([])
    expect(rangeLength.laws).toEqual([])
    expect(rangeLength.examples).toEqual([])

    expect(Object.isFrozen(rangeLength)).toBe(true)
    expect(Object.isFrozen(rangeLength.wheres)).toBe(true)
    expect(Object.isFrozen(rangeLength.pres)).toBe(true)
    expect(Object.isFrozen(rangeLength.posts)).toBe(true)
    expect(Object.isFrozen(rangeLength.laws)).toBe(true)
    expect(Object.isFrozen(rangeLength.examples)).toBe(true)
  })

  it('chains immutably and stores clauses in order', () => {
    const base = contract('RangeLength', {
      input: z.object({
        start: z.number(),
        end: z.number(),
      }),
      output: z.number(),
    })

    const pre = ({ input }: { input: { start: number; end: number } }) => input.end >= input.start
    const post = ({ input, output }: { input: { start: number; end: number }; output: number }) => {
      return output === input.end - input.start
    }
    const law = async ({ input, delta, impl }: {
      input: { start: number; end: number }
      delta: number
      impl: (input: { start: number; end: number }) => number | Promise<number>
    }) => {
      const result = await impl(input)
      const shifted = { start: input.start + delta, end: input.end + delta }
      const shiftedResult = await impl(shifted)
      return result === shiftedResult
    }

    const derived = base
      .where(field('input.start').lte(field('input.end')))
      .pre('ordered', pre)
      .post('difference', post)
      .law('translation invariant', { delta: z.number() }, law)
      .example('simple', {
        input: { start: 2, end: 5 },
        output: 3,
      })

    expect(base.wheres).toHaveLength(0)
    expect(base.pres).toHaveLength(0)
    expect(base.posts).toHaveLength(0)
    expect(base.laws).toHaveLength(0)
    expect(base.examples).toHaveLength(0)

    expect(derived.wheres).toHaveLength(1)
    expect(derived.pres).toHaveLength(1)
    expect(derived.posts).toHaveLength(1)
    expect(derived.laws).toHaveLength(1)
    expect(derived.examples).toHaveLength(1)

    expect(derived.pres[0]?.name).toBe('ordered')
    expect(derived.posts[0]?.name).toBe('difference')
    expect(derived.laws[0]?.name).toBe('translation invariant')
    expect(derived.examples[0]?.name).toBe('simple')
  })

  it('rejects invalid contract definitions', () => {
    expect(() => contract('', {
      input: z.string(),
      output: z.string(),
    })).toThrow('name must be a non-empty string')

    expect(() => contract('Bad', null as any)).toThrow('spec must be an object')
    expect(() => contract('Bad', { input: z.string() } as any)).toThrow('spec must include input/output or args/returns schemas')
  })

  it('supports variadic contracts with args/returns and arg helpers', () => {
    const addOrdered = contract('AddOrdered', {
      args: z.tuple([z.number().int(), z.number().int()]),
      returns: z.number().int(),
    })
      .where(arg(0).lte(arg(1)))
      .pre('ordered', ({ args }) => args[0] <= args[1])
      .post('adds both args', ({ args, result, output }) => result === args[0] + args[1] && output === result)
      .example('small numbers', {
        args: [2, 5],
        result: 7,
      })

    const implementation = implement(addOrdered, (left, right) => left + right)

    expect(addOrdered.args).toBeTypeOf('object')
    expect(addOrdered.returns).toBeTypeOf('object')
    expect(addOrdered.input).toBeUndefined()
    expect(addOrdered.output).toBe(addOrdered.returns)
    expect(addOrdered.wheres[0]?.kind).toBe('comparison')
    if (addOrdered.wheres[0]?.kind === 'comparison') {
      expect(addOrdered.wheres[0].left.path).toBe('args.0')
      expect(addOrdered.wheres[0].operator).toBe('lte')
      expect('path' in addOrdered.wheres[0].right && addOrdered.wheres[0].right.path).toBe('args.1')
    }
    expect(implementation(3, 4)).toBe(7)
  })
})

describe('implement()', () => {
  it('brands implementations with their contract', () => {
    const rangeLength = contract('RangeLength', {
      input: z.object({
        start: z.number(),
        end: z.number(),
      }),
      output: z.number(),
    })

    const implementation = implement(rangeLength, ({ start, end }) => end - start)

    expect(implementation({ start: 4, end: 9 })).toBe(5)
    expect(implementation[IMPLEMENTS]).toBe(rangeLength)

    const descriptor = Object.getOwnPropertyDescriptor(implementation, IMPLEMENTS)
    expect(descriptor?.enumerable).toBe(false)
    expect(descriptor?.writable).toBe(false)
    expect(descriptor?.configurable).toBe(false)
  })

  it('rejects invalid implementations', () => {
    const rangeLength = contract('RangeLength', {
      input: z.object({
        start: z.number(),
        end: z.number(),
      }),
      output: z.number(),
    })

    expect(() => implement({} as any, ((input: any) => input.end - input.start) as any)).toThrow(
      'contract must be a contract created by contract()'
    )

    expect(() => implement(rangeLength, null as any)).toThrow('fn must be a function')
  })
})
