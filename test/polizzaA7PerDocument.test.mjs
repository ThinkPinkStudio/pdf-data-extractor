// Stadio A.7 per documento (analisi errori 25/09/2026, F03). BOLCHINI TL: la
// tabella premi "PREMIO ANNUO 201,22 42,78 244,00" sta nella proposta 25K,
// nella polizza e nella polizza quietanzata; "PREMIO ANNUO 272,16 57,84
// 330,00" solo nella proposta alternativa (massimale 50.000). A.7 prendeva i
// primi 4 blocchi tabella in ordine di caricamento (le due proposte), li fondeva
// senza marcatori e chiedeva "il valore più grande": vinceva l'offerta più
// cara, e la sua riga di tabella resisteva a ogni voto. Ora: una chiamata per
// documento (i 3 più recenti + i 3 più affini), candidati nel registro del
// consenso, e tra righe di tabella pari decidono i documenti distinti.
// Descrizioni reali del profilo «Tutela Legale 3»
// (polizze_test/profili-polizza-riconoscimento.json).
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import {
  A7_SYSTEM_PROMPT, a7FieldOfKey, a7TableBlocksByDoc, findA7Row, pickFocusDocs,
  tableRowStructCmp, pickConsensusCandidate, extractPolizzaStaged,
} from '../src/services/polizzaService.js'
import { normForMatch } from '../src/services/polizzaValidation.js'
import { tableRowsWithHeaders } from '../src/services/ocrLayout.js'

const PROFILES = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
const TL = PROFILES.find((p) => p.name === 'Tutela Legale 3').fields
const byLabel = (label) => TL.find((f) => String(f.label).trim() === label)

// Nomi reali dei file del fascicolo BOLCHINI TL (la cartella POLIZZA/ tolta).
const PROPOSTA_25K = "BOLCHINI MARGHERITA_In vigore_TUT. LEGALE PROF_Proposta 25K BOLCHINI MARGHERITA mass. 25.000,00 €.pdf"
const PROPOSTA_ALT = 'BOLCHINI MARGHERITA_In vigore_TUT. LEGALE PROF_Proposta BOLCHINI MARGHERITA.pdf'
const QUIETANZATA = 'BOLCHINI MARGHERITA_In vigore_TUT. LEGALE PROF_POLIZZA_Polizza BOLCHINI MARGHERITA QUIETANZATA.pdf'
const POLIZZA = 'BOLCHINI MARGHERITA_In vigore_TUT. LEGALE PROF_POLIZZA_Polizza BOLCHINI MARGHERITA.pdf'

const premiumTable = (kind, net, tax, gross) => [
  `| GARANZIE ${kind} - DESCRIZIONE GARANZIE | GARANZIE ${kind} - PREMIO NETTO | GARANZIE ${kind} - IMPOSTE | GARANZIE ${kind} - PREMIO LORDO |`,
  '| --- | --- | --- | --- |',
  '| Tutela Legale Pacchetto Base | 95,14 | 20,24 | 115,38 |',
  `| PREMIO ANNUO | ${net} | ${tax} | ${gross} |`,
].join('\n')

// Candidato come lo produce lo Stadio A.7 (riga "PREMIO ANNUO").
const a7Cand = (valore, file, extra = {}) => ({
  valore, file, page: 3, tableRow: true, structLex: 0.75, rowLex: 0.5, affinity: 0.85,
  effDate: '28/04/2026', srcDate: '28/04/2026', ...extra,
})
// Candidato dei batch (testo libero, stesso livello di data).
const batchCand = (valore, file) => ({ valore, file, page: 3, affinity: 0.59, effDate: '28/04/2026', srcDate: '28/04/2026' })

test('A.7: il prompt non chiede più "il valore più grande"; se nessuna riga rappresenta la descrizione il campo si omette', () => {
  assert.ok(!/valore più grande/i.test(A7_SYSTEM_PROMPT), A7_SYSTEM_PROMPT)
  assert.ok(!/rata che copre l'anno/i.test(A7_SYSTEM_PROMPT))
  assert.ok(A7_SYSTEM_PROMPT.includes('se nessuna riga rappresenta ciò che la descrizione chiede, ometti il campo'))
  assert.ok(A7_SYSTEM_PROMPT.includes('[Documento N · pag. P]'), 'le tabelle arrivano coi marcatori di pagina')
})

test('A.7: la chiave della risposta si mappa SOLO per indice, mai sulle parole della label (Regola 1)', () => {
  const fields = [byLabel('N° Polizza'), byLabel('Premio imponibile tutela legale'), byLabel('Imposte')]
  assert.equal(a7FieldOfKey('1', fields), fields[1])
  assert.equal(a7FieldOfKey('c2', fields), fields[2])
  assert.equal(a7FieldOfKey('k1', fields), fields[1])
  assert.equal(a7FieldOfKey('k2_imposte', fields), fields[2])
  // prima "premio imponibile" trovava il campo per le parole della label
  assert.equal(a7FieldOfKey('Premio imponibile', fields), null)
  assert.equal(a7FieldOfKey('premio_imponibile_tutela_legale', fields), null)
  assert.equal(a7FieldOfKey('Imposte', fields), null)
  assert.equal(a7FieldOfKey('7', fields), null, 'indice fuori elenco')
})

test('A.7: blocchi tabella per documento — la stessa tabella in due documenti resta a entrambi, le copie si scartano solo dentro il documento', () => {
  const polizzaTable = premiumTable('SCELTE', '201,22', '42,78', '244,00')
  const docs = [
    { name: QUIETANZATA, spatialPages: ['frontespizio', polizzaTable], pages: ['frontespizio', polizzaTable] },
    { name: POLIZZA, pages: ['frontespizio', 'Premi\n\n' + polizzaTable] },
    { name: 'senza tabelle.pdf', pages: ['| A | B |\n| --- | --- |\n| testo | altro |'] },
  ]
  const out = a7TableBlocksByDoc(docs)
  assert.deepEqual(out.map((t) => t.d.name), [QUIETANZATA, POLIZZA])
  assert.equal(out[0].blocks.length, 1, 'griglia e markdown della stessa pagina: una sola copia')
  assert.equal(out[0].blocks[0].page, 2)
  assert.equal(out[1].blocks.length, 1, 'la stessa tabella nella polizza è una seconda conferma, non un doppione')
  assert.ok(out[1].blocks[0].b.includes('| PREMIO ANNUO | 201,22 | 42,78 | 244,00 |'))
})

test('A.7: la riga si cerca per pagina + etichetta e vince quella che porta il valore', () => {
  const rows = []
  const add = (page, block) => { for (const r of tableRowsWithHeaders(block)) rows.push({ page, key: normForMatch(r.label), row: r }) }
  add(2, premiumTable('PROPOSTE', '272,16', '57,84', '330,00'))
  add(4, premiumTable('PROPOSTE', '201,22', '42,78', '244,00'))
  const key = normForMatch('PREMIO ANNUO')
  assert.equal(findA7Row(rows, key, normForMatch('201,22')).page, 4)
  assert.equal(findA7Row(rows, key, normForMatch('330,00')).page, 2)
  // valore in nessuna riga: la prima con l'etichetta
  assert.equal(findA7Row(rows, key, normForMatch('999,99')).page, 2)
  // etichetta abbreviata dal modello: contenuta nell'etichetta vera
  assert.equal(findA7Row(rows, normForMatch('Tutela Legale'), normForMatch('95,14')).row.label, 'Tutela Legale Pacchetto Base')
  assert.equal(findA7Row(rows, '', normForMatch('201,22')), null)
})

test('pickFocusDocs: i 3 più recenti + i 3 più affini, al massimo 6 documenti (stessa scelta dei batch focalizzati)', () => {
  const ts = (s) => { const [d, m, y] = s.split('/').map(Number); return Date.UTC(y, m - 1, d) }
  const docs = ['28/04/2026', '28/04/2026', '28/04/2025', '28/04/2024', '28/04/2023', '28/04/2022', '28/04/2021', '28/04/2020']
    .map((dateStr, pos) => ({ name: `d${pos}`, dateStr, ts: ts(dateStr), pos }))
  const aff = { d7: 0.9, d6: 0.8, d5: 0.7, d4: 0.6, d0: 0.1 }
  const r = pickFocusDocs(docs, (d) => aff[d.name] || 0)
  assert.deepEqual(r.recent.map((d) => d.name), ['d0', 'd1', 'd2'])
  assert.deepEqual(r.affine.map((d) => d.name), ['d7', 'd6', 'd5'])
  assert.deepEqual(r.docs.map((d) => d.name), ['d0', 'd1', 'd2', 'd7', 'd6', 'd5'])
  // affinità nulla: nessun documento "affine"; sovrapposizioni non raddoppiano
  assert.deepEqual(pickFocusDocs(docs, () => 0).docs.map((d) => d.name), ['d0', 'd1', 'd2'])
  assert.deepEqual(pickFocusDocs(docs, (d) => (d.name === 'd1' ? 0.5 : 0)).docs.map((d) => d.name), ['d0', 'd1', 'd2'])
})

test('tableRowStructCmp: prima structLex, poi rowLex (come l\'arbitro); un valore assente non decide', () => {
  assert.equal(tableRowStructCmp({ structLex: 1, rowLex: 0.3 }, { structLex: 0.5, rowLex: 1 }), 1)
  assert.equal(tableRowStructCmp({ structLex: 1, rowLex: 0.33 }, { structLex: 1, rowLex: 1 }), -1)
  assert.equal(tableRowStructCmp({ structLex: 0.75, rowLex: 0.5 }, { structLex: 0.75, rowLex: 0.5 }), 0)
  assert.equal(tableRowStructCmp({}, { structLex: 1, rowLex: 1 }), 0)
})

test('consenso BOLCHINI TL: riga "PREMIO ANNUO" in 3 documenti distinti batte la stessa riga della sola proposta alternativa', () => {
  // A.7 ha assorbito per prima la proposta alternativa ("a parità resta la prima")
  const cur = a7Cand('272,16', PROPOSTA_ALT)
  const cands = [
    cur,
    a7Cand('201,22', PROPOSTA_25K),
    a7Cand('201,22', QUIETANZATA),
    a7Cand('201,22', POLIZZA),
    batchCand('201,22', QUIETANZATA),
    batchCand('201,22', POLIZZA),
  ]
  const r = pickConsensusCandidate(cur, cands)
  assert.equal(r.changed, true)
  assert.equal(r.cand.valore, '201,22')
  assert.equal(r.cand.tableRow, true, 'il rappresentante è una lettura di tabella')
  assert.equal(r.docs, 3)
  assert.equal(r.prevDocs, 1)
  // imposte e premio lordo: stessa riga, stesso esito
  const tax = pickConsensusCandidate(a7Cand('57,84', PROPOSTA_ALT), [a7Cand('57,84', PROPOSTA_ALT), a7Cand('42,78', PROPOSTA_25K), a7Cand('42,78', QUIETANZATA)])
  assert.equal(tax.changed, true)
  assert.equal(tax.cand.valore, '42,78')
  const gross = pickConsensusCandidate(a7Cand('330,00', PROPOSTA_ALT), [a7Cand('330,00', PROPOSTA_ALT), a7Cand('244,00', QUIETANZATA), a7Cand('244,00', POLIZZA)])
  assert.equal(gross.cand.valore, '244,00')
})

test('consenso: letture ripetute nello stesso documento non fanno "documenti distinti"; a pari documenti decidono i voti', () => {
  const cur = a7Cand('201,22', PROPOSTA_25K)
  // la proposta alternativa letta tre volte (griglia, markdown, retry) resta UN documento
  const cands = [cur, a7Cand('272,16', PROPOSTA_ALT), a7Cand('272,16', PROPOSTA_ALT, { page: 4 }), a7Cand('272,16', PROPOSTA_ALT, { page: 5 })]
  const r = pickConsensusCandidate(cur, cands)
  // 1 documento contro 1: nessuno spareggio; i voti (3 contro 1) decidono a veto
  // allentato (sfidante riga di tabella pari, stesso livello di data)
  assert.equal(r.changed, true)
  assert.equal(r.docs, undefined, 'non è lo spareggio per documenti')
  assert.equal(r.cand.valore, '272,16')
})

test('consenso: il corrente mostrato da più documenti resta anche contro più voti dei batch', () => {
  const cur = a7Cand('201,22', QUIETANZATA)
  const cands = [
    cur, a7Cand('201,22', POLIZZA), a7Cand('201,22', PROPOSTA_25K),
    a7Cand('272,16', PROPOSTA_ALT),
    ...Array.from({ length: 8 }, () => batchCand('272,16', PROPOSTA_ALT)),
  ]
  assert.equal(pickConsensusCandidate(cur, cands).changed, false)
})

test('consenso: riga di tabella contro riga di tabella a pari documenti → decidono i voti (veto allentato)', () => {
  const cur = a7Cand('272,16', PROPOSTA_ALT)
  const cands = [cur, a7Cand('201,22', POLIZZA), batchCand('201,22', POLIZZA), batchCand('201,22', QUIETANZATA)]
  const r = pickConsensusCandidate(cur, cands)
  assert.equal(r.changed, true)
  assert.equal(r.cand.valore, '201,22')
  assert.equal(r.votes, 3)
  // senza la riga di tabella dello sfidante il veto resta intero (Cresta)
  const onlyBatch = [cur, batchCand('201,22', POLIZZA), batchCand('201,22', QUIETANZATA), batchCand('201,22', PROPOSTA_25K)]
  assert.equal(pickConsensusCandidate(cur, onlyBatch).changed, false)
})

test('consenso: una riga strutturalmente più debole non scavalca la riga TOTALE (GUFFANTI RC 2025 v5)', () => {
  const tot = { valore: '18.000,00', tableRow: true, structLex: 1, rowLex: 1, affinity: 0.88, effDate: '30/06/2026', srcDate: '30/06/2026', file: 'polizza.pdf' }
  const row = (file) => ({ valore: '2.250,00', tableRow: true, structLex: 1, rowLex: 0.33, affinity: 0.9, effDate: '30/06/2026', srcDate: '30/06/2026', file })
  const cands = [tot, row('polizza.pdf'), row('appendice.pdf'), row('quietanza.pdf'), row('proroga.pdf')]
  assert.equal(pickConsensusCandidate(tot, cands).changed, false)
})

test('consenso: righe di tabella di un ALTRO livello di data non contano per lo spareggio né allentano il veto (identità, tierBlind)', () => {
  const cur = a7Cand('201,22', QUIETANZATA)
  const old = (file) => a7Cand('190,00', file, { effDate: '28/04/2025', srcDate: '28/04/2025' })
  const cands = [cur, old('a.pdf'), old('b.pdf'), old('c.pdf')]
  assert.equal(pickConsensusCandidate(cur, cands, { tierBlind: true }).changed, false)
})

test('consenso: le etichette di layout (senza structLex) non fanno documenti distinti contro una riga letta con le intestazioni', () => {
  // riga di tabella dello Stadio A.7 (con intestazioni) contro tre letture
  // "etichetta di layout" di un'altra data: tipi di evidenza diversi, il veto resta
  const cur = a7Cand('28/04/2026', POLIZZA)
  const labelled = (file) => ({ valore: '28/04/2025', tableRow: true, labelToken: 'decorrenza', affinity: 0.7, effDate: '28/04/2025', srcDate: '28/04/2026', file })
  const cands = [cur, labelled(QUIETANZATA), labelled(PROPOSTA_25K), labelled(PROPOSTA_ALT)]
  assert.equal(pickConsensusCandidate(cur, cands).changed, false)
})

test('consenso: il corrente da riga di tabella resiste ancora ai voti del testo libero', () => {
  const cur = { valore: '2.500.000,00', affinity: 0.72, tableRow: true, structLex: 1, rowLex: 1, effDate: '30/01/2017', srcDate: '30/01/2017', file: 'polizza.pdf' }
  const clause = (file) => ({ valore: '500.000,00', affinity: 0.72, effDate: '30/01/2017', srcDate: '30/01/2017', file })
  assert.equal(pickConsensusCandidate(cur, [cur, clause('polizza.pdf'), clause('set.pdf'), clause('cga.pdf')]).changed, false)
})

// ── Integrazione: motore a stadi contro un Ollama FINTO ──────────────────────
// Il modello finto risponde allo Stadio A.7 leggendo la riga "PREMIO ANNUO"
// della tabella che riceve (come il modello vero nel log BOLCHINI TL) e a ogni
// altra chiamata con {} (nessun valore). Embeddings assenti: affinità lessicale.
async function withFakeOllama(fn) {
  const a7Calls = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      if (req.url !== '/api/chat') { res.writeHead(404); res.end('no'); return }
      const p = JSON.parse(body)
      const sys = p.messages?.find((m) => m.role === 'system')?.content || ''
      const user = p.messages?.find((m) => m.role === 'user')?.content || ''
      let content = '{}'
      if (sys === A7_SYSTEM_PROMPT) {
        a7Calls.push(user)
        const fieldsPart = user.split('CAMPI DA ESTRARRE (numerati):\n')[1].split('\n\nRispondi')[0]
        const idxOf = (head) => Number(fieldsPart.split('\n').find((l) => l.replace(/^\d+\.\s*/, '').startsWith(head)).match(/^(\d+)\./)[1])
        const row = user.match(/RIGA "PREMIO ANNUO":\n\s+col1 ([^=\n]*)= ([\d.,]+)\n\s+col2 ([^=\n]*)= ([\d.,]+)\n\s+col3 ([^=\n]*)= ([\d.,]+)/)
        const voci = row ? [
          { campo: idxOf('Premio imponibile'), valore: row[2], riga: 'PREMIO ANNUO', colonna: row[1].trim() },
          { campo: idxOf('Imposte'), valore: row[4], riga: 'PREMIO ANNUO', colonna: row[3].trim() },
          { campo: idxOf('Premio lordo'), valore: row[6], riga: 'PREMIO ANNUO', colonna: row[5].trim() },
        ] : []
        content = JSON.stringify({ voci })
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      res.write(JSON.stringify({ message: { content }, done: false }) + '\n')
      res.end(JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 100, eval_count: 10 }) + '\n')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, a7Calls)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

test('motore a stadi: A.7 legge ogni documento a parte e il consenso sceglie la riga dei documenti distinti (BOLCHINI TL)', async () => {
  const front = (i) => `DAS Professionista\nPeriodo di assicurazione: dalle ore 24 del 28/04/2026 alle ore 24 del 28/04/2027\nContraente BOLCHINI MARGHERITA\nRif. ${i}`
  const mk = (i, name, kind, net, tax, gross, mass) => ({ name, pages: [front(i), `MASSIMALE PER SINISTRO ${mass}\n\n${premiumTable(kind, net, tax, gross)}\n`] })
  // ordine di caricamento sfavorevole: la proposta alternativa per prima
  const docs = [
    mk(0, PROPOSTA_ALT, 'PROPOSTE', '272,16', '57,84', '330,00', '50.000,00'),
    mk(1, PROPOSTA_25K, 'PROPOSTE', '201,22', '42,78', '244,00', '25.000,00'),
    mk(2, QUIETANZATA, 'SCELTE', '201,22', '42,78', '244,00', '25.000,00'),
    mk(3, POLIZZA, 'SCELTE', '201,22', '42,78', '244,00', '25.000,00'),
  ]
  await withFakeOllama(async (url, a7Calls) => {
    const out = await extractPolizzaStaged(docs, { ollamaUrl: url, ollamaModel: 'fake', polizzaFields: TL, polizzaAutoVerify: false })
    assert.equal(out.data[byLabel('Premio imponibile tutela legale').id], '201,22')
    assert.equal(out.data[byLabel('Imposte').id], '42,78')
    assert.equal(out.data[byLabel('Premio lordo totale tutela legale').id], '244,00')
    // una chiamata per documento, mai due documenti nella stessa chiamata
    assert.ok(a7Calls.length >= 2 && a7Calls.length <= 6, `chiamate A.7: ${a7Calls.length}`)
    for (const u of a7Calls) assert.equal(new Set(u.match(/Documento \d+/g)).size, 1, u.slice(0, 300))
    const consensus = out.diag.find((l) => l.startsWith('Consenso tra batch:'))
    assert.match(consensus, /documenti distinti/)
    // nessun nome file nei prompt
    for (const u of a7Calls) assert.ok(!u.includes('BOLCHINI MARGHERITA_In vigore'), 'nome file nel prompt')
  })
})
