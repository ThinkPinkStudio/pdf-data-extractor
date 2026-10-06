// [flag a7ripiego] (06/10/2026) Una proposta dello Stadio A.7 la cui riga e
// colonna non nominano il campo resta solo un RIPIEGO: il campo si chiede alla
// cascata. Scheda DAS Drive (P03, P10, P12): A.7 prendeva l'Attività dalla riga
// «Categoria» («Veicoli conducibili con patente A-B e Rimorchi»), il campo era
// pieno e la cascata non lo chiedeva più; la verità è «Servizi vari» sotto
// «PROFESSIONE / SETTORE ATTIVITA'».
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { A7_SYSTEM_PROMPT, extractPolizzaStaged } from '../src/services/polizzaService.js'

const PROFILES = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
const TL = PROFILES.find((p) => p.name === 'Tutela Legale 3').fields
const byLabel = (label) => TL.find((f) => String(f.label).trim() === label)

const PAGE = [
  'POLIZZA N. 01469DAS00076          DAS Drive',
  'DECORRENZA   30/06/2025          SCADENZA   31/12/2026',
  "PROFESSIONE / SETTORE ATTIVITA'                   E-MAIL",
  'Servizi vari                                       POSTA@ESEMPIO.IT',
  '',
  '| DATI | VALORE | IMPOSTE |',
  '| --- | --- | --- |',
  '| Categoria | Veicoli conducibili con patente A-B e Rimorchi | - |',
  '| PREMIO RATA INIZIALE | 24,88 | 3,12 |',
  '| PREMIO RATA SUCCESSIVA | 24,88 | 3,12 |',
].join('\n')

async function withFakeOllama(fn) {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      if (req.url !== '/api/chat') { res.writeHead(404); res.end('no'); return }
      const p = JSON.parse(body)
      const sys = String(p.messages?.find((m) => m.role === 'system')?.content || '')
      const user = String(p.messages?.find((m) => m.role === 'user')?.content || '')
      const idx = (list, head) => {
        const l = list.split('\n').find((x) => x.replace(/^\d+\.\s*/, '').startsWith(head))
        return l ? Number(l.match(/^(\d+)\./)[1]) : -1
      }
      let content = '{}'
      if (sys.startsWith(A7_SYSTEM_PROMPT.slice(0, 60))) {
        const list = user.split('CAMPI DA ESTRARRE (numerati):\n')[1]?.split('\n\nRispondi')[0] || ''
        const a = idx(list, 'Attività assicurata')
        content = JSON.stringify({ voci: a >= 0 ? [{ campo: a, valore: 'Veicoli conducibili con patente A-B e Rimorchi', riga: 'Categoria', colonna: 'VALORE' }] : [] })
      } else if (user.includes('CAMPI ANCORA MANCANTI DA CERCARE IN QUESTO DOCUMENTO')) {
        const list = user.split('rispondi con chiavi c0, c1, …):\n')[1] || ''
        const a = idx(list, 'Attività assicurata')
        content = JSON.stringify(a >= 0 ? { [`c${a}`]: { valore: 'Servizi vari', evidenza: 'Servizi vari' } } : {})
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      res.write(JSON.stringify({ message: { content }, done: false }) + '\n')
      res.end(JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 100, eval_count: 10 }) + '\n')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

test('a7ripiego: l\'Attività della riga «Categoria» resta ripiego, la cascata trova «Servizi vari»', async () => {
  await withFakeOllama(async (url) => {
    const run = (flags) => extractPolizzaStaged([{ name: 'Polizza Das In Movimento.pdf', pages: [PAGE] }], {
      ollamaUrl: url, ollamaModel: 'fake', polizzaFields: TL, polizzaAutoVerify: false, polizzaStagedCascade: true, polizzaEngineFlags: flags,
    })
    const att = byLabel('Attività assicurata').id
    const base = await run('')
    assert.equal(base.data[att], 'Veicoli conducibili con patente A-B e Rimorchi', base.diag.filter((l) => /Tabella-focus|Attivit/.test(l)).join('\n'))
    const out = await run('a7ripiego')
    assert.equal(out.data[att], 'Servizi vari', out.diag.filter((l) => /Tabella-focus|Cascata|ripiego/.test(l)).join('\n'))
    assert.ok(out.diag.some((l) => /Tabella-focus\[Attività assicurata\].*solo ripiego/.test(l)))
  })
})
