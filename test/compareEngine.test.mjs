/**
 * Motore di Portafoglio Compare (web/lib/compare/engine.ts): somiglianza a
 * tratti di lettere consecutive, soglie scartate/da verificare/accettate,
 * «Uguale a», chiavi e profili.
 *
 * Il modulo è TypeScript: i casi stanno in compareEngine.cases.mjs e girano in
 * un processo figlio con --experimental-strip-types (Node ≥ 22.6).
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

test('compare engine (casi in processo figlio)', () => {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--test', join(here, 'compareEngine.cases.mjs')], { encoding: 'utf8' })
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`)
})
