/**
 * Generated contract suite for CreateTodo / createTodo.
 *
 * Generation plan:
 * - [engine/sound] Generate valid argument lists from the contract args schema
 * - [contract/sound] Constrain generated argument lists using 1 structured where-clause
 *
 * Checks:
 * - [property][engine/derived] Exercise implementations across many generated valid argument lists
 * - [property][engine/sound] Assert that returned values conform to the contract return schema
 * - [example][contract/sound] Run 1 contract example
 * - [property][contract/sound] Check 4 postconditions over generated valid argument lists
 */

import { describe } from 'vitest'
import { runContractSuite } from 'spectacles/vitest'
import { CreateTodo } from '../contracts.js'
import { createTodo } from '../service.js'

describe("CreateTodo / createTodo", () => {
  runContractSuite({
    contract: CreateTodo,
    impl: createTodo,
  })
})
