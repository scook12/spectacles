import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('examples/todo-service', () => {
  it('includes checked-in generated suites for the todo service example', () => {
    const generatedDir = resolve(process.cwd(), 'examples/todo-service/generated')
    const files = readdirSync(generatedDir).sort()

    expect(files).toEqual([
      'complete-todo--complete-todo.contract.test.ts',
      'create-todo--create-todo.contract.test.ts',
      'delete-todo--delete-todo.contract.test.ts',
      'list-todos--list-todos.contract.test.ts',
    ])

    const createTodoSuite = readFileSync(resolve(generatedDir, 'create-todo--create-todo.contract.test.ts'), 'utf8')
    expect(createTodoSuite).toContain("Generated contract suite for CreateTodo / createTodo.")
    expect(createTodoSuite).toContain("import { CreateTodo } from '../contracts.js'")
    expect(createTodoSuite).toContain("import { createTodo } from '../service.js'")
    expect(createTodoSuite).toContain('runContractSuite({')
  })
})
