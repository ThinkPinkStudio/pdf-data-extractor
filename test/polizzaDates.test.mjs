/**
 * Test della logica data/recenza per l'estrazione polizze RC.
 *
 * Esegui:  node --test
 *
 * Copre il bug segnalato: con piu' documenti (quietanze + regolazioni premio),
 * l'app deve tenere SEMPRE il dato del periodo di copertura PIU' RECENTE, e la
 * recenza va stabilita sulla data INTERNA del documento (scadenza/periodo),
 * NON sulla data di emissione/stampa.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseDateFromContextLine,
  parseLastDateFromContextLine,
  latestDateExcludingEmission,
  extractDocumentDateString,
  extractDocumentDate,
  normalizeDateValue,
  dateStrToTs,
  shouldReplaceValue,
  pickDocDateFromExtracted
} from '../src/main/services/polizzaDates.js'

// ─── Fixture realistiche ─────────────────────────────────────────────────────

// Regolazione premio del 2024: descrive il PERIODO 2024 ma e' EMESSA nel 2025.
// La sua recenza deve valere 31/12/2024 (fine periodo), non 15/03/2025.
const REGOLAZIONE_2024 = `
GENERALI ITALIA S.P.A.
REGOLAZIONE PREMIO
Contraente: EULIP SRL
Polizza RCTO n. 283618616
DATI REGOLAZIONE PREMIO PER IL PERIODO 01/01/2024 - 31/12/2024
Retribuzioni preventivate Inail e non Inail: 1.800.000,00
Massimale per sinistro: 2.000.000,00
Premio totale: 7.502,50
Documento emesso in Parma il 15/03/2025
`

// Quietanza della polizza corrente: copertura fino al 31/12/2025.
// Emessa il 20/12/2024 (PRIMA della regolazione 2024), ma e' il documento
// che descrive il periodo piu' recente.
const QUIETANZA_2025 = `
GENERALI ITALIA S.P.A.
QUIETANZA DI PAGAMENTO
Contraente: EULIP SRL
Polizza n. 283618616
DECORRENZA 31/12/2024   SCADENZA 31/12/2025
Massimale per sinistro: 4.000.000,00
Premio totale: 5.501,25
Documento emesso il 20/12/2024
`

// ─── 1. Data di recenza = periodo di copertura, NON emissione ────────────────

test('regolazione 2024 emessa nel 2025 → recenza = 31/12/2024 (fine periodo, non emissione)', () => {
  assert.equal(extractDocumentDateString(REGOLAZIONE_2024), '31/12/2024')
})

test('quietanza 2025 → recenza = 31/12/2025 (scadenza)', () => {
  assert.equal(extractDocumentDateString(QUIETANZA_2025), '31/12/2025')
})

test('la data di EMISSIONE non deve mai vincere sulla scadenza di copertura', () => {
  const txt = `
    Polizza n. 999
    Documento emesso in Milano il 25/05/2026
    DECORRENZA 01/01/2023  SCADENZA 31/12/2023
  `
  // Emissione 2026 presente, ma la copertura scade nel 2023 → vince il 2023.
  assert.equal(extractDocumentDateString(txt), '31/12/2023')
})

test('fallback: ignora le righe di emissione/stampa quando non c\'e\' copertura', () => {
  const txt = `Stampato il 31/12/2030\nTotale movimenti al 15/06/2024`
  assert.equal(latestDateExcludingEmission(txt), '15/06/2024')
  assert.equal(extractDocumentDateString(txt), '15/06/2024')
})

// ─── 2. Ordinamento per data interna ─────────────────────────────────────────

test('la quietanza 2025 e\' piu\' recente della regolazione 2024', () => {
  const tsReg = extractDocumentDate(REGOLAZIONE_2024)
  const tsQui = extractDocumentDate(QUIETANZA_2025)
  assert.ok(tsQui > tsReg, `attesa quietanza(${tsQui}) > regolazione(${tsReg})`)
})

test('ordinamento crescente: il documento piu\' recente finisce in fondo', () => {
  const files = [
    { name: 'quietanza 2025.pdf', text: QUIETANZA_2025 },
    { name: 'regolazione premio 2024.pdf', text: REGOLAZIONE_2024 }
  ]
  files.sort((a, b) => extractDocumentDate(a.text) - extractDocumentDate(b.text))
  assert.equal(files[files.length - 1].name, 'quietanza 2025.pdf')
})

// ─── 3. Regola "vince il piu' recente" (cuore del merge) ─────────────────────

test('shouldReplaceValue: il valore piu\' recente sostituisce quello vecchio', () => {
  assert.equal(shouldReplaceValue('31/12/2024', '31/12/2025'), true)
})

test('shouldReplaceValue: NON sostituire un valore datato con uno piu\' vecchio', () => {
  assert.equal(shouldReplaceValue('31/12/2025', '31/12/2024'), false)
})

test('shouldReplaceValue: NON sostituire un valore datato con uno senza data', () => {
  assert.equal(shouldReplaceValue('31/12/2025', null), false)
})

test('shouldReplaceValue: a parita\'/assenza di data, il nuovo passa', () => {
  assert.equal(shouldReplaceValue(null, null), true)
  assert.equal(shouldReplaceValue(null, '31/12/2025'), true)
})

// ─── 4. Scenario completo: il dato corrente vince in QUALSIASI ordine ────────
// Riproduce il comportamento del merge: per un campo non-data (es. massimale)
// la data effettiva del valore e' la data interna del documento da cui proviene.

function mergeWinner(docs) {
  // docs: [{ value, effective }] nell'ordine di elaborazione
  let cur = null // { value, effective }
  for (const d of docs) {
    if (cur == null) { cur = { ...d }; continue }
    if (shouldReplaceValue(cur.effective, d.effective)) cur = { ...d }
  }
  return cur?.value
}

test('massimale: vince 4.000.000 (quietanza 2025) qualunque sia l\'ordine di caricamento', () => {
  const fromReg = { value: '2.000.000,00', effective: extractDocumentDateString(REGOLAZIONE_2024) }
  const fromQui = { value: '4.000.000,00', effective: extractDocumentDateString(QUIETANZA_2025) }

  // ordine A: regolazione poi quietanza
  assert.equal(mergeWinner([fromReg, fromQui]), '4.000.000,00')
  // ordine B: quietanza poi regolazione (il vecchio NON deve sovrascrivere)
  assert.equal(mergeWinner([fromQui, fromReg]), '4.000.000,00')
})

test('premio totale: vince 5.501,25 (periodo 2025) e non 7.502,50 (periodo 2024)', () => {
  const fromReg = { value: '7.502,50', effective: extractDocumentDateString(REGOLAZIONE_2024) }
  const fromQui = { value: '5.501,25', effective: extractDocumentDateString(QUIETANZA_2025) }
  assert.equal(mergeWinner([fromReg, fromQui]), '5.501,25')
  assert.equal(mergeWinner([fromQui, fromReg]), '5.501,25')
})

// ─── 5. Regressioni sui parser di base ───────────────────────────────────────

test('parseDateFromContextLine: formato standard', () => {
  assert.equal(parseDateFromContextLine('SCADENZA 31/12/2025', /SCADENZA\b[^\n]{0,100}/i), '31/12/2025')
})

test('parseDateFromContextLine: artefatto OCR "31 112 I 2021" → 31/12/2021', () => {
  assert.equal(parseDateFromContextLine('DECORRENZA 31 112 I 2021', /DECORRENZA\b[^\n]{0,100}/i), '31/12/2021')
})

test('parseLastDateFromContextLine: prende la data di FINE periodo', () => {
  assert.equal(
    parseLastDateFromContextLine('PER IL PERIODO 01/01/2024 - 31/12/2024', /PERIODO\b[^\n]{0,140}/i),
    '31/12/2024'
  )
})

test('normalizeDateValue / dateStrToTs di base', () => {
  assert.equal(normalizeDateValue('1/2/2025'), '01/02/2025')
  assert.equal(normalizeDateValue('2025-12-31'), '31/12/2025')
  assert.equal(normalizeDateValue('non una data'), null)
  assert.ok(dateStrToTs('31/12/2025') > dateStrToTs('31/12/2024'))
  assert.equal(dateStrToTs('xx'), null)
})

// ─── 6. Data interna da campi estratti via OCR (documenti scansionati) ───────

const FIELDS_BY_ID = {
  scadenza: { id: 'scadenza', type: 'date' },
  decorrenza: { id: 'decorrenza', type: 'date' },
  rct_massimale_sinistro: { id: 'rct_massimale_sinistro', type: 'text' }
}

test('pickDocDateFromExtracted: usa la scadenza letta dall\'OCR', () => {
  const updated = {
    scadenza: { valore: '31/12/2025' },
    rct_massimale_sinistro: { valore: '4.000.000,00' }
  }
  assert.equal(pickDocDateFromExtracted(updated, FIELDS_BY_ID), '31/12/2025')
})

test('pickDocDateFromExtracted: preferisce scadenza a decorrenza', () => {
  const updated = { decorrenza: '31/12/2024', scadenza: '31/12/2025' }
  assert.equal(pickDocDateFromExtracted(updated, FIELDS_BY_ID), '31/12/2025')
})

test('pickDocDateFromExtracted: un massimale NON è una data', () => {
  const updated = { rct_massimale_sinistro: { valore: '4.000.000,00' } }
  assert.equal(pickDocDateFromExtracted(updated, FIELDS_BY_ID), null)
})

test('OCR: il massimale del documento scansionato 2025 vince sul testo 2023', () => {
  // Simula: doc testo 2023 mette massimale 2.000.000 datato 31/12/2023;
  // poi il doc scansionato 2025 (OCR) estrae scadenza 31/12/2025 + massimale 4.000.000.
  const visionUpdated = {
    scadenza: { valore: '31/12/2025' },
    rct_massimale_sinistro: { valore: '4.000.000,00' }
  }
  const visionDate = pickDocDateFromExtracted(visionUpdated, FIELDS_BY_ID)
  // il valore non-data (massimale) eredita la data interna OCR del documento
  assert.equal(shouldReplaceValue('31/12/2023', visionDate), true)  // 2025 > 2023 → sostituisce
  assert.equal(shouldReplaceValue('31/12/2025', '31/12/2023'), false) // e non torna indietro
})
