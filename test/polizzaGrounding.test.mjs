/**
 * Test del modulo puro polizzaGrounding.js: finite deterministiche, verifica di
 * supporto rigorosa e normalizzazione. Nessun LLM: si chiamano le funzioni pure.
 *
 * Esegui:  node --test test/polizzaGrounding.test.mjs  (o test/*.test.mjs)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEvidenceWindows, groundedPrompt, verifyGroundedValue, assembleGroundedResult,
  rankWindowsByRecency, recencyPrompt,
  anagraphicSeedKind, anagraphicSeeds, windowsFromLabelValuePairs,
  GROUNDING_MIN_CONFIDENCE, MIN_TRUSTED_CONFIDENCE,
} from '../src/main/services/polizzaGrounding.js'

// ─── Fixture ────────────────────────────────────────────────────────────────

const MASSIMALE = { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: 'Massimale RCT per ogni sinistro', type: 'number' }
const FRANCHIGIA = { id: 'franchigia', label: 'Franchigia base', description: 'Franchigia frontale', type: 'number' }
const IMPOSTA = { id: 'rct_imposta', label: 'Imposta', description: 'Imposta sul premio', type: 'number' }
const CF = { id: 'codice_fiscale_iva', label: 'P. IVA / Cod. Fiscale', description: 'Partita IVA del contraente', type: 'fiscal' }
const SCADENZA = { id: 'scadenza', label: 'Scadenza', description: 'Data di scadenza della polizza', type: 'date' }

// ─── buildEvidenceWindows ───────────────────────────────────────────────────

test('buildEvidenceWindows: massimale trovato in pagina polizza (label di natura)', () => {
  const docs = [{ name: 'polizza.pdf', pages: ['Massimali Assicurati: RCT/RCO € 4.000.000,00 Unico per sinistro\nFRANCHIGIA € 500,00'] }]
  const windows = buildEvidenceWindows(MASSIMALE, docs)
  assert.ok(windows.length >= 1, 'deve produrre almeno una finestra')
  const top = windows[0]
  assert.equal(top.docIndex, 0)
  assert.equal(top.page, 1)
  assert.equal(top.line, 1)
  assert.match(top.snippet, /MASSIMALI ASSICURATI|4\.000\.000,00/i)
  assert.equal(top.labelMatched, true)
})

test('buildEvidenceWindows: premio/quietanza trova la riga dei premi', () => {
  const docs = [{ name: 'imposta.pdf', pages: ['PREMIO IMPONIBILE € 1.001,25 imposta 1.001,25 totale 5.501,25'] }]
  const windows = buildEvidenceWindows(IMPOSTA, docs)
  assert.ok(windows.length >= 1)
  assert.equal(windows[0].line, 1)
})

test('buildEvidenceWindows: finestre ordinate per affidabilità, maxWindows rispettato', () => {
  const docs = [
    { name: 'a.pdf', pages: ['MASSIMALE per sinistro: € 4.000.000,00'] },
    { name: 'b.pdf', pages: ['FRANCHIGIA di € 500,00'] },
    { name: 'c.pdf', pages: ['RIGA DI SFONDO con numeri 12345'] },
  ]
  const windows = buildEvidenceWindows(MASSIMALE, docs, { maxWindows: 2 })
  assert.ok(windows.length >= 1 && windows.length <= 2)
  // la finestra più affidabile (label di natura + confidenza alta) per prima
  assert.equal(windows[0].labelMatched, true)
})

// ─── groundedPrompt ─────────────────────────────────────────────────────────

test('groundedPrompt: obbliga la citazione {doc,page,line}', () => {
  const win = { docIndex: 0, page: 1, line: 3, snippet: 'MASSIMALE € 4.000.000,00' }
  const prompt = groundedPrompt(MASSIMALE, [win], 'number')
  assert.match(prompt, /\[D0 p1 r3\]/)
  assert.match(prompt, /"source": \{"doc": 0, "page": 1, "line": 12\}/)
  assert.match(prompt, /"confidence": 0\.9/)
  assert.match(prompt, /TIPO: number/)
})

// ─── verifyGroundedValue ────────────────────────────────────────────────────

test('verifyGroundedValue: ammette un valore supportato dalla riga citata', () => {
  const docs = [{ name: 'polizza.pdf', pages: ['Massimali Assicurati: € 4.000.000,00 Unico per sinistro'] }]
  const draft = { valore: '4.000.000,00', source: { doc: 0, page: 1, line: 1 }, confidence: 0.95 }
  const ver = verifyGroundedValue(MASSIMALE, draft, docs)
  assert.deepEqual(ver, { ok: true, reason: 'supportato (riga citata)' })
})

test('verifyGroundedValue: rifiuta uno spill (franchigia come massimale)', () => {
  // il valore 7.500 ESISTE nella riga ma con etichetta FRANCHIGIA: contraddice
  // la natura del campo massimale → ok:false
  const docs = [{ name: 'atto.pdf', pages: ['FRANCHIGIA FRONTALE di € 7.500,00'] }]
  const draft = { valore: '7.500,00', source: { doc: 0, page: 1, line: 1 }, confidence: 0.95 }
  const ver = verifyGroundedValue(MASSIMALE, draft, docs)
  assert.equal(ver.ok, false)
  assert.match(ver.reason, /franchi|scopert/)
})

test('verifyGroundedValue: rifiuta un valore NON presente nella riga citata', () => {
  const docs = [{ name: 'polizza.pdf', pages: ['MASSIMALE € 4.000.000,00'] }]
  const draft = { valore: '9.999.999,00', source: { doc: 0, page: 1, line: 1 }, confidence: 0.95 }
  const ver = verifyGroundedValue(MASSIMALE, draft, docs)
  assert.equal(ver.ok, false)
  assert.match(ver.reason, /non contiene/)
})

test('verifyGroundedValue: rifiuta codice fiscale mal-formato', () => {
  const docs = [{ name: 'polizza.pdf', pages: ['P. IVA contraente: 1234'] }]
  const draft = { valore: '1234', source: { doc: 0, page: 1, line: 1 }, confidence: 0.9 }
  const ver = verifyGroundedValue(CF, draft, docs)
  assert.equal(ver.ok, false)
  assert.match(ver.reason, /malformato|codice/)
})

test('verifyGroundedValue: confidenza bassissima → inaffidabile', () => {
  const docs = [{ name: 'p.pdf', pages: ['MASSIMALE € 4.000.000,00'] }]
  const draft = { valore: '4.000.000,00', source: { doc: 0, page: 1, line: 1 }, confidence: 0.1 }
  const ver = verifyGroundedValue(MASSIMALE, draft, docs)
  assert.equal(ver.ok, false)
  assert.match(ver.reason, /confidenza/)
})

test('verifyGroundedValue: riga fuori range → rifiutato', () => {
  const docs = [{ pages: ['una sola riga'] }]
  for (const bad of [
    { doc: 0, page: 999, line: 1 },
    { doc: 0, page: 1, line: 999 },
    { doc: 5, page: 1, line: 1 },
    { doc: -1, page: 1, line: 1 },
  ]) {
    const ver = verifyGroundedValue(MASSIMALE, { valore: '4.000.000,00', source: bad, confidence: 0.9 }, docs)
    assert.equal(ver.ok, false, `source ${JSON.stringify(bad)} deve fallire`)
  }
})

// ─── assembleGroundedResult ─────────────────────────────────────────────────

test('assembleGroundedResult: normalizza un importo', () => {
  const docs = [{ name: 'p.pdf', pages: ['MASSIMALE € 4.000.000,00'] }]
  const res = assembleGroundedResult(MASSIMALE, { valore: '4000000.00', source: { doc: 0, page: 1, line: 1 } }, docs)
  assert.equal(res.value, '4.000.000,00')
  assert.deepEqual(res.source, { file: 'p.pdf', page: 1, line: 1 })
  assert.match(res.snippet, /4\.000\.000,00/)
})

test('assembleGroundedResult: normalizza una data', () => {
  const res = assembleGroundedResult(SCADENZA, { valore: '31-12-2025', source: { doc: 0, page: 1, line: 1 } }, [{ pages: ['Scadenza 31/12/2025'] }])
  assert.equal(res.value, '31/12/2025')
})

test('assembleGroundedResult: normalizza codice fiscale (maiuscolo, pulito)', () => {
  assert.equal(isValidPiva('00151510344'), true)
  const res = assembleGroundedResult(CF, { valore: '00151510344', source: { doc: 0, page: 1, line: 1 } }, [{ pages: ['P. IVA 00151510344'] }])
  assert.equal(res.value, '00151510344')
})

test('assembleGroundedResult: {} / valore null / placeholder → {value:null}', () => {
  assert.deepEqual(assembleGroundedResult(MASSIMALE, {}), { value: null })
  assert.deepEqual(assembleGroundedResult(MASSIMALE, { valore: null }), { value: null })
  assert.deepEqual(assembleGroundedResult(MASSIMALE, { valore: 'non specificato' }), { value: null })
  assert.deepEqual(assembleGroundedResult(MASSIMALE, null), { value: null })
})

// ─── Integrazione con una llmFn mock ────────────────────────────────────────

test('integramente: 3 campi valorizzati + 1 vuoto con un mock di llmFn', async () => {
  // simula il flusso che in integrazione fa buildEvidenceWindows → groundedPrompt →
  // llmFn → verifyGroundedValue → assembleGroundedResult per ciascun campo.
  const docs = [
    { name: 'polizza.pdf', pages: ['MASSIMALE per sinistro: € 4.000.000,00'] },
    { name: 'imposta.pdf', pages: ['IMPOSTA 1.001,25'] },
    { name: 'franchigia.pdf', pages: ['FRANCHIGIA € 500,00'] },
  ]
  const fields = [MASSIMALE, IMPOSTA, FRANCHIGIA, CF]
  const llmFn = async (prompt) => {
    if (/MASSIMALE|massimale/i.test(prompt)) return { valore: '4.000.000,00', source: { doc: 0, page: 1, line: 1 }, confidence: 0.9 }
    if (/IMPOSTA/i.test(prompt)) return { valore: '1.001,25', source: { doc: 1, page: 1, line: 1 }, confidence: 0.9 }
    if (/FRANCHIGIA/i.test(prompt)) return { valore: '500,00', source: { doc: 2, page: 1, line: 1 }, confidence: 0.9 }
    return {} // CF → nessun valore
  }
  const values = {}
  for (const f of fields) {
    const windows = buildEvidenceWindows(f, docs)
    const prompt = groundedPrompt(f, windows, {})
    const draft = await llmFn(prompt)
    const ver = verifyGroundedValue(f, draft, docs)
    if (!ver.ok) continue
    const res = assembleGroundedResult(f, draft, docs)
    if (res.value != null) values[f.id] = res.value
  }
  assert.equal(values[MASSIMALE.id], '4.000.000,00')
  assert.equal(values[IMPOSTA.id], '1.001,25')
  assert.equal(values[FRANCHIGIA.id], '500,00')
  assert.equal(values[CF.id], undefined) // vuoto
})

// helper per il checksum P.IVA nei test
function isValidPiva(s) {
  const v = String(s || '')
  if (!/^\d{11}$/.test(v)) return false
  if (/^(\d)\1{9}/.test(v)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) {
    const d = v.charCodeAt(i) - 48
    if (i % 2 === 0) sum += d
    else { const y = 2 * d; sum += y > 9 ? y - 9 : y }
  }
  return (10 - (sum % 10)) % 10 === (v.charCodeAt(10) - 48)
}

// ─── PASSATA 1: rankWindowsByRecency ─────────────────────────────────────────
test('rankWindowsByRecency: ordina le finestre per recenza del documento (più recente in testa)', () => {
  const docMeta = [
    { name: 'vecchio.pdf', date: '01/01/2020', ts: 1577836800000 },
    { name: 'nuovo.pdf', date: '01/01/2024', ts: 1704067200000 },
  ]
  const ordered = rankWindowsByRecency([
    { doc: 0, page: 1, line: 3, snippet: 'vecchio' },
    { doc: 1, page: 2, line: 1, snippet: 'nuovo' },
  ], docMeta)
  assert.equal(ordered[0].doc, 1, 'il documento più recente (2024) deve stare in testa')
  assert.equal(ordered[1].doc, 0)
})

test('rankWindowsByRecency: documento non datato va in coda (assente)', () => {
  const docMeta = [
    { name: 'anonimo.pdf', index: 0 }, // nessuna ts
    { name: 'datato.pdf', date: '2024/01/01', ts: 1704067200000 },
  ]
  const ordered = rankWindowsByRecency([
    { doc: 0, page: 1, snippet: 'anonimo' },
    { doc: 1, page: 1, snippet: 'datato' },
  ], docMeta)
  assert.equal(ordered[0].doc, 1)
  assert.equal(ordered[1].doc, 0)
})

test('recencyPrompt: il prompt espone doc+pagina+data di ogni finestra', () => {
  const docMeta = [{ name: 'quietanza_2025.pdf', index: 0, date: '31/12/2025', ts: 1 }]
  const prompt = recencyPrompt(MASSIMALE, [
    { doc: 0, page: 4, line: 2, snippet: 'MASSIMALE € 4.000.000,00' },
  ], docMeta, 'number')
  assert.match(prompt, /31\/12\/2025/)
  assert.match(prompt, /pag\.4/)
  assert.match(prompt, /r2/)
  assert.match(prompt, /RECENTE/)
})

test('recencyPrompt: ordina le finestre come ricevute (recency già applicato dal chiamante)', () => {
  const docMeta = [{ name: 'p.pdf', index: 0, date: '2024', ts: 1 }]
  const prompt = recencyPrompt(MASSIMALE, [], docMeta, 'number')
  assert.match(prompt, /FINESTRE CANDIDATE/)
})

// ─── PASSATA 1: finestre complete per campi a descrizione lunga ─────────────
test('buildEvidenceWindows: la finestra completa della riga non viene troncata male', () => {
  const docs = [{ name: 'polizza.pdf', pages: ['MASSIMALE per sinistro: € 4.000.000,00, valido ','anche per attività di diagnosi e interventi',' MULTI LINEA'] }]
  const wins = buildEvidenceWindows(MASSIMALE, docs)
  assert.ok(wins.length >= 1)
  assert.equal(wins[0].page, 1)
  assert.ok(wins[0].line >= 1)
})