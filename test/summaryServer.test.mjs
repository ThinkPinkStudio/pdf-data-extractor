/**
 * Riepiloghi — regole del server senza database (web/lib/summaryCompose.ts:
 * stato dei membri, campi di riferimento, creazione, anteprima, PATCH,
 * fotografie), export Excel (web/lib/summaryWorkbook.ts) e nomi di foglio
 * (web/lib/excelSheetName.ts). Le letture dal DB sono finte (dipendenze
 * iniettate); gli aggregati sono quelli veri del modulo puro.
 *
 * I moduli sono TypeScript: i casi stanno in summaryServer.cases.mjs e girano
 * in un processo figlio con --experimental-strip-types (Node ≥ 22.6), come
 * uiJobState.test.mjs.
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

test('riepiloghi: regole del server ed export (casi in processo figlio)', () => {
  // Senza NODE_TEST_CONTEXT: sotto `node --test` il figlio lo eredita e
  // uscirebbe sempre 0 anche con casi falliti (vedi uiJobState.test.mjs).
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--test', join(here, 'summaryServer.cases.mjs')], { encoding: 'utf8', env })
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
})
