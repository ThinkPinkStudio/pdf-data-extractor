// [flag ocrsoloscansioni] Il modello visivo come OCR solo nei fascicoli di sole
// scansioni (06/10/2026: P07/P24/P37 migliorano; P11/P20/P35, con copie firmate
// scansionate di documenti digitali, si bloccavano in pertinenza).
import test from 'node:test'
import assert from 'node:assert/strict'
import { dossierOcrEngine } from '../src/services/polizzaService.js'
import { KNOWN_FLAGS } from '../src/services/engineFlags.js'

test('dossierOcrEngine: modello visivo solo senza testo digitale, col flag', () => {
  const on = { polizzaOcrEngine: 'qwen3-vl:32b', polizzaEngineFlags: 'ocrsoloscansioni' }
  assert.equal(dossierOcrEngine(on, [false, false]), 'qwen3-vl:32b')
  assert.equal(dossierOcrEngine(on, [false, true]), '')
  // flag di default: con un file digitale Tesseract; spento: il motore configurato vale per tutti
  assert.equal(dossierOcrEngine({ polizzaOcrEngine: 'qwen3-vl:32b' }, [true]), '')
  assert.equal(dossierOcrEngine({ polizzaOcrEngine: 'qwen3-vl:32b', polizzaEngineFlags: '-ocrsoloscansioni' }, [true]), 'qwen3-vl:32b')
  // Tesseract configurato: nulla cambia
  assert.equal(dossierOcrEngine({ polizzaOcrEngine: '', polizzaEngineFlags: 'ocrsoloscansioni' }, [false]), '')
  assert.equal(dossierOcrEngine({ polizzaOcrEngine: 'tesseract', polizzaEngineFlags: 'ocrsoloscansioni' }, [false]), 'tesseract')
  assert.ok('ocrsoloscansioni' in KNOWN_FLAGS)
})

test('normalizeDateValue: un giorno che il mese non ha non è una data (OCR «31/09/2022»)', async () => {
  const { normalizeDateValue } = await import('../src/services/polizzaDates.js')
  assert.equal(normalizeDateValue('31/09/2022'), null)
  assert.equal(normalizeDateValue('30/02/2026'), null)
  assert.equal(normalizeDateValue('29/02/2023'), null)
  assert.equal(normalizeDateValue('29/02/2024'), '29/02/2024')
  assert.equal(normalizeDateValue('31/10/2022'), '31/10/2022')
  assert.equal(normalizeDateValue('31/01/26'), '31/01/2026')
})
