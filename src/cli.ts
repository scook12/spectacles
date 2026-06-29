import { generateVitestContractFilesFromTsConfig } from './generation.js'

export interface CliIo {
  readonly out: (message: string) => void
  readonly err: (message: string) => void
}

export interface ParsedGenerateCommand {
  readonly kind: 'generate'
  readonly tsConfigFilePath: string
  readonly outputDir: string
  readonly numRuns?: number
  readonly timeoutMs?: number
  readonly seed?: number
  readonly invalidArgs: 'skip' | 'reject'
  readonly includePlanComments: boolean
  readonly dryRun: boolean
}

export interface ParsedHelpCommand {
  readonly kind: 'help'
}

export type ParsedCliCommand = ParsedGenerateCommand | ParsedHelpCommand

const HELP_TEXT = `Spectacles

Usage:
  spectacles generate --tsconfig <tsconfig.json> --out <generated-test-dir> [options]
  spectacles --help

Options:
  -p, --tsconfig <path>   Path to tsconfig.json used to discover source files
      --project <path>    Alias for --tsconfig
  -o, --out <dir>         Output directory for generated contract test files
      --runs <number>     Number of property-based test runs per suite
      --timeout <ms>      Timeout passed to generated Vitest tests
      --seed <number>     fast-check seed for deterministic generation
      --invalid <mode>    Invalid-arg strategy: skip | reject
      --no-comments       Omit plan comments in generated test files
      --dry-run           Do not write files; only report what would be generated
  -h, --help              Show this help message
`

function parseIntegerOption(flag: string, rawValue: string | undefined): number {
  if (rawValue === undefined) {
    throw new TypeError(`Missing value for ${flag}`)
  }

  const value = Number(rawValue)
  if (!Number.isInteger(value)) {
    throw new TypeError(`Invalid integer for ${flag}: ${rawValue}`)
  }

  return value
}

export function parseCliArgs(argv: readonly string[]): ParsedCliCommand {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return { kind: 'help' }
  }

  const [firstArg, ...restArgs] = argv
  const command = firstArg?.startsWith('-') ? 'generate' : firstArg
  const optionArgs = firstArg?.startsWith('-') ? [...argv] : restArgs

  if (command !== 'generate') {
    throw new TypeError(`Unknown command: ${command}`)
  }

  let tsConfigFilePath: string | undefined
  let outputDir: string | undefined
  let numRuns: number | undefined
  let timeoutMs: number | undefined
  let seed: number | undefined
  let includePlanComments = true
  let dryRun = false
  let invalidArgs: 'skip' | 'reject' = 'skip'

  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index]

    switch (arg) {
      case '--project':
      case '--tsconfig':
      case '-p':
        tsConfigFilePath = optionArgs[index + 1]
        index += 1
        break
      case '--out':
      case '-o':
        outputDir = optionArgs[index + 1]
        index += 1
        break
      case '--runs':
        numRuns = parseIntegerOption('--runs', optionArgs[index + 1])
        index += 1
        break
      case '--timeout':
        timeoutMs = parseIntegerOption('--timeout', optionArgs[index + 1])
        index += 1
        break
      case '--seed':
        seed = parseIntegerOption('--seed', optionArgs[index + 1])
        index += 1
        break
      case '--invalid': {
        const value = optionArgs[index + 1]
        if (value !== 'skip' && value !== 'reject') {
          throw new TypeError(`Invalid value for --invalid: ${value ?? ''}`)
        }
        invalidArgs = value
        index += 1
        break
      }
      case '--no-comments':
        includePlanComments = false
        break
      case '--dry-run':
        dryRun = true
        break
      default:
        throw new TypeError(`Unknown option: ${arg}`)
    }
  }

  if (!tsConfigFilePath) {
    throw new TypeError('Missing required option: --tsconfig')
  }

  if (!outputDir) {
    throw new TypeError('Missing required option: --out')
  }

  return {
    kind: 'generate',
    tsConfigFilePath,
    outputDir,
    invalidArgs,
    includePlanComments,
    dryRun,
    ...(numRuns !== undefined ? { numRuns } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(seed !== undefined ? { seed } : {}),
  }
}

export function formatCliHelp(): string {
  return HELP_TEXT
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = {
    out: (message) => console.log(message),
    err: (message) => console.error(message),
  },
): Promise<number> {
  let command: ParsedCliCommand

  try {
    command = parseCliArgs(argv)
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    io.err('')
    io.err(formatCliHelp())
    return 1
  }

  if (command.kind === 'help') {
    io.out(formatCliHelp())
    return 0
  }

  const result = generateVitestContractFilesFromTsConfig(command.tsConfigFilePath, {
    outputDir: command.outputDir,
    includePlanComments: command.includePlanComments,
    writeFiles: !command.dryRun,
    runOptions: {
      ...(command.numRuns !== undefined ? { numRuns: command.numRuns } : {}),
      ...(command.timeoutMs !== undefined ? { timeoutMs: command.timeoutMs } : {}),
      ...(command.seed !== undefined ? { seed: command.seed } : {}),
      ...(command.invalidArgs !== 'skip' ? { invalidArgs: command.invalidArgs } : {}),
    },
  })

  io.out(`Generated ${result.files.length} contract test file(s).`)
  for (const file of result.files) {
    io.out(`- ${file.outputFilePath}`)
  }

  if (result.plan.contractsWithoutImplementations.length > 0) {
    io.out('')
    io.out(`Contracts without implementations: ${result.plan.contractsWithoutImplementations.length}`)
    for (const contract of result.plan.contractsWithoutImplementations) {
      io.out(`- ${contract.filePath}#${contract.exportName}`)
    }
  }

  if (result.plan.unresolvedImplementations.length > 0) {
    io.out('')
    io.out(`Unresolved implementations: ${result.plan.unresolvedImplementations.length}`)
    for (const implementation of result.plan.unresolvedImplementations) {
      io.out(`- ${implementation.filePath}#${implementation.exportName}`)
    }
  }

  return 0
}
