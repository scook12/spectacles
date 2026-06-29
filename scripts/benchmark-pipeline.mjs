#!/usr/bin/env node

import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'

import { createTypeScriptDiscoveryWorkspace } from '../dist/discovery-backend.js'
import { analyzeOxcDiscoveryTsConfig, analyzeOxcDiscoveryWorkspace } from '../dist/discovery-scanner-oxc.js'
import {
  generateVitestContractFiles,
  generateVitestContractFilesFromTsConfig,
} from '../dist/generation.js'
import { generateContractTestPlan } from '../dist/planning.js'

const tsConfigFilePath = resolve(process.argv[2] ?? 'examples/todo-service/tsconfig.json')
const outputDir = resolve(process.argv[3] ?? 'examples/todo-service/.bench-generated')
const runs = Number(process.argv[4] ?? 10)

if (!Number.isInteger(runs) || runs <= 0) {
  throw new TypeError(`Expected runs to be a positive integer, received: ${process.argv[4] ?? ''}`)
}

function measure(fn) {
  const start = performance.now()
  const result = fn()
  const end = performance.now()
  return { ms: end - start, result }
}

function summarize(label, samples) {
  const avg = samples.reduce((sum, sample) => sum + sample, 0) / samples.length
  return {
    step: label,
    avgMs: +avg.toFixed(2),
    minMs: +Math.min(...samples).toFixed(2),
    maxMs: +Math.max(...samples).toFixed(2),
  }
}

function normalizeDiscovery(discovery) {
  return {
    contracts: [...discovery.contracts]
      .map((contract) => ({
        filePath: contract.filePath,
        localName: contract.localName ?? null,
        exportNames: [...contract.exportNames],
        isDefaultExport: contract.isDefaultExport,
        runtimeName: contract.runtimeName ?? null,
        source: contract.source
          ? {
            filePath: contract.source.filePath,
            exportName: contract.source.exportName,
            localName: contract.source.localName ?? null,
            runtimeName: contract.source.runtimeName ?? null,
          }
          : null,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    implementations: [...discovery.implementations]
      .map((implementation) => ({
        filePath: implementation.filePath,
        localName: implementation.localName ?? null,
        exportNames: [...implementation.exportNames],
        isDefaultExport: implementation.isDefaultExport,
        contract: implementation.contract
          ? {
            filePath: implementation.contract.filePath,
            exportName: implementation.contract.exportName,
            localName: implementation.contract.localName ?? null,
            runtimeName: implementation.contract.runtimeName ?? null,
          }
          : null,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  }
}

function normalizePlan(plan) {
  return {
    suites: [...plan.suites]
      .map((suite) => ({
        suiteName: suite.suiteName,
        contract: {
          filePath: suite.contract.filePath,
          exportName: suite.contract.exportName,
          localName: suite.contract.localName,
          runtimeName: suite.contract.runtimeName ?? null,
        },
        implementation: {
          filePath: suite.implementation.filePath,
          exportName: suite.implementation.exportName,
          localName: suite.implementation.localName,
          runtimeName: suite.implementation.runtimeName ?? null,
        },
        generation: [...suite.generation],
        checks: [...suite.checks],
      }))
      .sort((left, right) => left.suiteName.localeCompare(right.suiteName)),
    contractsWithoutImplementations: [...plan.contractsWithoutImplementations]
      .map((reference) => ({
        filePath: reference.filePath,
        exportName: reference.exportName,
        localName: reference.localName,
        runtimeName: reference.runtimeName ?? null,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    unresolvedImplementations: [...plan.unresolvedImplementations]
      .map((reference) => ({
        filePath: reference.filePath,
        exportName: reference.exportName,
        localName: reference.localName,
        runtimeName: reference.runtimeName ?? null,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  }
}

function normalizeGeneratedFiles(result) {
  return [...result.files]
    .map((file) => ({ outputFilePath: file.outputFilePath, content: file.content }))
    .sort((left, right) => left.outputFilePath.localeCompare(right.outputFilePath))
}

function assertEqual(label, left, right) {
  const leftJson = JSON.stringify(left)
  const rightJson = JSON.stringify(right)
  if (leftJson !== rightJson) {
    throw new Error(`${label} mismatch\nleft: ${leftJson}\nright: ${rightJson}`)
  }
}

function validateParity() {
  const analysisFromTsConfig = analyzeOxcDiscoveryTsConfig(tsConfigFilePath)
  const workspace = createTypeScriptDiscoveryWorkspace(tsConfigFilePath)
  const analysisFromWorkspace = analyzeOxcDiscoveryWorkspace(workspace)
  const planA = generateContractTestPlan(analysisFromTsConfig)
  const planB = generateContractTestPlan(analysisFromWorkspace)
  const generatedA = generateVitestContractFiles(analysisFromTsConfig, {
    outputDir,
    plan: planA,
    writeFiles: false,
  })
  const generatedB = generateVitestContractFiles(analysisFromWorkspace, {
    outputDir,
    plan: planB,
    writeFiles: false,
  })

  assertEqual('discovery', normalizeDiscovery(analysisFromTsConfig.discovery), normalizeDiscovery(analysisFromWorkspace.discovery))
  assertEqual('plan', normalizePlan(planA), normalizePlan(planB))
  assertEqual('generated files', normalizeGeneratedFiles(generatedA), normalizeGeneratedFiles(generatedB))
}

validateParity()

const samples = {
  coldWorkspaceBootstrap: [],
  coldAnalyzeTsConfig: [],
  warmAnalyzeWorkspace: [],
  warmPlan: [],
  warmGenerate: [],
  coldTsConfigWrapper: [],
}

for (let index = 0; index < runs; index += 1) {
  samples.coldWorkspaceBootstrap.push(measure(() => createTypeScriptDiscoveryWorkspace(tsConfigFilePath)).ms)
  samples.coldAnalyzeTsConfig.push(measure(() => analyzeOxcDiscoveryTsConfig(tsConfigFilePath)).ms)

  const workspace = createTypeScriptDiscoveryWorkspace(tsConfigFilePath)
  const analysis = analyzeOxcDiscoveryWorkspace(workspace)
  const plan = generateContractTestPlan(analysis)

  samples.warmAnalyzeWorkspace.push(measure(() => analyzeOxcDiscoveryWorkspace(workspace)).ms)
  samples.warmPlan.push(measure(() => generateContractTestPlan(analysis)).ms)
  samples.warmGenerate.push(
    measure(() => generateVitestContractFiles(analysis, {
      outputDir,
      plan,
      writeFiles: false,
    })).ms,
  )
  samples.coldTsConfigWrapper.push(
    measure(() => generateVitestContractFilesFromTsConfig(tsConfigFilePath, {
      outputDir,
      writeFiles: false,
    })).ms,
  )
}

console.table([
  summarize('cold TS workspace bootstrap', samples.coldWorkspaceBootstrap),
  summarize('cold OXC analyze(tsconfig)', samples.coldAnalyzeTsConfig),
  summarize('warm OXC analyze(workspace)', samples.warmAnalyzeWorkspace),
  summarize('warm plan(analysis)', samples.warmPlan),
  summarize('warm generate', samples.warmGenerate),
  summarize('cold tsconfig wrapper', samples.coldTsConfigWrapper),
])
