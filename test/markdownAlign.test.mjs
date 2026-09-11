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

test('buildGroupBatches: con la griglia nei prompt (POLIZZA_MD_PROMPT=0) le tabelle Docling stanno nel batch della pagina giusta', () => {
  const prev = process.env.POLIZZA_MD_PROMPT
  process.env.POLIZZA_MD_PROMPT = '0'
  try {
    const { pages, spatialPages } = normalizeStagedDocInput({ pages: [mdBlob], spatialPages: [grid1, grid2, grid3] })
    const doc = { name: 'polizza.pdf', pages, spatialPages }
    const batches = buildGroupBatches([doc], 260) // budget piccolo: una pagina per batch
    const withTable = batches.filter((b) => b.text.includes('TABELLE DOCLING'))
    assert.equal(withTable.length, 1, 'la tabella compare in UN solo batch')
    assert.ok(withTable[0].text.includes('· pag. 2]'), 'ed è il batch della pagina 2')
  } finally { if (prev == null) delete process.env.POLIZZA_MD_PROMPT; else process.env.POLIZZA_MD_PROMPT = prev }
})

test('normalizeStagedDocInput (default): il markdown allineato È il testo dei prompt, la tabella premi sta nella pagina 2', () => {
  const r = normalizeStagedDocInput({ pages: [mdBlob], spatialPages: [grid1, grid2, grid3] })
  assert.equal(r.spatialPages.length, 3)
  assert.ok(r.spatialPages[1].includes('| PREMIO ANNUO | 1.270,10 |'), 'prompt pagina 2 = markdown con la tabella')
  assert.ok(/markdown nei prompt/.test(r.textMode))
  const batches = buildGroupBatches([{ name: 'polizza.pdf', ...r }], 260)
  const withRow = batches.filter((b) => b.text.includes('| PREMIO ANNUO | 1.270,10 |'))
  assert.ok(withRow.length >= 1)
  for (const b of withRow) assert.ok(b.text.includes('· pag. 2]'), 'la riga premi sta solo nei batch della pagina 2')
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
  assert.ok(rows.find((r) => r.label === 'Attività'), 'la riga "Attività" (celle ripetute) resta una riga DATI, non un\'intestazione')
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

test('textContentToBlocks: le coordinate pdf.js (y verso l\'alto) diventano righe dall\'ALTO verso il basso', async () => {
  const { textContentToBlocks } = await import('../src/services/pdfTextLayer.js')
  const { buildSpatialPage } = await import('../src/services/ocrLayout.js')
  // Pagina alta 800: "POLIZZA N." in alto (y=780), "DECORRENZA" a metà (y=600),
  // il suo valore subito SOTTO (y=588), il piè di pagina in basso (y=20).
  const item = (str, x, y, fs = 10) => ({ str, transform: [fs, 0, 0, fs, x, y], width: str.length * fs * 0.5 })
  const content = { items: [
    item('dasdifesalegale@pec.das.it', 20, 20),
    item('04/06/2025', 26, 588), item('04/06/2026', 120, 588),
    item('DECORRENZA', 26, 600), item('SCADENZA', 120, 600),
    item('POLIZZA N.', 24, 780), item('01469DAS00086', 110, 780),
  ] }
  const text = buildSpatialPage(textContentToBlocks(content, { pageHeight: 800 }))
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  assert.ok(lines[0].startsWith('POLIZZA N.'), `prima riga attesa POLIZZA N., trovata: ${lines[0]}`)
  assert.ok(lines.indexOf(lines.find((l) => l.startsWith('DECORRENZA'))) < lines.indexOf(lines.find((l) => l.startsWith('04/06/2025'))), 'etichetta PRIMA del valore')
  assert.ok(lines[lines.length - 1].startsWith('dasdifesalegale'), 'piè di pagina per ultimo')
  // senza pageHeight l'ordine relativo resta comunque corretto
  const text2 = buildSpatialPage(textContentToBlocks(content))
  assert.ok(text2.split('\n').map((l) => l.trim()).filter(Boolean)[0].startsWith('POLIZZA N.'))
})

test('pickConsensusCandidate: a pari data vince il valore proposto più volte; date diverse non contano', async () => {
  const { pickConsensusCandidate } = await import('../src/services/polizzaService.js')
  const mk = (valore, affinity, effDate = '04/06/2025') => ({ valore, affinity, effDate })
  const current = mk('00220930234', 0.53)
  const cands = [current, mk('00220930234', 0.5), ...Array.from({ length: 7 }, () => mk('06457990965', 0.45))]
  const r = pickConsensusCandidate(current, cands)
  assert.equal(r.changed, true)
  assert.equal(r.cand.valore, '06457990965')
  assert.equal(r.votes, 7)
  // candidati di un'ALTRA data non entrano nel conteggio (la recency resta sovrana)
  const cur2 = mk('5.501,25', 0.5, '31/12/2025')
  const old = Array.from({ length: 5 }, () => mk('4.900,00', 0.6, '31/12/2023'))
  assert.equal(pickConsensusCandidate(cur2, [cur2, ...old]).changed, false)
  // un solo voto non basta
  assert.equal(pickConsensusCandidate(mk('a', 0.5), [mk('a', 0.5), mk('b', 0.9)]).changed, false)
})

test('schema staged: TUTTE le chiavi c0..cN obbligatorie e in ordine (niente compattamento delle chiavi)', async () => {
  const { buildJsonSchema, buildGbnfGrammar } = await import('../src/services/gbnfSchema.js')
  const fields = [
    { id: 'a', label: 'Franchigia', description: 'importo', type: 'number' },
    { id: 'b', label: 'Garanzie', description: 'TESTO elenco', type: 'text' },
    { id: 'c', label: 'Decorrenza', description: 'data', type: 'date' },
  ]
  const schema = buildJsonSchema(fields, 'staged')
  assert.deepEqual(schema.required, ['c0', 'c1', 'c2'])
  assert.equal(schema.additionalProperties, false)
  // il valore può essere null (campo assente) senza saltare la chiave
  assert.ok(schema.properties.c0.properties.valore.anyOf.some((x) => x.type === 'null'))
  const g = buildGbnfGrammar(fields, 'staged')
  const root = g.split('\n').find((l) => l.startsWith('root ::='))
  assert.ok(/f_a_kv[\s\S]*f_b_kv[\s\S]*f_c_kv/.test(root), `root deve elencare le tre chiavi in sequenza: ${root}`)
  assert.ok(!/items\?/.test(root), 'niente sottoinsieme opzionale di chiavi')
})

test('pickConsensusCandidate: gli importi a zero (segnaposto) non fanno voto', async () => {
  const { pickConsensusCandidate } = await import('../src/services/polizzaService.js')
  const mk = (valore, affinity, effDate = '04/06/2025') => ({ valore, affinity, effDate })
  const current = mk('1.270,10', 0.6)
  const cands = [current, mk('1.270,10', 0.5), ...Array.from({ length: 6 }, () => mk('0,00', 0.4))]
  assert.equal(pickConsensusCandidate(current, cands).changed, false)
})


test('schema: parole negli importi SOLO se la descrizione le ammette; array in cima parsato', async () => {
  const { buildJsonSchema, VALUE_PATTERNS, amountAllowsWord } = await import('../src/services/gbnfSchema.js')
  const strict = { id: 'p', label: 'Premio lordo', description: "l'importo complessivo (in euro)", type: 'number' }
  const loose = { id: 'm', label: 'Massimale per anno', description: 'importo (es. 40.000,00) oppure la parola "Illimitato"', type: 'number' }
  assert.equal(amountAllowsWord(strict), false)
  assert.equal(amountAllowsWord(loose), true)
  const sch = buildJsonSchema([strict, loose], 'staged')
  const pat0 = sch.properties.c0.properties.valore.anyOf[0].pattern
  const pat1 = sch.properties.c1.properties.valore.anyOf[0].pattern
  assert.equal(new RegExp(pat0).test('Pacchetto sicurezza privacy'), false)
  assert.equal(new RegExp(pat0).test('1.540,00'), true)
  assert.equal(new RegExp(pat1).test('Illimitato'), true)
  assert.equal(pat0, VALUE_PATTERNS.amount)
})


test('cleanMarkdownForPrompt: entità HTML, escape markdown e marcatori immagine spariscono', async () => {
  const { cleanMarkdownForPrompt, normalizeStagedDocInput } = await import('../src/services/polizzaService.js')
  const md = '<!-- image -->\n\nGUFFANTI GROUP &amp; PARTNERS S.R.L.\n\n01469DAS00086\\_AA\n\n\n\n| A | B |\n|---|---|\n| x | 1,00 |'
  const c = cleanMarkdownForPrompt(md)
  assert.ok(c.includes('GUFFANTI GROUP & PARTNERS'))
  assert.ok(c.includes('01469DAS00086_AA'))
  assert.ok(!c.includes('<!--'))
  assert.ok(!/\n{3,}/.test(c))
  const r = normalizeStagedDocInput({ pages: [md], spatialPages: ['GUFFANTI GROUP & PARTNERS 01469DAS00086', 'A B x 1,00'] })
  assert.ok(r.spatialPages.join('\n').includes('& PARTNERS'))
})


test('pickConsensusCandidate: un valore molto meno affine non vince per soli voti', async () => {
  const { pickConsensusCandidate } = await import('../src/services/polizzaService.js')
  const mk = (valore, affinity, effDate = '04/06/2025') => ({ valore, affinity, effDate })
  const current = mk('50.000,00', 0.62)
  const cands = [current, mk('50.000,00', 0.6), mk('1', 0.2), mk('1', null), mk('1', 0.3)]
  assert.equal(pickConsensusCandidate(current, cands).changed, false)
  // comparabili (entro 0.10) → i voti decidono
  const cur2 = mk('00220930234', 0.53)
  const c2 = [cur2, mk('00220930234', 0.5), ...Array.from({ length: 5 }, () => mk('06457990965', 0.45))]
  assert.equal(pickConsensusCandidate(cur2, c2).changed, true)
})


test('sanitizeFieldValue: un indirizzo che cita la P.IVA solo nella descrizione NON passa dal validatore CF', async () => {
  const { sanitizeFieldValue } = await import('../src/services/polizzaService.js')
  const indirizzo = { id: 'a1', label: 'Indirizzo', description: 'Indirizzo completo di domicilio o sede legale del contraente: via, civico, CAP, città. È l\'indirizzo associato al NOME del contraente (stesso blocco anagrafico della P.IVA).', type: 'text' }
  assert.equal(sanitizeFieldValue(indirizzo, "VIALE CATERINA DA FORLI' 32, 20146 MILANO"), "VIALE CATERINA DA FORLI' 32, 20146 MILANO")
  const piva = { id: 'p1', label: 'P. IVA / Cod. Fiscale', description: 'Partita IVA o codice fiscale del contraente: 11 cifre o 16 caratteri', type: 'text' }
  assert.equal(sanitizeFieldValue(piva, '06457990965'), '06457990965')
  assert.equal(sanitizeFieldValue(piva, '06457990960'), null)
})

test('pickConsensusCandidate: livello per data del DOCUMENTO (le date votano) e campo svuotato → livello più recente', async () => {
  const { pickConsensusCandidate } = await import('../src/services/polizzaService.js')
  const mk = (valore, affinity, srcDate = '04/06/2025') => ({ valore, affinity, effDate: valore, srcDate })
  const cur = mk('04/06/2026', 0.43)
  const cands = [cur, mk('04/06/2025', 0.42), mk('04/06/2025', 0.42), mk('04/06/2025', 0.42), mk('14/04/2025', 0.56), mk('14/04/2025', 0.56)]
  const r = pickConsensusCandidate(cur, cands)
  assert.equal(r.changed, true); assert.equal(r.cand.valore, '04/06/2025')
  // campo svuotato da una guardia: il consenso sceglie comunque tra i candidati
  const c2 = [mk('Illimitato', 0.57), mk('Illimitato', 0.57), mk('Illimitato', 0.5), mk('3', null)]
  const r2 = pickConsensusCandidate(null, c2.map((c) => ({ ...c, effDate: '04/06/2025' })))
  assert.equal(r2.changed, true); assert.equal(r2.cand.valore, 'Illimitato')
})


test('cleanMarkdownForPrompt: la casella con il glifo della spunta in coda diventa [x], le altre restano [ ]', async () => {
  const { cleanMarkdownForPrompt } = await import('../src/services/polizzaService.js')
  const md = [
    '- [ ] Tutela della mobilità / circolazione',
    '- [ ] Tutela della vita privata',
    '- [ ] Tutela della propria attività professionale X',
    "- [ ] Tutela dell'attività d'impresa o dell'ente",
    '- [ ] Protezione del patrimonio ✔',
    'Opzioni: ☒ Sì ☐ No',
  ].join('\n')
  const c = cleanMarkdownForPrompt(md)
  assert.ok(c.includes('- [x] Tutela della propria attività professionale\n'), c)
  assert.ok(c.includes('- [x] Protezione del patrimonio\n') || c.endsWith('- [x] Protezione del patrimonio') || c.includes('- [x] Protezione del patrimonio\nOpzioni'))
  assert.ok(c.includes('- [ ] Tutela della vita privata'))
  assert.ok(c.includes('[x] Sì [ ] No'))
})


test('pickConsensusCandidate: un candidato da documento SENZA data non definisce il livello; vincono le risposte datate', async () => {
  const { pickConsensusCandidate } = await import('../src/services/polizzaService.js')
  const cur = { valore: 'annuale o può essere suddiviso in rate semestrali', affinity: 0.65, effDate: null, srcDate: null }
  const cands = [cur, ...Array.from({ length: 6 }, () => ({ valore: 'Annuale', affinity: 0.43, effDate: '04/06/2025', srcDate: '04/06/2025' }))]
  const r = pickConsensusCandidate(cur, cands)
  assert.equal(r.changed, true); assert.equal(r.cand.valore, 'Annuale')
})


test('tableRowsWithHeaders: colonna di numerazione + header ripetuto → etichetta "9. Formazione del Premio", colonne senza nome', async () => {
  const { tableRowsWithHeaders } = await import('../src/services/ocrLayout.js')
  const block = [
    '| ARTICOLI | ARTICOLI | ARTICOLI |',
    '|---|---|---|',
    '| 1. | Contraente | Saporiti Massimo |',
    '| 5. | Massimale | Massimale aggregato: € 2.000.000,00 |',
    '| 9. | Formazione del Premio | Premio lordo € 800,00 Imposte € 145,60 |',
  ].join('\n')
  const rows = tableRowsWithHeaders(block)
  assert.equal(rows[0].label, '1. Contraente')
  assert.equal(rows[0].cols.length, 1)
  assert.equal(rows[0].cols[0].value, 'Saporiti Massimo')
  assert.equal(rows[0].cols[0].header, '')
  assert.equal(rows[2].label, '9. Formazione del Premio')
  // la cella "Premio lordo € 800,00 Imposte € 145,60" viene espansa in colonne nominate
  assert.equal(rows[2].cols[0].header, 'Premio lordo')
  assert.equal(rows[2].cols[0].value, '800,00')
})

test('autoKind: "Verifica se…" è una domanda testuale, un importo nudo viene scartato; con "riporta massimali" i numeri passano', async () => {
  const { sanitizeFieldValue } = await import('../src/services/polizzaService.js')
  const { isTextualField } = await import('../src/services/polizzaValidation.js')
  const odv = { id: 'o1', label: 'ODV / CDA', description: 'Verifica se sono coperti incarichi in ODV ex D.Lgs. 231/2001, consigliere di amministrazione.', type: 'text' }
  assert.equal(isTextualField(odv), true)
  assert.equal(sanitizeFieldValue(odv, '654,40'), null)
  assert.equal(sanitizeFieldValue(odv, 'No'), 'No')
  const sind = { id: 's1', label: 'Sindaco / Revisore', description: 'Verifica se sono coperti incarichi di sindaco, revisore legale. Riporta massimali o limiti.', type: 'text' }
  assert.equal(sanitizeFieldValue(sind, '250.000,00'), '250.000,00')
})

test('autoKind: descrizione di importo con esempio numerico vince sulla label "Frazionamento"/"Tacito Rinnovo"', async () => {
  const { sanitizeFieldValue } = await import('../src/services/polizzaService.js')
  const { isTextualField } = await import('../src/services/polizzaValidation.js')
  const imposte = { id: 't1', label: 'Tacito Rinnovo', description: "Imposte della polizza RC (es. 49,05): è la cifra nella colonna 'IMPOSTE' del frontespizio. È un importo fiscale.", type: 'text' }
  assert.equal(isTextualField(imposte), false)
  assert.equal(sanitizeFieldValue(imposte, '600,61'), '600,61')
  const imponibile = { id: 'f1', label: 'Frazionamento', description: "Premio imponibile della polizza RC (es. 220,45). È l'importo nella colonna 'IMPONIBILE'.", type: 'text' }
  assert.equal(sanitizeFieldValue(imponibile, '2.699,39'), '2.699,39')
  const fraz = { id: 'f2', label: 'Frazionamento', description: 'Frazionamento del premio: la periodicità di pagamento del premio, come TESTO (es. Annuale, Semestrale).', type: 'text' }
  assert.equal(isTextualField(fraz), true)
  assert.equal(sanitizeFieldValue(fraz, '654,40'), null)
})

test('cleanMarkdownForPrompt: "Alle ore … Dalle ore …" nella stessa cella torna "Dalle … Alle …"', async () => {
  const { cleanMarkdownForPrompt } = await import('../src/services/polizzaService.js')
  const md = '| 4. | Periodo di validità della polizza | Alle ore 24:00 del 31 marzo 2023 Dalle ore 24:00 del 31 marzo 2022 |'
  const c = cleanMarkdownForPrompt(md)
  assert.ok(c.indexOf('Dalle ore 24:00 del 31 marzo 2022') < c.indexOf('Alle ore 24:00 del 31 marzo 2023'), c)
  const ok = '| 4. Periodo | Dalle ore 24.00 del 09 novembre 2017 Alle ore 24.00 del 09 novembre 2018 |'
  assert.equal(cleanMarkdownForPrompt(ok), ok)
})

test('pickSemanticCandidate: la riga di tabella vince a parità e cede solo a un candidato nettamente più affine', async () => {
  const { pickSemanticCandidate } = await import('../src/services/polizzaValidation.js')
  const table = { valore: '2.500.000,00', affinity: 0.72, tableRow: true, effDate: '30/01/2017' }
  const clause = { valore: '500.000,00', affinity: 0.72, effDate: '30/01/2017' }
  assert.equal(pickSemanticCandidate(table, clause, 'strutturali'), table)
  assert.equal(pickSemanticCandidate(clause, table, 'strutturali'), table)
  const strong = { valore: '500.000,00', affinity: 0.90, effDate: '30/01/2017' }
  assert.equal(pickSemanticCandidate(table, strong, 'strutturali'), strong)
})

test('pickConsensusCandidate: i voti non scavalcano un corrente da riga di tabella', async () => {
  const { pickConsensusCandidate } = await import('../src/services/polizzaService.js')
  const cur = { valore: '2.500.000,00', affinity: 0.72, tableRow: true, effDate: '30/01/2017', srcDate: '30/01/2017' }
  const cands = [cur, { valore: '500.000,00', affinity: 0.72, effDate: '30/01/2017', srcDate: '30/01/2017' }, { valore: '500.000,00', affinity: 0.7, effDate: '30/01/2017', srcDate: '30/01/2017' }]
  assert.equal(pickConsensusCandidate(cur, cands).changed, false)
})

test('sanitizeFieldValue: "NESSUNA" è un dato se la descrizione lo cita; una "data" per descrizione rifiuta "2 ANNI"', async () => {
  const { sanitizeFieldValue } = await import('../src/services/polizzaService.js')
  const fr = { id: 'f', label: 'Franchigia base', description: "Franchigia per sinistro della RC medica (es. 'NESSUNA', 'COME DA SCHEDA TECNICA', oppure un importo)", type: 'text' }
  assert.equal(sanitizeFieldValue(fr, 'NESSUNA'), 'NESSUNA')
  const other = { id: 'g', label: 'Sottolimiti', description: 'Estrai tutti i sottolimiti presenti', type: 'text' }
  assert.equal(sanitizeFieldValue(other, 'nessuna'), null)
  const dr = { id: 'd', label: 'Data retroattività', description: 'Estrai la data precisa di retroattività, se presente.', type: 'text' }
  assert.equal(sanitizeFieldValue(dr, '2 ANNI'), null)
  assert.equal(sanitizeFieldValue(dr, '09 novembre 2017'), '09/11/2017')
})

test('findValueWindow: un importo con ",00" trova la finestra anche se il documento scrive "€ 5.000.000"', async () => {
  const { findValueWindow, buildNormIndex } = await import('../src/services/polizzaValidation.js')
  const text = 'MASSIMALI RC PRODOTTI\n| SINISTRO | € 5.000.000 |\n| LIMITE ANNUO | € 5.000.000 |'
  const win = findValueWindow(buildNormIndex(text), '5.000.000,00', '')
  assert.ok(win && win.includes('SINISTRO'), String(win))
})

test('pickSemanticCandidate: tra due righe di tabella vince quella con etichetta più vicina alla descrizione', async () => {
  const { pickSemanticCandidate } = await import('../src/services/polizzaValidation.js')
  const soggetto = { valore: 'Studio/ Societa', affinity: 0.702, tableRow: true, effDate: '04/06/2025' }
  const attivita = { valore: 'Studio associato / Societa multidisciplinare', affinity: 0.80, tableRow: true, effDate: '04/06/2025' }
  assert.equal(pickSemanticCandidate(soggetto, attivita, 'strutturali'), attivita)
  assert.equal(pickSemanticCandidate(attivita, soggetto, 'strutturali'), attivita)
})

test('tableRowsWithHeaders: una cella con più coppie "Voce € importo" diventa colonne con nome', async () => {
  const { tableRowsWithHeaders } = await import('../src/services/ocrLayout.js')
  const block = [
    '| ARTICOLI | ARTICOLI | ARTICOLI |',
    '|---|---|---|',
    '| 9. | Formazione del Premio | Premio lordo € 800,00 Imposte € 145,60 Premio imponibile € 654,40 Accessori € 0,00 Premio netto € 654,40 |',
  ].join('\n')
  const [row] = tableRowsWithHeaders(block)
  assert.equal(row.label, '9. Formazione del Premio')
  const byH = Object.fromEntries(row.cols.map((c) => [c.header, c.value]))
  assert.equal(byH['Premio lordo'], '800,00')
  assert.equal(byH['Imposte'], '145,60')
  assert.equal(byH['Premio imponibile'], '654,40')
  assert.equal(byH['Premio netto'], '654,40')
})

test('pickConsensusCandidate: due voti non bastano contro un corrente con un voto (serve maggioranza netta)', async () => {
  const { pickConsensusCandidate } = await import('../src/services/polizzaService.js')
  const mk = (valore, affinity, d = '09/11/2017') => ({ valore, affinity, effDate: d, srcDate: d })
  const cur = mk('2.699,39', 0.67)
  assert.equal(pickConsensusCandidate(cur, [cur, mk('500.000,00', 0.59), mk('500.000,00', 0.59)]).changed, false)
  assert.equal(pickConsensusCandidate(cur, [cur, mk('500.000,00', 0.59), mk('500.000,00', 0.59), mk('500.000,00', 0.59)]).changed, true)
})
