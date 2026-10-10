// Stadio A.7: la cella sotto la colonna di un ALTRO campo importo non è il
// dato del campo (replay dei log della corsa TL3 del 03/10/2026: «3.784,00»
// sotto «Lordo» come massimale per sinistro, «Totale» corretto in «Premio
// netto» per il premio lordo, lo «0,00» degli interessi spostato sul PREMIO
// LORDO delle schede DAS condominio). Decidono le TESTE delle descrizioni del
// profilo, mai le label.
import test from 'node:test'
import assert from 'node:assert/strict'
import { amountColumnOwner, headerLexOf } from '../src/services/polizzaService.js'
import { pickSemanticCandidate } from '../src/services/polizzaValidation.js'

// Teste delle descrizioni del profilo «Tutela Legale 3» (v4); le label sono
// volutamente neutre: la regola non le legge.
const F = (id, description) => ({ id, label: `campo ${id}`, description })
const massimale = F('m1', 'Massimale per sinistro: l\'importo massimo (in euro) che la compagnia paga per ogni singolo sinistro (es. 20.000). Se il documento riporta più importi, scegli quello associato al singolo sinistro, non quello annuale né il premio.')
const imponibile = F('p1', 'Premio imponibile (netto) ANNUO della tutela legale: la base imponibile del premio, al netto di imposte, diritti e interessi. È un importo con due decimali (es. 207,83).')
const interessi = F('p2', 'Interessi di frazionamento della tutela legale: l\'importo (in euro) aggiunto al premio annuo se il pagamento è rateizzato (es. 0,00, 2,48). È un importo con due decimali.')
const diritti = F('p3', 'Diritti della tutela legale: l\'importo (in euro) dei diritti sul premio annuo (es. 0,00, 2,48). È un importo con due decimali.')
const imposte = F('p4', 'Imposte sul premio annuo della tutela legale: l\'importo (in euro) delle imposte (es. 19,30). È un importo con due decimali. NON il premio lordo né l\'imponibile.')
const lordo = F('p5', 'Premio lordo ANNUO della tutela legale: l\'importo (in euro) comprensivo di imposte, diritti e interessi (es. 255,00). È un importo con due decimali.')
const piva = F('t1', 'Partita IVA o codice fiscale del contraente: il codice fiscale o la partita IVA (es. 01563680162).')
const compagnia = F('t2', 'Compagnia assicuratrice: il nome dell\'impresa che presta l\'assicurazione assicurato (es. ARAG SE).')
const FIELDS = [massimale, imponibile, interessi, diritti, imposte, lordo, piva, compagnia]

test('la colonna «Lordo» è del premio lordo: il massimale non la prende', () => {
  assert.equal(amountColumnOwner(massimale, 'Lordo', FIELDS), lordo)
  assert.equal(amountColumnOwner(lordo, 'Lordo', FIELDS), null, 'per il premio lordo è la sua colonna')
})

test('«Premio netto» è dell\'imponibile: il premio lordo non si «corregge» lì', () => {
  assert.equal(amountColumnOwner(lordo, 'Premio netto', FIELDS), imponibile)
  assert.equal(amountColumnOwner(imponibile, 'Premio netto', FIELDS), null)
  // «Totale» non nomina nessun campo: resta al premio lordo che l'ha letto
  assert.equal(amountColumnOwner(lordo, 'Totale', FIELDS), null)
})

test('le parole CONDIVISE non distinguono: «Premio lordo annuo» non è dell\'imponibile', () => {
  assert.ok(headerLexOf(imponibile, 'Premio lordo annuo (comprensivo delle riduzioni)') > 0, 'premio e annuo stanno anche nella testa dell\'imponibile')
  assert.equal(amountColumnOwner(imponibile, 'Premio lordo annuo (comprensivo delle riduzioni)', FIELDS), lordo)
  assert.equal(amountColumnOwner(lordo, 'TOTALE NETTO ANNUO DI POLIZZA', FIELDS), imponibile)
})

test('una parola PROPRIA tiene la colonna: intestazione fusa «FRAZIONAMENTO NETTO IMPONIBILE» resta degli interessi', () => {
  assert.equal(amountColumnOwner(interessi, 'FRAZIONAMENTO NETTO IMPONIBILE', FIELDS), null)
  // ma la correzione verso «PREMIO LORDO» è verso la colonna di un altro campo
  assert.equal(amountColumnOwner(interessi, 'PREMIO LORDO', FIELDS), lordo)
  assert.equal(amountColumnOwner(interessi, 'DIRITTI', FIELDS), diritti)
  assert.equal(amountColumnOwner(diritti, 'INTERESSE DI FRAZIONAMENTO', FIELDS), interessi)
  assert.equal(amountColumnOwner(diritti, 'DIRITTI', FIELDS), null)
})

test('solo tra campi importo: «fiscale» o «assicurato» non danno la colonna alla P.IVA o alla compagnia', () => {
  assert.equal(amountColumnOwner(massimale, 'Capitale Assicurato', FIELDS), null)
  // la colonna dell'antiracket nomina «premio» (campi importo), non i diritti
  assert.notEqual(amountColumnOwner(diritti, 'DETTAGLIO FISCALE DEL PREMIO - Antiracket', FIELDS), piva)
  assert.equal(amountColumnOwner(piva, 'Partita IVA', FIELDS), null, 'un campo non importo non è mai giudicato')
})

test('nessuna intestazione: nessun proprietario', () => {
  assert.equal(amountColumnOwner(massimale, '', FIELDS), null)
  assert.equal(amountColumnOwner(massimale, 'col3', FIELDS), null)
})

test('A.7: tra due righe di tabella la recency del DOCUMENTO viene prima (tableRecency)', () => {
  // VERRO 89: rinnovo 2026-2027 «dal 30/06/26» contro la rata iniziale della scheda 2020
  const rinnovo = { valore: '179,00', tableRow: true, structLex: 0.5, rowLex: 0, affinity: 0.8, effDate: '30/06/2027', file: 'rinnovo.pdf' }
  const scheda = { valore: '175,73', tableRow: true, structLex: 1, rowLex: 0.5, affinity: 0.9, effDate: '30/06/2021', file: 'scheda.pdf' }
  assert.equal(pickSemanticCandidate(rinnovo, scheda, 'anagrafica', { tableRecency: true }), rinnovo)
  assert.equal(pickSemanticCandidate(scheda, rinnovo, 'anagrafica', { tableRecency: true }), rinnovo)
  // senza l'opzione (altri stadi: effDate può essere il valore) resta lo spareggio strutturale
  assert.equal(pickSemanticCandidate(rinnovo, scheda, 'anagrafica'), scheda)
  // stessa data: decide ancora l'evidenza strutturale
  const totale = { ...rinnovo, valore: '18.000,00', structLex: 1, rowLex: 1 }
  const comp = { ...rinnovo, valore: '2.250,00', structLex: 1, rowLex: 0.33 }
  assert.equal(pickSemanticCandidate(totale, comp, 'anagrafica', { tableRecency: true }), totale)
})
