/**
 * La verità di PERTINENZA dei fascicoli golden (test/fixtures/pertinenza-golden-
 * expected.json, misurata con scripts/pertinenza-eval.mjs --cases) deve restare
 * allineata ai golden a verità piena (scripts/golden-cases.mjs, FULL_CASES):
 * stessi casi, cartelle, file e profili. Un golden valido è una polizza vera del
 * suo profilo → «operante»; un golden «non-valido» (nessuna polizza) → «non
 * valido». Niente Ollama.
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { FULL_CASES, FULL_PROFILES } from '../scripts/golden-cases.mjs'

const spec = JSON.parse(readFileSync(new URL('./fixtures/pertinenza-golden-expected.json', import.meta.url), 'utf8'))
const profiles = JSON.parse(readFileSync(new URL(`../${FULL_PROFILES}`, import.meta.url), 'utf8'))

test('pertinenza-golden-expected: un caso per ogni golden a verità piena, stessi cartella/file/profilo', () => {
  // profilo PER CASO: la testa è null apposta (una versione dello script che legge un solo profilo si ferma)
  assert.equal(spec.profile, null)
  assert.equal(spec.recursive, true, 'cartelle lette ricorsivamente, come FULL_CASES (bolchini-tl: la polizza sta in «…/POLIZZA»)')
  assert.deepEqual(spec.cases.map((c) => c.id), FULL_CASES.map((c) => c.id))
  const names = new Set(profiles.map((p) => p.name))
  for (const g of FULL_CASES) {
    const c = spec.cases.find((x) => x.id === g.id)
    assert.equal(c.profile, g.profile, g.id)
    assert.ok(names.has(c.profile), `profilo «${c.profile}» assente da ${FULL_PROFILES}`)
    assert.equal(c.dir, g.dir, g.id)
    assert.deepEqual(c.files || null, g.files || null, g.id)
    assert.equal(c.expected, g.expect === 'non-valido' ? 'non valido' : 'operante', g.id)
  }
})
