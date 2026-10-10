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

test('flag primepagine: acceso di default (prova del 06/10), spegnibile', () => {
  assert.ok('primepagine' in KNOWN_FLAGS)
  assert.equal(engineFlag({}, 'primepagine'), true)
  assert.equal(engineFlag({ polizzaEngineFlags: '-primepagine' }, 'primepagine'), false)
})

test('[flag citazioneriga] prova che salta parole in mezzo alla riga del premio: trovata solo col flag', async () => {
  const { verifyOperativitaEvidence } = await import('../src/services/polizzaOperativita.js')
  const page = [
    '      DESCRIZIONE GARANZIE          INFORMAZIONI AGGIUNTIVE                                  PREMIO NETTO  IMPOSTE PREMIO LORDO',
    '      Tutela Legale DAS DRIVE       -                                                            24,88       3,12      28,00',
  ].join('\n')
  const ans = { esito: 'operante', documento: 3, pagina: 1, evidenza: 'Tutela Legale   -   24,88   3,12   28,00' }
  const lex = [['tutela', 'legale'], ['tutela', 'giudiziaria']]
  assert.equal(verifyOperativitaEvidence(ans, [{ ord: 3, page: 1, text: page }], { lexTokens: lex }).found, false)
  assert.equal(verifyOperativitaEvidence(ans, [{ ord: 3, page: 1, text: page }], { lexTokens: lex, lineQuote: true }).found, true)
  // parole e importi su righe diverse, o in un altro ordine: non basta
  const sparse = 'Tutela Legale DAS DRIVE\n   24,88   3,12   28,00'
  assert.equal(verifyOperativitaEvidence(ans, [{ ord: 3, page: 1, text: sparse }], { lexTokens: lex, lineQuote: true }).found, false)
})
