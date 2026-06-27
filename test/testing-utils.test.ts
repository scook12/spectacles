import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  arg,
  contract,
  field,
} from '../index.ts'
import {
  arbitraryFromSchema,
  areSchemaAndWhereClausesSatisfied,
  assertPredicateResult,
  assertSchema,
  buildArgsRoot,
  createLawContext,
  createPostContext,
  createPreContext,
  evaluateWhereClause,
  fcOptions,
  invalidArgsArbitrary,
  lawVarsArbitrary,
  preconditionsHold,
  validArgsArbitrary,
  validateExampleArgs,
} from '../src/testing-utils.ts'

describe('testing-utils', () => {
  it('builds args roots and contexts with unary aliases and arg names', () => {
    const unary = contract('Unary', {
      input: z.object({ value: z.number() }),
      output: z.number(),
    })
    const variadic = contract('Variadic', {
      args: z.tuple([z.number(), z.string()]),
      argNames: ['count', 'label'],
      returns: z.boolean(),
    })

    expect(buildArgsRoot([{ value: 2 }])).toEqual({
      args: [{ value: 2 }],
      input: { value: 2 },
    })

    const namedRoot = buildArgsRoot([3, 'hi'], ['count', 'label']) as unknown as { args: unknown[] & Record<string, unknown> }
    expect(Array.from(namedRoot.args)).toEqual([3, 'hi'])
    expect(namedRoot.args.count).toBe(3)
    expect(namedRoot.args.label).toBe('hi')

    const unaryPre = createPreContext(unary, [{ value: 1 }])
    expect(unaryPre.input).toEqual({ value: 1 })
    expect(unaryPre.args).toEqual([{ value: 1 }])

    const unaryPost = createPostContext(unary, [{ value: 2 }], 2)
    expect(unaryPost.input).toEqual({ value: 2 })
    expect(unaryPost.result).toBe(2)
    expect(unaryPost.output).toBe(2)

    const unaryLaw = createLawContext(unary, [{ value: 3 }], (input) => input.value, { extra: 1 })
    expect(unaryLaw.input).toEqual({ value: 3 })
    expect(unaryLaw.extra).toBe(1)

    const variadicLaw = createLawContext(variadic, [4, 'x'], (count, label) => count > label.length, { delta: 2 })
    expect(variadicLaw.args).toEqual([4, 'x'])
    expect(variadicLaw.delta).toBe(2)
  })

  it('evaluates where clauses across clause kinds', () => {
    const root = {
      input: {
        start: 1,
        end: 3,
        maybe: undefined,
        email: 'a@example.com',
        items: [{ id: 1 }, { id: 2 }],
        tags: ['docs'],
        meta: { ok: true },
      },
      args: Object.assign([{ start: 1, end: 3 }], { left: { start: 1, end: 3 } }),
    }

    expect(evaluateWhereClause(root, field('input.start').eq(1))).toBe(true)
    expect(evaluateWhereClause(root, field('input.start').ne(2))).toBe(true)
    expect(evaluateWhereClause(root, field('input.start').lt(field('input.end')))).toBe(true)
    expect(evaluateWhereClause(root, field('input.start').lte(field('input.end')))).toBe(true)
    expect(evaluateWhereClause(root, field('input.end').gt(field('input.start')))).toBe(true)
    expect(evaluateWhereClause(root, field('input.end').gte(field('input.start')))).toBe(true)
    expect(evaluateWhereClause(root, field('input.email').defined())).toBe(true)
    expect(evaluateWhereClause(root, field('input.maybe').undefined())).toBe(true)
    expect(evaluateWhereClause(root, { kind: 'exactly-one', fields: ['input.email', 'input.phone'] })).toBe(true)
    expect(evaluateWhereClause(root, { kind: 'unique-by', path: 'input.items', key: 'id' })).toBe(true)
    expect(evaluateWhereClause(root, { kind: 'non-empty', path: 'input.tags' })).toBe(true)
    expect(evaluateWhereClause(root, { kind: 'non-empty', path: 'input.meta' })).toBe(true)

    expect(evaluateWhereClause(root, { kind: 'unique-by', path: 'input.email', key: 'id' })).toBe(false)
    expect(evaluateWhereClause(root, { kind: 'non-empty', path: 'input.empty' })).toBe(false)
  })

  it('builds arbitraries for many schema kinds', () => {
    const cases = [
      z.string().min(6).max(64).email(),
      z.string().uuid(),
      z.number().int().min(2).max(4),
      z.boolean(),
      z.literal('x'),
      z.enum(['a', 'b']),
      z.object({ name: z.string(), age: z.number().optional() }),
      z.array(z.string()).min(1).max(2),
      z.tuple([z.string(), z.number()]),
      z.record(z.string(), z.number()),
      z.union([z.string(), z.number()]),
      z.string().optional(),
      z.string().nullable(),
      z.unknown(),
    ]

    for (const schema of cases) {
      const sample = fc.sample(arbitraryFromSchema(schema), 5)
      expect(sample.length).toBe(5)
      for (const value of sample) {
        expect(schema.safeParse(value).success).toBe(true)
      }
    }
  })

  it('builds law var arbitraries and arg arbitraries', () => {
    const emptyVars = fc.sample(lawVarsArbitrary({}), 1)[0]
    expect(emptyVars).toEqual({})

    const vars = fc.sample(lawVarsArbitrary({ delta: z.number().int(), label: z.string() }), 3)
    for (const value of vars) {
      expect(typeof value.delta).toBe('number')
      expect(typeof value.label).toBe('string')
    }

    const ordered = contract('Ordered', {
      args: z.tuple([z.number().int(), z.number().int()]),
      argNames: ['left', 'right'],
      returns: z.number().int(),
    }).where(arg('left').lte(arg('right')))

    const valid = fc.sample(validArgsArbitrary(ordered, ordered.wheres), 10)
    for (const args of valid) {
      expect(args[0]).toBeLessThanOrEqual(args[1])
      expect(areSchemaAndWhereClausesSatisfied(ordered, ordered.wheres, args)).toBe(true)
    }

    const invalid = fc.sample(invalidArgsArbitrary(ordered, ordered.wheres), 10)
    for (const args of invalid) {
      expect(areSchemaAndWhereClausesSatisfied(ordered, ordered.wheres, args)).toBe(false)
    }
  })

  it('handles assertion helpers and pre/example validation', async () => {
    await expect(assertSchema(z.string(), 'ok', 'label')).resolves.toBeUndefined()
    await expect(assertSchema(z.string(), 1, 'label')).rejects.toThrow('label failed schema validation')

    await expect(assertPredicateResult('nope', true)).resolves.toBeUndefined()
    await expect(assertPredicateResult('nope', Promise.resolve())).resolves.toBeUndefined()
    await expect(assertPredicateResult('nope', false)).rejects.toThrow('nope')

    const checked = contract('Checked', {
      input: z.object({ start: z.number(), end: z.number() }),
      output: z.number(),
    })
      .where(field('input.start').lte(field('input.end')))
      .pre('non-negative start', ({ input }) => input.start >= 0)

    expect(await preconditionsHold(checked, checked.pres, [{ start: 0, end: 1 }])).toBe(true)
    expect(await preconditionsHold(checked, checked.pres, [{ start: -1, end: 1 }])).toBe(false)

    await expect(validateExampleArgs(checked, checked.wheres, checked.pres, [{ start: 0, end: 1 }])).resolves.toBeUndefined()
    await expect(validateExampleArgs(checked, checked.wheres, checked.pres, [{ start: 3, end: 1 }])).rejects.toThrow(
      'example args violated where-clause',
    )
    await expect(validateExampleArgs(checked, checked.wheres, checked.pres, [{ start: -1, end: 1 }])).rejects.toThrow(
      'example args violated a precondition',
    )
    await expect(validateExampleArgs(checked, checked.wheres, checked.pres, ['bad'] as never)).rejects.toThrow(
      'example args failed schema validation',
    )
  })

  it('builds fast-check options with and without seeds', () => {
    expect(fcOptions({})).toEqual({ numRuns: 100 })
    expect(fcOptions({ numRuns: 12, seed: 7 })).toEqual({ numRuns: 12, seed: 7 })
  })
})
