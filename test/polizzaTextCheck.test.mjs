// [flag verificatesti] (06/10/2026) Ogni valore di TESTO confrontato dal modello
// con la sola descrizione del suo campo, in una chiamata a sé: i prompt degli
// stadi non cambiano. Polizze auto di privati: Attività = «IMPIEGATO» (la
// professione del contraente), verità vuota.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { extractPolizzaStaged, TEXT_CHECK_SYSTEM, sourceLineOf } from '../src/services/polizzaService.js'

const PROFILES = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
const TL = PROFILES.find((p) => p.name === 'Tutela Legale 3').fields
const byLabel = (label) => TL.find((f) => String(f.label).trim() === label)

const PAGE = [
  'POLIZZA N. 555412062          Allianz S.p.A.',
  'CONTRAENTE   VINCENZO PISAPIA          PROFESSIONE   IMPIEGATO',
  'DECORRENZA   02/04/2025          SCADENZA   02/04/2026',
  'Tutela Giudiziaria   SI',
].join('\n')

async function withFakeOllama(fn) {
  const checks = []
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
      if (sys === TEXT_CHECK_SYSTEM) {
        checks.push(user)
        content = JSON.stringify({ corrisponde: !user.includes('VALORE: IMPIEGATO') })
      } else if (user.includes('CAMPI ANCORA MANCANTI DA CERCARE IN QUESTO DOCUMENTO')) {
        const list = user.split('rispondi con chiavi c0, c1, …):\n')[1] || ''
        const a = idx(list, 'Attività assicurata')
        const c = idx(list, 'Nome o ragione sociale del contraente') >= 0 ? idx(list, 'Nome o ragione sociale del contraente') : idx(list, 'Ragione sociale o nome del contraente')
        const out = {}
        if (a >= 0) out[`c${a}`] = { valore: 'IMPIEGATO', evidenza: 'PROFESSIONE   IMPIEGATO' }
        if (c >= 0) out[`c${c}`] = { valore: 'VINCENZO PISAPIA', evidenza: 'CONTRAENTE   VINCENZO PISAPIA' }
        content = JSON.stringify(out)
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      res.write(JSON.stringify({ message: { content }, done: false }) + '\n')
      res.end(JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 100, eval_count: 10 }) + '\n')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, checks)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

test('sourceLineOf: la riga della pagina sorgente che contiene il valore', () => {
  const docs = [{ name: 'p.pdf', spatialPages: [PAGE] }]
  assert.equal(sourceLineOf(docs, { valore: 'IMPIEGATO', file: 'p.pdf', page: 1 }), 'CONTRAENTE   VINCENZO PISAPIA   PROFESSIONE   IMPIEGATO')
  assert.equal(sourceLineOf(docs, { valore: 'assente', file: 'p.pdf', page: 1 }), '')
})

test('verificatesti: l\'Attività «IMPIEGATO» non corrisponde alla descrizione → vuota; gli altri testi restano', async () => {
  await withFakeOllama(async (url, checks) => {
    const run = (flags) => extractPolizzaStaged([{ name: 'POLIZZA PISAPIA.pdf', pages: [PAGE] }], {
      ollamaUrl: url, ollamaModel: 'fake', polizzaFields: TL, polizzaAutoVerify: false, polizzaStagedCascade: true, polizzaEngineFlags: flags,
    })
    const att = byLabel('Attività assicurata').id
    const base = await run('')
    assert.equal(base.data[att], 'IMPIEGATO')
    assert.equal(checks.length, 0, 'senza flag nessuna chiamata di verifica')
    const out = await run('verificatesti')
    assert.equal(out.data[att], undefined, out.diag.filter((l) => /Verifica testo/.test(l)).join('\n'))
    assert.ok(out.diag.some((l) => /Verifica testo\[Attività assicurata\]: "IMPIEGATO" non corrisponde/.test(l)))
    assert.ok(checks.some((u) => u.includes('RIGA DEL VALORE: CONTRAENTE   VINCENZO PISAPIA   PROFESSIONE   IMPIEGATO') && u.includes('RIGA SOPRA (intestazioni o testo precedente): POLIZZA N. 555412062   Allianz S.p.A.')), 'la riga sorgente e quella sopra vanno al modello')
    const contr = TL.find((f) => /contraente/i.test(String(f.description || '').split(':')[0]))
    if (contr && base.data[contr.id]) assert.equal(out.data[contr.id], base.data[contr.id], 'un testo che corrisponde resta')
  })
})

test('rankAlternativeCandidates: più voti, poi più affine, poi più recente; mai il valore scartato', async () => {
  const { rankAlternativeCandidates } = await import('../src/services/polizzaService.js')
  const cands = [
    { valore: 'azienda', affinity: 0.68 }, { valore: 'Azienda', affinity: 0.6 }, { valore: 'azienda', affinity: 0.68 },
    { valore: 'Tutela legale penale', affinity: 0.43, srcDate: '01/01/2025' },
    { valore: 'Servizi vari', affinity: 0.46, srcDate: '01/01/2025' },
    { valore: 'imprese e strutture alberghiere', affinity: 0.46, srcDate: '01/01/2024' },
  ]
  const out = rankAlternativeCandidates(cands, new Set(['azienda']))
  assert.deepEqual(out.map((x) => [x.c.valore, x.votes]), [['Servizi vari', 1], ['imprese e strutture alberghiere', 1], ['Tutela legale penale', 1]])
  // il rappresentante di un gruppo è il candidato più affine
  const all = rankAlternativeCandidates(cands)
  assert.deepEqual([all[0].c.valore, all[0].votes, all[0].c.affinity], ['azienda', 3, 0.68])
})
