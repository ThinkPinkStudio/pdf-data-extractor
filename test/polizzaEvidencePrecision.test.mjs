// Precisione del controllo di EVIDENZA e delle fonti (analisi errori 25/09/2026):
// importi piccoli decisi dal NUMERO nel testo, numeri spezzati dal kerning,
// confini di numero ("500.000,00" non sta dentro "2.500.000,00"), fonte per
// valore cercata solo nelle pagine della chiamata, campi-casella scelti dalla
// sola descrizione, niente trappola "nome societario ≠ agenzia".
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  passesStagedEvidence, normForMatch, textHasAmount, indexOfWholeNumber, buildNormIndex,
  findValueWindow, valueWindows, rawNumberBounded,
} from '../src/services/polizzaValidation.js'
import { joinSplitNumbersInPages } from '../src/services/pdfTextLayer.js'
import {
  findStagedSource, stagedCallPages, stagedCheckboxFields, KNOWN_TRAPS_SYSTEM_TEXT,
} from '../src/services/polizzaService.js'

const PREMIO_LORDO = { id: 'p1', label: 'Premio lordo totale tutela legale', description: 'Premio lordo annuo complessivo della tutela legale (imponibile + imposte).' }
const INTERESSI = { id: 'p2', label: 'Interessi di frazionamento', description: 'Interessi di frazionamento COMPLESSIVI indicati nel documento: la somma delle rate o il valore totale dichiarato.' }
const FATTURATO = { id: 'p3', label: 'Fatturato dichiarato', description: 'Fatturato dichiarato nel questionario o nella proposta (es. 81.936,00).' }

// Scheda premi della polizza BOLCHINI TL (Documento 5, pag. 3, griglia pdf.js).
const BOLCHINI_TL_P3 = [
  '     DESCRIZIONE GARANZIE          INFORMAZIONI AGGIUNTIVE                                 PREMIO NETTO IMPOSTE PREMIO LORDO',
  '                                                                          PREMIO ANNUO       201,22      42,78     244,00',
  '     PREMIO TOTALE                                   NETTO IMPONIBILE INTERESSE DI  DIRITTI       IMPOSTE     PREMIO LORDO',
  '     PREMIO ALLA FIRMA                                  97,69          2,92          0,00         21,39        122,00',
  '      PREMIO RATA SUCCESSIVA                            97,69          2,92          0,00         21,39        122,00',
].join('\n')

test('textHasAmount: il valore come NUMERO intero del testo, non come cifre', () => {
  assert.equal(textHasAmount(BOLCHINI_TL_P3, 244), true)
  assert.equal(textHasAmount(BOLCHINI_TL_P3, 2.92), true)
  assert.equal(textHasAmount(BOLCHINI_TL_P3, 0), true, '"0,00" della colonna DIRITTI è un dato')
  // somma calcolata dal modello (2,92 + 2,92): mai stampata
  assert.equal(textHasAmount(BOLCHINI_TL_P3, 5.84), false)
  assert.equal(textHasAmount(BOLCHINI_TL_P3, 5.86), false)
  // confini di numero: "5,84" non sta dentro "15,84", "12" non è il mese di una data
  assert.equal(textHasAmount('rata 15,84', 5.84), false)
  assert.equal(textHasAmount('Dal 16/12/2025', 12), false)
  // stesso importo con o senza decimali stampati ("€ 28" per 28,00); 28,50 no
  assert.equal(textHasAmount('€  28', 28), true)
  assert.equal(textHasAmount('€  28', 28.5), false)
  // tassi con tre decimali ("1,250 ‰") e decimali col punto dell'OCR
  assert.equal(textHasAmount('Tasso lordo 1,250 ‰', 1.25), true)
  assert.equal(textHasAmount('PREMIO ANNUO 244.00', 244), true)
  assert.equal(textHasAmount('Massimale 1.250', 1.25), false, '"1.250" sono migliaia')
})

test('passesStagedEvidence, importi piccoli: 244,00 stampato passa anche con citazione parafrasata; la somma 5,84 cade con qualunque citazione', () => {
  const raw = `[Documento 5 · pag. 3]\n${BOLCHINI_TL_P3}`
  const n = normForMatch(raw)
  assert.equal(passesStagedEvidence(PREMIO_LORDO, '244,00', { evidenza: 'Premio lordo annuo pari a 244,00 euro' }, n, raw), true)
  assert.equal(passesStagedEvidence(PREMIO_LORDO, '244,00', {}, n, raw), true)
  // BOLCHINI TL: interessi 5,84 / 5,86 = 2,92 + 2,92, citazione copiata dalla riga delle rate
  const rigaRate = 'PREMIO ALLA FIRMA                                  97,69          2,92'
  assert.equal(passesStagedEvidence(INTERESSI, '5,84', { evidenza: rigaRate }, n, raw), false)
  assert.equal(passesStagedEvidence(INTERESSI, '5,86', { evidenza: rigaRate }, n, raw), false)
  assert.equal(passesStagedEvidence(INTERESSI, '5,84', {}, n, raw), false)
  // il valore per rata stampato resta un dato leggibile
  assert.equal(passesStagedEvidence(INTERESSI, '2,92', {}, n, raw), true)
  // il numero del MARCATORE di pagina ("Documento 5 · pag. 3") non è testo del
  // documento: "3" o "5" scritti a caso dal modello non hanno evidenza
  assert.equal(passesStagedEvidence(INTERESSI, '3', {}, n, raw), false)
  assert.equal(passesStagedEvidence(INTERESSI, '5,00', {}, n, raw), false)
  assert.equal(passesStagedEvidence(INTERESSI, '3', {}, n, `[FRONTESPIZIO: Documento 5 · pag. 3]\n${BOLCHINI_TL_P3}`), false)
})

test('passesStagedEvidence, importi piccoli: "€ 50,00" nella griglia basta anche se la citazione etichetta+valore non è contigua (RCPM LUCCA)', () => {
  const raw = [
    '[Documento 1 · pag. 2]',
    '    PREMIO NETTO ALLA FIRMA IMPOSTE ALLA FIRMA       PREMIO LORDO ALLA FIRMA',
    '                    € 41,24                   € 8,76                 € 50,00',
  ].join('\n')
  const f = { id: 'p4', label: 'Premio Lordo Tutela', description: 'Premio lordo alla firma del certificato Tutela.' }
  assert.equal(passesStagedEvidence(f, '50,00', { evidenza: 'PREMIO LORDO ALLA FIRMA € 50,00' }, normForMatch(raw), raw), true)
  assert.equal(passesStagedEvidence(f, '51,00', { evidenza: 'PREMIO LORDO ALLA FIRMA € 51,00' }, normForMatch(raw), raw), false)
})

test('passesStagedEvidence, importi piccoli: senza il numero nel testo serve una citazione nel contesto che lo contenga (e che sia più del numero)', () => {
  // "24 4,00": due frammenti ben formati, joinSplitNumbers non li unisce
  const raw = 'Premio lordo 24 4,00 euro'
  const n = normForMatch(raw)
  assert.equal(passesStagedEvidence(PREMIO_LORDO, '244,00', {}, n, raw), false)
  assert.equal(passesStagedEvidence(PREMIO_LORDO, '244,00', { evidenza: 'Premio lordo 244,00' }, n, raw), true)
  assert.equal(passesStagedEvidence(PREMIO_LORDO, '244,00', { evidenza: '244,00' }, n, raw), false, 'il solo numero non è una citazione')
  assert.equal(passesStagedEvidence(PREMIO_LORDO, '244,00', { evidenza: 'Premio totale 244,00' }, n, raw), false, 'citazione non presente nel contesto')
})

test('passesStagedEvidence: fatturato spezzato dal kerning "54 . 383 ,00" nella griglia in cache passa con la sua citazione (BOLCHINI RC 2026)', () => {
  const raw = '[Documento 3 · pag. 1]\n             inserire il fatturato consolidato. 54 . 383 ,00 euro'
  const n = normForMatch(raw)
  assert.equal(passesStagedEvidence(FATTURATO, '54.383,00', { evidenza: '54 . 383 ,00 euro' }, n, raw), true)
  assert.equal(passesStagedEvidence(FATTURATO, '54.383,00', {}, n, raw), true)
  // un altro importo non passa per la ricomposizione
  assert.equal(passesStagedEvidence(FATTURATO, '5.438,00', {}, n, raw), false)
})

test('joinSplitNumbersInPages: ricompone le griglie lette dalla cache, solo le pagine digitali se il text layer è noto; idempotente', () => {
  const cached = ['inserire il fatturato consolidato. 54 . 383 ,00 euro', 'OCR: totale 1 .000,00']
  assert.deepEqual(joinSplitNumbersInPages(cached, null), ['inserire il fatturato consolidato. 54.383,00 euro', 'OCR: totale 1.000,00'])
  // pagina 2 senza text layer (scansione): resta com'è, come un OCR rifatto da zero
  assert.deepEqual(joinSplitNumbersInPages(cached, ['testo', '']), ['inserire il fatturato consolidato. 54.383,00 euro', 'OCR: totale 1 .000,00'])
  const once = joinSplitNumbersInPages(cached, null)
  assert.deepEqual(joinSplitNumbersInPages(once, null), once)
  // importi veri affiancati restano separati
  assert.deepEqual(joinSplitNumbersInPages(['562,50 56,25 618,75'], null), ['562,50 56,25 618,75'])
})

test('confini di numero: "500.000,00" non si trova dentro "€ 2.500.000,00" (RCP CRESTA)', () => {
  const front = 'massimale per sinistro e per anno per i danni cagionati dagli Assicurati: € 2.500.000,00'
  assert.equal(indexOfWholeNumber(buildNormIndex(front), normForMatch('500.000,00')), -1)
  assert.equal(findValueWindow(front, '500.000,00', null), null)
  assert.deepEqual(valueWindows(front, '500.000,00'), [])
  const visto = 'massimale di € 500.000,00 per sinistro qualunque sia il numero delle persone'
  assert.notEqual(indexOfWholeNumber(buildNormIndex(visto), normForMatch('500.000,00')), -1)
  assert.match(findValueWindow(visto, '500.000,00', null), /500\.000,00/)
  // due colonne affiancate restano numeri distinti
  assert.notEqual(indexOfWholeNumber(buildNormIndex('250.000   500.000,00'), '50000000'), -1)
  // stesso importo con i decimali a zero; decimali diversi = altro importo
  assert.notEqual(indexOfWholeNumber(buildNormIndex('€ 5.000.000,00'), '5000000'), -1)
  assert.equal(indexOfWholeNumber(buildNormIndex('€ 5.000.000,50'), '5000000'), -1)
  // parte intera di "5.000.000,00": vale solo se il testo la scrive SENZA decimali
  assert.match(findValueWindow('Massimale € 5.000.000 per sinistro', '5.000.000,00', null), /5\.000\.000/)
  assert.equal(findValueWindow('Massimale € 5.000.000,50 per sinistro', '5.000.000,00', null), null)
  assert.equal(rawNumberBounded('5.000.000,00', 0, 9, 'none'), false)
  assert.equal(rawNumberBounded('5.000.000 per', 0, 9, 'none'), true)
})

// Fascicolo finto con la stessa forma dei documenti del motore a stadi.
function mkDoc(name, ord, pages) {
  return { name, ord, pages, spatialPages: pages, normPages: pages.map((p) => normForMatch(p)) }
}

test('findStagedSource: la fonte per VALORE si cerca con i confini di numero e solo nelle pagine della chiamata (RCP CRESTA)', () => {
  const pages = Array.from({ length: 19 }, (_, i) => `pagina ${i + 1} condizioni generali`)
  pages[1] = 'cagionati dagli Assicurati: € 2.500.000,00'
  pages[11] = 'Visto di conformità: massimale di € 500.000,00.'
  const polizza = mkDoc('polizza.pdf', 1, pages)
  const analyzed = [polizza]
  const used = new Set(['polizza.pdf'])
  // senza pagine della chiamata: i confini bastano a non prendere il frontespizio
  assert.equal(findStagedSource(analyzed, '', '500.000,00', used)?.page, 12)
  // contesto della chiamata = pagine 11-19 (marcatori dei blocchi)
  const ctx = [11, 12, 13].map((p) => `[Documento 1 · pag. ${p}]\n${pages[p - 1]}`).join('\n\n')
  const callPages = stagedCallPages(analyzed, ctx)
  assert.deepEqual([...callPages.get('polizza.pdf')].sort((a, b) => a - b), [11, 12, 13])
  assert.equal(findStagedSource(analyzed, '', '500.000,00', used, callPages)?.page, 12)
  // un valore che nelle pagine della chiamata non c'è non prende una fonte altrove
  assert.equal(findStagedSource(analyzed, '', '2.500.000,00', used, callPages), null)
  assert.equal(findStagedSource(analyzed, '', '2.500.000,00', used)?.page, 2)
  // il frontespizio non è la fonte di 500.000,00 nemmeno se è l'unica pagina inviata
  const frontOnly = stagedCallPages(analyzed, `[FRONTESPIZIO: Documento 1 · pag. 2]\n${pages[1]}`)
  assert.equal(findStagedSource(analyzed, '', '500.000,00', used, frontOnly), null)
})

test('stagedCallPages: nessun marcatore → null (la ricerca resta sui documenti del contesto)', () => {
  assert.equal(stagedCallPages([mkDoc('a.pdf', 1, ['x'])], 'TABELLA DEL DOCUMENTO\n| a | b |'), null)
})

test('Stadio A.5: i campi-casella si scelgono dalla DESCRIZIONE, mai dalla label (Regola 1)', () => {
  const tipologia = {
    id: 't1', label: 'Tipologia tutela legale',
    description: "Tipologia di bisogni assicurativi coperti dalla tutela legale: un TESTO con gli ambiti BARRATI (X / [x]) nella sezione 'Individuazione dei bisogni assicurativi' del profilo cliente o indicati come coperti nella polizza (es. Tutela mobilità/circolazione, Tutela vita privata, Tutela attività professionale, Tutela imprese o ente, Tutela manager). Riporta solo gli ambiti barrati o indicati come coperti, NON tutto l'elenco, NON frasi delle condizioni.",
  }
  const soloLabel = { id: 't2', label: 'Tipologia / selezione', description: 'Nome della compagnia assicuratrice che presta la copertura.' }
  assert.deepEqual(stagedCheckboxFields([tipologia, soloLabel]).map((f) => f.id), ['t1'])
})

test('KNOWN_TRAPS_SYSTEM_TEXT: niente regola "nome societario ≠ agenzia" (contraddice la descrizione dell\'Agenzia)', () => {
  assert.doesNotMatch(KNOWN_TRAPS_SYSTEM_TEXT, /nome societario/i)
  assert.doesNotMatch(KNOWN_TRAPS_SYSTEM_TEXT, /NON è una agenzia/i)
  // le altre trappole restano
  assert.match(KNOWN_TRAPS_SYSTEM_TEXT, /sotto-limite/)
})
