// [flag filtroelenchi] Le voci di un campo-ELENCO confrontate con la descrizione
// dal modello: si tiene solo un sottoinsieme delle voci trovate (05/10/2026:
// polizze auto con «Kasko, Infortuni…» tra le garanzie di tutela legale).
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { extractPolizzaStaged, isListDescription, splitListItems, LIST_FILTER_SYSTEM } from '../src/services/polizzaService.js'

test('elenco: lo dice la testa della descrizione; voci separate fuori dalle parentesi', () => {
  assert.equal(isListDescription('Elenco dei nomi delle garanzie di tutela legale scelte/operanti: le garanzie attive'), true)
  assert.equal(isListDescription('Frazionamento del premio: la periodicità di pagamento (elenco di valori: annuale…)'), false, 'solo la testa decide')
  assert.deepEqual(splitListItems('Infortuni, Kasko (urto, ribaltamento); Cristalli / Tutela legale'), ['Infortuni', 'Kasko (urto, ribaltamento)', 'Cristalli', 'Tutela legale'])
  assert.deepEqual(splitListItems('Difesa Penale e Civile'), ['Difesa Penale e Civile'])
})

const FIELD = { id: 'gar', label: 'campo', description: 'Elenco dei nomi delle garanzie di tutela legale scelte/operanti: le garanzie attive del prodotto di tutela legale, come TESTO. NON le garanzie di altre sezioni della polizza (kasko, infortuni).' }

async function withFake(answerFilter, fn) {
  const filterCalls = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const p = JSON.parse(body || '{}')
      const sys = p.messages?.find((m) => m.role === 'system')?.content || ''
      const user = p.messages?.find((m) => m.role === 'user')?.content || ''
      let content = '{}'
      if (sys === LIST_FILTER_SYSTEM) { filterCalls.push(user); content = answerFilter }
      else if (/CAMPI ANCORA MANCANTI|CAMPI DA ESTRARRE/.test(user)) content = JSON.stringify({ c0: { valore: 'Kasko, Tutela Legale Pacchetto Base', evidenza: 'Kasko' } })
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      res.write(JSON.stringify({ message: { content }, done: false }) + '\n')
      res.end(JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 10, eval_count: 5 }) + '\n')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try { return await fn(`http://127.0.0.1:${server.address().port}`, filterCalls) } finally { await new Promise((r) => server.close(r)) }
}

const DOCS = [{ name: 'polizza.pdf', pages: ['POLIZZA N. 12345678\nGaranzie: Kasko 300,00   Tutela Legale Pacchetto Base 95,14\nDecorrenza 01/01/2026'] }]
const SETTINGS = (url, flags) => ({ ollamaUrl: url, ollamaModel: 'fake', polizzaFields: [FIELD], polizzaAutoVerify: false, polizzaStagedCascade: true, polizzaEngineFlags: flags })

test('filtroelenchi: un elenco estraneo per intero si svuota; una scelta parziale lascia l\'elenco com\'è; spento: nessuna chiamata', async () => {
  await withFake(JSON.stringify({ tenere: [] }), async (url, calls) => {
    const out = await extractPolizzaStaged(DOCS, SETTINGS(url, 'filtroelenchi'))
    assert.equal(out.data.gar, undefined, out.diag.filter((l) => l.startsWith('Elenco')).join('\n'))
    assert.equal(calls.length, 1)
    assert.match(calls[0], /0\. Kasko\n1\. Tutela Legale Pacchetto Base/)
  })
  await withFake(JSON.stringify({ tenere: [1] }), async (url) => {
    const out = await extractPolizzaStaged(DOCS, SETTINGS(url, 'filtroelenchi'))
    assert.equal(out.data.gar, 'Kasko, Tutela Legale Pacchetto Base', 'scelta parziale: elenco invariato')
  })
  await withFake(JSON.stringify({ tenere: [] }), async (url, calls) => {
    const out = await extractPolizzaStaged(DOCS, SETTINGS(url, '-filtroelenchi'))
    assert.equal(calls.length, 0, 'flag spento: nessuna chiamata di filtro')
    assert.equal(out.data.gar, 'Kasko, Tutela Legale Pacchetto Base')
  })
})
