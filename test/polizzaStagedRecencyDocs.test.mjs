// Datazione dei documenti nel motore a stadi (03/10/2026): un PREVENTIVO senza
// numero di polizza non è mai il documento più recente, e il frontespizio
// dello Stadio A.8 viene dal documento più recente, non dal primo caricato.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { extractPolizzaStaged } from '../src/services/polizzaService.js'

const PROFILES = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
const TL = PROFILES.find((p) => p.name === 'Tutela Legale 3').fields

// Ollama finto: registra i prompt dello Stadio A.8 e risponde vuoto a tutto.
async function withFakeOllama(fn) {
  const a8 = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      if (req.url !== '/api/chat') { res.writeHead(404); res.end('no'); return }
      const p = JSON.parse(body)
      const user = p.messages?.find((m) => m.role === 'user')?.content || ''
      if (/^FRONTESPIZIO/.test(user)) a8.push(user)
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      res.write(JSON.stringify({ message: { content: '{}' }, done: false }) + '\n')
      res.end(JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 10, eval_count: 1 }) + '\n')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try { return await fn(`http://127.0.0.1:${server.address().port}`, a8) } finally { await new Promise((r) => server.close(r)) }
}

const pad = (s) => `${s}\n${'Testo delle condizioni di assicurazione della tutela legale. '.repeat(8)}`
const docs = [
  // primo in ordine di caricamento: la scheda vecchia
  { name: 'A scheda 2016.pdf', pages: [pad('POLIZZA N. 0146905063\nContraente CONDOMINIO VIA ROMA 10\nDecorrenza 30/06/2016 Scadenza 30/06/2017')] },
  // preventivo di rinnovo con una data futura e senza numero di polizza
  { name: 'B preventivo.pdf', pages: [pad('PREVENTIVO N. 77\nContraente CONDOMINIO VIA ROMA 10\nDal 30/06/2027 al 30/06/2028')] },
  { name: 'C quietanza.pdf', pages: [pad('POLIZZA N. 0146905063\nContraente CONDOMINIO VIA ROMA 10\nDal 30/06/2026 al 30/06/2027')] },
]

test('preventivo senza numero di polizza: nessuna data, in coda alla cascata; A.8 legge il frontespizio più recente', async () => {
  await withFakeOllama(async (url, a8) => {
    const out = await extractPolizzaStaged(docs, { ollamaUrl: url, ollamaModel: 'fake', polizzaFields: TL, polizzaStagedCascade: true, polizzaAutoVerify: false })
    const pre = out.diag.find((l) => l.startsWith('Documenti pre-contrattuali'))
    assert.ok(pre && pre.includes('B preventivo.pdf'), out.diag.join('\n'))
    const order = out.diag.find((l) => l.startsWith('Cascata — ordine di visita'))
    assert.ok(order, out.diag.join('\n'))
    const names = order.replace(/^[^:]+: /, '').split(' → ').map((x) => x.replace(/ \(.*$/, ''))
    assert.deepEqual(names, ['C quietanza.pdf', 'A scheda 2016.pdf', 'B preventivo.pdf'])
    assert.equal(a8.length, 1)
    assert.ok(a8[0].includes('30/06/2026'), 'frontespizio della quietanza più recente')
    assert.ok(!a8[0].includes('30/06/2016'), 'non la scheda caricata per prima')
  })
})
