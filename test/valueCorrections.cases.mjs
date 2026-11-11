// Casi per valueCorrections.test.mjs (lanciati in un processo figlio con
// --experimental-strip-types: il modulo è TypeScript).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const webRoot = pathToFileURL(join(root, 'web') + '/').href
register(pathToFileURL(join(here, 'helpers', 'tsResolveHook.mjs')).href, { data: { webRoot } })
const { applyCorrections } = await import(pathToFileURL(join(root, 'web', 'lib', 'valueCorrections.ts')).href)
const { flattenRollingState } = await import(pathToFileURL(join(root, 'web', 'lib', 'polizzaRolling.ts')).href)

const defs = [{ id: 'a', label: 'Massimale' }, { id: 'b', label: 'Imponibile' }, { id: 'c', label: 'Lordo' }]
const state = {
  a: { valore: '50000000', fonte: { file: 'P.pdf', page: 2 } },
  b: { valore: '17,17', fonte: { file: 'P.pdf', page: 2 } },
  _reliability: { a: { reliable: 1 } },
}
const sources = { a: { file: 'P.pdf', page: 2 }, b: { file: 'P.pdf', page: 2 } }

test('valori corretti: sostituito, svuotato, aggiunto; il resto resta com\'era', () => {
  const r = applyCorrections(state, sources, defs, [
    { fieldId: 'a', value: '20.000', fonte: { file: 'P.pdf', page: 2 } },
    { fieldId: 'b', value: '' },
    { fieldId: 'c', value: '17,17' },
  ])
  assert.equal(r.ok, true)
  assert.deepEqual(flattenRollingState(r.state), { a: '20.000', c: '17,17' })
  assert.deepEqual(r.sources, { a: { file: 'P.pdf', page: 2 } }) // c senza fonte: nessuna fonte vecchia attaccata
  assert.deepEqual(r.state._reliability, state._reliability)
  assert.deepEqual(r.changed.map((c) => [c.label, c.before, c.after]), [['Massimale', '50000000', '20.000'], ['Imponibile', '17,17', ''], ['Lordo', '', '17,17']])
  // l'originale non si tocca
  assert.equal(state.a.valore, '50000000')
})

test('valori corretti: uguale a prima = nessun cambiamento; campo sconosciuto o doppio = rifiuto', () => {
  const same = applyCorrections(state, sources, defs, [{ fieldId: 'a', value: ' 50000000 ' }])
  assert.equal(same.ok, true)
  assert.equal(same.changed.length, 0)
  assert.deepEqual(applyCorrections(state, sources, defs, [{ fieldId: 'zz', value: '1' }]), { ok: false, code: 'unknown-field', fieldId: 'zz' })
  assert.equal(applyCorrections(state, sources, defs, [{ fieldId: 'a', value: '1' }, { fieldId: 'a', value: '2' }]).ok, false)
  assert.equal(applyCorrections(state, sources, defs, []).ok, false)
  assert.equal(applyCorrections(state, sources, defs, null).ok, false)
})
