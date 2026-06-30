# Spectacles

Spectacles is a spec-driven development (SDD) framework for TypeScript.

It has three parts:

1. **Library API** for defining contracts and binding implementations
2. **Generator/CLI** for discovering those contracts and writing Vitest test files
3. **Agent Skill** for automating contract generation and implementation

## Motivation

Agentic programming's scale is asymmetrical. The speed at which code surface is generated is too great for humans to read implementations line-by-line. However, humans are still responsible for the code that ships, even if the pipeline from idea to delivery was fully automated.

Specifications are a contract-based indirection for human-agent interaction when developing software. Originally, SDD became popular because vibe coders were under the impression that prompts structured as JSON or YAML would yield more consistent results. However, the notion of a spec in software engineering is usually deterministic and current approaches to SDD are really just linear prompts that descend from abstract to detailed. "Spec" is being used in a way that offers us less than we're used to, in terms of guarantees.

Spectacles is designed to bridge the gap between structured prompting, technical specs, and deterministic code generation. Here, specs not only provide detailed agent instruction, they also give the human operator a compact but detailed shared context for implementation expectations, deterministically generated guardrails to increase baseline confidence in probabilistically generated code, and provide runtime value as strictly typed schemas.

Put simply, you or your agent:
 - Write contracts that strictly describe implementations in terms of shape, invariants, inputs, and outputs
 - Implement those contracts
And spectacles rewards you with:
 - Deterministically generated functional and property-based test suites for your implementations
 - Fast, low-token code navigation for your agent between contracts and their implementation sites

You can't read all the code, so instead you read the spec which is enforced at build time through generated tests and again at runtime via Zod.

This also supports test-driven development. As long as there's a contract and an implementation to discover (even if that implementation is a stub), Spectacles can generate a test suite you can use to validate implementation progress.

## Install

In most projects, install Spectacles and Vitest as dev dependencies, and Zod as a normal dependency:

```bash
npm install zod
npm install -D spectacles vitest
```

Spectacles brings `fast-check`, `oxc-parser`, and the TypeScript compiler API with it.

If you prefer to run the generator without adding a permanent script first, you can also invoke the local binary with `npx`:

```bash
npx spectacles --help
```

This package also ships Pi resources for agent workflows:

- skill: `spectacles-contract-dev`
- extension tool: `spectacles_navigate`

The `spectacles_navigate` tool exposes compact Spectacles discovery/index data directly to an agent. Typical actions include:

- `summary`
- `search`
- `contracts`
- `contract`
- `implementations`
- `implementation`
- `issues`

## 1. Write contracts

Define a contract with schemas and optional semantic clauses.

Unary functions can use the shorthand `input` / `output` form:

```ts
// src/contracts.ts
import { z } from 'zod'
import { contract, field } from 'spectacles'

export const RangeLength = contract('RangeLength', {
  input: z.object({
    start: z.number().int(),
    end: z.number().int(),
  }),
  output: z.number().int(),
})
  .where(field('input.start').lte(field('input.end')))
  .post('difference', ({ input, output }) => output === input.end - input.start)
  .law('translation invariant', { delta: z.number().int() }, ({ impl, input, delta }) => {
    return impl(input) === impl({
      start: input.start + delta,
      end: input.end + delta,
    })
  })
  .example('simple range', {
    input: { start: 2, end: 5 },
    output: 3,
  })
```

Multi-argument functions can use the canonical `args` / `returns` form:

```ts
import { z } from 'zod'
import { arg, contract } from 'spectacles'

export const AddOrdered = contract('AddOrdered', {
  args: z.tuple([z.number().int(), z.number().int()]),
  argNames: ['left', 'right'],
  returns: z.number().int(),
})
  .where(arg('left').lte(arg('right')))
  .post('result is the sum', ({ args, result }) => result === args[0] + args[1])
  .example('small numbers', {
    args: [2, 5],
    result: 7,
  })
```

## 2. Bind implementations explicitly

Spectacles discovers implementations through `implement(...)` calls.

```ts
// src/implementations.ts
import { implement } from 'spectacles'
import { RangeLength } from './contracts'

export const rangeLength = implement(RangeLength, ({ start, end }) => end - start)
```

## 3. Generate Vitest contract suites

### CLI

The CLI is the cleanest entrypoint for most users.

```bash
npx spectacles generate --tsconfig ./tsconfig.json --out ./test/generated/contracts
```

If `spectacles` is installed locally, you can also wire it into `package.json` scripts:

```json
{
  "scripts": {
    "generate:contracts": "spectacles generate --tsconfig ./tsconfig.json --out ./test/generated/contracts"
  }
}
```

That command:

- loads your TypeScript file set and module resolution settings from `tsconfig.json`
- discovers exported `contract(...)` definitions
- discovers exported `implement(...)` bindings
- plans test suites
- writes Vitest files into the output directory

Useful options:

```bash
npx spectacles generate \
  --tsconfig ./tsconfig.json \
  --out ./test/generated/contracts \
  --runs 200 \
  --timeout 10000 \
  --seed 123 \
  --invalid reject
```

Other flags:

- `--invalid reject` — generate an additional property asserting that invalid argument lists are rejected by the implementation
- `--no-comments` — omit generated plan comments in test files
- `--dry-run` — do not write files; print what would be generated
- `--help` — show CLI help

### Programmatic generation

If you want to generate files in code:

```ts
import { generateVitestContractFilesFromTsConfig } from 'spectacles/generation'

const result = generateVitestContractFilesFromTsConfig('./tsconfig.json', {
  outputDir: './test/generated/contracts',
  runOptions: {
    numRuns: 200,
    timeoutMs: 10_000,
    seed: 123,
    invalidArgs: 'reject',
  },
})

console.log(result.files.map((file) => file.outputFilePath))
```

`generateVitestContractFilesFromTsConfig(...)` uses the TypeScript workspace + OXC discovery path, so it follows your configured source set via `files`, `include`, `exclude`, path aliases, and related TypeScript project settings.

If you already have resolver-backed discovery analysis, use the analysis/plan APIs:

```ts
import { createDiscoveryWorkspace } from 'spectacles/discovery-backend'
import { analyzeOxcDiscoveryWorkspace } from 'spectacles/discovery-scanner-oxc'
import {
  generateVitestContractFiles,
  writeGeneratedVitestContractFiles,
} from 'spectacles/generation'

const workspace = createDiscoveryWorkspace([
  { filePath: '/src/contracts.ts', text: contractsSource },
  { filePath: '/src/implementations.ts', text: implementationsSource },
])

const analysis = analyzeOxcDiscoveryWorkspace(workspace)
const generated = generateVitestContractFiles(analysis, {
  outputDir: '/test/generated/contracts',
  runOptions: {
    invalidArgs: 'reject',
  },
})

writeGeneratedVitestContractFiles(generated.files)
```

If you want to avoid repeated workspace analysis across multiple discovery/planning/generation operations, use a session:

```ts
import { createSpectaclesSession } from 'spectacles/session'

const session = createSpectaclesSession({
  tsConfigFilePath: './tsconfig.json',
})

const discovery = session.discovery()
const plan = session.plan({ invalidArgs: 'reject' })
const generated = session.generate({
  outputDir: './test/generated/contracts',
  runOptions: {
    invalidArgs: 'reject',
  },
})
```

For `tsConfigFilePath` sessions, Spectacles memoizes the TypeScript workspace + OXC analysis, discovery result, and per-option plans. You can also create sessions directly from an in-memory discovery workspace.

The default tsconfig-based discovery/generation path now uses the TypeScript workspace + OXC scanner flow. A backend sketch plus the OXC scanner support while preserving resolver-backed module resolution lives in `docs/discovery-backends.md`, `spectacles/discovery-backend`, and `spectacles/discovery-scanner-oxc`.

## 4. Run the generated tests

Generated test files use the Vitest adapter:

```ts
import { runContractSuite } from 'spectacles/vitest'
```

So once files are generated, run them with Vitest as usual:

```bash
vitest
```

## Lower-level APIs

Spectacles also exposes lower-level building blocks if you need custom workflows:

- `spectacles/discovery` — find contracts and implementations from a discovery workspace or tsconfig path
- `spectacles/discovery-backend` — backend abstraction, workspace/resolver APIs, and compact discovery indexing
- `spectacles/discovery-scanner-oxc` — first-pass OXC-backed source scanner and tsconfig analysis helpers
- `spectacles/planning` — build a test plan from discovery results
- `spectacles/rendering` — render one planned suite to Vitest source
- `spectacles/generation` — generate full test files from discovery analysis, tsconfig input, or precomputed plans

## Current discovery model

Discovery is intentionally explicit.

Supported contract patterns:

- `export const X = contract(...)`
- `const X = contract(...); export { X }`
- `const X = contract(...); export { X as Y }`
- `export default contract(...)`
- named barrel re-exports like `export { X as Y } from './contracts'`
- default barrel re-exports like `export { default as X } from './contracts'` and `export { default } from './contracts'`
- named `export * from './contracts'` barrel forwarding

Supported implementation patterns:

- `export const X = implement(ContractRef, fn)`
- `export default implement(ContractRef, fn)`
- named barrel re-exports like `export { impl as alias } from './implementations'`
- default barrel re-exports like `export { default as implAlias } from './implementations'` and `export { default } from './implementations'`
- named `export * from './implementations'` barrel forwarding

Contract references can currently resolve through:

- same-file identifiers
- named imports
- aliased named imports
- default imports
- namespace imports
- tsconfig path aliases when using the TypeScript workspace / OXC path

## Minimal generated suite shape

Generated suites look like:

```ts
import { describe } from 'vitest'
import { runContractSuite } from 'spectacles/vitest'
import { RangeLength } from '../../src/contracts.js'
import { rangeLength } from '../../src/implementations.js'

describe('RangeLength / rangeLength', () => {
  runContractSuite({
    contract: RangeLength,
    impl: rangeLength,
    numRuns: 200,
  })
})
```

## Examples

A larger example lives in:

- `examples/todo-service`

It shows a service-shaped contract design with multiple operations, a concrete in-memory implementation, and a generation script for producing Vitest contract suites.

## Package entrypoints

Primary entrypoints:

- `spectacles` — core contract, discovery, planning, rendering, and generation APIs
- `spectacles/vitest` — Vitest adapter for generated suites
- `spectacles/discovery` — lower-level discovery utilities
- `spectacles/planning` — lower-level planning utilities
- `spectacles/rendering` — render a single planned Vitest suite
- `spectacles/generation` — end-to-end test file generation APIs
- `spectacles/session` — memoized workspace/discovery/planning session APIs

Pi package resources:
- skill: `spectacles-contract-dev`
- extension tool: `spectacles_navigate`

## Status

Spectacles is early, but the current flow is already usable:

- define contracts
- bind implementations explicitly
- generate Vitest suites from a `tsconfig.json`
- run them under Vitest
