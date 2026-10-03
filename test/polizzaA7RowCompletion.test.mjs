// Stadio A.7, completamento della riga (giro TL3 del 28/09/2026): il modello
// legge diritti, imposte e premio lordo dalla riga «PREMIO RATA INIZIALE» della
// scheda DAS Difesa Condominio ma omette lo «0,00» della colonna FRAZIONAMENTO
// (interessi di frazionamento, 14 posizioni su 41). La cella della stessa riga
// sotto la colonna che nomina il campo completa la risposta.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { A7_SYSTEM_PROMPT, completeA7Row, extractPolizzaStaged } from '../src/services/polizzaService.js'
import { normForMatch } from '../src/services/polizzaValidation.js'
import { tableRowsWithHeaders } from '../src/services/ocrLayout.js'

const PROFILES = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
// Descrizioni v4 del profilo in produzione (28/09/2026) per i campi del premio.
const V4 = {
  'Interessi di frazionamento': "Interessi di frazionamento della tutela legale: l'importo (in euro) aggiunto al premio annuo della tutela legale se il pagamento è rateizzato (es. 0,00, 2,48, 3,01), sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale. È un importo con due decimali; se è stampato a zero riporta '0,00'. Se per la tutela legale la voce non è stampata, lascia vuoto: non calcolarla. NON il contributo al Servizio Sanitario Nazionale, NON un valore di altre sezioni o garanzie della polizza.",
  Diritti: "Diritti della tutela legale: l'importo (in euro) dei diritti (di emissione, di quietanza) sul premio annuo della tutela legale, sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale (es. 0,00, 2,48, 19,30). È un importo con due decimali; se è stampato a zero riporta '0,00'.",
  Imposte: "Imposte sul premio annuo della tutela legale: l'importo (in euro) delle imposte sulla stessa riga o nello stesso riepilogo del Premio imponibile annuo della tutela legale (es. 19,30, 44,69, 110,11). È un importo con due decimali. NON il premio lordo né l'imponibile.",
  'Premio imponibile tutela legale': "Premio imponibile (netto) ANNUO della tutela legale: la base imponibile del premio della tutela legale per un'annualità, al netto di imposte, diritti e interessi, come stampata nel documento. È un importo con due decimali (es. 207,83, 501,30, 757,82).",
  'Premio lordo totale tutela legale': "Premio lordo ANNUO della tutela legale: l'importo (in euro) comprensivo di imposte, diritti e interessi che il contraente paga per un'annualità di tutela legale, come stampato nel documento (es. 255,00, 611,41, 918,86).",
}
const TL = PROFILES.find((p) => p.name === 'Tutela Legale 3').fields.map((f) => (V4[String(f.label).trim()] ? { ...f, description: V4[String(f.label).trim()] } : f))
const byLabel = (label) => TL.find((f) => String(f.label).trim() === label)

const table = [
  '| PREMIO TOTALE | FRAZIONAMENTO | NETTO IMPONIBILE | RIMBORSO | DIRITTO | IMPOSTE | PREMIO LORDO |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| PREMIO RATA INIZIALE | 0,00 | 702,67 | 0,00 | 2,48 | 149,85 | 855,00 |',
  '| PREMIO RATA SUCCESSIVA | 0,00 | 702,67 | - | 2,48 | 149,85 | 855,00 |',
].join('\n')

test('completeA7Row: la colonna FRAZIONAMENTO della riga letta va agli interessi; nessun campo già risposto, nessuna colonna contesa', () => {
  const rows = tableRowsWithHeaders(table).map((r) => ({ page: 1, key: normForMatch(r.label), row: r }))
  const fields = [byLabel('Interessi di frazionamento'), byLabel('Diritti'), byLabel('Imposte'), byLabel('Premio lordo totale tutela legale'), byLabel('Premio imponibile tutela legale'), byLabel('Massimale per sinistro tutela legale')]
  const entries = [
    ['1', { valore: '2,48', riga: 'PREMIO RATA INIZIALE', colonna: 'DIRITTO' }],
    ['2', { valore: '149,85', riga: 'PREMIO RATA INIZIALE', colonna: 'IMPOSTE' }],
    ['3', { valore: '855,00', riga: 'PREMIO RATA INIZIALE', colonna: 'PREMIO LORDO' }],
  ]
  const out = completeA7Row(entries, rows, fields, (k) => fields[Number(k)] || null)
  const got = Object.fromEntries(out.map((x) => [x.field.label.trim(), x.entry[1].valore]))
  assert.equal(got['Interessi di frazionamento'], '0,00')
  assert.ok(!('Premio imponibile tutela legale' in got), 'la descrizione dell\'imponibile non lo lega alla «stessa riga»')
  assert.ok(!('Massimale per sinistro tutela legale' in got), 'nessuna colonna nomina il massimale')
  assert.ok(!('Diritti' in got), 'già risposto dal modello')
  // senza righe lette dal modello, o con una sola lettura nella riga, niente completamento
  assert.deepEqual(completeA7Row([], rows, fields, (k) => fields[Number(k)] || null), [])
  assert.deepEqual(completeA7Row(entries.slice(0, 1), rows, fields, (k) => fields[Number(k)] || null), [])
})

async function withFakeOllama(fn) {
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
        const fieldsPart = user.split('CAMPI DA ESTRARRE (numerati):\n')[1].split('\n\nRispondi')[0]
        const idxOf = (head) => Number(fieldsPart.split('\n').find((l) => l.replace(/^\d+\.\s*/, '').startsWith(head)).match(/^(\d+)\./)[1])
        content = JSON.stringify({ voci: [
          { campo: idxOf('Diritti'), valore: '2,48', riga: 'PREMIO RATA INIZIALE', colonna: 'DIRITTO' },
          { campo: idxOf('Imposte'), valore: '149,85', riga: 'PREMIO RATA INIZIALE', colonna: 'IMPOSTE' },
          { campo: idxOf('Premio lordo'), valore: '855,00', riga: 'PREMIO RATA INIZIALE', colonna: 'PREMIO LORDO' },
        ] })
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      res.write(JSON.stringify({ message: { content }, done: false }) + '\n')
      res.end(JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 10, eval_count: 1 }) + '\n')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try { return await fn(`http://127.0.0.1:${server.address().port}`) } finally { await new Promise((r) => server.close(r)) }
}

test('motore a stadi: interessi 0,00 dalla stessa riga dei premi letti dal modello', async () => {
  const docs = [{ name: 'scheda.pdf', pages: [`POLIZZA N. 0146905063\nDal 30/06/2026 al 30/06/2027\n\n${table}\n`] }]
  await withFakeOllama(async (url) => {
    const out = await extractPolizzaStaged(docs, { ollamaUrl: url, ollamaModel: 'fake', polizzaFields: TL, polizzaAutoVerify: false })
    assert.equal(out.data[byLabel('Interessi di frazionamento').id], '0,00', out.diag.filter((l) => /Tabella|Interessi/.test(l)).join('\n'))
    assert.equal(out.data[byLabel('Diritti').id], '2,48')
    assert.ok(out.diag.some((l) => l.startsWith('Tabella-completamento[Interessi di frazionamento]')))
  })
})

test('isRowLabelValue: l\'etichetta della riga letta da una colonna di importi non è il dato; la colonna dell\'etichetta sì', async () => {
  const { isRowLabelValue } = await import('../src/services/polizzaService.js')
  const rows = tableRowsWithHeaders(table).map((r) => ({ page: 1, key: normForMatch(r.label), row: r }))
  const hit = rows[0]
  assert.equal(isRowLabelValue('PREMIO RATA INIZIALE', hit, 'FRAZIONAMENTO'), true)
  assert.equal(isRowLabelValue('PREMIO RATA INIZIALE', hit, 'col1'), true)
  assert.equal(isRowLabelValue('ANNUALE', hit, 'FRAZIONAMENTO'), false)
  const garanzie = tableRowsWithHeaders('| GARANZIE PRESCELTE | TUTELA LEGALE | IMPOSTE | PREMIO LORDO |\n| --- | --- | --- | --- |\n| Difesa Condominio - ed.2019 | 159,99 | 34,00 | 193,99 |')
    .map((r) => ({ page: 1, key: normForMatch(r.label), row: r }))
  assert.equal(isRowLabelValue('Difesa Condominio - ed.2019', garanzie[0], 'GARANZIE PRESCELTE'), false)
})

test('completeA7Row: tra le colonne che nominano le imposte conta quella con un importo, non l\'aliquota (Allianz, sezione Tutela Giudiziaria)', () => {
  const t = '| Coperture | prima rata (1) | Imposta | Importo Imposte | SSN | alla firma |\n| --- | --- | --- | --- | --- | --- |\n| Tutela Giudiziaria | 23,10 | 12,50% | 2,89 | - | 25,99 |\n| Totali | 634,08 | - | 88,16 | 18,26 | 740,50 |'
  const rows = tableRowsWithHeaders(t).map((r) => ({ page: 9, key: normForMatch(r.label), row: r }))
  const fields = [byLabel('Premio imponibile tutela legale'), byLabel('Imposte'), byLabel('Premio lordo totale tutela legale')]
  const entries = [
    ['0', { valore: '23,10', riga: 'Tutela Giudiziaria', colonna: 'prima rata (1)' }],
    ['2', { valore: '25,99', riga: 'Tutela Giudiziaria', colonna: 'alla firma' }],
  ]
  const out = completeA7Row(entries, rows, fields, (k) => fields[Number(k)] || null)
  assert.deepEqual(out.map((x) => [x.field.label.trim(), x.entry[1].valore, x.entry[1].riga]), [['Imposte', '2,89', 'Tutela Giudiziaria']])
})
