/**
 * Generated contract suite for DeleteTodo / deleteTodo.
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
 * - [property][contract/sound] Check 2 postconditions over generated valid argument lists
 */

import { describe } from 'vitest'
import { runContractSuite } from 'spectacles/vitest'
import { DeleteTodo } from '../contracts.js'
import { deleteTodo } from '../service.js'

describe("DeleteTodo / deleteTodo", () => {
  runContractSuite({
    contract: DeleteTodo,
    impl: deleteTodo,
  })
})
