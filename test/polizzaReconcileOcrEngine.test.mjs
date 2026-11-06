/**
 * LETTURA PRELIMINARE DI RICONCILIAZIONE = SOLO TESSERACT (approccio B).
 *
 * Perché: la riconciliazione legge i NUMERI DI POLIZZA (anche sporchi) per
 * unire/dividere i fascicoli; il matching è già tollerante all'OCR
 * (ocrNorm/oneIndel/knownNumbersInPages in policyReconcile.js). Prima, coi
 * fascicoli di sole scansioni, `dossierOcrEngine` sceglieva il modello visivo
 * (qwen3-vl:32b) e la lettura preliminare passava da millisecondi a MINUTI per
 * pagina: batch fermo per ore, interfaccia congelata. Ora
 * web/lib/polizzaReconcile.ts usa SEMPRE `polizzaOcrEngine: 'tesseract'`.
 *
 * I moduli sono TypeScript: i casi stanno in polizzaReconcileOcrEngine.cases.mjs
 * e girano in un processo figlio con --experimental-strip-types (Node ≥ 22.6),
 * come compareEngine.test.mjs e uiJobState.test.mjs.
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

test('riconciliazione = Tesseract: motore, chiave di cache, worker (casi in processo figlio)', () => {
  // Senza NODE_TEST_CONTEXT: sotto `node --test` il figlio lo eredita
  // ('child-v8'), riporta i risultati al padre ed esce SEMPRE 0 — il test
  // passerebbe anche con casi falliti (come in uiJobState.test.mjs).
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--test', join(here, 'polizzaReconcileOcrEngine.cases.mjs')], { encoding: 'utf8', env })
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
})
