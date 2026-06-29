#!/usr/bin/env node

import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'

import { Project } from 'ts-morph'

import {
  analyzeDiscoveryWorkspaceWithAstScanner,
  createTypeScriptDiscoveryWorkspace,
} from '../dist/discovery-backend.js'
import { discoverProject } from '../dist/discovery.js'
import { createOxcDiscoveryAstScanner, analyzeOxcDiscoveryTsConfig } from '../dist/discovery-scanner-oxc.js'
import {
  generateVitestContractFiles,
  generateVitestContractFilesFromAnalysis,
  generateVitestContractFilesFromTsConfig,
  generateVitestContractFilesFromTsConfigWithOxc,
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

function preferredExportName(exportNames, isDefaultExport) {
  if (isDefaultExport && exportNames.includes('default')) {
    return 'default'
  }

  return exportNames[0] ?? 'default'
}

function normalizeDiscovery(discovery) {
  return {
    contracts: [...discovery.contracts]
      .map((contract) => ({
        filePath: contract.filePath,
        localName: contract.localName ?? null,
        exportNames: [...contract.exportNames],
        preferredExportName: preferredExportName(contract.exportNames, contract.isDefaultExport),
        isDefaultExport: contract.isDefaultExport,
        runtimeName: contract.runtimeName ?? null,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    implementations: [...discovery.implementations]
      .map((implementation) => ({
        filePath: implementation.filePath,
        localName: implementation.localName ?? null,
        exportNames: [...implementation.exportNames],
        preferredExportName: preferredExportName(implementation.exportNames, implementation.isDefaultExport),
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
    .map((file) => ({
      outputFilePath: file.outputFilePath,
      content: file.content,
    }))
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
  const project = new Project({ tsConfigFilePath })
  const tsMorphDiscovery = discoverProject(project)
  const tsMorphPlan = generateContractTestPlan({
    project,
    discovery: tsMorphDiscovery,
  })
  const tsMorphGenerated = generateVitestContractFiles(project, {
    outputDir,
    plan: tsMorphPlan,
    writeToProject: false,
    save: false,
  })

  const oxcAnalysis = analyzeOxcDiscoveryTsConfig(tsConfigFilePath)
  const oxcPlan = generateContractTestPlan(oxcAnalysis)
  const oxcGenerated = generateVitestContractFilesFromAnalysis(oxcAnalysis, {
    outputDir,
    plan: oxcPlan,
  })

  assertEqual('discovery', normalizeDiscovery(tsMorphDiscovery), normalizeDiscovery(oxcAnalysis.discovery))
  assertEqual('plan', normalizePlan(tsMorphPlan), normalizePlan(oxcPlan))
  assertEqual('generated files', normalizeGeneratedFiles(tsMorphGenerated), normalizeGeneratedFiles(oxcGenerated))
}

validateParity()

const samples = {
  coldTsMorphProjectBootstrap: [],
  coldTypeScriptWorkspaceBootstrap: [],
  coldTsMorphDiscover: [],
  coldOxcAnalyzeTsConfig: [],
  warmTsMorphDiscover: [],
  warmOxcAnalyzeWorkspace: [],
  warmTsMorphPlan: [],
  warmOxcPlan: [],
  warmTsMorphGenerate: [],
  warmOxcGenerate: [],
  coldTsMorphTsConfigWrapper: [],
  coldOxcTsConfigWrapper: [],
}

for (let index = 0; index < runs; index += 1) {
  samples.coldTsMorphProjectBootstrap.push(
    measure(() => {
      const project = new Project({ tsConfigFilePath })
      return project.getSourceFiles().length
    }).ms,
  )

  samples.coldTypeScriptWorkspaceBootstrap.push(
    measure(() => createTypeScriptDiscoveryWorkspace(tsConfigFilePath)).ms,
  )

  samples.coldTsMorphDiscover.push(
    measure(() => {
      const project = new Project({ tsConfigFilePath })
      return discoverProject(project)
    }).ms,
  )

  samples.coldOxcAnalyzeTsConfig.push(
    measure(() => analyzeOxcDiscoveryTsConfig(tsConfigFilePath)).ms,
  )

  const project = new Project({ tsConfigFilePath })
  const tsMorphDiscovery = discoverProject(project)
  const tsMorphPlan = generateContractTestPlan({ project, discovery: tsMorphDiscovery })

  const workspace = createTypeScriptDiscoveryWorkspace(tsConfigFilePath)
  const scanner = createOxcDiscoveryAstScanner()
  const oxcAnalysis = analyzeDiscoveryWorkspaceWithAstScanner(workspace, scanner)
  const oxcPlan = generateContractTestPlan(oxcAnalysis)

  samples.warmTsMorphDiscover.push(measure(() => discoverProject(project)).ms)
  samples.warmOxcAnalyzeWorkspace.push(measure(() => analyzeDiscoveryWorkspaceWithAstScanner(workspace, scanner)).ms)
  samples.warmTsMorphPlan.push(measure(() => generateContractTestPlan({ project, discovery: tsMorphDiscovery })).ms)
  samples.warmOxcPlan.push(measure(() => generateContractTestPlan(oxcAnalysis)).ms)
  samples.warmTsMorphGenerate.push(
    measure(() => generateVitestContractFiles(project, {
      outputDir,
      plan: tsMorphPlan,
      writeToProject: false,
      save: false,
    })).ms,
  )
  samples.warmOxcGenerate.push(
    measure(() => generateVitestContractFilesFromAnalysis(oxcAnalysis, {
      outputDir,
      plan: oxcPlan,
    })).ms,
  )

  samples.coldTsMorphTsConfigWrapper.push(
    measure(() => generateVitestContractFilesFromTsConfig(tsConfigFilePath, {
      outputDir,
      writeToProject: false,
      save: false,
    })).ms,
  )
  samples.coldOxcTsConfigWrapper.push(
    measure(() => generateVitestContractFilesFromTsConfigWithOxc(tsConfigFilePath, {
      outputDir,
      writeFiles: false,
    })).ms,
  )
}

console.table([
  summarize('cold ts-morph project bootstrap', samples.coldTsMorphProjectBootstrap),
  summarize('cold TS workspace bootstrap', samples.coldTypeScriptWorkspaceBootstrap),
  summarize('cold ts-morph discover', samples.coldTsMorphDiscover),
  summarize('cold OXC analyze(tsconfig)', samples.coldOxcAnalyzeTsConfig),
  summarize('warm ts-morph discover', samples.warmTsMorphDiscover),
  summarize('warm OXC analyze(workspace)', samples.warmOxcAnalyzeWorkspace),
  summarize('warm ts-morph plan', samples.warmTsMorphPlan),
  summarize('warm OXC plan', samples.warmOxcPlan),
  summarize('warm ts-morph generate', samples.warmTsMorphGenerate),
  summarize('warm OXC generate', samples.warmOxcGenerate),
  summarize('cold ts-morph tsconfig wrapper', samples.coldTsMorphTsConfigWrapper),
  summarize('cold OXC tsconfig wrapper', samples.coldOxcTsConfigWrapper),
])
