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

import { runOperativita, runContractCheck, runPrecheck } from '../src/services/polizzaPrecheckService.js'

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
