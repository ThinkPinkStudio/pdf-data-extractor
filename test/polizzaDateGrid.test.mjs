// [flag datagriglia] + [flag date8] (06/10/2026). Le quietanze di rinnovo
// Vittoria (P39 RAMAZZINI, P44 ZELO, P45 BOIARDO) sono PDF «sandwich»: il
// markdown Docling è costruito sul testo invisibile dello scanner («Rata Pofizza
// dal 1510712026 - al l5t0il2Ù27»), la griglia dei prompt sull'OCR del programma
// («Rata Polizza dal 15/07/2026 al 15/07/2027»). Datata sul markdown la quietanza
// restava «senza data», in coda alla cascata, e decorrenza/scadenza restavano
// quelle del frontespizio della polizza (15/07/2024 → 15/07/2026).
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { extractPolizzaStaged } from '../src/services/polizzaService.js'
import { latestDateExcludingEmission } from '../src/services/polizzaDates.js'

const PROFILES = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
const TL = PROFILES.find((p) => p.name === 'Tutela Legale 3').fields
const byLabel = (label) => TL.find((f) => String(f.label).trim() === label)

// Righe copiate dall'OCR Tesseract e dal text layer della quietanza vera.
const QZA_GRID = [
  '               | NUMERO   CARTELLA',
  '                3140312               |',
  '                NUMERO    POLIZZA                          AGENZIA                          | PRODUTTORE',
  '               | 212.044.0000902030                     |',
  '               | CONTRAENTE                                                                                                   |',
  '               | CONDOMINIO   RAMAZZINI   2',
  '               | RATA ANNIVERSARIA             | Euro 694] ,93           |Euro 1516.,07          | Euro 8458,00            |',
  '                Rata  Polizza dal 15/07/2026  _  al 15/07/2027 ___',
  '               | RAMI ELEMENTARI    - Vittoria Con Te - Condomirii                                                           |',
].join('\n')
const QZA_MD = 'mvittoria I Assicurazioni NUMERO POLIZZA 2t2.044.0000902030 CONTRAENTE CONDOMINIO RAMAZZINI2 TOTALE ouro 8458,00 Rata Pofizza dal 1510712026 - al l5t0il2Ù27-- RAMI ELEMENTARI - Vittoria Con Te - Condorninr'
const POLIZZA_GRID = [
  'POLIZZA N. 212.044.0000902030          Vittoria Assicurazioni S.p.A.',
  'CONTRAENTE   CONDOMINIO RAMAZZINI 2',
  'DECORRENZA   15/07/2024          SCADENZA   15/07/2026',
  'Durata del contratto: dal 15/07/2024 al 15/07/2026',
].join('\n')

const QZA = 'Cond. Ramazzini 2 - q.za 26 27.pdf'
const POL = 'RAMAZZINI 2 FIRMATA.pdf'
const docs = () => [
  { name: POL, pages: [POLIZZA_GRID], spatialPages: [POLIZZA_GRID] },
  { name: QZA, pages: [QZA_MD], spatialPages: [QZA_GRID] },
]

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
      if (sys.startsWith('Estrai i dati dal FRONTESPIZIO')) {
        const list = user.split('CAMPI DA ESTRARRE (numerati):\n')[1] || ''
        const voci = []
        if (user.includes('DECORRENZA   15/07/2024')) {
          voci.push({ campo: idx(list, 'Data di decorrenza'), valore: '15/07/2024', riga: 'DECORRENZA   15/07/2024' })
          voci.push({ campo: idx(list, 'Data di scadenza'), valore: '15/07/2026', riga: 'SCADENZA   15/07/2026' })
        }
        content = JSON.stringify(voci.filter((v) => v.campo >= 0))
      } else if (user.includes('CAMPI ANCORA MANCANTI DA CERCARE IN QUESTO DOCUMENTO')) {
        const list = user.split('rispondi con chiavi c0, c1, …):\n')[1] || ''
        const out = {}
        const dec = idx(list, 'Data di decorrenza'), sca = idx(list, 'Data di scadenza')
        if (user.includes('dal 15/07/2026  _  al 15/07/2027')) {
          const ev = 'Rata  Polizza dal 15/07/2026  _  al 15/07/2027'
          if (dec >= 0) out[`c${dec}`] = { valore: '15/07/2026', evidenza: ev }
          if (sca >= 0) out[`c${sca}`] = { valore: '15/07/2027', evidenza: ev }
        } else if (user.includes('DECORRENZA   15/07/2024')) {
          if (dec >= 0) out[`c${dec}`] = { valore: '15/07/2024', evidenza: 'DECORRENZA   15/07/2024' }
          if (sca >= 0) out[`c${sca}`] = { valore: '15/07/2026', evidenza: 'SCADENZA   15/07/2026' }
        }
        content = JSON.stringify(out)
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

const run = (url, flags) => extractPolizzaStaged(docs(), {
  ollamaUrl: url, ollamaModel: 'fake', polizzaFields: TL, polizzaAutoVerify: false, polizzaStagedCascade: true,
  ...(flags ? { polizzaEngineFlags: flags } : {}),
})
const order = (out) => out.diag.find((l) => l.startsWith('Cascata — ordine di visita:')) || ''

test('latestDateExcludingEmission confirmedOnly: senza riga di periodo né data ripetuta, nessuna data', () => {
  assert.equal(latestDateExcludingEmission('Rata Polizza dal 15/07/2026 al 15/07/2027', { ocr: true, confirmedOnly: true }), '15/07/2027')
  assert.equal(latestDateExcludingEmission('Stampato 15/09/2078 pagina 3', { ocr: true, confirmedOnly: true }), null)
  // senza confirmedOnly resta la regola di sempre (ripiego su ogni data)
  assert.equal(latestDateExcludingEmission('Timbro 15/09/2078 pagina 3', { ocr: true }), '15/09/2078')
})

test('datagriglia: la quietanza «sandwich» si data dalla griglia OCR e apre la cascata', async () => {
  await withFakeOllama(async (url) => {
    const base = await run(url, '-date8,-datagriglia')
    assert.ok(!order(base).startsWith(`Cascata — ordine di visita: ${QZA}`), order(base))
    const out = await run(url, '-date8')
    assert.ok(order(out).startsWith(`Cascata — ordine di visita: ${QZA} (15/07/2027)`), order(out))
  })
})

test('date8 + datagriglia: decorrenza e scadenza dal rinnovo più recente, non dal frontespizio della polizza', async () => {
  await withFakeOllama(async (url) => {
    const dec = byLabel('Decorrenza').id, sca = byLabel('Scadenza').id
    const base = await run(url, '-date8,-datagriglia')
    assert.deepEqual([base.data[dec], base.data[sca]], ['15/07/2024', '15/07/2026'])
    // la sola datazione non basta: le date del frontespizio sono già piene e la
    // cascata non le chiede alla quietanza
    const only = await run(url, '-date8')
    assert.deepEqual([only.data[dec], only.data[sca]], ['15/07/2024', '15/07/2026'])
    const out = await run(url, 'date8,datagriglia')
    assert.deepEqual([out.data[dec], out.data[sca]], ['15/07/2026', '15/07/2027'], out.diag.filter((l) => /Decorrenza|Scadenza|Cascata/.test(l)).join('\n'))
  })
})

test('date8 mirato: se il frontespizio è già il documento più recente, nessuna domanda in più', async () => {
  await withFakeOllama(async (url) => {
    // senza quietanza: la polizza è il documento più recente → nessuna differenza col flag
    const one = (flags) => extractPolizzaStaged([docs()[0]], {
      ollamaUrl: url, ollamaModel: 'fake', polizzaFields: TL, polizzaAutoVerify: false, polizzaStagedCascade: true, polizzaEngineFlags: flags,
    })
    const a = await one('-date8'), b = await one('date8')
    const cascadeLines = (o) => o.diag.filter((l) => /^Cascata \d+\//.test(l)).map((l) => l.replace(/\d+(\.\d+)?s/g, ''))
    assert.deepEqual(cascadeLines(b), cascadeLines(a))
    assert.deepEqual(b.data, a.data)
  })
})
