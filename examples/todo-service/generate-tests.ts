import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateVitestContractFilesFromTsConfig } from '../../generation.ts'

const here = dirname(fileURLToPath(import.meta.url))

const result = generateVitestContractFilesFromTsConfig(resolve(here, 'tsconfig.json'), {
  outputDir: resolve(here, 'generated'),
  runOptions: {
    numRuns: 100,
    timeoutMs: 10_000,
  },
})

console.log(`Generated ${result.files.length} file(s):`)
for (const file of result.files) {
  console.log(`- ${file.outputFilePath}`)
}
