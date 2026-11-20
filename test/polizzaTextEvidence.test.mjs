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

test('arbitro, DATE: l\'affinità non fa vincere una data più vecchia (P11: polizza 2025 etichettata contro il rinnovo 2026 di A.8)', () => {
  const rinnovo = { valore: '30/06/2026', affinity: 0.48, effDate: '30/06/2027' }
  const vecchia = { valore: '30/06/2025', affinity: 0.70, effDate: '30/06/2025', tableRow: true, labelToken: 'decorrenza' }
  assert.equal(pickSemanticCandidate(rinnovo, vecchia, 'anagrafica'), rinnovo)
  // la data più nuova segue la logica di sempre: etichettata e molto più affine resta
  const nuovaDebole = { valore: '30/06/2026', affinity: 0.40, effDate: '30/06/2026' }
  const etichettata = { valore: '30/06/2025', affinity: 0.70, effDate: '30/06/2025', tableRow: true }
  assert.equal(pickSemanticCandidate(etichettata, nuovaDebole, 'anagrafica'), etichettata)
  // un preventivo non tiene il campo con la sua data più nuova
  const preventivo = { valore: '28/07/2027', affinity: 0.5, effDate: '28/07/2027', preContract: true }
  const polizza = { valore: '28/07/2026', affinity: 0.7, effDate: '28/07/2026' }
  assert.equal(pickSemanticCandidate(preventivo, polizza, 'anagrafica'), polizza)
})

test('coerenza premio: diritti o interessi uguali al premio, imponibile uguale al lordo → svuotati (il lordo resta)', async () => {
  const { validateCrossFields } = await import('../src/services/polizzaValidation.js')
  const fields = [
    { id: 'imp', label: 'Premio imponibile tutela legale', description: 'Premio imponibile (netto) ANNUO della tutela legale: la base imponibile.' },
    { id: 'tot', label: 'Premio lordo totale tutela legale', description: 'Premio lordo ANNUO della tutela legale: comprensivo di imposte.' },
    { id: 'dir', label: 'Diritti', description: 'Diritti della tutela legale: l\'importo dei diritti (es. 0,00, 2,48).' },
    { id: 'int', label: 'Interessi di frazionamento', description: 'Interessi di frazionamento della tutela legale: l\'importo (es. 0,00).' },
  ]
  const best = { imp: { valore: '30,01' }, tot: { valore: '30,01' }, dir: { valore: '30,01' }, int: { valore: '0,00' } }
  validateCrossFields(best, fields)
  assert.ok(!('imp' in best), 'imponibile = lordo')
  assert.ok(!('dir' in best), 'diritti = premio')
  assert.equal(best.tot.valore, '30,01')
  assert.equal(best.int.valore, '0,00', 'lo zero resta')
})

test('tasso per mille: un numero che nel documento è solo una percentuale non è il tasso (ITAS P35: 21,25 delle imposte)', async () => {
  const { onlyAsPercentInText } = await import('../src/services/polizzaService.js')
  const f = { id: 't', label: 'campo', description: 'Tasso di regolazione: il tasso espresso per mille (‰) applicato al parametro di regolazione (es. 0,245, 44,16).' }
  assert.equal(onlyAsPercentInText(f, 'Imposte 21,25% € 1.054,15', '21,25'), true)
  assert.equal(onlyAsPercentInText(f, 'Tasso 2,450 ‰ sulle retribuzioni', '2,450'), false)
  assert.equal(onlyAsPercentInText(f, 'tasso 21,25 per mille; imposte 21,25%', '21,25'), false, 'compare anche senza %')
  assert.equal(onlyAsPercentInText({ ...f, description: 'Tasso percentuale (es. 3%)' }, 'aliquota 3%', '3'), false, 'solo se la descrizione dice per mille')
})
