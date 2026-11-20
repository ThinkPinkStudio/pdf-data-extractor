/**
 * Stato «NON VALIDO» (fascicolo senza polizza, regola dell'utente del
 * 26/09/2026) nell'interfaccia e nelle route: predicato condiviso
 * (web/lib/jobValidity.ts), rifiuto 409 delle azioni che forzerebbero
 * l'estrazione, guardia del worker prima di estrarre (policyGate), riuso
 * negato ai valori forzati senza polizza, stato di interfaccia, filtri, riga
 * di motivo e riepiloghi (web/components/jobs/model.ts); i vecchi job
 * «Accantonato» restano forzabili (decide il modello).
 *
 * I moduli sono TypeScript: i casi stanno in uiJobState.cases.mjs e girano in
 * un processo figlio con --experimental-strip-types (Node ≥ 22.6), come
 * compareEngine.test.mjs.
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

test('stato Non valido: jobValidity + model (casi in processo figlio)', () => {
  // Senza NODE_TEST_CONTEXT: sotto `node --test` il figlio lo eredita
  // ('child-v8'), riporta i risultati al padre ed esce SEMPRE 0 — il test
  // passava anche con 5 casi su 6 falliti.
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--test', join(here, 'uiJobState.cases.mjs')], { encoding: 'utf8', env })
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
})
