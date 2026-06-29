---
name: spectacles-contract-dev
description: Create or update Spectacles contracts, explicit implement(...) bindings, and generated Vitest contract suites in a TypeScript codebase. Use when a task asks for new behavior, API changes, refactors, or test generation in a repo that uses Spectacles.
---

# Spectacles Contract Development

Use this skill when working in a TypeScript repository that uses Spectacles for contract-driven development.

## First read

If you need a refresher on the public API and current workflow, read:

- [package README](../../README.md)
- [todo-service example README](../../examples/todo-service/README.md)
- [todo-service contracts](../../examples/todo-service/contracts.ts)
- [todo-service implementation](../../examples/todo-service/service.ts)

## Goal

When asked to implement or modify behavior, prefer this workflow:

1. **Find existing contracts** for the affected behavior
2. **Update or create a contract** that describes the behavior clearly
3. **Bind the implementation explicitly** with `implement(...)`
4. **Generate or regenerate contract suites**
5. **Run validation** (`typecheck`, generated tests, or project test command)

## Workflow

### 1. Inspect the current Spectacles setup

Look for:

- contract definition files
- `implement(...)` bindings
- generation scripts or CLI usage
- generated suite output directories
- `vitest.config.*` include/exclude rules

Prefer extending an existing contract surface over creating duplicate or competing contracts.

### 2. Model the behavior as a contract

#### Contract shape

- Use unary `input` / `output` for true single-argument operations
- Use canonical `args` / `returns` for multi-argument operations
- Add `argNames` for multi-argument contracts whenever names improve clarity

#### Semantic clauses

Use the lightest clause that captures the requirement:

- `where(...)` for structured input constraints
- `pre(...)` for runtime predicates that are not easily expressed structurally
- `post(...)` for expected result properties
- `law(...)` only for stable reusable invariants
- `example(...)` for concrete important cases and regression coverage

Good defaults:

- add at least one `example(...)` for non-trivial behavior
- add a `post(...)` when the behavior has a clear local correctness rule
- avoid inventing “mathy” laws unless they are genuinely meaningful and stable

### 3. Bind the implementation explicitly

Always prefer:

```ts
export const doThing = implement(DoThingContract, (input) => {
  // ...
})
```

Do not rely on structural inference. Spectacles discovery is designed around explicit `implement(...)` bindings.

### 4. Generate tests

Use the repository’s existing generation path if one exists.

Otherwise prefer the CLI:

```bash
spectacles generate --tsconfig ./tsconfig.json --out ./test/generated/contracts
```

Or the programmatic API:

```ts
import { generateVitestContractFilesFromTsConfig } from 'spectacles/generation'
```

If the task asks for invalid-input rejection behavior, generate with:

```bash
--invalid reject
```

### 5. Validate

After changes:

- run typecheck
- regenerate suites if contracts or implementations changed
- run the relevant tests

If generated files are committed in the repo, update them as part of the change.

## Guardrails

- Prefer editing existing contracts before adding new ones
- Keep one contract per meaningful operation boundary
- Do not over-specify with too many laws or predicates
- Preserve established unary contract style when updating existing unary APIs
- Use barrel exports only if the repo already uses them consistently
- Keep generated test output out of the main test collection unless the repo explicitly wants generated suites checked in and executed directly

## If the repository does not yet use Spectacles

When the user clearly wants Spectacles introduced:

1. add a contract definition file
2. add explicit `implement(...)` bindings
3. add a generation command or script
4. add or update Vitest config so generated suites are collected intentionally
5. generate initial suites

Keep the initial setup small and easy to understand.

## Expected deliverable pattern

For a typical feature task, aim to leave behind:

- updated/new contract definitions
- updated/new explicit implementations
- regenerated contract suites or a clear note that generation was run
- a short explanation of any semantic choices (`where`, `post`, `law`, `example`)
