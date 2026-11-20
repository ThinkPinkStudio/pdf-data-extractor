// Flag del 19/10/2026 misurati sulle copie (Lipari 28, Tutela legale 45, golden
// degli altri profili): «separatori» promosso di default; «sceltaprova» e
// «piattoovunque» bocciati e tolti.
import test from 'node:test'
import assert from 'node:assert/strict'
import { KNOWN_FLAGS, DEFAULT_FLAGS } from '../src/services/engineFlags.js'
import * as svc from '../src/services/polizzaService.js'

test('separatori di default; sceltaprova e piattoovunque tolti', () => {
  assert.ok('separatori' in KNOWN_FLAGS)
  assert.ok(DEFAULT_FLAGS.includes('separatori'))
  assert.ok(!('sceltaprova' in KNOWN_FLAGS))
  assert.ok(!('piattoovunque' in KNOWN_FLAGS))
  assert.equal(svc.closedChoiceHasEvidence, undefined)
})
