# Todo service example

This example is the "todo app" of Spectacles: a larger, service-shaped contract example that models several operations of a todo system.

## What's in here

- `contracts.ts` — shared schemas plus four operation contracts:
  - `CreateTodo`
  - `CompleteTodo`
  - `DeleteTodo`
  - `ListTodos`
- `service.ts` — a concrete in-memory implementation for those operations
- `generate-tests.ts` — a small script that generates Vitest suites for the example
- `tsconfig.json` — used by `ts-morph` discovery and generation

## Why it is modeled this way

The current Spectacles contract API is centered on unary functions. For stateful services, a practical pattern is to model service methods as **state transitions**:

- input contains the current state plus the request
- output contains the next state plus the operation result

That keeps the implementation pure and makes property-based testing much easier.

## Generate tests for the example

From the repository root:

```bash
npx spectacles generate \
  --project ./examples/todo-service/tsconfig.json \
  --out ./examples/todo-service/generated
```

Or programmatically:

```bash
node ./examples/todo-service/generate-tests.ts
```

## Notes

Inside this repository, the example imports Spectacles via relative paths like `../../index.ts` so the example typechecks directly against local source.

In a consuming app, you would normally write the same example using package imports such as:

```ts
import { contract, implement } from 'spectacles'
```
