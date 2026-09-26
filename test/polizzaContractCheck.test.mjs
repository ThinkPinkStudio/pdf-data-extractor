/**
 * PRESENZA DELLA POLIZZA nel pre-controllo (regola dell'utente del 26/09/2026:
 * «SE NON HAI UNA POLIZZA NON ESTRAI: SENZA UNA POLIZZA È SEMPRE NON VALIDO»).
 *
 * Qui gira l'ORCHESTRATORE (runContractCheck / runOperativita / runPrecheck)
 * con modello ed embeddings FINTI iniettati (`deps`), senza Ollama: la domanda
 * sul contratto è UNA del fascicolo, fatta prima dell'operatività, sulle prime
 * pagine e poi su tutte le altre in ordine, fino al primo «presente»; «assente»
 * (Non valido, non forzabile) solo se ogni batch lo dice e nessuna pagina è
 * rimasta fuori.
 * Caso vero: ALZAIA NAVIGLIO PAVESE 101 Tutela legale DAS, un solo file, una
 * quietanza di rinnovo; il modello diceva «non operante» citando la riga
 * «Tutela Legale ESCLUSA 31.000,00» (contraddizione → review) e la domanda sul
 * contratto non partiva mai: «Da verificare», forzato, estratto.
 *
 * Esegui:  node --test test/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { runOperativita, runContractCheck, runPrecheck, buildPageCandidates } from '../src/services/polizzaPrecheckService.js'

const TL = { id: 'tl', name: 'Tutela Legale 3', recognition: 'Polizza o sezione di TUTELA LEGALE effettivamente ACQUISTATA dal contraente: un prodotto autonomo (es. DAS, ARAG) oppure una sezione "Tutela legale" operante. NON lo è: una RC professionale.', fields: [] }
const RC = { id: 'rc', name: 'Rc Professionale V3', recognition: 'Polizza di RESPONSABILITÀ CIVILE PROFESSIONALE effettivamente ACQUISTATA: copre i danni a terzi. NON lo è: una tutela legale.', fields: [] }
const PROFILES = [TL, RC]
const SETTINGS = { ollamaUrl: 'http://modello-finto.invalid', ollamaModel: 'finto', polizzaBatchContext: 8192 }

// Quietanza DAS di ALZAIA in forma di griglia (colonne separate da spazi).
const QUIETANZA = [
  'QUIETANZA DI PAGAMENTO DEL PREMIO          Quietanza n. 693689027',
  'Polizza n. 0146905119                      Intestata a: ALZAIA NAV. PAVESE 104 CONDOMINIO',
  'Dal 31/01/26 al 31/01/27',
  'Garanzia            Indicizzazione     Massimale',
  'Tutela Legale       ESCLUSA            31.000,00',
  'Premio netto        Imposte            Premio lordo',
  '€ 615,25            € 130,75           € 746,00',
].join('\n')
const FRONTESPIZIO = [
  'POLIZZA DI ASSICURAZIONE TUTELA LEGALE      Polizza n. 0146905119',
  'Contraente: ALZAIA NAV. PAVESE 104 CONDOMINIO',
  'SEZIONE TUTELA LEGALE          Premio annuo imponibile  615,25',
].join('\n')

const doc = (name, pages) => ({ name, pages })
const embed = async (_settings, texts) => texts.map(() => [1, 0, 0])

/**
 * Modello finto: risponde all'operatività con `op` e al contratto con la
 * funzione `contract(userPrompt)`. Conta le chiamate per tipo.
 */
function fakeModel({ op, contract, failContract = false }) {
  const calls = { op: 0, contract: 0 }
  const callModel = async (_settings, _system, user, opts) => {
    const isContract = !!opts?.format?.properties?.contratto
    if (isContract) {
      calls.contract++
      if (failContract) throw new Error('Ollama giù')
      return JSON.stringify(contract(user))
    }
    calls.op++
    return JSON.stringify(typeof op === 'function' ? op(user) : op)
  }
  return { callModel, calls }
}

const NON_OPERANTE_RIGA = { esito: 'non operante', documento: 'Documento 1', pagina: 1, evidenza: 'Tutela Legale       ESCLUSA            31.000,00', motivo: 'la tutela legale è esclusa' }
const ASSENTE = { contratto: 'assente', documento: 'Documento 1', pagina: 1, motivo: 'solo una quietanza di pagamento del premio' }
const PRESENTE = (d = 2) => ({ contratto: 'presente', documento: `Documento ${d}`, pagina: 1, motivo: 'frontespizio di polizza' })

test('ALZAIA 101: sola quietanza → NON VALIDO con UNA domanda sul contratto, nessuna chiamata di operatività', async () => {
  const m = fakeModel({ op: NON_OPERANTE_RIGA, contract: () => ASSENTE })
  const diag = []
  const r = await runOperativita({ docs: [doc('quietanza.pdf', [QUIETANZA])], profile: TL, profiles: PROFILES, settings: SETTINGS, diag, deps: { callModel: m.callModel, embed } })
  assert.equal(r.verdict, 'setaside', diag.join('\n'))
  assert.equal(r.notValid, true)
  assert.equal(r.operativitaVerdict, null, 'senza polizza l\'operatività non si valuta')
  assert.equal(r.polizza.esito, 'assente')
  assert.equal(r.polizza.documento, null, 'nessun «dove» per un\'assenza')
  assert.match(r.reason, /quietanza di pagamento/)
  assert.equal(m.calls.contract, 1, 'la domanda sul contratto parte anche senza un «operante»')
  assert.equal(m.calls.op, 0)
})

// Lettera di trasmissione a pag. 1, frontespizio della polizza a pag. 2, poi
// condizioni che nominano la tutela legale: la polizza NON sta in una prima
// pagina. Prima (domanda nei batch di operatività + sole prime pagine) il
// fascicolo diventava Non valido senza rimedio (revisione del 26/09).
const LETTERA = `Spett.le Condominio, le trasmettiamo in allegato la documentazione assicurativa.\n${'Restiamo a disposizione per ogni chiarimento sulla pratica in oggetto.\n'.repeat(40)}`
const CONDIZIONI = (i) => `Art. ${i} - Condizioni generali di tutela legale\n${'La società assicura la tutela legale alle condizioni seguenti, nei limiti del massimale.\n'.repeat(12)}`
const PDF_UNICO = [LETTERA, FRONTESPIZIO, ...Array.from({ length: 20 }, (_, i) => CONDIZIONI(i + 1))]

test('polizza a pag. 2 di un PDF unico: le pagine si leggono in ordine finché la polizza non si vede (mai Non valido)', async () => {
  const m = fakeModel({ op: NON_OPERANTE_RIGA, contract: (user) => (user.includes('[Documento 1 · pag. 2]') ? { ...PRESENTE(1), pagina: 2 } : ASSENTE) })
  const diag = []
  const c = await runContractCheck({ docs: [doc('fascicolo.pdf', PDF_UNICO)], settings: { ...SETTINGS, polizzaBatchContext: 2048 }, diag, deps: { callModel: m.callModel } })
  assert.equal(c.esito, 'presente', diag.join('\n'))
  assert.equal(c.pagina, 2)
  assert.ok(m.calls.contract >= 2, `domande: ${m.calls.contract}`)
  const firstBatch = diag.find((l) => /^Polizza batch 1:/.test(l))
  assert.match(firstBatch, /assente/, 'il primo batch (la sola lettera) non vede la polizza')
})

test('pagine rimaste oltre il tetto dei batch: «non verificata», mai Non valido', async () => {
  const m = fakeModel({ op: NON_OPERANTE_RIGA, contract: () => ASSENTE })
  const docs = [doc('fascicolo.pdf', [LETTERA, ...Array.from({ length: 20 }, (_, i) => CONDIZIONI(i + 1))])]
  const c = await runContractCheck({ docs, settings: { ...SETTINGS, polizzaBatchContext: 2048 }, maxBatches: 2, deps: { callModel: m.callModel } })
  assert.equal(m.calls.contract, 2)
  assert.equal(c.esito, 'non verificata')
  assert.match(c.reason, /pagine non sono state mostrate al modello/)
  // stesso fascicolo, tutte le pagine mostrate: allora sì, assente
  const all = await runContractCheck({ docs, settings: { ...SETTINGS, polizzaBatchContext: 2048 }, maxBatches: 100, deps: { callModel: fakeModel({ op: NON_OPERANTE_RIGA, contract: () => ASSENTE }).callModel } })
  assert.equal(all.esito, 'assente')
})

test('risposte MISTE: «assente» su un batch e «non determinabile» su un altro → nessun Non valido', async () => {
  const docs = [doc('a.pdf', [LETTERA]), doc('b.pdf', [LETTERA])]
  let n = 0
  const m = fakeModel({ op: NON_OPERANTE_RIGA, contract: () => (++n === 1 ? ASSENTE : { contratto: 'non determinabile', documento: '', pagina: 0, motivo: 'scheda poco leggibile' }) })
  const c = await runContractCheck({ docs, settings: { ...SETTINGS, polizzaBatchContext: 2048 }, deps: { callModel: m.callModel } })
  assert.ok(m.calls.contract >= 2, `domande: ${m.calls.contract}`)
  assert.equal(c.esito, 'non determinabile')
  // e con l'operatività «operante» provata non si estrae da soli: dubbio
  const OPERANTE = { ...NON_OPERANTE_RIGA, esito: 'operante', motivo: 'premio proprio' }
  const r = await runOperativita({ docs: [doc('quietanza.pdf', [QUIETANZA])], profile: TL, profiles: PROFILES, settings: SETTINGS, contract: c, deps: { callModel: fakeModel({ op: OPERANTE, contract: () => ASSENTE }).callModel, embed } })
  assert.equal(r.operativitaVerdict, 'ok')
  assert.equal(r.verdict, 'review', 'quietanza con «Tutela Legale 240,00»: operante ma polizza non vista → mai estratta da sola')
  assert.ok(!r.notValid)
})

test('«presente» citando una pagina NON mostrata: non vale, si continua a leggere', async () => {
  const docs = [doc('fascicolo.pdf', PDF_UNICO)]
  const m = fakeModel({ op: NON_OPERANTE_RIGA, contract: () => PRESENTE(7) })
  const c = await runContractCheck({ docs, settings: { ...SETTINGS, polizzaBatchContext: 2048 }, maxBatches: 3, deps: { callModel: m.callModel } })
  assert.equal(m.calls.contract, 3, 'nessun batch si ferma su un «presente» inventato')
  assert.equal(c.esito, 'non determinabile')
})

test('polizza già decisa (percorso Automatico, profili suggeriti): nessuna nuova domanda', async () => {
  const m = fakeModel({ op: { ...NON_OPERANTE_RIGA, esito: 'operante', motivo: 'premio proprio' }, contract: () => ASSENTE })
  const known = { esito: 'presente', documento: 2, pagina: 1, motivo: 'frontespizio', reason: 'polizza presente', asked: 1 }
  const r = await runOperativita({ docs: [doc('quietanza.pdf', [QUIETANZA])], profile: TL, profiles: PROFILES, settings: SETTINGS, contract: known, deps: { callModel: m.callModel, embed } })
  assert.equal(m.calls.contract, 0)
  assert.equal(r.verdict, 'ok'); assert.equal(r.polizza.esito, 'presente')
})

test('«non determinabile» su tutti i batch: nessun Non valido, resta l\'esito di operatività', async () => {
  const m = fakeModel({ op: NON_OPERANTE_RIGA, contract: () => ({ contratto: 'non determinabile', documento: '', pagina: 0, motivo: 'non si capisce' }) })
  const r = await runOperativita({ docs: [doc('quietanza.pdf', [QUIETANZA])], profile: TL, profiles: PROFILES, settings: SETTINGS, deps: { callModel: m.callModel, embed } })
  assert.equal(r.verdict, 'review')
  assert.ok(!r.notValid)
  assert.equal(r.polizza.esito, 'non determinabile')
})

test('guasto della domanda sul contratto: mai Non valido (Da verificare su un «operante»)', async () => {
  const OPERANTE = { ...NON_OPERANTE_RIGA, esito: 'operante', motivo: 'premio proprio' }
  // controllo: con la polizza presente l'«operante» provato è un abbinamento
  const ok = fakeModel({ op: OPERANTE, contract: () => PRESENTE(1) })
  const rOk = await runOperativita({ docs: [doc('quietanza.pdf', [QUIETANZA])], profile: TL, profiles: PROFILES, settings: SETTINGS, deps: { callModel: ok.callModel, embed } })
  assert.equal(rOk.verdict, 'ok')
  const m = fakeModel({ op: OPERANTE, contract: () => ASSENTE, failContract: true })
  const r = await runOperativita({ docs: [doc('quietanza.pdf', [QUIETANZA])], profile: TL, profiles: PROFILES, settings: SETTINGS, deps: { callModel: m.callModel, embed } })
  assert.ok(!r.notValid)
  assert.equal(r.polizza.esito, 'non verificata')
  assert.equal(r.polizza.error, true)
  assert.equal(r.verdict, 'review')
  assert.equal(r.operativitaVerdict, 'ok')
  assert.match(r.reason, /polizza non vista dal modello \(non verificata\)/)
  // standalone: stesso principio, non lancia mai
  const c = await runContractCheck({ docs: [doc('quietanza.pdf', [QUIETANZA])], settings: SETTINGS, deps: { callModel: m.callModel } })
  assert.equal(c.esito, 'non verificata'); assert.equal(c.error, true)
})

test('copertura mai nominata: la polizza si verifica lo stesso (quietanza di un\'altra copertura = Non valido)', async () => {
  const rca = 'QUIETANZA DI PAGAMENTO   Polizza n. 555   Garanzia RCA   Premio lordo € 400,00'
  const m = fakeModel({ op: NON_OPERANTE_RIGA, contract: () => ASSENTE })
  const r = await runOperativita({ docs: [doc('rca.pdf', [rca])], profile: TL, profiles: PROFILES, settings: SETTINGS, deps: { callModel: m.callModel, embed } })
  assert.equal(m.calls.op, 0, 'mai nominata: nessuna chiamata di operatività')
  assert.equal(m.calls.contract, 1)
  assert.equal(r.notValid, true)
  // polizza vera di un'altra copertura: resta «non operante» (Non pertinente, forzabile)
  const m2 = fakeModel({ op: NON_OPERANTE_RIGA, contract: () => PRESENTE(1) })
  const r2 = await runOperativita({ docs: [doc('rca.pdf', [rca])], profile: TL, profiles: PROFILES, settings: SETTINGS, deps: { callModel: m2.callModel, embed } })
  assert.equal(r2.verdict, 'mismatch'); assert.ok(!r2.notValid)
})

test('documento senza testo accanto a una quietanza: «non verificata», mai Non valido', async () => {
  const m = fakeModel({ op: NON_OPERANTE_RIGA, contract: () => ASSENTE })
  const c = await runContractCheck({ docs: [doc('quietanza.pdf', [QUIETANZA]), doc('scansione.pdf', ['', ''])], settings: SETTINGS, deps: { callModel: m.callModel } })
  assert.equal(c.esito, 'non verificata')
  assert.match(c.reason, /senza testo/)
})

test('runPrecheck: profilo SENZA «Come riconoscerla» → domanda al modello (non più la regex); assente = Non valido', async () => {
  const m = fakeModel({ op: NON_OPERANTE_RIGA, contract: () => ASSENTE })
  const noRecog = { id: 'x', name: 'Profilo senza riconoscimento', contentKeywords: 'tutela legale', fields: [] }
  const pre = await runPrecheck({ docs: [doc('quietanza.pdf', [QUIETANZA])], fieldDefs: [], profile: noRecog, profileName: noRecog.name, mode: 'keywords', settings: SETTINGS, allProfiles: [], deps: { callModel: m.callModel, embed } })
  assert.equal(pre.verdict, 'mismatch'); assert.equal(pre.notValid, true)
  assert.equal(pre.polizza.esito, 'assente')
  assert.equal(m.calls.contract, 1)
  assert.ok(!pre.suggestion)
})

test('runPrecheck con operatività: Non valido senza profili suggeriti (niente operatività sugli altri profili)', async () => {
  const m = fakeModel({ op: NON_OPERANTE_RIGA, contract: () => ASSENTE })
  const pre = await runPrecheck({ docs: [doc('quietanza.pdf', [QUIETANZA])], fieldDefs: [], profile: TL, profileName: TL.name, mode: 'llm', settings: SETTINGS, allProfiles: PROFILES, deps: { callModel: m.callModel, embed } })
  assert.equal(pre.verdict, 'mismatch'); assert.equal(pre.notValid, true)
  assert.equal(pre.mode, 'operativita')
  assert.equal(m.calls.op, 0, 'senza polizza nessuna operatività, né sul profilo né sugli alternativi')
  assert.equal(m.calls.contract, 1)
  assert.ok(!pre.suggestion)
})

test('runPrecheck a pre-controllo SPENTO: la polizza si chiede lo stesso, niente classifica né suggerimenti', async () => {
  const m = fakeModel({ op: NON_OPERANTE_RIGA, contract: () => PRESENTE(1) })
  const pre = await runPrecheck({ docs: [doc('polizza.pdf', [FRONTESPIZIO])], fieldDefs: [], profile: TL, profileName: TL.name, mode: 'off', settings: SETTINGS, allProfiles: PROFILES, deps: { callModel: m.callModel, embed } })
  assert.equal(m.calls.contract, 1); assert.equal(m.calls.op, 0)
  assert.equal(pre.verdict, 'skipped'); assert.equal(pre.polizza.esito, 'presente')
  assert.ok(!pre.ranking && !pre.suggestion)
  // polizza non vista a modo off: «da verificare», mai estratta da sola
  const nd = fakeModel({ op: NON_OPERANTE_RIGA, contract: () => ({ contratto: 'non determinabile', documento: '', pagina: 0, motivo: 'x' }) })
  const pre2 = await runPrecheck({ docs: [doc('polizza.pdf', [FRONTESPIZIO])], fieldDefs: [], profile: TL, profileName: TL.name, mode: 'off', settings: SETTINGS, allProfiles: PROFILES, deps: { callModel: nd.callModel, embed } })
  assert.equal(pre2.verdict, 'review'); assert.match(pre2.reason, /polizza non vista dal modello/)
})

// ─── 26/09/2026: polizze vere bloccate dalla pertinenza ───────────────────────
// Profili VERI della bozza (nomi della copertura come in produzione:
// «professionale» per Rc Professionale V3, «medica» / «sanitaria» per la RC medica).
const REAL = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
const RC_V3 = REAL.find((p) => p.name === 'Rc Professionale V3')
const RC_MED = REAL.find((p) => p.name === 'RC PROF MED V2')
const TL_REAL = REAL.find((p) => p.name === 'Tutela Legale 3')

// BOLCHINI RC 2025 (cartella Cessate/RC PROF. 04.2025): questionario AIG di 4
// pagine (titolo su ogni pagina; risposte «⃝ X No» sulle righe con
// «professionale» → righe strutturali del batch 1), la polizza scansionata senza
// testo, l'appendice di rinnovo e la proposta di rinnovo. Griglie pdf.js vere, accorciate.
const QTITLE = 'Questionario di Assicurazione Rc Professionale\n                                    Ingegneri & Architetti'
const BOLCHINI = [
  doc('questionario.pdf', [
    `${QTITLE}\n          2  Professione svolta A RCHITETTO TITOLARE DI STUDIO PROFESSIONALE\n          4  Si richiede la copertura per l'attività personale svolta con propria partita Iva da parte dei\n             Soci?                            ⃝ Sì         ⃝ X No\n         5.a Fatturato consuntivo ultimo esercizio finanziario 81.936,00 €`,
    `${QTITLE}\n          7  Il contraente possiede polizze RC Professionali? X Sì        ⃝  No\n          10 Il Proponente e/o gli Assicurati risultano essere a conoscenza di Circostanze in relazione all'incarico\n             professionale indicato nella presente proposta? ⃝ Sì ⃝ X No`,
    `${QTITLE}\n       12  La società si avvale di sub - appaltatori / consulenti esterni? ⃝ Sì ⃝ X No\n            b) Richiedete che tali sub - appaltatori dispongano di una loro polizza per la responsabilità\n            professionale?                                                   ⃝ Sì ⃝ X No\n          OPZIONI DI COPERTURA\n          Indicare il massimale per il quale si richiede copertura:\n           € 250.000   € 500.000    € 1.000.000  €1.500.000   € 2.000.000  € 2.500.000\n               ⃝            ⃝            ⃝            ⃝            ⃝           ⃝`,
    `${QTITLE}\n         Sezione 6: SCHEDA SINISTRO\n         14 a) Data del sinistro`,
  ]),
  doc('polizza quietanzata.pdf', ['']),
  doc('appendice.pdf', [[
    'APPENDICE          N. 1    - RINNOVO',
    '                                             POLIZZA       IPD0017417',
    '          Contraente: BOLCHINI ARCH. MARGHERITA                                 Attività: ARCHITETTO',
    '          Decorrenza ore 24:00 del 19/04/2025    Scadenza ore 24:00 del 19/04/2026',
    "          Descrizione del rischio            RESPONSABILITA' CIVILE PROFESSIONALE  INGEGNERI E ARCHITETTI",
    '          Totale Premio annuo lordo risultante dal Calcolo del Premio (in euro)                     756,42',
  ].join('\n')]),
  doc('proposta di rinnovo.pdf', [[
    'PROPOSTA DI RINNOVO                   N.1',
    '                                                POLIZZA N.        IPD0017417',
    "          Descrizione del rischio            RESPONSABILITA'  CIVILE PROFESSIONALE  I NGEGNERI E ARCHITETTI",
    '          Totale Premio annuo lordo risultante dal Calcolo del Premio (in euro)                      756,42',
  ].join('\n')]),
]
// Risposte di produzione (qwen3:32b, notte del 26/09): sul solo questionario
// «non operante» citando la DOMANDA del modulo; con la polizza «operante».
const Q_NO = { esito: 'non operante', documento: 'Documento 1', pagina: 3, evidenza: 'Indicare il massimale per il quale si richiede copertura: € 250.000', motivo: 'La copertura RC Professionale è citata come opzione richiesta, ma non è confermata come effettivamente acquistata' }
const POL_OK = { esito: 'operante', documento: 'Documento 3', pagina: 1, evidenza: "Descrizione del rischio RESPONSABILITA' CIVILE PROFESSIONALE INGEGNERI E ARCHITETTI", motivo: 'premio lordo 756,42' }

test('BOLCHINI RC 2025: questionario «non operante» + polizza «operante» → ABBINATO (prima: esiti contraddittori, Da verificare)', async () => {
  // le pagine del questionario sono marcate dal loro TITOLO; appendice e proposta di rinnovo no
  const { candidates } = buildPageCandidates(BOLCHINI, null, { capped: true })
  assert.deepEqual(candidates.filter((c) => c.questionnaire).map((c) => `D${c.ord}p${c.page}`), ['D1p1', 'D1p2', 'D1p3', 'D1p4'])
  const m = fakeModel({ op: (user) => (user.includes('[Documento 3 · pag. 1]') ? POL_OK : Q_NO), contract: () => PRESENTE(3) })
  const diag = []
  const r = await runOperativita({ docs: BOLCHINI, profile: RC_V3, profiles: REAL, settings: SETTINGS, diag, deps: { callModel: m.callModel, embed } })
  assert.equal(r.verdict, 'ok', diag.join('\n'))
  assert.equal(m.calls.op, 2)
  const b1 = diag.find((l) => /Rc Professionale V3» batch 1: \d+ pagine/.test(l))
  assert.match(b1, /D1p2‡€?§.*D1p3‡€?§/, 'batch 1 = sole pagine del questionario (righe «professionale … X No»)')
  assert.ok(diag.some((l) => /batch 1: mismatch — .*questionario\/proposta/.test(l)), diag.join('\n'))
  assert.equal(r.documento, 3)
  assert.match(r.reason, /solo da un questionario\/proposta/)
  // lo stesso fascicolo con il contratto che dice «non operante» (provato): scarto, come prima
  const POL_NO = { ...POL_OK, esito: 'non operante', motivo: 'm' }
  const m2 = fakeModel({ op: (user) => (user.includes('[Documento 3 · pag. 1]') ? POL_NO : Q_NO), contract: () => PRESENTE(3) })
  const r2 = await runOperativita({ docs: BOLCHINI, profile: RC_V3, profiles: REAL, settings: SETTINGS, deps: { callModel: m2.callModel, embed } })
  assert.equal(r2.verdict, 'mismatch')
  assert.equal(r2.documento, 3, 'riportata la prova del contratto, non quella del questionario')
  // il solo questionario dice «no» e la polizza è muta: bloccato (Da verificare), come prima
  const m3 = fakeModel({ op: (user) => (user.includes('[Documento 3 · pag. 1]') ? { esito: 'non determinabile', documento: '', pagina: 0, evidenza: '', motivo: 'x' } : Q_NO), contract: () => PRESENTE(3) })
  const r3 = await runOperativita({ docs: BOLCHINI, profile: RC_V3, profiles: REAL, settings: SETTINGS, deps: { callModel: m3.callModel, embed } })
  assert.equal(r3.verdict, 'review')
})

test('questionario RILEGATO nella polizza (Santangelo Allianz): marcate SOLO le pagine col titolo di questionario', () => {
  const IDD = 'Abitazione\n                                                            POLIZZA N. 789401723-07\n                        QUESTIONARIO PER LA VALUTAZIONE DELLE RICHIESTE ED ESIGENZE DEL CONTRAENTE\n      CONTRAENTE: SANTANGELO ROSA\n  •   per ricevere supporto legale per la tutela dei suoi diritti?\n      SI      X  NO'
  const SCHEDA = 'Abitazione\n                                                            POLIZZA N. 789401723-07\n      Contraente: SANTANGELO ROSA          Decorrenza: 01/01/2026\n      Incendio fabbricato          120,00\n      Responsabilità civile        35,00'
  // pagina di condizioni che cita la proposta nella sua testa: NON è un questionario
  const COND = 'per l’esecuzione dell’ attività in favore di Terzi e definiti nella proposta di Assicurazione compilata dall’ Assicurato'
  const pages = [IDD, SCHEDA, SCHEDA, IDD, SCHEDA, COND]
  const { candidates } = buildPageCandidates([doc('POLIZZA.pdf', pages.map((p) => p.replace(/\s{2,}/g, ' ')))], [{ pages }], { capped: true })
  assert.deepEqual(candidates.filter((c) => c.questionnaire).map((c) => c.page), [1, 4])
  // il flag si calcola sulla pagina GREZZA: le coppie etichetta→valore di withPairs stanno davanti al testo inviato
  assert.ok(candidates.every((c) => typeof c.questionnaire === 'boolean'))
  assert.deepEqual(candidates.filter((c) => c.first).map((c) => c.page), [1])
})

test('tutela legale: il «non operante» del questionario resta uno scarto; con la polizza «operante» vale la polizza', async () => {
  const QUEST = 'QUESTIONARIO PER LA VALUTAZIONE DELLE RICHIESTE ED ESIGENZE DEL CONTRAENTE\n  Tutela legale della circolazione   ☐\n  Assistenza stradale                ☒'
  const POL = 'POLIZZA AUTO N. ET103PP\nRIEPILOGO GARANZIE\nResponsabilità Civile Auto       OPERANTE\nTutela Legale                                        NON OPERANTE'
  const docs = [doc('questionario.pdf', [QUEST]), doc('polizza.pdf', [POL])]
  // prova sul contratto → non pertinente
  const onPolicy = { esito: 'non operante', documento: 'Documento 2', pagina: 1, evidenza: 'Tutela Legale NON OPERANTE', motivo: 'indicata come NON OPERANTE' }
  const m = fakeModel({ op: onPolicy, contract: () => PRESENTE(2) })
  const r = await runOperativita({ docs, profile: TL_REAL, profiles: REAL, settings: SETTINGS, deps: { callModel: m.callModel, embed } })
  assert.equal(r.verdict, 'mismatch'); assert.ok(!r.formEvidence)
  // prova = l'opzione NON barrata del modulo, o il suo titolo: scarto (marcato)
  for (const evidenza of ['Tutela legale della circolazione ☐', 'QUESTIONARIO PER LA VALUTAZIONE DELLE RICHIESTE ED ESIGENZE DEL CONTRAENTE']) {
    const m2 = fakeModel({ op: { esito: 'non operante', documento: 'Documento 1', pagina: 1, evidenza, motivo: 'non selezionata' }, contract: () => PRESENTE(2) })
    const r2 = await runOperativita({ docs, profile: TL_REAL, profiles: REAL, settings: SETTINGS, deps: { callModel: m2.callModel, embed } })
    assert.equal(r2.verdict, 'mismatch', evidenza); assert.equal(r2.formEvidence, true)
  }
})

test('LUCCA: RC sanitaria nominata solo nel frontespizio («SANITARIO», «del Medico») → il modello viene chiamato e il titolo è una prova', async () => {
  const LUCCA_P1 = '                          CERTIFICATO DI ADESIONE\n                                Polizza di Assicurazione\n                   AMTRUST PROFESSIONISTA SANITARIO PROTETTO\n                            Certificato N° RCSPEM00000098\n    ASSICURATO: LUCCA VIVIANA\n    ATTIVITÀ: INFERMIERE PROFESSIONALE/INFERMIERE PEDIATRICO\n    MASSIMALE PER SINISTRO / ANNO\n          € 1.000.000/3.000.000\n    PREMIO LORDO ALLA FIRMA   € 145,36'
  const OK = { esito: 'operante', documento: 'Documento 1', pagina: 1, evidenza: 'AMTRUST PROFESSIONISTA SANITARIO PROTETTO', motivo: 'certificato RC per professionista sanitario' }
  const m = fakeModel({ op: OK, contract: () => PRESENTE(1) })
  const diag = []
  const r = await runOperativita({ docs: [doc('LUCCA_VIVIANA.pdf', [LUCCA_P1])], profile: RC_MED, profiles: REAL, settings: SETTINGS, diag, deps: { callModel: m.callModel, embed } })
  assert.equal(r.verdict, 'ok', diag.join('\n'))
  assert.ok(diag.some((l) => /batch 1: 1 pagine .*D1p1†/.test(l)), 'il frontespizio nomina la copertura (†)')
  // polizza «…del Medico»: prima «mai nominata» → non operante SENZA chiamare il modello
  const BADRAN = 'Assicurazione della Responsabilità Civile Professionale del Medico\nPolizza n. 12345   Massimale 2.000.000,00   Premio 1.250,00'
  const m2 = fakeModel({ op: { ...OK, evidenza: 'Assicurazione della Responsabilità Civile Professionale del Medico' }, contract: () => PRESENTE(1) })
  const r2 = await runOperativita({ docs: [doc('Badran.pdf', [BADRAN])], profile: RC_MED, profiles: REAL, settings: SETTINGS, deps: { callModel: m2.callModel, embed } })
  assert.equal(m2.calls.op, 1, 'la copertura è nominata: decide il modello')
  assert.equal(r2.verdict, 'ok')
  assert.ok(!r2.neverNamed)
})

test('la forma flessa NON riapre gli scarti «mai nominata» fuori dal frontespizio (PRINA tl, infortuni, TL condominio sotto RC)', async () => {
  const OK = (evidenza) => ({ esito: 'operante', documento: 'Documento 1', pagina: 3, evidenza, motivo: 'm' })
  // MyLegalProtection «Giovane Medico»: tutela legale per medici, il medico compare a pag. 3
  const PRINA = ['MyLegalProtection®  CERTIFICATO DI ASSICURAZIONE', 'GARANZIE PRESTATE: TUTELA LEGALE PROFESSIONALE', 'PROFESSIONE ASSICURATA: Giovane Medico\nPremio annuo 180,00']
  const m = fakeModel({ op: OK('PROFESSIONE ASSICURATA: Giovane Medico'), contract: () => PRESENTE(1) })
  const r = await runOperativita({ docs: [doc('PRINA tl.pdf', PRINA)], profile: RC_MED, profiles: REAL, settings: SETTINGS, deps: { callModel: m.callModel, embed } })
  assert.equal(r.verdict, 'mismatch'); assert.equal(r.neverNamed, true); assert.equal(m.calls.op, 0)
  // infortuni: «certificato medico» nelle condizioni
  const INF = ['POLIZZA INFORTUNI N. 46211795\nContraente: BESA ING. SANTANGELO', 'In caso di sinistro la denuncia va corredata da certificato medico', 'Spese sanitarie rimborsate fino a 5.000,00']
  const m2 = fakeModel({ op: OK('certificato medico'), contract: () => PRESENTE(1) })
  const r2 = await runOperativita({ docs: [doc('infortuni.pdf', INF)], profile: RC_MED, profiles: REAL, settings: SETTINGS, deps: { callModel: m2.callModel, embed } })
  assert.equal(r2.verdict, 'mismatch'); assert.equal(r2.neverNamed, true); assert.equal(m2.calls.op, 0)
  // tutela legale condominio sotto RC Professionale: «Professione/Attività» del contraente non è «professionale»
  const TLC = ['POLIZZA TUTELA LEGALE CONDOMINIO\nContraente   Professione/Attività   AMMINISTRATORE', 'Condizioni']
  const m3 = fakeModel({ op: OK('Contraente Professione/Attività AMMINISTRATORE'), contract: () => PRESENTE(1) })
  const r3 = await runOperativita({ docs: [doc('tl.pdf', TLC)], profile: RC_V3, profiles: REAL, settings: SETTINGS, deps: { callModel: m3.callModel, embed } })
  assert.equal(r3.verdict, 'mismatch'); assert.equal(r3.neverNamed, true); assert.equal(m3.calls.op, 0)
  // RCT/RCO sotto RC Professionale: «Malattie professionali X» a pag. 4 non nomina la copertura → prova generica
  const RCT = ['POLIZZA RC PRODOTTI RCT E RCO  BS000576', 'Condizioni RCT', 'Condizioni RCO', 'Lett. F) Malattie professionali X\nRCO massimale 3.000.000,00', 'la responsabilità professionale degli addetti']
  const m4 = fakeModel({ op: { ...OK('Lett. F) Malattie professionali X'), pagina: 4 }, contract: () => PRESENTE(1) })
  const r4 = await runOperativita({ docs: [doc('rct.pdf', RCT)], profile: RC_V3, profiles: REAL, settings: SETTINGS, deps: { callModel: m4.callModel, embed } })
  assert.equal(r4.verdict, 'review'); assert.match(r4.reason, /generica/)
})
