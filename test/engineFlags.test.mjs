import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { DEFAULT_FLAGS, engineFlag, engineFlags, engineFlagsLabel } from '../src/services/engineFlags.js'

test('flag del motore: default, accensione, spegnimento, nomi sconosciuti ignorati', () => {
  assert.deepEqual([...engineFlags({})].sort(), [...DEFAULT_FLAGS].sort())
  assert.equal(engineFlag({ polizzaEngineFlags: 'campi' }, 'campi'), true)
  assert.equal(engineFlag({ polizzaEngineFlags: 'CAMPI, pippo' }, 'campi'), true)
  assert.equal(engineFlags({ polizzaEngineFlags: 'pippo' }).has('pippo'), false)
  assert.equal(engineFlag({ polizzaEngineFlags: 'campi -campi' }, 'campi'), false)
  assert.equal(engineFlagsLabel({ polizzaEngineFlags: 'nessuno' }), 'nessuno')
})
