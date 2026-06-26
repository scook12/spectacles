import { z } from 'zod'

import { contract, uniqueBy } from '../../index.ts'

export const TodoIdSchema = z.string().uuid()
export const TodoStatusSchema = z.enum(['open', 'completed'])
export const TodoTagSchema = z.string().trim().min(1).max(24)
export const IsoDateTimeSchema = z.string().datetime()

export const TodoSchema = z.object({
  id: TodoIdSchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  tags: z.array(TodoTagSchema).max(8),
  status: TodoStatusSchema,
  createdAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.optional(),
})

export const TodoStateSchema = z.object({
  todos: z.array(TodoSchema),
})

export const CreateTodoInputSchema = z.object({
  state: TodoStateSchema,
  id: TodoIdSchema,
  now: IsoDateTimeSchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  tags: z.array(TodoTagSchema).max(8).optional(),
})

export const CreateTodoResultSchema = z.object({
  state: TodoStateSchema,
  todo: TodoSchema,
})

export const CompleteTodoInputSchema = z.object({
  state: TodoStateSchema,
  todoId: TodoIdSchema,
  completedAt: IsoDateTimeSchema,
})

export const CompleteTodoResultSchema = z.object({
  state: TodoStateSchema,
  todo: TodoSchema,
})

export const DeleteTodoInputSchema = z.object({
  state: TodoStateSchema,
  todoId: TodoIdSchema,
})

export const DeleteTodoResultSchema = z.object({
  state: TodoStateSchema,
  deletedTodo: TodoSchema,
})

export const ListTodosInputSchema = z.object({
  state: TodoStateSchema,
  status: TodoStatusSchema.optional(),
  tag: TodoTagSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
})

export const ListTodosResultSchema = z.object({
  items: z.array(TodoSchema),
  total: z.number().int().min(0),
})

export const CreateTodo = contract('CreateTodo', {
  input: CreateTodoInputSchema,
  output: CreateTodoResultSchema,
})
  .where(uniqueBy('input.state.todos', 'id'))
  .post('new todo is returned', ({ output }) => output.state.todos.some((todo) => todo.id === output.todo.id))
  .post('todo count increases by one', ({ input, output }) => output.state.todos.length === input.state.todos.length + 1)
  .post('created todo starts open', ({ output }) => output.todo.status === 'open')
  .post('title is preserved', ({ input, output }) => output.todo.title === input.title.trim())
  .example('create first todo', {
    input: {
      state: { todos: [] },
      id: '11111111-1111-4111-8111-111111111111',
      now: '2026-01-01T09:00:00.000Z',
      title: 'Write Spectacles example',
      description: 'Add a real-world todo service example',
      tags: ['docs', 'contracts'],
    },
    output: {
      state: {
        todos: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            title: 'Write Spectacles example',
            description: 'Add a real-world todo service example',
            tags: ['contracts', 'docs'],
            status: 'open',
            createdAt: '2026-01-01T09:00:00.000Z',
          },
        ],
      },
      todo: {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Write Spectacles example',
        description: 'Add a real-world todo service example',
        tags: ['contracts', 'docs'],
        status: 'open',
        createdAt: '2026-01-01T09:00:00.000Z',
      },
    },
  })

export const CompleteTodo = contract('CompleteTodo', {
  input: CompleteTodoInputSchema,
  output: CompleteTodoResultSchema,
})
  .where(uniqueBy('input.state.todos', 'id'))
  .pre('todo exists', ({ input }) => input.state.todos.some((todo) => todo.id === input.todoId))
  .post('todo status becomes completed', ({ output }) => output.todo.status === 'completed')
  .post('completedAt is recorded', ({ input, output }) => output.todo.completedAt === input.completedAt)
  .post('todo count is unchanged', ({ input, output }) => output.state.todos.length === input.state.todos.length)
  .example('complete an open todo', {
    input: {
      state: {
        todos: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            title: 'Ship docs',
            tags: ['docs'],
            status: 'open',
            createdAt: '2026-01-01T09:00:00.000Z',
          },
        ],
      },
      todoId: '11111111-1111-4111-8111-111111111111',
      completedAt: '2026-01-01T10:00:00.000Z',
    },
    output: {
      state: {
        todos: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            title: 'Ship docs',
            tags: ['docs'],
            status: 'completed',
            createdAt: '2026-01-01T09:00:00.000Z',
            completedAt: '2026-01-01T10:00:00.000Z',
          },
        ],
      },
      todo: {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Ship docs',
        tags: ['docs'],
        status: 'completed',
        createdAt: '2026-01-01T09:00:00.000Z',
        completedAt: '2026-01-01T10:00:00.000Z',
      },
    },
  })

export const DeleteTodo = contract('DeleteTodo', {
  input: DeleteTodoInputSchema,
  output: DeleteTodoResultSchema,
})
  .where(uniqueBy('input.state.todos', 'id'))
  .pre('todo exists', ({ input }) => input.state.todos.some((todo) => todo.id === input.todoId))
  .post('todo is removed from next state', ({ input, output }) => output.state.todos.length === input.state.todos.length - 1)
  .post('deleted todo id matches input', ({ input, output }) => output.deletedTodo.id === input.todoId)
  .example('delete an existing todo', {
    input: {
      state: {
        todos: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            title: 'Remove me',
            tags: ['cleanup'],
            status: 'open',
            createdAt: '2026-01-01T09:00:00.000Z',
          },
        ],
      },
      todoId: '11111111-1111-4111-8111-111111111111',
    },
    output: {
      state: { todos: [] },
      deletedTodo: {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Remove me',
        tags: ['cleanup'],
        status: 'open',
        createdAt: '2026-01-01T09:00:00.000Z',
      },
    },
  })

export const ListTodos = contract('ListTodos', {
  input: ListTodosInputSchema,
  output: ListTodosResultSchema,
})
  .where(uniqueBy('input.state.todos', 'id'))
  .post('total matches item count', ({ output }) => output.total === output.items.length)
  .post('status filter is applied', ({ input, output }) => {
    return input.status === undefined || output.items.every((todo) => todo.status === input.status)
  })
  .post('tag filter is applied', ({ input, output }) => {
    const tag = input.tag
    return tag === undefined || output.items.every((todo) => todo.tags.includes(tag))
  })
  .post('search filter is applied', ({ input, output }) => {
    if (input.search === undefined) {
      return true
    }

    const needle = input.search.toLowerCase()
    return output.items.every((todo) => {
      return todo.title.toLowerCase().includes(needle) || (todo.description?.toLowerCase().includes(needle) ?? false)
    })
  })
  .post('results are sorted newest first', ({ output }) => {
    return output.items.every((todo, index, items) => {
      if (index === 0) {
        return true
      }

      return items[index - 1]!.createdAt >= todo.createdAt
    })
  })
  .law('deterministic for the same input', {}, async ({ impl, input }) => {
    const first = await impl(input)
    const second = await impl(input)
    return JSON.stringify(first) === JSON.stringify(second)
  })
  .example('list only open docs todos', {
    input: {
      state: {
        todos: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            title: 'Write docs',
            tags: ['docs'],
            status: 'open',
            createdAt: '2026-01-02T09:00:00.000Z',
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            title: 'Ship release',
            tags: ['release'],
            status: 'completed',
            createdAt: '2026-01-01T09:00:00.000Z',
            completedAt: '2026-01-01T12:00:00.000Z',
          },
        ],
      },
      status: 'open',
      tag: 'docs',
    },
    output: {
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          title: 'Write docs',
          tags: ['docs'],
          status: 'open',
          createdAt: '2026-01-02T09:00:00.000Z',
        },
      ],
      total: 1,
    },
  })

export const TodoContracts = {
  CreateTodo,
  CompleteTodo,
  DeleteTodo,
  ListTodos,
}

export type Todo = z.infer<typeof TodoSchema>
export type TodoState = z.infer<typeof TodoStateSchema>
export type CreateTodoInput = z.infer<typeof CreateTodoInputSchema>
export type CreateTodoResult = z.infer<typeof CreateTodoResultSchema>
export type CompleteTodoInput = z.infer<typeof CompleteTodoInputSchema>
export type CompleteTodoResult = z.infer<typeof CompleteTodoResultSchema>
export type DeleteTodoInput = z.infer<typeof DeleteTodoInputSchema>
export type DeleteTodoResult = z.infer<typeof DeleteTodoResultSchema>
export type ListTodosInput = z.infer<typeof ListTodosInputSchema>
export type ListTodosResult = z.infer<typeof ListTodosResultSchema>
