#!/usr/bin/env node

import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'

import { Project } from 'ts-morph'

import { discoverProject } from '../dist/discovery.js'
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

const coldProjectAndDiscover = []
const warmDiscover = []
const warmPlanFromProject = []
const warmPlanFromDiscovery = []
const warmGenerate = []
const coldFromTsConfig = []

for (let index = 0; index < runs; index += 1) {
  const cold = measure('cold project+discover', () => {
    const project = new Project({ tsConfigFilePath })
    return discoverProject(project)
  })
  coldProjectAndDiscover.push(cold.ms)

  const project = new Project({ tsConfigFilePath })
  const discovery = discoverProject(project)

  warmDiscover.push(measure('warm discover', () => discoverProject(project)).ms)
  warmPlanFromProject.push(measure('warm plan(project)', () => generateContractTestPlan(project)).ms)
  warmPlanFromDiscovery.push(measure('warm plan(discovery)', () => generateContractTestPlan(discovery)).ms)
  warmGenerate.push(measure('warm generate', () => {
    return generateVitestContractFiles(project, {
      outputDir,
      writeToProject: false,
      save: false,
    })
  }).ms)

  coldFromTsConfig.push(measure('cold from tsconfig wrapper', () => {
    return generateVitestContractFilesFromTsConfig(tsConfigFilePath, {
      outputDir,
      writeToProject: false,
      save: false,
    })
  }).ms)
}

console.table([
  summarize('cold project + discover', coldProjectAndDiscover),
  summarize('warm discover', warmDiscover),
  summarize('warm plan(project)', warmPlanFromProject),
  summarize('warm plan(discovery)', warmPlanFromDiscovery),
  summarize('warm generate', warmGenerate),
  summarize('cold from tsconfig wrapper', coldFromTsConfig),
])
