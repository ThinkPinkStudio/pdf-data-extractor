// Tre filtri del motore che scartavano risposte giuste (verifica RC Prof V3 del
// 19/11/2026, Dell'Oro e Casella): citazioni su due colonne, pagine di
// questionario come fonte dei dati della polizza, filtro degli elenchi senza
// il testo della voce.
import test from 'node:test'
import assert from 'node:assert/strict'
import { evidenceInContext, segmentAcrossColumns, normForMatch, passesStagedEvidence } from '../src/services/polizzaValidation.js'
import { isQuestionnairePageTitle } from '../src/services/polizzaFactsRegistry.js'
import { isQuestionnaireSourced, listItemContext } from '../src/services/polizzaService.js'
import { KNOWN_FLAGS } from '../src/services/engineFlags.js'

// Pag. 15 della polizza Lloyd's «RC Professionale Area Tecnica» (griglia pdf.js):
// l'elenco delle attività comprese è su DUE colonne.
const LLOYDS_P15 = [
  '[Documento 1 · pag. 15]',
  '          Sono comprese in garanzia, a titolo esemplificativo, e subordinatamente alle condizioni ed esclusioni previste',
  '          dalla polizza:',
  '           ▪ Attività di progettista;                   ▪ Attività di certificazione ambientale;',
  '           ▪ Attività di project management nelle costruzioni ▪ Rilascio di certificazioni, dichiarazioni e/o relazioni, stime e',
  '           ▪ Attività di verifica degli elaborati progettuali ai sensi ▪ Incarichi di consulente tecnico d’ufficio nominato',
  '             dell’Articolo 30 comma 6 della Legge 166/2; dall’Autorità Giudiziaria;',
  '           ▪ Incarichi di perito per perizie giudiziali ed extragiudiziali; ▪ Redazione di piani regolatori in genere e di piani',
  '          Art . 2 – Garanzie SEMPRE operanti',
].join('\n')

const VERIFY_FIELD = { id: 'x', label: 'Incarichi giudiziari', description: "Verifica se sono coperti gli incarichi di curatore, custode giudiziario, delegato alle vendite, consulente tecnico d'ufficio o altri incarichi conferiti dall'autorità giudiziaria: 'Sì' solo se una garanzia o l'oggetto dell'assicurazione li include espressamente (cita la frase); 'No' se esclusi; vuoto se il fascicolo non li nomina." }

test('citazionicolonne: citazione cucita tra due colonne accettata solo col flag', () => {
  const q = 'Incarichi di consulente tecnico d’ufficio nominato dall’Autorità Giudiziaria'
  const norm = normForMatch(LLOYDS_P15)
  assert.equal(evidenceInContext(q, norm, LLOYDS_P15), false)
  assert.equal(evidenceInContext(q, norm, LLOYDS_P15, { columns: true }), true)
  const entry = { valore: 'Sì', evidenza: q }
  assert.equal(passesStagedEvidence(VERIFY_FIELD, 'Sì', entry, norm, LLOYDS_P15), false)
  assert.equal(passesStagedEvidence(VERIFY_FIELD, 'Sì', entry, norm, LLOYDS_P15, { columns: true }), true)
})

test('citazionicolonne: le citazioni inventate o corte restano fuori', () => {
  const norm = normForMatch(LLOYDS_P15)
  // pezzi veri ma lontani e in ordine diverso
  assert.equal(evidenceInContext('Redazione di piani regolatori e Attività di progettista nominato dall’Autorità', norm, LLOYDS_P15, { columns: true }), false)
  // frase inventata con parole del testo
  assert.equal(evidenceInContext('Incarichi di curatore fallimentare conferiti dall’Autorità Giudiziaria', norm, LLOYDS_P15, { columns: true }), false)
  // citazione corta: esatta o niente
  assert.equal(segmentAcrossColumns(normForMatch('progettista nominato'), norm, 0), -1)
  // contigua: passa anche senza flag
  assert.equal(evidenceInContext('Attività di verifica degli elaborati progettuali', norm, LLOYDS_P15), true)
})

// Pag. 26 della stessa polizza: il questionario rilegato dentro il PDF.
const LLOYDS_P26 = [
  "Questionario: DELL'ORO MAURIZIO",
  '       Quote Id: 1083729',
  '                                            Precedenti Coperture',
  '         Compagnia                                                       LLOYD\'S',
  '         Franchigie o Scoperti €                                         1.500,00',
  '         Scadenza                                                        30/09/2026',
].join('\n')

const F = (description) => ({ id: description.slice(0, 8), label: 'campo', description })
const SCADENZA = F("Data di scadenza (fine) della copertura del periodo assicurativo PIÙ RECENTE: la data accanto a 'Scadenza', 'al', 'alle ore 24 del' nel frontespizio o nell'appendice di rinnovo più recente.")
const FRANCHIGIA = F("Franchigia della RC Professionale: è l'importo indicato al 'Punto 6. Franchigia' del frontespizio di polizza. È UN IMPORTO PICCOLO di poche migliaia di euro.")
const RETRO = F("Retroattività della copertura come indicata nella scheda/frontespizio: 'Illimitata', oppure una data o un periodo, oppure vuoto se non indicata.")
const CONTRAENTE = F("Nome o ragione sociale del contraente, come scritto accanto a 'Contraente' o 'Contraente/Assicurato' nel frontespizio o nell'appendice più recente.")
const PIVA = F("Partita IVA o codice fiscale del CONTRAENTE/assicurato. È il codice del contraente nel frontespizio.")
const FATTURATO = F("Fatturato dichiarato dall'assicurato per la quotazione o la regolazione del premio: l'importo accanto a 'Fatturato', 'Introiti', 'Volume d'affari' nella scheda di copertura, nel questionario o nella proposta.")
const SINISTRI = F("Verifica se nel questionario o nella proposta risultano DICHIARATI sinistri: rispondi 'Sì' solo se la risposta barrata è SÌ; 'No' se la risposta barrata è NO; altrimenti vuoto.")

test('questionariodati: pagina di questionario riconosciuta dal titolo', () => {
  assert.equal(isQuestionnairePageTitle(LLOYDS_P26), true)
  assert.equal(isQuestionnairePageTitle(LLOYDS_P15.replace(/^\[.*\]\n/, '')), false)
})

test('questionariodati: date, importi e condizioni della polizza mai dal questionario; identità sì', () => {
  const qp = new Set(['polizza.pdf|26'])
  assert.equal(isQuestionnaireSourced(SCADENZA, 'polizza.pdf', 26, qp), true)
  assert.equal(isQuestionnaireSourced(FRANCHIGIA, 'polizza.pdf', 26, qp), true)
  assert.equal(isQuestionnaireSourced(RETRO, 'polizza.pdf', 26, qp), true)
  assert.equal(isQuestionnaireSourced(CONTRAENTE, 'polizza.pdf', 26, qp), false)
  assert.equal(isQuestionnaireSourced(PIVA, 'polizza.pdf', 26, qp), false)
  assert.equal(isQuestionnaireSourced(FATTURATO, 'polizza.pdf', 26, qp), false)
  assert.equal(isQuestionnaireSourced(SINISTRI, 'polizza.pdf', 26, qp), false)
  // la coda della descrizione nomina «le condizioni»: la Compagnia resta un'identità
  const COMPAGNIA = F("Compagnia assicuratrice, cioè l'ASSICURATORE che presta la copertura: la società di assicurazione nominata nel frontespizio/scheda, nelle condizioni ('la Società', 'l'Assicuratore') o nel piè di pagina societario.")
  assert.equal(isQuestionnaireSourced(COMPAGNIA, 'polizza.pdf', 26, qp), false)
  const ESTENSIONI = F("Elenco TESTUALE delle estensioni di garanzia effettivamente OPERANTI, cioè barrate SI o richiamate come operanti nella scheda. Se la scheda elenca estensioni tutte barrate NO, scrivi 'Nessuna'.")
  assert.equal(isQuestionnaireSourced(ESTENSIONI, 'polizza.pdf', 26, qp), true)
  // pagina della scheda: nessun veto
  assert.equal(isQuestionnaireSourced(SCADENZA, 'polizza.pdf', 3, qp), false)
  // documento-questionario intero
  assert.equal(isQuestionnaireSourced(FRANCHIGIA, 'Questionario.pdf', 2, qp, new Set(['Questionario.pdf'])), true)
})

test('filtrocontesto: il testo attorno alla voce si trova nella pagina della fonte', () => {
  const appendix = {
    name: 'Appendice.pdf',
    pages: [''],
    spatialPages: [[
      '      A) Con la presente appendice, di comune accordo tra le parti e con effetto dalle ore 24:00 del 20 maggio 2026, si conviene di',
      '         abrogare e sostituire in polizza la seguente condizione aggiuntiva, come segue:',
      '         10.2 Attività di Consigliere di Amministrazione in società di capitali o Enti',
      '         Di comune accordo tra le Parti, si da e si prende atto che la condizione aggiuntiva a seguire non è operante per gli incarichi',
      '         1. Fermi restando i limiti, le condizioni, le esclusioni e le limitazioni di cui alla presente Polizza , a parziale modifica',
      "         dell'esclusione di cui all'Art. 4.16 del testo di polizza, la copertura si intende estesa a quanto l' Assicurato , nella qualità",
    ].join('\n')],
  }
  const c = listItemContext([appendix], 'Attività di Consigliere di Amministrazione in società di capitali o Enti', 'Appendice.pdf', 1)
  assert.ok(c && /condizione aggiuntiva/.test(c) && /10\.2 Attività di Consigliere/.test(c))
  assert.equal(listItemContext([appendix], 'Kasko collisione veicoli', 'Appendice.pdf', 1), null)
})

test('i tre flag sono registrati e spenti di default', async () => {
  const { DEFAULT_FLAGS } = await import('../src/services/engineFlags.js')
  for (const f of ['citazionicolonne', 'questionariodati', 'filtrocontesto']) {
    assert.ok(KNOWN_FLAGS[f], f)
    assert.ok(!DEFAULT_FLAGS.includes(f), f)
  }
})
