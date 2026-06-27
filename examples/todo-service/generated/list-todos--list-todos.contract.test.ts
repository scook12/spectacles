/**
 * Generated contract suite for ListTodos / listTodos.
 *
 * Generation plan:
 * - [engine/sound] Generate valid argument lists from the contract args schema
 * - [contract/sound] Constrain generated argument lists using 1 structured where-clause
 *
 * Checks:
 * - [property][engine/derived] Exercise implementations across many generated valid argument lists
 * - [property][engine/sound] Assert that returned values conform to the contract return schema
 * - [example][contract/sound] Run 1 contract example
 * - [property][contract/sound] Check 5 postconditions over generated valid argument lists
 * - [property][contract/sound] Check 1 law with additional quantified data
 */

import { describe } from 'vitest'
import { runContractSuite } from 'spectacles/vitest'
import { ListTodos } from '../contracts.js'
import { listTodos } from '../service.js'

describe("ListTodos / listTodos", () => {
  runContractSuite({
    contract: ListTodos,
    impl: listTodos,
  })
})
