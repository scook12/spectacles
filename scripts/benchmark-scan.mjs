#!/usr/bin/env node

import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'

import { createTypeScriptDiscoveryWorkspace } from '../dist/discovery-backend.js'
import { analyzeOxcDiscoveryTsConfig, analyzeOxcDiscoveryWorkspace } from '../dist/discovery-scanner-oxc.js'
import { generateVitestContractFiles, generateVitestContractFilesFromTsConfig } from '../dist/generation.js'
import { generateContractTestPlan } from '../dist/planning.js'

const tsConfigFilePath = resolve(process.argv[2] ?? 'examples/todo-service/tsconfig.json')
const outputDir = resolve(process.argv[3] ?? 'examples/todo-service/.bench-generated')
const runs = Number(process.argv[4] ?? 10)

function measure(label, fn) {
  const start = performance.now()
  const result = fn()
  const end = performance.now()
  return { label, ms: end - start, result }
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

const coldWorkspaceBootstrap = []
const coldAnalyzeTsConfig = []
const warmAnalyzeWorkspace = []
const warmPlanFromAnalysis = []
const warmGenerate = []
const coldFromTsConfigWrapper = []

for (let index = 0; index < runs; index += 1) {
  coldWorkspaceBootstrap.push(measure('cold workspace bootstrap', () => createTypeScriptDiscoveryWorkspace(tsConfigFilePath)).ms)
  coldAnalyzeTsConfig.push(measure('cold analyze(tsconfig)', () => analyzeOxcDiscoveryTsConfig(tsConfigFilePath)).ms)

  const workspace = createTypeScriptDiscoveryWorkspace(tsConfigFilePath)
  const analysis = analyzeOxcDiscoveryWorkspace(workspace)
  const plan = generateContractTestPlan(analysis)

  warmAnalyzeWorkspace.push(measure('warm analyze(workspace)', () => analyzeOxcDiscoveryWorkspace(workspace)).ms)
  warmPlanFromAnalysis.push(measure('warm plan(analysis)', () => generateContractTestPlan(analysis)).ms)
  warmGenerate.push(measure('warm generate', () => {
    return generateVitestContractFiles(analysis, {
      outputDir,
      plan,
      writeFiles: false,
    })
  }).ms)

  coldFromTsConfigWrapper.push(measure('cold from tsconfig wrapper', () => {
    return generateVitestContractFilesFromTsConfig(tsConfigFilePath, {
      outputDir,
      writeFiles: false,
    })
  }).ms)
}

console.table([
  summarize('cold TS workspace bootstrap', coldWorkspaceBootstrap),
  summarize('cold OXC analyze(tsconfig)', coldAnalyzeTsConfig),
  summarize('warm OXC analyze(workspace)', warmAnalyzeWorkspace),
  summarize('warm plan(analysis)', warmPlanFromAnalysis),
  summarize('warm generate', warmGenerate),
  summarize('cold from tsconfig wrapper', coldFromTsConfigWrapper),
])
