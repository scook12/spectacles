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

This split matters because project-graph loading and module resolution are separate concerns from syntax scanning. Spectacles discovery is explicit enough that a fast parser such as OXC can handle scanning while the TypeScript compiler API handles file-set loading and module resolution.

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
- `oxc` scanner module (`src/discovery-scanner-oxc.ts`)

Planned next step:
- continue tightening parity and simplifying the remaining pipeline around the OXC + TypeScript workspace path

The scanner should stay **syntax-first** and **explicit**. Spectacles already benefits from explicit `contract(...)` and `implement(...)` bindings, so the scanner can avoid type-checker-heavy inference and instead focus on:

- imports
- exports
- local bindings
- call expressions
- chained builder calls
- source spans and lightweight diagnostics for agent-friendly navigation

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
- `createTypeScriptDiscoveryWorkspace(...)`
- `DiscoveryAstScanner`
- `createOxcDiscoveryAstScanner(...)`
- `analyzeOxcDiscoveryTsConfig(...)`
- `createOxcDiscoveryBackend(...)`
- `ScannedSourceFile`
- `ScannedExportBinding`
- `ScannedContractClause`
- `ScannedContractClauseSummary`
- `ScannedDiscoveryDiagnostic`
- `summarizeScannedContractClauses(...)`
- `scanDiscoveryWorkspace(...)`
- `pairDiscoveryWorkspaceScan(...)`
- `analyzeDiscoveryWorkspaceWithAstScanner(...)`
- `discoverWorkspaceWithAstScanner(...)`
- `createWorkspaceDiscoveryBackend(...)`
- `buildDiscoveryIndex(result)`
- `describeOxcDiscoveryBackendPlan()`

## OXC backend MVP

The first-pass OXC-backed implementation now does the following:

1. build a resolver-backed workspace from source text or `tsconfig.json`
2. parse source text with OXC via `createOxcDiscoveryAstScanner(...)`
3. discover explicit contract/implementation bindings per file
4. attach per-file source spans, clause summaries, lightweight diagnostics, and re-export metadata
5. resolve imports and named/default/export-all barrel forwarding against the resolver layer through `pairDiscoveryWorkspaceScan(...)`
6. emit the same `DiscoveryResult` shape used today
7. support a ready-to-use backend via `createOxcDiscoveryBackend(...)`
8. preserve the compact `DiscoveryIndex` path
9. feed scanned clause summaries directly into planning without re-reading contracts through a separate AST layer
10. render and write generated test files from discovery analysis or plans without requiring any project wrapper

That keeps planning and generation unchanged while centering the pipeline on the TypeScript-compiler-backed file-set/module-resolution path plus OXC scanning.

## Why this is good for AI-agent tooling

Spectacles discovery is a natural fit for direct agent consumption because contracts and implementations encode the codebase's intended behavior graph.

A future tool endpoint should prefer returning the compact discovery index plus selected scan metadata instead of raw AST or full file text. That gives agents a way to:

- traverse a Spectacles codebase quickly
- find the authoritative contract for an implementation
- find the bound implementation for a contract
- focus file reads on only the relevant source nodes
- jump to exact source spans for contract clauses or pairings
- spend fewer tokens on broad codebase navigation

In other words, the same discovery engine that powers test generation can also power contract-aware agent navigation.
