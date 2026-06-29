# Discovery backends sketch

Spectacles discovery has two distinct jobs:

1. **Understand the project graph**
   - enumerate the source files that belong to the project
   - resolve module specifiers to source files
   - preserve canonical file paths for later rendering/import generation
2. **Scan source syntax**
   - discover exported `contract(...)` definitions
   - discover exported `implement(...)` bindings
   - resolve implementation-to-contract relationships
   - summarize the graph for planning, generation, and agent navigation

This split matters because the current `ts-morph` path is excellent at project graph and module resolution, but relatively expensive for cold startup. Spectacles discovery is now explicit enough that the syntax scan can eventually move to a faster parser such as OXC without changing the higher-level planning/rendering pipeline.

## Proposed backend split

### Layer 1: TS/resolver layer

This layer remains responsible for:

- reading `tsconfig.json`
- computing the included file set
- resolving imports, including aliases and extensionless specifiers
- preserving source-file identities used later for rendering operational imports

That layer can continue to use TypeScript resolution internally even if the syntax scanner changes.

### Layer 2: syntax scanner layer

This layer should be backend-pluggable.

Current backend:
- `ts-morph`

Planned backend:
- `oxc`

The scanner should stay **syntax-first** and **explicit**. Spectacles already benefits from explicit `contract(...)` and `implement(...)` bindings, so the scanner can avoid type-checker-heavy inference and instead focus on:

- imports
- exports
- local bindings
- call expressions
- chained builder calls

### Layer 3: pairing/index layer

Once contracts and implementations are discovered, Spectacles should build a compact relationship index.

This is useful for:

- planning test suites
- generation
- diagnostics
- future AI-agent tooling

An agent-oriented tool should not need to read whole source files just to learn:

- what contracts exist
- what implementations exist
- which implementations bind to which contracts
- which implementations are unresolved
- which contracts do not yet have implementations

That compact index is the right token-efficient payload for agent navigation.

## Current API sketch

Code-level sketch lives in:

- `src/discovery-backend.ts`

It currently introduces:

- `DiscoveryBackend<Input>`
- `DiscoveryWorkspace`
- `DiscoveryResolver`
- `createDiscoveryWorkspace(...)`
- `createInMemoryDiscoveryResolver(...)`
- `createTsMorphDiscoveryWorkspace(...)`
- `DiscoveryAstScanner`
- `scanDiscoveryWorkspace(...)`
- `pairDiscoveryWorkspaceScan(...)`
- `discoverWorkspaceWithAstScanner(...)`
- `createWorkspaceDiscoveryBackend(...)`
- `createTsMorphDiscoveryBackend()`
- `buildDiscoveryIndex(result)`
- `describeOxcDiscoveryBackendPlan()`

## OXC backend MVP

A practical first OXC-backed implementation should:

1. reuse a TS-backed resolver/file-set layer
2. build a `DiscoveryWorkspace`
3. parse source text with OXC via `DiscoveryAstScanner`
4. discover explicit contract/implementation bindings per file
5. resolve imports against the resolver layer through `pairDiscoveryWorkspaceScan(...)`
6. emit the same `DiscoveryResult` shape used today
7. build the same compact `DiscoveryIndex`

That keeps planning and generation unchanged while removing most syntax-walking dependence on `ts-morph`.

## Why this is good for AI-agent tooling

Spectacles discovery is a natural fit for direct agent consumption because contracts and implementations encode the codebase's intended behavior graph.

A future tool endpoint should prefer returning the compact discovery index instead of raw AST or full file text. That gives agents a way to:

- traverse a Spectacles codebase quickly
- find the authoritative contract for an implementation
- find the bound implementation for a contract
- focus file reads on only the relevant source nodes
- spend fewer tokens on broad codebase navigation

In other words, the same discovery engine that powers test generation can also power contract-aware agent navigation.
