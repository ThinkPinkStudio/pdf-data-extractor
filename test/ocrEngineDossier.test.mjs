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
  // senza flag: il motore configurato vale per tutti i fascicoli
  assert.equal(dossierOcrEngine({ polizzaOcrEngine: 'qwen3-vl:32b' }, [true]), 'qwen3-vl:32b')
  // Tesseract configurato: nulla cambia
  assert.equal(dossierOcrEngine({ polizzaOcrEngine: '', polizzaEngineFlags: 'ocrsoloscansioni' }, [false]), '')
  assert.equal(dossierOcrEngine({ polizzaOcrEngine: 'tesseract', polizzaEngineFlags: 'ocrsoloscansioni' }, [false]), 'tesseract')
  assert.ok('ocrsoloscansioni' in KNOWN_FLAGS)
})
