// VALORI CORRETTI di un dossier estratto (web/lib/valueCorrections.ts): i casi
// stanno in valueCorrections.cases.mjs e girano in un processo figlio con
// --experimental-strip-types, come polizzaReconcileOcrEngine.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

test("valori corretti: applyCorrections (casi in processo figlio)", () => {
  // Senza NODE_TEST_CONTEXT: sotto `node --test` il figlio lo eredita
  // ('child-v8'), riporta i risultati al padre ed esce SEMPRE 0 — il test
  // passerebbe anche con casi falliti (come in uiJobState.test.mjs).
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--test', join(here, 'valueCorrections.cases.mjs')], { encoding: 'utf8', env })
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
})
