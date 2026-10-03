// Campi di TESTO: la cella della scheda contro la prosa delle condizioni e
// contro le caselle del questionario delle esigenze (giro TL3 del 28/09/2026,
// schede DAS Difesa Condominio: 14 «Parametro regolazione» presi dall'art. 17
// delle condizioni, 9 «Garanzie scelte» prese dal questionario IDD).
import test from 'node:test'
import assert from 'node:assert/strict'
import { textCellEvidence, sanitizeFieldValue } from '../src/services/polizzaService.js'
import { pickSemanticCandidate } from '../src/services/polizzaValidation.js'
import { isQuestionnairePageTitle, isQuestionnaireTitle } from '../src/services/polizzaFactsRegistry.js'

// Righe reali (griglia pdf.js) della scheda CALDARA 7 CONDOMINIO.pdf
const scheda = [
  '   PARAMETRI TARIFFA ATTIVATI   X   Unità Immobiliari   : 17',
  '   Difesa Condominio - ed.2019            159,99      34,00     193,99',
].join('\n')
const condizioni = '   premio . Tale parametro è costituito dal numero degli addetti e/o del fatturato annuo, o altro diverso parametro concordato dalle parti .'
const idd = [
  'VALUTAZIONE DELLE RICHIESTE ED ESIGENZE ASSICURATIVE',
  '   DIFENDE',
  '   ALTRO SOGGETTO   X   Condominio   Cooperativa (RD)   X   Tutela legale del condominio',
].join('\n')
const doc = { name: 'CALDARA 7 CONDOMINIO.pdf', spatialPages: [scheda, condizioni, idd], pages: [scheda, condizioni, idd], qPages: new Set([3]) }

test('textCellEvidence: cella della scheda, prosa delle condizioni, opzione del solo questionario', () => {
  assert.deepEqual(textCellEvidence(doc, 'Unità Immobiliari'), { cellKind: 'cell', qOnly: false })
  assert.deepEqual(textCellEvidence(doc, 'numero degli addetti e/o del fatturato annuo'), { cellKind: 'prose', qOnly: false })
  assert.deepEqual(textCellEvidence(doc, 'Difesa Condominio - ed.2019'), { cellKind: 'cell', qOnly: false })
  assert.deepEqual(textCellEvidence(doc, 'Tutela legale del condominio'), { cellKind: 'cell', qOnly: true })
  assert.deepEqual(textCellEvidence(doc, 'Assente dal testo'), {})
})

test('la pagina «Valutazione delle richieste ed esigenze» è un questionario; il documento che COMINCIA col riepilogo delle esigenze no', () => {
  assert.equal(isQuestionnairePageTitle(idd), true)
  // Allianz: «Riepilogo delle richieste ed esigenze…» in testa alla polizza
  assert.equal(isQuestionnaireTitle('Riepilogo delle richieste ed esigenze assicurative del cliente Easy Drive Autovetture - Autotassametri Polizza'), false)
  assert.equal(isQuestionnairePageTitle('Riepilogo delle richieste ed esigenze assicurative del cliente   Easy Drive'), false)
})

test('arbitro: a pari data la cella batte la prosa e l\'opzione del solo questionario, anche con affinità più alta', () => {
  const day = '31/12/2020'
  const cella = { valore: 'X Unità Immobiliari', affinity: 0.51, effDate: day, cellKind: 'cell', qOnly: false }
  const prosa = { valore: 'numero degli addetti e/o del fatturato annuo', affinity: 0.68, effDate: day, cellKind: 'prose', qOnly: false }
  assert.equal(pickSemanticCandidate(cella, prosa, 'anagrafica'), cella)
  assert.equal(pickSemanticCandidate(prosa, cella, 'anagrafica'), cella)
  const riga = { valore: 'Difesa Condominio - ed.2019', affinity: 0.47, effDate: day, cellKind: 'cell', qOnly: false }
  const opzione = { valore: 'Tutela legale del condominio', affinity: 0.64, effDate: day, cellKind: 'cell', qOnly: true }
  assert.equal(pickSemanticCandidate(riga, opzione, 'anagrafica'), riga)
  // la recency resta prima: una prosa di un documento più recente vince
  const prosaNuova = { ...prosa, effDate: '31/12/2025' }
  assert.equal(pickSemanticCandidate(cella, prosaNuova, 'anagrafica'), prosaNuova)
  // senza evidenza (importi, valori non trovati) l'arbitro di sempre: promozione per affinità
  const a = { valore: 'A', affinity: 0.4, effDate: day }
  const b = { valore: 'B', affinity: 0.7, effDate: day }
  assert.equal(pickSemanticCandidate(a, b, 'anagrafica'), b)
})

test('casella barrata davanti a un testo: resta la voce', () => {
  const parametro = { id: 'p', label: 'campo', description: 'Parametro su cui si calcola o si regola il premio: il NOME del parametro dichiarato in polizza, come TESTO (es. Retribuzioni, Fatturato).' }
  assert.equal(sanitizeFieldValue(parametro, 'X Unità Immobiliari'), 'Unità Immobiliari')
  assert.equal(sanitizeFieldValue(parametro, '[x] Fatturato'), 'Fatturato')
  assert.equal(sanitizeFieldValue(parametro, 'Xerox addetti'), 'Xerox addetti')
})
