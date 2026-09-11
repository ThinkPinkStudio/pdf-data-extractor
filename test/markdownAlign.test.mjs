// Allineamento del markdown (Docling/pdf-inspector) alle pagine della griglia
// spaziale e spezzatura delle pagine su confini strutturali — senza Ollama.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeStagedDocInput, alignMarkdownToPages, splitPageAtBoundaries, splitTextByLines, buildGroupBatches,
} from '../src/services/polizzaService.js'
import { usefulLength } from '../src/services/ocrLayout.js'

const grid1 = [
  'PROFILO CLIENTE                    POLIZZA N. 01469DAS00086',
  'RAGIONE SOCIALE                    GUFFANTI GROUP & PARTNERS S.R.L.',
  'PARTITA IVA                        06457990965',
].join('\n')
const grid2 = [
  'GARANZIE PRESCELTE                 PREMIO NETTO     IMPOSTE     PREMIO LORDO',
  'Tutela Legale Pacchetto Base       178,92           38,01       216,93',
  'PREMIO ANNUO                       1.270,10         269,90      1.540,00',
].join('\n')
const grid3 = [
  'CONDIZIONI GENERALI DI ASSICURAZIONE',
  'Art. 1 Oggetto del contratto. La Società assume a proprio carico il rischio',
  'delle spese legali.',
].join('\n')
const tablePremi = [
  '| DESCRIZIONE GARANZIE | PREMIO NETTO | IMPOSTE | PREMIO LORDO |',
  '|---|---|---|---|',
  '| Tutela Legale Pacchetto Base | 178,92 | 38,01 | 216,93 |',
  '| PREMIO ANNUO | 1.270,10 | 269,90 | 1.540,00 |',
].join('\n')
const mdBlob = [
  '## PROFILO CLIENTE',
  '',
  'RAGIONE SOCIALE GUFFANTI GROUP & PARTNERS S.R.L.',
  '',
  'PARTITA IVA 06457990965',
  '',
  '## GARANZIE PRESCELTE',
  '',
  tablePremi,
  '',
  '## CONDIZIONI GENERALI DI ASSICURAZIONE',
  '',
  'Art. 1 Oggetto del contratto. La Società assume a proprio carico il rischio delle spese legali.',
].join('\n')

test('alignMarkdownToPages: la tabella dei premi finisce sulla pagina della griglia che la contiene', () => {
  const aligned = alignMarkdownToPages([mdBlob], [grid1, grid2, grid3])
  assert.equal(aligned.length, 3)
  assert.ok(aligned[1].includes('| PREMIO ANNUO | 1.270,10 |'), 'tabella premi su pagina 2')
  assert.ok(!aligned[0].includes('PREMIO ANNUO'), 'la tabella NON sta sulla pagina 1')
  assert.ok(aligned[0].includes('06457990965'), 'anagrafica su pagina 1')
  assert.ok(aligned[2].includes('Oggetto del contratto'), 'condizioni su pagina 3')
})

test('alignMarkdownToPages: nessuna unità persa e tabelle mai spezzate', () => {
  const aligned = alignMarkdownToPages([mdBlob], [grid1, grid2, grid3])
  const joined = aligned.join('\n')
  for (const line of mdBlob.split('\n').filter((l) => l.trim())) {
    assert.ok(joined.includes(line), `riga mancante: ${line}`)
  }
  const idx = joined.indexOf(tablePremi)
  assert.ok(idx >= 0, 'la tabella resta contigua (non spezzata)')
})

test('normalizeStagedDocInput: solo griglia → pages collassate, spatial = griglia', () => {
  const pad = 'ETICHETTA                         VALORE 123'
  const r = normalizeStagedDocInput({ pages: [pad] })
  assert.deepEqual(r.spatialPages, [pad])
  assert.equal(r.pages[0], 'ETICHETTA VALORE 123')
})

test('normalizeStagedDocInput: markdown blob + griglia a 3 pagine → 3 pagine markdown allineate', () => {
  const r = normalizeStagedDocInput({ pages: [mdBlob], spatialPages: [grid1, grid2, grid3] })
  assert.equal(r.spatialPages.length, 3)
  assert.equal(r.pages.length, 3)
  assert.ok(r.pages[1].includes('1.540,00'))
})

test('normalizeStagedDocInput: markdown già per pagina (stesso conteggio) resta com\'è', () => {
  const r = normalizeStagedDocInput({ pages: ['a', 'b'], spatialPages: [grid1, grid2] })
  assert.deepEqual(r.pages, ['a', 'b'])
})

test('splitTextByLines: nessun carattere perso, pezzi entro il budget, mai a metà riga', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `riga ${i} valore ${1000 + i},00 descrizione della garanzia numero ${i}`)
  const text = lines.join('\n')
  const pieces = splitTextByLines(text, 300)
  assert.ok(pieces.length > 1)
  for (const p of pieces) assert.ok(usefulLength(p) <= 300 + 80, `pezzo troppo grande: ${usefulLength(p)}`)
  const back = pieces.join('\n').split('\n')
  assert.deepEqual(back, lines, 'le righe tornano identiche e nell\'ordine')
})

test('splitPageAtBoundaries: pagina griglia enorme → più pezzi, tutto il testo conservato (prima si troncava)', () => {
  const lines = Array.from({ length: 120 }, (_, i) => `RIGA ${i}    ETICHETTA ${i}          ${i * 7},00`)
  const page = lines.join('\n')
  const pieces = splitPageAtBoundaries(page, 1000)
  assert.ok(pieces.length >= 3)
  const joined = pieces.join('\n')
  for (const l of lines) assert.ok(joined.includes(l), `persa: ${l}`)
})

test('splitPageAtBoundaries: tabella oltre il budget spezzata per righe con header ripetuto', () => {
  const rows = Array.from({ length: 60 }, (_, i) => `| Garanzia ${i} | ${i},00 | ${i * 2},00 | ${i * 3},00 |`)
  const table = ['| DESCRIZIONE | NETTO | IMPOSTE | LORDO |', '|---|---|---|---|', ...rows].join('\n')
  const pieces = splitPageAtBoundaries(table, 600)
  assert.ok(pieces.length > 1)
  for (const p of pieces) {
    assert.ok(p.startsWith('| DESCRIZIONE | NETTO |'), 'header ripetuto in testa a ogni pezzo')
    for (const l of p.split('\n')) assert.ok(/^\|.*\|$/.test(l.trim()), `riga spezzata: ${l}`)
  }
  const joined = pieces.join('\n')
  for (const r of rows) assert.ok(joined.includes(r))
})

test('buildGroupBatches: con markdown allineato, le tabelle Docling stanno nel batch della pagina giusta', () => {
  const { pages, spatialPages } = normalizeStagedDocInput({ pages: [mdBlob], spatialPages: [grid1, grid2, grid3] })
  const doc = { name: 'polizza.pdf', pages, spatialPages }
  const batches = buildGroupBatches([doc], 260) // budget piccolo: una pagina per batch
  const withTable = batches.filter((b) => b.text.includes('TABELLE DOCLING'))
  assert.equal(withTable.length, 1, 'la tabella compare in UN solo batch')
  assert.ok(withTable[0].text.includes('· pag. 2]'), 'ed è il batch della pagina 2')
})

test('sanitizeFieldValue: una DATA proposta per un campo IMPORTO viene scartata, un importo vero passa', async () => {
  const { sanitizeFieldValue } = await import('../src/services/polizzaService.js')
  const massimale = { id: 'x1', label: 'Massimale per anno tutela legale', description: "Massimale per anno: l'importo massimo (in euro) che la compagnia paga", type: 'number' }
  assert.equal(sanitizeFieldValue(massimale, '04/06/2025'), null)
  assert.equal(sanitizeFieldValue(massimale, '40.000,00'), '40.000,00')
  const interessi = { id: 'x2', label: 'Interessi di frazionamento', description: "Interessi di frazionamento del premio: l'importo (in euro)", type: 'number' }
  assert.equal(sanitizeFieldValue(interessi, '31-12-2025'), null)
  assert.equal(sanitizeFieldValue(interessi, '0,00'), '0,00')
  const decorrenza = { id: 'x3', label: 'Decorrenza', description: 'Data di decorrenza della polizza', type: 'date' }
  assert.equal(sanitizeFieldValue(decorrenza, '04/06/2025'), '04/06/2025')
})

test('splitSubTables: una riga-intestazione dentro il corpo apre una sotto-tabella con i suoi nomi di colonna', async () => {
  const { splitSubTables, tableRowsWithHeaders, repairTableMarkdown } = await import('../src/services/ocrLayout.js')
  const block = [
    '| RISCHI ASSICURATI |  |  |  |  |  |',
    '|---|---|---|---|---|---|',
    '| Attività | Studio associato | Studio associato | Studio associato | Studio associato | Studio associato |',
    '| Fatturato | 1.500.000,00 | 1.500.000,00 | 1.500.000,00 | 1.500.000,00 | 1.500.000,00 |',
    '| PREMIO TOTALE | NETTO IMPONIBILE | INTERESSE DI FRAZIONAMENTO | DIRITTI | IMPOSTE | PREMIO LORDO |',
    '| PREMIO ALLA FIRMA | 1.270,10 | 0,00 | 0,00 | 269,90 | 1.540,00 |',
    '| PREMIO RATA SUCCESSIVA | 1.270,10 | 0,00 | 0,00 | 269,90 | 1.540,00 |',
  ].join('\n')
  const subs = splitSubTables(block)
  assert.equal(subs.length, 2)
  assert.ok(subs[1].startsWith('| PREMIO TOTALE | NETTO IMPONIBILE |'))
  const rows = tableRowsWithHeaders(block)
  const firma = rows.find((r) => r.label === 'PREMIO ALLA FIRMA')
  assert.ok(firma, 'riga premio alla firma presente')
  const byHeader = Object.fromEntries(firma.cols.map((c) => [c.header, c.value]))
  assert.equal(byHeader['IMPOSTE'], '269,90')
  assert.equal(byHeader['INTERESSE DI FRAZIONAMENTO'], '0,00')
  assert.equal(byHeader['PREMIO LORDO'], '1.540,00')
  const repaired = repairTableMarkdown(block)
  assert.ok(repaired.includes('| PREMIO TOTALE | NETTO IMPONIBILE |'), 'anche il markdown riparato espone l\'intestazione interna')
  // tutte le righe dati sopravvivono
  assert.ok(repaired.includes('Fatturato') && repaired.includes('PREMIO RATA SUCCESSIVA'))
})

test('splitSubTables: tabella senza intestazioni interne resta intera', async () => {
  const { splitSubTables } = await import('../src/services/ocrLayout.js')
  const block = ['| A | B | C |', '|---|---|---|', '| r1 | 1,00 | 2,00 |', '| r2 | 3,00 | 4,00 |'].join('\n')
  assert.deepEqual(splitSubTables(block), [block])
})

test('sanitizeFieldValue: importo preventivo e tasso di regolazione accettano numeri (la parola "parametro" nella descrizione non li blocca)', async () => {
  const { sanitizeFieldValue } = await import('../src/services/polizzaService.js')
  const importo = { id: 'i1', label: 'Importo preventivo parametro regolazione', description: "Importo preventivo annuo del parametro di regolazione: l'importo (in euro)", type: 'number' }
  assert.equal(sanitizeFieldValue(importo, '1.500.000,00'), '1.500.000,00')
  const tasso = { id: 't1', label: 'Tasso regolazione ‰ ', description: 'Tasso di regolazione: il tasso espresso per mille (‰) applicato al parametro di regolazione', type: '' }
  assert.equal(sanitizeFieldValue(tasso, '3,00 ‰'), '3,00')
  const parametro = { id: 'p1', label: 'Parametro regolazione ', description: 'Parametro utilizzato per la regolazione del premio: il NOME del parametro come TESTO', type: 'text' }
  assert.equal(sanitizeFieldValue(parametro, '1.500.000,00'), null)
  assert.equal(sanitizeFieldValue(parametro, 'Fatturato'), 'Fatturato')
})
