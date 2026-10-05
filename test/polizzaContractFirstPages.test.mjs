// [flag primepagine] Domanda sulla polizza: il primo batch con le SOLE prime
// pagine dei documenti (05/10/2026, DAS ARENA: la scheda scansionata a pag. 1
// insieme a venti parti di set informativo dava «presente» o «assente» a
// seconda della corsa).
import test from 'node:test'
import assert from 'node:assert/strict'
import { selectContrattoPages } from '../src/services/polizzaOperativita.js'
import { engineFlag, KNOWN_FLAGS } from '../src/services/engineFlags.js'

const page = (ord, p, text, first = p === 1) => ({ ord, page: p, text, flat: text, first })
const cands = [
  page(1, 1, 'DAS in Condominio N. PROPOSTA DATI ANAGRAFICI DATI CONTRATTUALI DECORRENZA SCADENZA'),
  page(1, 2, 'DIP Documento informativo precontrattuale'),
  page(1, 3, 'Condizioni generali di assicurazione'),
  page(2, 1, 'Quietanza di pagamento'),
  page(2, 2, 'Informativa privacy'),
]

test('selectContrattoPages: senza il flag le prime pagine aprono il batch e le altre lo riempiono', () => {
  const got = selectContrattoPages(cands, { budgetChars: 100000 }).map((c) => `${c.ord}.${c.page}`)
  assert.deepEqual(got, ['1.1', '1.2', '1.3', '2.1', '2.2'])
})

test('selectContrattoPages firstsOnly: il primo batch ha solo le prime pagine; il resto va dopo', () => {
  const first = selectContrattoPages(cands, { budgetChars: 100000, firstsOnly: true }).map((c) => `${c.ord}.${c.page}`)
  assert.deepEqual(first, ['1.1', '2.1'])
  const rest = cands.filter((c) => !first.includes(`${c.ord}.${c.page}`))
  assert.deepEqual(selectContrattoPages(rest, { budgetChars: 100000, firstsOnly: true }).map((c) => `${c.ord}.${c.page}`), ['1.2', '1.3', '2.2'])
})

test('flag primepagine: conosciuto, spento di default', () => {
  assert.ok('primepagine' in KNOWN_FLAGS)
  assert.equal(engineFlag({}, 'primepagine'), false)
  assert.equal(engineFlag({ polizzaEngineFlags: 'primepagine' }, 'primepagine'), true)
})
