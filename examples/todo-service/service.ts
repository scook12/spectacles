import { implement } from '../../index.ts'

import {
  CompleteTodo,
  CreateTodo,
  DeleteTodo,
  ListTodos,
  type CompleteTodoInput,
  type CompleteTodoResult,
  type CreateTodoInput,
  type CreateTodoResult,
  type DeleteTodoInput,
  type DeleteTodoResult,
  type ListTodosInput,
  type ListTodosResult,
  type Todo,
  type TodoState,
} from './contracts.ts'

function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) {
    return []
  }

  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort((left, right) => {
    return left.localeCompare(right)
  })
}

function sortByNewest(todos: readonly Todo[]): Todo[] {
  return [...todos].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export const emptyTodoState = (): TodoState => ({ todos: [] })

export const createTodo = implement(CreateTodo, (input: CreateTodoInput): CreateTodoResult => {
  const todo: Todo = {
    id: input.id,
    title: input.title.trim(),
    description: input.description?.trim(),
    tags: normalizeTags(input.tags),
    status: 'open',
    createdAt: input.now,
  }

  return {
    state: {
      todos: [...input.state.todos, todo],
    },
    todo,
  }
})

export const completeTodo = implement(CompleteTodo, (input: CompleteTodoInput): CompleteTodoResult => {
  const todo = input.state.todos.find((candidate) => candidate.id === input.todoId)
  if (!todo) {
    throw new Error(`Todo not found: ${input.todoId}`)
  }

  const completedTodo: Todo = {
    ...todo,
    status: 'completed',
    completedAt: input.completedAt,
  }

  return {
    state: {
      todos: input.state.todos.map((candidate) => {
        return candidate.id === input.todoId ? completedTodo : candidate
      }),
    },
    todo: completedTodo,
  }
})

export const deleteTodo = implement(DeleteTodo, (input: DeleteTodoInput): DeleteTodoResult => {
  const deletedTodo = input.state.todos.find((candidate) => candidate.id === input.todoId)
  if (!deletedTodo) {
    throw new Error(`Todo not found: ${input.todoId}`)
  }

  return {
    state: {
      todos: input.state.todos.filter((candidate) => candidate.id !== input.todoId),
    },
    deletedTodo,
  }
})

export const listTodos = implement(ListTodos, (input: ListTodosInput): ListTodosResult => {
  const searchNeedle = input.search?.toLowerCase()

  const items = sortByNewest(
    input.state.todos.filter((todo) => {
      if (input.status && todo.status !== input.status) {
        return false
      }

      if (input.tag && !todo.tags.includes(input.tag)) {
        return false
      }

      if (searchNeedle) {
        const searchable = `${todo.title}\n${todo.description ?? ''}`.toLowerCase()
        if (!searchable.includes(searchNeedle)) {
          return false
        }
      }

      return true
    }),
  )

  return {
    items,
    total: items.length,
  }
})

export const todoService = {
  createTodo,
  completeTodo,
  deleteTodo,
  listTodos,
}
