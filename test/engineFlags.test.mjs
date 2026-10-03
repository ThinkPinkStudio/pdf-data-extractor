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

test('flag del motore: tutti i nomi conosciuti sono in minuscolo (l\'override si confronta in minuscolo)', async () => {
  const { KNOWN_FLAGS } = await import('../src/services/engineFlags.js')
  for (const k of Object.keys(KNOWN_FLAGS)) assert.equal(k, k.toLowerCase(), k)
})
