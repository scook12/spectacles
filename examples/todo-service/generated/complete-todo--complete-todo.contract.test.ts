/**
 * Generated contract suite for CompleteTodo / completeTodo.
 *
 * Generation plan:
 * - [engine/sound] Generate valid argument lists from the contract args schema
 * - [contract/sound] Constrain generated argument lists using 1 structured where-clause
 * - [contract/sound] Filter generated cases through 1 precondition
 *
 * Checks:
 * - [property][engine/derived] Exercise implementations across many generated valid argument lists
 * - [property][engine/sound] Assert that returned values conform to the contract return schema
 * - [example][contract/sound] Run 1 contract example
 * - [property][contract/sound] Check 3 postconditions over generated valid argument lists
 */

import { describe } from 'vitest'
import { runContractSuite } from 'spectacles/vitest'
import { CompleteTodo } from '../contracts.js'
import { completeTodo } from '../service.js'

describe("CompleteTodo / completeTodo", () => {
  runContractSuite({
    contract: CompleteTodo,
    impl: completeTodo,
  })
})
