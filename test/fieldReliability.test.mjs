/**
 * Test del punteggio di affidabilità per campo e del fingerprint no-op.
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  scoreFieldReliability, extractFingerprint, ENGINE_REVISION, fieldHasChecksum, LOW_RELIABILITY,
} from '../src/main/services/fieldReliability.js'

test('scoreFieldReliability: evidenza + affinità alta → sopra soglia', () => {
  const r = scoreFieldReliability(
    { valore: 'ACQUI TERME', file: 'q.pdf', affinity: 0.6, effDate: '31/12/2025' },
    { id: 'agenzia', label: 'Agenzia' },
    { evidence: true },
  )
  assert.ok(r.reliable >= LOW_RELIABILITY, JSON.stringify(r))
  assert.ok(r.verified.includes('evidenza'))
  assert.ok(r.verified.includes('affinita'))
})

test('scoreFieldReliability: valore nudo senza evidenza → basso', () => {
  const r = scoreFieldReliability(
    { valore: 'rinvio' },
    { id: 'attivita', label: 'Attività' },
    { evidence: false },
  )
  assert.ok(r.reliable < LOW_RELIABILITY, JSON.stringify(r))
})

test('fieldHasChecksum: P.IVA valida', () => {
  assert.equal(fieldHasChecksum({ id: 'codice_fiscale_iva', label: 'P.IVA' }, '00587800137'), true)
  assert.equal(fieldHasChecksum({ id: 'agenzia', label: 'Agenzia' }, 'ACQUI'), false)
})

test('extractFingerprint: stabile a parità di input, cambia con i campi', () => {
  const a = extractFingerprint({
    fieldDefs: [{ id: 'x', label: 'N', description: 'd' }],
    promptExtra: '',
    settingsOverride: { ollamaModel: 'qwen2.5:7b-instruct' },
  })
  const b = extractFingerprint({
    fieldDefs: [{ id: 'x', label: 'N', description: 'd' }],
    promptExtra: '',
    settingsOverride: { ollamaModel: 'qwen2.5:7b-instruct' },
  })
  assert.equal(a, b)
  const c = extractFingerprint({
    fieldDefs: [{ id: 'y', label: 'N', description: 'd' }],
    promptExtra: '',
    settingsOverride: { ollamaModel: 'qwen2.5:7b-instruct' },
  })
  assert.notEqual(a, c)
  assert.equal(typeof ENGINE_REVISION, 'number')
})
